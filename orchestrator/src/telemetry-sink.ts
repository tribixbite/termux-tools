/**
 * telemetry-sink.ts — HTTP sink server for intercepted Edge telemetry
 *
 * Listens on loopback, accepts any method/path, logs to JSONL with rotation,
 * and maintains an in-memory ring buffer for dashboard API/SSE.
 *
 * Edge's DEX patches redirect telemetry URLs to http://127.0.0.1:18971.
 * This server captures those requests, infers the originating SDK from
 * the Host header + path, and always responds 200 OK so the app doesn't retry.
 */

import * as http from "node:http";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "./log.js";
import type { TelemetrySinkConfig, TelemetryRecord, TelemetryStats, TelemetrySdk } from "./types.js";

/** SDK inference rules — checked in order, first match wins */
const SDK_RULES: Array<{ test: (host: string, path: string) => boolean; sdk: TelemetrySdk }> = [
  // Microsoft Aria / OneDS collector
  { test: (h) => h.includes("events.data.microsoft.com"), sdk: "aria" },
  { test: (h) => h.includes("browser.events.data.msn.com"), sdk: "aria" },
  { test: (_h, p) => p.includes("/OneCollector"), sdk: "onecollector" },
  { test: (h) => h.includes("self.events.data.microsoft.com"), sdk: "onecollector" },

  // Adjust attribution
  { test: (h) => h.includes("adjust.com"), sdk: "adjust" },
  { test: (_h, p) => p.includes("/adjust/"), sdk: "adjust" },

  // App Center
  { test: (h) => h.includes("appcenter.ms"), sdk: "appcenter" },
  { test: (h) => h.includes("in.appcenter.ms"), sdk: "appcenter" },

  // Edge Configuration Service
  { test: (h) => h.includes("config.edge.skype.com"), sdk: "ecs" },
  { test: (h) => h.includes("ecs."), sdk: "ecs" },

  // Vortex telemetry
  { test: (h) => h.includes("vortex.data.microsoft.com"), sdk: "vortex" },

  // Google services
  { test: (h) => h.includes("googleapis.com"), sdk: "google" },
  { test: (h) => h.includes("google-analytics.com"), sdk: "google" },
  { test: (h) => h.includes("googletagmanager.com"), sdk: "google" },

  // Microsoft Rewards
  { test: (h) => h.includes("rewardsplatform.microsoft.com"), sdk: "rewards" },

  // Edge WebXT
  { test: (h) => h.includes("webxtsvc.microsoft.com"), sdk: "webxt" },

  // Generic analytics catch-all
  { test: (_h, p) => p.includes("telemetry") || p.includes("analytics") || p.includes("collect"), sdk: "analytics" },
];

/** Infer SDK from Host header and request path */
function inferSdk(host: string, path: string): TelemetrySdk {
  const h = host.toLowerCase();
  const p = path.toLowerCase();
  for (const rule of SDK_RULES) {
    if (rule.test(h, p)) return rule.sdk;
  }
  return "unknown";
}

export class TelemetrySinkServer {
  private server: http.Server | null = null;
  private log: Logger;
  private config: TelemetrySinkConfig;
  private logDir: string;
  private logFile: string;

  /** In-memory ring buffer of recent records */
  private ring: TelemetryRecord[] = [];
  /** Total requests captured since start */
  private totalCount = 0;
  /** ISO timestamp of server start */
  private startedAt = "";
  /** Per-SDK counters */
  private sdkCounts: Record<string, number> = {};
  /** Callback for real-time SSE push */
  private onRecord: ((record: TelemetryRecord) => void) | null = null;

  constructor(config: TelemetrySinkConfig, logDir: string, log: Logger) {
    this.config = config;
    this.log = log;
    this.logDir = logDir;
    this.logFile = join(logDir, "telemetry.jsonl");

    // Ensure log directory exists
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }

  /** Register callback for newly captured records (wired to SSE by daemon) */
  onRecordCaptured(cb: (record: TelemetryRecord) => void): void {
    this.onRecord = cb;
  }

