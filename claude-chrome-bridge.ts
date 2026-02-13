#!/usr/bin/env bun
/**
 * Claude Chrome Bridge — WebSocket ↔ Native Messaging bridge
 *
 * Spawns `cli.js --chrome-native-host` as child process, then bridges
 * Chrome Native Messaging protocol (4-byte LE length prefix + JSON on
 * stdin/stdout) to a WebSocket server on ws://127.0.0.1:18963.
 *
 * This allows an Edge Android extension (or any WS client) to act as
 * the Chrome extension that normally communicates via Native Messaging.
 *
 * Architecture:
 *   Edge ext ←WS→ bridge ←stdio→ native host ←unix socket→ MCP server ←→ Claude
 */

import { spawn, type Subprocess } from "bun";
import { resolve, dirname } from "path";
import { existsSync } from "fs";

// --- Configuration -----------------------------------------------------------

const WS_PORT = parseInt(process.env.BRIDGE_PORT ?? "18963", 10);
const WS_HOST = "127.0.0.1"; // localhost only for security
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN ?? ""; // optional shared secret
const MAX_MESSAGE_SIZE = 1_048_576; // 1 MiB, matches cli.js zmA constant
const RECONNECT_DELAY_MS = 2_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

// Resolve cli.js path — check repo copy first, then bun global install
const REPO_CLI = resolve(import.meta.dir, "cli.js");
const GLOBAL_CLI = resolve(
  process.env.HOME ?? "~",
  ".bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js"
);
const CLI_PATH = existsSync(REPO_CLI) ? REPO_CLI : GLOBAL_CLI;

