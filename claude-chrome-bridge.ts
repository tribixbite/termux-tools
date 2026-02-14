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
import { inflateSync, deflateSync } from "node:zlib";
// --- Configuration -----------------------------------------------------------

// Read version from extension manifest — single source of truth
const MANIFEST_PATH = resolve(import.meta.dir, "edge-claude-ext/manifest.json");
const BRIDGE_VERSION: string = await (async () => {
  try {
    const manifest = JSON.parse(await Bun.file(MANIFEST_PATH).text());
    return manifest.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
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
const CLI_PATH = (await Bun.file(REPO_CLI).exists()) ? REPO_CLI : GLOBAL_CLI;

// Resolve bun binary — process.execPath returns the glibc loader on Termux,
// so we resolve from PATH via which, or fall back to known locations.
async function findBun(): Promise<string> {
  const candidates = [
    resolve(process.env.HOME ?? "~", ".bun/bin/bun"),
    "/data/data/com.termux/files/home/.bun/bin/bun",
    "/usr/local/bin/bun",
  ];
  for (const p of candidates) {
    if (await Bun.file(p).exists()) return p;
  }
  return "bun"; // hope it's in PATH
}
const BUN_PATH = await findBun();

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

// --- CDP (Chrome DevTools Protocol) over ADB ---------------------------------

/** Port used for ADB forward to Edge's DevTools socket */
const CDP_PORT = parseInt(process.env.CDP_PORT ?? "9223", 10);
/** How often to re-check Edge PID for reconnection (ms) */
const CDP_PID_CHECK_INTERVAL_MS = 60_000;
/** CDP target cache staleness threshold (ms) */
const CDP_TARGET_CACHE_TTL_MS = 10_000;
/** CDP WebSocket message timeout (ms) */
const CDP_TIMEOUT_MS = 15_000;

/**
 * Manages CDP connection to Edge Android via ADB.
 *
 * Discovery flow:
 * 1. Get Edge PID via `adb shell pidof com.microsoft.emmx.canary`
 * 2. Forward tcp:9223 → localabstract:chrome_devtools_remote_<PID>
 * 3. Connect browser-level WebSocket (not page-level — page endpoints timeout for backgrounded tabs)
 * 4. Use Target.attachToTarget + Runtime.evaluate with sessionId for tab-specific JS execution
 *
 * Falls back gracefully when ADB is unavailable — extension DOM evaluator handles it.
 */
class CdpManager {
  private ws: WebSocket | null = null;
  private edgePid: number | null = null;
  private state: "disconnected" | "connecting" | "connected" = "disconnected";
  private msgId = 0;
  /** Pending CDP JSON-RPC responses keyed by message id */
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  /** Extension tabId → CDP targetId mapping */
  private tabTargetMap = new Map<number, string>();
  /** Extension tabId → URL cache (populated from tabs_context_mcp responses) */
  private tabUrlCache = new Map<number, string>();
  /** CDP targetId → sessionId for attached targets */
  private sessionMap = new Map<string, string>();
  /** Last time targets were fetched */
  private targetsLastFetched = 0;
  /** Cached CDP targets */
  private cachedTargets: Array<{ targetId: string; url: string; title: string; type: string }> = [];
  /** PID recheck interval handle */
  private pidCheckTimer: ReturnType<typeof setInterval> | null = null;
  /** Sessions where Network domain has been enabled */
  private networkEnabledSessions = new Set<string>();
  /** Network request events per sessionId */
  private networkEvents = new Map<string, Array<{ url: string; method: string; statusCode: number; type: string; timestamp: number }>>();

  /** Attempt connection — safe to call multiple times, no-op if already connected */
  async connect(): Promise<boolean> {
    if (this.state === "connected" && this.ws?.readyState === WebSocket.OPEN) return true;
    if (this.state === "connecting") return false;

    this.state = "connecting";
    try {
      // Step 1: find Edge PID
      const pidResult = Bun.spawnSync({ cmd: ["adb", "shell", "pidof", "com.microsoft.emmx.canary"] });
      const pidStr = pidResult.stdout.toString().trim().split(/\s+/)[0]; // take first PID if multiple
      if (!pidStr || pidResult.exitCode !== 0) {
        log("debug", "CDP: Edge not running or ADB unavailable");
        this.state = "disconnected";
        return false;
      }
      this.edgePid = parseInt(pidStr, 10);
      if (isNaN(this.edgePid)) {
        log("warn", `CDP: invalid PID "${pidStr}"`);
        this.state = "disconnected";
        return false;
      }

      // Step 2: set up ADB port forward
      const socketName = `chrome_devtools_remote_${this.edgePid}`;
      const fwdResult = Bun.spawnSync({
        cmd: ["adb", "forward", `tcp:${CDP_PORT}`, `localabstract:${socketName}`],
      });
      if (fwdResult.exitCode !== 0) {
        log("warn", `CDP: adb forward failed — ${fwdResult.stderr.toString().trim()}`);
        this.state = "disconnected";
        return false;
      }

      // Step 3: verify via /json/version
      const versionResp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      const versionData = await versionResp.json() as Record<string, string>;
      log("info", `CDP: Edge version — ${versionData["Browser"] ?? "unknown"}, pkg: ${versionData["Android-Package"] ?? "unknown"}`);

      // Step 4: connect browser-level WebSocket
      // Use the webSocketDebuggerUrl from /json/version, or construct it
      const wsUrl = versionData.webSocketDebuggerUrl?.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${CDP_PORT}`)
        ?? `ws://127.0.0.1:${CDP_PORT}/devtools/browser`;

      await this.connectWebSocket(wsUrl);

      // Start periodic PID recheck
      if (!this.pidCheckTimer) {
        this.pidCheckTimer = setInterval(() => this.recheckPid(), CDP_PID_CHECK_INTERVAL_MS);
      }

      this.state = "connected";
      log("info", `CDP: connected to Edge (PID ${this.edgePid}) on port ${CDP_PORT}`);
      return true;
    } catch (err) {
      log("warn", `CDP: connect failed — ${(err as Error).message}`);
      this.state = "disconnected";
      return false;
    }
  }

  /** Connect WebSocket to browser-level endpoint */
  private connectWebSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("CDP WebSocket connection timeout"));
      }, CDP_TIMEOUT_MS);

      this.ws = new WebSocket(url);

      this.ws.addEventListener("open", () => {
        clearTimeout(timeout);
        log("debug", `CDP: WebSocket open to ${url}`);
        resolve();
      });

      this.ws.addEventListener("error", (ev) => {
        clearTimeout(timeout);
        log("error", `CDP: WebSocket error`);
        reject(new Error("CDP WebSocket error"));
      });

      this.ws.addEventListener("close", () => {
        log("info", "CDP: WebSocket closed");
        this.state = "disconnected";
        this.ws = null;
        this.sessionMap.clear();
        this.tabTargetMap.clear();
      });

      this.ws.addEventListener("message", (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown> };
          if (data.id !== undefined) {
            // Response to a pending command
            const p = this.pending.get(data.id);
            if (p) {
              clearTimeout(p.timer);
              this.pending.delete(data.id);
              if (data.error) p.reject(new Error(data.error.message));
              else p.resolve(data.result);
            }
          }
          // Handle CDP events (Network responses, etc.)
          if (data.method === "Network.responseReceived") {
            const sessionId = (data as Record<string, unknown>).sessionId as string | undefined;
            if (sessionId) {
              const p = data.params as Record<string, unknown>;
              const resp = p.response as Record<string, unknown> | undefined;
              if (!this.networkEvents.has(sessionId)) this.networkEvents.set(sessionId, []);
              const buf = this.networkEvents.get(sessionId)!;
              buf.push({
                url: (resp?.url as string) ?? "",
                method: (resp?.requestMethod as string) ?? "GET",
                statusCode: (resp?.status as number) ?? 0,
                type: (p.type as string) ?? "other",
                timestamp: Date.now(),
              });
              if (buf.length > 500) buf.shift(); // ring buffer
            }
          }
        } catch {
          log("debug", "CDP: unparseable message");
        }
      });
    });
  }

  /** Send a CDP command and await its response */
  sendCommand(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("CDP not connected"));
        return;
      }

      const id = ++this.msgId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, CDP_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      const msg: Record<string, unknown> = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.ws.send(JSON.stringify(msg));
    });
  }

  /** Execute JavaScript on a specific tab via CDP */
  async evaluateJS(code: string, tabId?: number): Promise<{ result?: string; error?: string }> {
    if (!this.isAvailable()) {
      const connected = await this.connect();
      if (!connected) return { error: "CDP not available" };
    }

    try {
      // Resolve tabId to CDP targetId
      const targetId = await this.resolveTarget(tabId);
      if (!targetId) {
        return { error: `CDP: no target found for tab ${tabId ?? "active"}` };
      }

      // Attach to target if not already attached
      let sessionId = this.sessionMap.get(targetId);
      if (!sessionId) {
        const attachResult = await this.sendCommand("Target.attachToTarget", {
          targetId,
          flatten: true,
        }) as { sessionId: string };
        sessionId = attachResult.sessionId;
        this.sessionMap.set(targetId, sessionId);

        // Enable Network domain on newly attached sessions for request tracking
        if (!this.networkEnabledSessions.has(sessionId)) {
          try {
            await this.sendCommand("Network.enable", {}, sessionId);
            this.networkEnabledSessions.add(sessionId);
          } catch { /* non-critical — network tracking is best-effort */ }
        }
      }

      // Execute via Runtime.evaluate
      const evalResult = await this.sendCommand("Runtime.evaluate", {
        expression: code,
        returnByValue: true,
        awaitPromise: true,
        // Allow accessing async results
        generatePreview: false,
        userGesture: true,
      }, sessionId) as {
        result?: { type: string; value?: unknown; description?: string; subtype?: string };
        exceptionDetails?: { exception?: { description?: string }; text?: string };
      };

      if (evalResult.exceptionDetails) {
        const excMsg = evalResult.exceptionDetails.exception?.description
          ?? evalResult.exceptionDetails.text
          ?? "Unknown error";
        return { error: excMsg };
      }

      const r = evalResult.result;
      if (!r) return { result: "undefined" };

      // Format result as string
      if (r.type === "undefined") return { result: "undefined" };
      if (r.value !== undefined) return { result: JSON.stringify(r.value) };
      if (r.description) return { result: r.description };
      return { result: String(r) };
    } catch (err) {
      return { error: `CDP eval failed: ${(err as Error).message}` };
    }
  }

  /** Resolve an extension tabId to a CDP targetId by URL matching */
  private async resolveTarget(tabId?: number): Promise<string | null> {
    // Refresh target list if stale
    if (Date.now() - this.targetsLastFetched > CDP_TARGET_CACHE_TTL_MS) {
      await this.refreshTargets();
    }

    // If we have a cached mapping, use it
    if (tabId !== undefined && this.tabTargetMap.has(tabId)) {
      return this.tabTargetMap.get(tabId)!;
    }

    // Try URL matching
    if (tabId !== undefined) {
      const tabUrl = this.tabUrlCache.get(tabId);
      if (tabUrl) {
        const target = this.cachedTargets.find((t) => t.url === tabUrl && t.type === "page");
        if (target) {
          this.tabTargetMap.set(tabId, target.targetId);
          return target.targetId;
        }
      }
    }

    // Fall back to first page target (best guess for active tab)
    const firstPage = this.cachedTargets.find((t) => t.type === "page");
    return firstPage?.targetId ?? null;
  }

  /** Fetch CDP targets from /json/list endpoint */
  private async refreshTargets(): Promise<void> {
    try {
      const resp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      this.cachedTargets = (await resp.json()) as typeof this.cachedTargets;
      this.targetsLastFetched = Date.now();

      // Rebuild URL → targetId mappings
      for (const [tabId, url] of this.tabUrlCache) {
        const target = this.cachedTargets.find((t) => t.url === url && t.type === "page");
        if (target) this.tabTargetMap.set(tabId, target.targetId);
      }
    } catch (err) {
      log("debug", `CDP: refreshTargets failed — ${(err as Error).message}`);
    }
  }

  /** Cache tab URL from tabs_context_mcp responses for CDP target mapping */
  cacheTabUrl(tabId: number, url: string): void {
    this.tabUrlCache.set(tabId, url);
    // Invalidate stale target mapping
    this.tabTargetMap.delete(tabId);
  }

  /** Get buffered network requests, optionally filtered by tab/time/type */
  getNetworkRequests(tabId?: number, since?: number, typeFilter?: string): Array<{ url: string; method: string; statusCode: number; type: string; timestamp: number }> {
    // Collect events from all sessions (or the session for the given tab)
    let allEvents: Array<{ url: string; method: string; statusCode: number; type: string; timestamp: number }> = [];
    if (tabId !== undefined) {
      const targetId = this.tabTargetMap.get(tabId);
      const sessionId = targetId ? this.sessionMap.get(targetId) : undefined;
      if (sessionId) allEvents = this.networkEvents.get(sessionId) ?? [];
    } else {
      for (const events of this.networkEvents.values()) allEvents = allEvents.concat(events);
    }

    if (since) allEvents = allEvents.filter((e) => e.timestamp > since);
    if (typeFilter) allEvents = allEvents.filter((e) => e.type === typeFilter);
    return allEvents.slice(-100);
  }

  /** Resize viewport via CDP Emulation.setDeviceMetricsOverride */
  async setDeviceMetrics(width: number, height: number, tabId?: number): Promise<{ result?: string; error?: string }> {
    if (!this.isAvailable()) return { error: "CDP not available" };
    try {
      const targetId = await this.resolveTarget(tabId);
      if (!targetId) return { error: "No CDP target" };
      let sessionId = this.sessionMap.get(targetId);
      if (!sessionId) {
        const attach = await this.sendCommand("Target.attachToTarget", { targetId, flatten: true }) as { sessionId: string };
        sessionId = attach.sessionId;
        this.sessionMap.set(targetId, sessionId);
      }
      await this.sendCommand("Emulation.setDeviceMetricsOverride", {
        width, height, deviceScaleFactor: 0, mobile: true,
      }, sessionId);
      return { result: `Viewport set to ${width}×${height} via CDP Emulation` };
    } catch (err) {
      return { error: `CDP resize failed: ${(err as Error).message}` };
    }
  }

  /** Check if CDP is connected and ready */
  isAvailable(): boolean {
    return this.state === "connected" && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Get status info for /health endpoint */
  getStatus(): { state: string; edgePid: number | null; port: number; targets: number } {
    return {
      state: this.state,
      edgePid: this.edgePid,
      port: CDP_PORT,
      targets: this.cachedTargets.filter((t) => t.type === "page").length,
    };
  }

  /** Re-check Edge PID — reconnect if changed (Edge restarted) */
  private async recheckPid(): Promise<void> {
    try {
      const pidResult = Bun.spawnSync({ cmd: ["adb", "shell", "pidof", "com.microsoft.emmx.canary"] });
      const pidStr = pidResult.stdout.toString().trim().split(/\s+/)[0];
      const newPid = parseInt(pidStr, 10);

      if (isNaN(newPid)) {
        // Edge not running
        if (this.state === "connected") {
          log("info", "CDP: Edge no longer running, disconnecting");
          this.cleanup();
        }
        return;
      }

      if (newPid !== this.edgePid && this.state === "connected") {
        log("info", `CDP: Edge PID changed ${this.edgePid} → ${newPid}, reconnecting`);
        this.cleanup();
        await this.connect();
      }
    } catch {
      // ADB not available — ignore
    }
  }

  /** Clean up CDP connection and ADB forward */
  cleanup(): void {
    if (this.pidCheckTimer) {
      clearInterval(this.pidCheckTimer);
      this.pidCheckTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.state = "disconnected";
    this.sessionMap.clear();
    this.tabTargetMap.clear();
    this.networkEnabledSessions.clear();
    this.networkEvents.clear();
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error("CDP cleanup"));
    });
    this.pending.clear();

    // Remove ADB forward
    Bun.spawnSync({ cmd: ["adb", "forward", "--remove", `tcp:${CDP_PORT}`] });
    log("info", "CDP: cleaned up");
  }
}