  /** Start the HTTP sink server with port retry (same pattern as DashboardServer) */
  async start(): Promise<void> {
    const maxRetries = 3;
    const retryDelay = 2000;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.tryListen();
        return;
      } catch (err: unknown) {
        const isAddrInUse = err instanceof Error && "code" in err &&
          (err as NodeJS.ErrnoException).code === "EADDRINUSE";
        if (isAddrInUse && attempt < maxRetries) {
          this.log.warn(`Telemetry sink port ${this.config.port} in use, retrying in ${retryDelay / 1000}s (${attempt}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, retryDelay));
          continue;
        }
        throw err;
      }
    }
  }

  /** Attempt to bind once */
  private tryListen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.on("error", (err) => {
        try { this.server?.close(); } catch { /* already closed */ }
        this.server = null;
        reject(err);
      });

      // Loopback only — telemetry is redirected to 127.0.0.1
      this.server.listen(this.config.port, "127.0.0.1", () => {
        this.startedAt = new Date().toISOString();
        this.log.info(`Telemetry sink listening on http://127.0.0.1:${this.config.port}`);
        resolve();
      });
    });
  }

  /** Stop the server and release the port */
  stop(): void {
    if (this.server) {
      this.server.closeAllConnections();
      this.server.close();
      this.server = null;
    }
  }

  /** Handle an incoming telemetry request — always responds 200 OK */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const chunks: Buffer[] = [];
    let bytesRead = 0;

    req.on("data", (chunk: Buffer) => {
      // Cap body read at max_body_bytes
      if (bytesRead < this.config.max_body_bytes) {
        const remaining = this.config.max_body_bytes - bytesRead;
        chunks.push(chunk.subarray(0, remaining));
      }
      bytesRead += chunk.length;
    });

    req.on("end", () => {
      // Always respond 200 to prevent app-side retries
      res.writeHead(200, {
        "Content-Type": "text/plain",
        "Content-Length": "0",
      });
      res.end();

      // Build the record
      const body = Buffer.concat(chunks).toString("utf-8");
      const host = req.headers.host ?? "";
      const path = req.url ?? "/";
      const record: TelemetryRecord = {
        ts: new Date().toISOString(),
        method: req.method ?? "GET",
        path,
        host,
        content_type: (req.headers["content-type"] as string) ?? "",
        user_agent: (req.headers["user-agent"] as string) ?? "",
        body_bytes: bytesRead,
        body_preview: body.slice(0, 512),
        sdk: inferSdk(host, path),
      };

      // Update counters
      this.totalCount++;
      this.sdkCounts[record.sdk] = (this.sdkCounts[record.sdk] ?? 0) + 1;

      // Push to ring buffer (capped)
      this.ring.push(record);
      if (this.ring.length > this.config.ring_buffer_size) {
        this.ring.shift();
      }

      // Write to JSONL log (crash-safe — no open FD)
      this.writeLog(record);

      // Notify SSE subscribers
      this.onRecord?.(record);
    });

    req.on("error", () => {
      // Client disconnected — nothing to do
      res.writeHead(200);
      res.end();
    });
  }

  /** Append record to JSONL file with rotation */
  private writeLog(record: TelemetryRecord): void {
    try {
      this.rotateIfNeeded();
      appendFileSync(this.logFile, JSON.stringify(record) + "\n");
    } catch {
      // Log write failure is non-fatal
    }
  }

  /** Rotate JSONL when it exceeds rotate_at_bytes */
  private rotateIfNeeded(): void {
    try {
      if (!existsSync(this.logFile)) return;
      const { size } = statSync(this.logFile);
      if (size < this.config.rotate_at_bytes) return;

      // Keep up to 3 rotated files
      for (let i = 2; i >= 1; i--) {
        const from = `${this.logFile}.${i}`;
        const to = `${this.logFile}.${i + 1}`;
        if (existsSync(from)) renameSync(from, to);
      }
      renameSync(this.logFile, `${this.logFile}.1`);
    } catch {
      // Rotation failure is non-fatal
    }
  }

  /** Get recent records from the ring buffer, optionally filtered by SDK */
  getRecent(limit = 100, sdkFilter?: TelemetrySdk): TelemetryRecord[] {
    let records = this.ring;
    if (sdkFilter) {
      records = records.filter((r) => r.sdk === sdkFilter);
    }
    return records.slice(-limit);
  }

  /** Get aggregated stats */
  getStats(): TelemetryStats {
    // Calculate per-hour rate
    const elapsedMs = this.startedAt
      ? Date.now() - new Date(this.startedAt).getTime()
      : 1;
    const elapsedHours = Math.max(elapsedMs / 3_600_000, 1 / 60); // min 1 minute
    const perHour = Math.round((this.totalCount / elapsedHours) * 10) / 10;

    return {
      total: this.totalCount,
      per_hour: perHour,
      by_sdk: { ...this.sdkCounts } as Record<TelemetrySdk, number>,
      started_at: this.startedAt,
    };
  }
}