// Resolve bun binary — process.execPath returns the glibc loader on Termux,
// so we resolve from PATH via which, or fall back to known locations.
function findBun(): string {
  const candidates = [
    resolve(process.env.HOME ?? "~", ".bun/bin/bun"),
    "/data/data/com.termux/files/home/.bun/bin/bun",
    "/usr/local/bin/bun",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "bun"; // hope it's in PATH
}
const BUN_PATH = findBun();

// --- Logging -----------------------------------------------------------------

type LogLevel = "debug" | "info" | "warn" | "error";
const LOG_LEVEL: LogLevel = (process.env.BRIDGE_LOG_LEVEL as LogLevel) ?? "info";
const LOG_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level: LogLevel, msg: string, ...args: unknown[]): void {
  if (LOG_PRIORITY[level] < LOG_PRIORITY[LOG_LEVEL]) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [bridge:${level}]`;
  if (level === "error") console.error(prefix, msg, ...args);
  else console.log(prefix, msg, ...args);
}

// --- Native Messaging Protocol -----------------------------------------------

/** Encode a JSON string into native messaging format (4-byte LE length + UTF-8) */
function encodeNativeMessage(json: string): Buffer {
  const body = Buffer.from(json, "utf-8");
  if (body.length > MAX_MESSAGE_SIZE) {
    throw new Error(`Message too large: ${body.length} > ${MAX_MESSAGE_SIZE}`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Stateful decoder for native messaging protocol.
 * Feed chunks via append(), collect parsed JSON strings via drain().
 */
class NativeMessageDecoder {
  private buffer = Buffer.alloc(0);

  append(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  /** Drain all complete messages from the buffer */
  drain(): string[] {
    const messages: string[] = [];
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32LE(0);
      if (len === 0 || len > MAX_MESSAGE_SIZE) {
        log("error", `Invalid native message length: ${len}, discarding buffer`);
        this.buffer = Buffer.alloc(0);
        break;
      }
      if (this.buffer.length < 4 + len) break; // incomplete message
      const body = this.buffer.subarray(4, 4 + len);
      this.buffer = this.buffer.subarray(4 + len);
      messages.push(body.toString("utf-8"));
    }
    return messages;
  }
}

// --- Child Process Management ------------------------------------------------

let nativeHost: Subprocess | null = null;
const stdoutDecoder = new NativeMessageDecoder();

// Track connected WebSocket clients
const wsClients = new Set<import("bun").ServerWebSocket<{ authenticated: boolean }>>();

function spawnNativeHost(): void {
  if (nativeHost) {
    log("warn", "Native host already running, killing first");
    nativeHost.kill();
    nativeHost = null;
  }

  log("info", `Spawning native host: ${BUN_PATH} ${CLI_PATH} --chrome-native-host`);

  nativeHost = spawn({
    cmd: [BUN_PATH, CLI_PATH, "--chrome-native-host"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // Ensure CFC is enabled
      CLAUDE_CODE_ENABLE_CFC: "true",
    },
  });

  // Read stdout — native messaging protocol
  const readStdout = async () => {
    if (!nativeHost?.stdout) return;
    const reader = nativeHost.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stdoutDecoder.append(Buffer.from(value));
        for (const json of stdoutDecoder.drain()) {
          handleNativeMessage(json);
        }
      }
    } catch (err) {
      log("error", "stdout read error:", err);
    }
    log("info", "Native host stdout closed");
  };

  // Read stderr for logging
  const readStderr = async () => {
    if (!nativeHost?.stderr) return;
    const reader = nativeHost.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split("\n").filter(Boolean)) {
          log("debug", `[native-host] ${line}`);
        }
      }
    } catch (err) {
      log("error", "stderr read error:", err);
    }
  };

  readStdout();
  readStderr();

  // Handle process exit
  nativeHost.exited.then((code) => {
    log("warn", `Native host exited with code ${code}`);
    nativeHost = null;
    // Auto-restart if we still have clients
    if (wsClients.size > 0) {
      log("info", `Restarting native host in ${RECONNECT_DELAY_MS}ms (${wsClients.size} clients connected)`);
      setTimeout(spawnNativeHost, RECONNECT_DELAY_MS);
    }
  });
}

/** Forward a message from the native host to all connected WS clients */
function handleNativeMessage(json: string): void {
  log("debug", `native→ws: ${json.slice(0, 200)}`);
  for (const ws of wsClients) {
    try {
      ws.send(json);
    } catch (err) {
      log("error", "Failed to send to WS client:", err);
    }
  }
}

/** Forward a message from a WS client to the native host's stdin */
function sendToNativeHost(json: string): boolean {
  if (!nativeHost?.stdin) {
    log("error", "Cannot send to native host: not running or stdin closed");
    return false;
  }
  try {
    const encoded = encodeNativeMessage(json);
    nativeHost.stdin.write(encoded);
    log("debug", `ws→native: ${json.slice(0, 200)}`);
    return true;
  } catch (err) {
    log("error", "Failed to write to native host stdin:", err);
    return false;
  }
}

// --- WebSocket Server --------------------------------------------------------

type WsData = { authenticated: boolean };

const server = Bun.serve<WsData>({
  hostname: WS_HOST,
  port: WS_PORT,

  fetch(req, server) {
    const url = new URL(req.url);

    // Health check endpoint
    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          nativeHost: nativeHost !== null,
          clients: wsClients.size,
          uptime: process.uptime(),
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // WebSocket upgrade
    if (url.pathname === "/ws" || url.pathname === "/") {
      // Token auth check (if configured)
      if (BRIDGE_TOKEN) {
        const token =
          url.searchParams.get("token") ??
          req.headers.get("x-bridge-token") ??
          "";
        if (token !== BRIDGE_TOKEN) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      const success = server.upgrade(req, {
        data: { authenticated: true },
      });
      if (success) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      log("info", `WS client connected (total: ${wsClients.size + 1})`);
      wsClients.add(ws);

      // Spawn native host on first connection
      if (!nativeHost) {
        spawnNativeHost();
      }

      // Send initial status
      ws.send(
        JSON.stringify({
          type: "bridge_connected",
          version: "1.0.0",
          nativeHost: nativeHost !== null,
        })
      );
    },

    message(ws, message) {
      const json = typeof message === "string" ? message : Buffer.from(message).toString("utf-8");

      try {
        // Validate it's proper JSON
        const parsed = JSON.parse(json);
        log("debug", `WS message type: ${parsed.type}`);

        // Forward to native host
        if (!sendToNativeHost(json)) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Native host not available",
            })
          );
        }
      } catch (err) {
        log("error", "Invalid JSON from WS client:", err);
        ws.send(
          JSON.stringify({
            type: "error",
            error: "Invalid JSON message",
          })
        );
      }
    },

    close(ws) {
      wsClients.delete(ws);
      log("info", `WS client disconnected (remaining: ${wsClients.size})`);

      // Shut down native host if no clients
      if (wsClients.size === 0 && nativeHost) {
        log("info", "No clients remaining, stopping native host in 30s");
        setTimeout(() => {
          if (wsClients.size === 0 && nativeHost) {
            log("info", "Stopping native host (no clients)");
            nativeHost.kill();
            nativeHost = null;
          }
        }, 30_000);
      }
    },

    maxPayloadLength: MAX_MESSAGE_SIZE,
    idleTimeout: 120, // seconds
  },
});

// --- Heartbeat ---------------------------------------------------------------

setInterval(() => {
  for (const ws of wsClients) {
    try {
      ws.send(JSON.stringify({ type: "heartbeat", timestamp: Date.now() }));
    } catch {
      // Client will be cleaned up via close handler
    }
  }
}, HEARTBEAT_INTERVAL_MS);

// --- Graceful Shutdown -------------------------------------------------------

function shutdown(): void {
  log("info", "Shutting down bridge...");

  // Close all WS clients
  for (const ws of wsClients) {
    try {
      ws.close(1001, "Bridge shutting down");
    } catch {}
  }
  wsClients.clear();

  // Kill native host
  if (nativeHost) {
    nativeHost.kill();
    nativeHost = null;
  }

  server.stop();
  log("info", "Bridge stopped");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// --- Startup -----------------------------------------------------------------

log("info", `Claude Chrome Bridge started on ws://${WS_HOST}:${WS_PORT}`);
log("info", `CLI path: ${CLI_PATH}`);
log("info", `Auth: ${BRIDGE_TOKEN ? "token required" : "open (localhost only)"}`);
log("info", "Waiting for WebSocket connections...");