/** Singleton CDP manager — lazy-connects on first use */
const cdpManager = new CdpManager();

// --- Image Processing: PNG decode/encode, GIF encode -------------------------

/** CRC32 lookup table for PNG chunk checksums */
const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crc32Table[i] = c;
}
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Paeth predictor for PNG filter reconstruction */
function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decode a base64 PNG data URL to raw RGBA pixels */
function decodePNG(dataUrl: string): { width: number; height: number; rgba: Uint8Array } {
  const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(b64, "base64");

  let offset = 8; // skip PNG signature
  let width = 0, height = 0, colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9]; // 2=RGB, 6=RGBA
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") break;
    offset += 12 + length; // 4 length + 4 type + data + 4 CRC
  }

  const raw = inflateSync(Buffer.concat(idatChunks));
  const bpp = colorType === 6 ? 4 : 3; // RGBA or RGB
  const rowBytes = width * bpp;
  const rgba = new Uint8Array(width * height * 4);
  const prevRow = new Uint8Array(rowBytes);
  const curRow = new Uint8Array(rowBytes);

  let rawIdx = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawIdx++];
    for (let x = 0; x < rowBytes; x++) {
      const rawByte = raw[rawIdx++];
      const a = x >= bpp ? curRow[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      switch (filterType) {
        case 0: curRow[x] = rawByte; break;
        case 1: curRow[x] = (rawByte + a) & 0xFF; break;
        case 2: curRow[x] = (rawByte + b) & 0xFF; break;
        case 3: curRow[x] = (rawByte + ((a + b) >> 1)) & 0xFF; break;
        case 4: curRow[x] = (rawByte + paethPredictor(a, b, c)) & 0xFF; break;
      }
    }
    // Convert scanline to RGBA
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      if (bpp === 4) {
        rgba[di] = curRow[x * 4]; rgba[di + 1] = curRow[x * 4 + 1];
        rgba[di + 2] = curRow[x * 4 + 2]; rgba[di + 3] = curRow[x * 4 + 3];
      } else {
        rgba[di] = curRow[x * 3]; rgba[di + 1] = curRow[x * 3 + 1];
        rgba[di + 2] = curRow[x * 3 + 2]; rgba[di + 3] = 255;
      }
    }
    prevRow.set(curRow);
  }
  return { width, height, rgba };
}

