/**
 * api.ts — SSE client + REST helpers for the dashboard
 *
 * Connects to /api/events for real-time updates and provides
 * fetch wrappers for REST endpoints.
 */

import type { DaemonStatus, MemoryResponse, LogEntry, BridgeHealth } from "./types";

/** Callback type for state updates */
export type StateCallback = (data: DaemonStatus) => void;

/** SSE connection manager with auto-reconnect */
export class SseClient {
  private es: EventSource | null = null;
  private callbacks = new Map<string, Set<(data: unknown) => void>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;

  constructor() {
    this.connect();
    // Close SSE on page navigation to free the connection for the next page
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => this.close());
      window.addEventListener("pagehide", () => this.close());
    }
  }

  /** Register a callback for an event type */
  on<T = unknown>(event: string, cb: (data: T) => void): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set());
    }
    const wrapped = cb as (data: unknown) => void;
    this.callbacks.get(event)!.add(wrapped);

    // Return unsubscribe function
    return () => {
      this.callbacks.get(event)?.delete(wrapped);
    };
  }

  /** Close the connection */
  close(): void {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private connect(): void {
    this.es = new EventSource("/api/events");

    this.es.onopen = () => {
      this.reconnectDelay = 1000; // Reset backoff on successful connect
    };

    this.es.onerror = () => {
      this.es?.close();
      this.es = null;
      this.scheduleReconnect();
    };

    // Listen for known events
    for (const event of ["state", "memory", "log", "connected"]) {
      this.es.addEventListener(event, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this.emit(event, data);
        } catch {
          // Invalid JSON — ignore
        }
      });
    }
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  private emit(event: string, data: unknown): void {
    const cbs = this.callbacks.get(event);
    if (cbs) {
      for (const cb of cbs) {
        try { cb(data); } catch { /* swallow errors in callbacks */ }
      }
    }
  }
}

// -- REST helpers -----------------------------------------------------------

/** Fetch daemon status (all sessions) */
export async function fetchStatus(): Promise<DaemonStatus> {
  const res = await fetch("/api/status");
  return res.json();
}

/** Fetch memory stats */
export async function fetchMemory(): Promise<MemoryResponse> {
  const res = await fetch("/api/memory");
  return res.json();
}

/** Fetch log entries */
export async function fetchLogs(session?: string): Promise<LogEntry[]> {
  const url = session ? `/api/logs/${encodeURIComponent(session)}` : "/api/logs";
  const res = await fetch(url);
  return res.json();
}

/** Fetch CFC bridge health */
export async function fetchBridgeHealth(): Promise<BridgeHealth> {
  try {
    // Try direct bridge connection first (client-side)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("http://127.0.0.1:18963/health", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.json();
  } catch {
    // Fallback to proxy endpoint
    try {
      const res = await fetch("/api/bridge");
      return res.json();
    } catch {
      return { status: "offline", error: "Unreachable" };
    }
  }
}

/** Start a session */
export async function startSession(name: string): Promise<void> {
  await fetch(`/api/start/${encodeURIComponent(name)}`, { method: "POST" });
}

/** Stop a session */
export async function stopSession(name: string): Promise<void> {
  await fetch(`/api/stop/${encodeURIComponent(name)}`, { method: "POST" });
}

/** Restart a session */
export async function restartSession(name: string): Promise<void> {
  await fetch(`/api/restart/${encodeURIComponent(name)}`, { method: "POST" });
}

/** Send "go" to a Claude session */
export async function goSession(name: string): Promise<void> {
  await fetch(`/api/go/${encodeURIComponent(name)}`, { method: "POST" });
}

/** Send text to a session */
export async function sendToSession(name: string, text: string): Promise<void> {
  await fetch(`/api/send/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

/** Open a Termux tab attached to a session */
export async function openTab(name: string): Promise<void> {
  await fetch(`/api/tab/${encodeURIComponent(name)}`, { method: "POST" });
}

/** Android app info from the daemon */
export interface AppInfo {
  pkg: string;
  label: string;
  rss_mb: number;
  system: boolean;
}

/** Fetch list of running Android apps sorted by RSS */
export async function fetchApps(): Promise<AppInfo[]> {
  const res = await fetch("/api/processes");
  return res.json();
}

/** Force-stop an Android app by package name */
export async function forceStopApp(pkg: string): Promise<void> {
  await fetch(`/api/kill/${encodeURIComponent(pkg)}`, { method: "POST" });
}
