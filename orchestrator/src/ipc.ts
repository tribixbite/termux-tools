/**
 * ipc.ts — Unix socket IPC server (daemon side) and client (CLI side)
 *
 * Protocol: newline-delimited JSON over Unix domain socket.
 * CLI sends IpcCommand, daemon responds with IpcResponse.
 * Stale socket cleanup on daemon start prevents EADDRINUSE crash loops.
 */

import * as net from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import type { IpcCommand, IpcResponse } from "./types.js";
import type { Logger } from "./log.js";

/** Handler function called by the server for each incoming command */
export type IpcHandler = (cmd: IpcCommand) => Promise<IpcResponse>;

/**
 * IPC Server — listens on a Unix domain socket for CLI commands.
 * Created by the daemon process.
 */
export class IpcServer {
  private server: net.Server | null = null;
  private socketPath: string;
  private handler: IpcHandler;
  private log: Logger;

  constructor(socketPath: string, handler: IpcHandler, log: Logger) {
    this.socketPath = socketPath;
    this.handler = handler;
    this.log = log;
  }

  /** Start listening. Cleans up stale socket first. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Clean up stale socket from previous daemon (OOM kill, etc.)
      if (existsSync(this.socketPath)) {
        this.log.debug("Removing stale socket file");
        try {
          unlinkSync(this.socketPath);
        } catch (err) {
          this.log.warn(`Failed to remove stale socket: ${err}`);
        }
      }

      this.server = net.createServer((conn) => this.handleConnection(conn));

      this.server.on("error", (err) => {
        this.log.error(`IPC server error: ${err}`);
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        this.log.info(`IPC server listening on ${this.socketPath}`);
        resolve();
      });
    });
  }

  /** Handle a single client connection */
  private handleConnection(conn: net.Socket): void {
    let buffer = "";

    conn.on("data", (data) => {
      buffer += data.toString();

      // Process all complete messages (delimited by newline)
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (!line) continue;

        this.processMessage(line, conn);
      }
    });

    conn.on("error", (err) => {
      // Client disconnected — not an error
      if ((err as NodeJS.ErrnoException).code === "ECONNRESET") return;
      this.log.debug(`IPC client error: ${err}`);
    });
  }

  /** Parse and handle a single JSON message */
  private async processMessage(line: string, conn: net.Socket): Promise<void> {
    let cmd: IpcCommand;
    try {
      cmd = JSON.parse(line) as IpcCommand;
    } catch {
      this.sendResponse(conn, { ok: false, error: "Invalid JSON" });
      return;
    }

    try {
      const response = await this.handler(cmd);
      this.sendResponse(conn, response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.sendResponse(conn, { ok: false, error: msg });
    }
  }

  /** Send a response back to the client */
  private sendResponse(conn: net.Socket, response: IpcResponse): void {
    try {
      conn.write(JSON.stringify(response) + "\n");
    } catch {
      // Client may have disconnected
    }
  }

  /** Stop the server and clean up the socket file */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    try {
      if (existsSync(this.socketPath)) {
        unlinkSync(this.socketPath);
      }
    } catch {
      // Best effort cleanup
    }
    this.log.info("IPC server stopped");
  }
}

/**
 * IPC Client — connects to the daemon's Unix socket and sends commands.
 * Used by the CLI process.
 */
export class IpcClient {
  private socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  /** Check if the daemon is running (socket exists and is connectable) */
  async isRunning(): Promise<boolean> {
    if (!existsSync(this.socketPath)) return false;
    try {
      // Use a short 3s timeout — if daemon is alive it responds instantly
      const resp = await this.send({ cmd: "status" }, 3_000);
      return resp.ok;
    } catch {
      // Socket exists but connection failed — stale socket from OOM kill / crash
      try {
        unlinkSync(this.socketPath);
      } catch { /* already gone or permission issue — either way, not running */ }
      return false;
    }
  }

  /** Send a command to the daemon and return the response */
  send(cmd: IpcCommand, timeoutMs = 30_000): Promise<IpcResponse> {
    return new Promise((resolve, reject) => {
      const conn = net.createConnection(this.socketPath);
      let buffer = "";
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          conn.destroy();
          reject(new Error("IPC request timed out"));
        }
      }, timeoutMs);

      conn.on("connect", () => {
        conn.write(JSON.stringify(cmd) + "\n");
      });

      conn.on("data", (data) => {
        buffer += data.toString();
        const newlineIdx = buffer.indexOf("\n");
        if (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          clearTimeout(timer);
          resolved = true;
          conn.end();
          try {
            resolve(JSON.parse(line) as IpcResponse);
          } catch {
            reject(new Error(`Invalid response: ${line}`));
          }
        }
      });

      conn.on("error", (err) => {
        if (!resolved) {
          clearTimeout(timer);
          resolved = true;
          conn.destroy();
          reject(err);
        }
      });

      conn.on("close", () => {
        if (!resolved) {
          clearTimeout(timer);
          resolved = true;
          reject(new Error("Connection closed before response"));
        }
      });
    });
  }
}
