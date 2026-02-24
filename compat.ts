/**
 * Runtime compatibility layer — Bun ↔ Node.js
 *
 * Abstracts Bun-specific APIs so claude-chrome-bridge.ts can run on both
 * runtimes. On Bun, delegates to native APIs. On Node, uses stdlib equivalents.
 */

import { resolve } from "path";
import { access, readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import * as cp from "node:child_process";
import * as http from "node:http";
import { WebSocketServer } from "ws";

// --- Runtime detection -------------------------------------------------------

export const IS_BUN = typeof globalThis.Bun !== "undefined";

// --- File I/O ----------------------------------------------------------------

/** Check if a file exists (replaces Bun.file(path).exists()) */
export async function fileExists(path: string): Promise<boolean> {
  if (IS_BUN) {
    return Bun.file(path).exists();
  }
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Read a file as UTF-8 text (replaces Bun.file(path).text()) */
export async function readFileText(path: string): Promise<string> {
  if (IS_BUN) {
    return Bun.file(path).text();
  }
  return readFile(path, "utf-8");
}

/** Get file size in bytes (replaces Bun.file(path).size) */
export async function getFileSize(path: string): Promise<number> {
  if (IS_BUN) {
    return Bun.file(path).size;
  }
  return (await stat(path)).size;
}

/** Get a readable stream for a file (replaces Bun.file(path).stream()) */
export async function createFileStream(path: string): Promise<ReadableStream> {
  if (IS_BUN) {
    return Bun.file(path).stream();
  }
  const nodeStream = createReadStream(path);
  // Convert Node readable stream to web ReadableStream
  return Readable.toWeb(nodeStream) as ReadableStream;
}

// --- Process spawning --------------------------------------------------------

export interface SpawnResult {
  success: boolean;
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number | null;
}

export interface SpawnedProcess {
  /** Writable stdin — call .write(buffer) to send data */
  stdin: { write(data: Buffer | Uint8Array): void } | null;
  /** Readable stdout — Web ReadableStream on both runtimes */
  stdout: ReadableStream<Uint8Array> | null;
  /** Readable stderr — Web ReadableStream on both runtimes */
  stderr: ReadableStream<Uint8Array> | null;
  pid: number | undefined;
  kill(signal?: number): void;
  exited: Promise<number>;
}

/** Synchronous process spawn (replaces Bun.spawnSync()) */
export function runSync(
  cmd: string[],
  opts?: { stdout?: "pipe" | "ignore"; stderr?: "pipe" | "ignore"; stdin?: "pipe" | "ignore" }
): SpawnResult {
  if (IS_BUN) {
    const result = Bun.spawnSync({
      cmd,
      stdout: opts?.stdout ?? "pipe",
      stderr: opts?.stderr ?? "pipe",
    });
    return {
      success: result.success,
      stdout: Buffer.from(result.stdout ?? ""),
      stderr: Buffer.from(result.stderr ?? ""),
      exitCode: result.exitCode,
    };
  }
  const result = cp.spawnSync(cmd[0], cmd.slice(1), {
    stdio: [
      opts?.stdin ?? "pipe",
      opts?.stdout ?? "pipe",
      opts?.stderr ?? "pipe",
    ],
    encoding: "buffer",
  });
  return {
    success: result.status === 0,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
    exitCode: result.status,
  };
}

/** Fire-and-forget process spawn (replaces Bun.spawn with stdout/stderr ignore) */
export function runDetached(cmd: string[]): void {
  if (IS_BUN) {
    Bun.spawn({ cmd, stdout: "ignore", stderr: "ignore" });
    return;
  }
  const child = cp.spawn(cmd[0], cmd.slice(1), {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

/** Spawn a long-running child process with piped stdio (replaces spawn() from "bun") */
export function spawnProcess(
  cmd: string[],
  env?: Record<string, string | undefined>
): SpawnedProcess {
  if (IS_BUN) {
    const proc = Bun.spawn({
      cmd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: env ?? process.env,
    });
    return {
      stdin: proc.stdin,
      stdout: proc.stdout,
      stderr: proc.stderr,
      pid: proc.pid,
      kill: (sig?: number) => proc.kill(sig),
      exited: proc.exited,
    };
  }
  const child = cp.spawn(cmd[0], cmd.slice(1), {
    stdio: ["pipe", "pipe", "pipe"],
    env: env ?? process.env,
  });
  // Convert Node Readable streams to Web ReadableStreams for uniform API
  const toWebStream = (nodeStream: any): ReadableStream<Uint8Array> | null => {
    if (!nodeStream) return null;
    return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  };
  return {
    stdin: child.stdin,
    stdout: toWebStream(child.stdout),
    stderr: toWebStream(child.stderr),
    pid: child.pid,
    kill: (sig?: number) => child.kill(sig ?? "SIGTERM"),
    exited: new Promise<number>((resolve) => {
      child.on("exit", (code: number | null) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    }),
  };
}

// --- HTTP + WebSocket Server -------------------------------------------------

/** Minimal WebSocket wrapper that works on both Bun and Node (ws package) */
export interface BridgeWebSocket {
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
  data: Record<string, unknown>;
}

export interface BridgeServerConfig {
  hostname: string;
  port: number;
  /** HTTP request handler. Return undefined to signal WebSocket upgrade. */
  fetch(
    req: Request,
    upgrade: (data?: Record<string, unknown>) => boolean
  ): Response | Promise<Response> | undefined | Promise<undefined>;
  websocket: {
    open(ws: BridgeWebSocket): void;
    message(ws: BridgeWebSocket, message: string | Buffer): void;
    close(ws: BridgeWebSocket): void;
  };
  maxPayloadLength?: number;
  idleTimeout?: number;
}

export interface BridgeServer {
  stop(): void;
  port: number;
}

/** Create HTTP + WebSocket server (replaces Bun.serve()) */
export function createBridgeServer(config: BridgeServerConfig): BridgeServer {
  if (IS_BUN) {
    return createBunServer(config);
  }
  return createNodeServer(config);
}

function createBunServer(config: BridgeServerConfig): BridgeServer {
  const bunWsClients = new Map<
    import("bun").ServerWebSocket<Record<string, unknown>>,
    BridgeWebSocket
  >();

  const server = Bun.serve<Record<string, unknown>>({
    hostname: config.hostname,
    port: config.port,
    async fetch(req, server) {
      const upgrade = (data?: Record<string, unknown>) => {
        return server.upgrade(req, { data: data ?? {} });
      };
      return (await config.fetch(new Request(req.url, req), upgrade)) as any;
    },
    websocket: {
      open(bunWs) {
        const wrapper: BridgeWebSocket = {
          send: (data) => bunWs.send(data),
          close: (code, reason) => bunWs.close(code, reason),
          data: bunWs.data ?? {},
        };
        bunWsClients.set(bunWs, wrapper);
        config.websocket.open(wrapper);
      },
      message(bunWs, message) {
        const wrapper = bunWsClients.get(bunWs);
        if (!wrapper) return;
        const data =
          typeof message === "string"
            ? message
            : Buffer.from(message as ArrayBuffer);
        config.websocket.message(wrapper, data);
      },
      close(bunWs) {
        const wrapper = bunWsClients.get(bunWs);
        if (wrapper) {
          config.websocket.close(wrapper);
          bunWsClients.delete(bunWs);
        }
      },
      maxPayloadLength: config.maxPayloadLength,
      idleTimeout: config.idleTimeout,
    },
  });

  return {
    stop: () => server.stop(),
    port: server.port,
  };
}

function createNodeServer(config: BridgeServerConfig): BridgeServer {
  const wss = new WebSocketServer({ noServer: true });
  let pendingUpgradeData: Record<string, unknown> | null = null;

  const httpServer = http.createServer(
    async (
      nodeReq: import("node:http").IncomingMessage,
      nodeRes: import("node:http").ServerResponse
    ) => {
      // Collect request body for POST
      const chunks: Buffer[] = [];
      for await (const chunk of nodeReq) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks);

      // Build a Request object from Node's IncomingMessage
      const url = `http://${config.hostname}:${config.port}${nodeReq.url ?? "/"}`;
      const headers = new Headers();
      for (const [key, val] of Object.entries(nodeReq.headers)) {
        if (val) headers.set(key, Array.isArray(val) ? val.join(", ") : val);
      }
      const reqInit: RequestInit = {
        method: nodeReq.method,
        headers,
      };
      // Only attach body for methods that support it
      if (nodeReq.method !== "GET" && nodeReq.method !== "HEAD" && body.length > 0) {
        reqInit.body = body;
      }
      const request = new Request(url, reqInit);

      const upgrade = (data?: Record<string, unknown>) => {
        pendingUpgradeData = data ?? {};
        return true;
      };

      try {
        const response = await config.fetch(request, upgrade);

        // If upgrade was requested (fetch returned undefined), skip HTTP response
        if (response === undefined || pendingUpgradeData !== null) {
          // Upgrade will be handled by the "upgrade" event
          if (pendingUpgradeData === null) {
            nodeRes.writeHead(500);
            nodeRes.end("WebSocket upgrade not triggered");
          }
          return;
        }

        // Send HTTP response
        nodeRes.writeHead(response.status, Object.fromEntries(response.headers));
        const responseBody = await response.arrayBuffer();
        nodeRes.end(Buffer.from(responseBody));
      } catch (err) {
        nodeRes.writeHead(500);
        nodeRes.end("Internal Server Error");
      }
    }
  );

  // Handle WebSocket upgrades
  httpServer.on(
    "upgrade",
    (
      req: import("node:http").IncomingMessage,
      socket: import("node:net").Socket,
      head: Buffer
    ) => {
      // Run the fetch handler to check auth and get upgrade data
      const url = `http://${config.hostname}:${config.port}${req.url ?? "/"}`;
      const request = new Request(url, {
        method: req.method,
        headers: new Headers(
          Object.entries(req.headers).reduce(
            (acc, [k, v]) => {
              if (v) acc[k] = Array.isArray(v) ? v.join(", ") : v;
              return acc;
            },
            {} as Record<string, string>
          )
        ),
      });

      pendingUpgradeData = null;
      const upgradeFunc = (data?: Record<string, unknown>) => {
        pendingUpgradeData = data ?? {};
        return true;
      };

      Promise.resolve(config.fetch(request, upgradeFunc)).then((response) => {
        if (pendingUpgradeData !== null) {
          // Proceed with WebSocket upgrade
          wss.handleUpgrade(req, socket, head, (nodeWs: any) => {
            const wrapper: BridgeWebSocket = {
              send: (data: string | Buffer) => {
                if (nodeWs.readyState === 1) nodeWs.send(data);
              },
              close: (code?: number, reason?: string) =>
                nodeWs.close(code, reason),
              data: pendingUpgradeData ?? {},
            };

            nodeWs._bridgeWrapper = wrapper;
            config.websocket.open(wrapper);

            nodeWs.on("message", (msg: Buffer | string) => {
              const data = typeof msg === "string" ? msg : Buffer.from(msg);
              config.websocket.message(wrapper, data);
            });

            nodeWs.on("close", () => {
              config.websocket.close(wrapper);
            });
          });
        } else {
          // Not a WebSocket upgrade, reject
          socket.destroy();
        }
      });
    }
  );

  httpServer.listen(config.port, config.hostname);

  return {
    stop: () => {
      wss.close();
      httpServer.close();
    },
    port: config.port,
  };
}
