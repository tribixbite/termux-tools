/**
 * http.ts — HTTP server for the web dashboard
 *
 * Serves static Astro build files from dashboard/dist/ and provides a REST API
 * that mirrors IPC commands. Includes SSE endpoint for real-time state updates.
 */

import * as http from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import type { Logger } from "./log.js";

/** MIME types for static file serving */
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

/** API route handler type */
export type ApiHandler = (
  method: string,
  path: string,
  body: string,
) => Promise<{ status: number; data: unknown }>;

/** SSE client connection */
interface SseClient {
  res: http.ServerResponse;
  id: number;
}

export class DashboardServer {
  private server: http.Server | null = null;
  private log: Logger;
  private port: number;
  private staticDir: string;
  private apiHandler: ApiHandler;
  private sseClients: SseClient[] = [];
  private sseIdCounter = 0;

  constructor(port: number, staticDir: string, apiHandler: ApiHandler, log: Logger) {
    this.port = port;
    this.log = log;
    this.staticDir = staticDir;
    this.apiHandler = apiHandler;
  }

  /** Start the HTTP server, retrying if port is in TIME_WAIT from previous daemon */
  async start(): Promise<void> {
    const maxRetries = 3;
    const retryDelay = 2000;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.tryListen();
        return;
      } catch (err: unknown) {
        const isAddrInUse = err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EADDRINUSE";
        if (isAddrInUse && attempt < maxRetries) {
          this.log.warn(`Dashboard port ${this.port} in use, retrying in ${retryDelay / 1000}s (${attempt}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, retryDelay));
          continue;
        }
        throw err;
      }
    }
  }

  /** Attempt to bind the HTTP server once */
  private tryListen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.on("error", (err) => {
        this.server = null;
        reject(err);
      });

      this.server.listen(this.port, "0.0.0.0", () => {
        this.log.info(`Dashboard server listening on http://0.0.0.0:${this.port}`);
        resolve();
      });
    });
  }

  /** Stop the HTTP server, force-closing all connections to release the port */
  stop(): void {
    // Close all SSE connections
    for (const client of this.sseClients) {
      client.res.end();
    }
    this.sseClients = [];

    if (this.server) {
      // Force-close all open connections so port is released immediately
      // (prevents TIME_WAIT from blocking next daemon's bind)
      this.server.closeAllConnections();
      this.server.close();
      this.server = null;
    }
  }

  /** Push an SSE event to all connected clients */
  pushEvent(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const dead: number[] = [];

    for (const client of this.sseClients) {
      try {
        client.res.write(payload);
      } catch {
        dead.push(client.id);
      }
    }

    // Clean up disconnected clients
    if (dead.length > 0) {
      this.sseClients = this.sseClients.filter((c) => !dead.includes(c.id));
    }
  }

  /** Get number of connected SSE clients */
  get sseClientCount(): number {
    return this.sseClients.length;
  }

  // -- Request handling -------------------------------------------------------

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    // CORS headers for local development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // SSE endpoint
      if (path === "/api/events") {
        this.handleSse(req, res);
        return;
      }

      // API routes
      if (path.startsWith("/api/")) {
        await this.handleApi(req, res, path);
        return;
      }

      // Static files
      this.handleStatic(res, path);
    } catch (err) {
      this.log.error(`HTTP error: ${err}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }

  /** Handle SSE connection */
  private handleSse(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const clientId = ++this.sseIdCounter;
    const client: SseClient = { res, id: clientId };
    this.sseClients.push(client);

    this.log.debug(`SSE client connected (id=${clientId}, total=${this.sseClients.length})`);

    // Send initial ping
    res.write(`event: connected\ndata: ${JSON.stringify({ id: clientId })}\n\n`);

    // Clean up on disconnect
    req.on("close", () => {
      this.sseClients = this.sseClients.filter((c) => c.id !== clientId);
      this.log.debug(`SSE client disconnected (id=${clientId}, remaining=${this.sseClients.length})`);
    });
  }

  /** Handle API request */
  private async handleApi(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    path: string,
  ): Promise<void> {
    // Read request body for POST
    let body = "";
    if (req.method === "POST") {
      body = await new Promise<string>((resolve) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      });
    }

    const result = await this.apiHandler(req.method ?? "GET", path, body);
    res.writeHead(result.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.data));
  }

  /** Serve static files from the dashboard dist directory */
  private handleStatic(res: http.ServerResponse, urlPath: string): void {
    // Normalize path
    let filePath = urlPath === "/" ? "/index.html" : urlPath;

    // Security: prevent directory traversal
    filePath = filePath.replace(/\.\./g, "");

    let fullPath = join(this.staticDir, filePath);

    // If path is a directory (or ends with /), look for index.html inside it
    if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
      fullPath = join(fullPath, "index.html");
    } else if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      // Try appending /index.html for clean URLs (e.g. /memory → /memory/index.html)
      const dirIndex = join(this.staticDir, filePath, "index.html");
      if (existsSync(dirIndex) && statSync(dirIndex).isFile()) {
        fullPath = dirIndex;
      }
    }

    // Check if file exists
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      // Fallback: serve root index.html for unknown routes
      const indexPath = join(this.staticDir, "index.html");
      if (existsSync(indexPath)) {
        const content = readFileSync(indexPath);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(content);
        return;
      }

      // If no dashboard is built, serve a minimal status page
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(this.getFallbackHtml());
      return;
    }

    const ext = extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    const content = readFileSync(fullPath);

    // Cache static assets (hashed filenames) but not HTML
    const cacheControl = ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    });
    res.end(content);
  }

  /** Minimal HTML fallback when dashboard isn't built */
  private getFallbackHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>tmx dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
      background: #0d1117; color: #c9d1d9;
      padding: 1rem; max-width: 800px; margin: 0 auto;
    }
    h1 { color: #58a6ff; margin-bottom: 1rem; font-size: 1.2rem; }
    pre { background: #161b22; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; }
    .status { margin: 1rem 0; }
    .green { color: #3fb950; } .yellow { color: #d29922; } .red { color: #f85149; }
    .dim { color: #484f58; }
    #data { white-space: pre-wrap; }
    .err { color: #f85149; font-style: italic; }
  </style>
</head>
<body>
  <h1>tmx dashboard</h1>
  <p class="dim">Dashboard not built. Run: <code>cd orchestrator/dashboard && bun install && bun run build</code></p>
  <div class="status">
    <h2>Live Status</h2>
    <pre id="data">Loading...</pre>
  </div>
  <script>
    async function refresh() {
      try {
        const [status, memory] = await Promise.all([
          fetch('/api/status').then(r => r.json()),
          fetch('/api/memory').then(r => r.json()).catch(() => null),
        ]);
        let out = JSON.stringify(status, null, 2);
        if (memory) out += '\\n\\n--- Memory ---\\n' + JSON.stringify(memory, null, 2);
        document.getElementById('data').textContent = out;
      } catch (e) {
        document.getElementById('data').innerHTML = '<span class="err">Failed to fetch: ' + e.message + '</span>';
      }
    }
    refresh();
    setInterval(refresh, 5000);

    // SSE for real-time updates
    const es = new EventSource('/api/events');
    es.addEventListener('state', () => refresh());
    es.addEventListener('memory', () => refresh());
  </script>
</body>
</html>`;
  }
}