/** Encode RGBA pixels to a PNG buffer (filter type 0 = None, for simplicity) */
function encodePNG(rgba: Uint8Array, width: number, height: number): Buffer {
  // Build filtered scanlines: filter byte 0 + raw RGBA per row
  const rowLen = width * 4;
  const filtered = Buffer.alloc(height * (1 + rowLen));
  for (let y = 0; y < height; y++) {
    filtered[y * (1 + rowLen)] = 0; // filter type None
    filtered.set(rgba.subarray(y * rowLen, (y + 1) * rowLen), y * (1 + rowLen) + 1);
  }
  const compressed = deflateSync(filtered);

  // Helper: write a PNG chunk (type + data + CRC)
  function writeChunk(type: string, data: Buffer): Buffer {
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write(type, 4, "ascii");
    data.copy(chunk, 8);
    const crcBuf = Buffer.alloc(4 + data.length);
    crcBuf.write(type, 0, "ascii");
    data.copy(crcBuf, 4);
    chunk.writeUInt32BE(crc32(crcBuf), 8 + data.length);
    return chunk;
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  // IDAT
  const idat = writeChunk("IDAT", compressed);
  const iend = writeChunk("IEND", Buffer.alloc(0));

  // Assemble: signature + IHDR + IDAT + IEND
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, writeChunk("IHDR", ihdr), idat, iend]);
}

/** Scale RGBA pixels down by nearest-neighbor */
function scalePixels(rgba: Uint8Array, srcW: number, srcH: number, maxW: number): { rgba: Uint8Array; width: number; height: number } {
  if (srcW <= maxW) return { rgba, width: srcW, height: srcH };
  const scale = maxW / srcW;
  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);
  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(srcH - 1, Math.floor(y / scale));
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(srcW - 1, Math.floor(x / scale));
      const si = (srcY * srcW + srcX) * 4, di = (y * dstW + x) * 4;
      out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3];
    }
  }
  return { rgba: out, width: dstW, height: dstH };
}

/** Crop RGBA pixels to a sub-rectangle */
function cropPixels(rgba: Uint8Array, srcW: number, _srcH: number, cx: number, cy: number, cw: number, ch: number): Uint8Array {
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcOff = ((cy + y) * srcW + cx) * 4;
    const dstOff = y * cw * 4;
    out.set(rgba.subarray(srcOff, srcOff + cw * 4), dstOff);
  }
  return out;
}

/** Quantize RGBA pixels to 256-color palette (uniform 6×6×6 cube = 216 entries) */
function quantizeColors(rgba: Uint8Array, width: number, height: number): { indexed: Uint8Array; palette: Uint8Array } {
  const palette = new Uint8Array(256 * 3);
  let pi = 0;
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++) {
        palette[pi * 3] = Math.round(r * 255 / 5);
        palette[pi * 3 + 1] = Math.round(g * 255 / 5);
        palette[pi * 3 + 2] = Math.round(b * 255 / 5);
        pi++;
      }
  // Fill remaining 40 entries with black
  while (pi < 256) { palette[pi * 3] = palette[pi * 3 + 1] = palette[pi * 3 + 2] = 0; pi++; }

  const total = width * height;
  const indexed = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const ri = Math.min(5, Math.round(rgba[i * 4] * 5 / 255));
    const gi = Math.min(5, Math.round(rgba[i * 4 + 1] * 5 / 255));
    const bi = Math.min(5, Math.round(rgba[i * 4 + 2] * 5 / 255));
    indexed[i] = ri * 36 + gi * 6 + bi;
  }
  return { indexed, palette };
}

/** LZW encode for GIF — returns min code size byte + sub-blocks + terminator */
function lzwEncode(indexed: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const maxTableSize = 4096;

  // Trie node for fast code table lookup
  interface TrieNode { children: Map<number, TrieNode>; code: number; }
  function newRoots(): TrieNode[] {
    const roots: TrieNode[] = [];
    for (let i = 0; i < clearCode; i++) roots[i] = { children: new Map(), code: i };
    return roots;
  }

  const output: number[] = [minCodeSize]; // first byte = min code size
  let curByte = 0, curBit = 0;
  const subBlock: number[] = [];

  function writeBits(code: number, codeSize: number): void {
    curByte |= (code << curBit);
    curBit += codeSize;
    while (curBit >= 8) {
      subBlock.push(curByte & 0xFF);
      curByte >>>= 8;
      curBit -= 8;
      if (subBlock.length === 255) {
        output.push(255, ...subBlock);
        subBlock.length = 0;
      }
    }
  }
  function flush(): void {
    if (curBit > 0) { subBlock.push(curByte & 0xFF); curByte = 0; curBit = 0; }
    if (subBlock.length > 0) { output.push(subBlock.length, ...subBlock); subBlock.length = 0; }
  }

  let roots = newRoots();
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;

  writeBits(clearCode, codeSize);
  if (indexed.length === 0) { writeBits(eoiCode, codeSize); flush(); output.push(0); return new Uint8Array(output); }

  let node = roots[indexed[0]];
  for (let i = 1; i < indexed.length; i++) {
    const pixel = indexed[i];
    const child = node.children.get(pixel);
    if (child) { node = child; continue; }

    // Output code for current sequence
    writeBits(node.code, codeSize);

    // Add new entry
    if (nextCode < maxTableSize) {
      node.children.set(pixel, { children: new Map(), code: nextCode++ });
      if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      // Table full — reset
      writeBits(clearCode, codeSize);
      roots = newRoots();
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
    }
    node = roots[pixel];
  }

  writeBits(node.code, codeSize);
  writeBits(eoiCode, codeSize);
  flush();
  output.push(0); // block terminator
  return new Uint8Array(output);
}

/** Encode multiple RGBA frames as animated GIF89a */
function encodeGIF(
  frames: Array<{ rgba: Uint8Array; width: number; height: number }>,
  delayMs: number,
): Uint8Array {
  if (frames.length === 0) return new Uint8Array(0);
  const { width, height } = frames[0];
  const delay = Math.max(2, Math.round(delayMs / 10)); // centiseconds, min 20ms

  // Use palette from first frame (global color table)
  const { palette } = quantizeColors(frames[0].rgba, width, height);

  const chunks: Uint8Array[] = [];

  // GIF89a header
  chunks.push(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]));

  // Logical Screen Descriptor
  const lsd = new Uint8Array(7);
  lsd[0] = width & 0xFF; lsd[1] = (width >> 8) & 0xFF;
  lsd[2] = height & 0xFF; lsd[3] = (height >> 8) & 0xFF;
  lsd[4] = 0xF7; // GCT: 256 entries, 8-bit color
  chunks.push(lsd);

  // Global Color Table (256 × 3 = 768 bytes)
  chunks.push(palette);

  // NETSCAPE2.0 looping extension
  chunks.push(new Uint8Array([
    0x21, 0xFF, 0x0B,
    0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30, // "NETSCAPE2.0"
    0x03, 0x01, 0x00, 0x00, // loop forever
    0x00, // block terminator
  ]));

  for (const frame of frames) {
    const { indexed } = quantizeColors(frame.rgba, width, height);

    // Graphic Control Extension (delay between frames)
    chunks.push(new Uint8Array([
      0x21, 0xF9, 0x04, 0x00,
      delay & 0xFF, (delay >> 8) & 0xFF,
      0x00, 0x00,
    ]));

    // Image Descriptor
    const desc = new Uint8Array(10);
    desc[0] = 0x2C; // separator
    desc[5] = width & 0xFF; desc[6] = (width >> 8) & 0xFF;
    desc[7] = height & 0xFF; desc[8] = (height >> 8) & 0xFF;
    chunks.push(desc);

    // LZW compressed pixel data
    chunks.push(lzwEncode(indexed, 8));
  }

  chunks.push(new Uint8Array([0x3B])); // trailer

  let total = 0;
  for (const c of chunks) total += c.length;
  const result = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { result.set(c, off); off += c.length; }
  return result;
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
      // Termux has no USER set — os.userInfo().username may return "unknown",
      // creating a socket dir mismatch vs the MCP server. Force it.
      USER: process.env.USER || Bun.spawnSync({ cmd: ["id", "-un"] }).stdout.toString().trim() || "u0_a364",
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

  // Unwrap execute_tool: native host sends {type: "tool_request", method: "execute_tool",
  // params: {client_id, tool, args}} but the extension expects the actual tool name as
  // `method` (e.g. "tabs_context_mcp") with the tool's own args as `params`.
  let outJson = json;
  try {
    const parsed = JSON.parse(json);
    if (parsed.type === "tool_request" && parsed.method === "execute_tool" && parsed.params?.tool) {
      parsed.method = parsed.params.tool;
      parsed.params = parsed.params.args ?? {};
      outJson = JSON.stringify(parsed);
      log("debug", `Unwrapped execute_tool → ${parsed.method}`);
    }

    // CDP intercept: handle javascript_tool via CDP when available.
    // CDP bypasses MV3 CSP limitations — full eval, async/await, fetch, etc.
    if (parsed.type === "tool_request" && parsed.method === "javascript_tool" && cdpManager.isAvailable()) {
      const code = parsed.params?.text ?? "";
      const tabId = parsed.params?.tabId as number | undefined;
      log("info", `CDP: intercepting javascript_tool (${code.slice(0, 80)})`);

      cdpManager.evaluateJS(code, tabId).then((cdpResult) => {
        const response = JSON.stringify({ type: "tool_response", result: cdpResult });
        log("debug", `CDP→native: ${response.slice(0, 200)}`);
        sendToNativeHost(response);
      }).catch((err) => {
        // CDP failed — fall through to extension DOM evaluator
        log("warn", `CDP eval failed, forwarding to extension: ${(err as Error).message}`);
        for (const client of wsClients) {
          try { client.send(outJson); } catch {}
        }
      });
      return; // CDP is handling this — don't forward to extension
    }

    // CDP intercept: resize_window via Emulation.setDeviceMetricsOverride
    if (parsed.type === "tool_request" && parsed.method === "resize_window" && cdpManager.isAvailable()) {
      const { width, height } = (parsed.params ?? {}) as { width?: number; height?: number };
      if (width && height) {
        log("info", `CDP: intercepting resize_window (${width}×${height})`);
        cdpManager.setDeviceMetrics(width, height, parsed.params?.tabId as number | undefined).then((r) => {
          sendToNativeHost(JSON.stringify({ type: "tool_response", result: r }));
        }).catch(() => {
          for (const client of wsClients) { try { client.send(outJson); } catch {} }
        });
        return;
      }
    }

    // CDP intercept: read_network_requests from CDP Network domain buffer
    if (parsed.type === "tool_request" && parsed.method === "read_network_requests" && cdpManager.isAvailable()) {
      const tabId = parsed.params?.tabId as number | undefined;
      const since = parsed.params?.since as number | undefined;
      const typeFilter = parsed.params?.type_filter as string | undefined;
      const cdpRequests = cdpManager.getNetworkRequests(tabId, since, typeFilter);
      if (cdpRequests.length > 0) {
        log("info", `CDP: returning ${cdpRequests.length} network requests`);
        sendToNativeHost(JSON.stringify({
          type: "tool_response",
          result: { result: cdpRequests, count: cdpRequests.length, source: "cdp" },
        }));
        return;
      }
      // No CDP data yet — fall through to extension's webRequest tracking
    }
  } catch {
    // If parse fails, forward as-is
  }

  for (const ws of wsClients) {
    try {
      ws.send(outJson);
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

  async fetch(req, server) {
    const url = new URL(req.url);

    // Health check endpoint
    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          version: BRIDGE_VERSION,
          nativeHost: nativeHost !== null,
          clients: wsClients.size,
          uptime: process.uptime(),
          cdp: cdpManager.getStatus(),
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // GIF encoding endpoint — accepts JSON {frames: [{data, ts}], delay?, maxWidth?}
    if (url.pathname === "/gif" && req.method === "POST") {
      try {
        const body = await req.json() as { frames: Array<{ data: string }>; delay?: number; maxWidth?: number };
        const maxW = body.maxWidth ?? 480;
        const delayMs = body.delay ?? 500;
        log("info", `GIF: encoding ${body.frames.length} frames (maxW=${maxW}, delay=${delayMs}ms)`);

        const decodedFrames: Array<{ rgba: Uint8Array; width: number; height: number }> = [];
        for (const frame of body.frames) {
          const { width, height, rgba } = decodePNG(frame.data);
          const scaled = scalePixels(rgba, width, height, maxW);
          decodedFrames.push(scaled);
        }

        const gifBytes = encodeGIF(decodedFrames, delayMs);
        const gifB64 = Buffer.from(gifBytes).toString("base64");
        log("info", `GIF: encoded ${Math.round(gifBytes.length / 1024)}KB`);

        return new Response(
          JSON.stringify({ gif: `data:image/gif;base64,${gifB64}`, size: gifBytes.length }),
          { headers: { "Content-Type": "application/json" } },
        );
      } catch (err) {
        log("error", `GIF encode failed: ${(err as Error).message}`);
        return new Response(
          JSON.stringify({ error: (err as Error).message }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    // Image crop endpoint — accepts JSON {image: dataUrl, crop: {x,y,width,height}}
    if (url.pathname === "/crop" && req.method === "POST") {
      try {
        const body = await req.json() as { image: string; crop: { x: number; y: number; width: number; height: number } };
        const { width, height, rgba } = decodePNG(body.image);
        const { x: cx, y: cy, width: cw, height: ch } = body.crop;

        // Clamp crop to image bounds
        const clampX = Math.max(0, Math.min(cx, width - 1));
        const clampY = Math.max(0, Math.min(cy, height - 1));
        const clampW = Math.min(cw, width - clampX);
        const clampH = Math.min(ch, height - clampY);

        const croppedRGBA = cropPixels(rgba, width, height, clampX, clampY, clampW, clampH);
        const pngBuf = encodePNG(croppedRGBA, clampW, clampH);
        const pngB64 = pngBuf.toString("base64");

        return new Response(
          JSON.stringify({ image: `data:image/png;base64,${pngB64}` }),
          { headers: { "Content-Type": "application/json" } },
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: (err as Error).message }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    // Test page — a proper HTML page for CFC tool testing
    if (url.pathname === "/test") {
      return new Response(TEST_PAGE_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
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
          version: BRIDGE_VERSION,
          nativeHost: nativeHost !== null,
        })
      );
    },

    message(ws, message) {
      const json = typeof message === "string" ? message : Buffer.from(message).toString("utf-8");

      try {
        const parsed = JSON.parse(json);
        log("debug", `WS message type: ${parsed.type}`);

        // Cache tab URLs from tabs_context_mcp responses for CDP target mapping
        if (parsed.type === "tool_response" && parsed.result?.result?.tabs) {
          for (const tab of parsed.result.result.tabs) {
            if (tab.id && tab.url) {
              cdpManager.cacheTabUrl(tab.id, tab.url);
            }
          }
        }

        // Fix tool_response: strip `method` field so cli.js response classifier
        // (j7z: "result" in A || "error" in A) matches before the notification
        // classifier (M7z: "method" in A). Without this, responses are
        // misclassified as notifications and the tool call times out.
        if (parsed.type === "tool_response" && "method" in parsed) {
          delete parsed.method;
          const fixed = JSON.stringify(parsed);
          log("debug", `Stripped method from tool_response: ${fixed.slice(0, 200)}`);
          if (!sendToNativeHost(fixed)) {
            ws.send(JSON.stringify({ type: "error", error: "Native host not available" }));
          }
          return;
        }

        // Forward to native host as-is
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

  // Clean up CDP connection and ADB forward
  cdpManager.cleanup();

  server.stop();
  log("info", "Bridge stopped");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// --- Startup -----------------------------------------------------------------

log("info", `Claude Chrome Bridge v${BRIDGE_VERSION} started on ws://${WS_HOST}:${WS_PORT}`);
log("info", `CLI path: ${CLI_PATH}`);
log("info", `Auth: ${BRIDGE_TOKEN ? "token required" : "open (localhost only)"}`);

// Attempt CDP connection on startup (non-blocking — CDP is optional)
cdpManager.connect().then((ok) => {
  if (ok) log("info", `CDP: ready (${JSON.stringify(cdpManager.getStatus())})`);
  else log("info", "CDP: not available (ADB/Edge not running — will use extension fallback)");
});

log("info", "Waiting for WebSocket connections...");

// --- Test page HTML ----------------------------------------------------------

const TEST_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CFC Bridge Test Page</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,system-ui,sans-serif;padding:20px;min-height:100vh}
  h1{font-size:20px;color:#f0f6fc;margin-bottom:4px}
  .sub{font-size:12px;color:#8b949e;margin-bottom:20px}
  .card{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:14px;margin-bottom:12px}
  .card h2{font-size:14px;color:#58a6ff;margin-bottom:8px}
  label{display:block;font-size:12px;color:#8b949e;margin-bottom:4px}
  input,select,textarea{width:100%;padding:8px 10px;border-radius:6px;border:1px solid #30363d;background:#0d1117;color:#c9d1d9;font-size:13px;margin-bottom:8px;font-family:inherit}
  textarea{min-height:60px;resize:vertical}
  button{padding:8px 16px;border-radius:6px;border:1px solid #30363d;background:#21262d;color:#c9d1d9;font-size:12px;cursor:pointer;margin-right:6px;margin-bottom:6px}
  button:hover{background:#30363d}
  button.primary{background:#238636;border-color:#2ea043;color:#fff}
  .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
  .badge.green{background:#23863633;color:#3fb950}
  .badge.blue{background:#388bfd33;color:#58a6ff}
  .badge.yellow{background:#d2992233;color:#d29922}
  #output{font-family:"SF Mono",monospace;font-size:11px;background:#010409;border:1px solid #21262d;border-radius:6px;padding:10px;max-height:200px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;color:#7ee787}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .grid .card{margin-bottom:0}
  .stat{font-size:24px;font-weight:700;color:#f0f6fc;font-family:monospace}
  .stat-label{font-size:10px;color:#8b949e;text-transform:uppercase}
  a{color:#58a6ff;text-decoration:none}
  a:hover{text-decoration:underline}
</style>
</head>
<body>
<h1>CFC Bridge Test Page</h1>
<p class="sub">Interactive test surface for Claude in Chrome tools &mdash; served from bridge at 127.0.0.1:${WS_PORT}</p>

<div class="grid">
  <div class="card"><div class="stat" id="clock">--:--:--</div><div class="stat-label">Live Clock</div></div>
  <div class="card"><div class="stat" id="counter">0</div><div class="stat-label">Click Counter</div></div>
</div>

<div class="card">
  <h2>Form Elements</h2>
  <label for="name-input">Name</label>
  <input id="name-input" type="text" placeholder="Enter your name..." value="">
  <label for="email-input">Email</label>
  <input id="email-input" type="email" placeholder="user@example.com" value="">
  <label for="color-select">Favorite Color</label>
  <select id="color-select">
    <option value="">Select...</option>
    <option value="red">Red</option>
    <option value="green">Green</option>
    <option value="blue">Blue</option>
    <option value="purple">Purple</option>
  </select>
  <label for="notes-textarea">Notes</label>
  <textarea id="notes-textarea" placeholder="Type notes here..."></textarea>
  <label><input type="checkbox" id="agree-checkbox"> I agree to the terms</label>
</div>

<div class="card">
  <h2>Interactive Elements</h2>
  <button class="primary" id="btn-increment" onclick="increment()">Increment Counter</button>
  <button id="btn-reset" onclick="resetCounter()">Reset</button>
  <button id="btn-timestamp" onclick="addTimestamp()">Add Timestamp</button>
  <button id="btn-toggle" onclick="toggleTheme()">Toggle Theme</button>
  <div style="margin-top:8px">
    <span class="badge green">Connected</span>
    <span class="badge blue">v1.0</span>
    <span class="badge yellow">Test Mode</span>
  </div>
</div>

<div class="card">
  <h2>Output Console</h2>
  <div id="output">Ready for testing...</div>
</div>

<div class="card">
  <h2>Navigation Links</h2>
  <a href="#section-top" id="link-top">Back to top</a> &middot;
  <a href="http://127.0.0.1:${WS_PORT}/health" id="link-health">Bridge Health</a> &middot;
  <a href="http://127.0.0.1:${WS_PORT}/test" id="link-reload">Reload Test Page</a>
</div>

<script>
  let count = 0;
  function increment() { count++; document.getElementById('counter').textContent = count; log('Counter: ' + count); }
  function resetCounter() { count = 0; document.getElementById('counter').textContent = 0; log('Counter reset'); }
  function addTimestamp() { log('Timestamp: ' + new Date().toISOString()); }
  function toggleTheme() {
    const b = document.body;
    const isDark = b.style.background !== 'white';
    b.style.background = isDark ? 'white' : '#0d1117';
    b.style.color = isDark ? '#1a1a1a' : '#c9d1d9';
    log('Theme: ' + (isDark ? 'light' : 'dark'));
  }
  function log(msg) {
    const el = document.getElementById('output');
    el.textContent += '\\n' + msg;
    el.scrollTop = el.scrollHeight;
  }
  setInterval(() => {
    document.getElementById('clock').textContent = new Date().toTimeString().slice(0, 8);
  }, 1000);
  document.getElementById('clock').textContent = new Date().toTimeString().slice(0, 8);
</script>
</body>
</html>`;
