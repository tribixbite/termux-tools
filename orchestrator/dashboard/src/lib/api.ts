/**
 * api.ts — SSE client + REST helpers for the dashboard
 *
 * Connects to /api/events for real-time updates and provides
 * fetch wrappers for REST endpoints.
 */

import type { DaemonStatus, MemoryResponse, LogEntry, BridgeHealth, RecentProject } from "./types";

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

/** Parse JSON response with HTTP status validation */
async function checkedJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** Fetch daemon status (all sessions) */
export async function fetchStatus(): Promise<DaemonStatus> {
  const res = await fetch("/api/status");
  return checkedJson(res);
}

/** Fetch memory stats */
export async function fetchMemory(): Promise<MemoryResponse> {
  const res = await fetch("/api/memory");
  return checkedJson(res);
}

/** Fetch log entries */
export async function fetchLogs(session?: string): Promise<LogEntry[]> {
  const url = session ? `/api/logs/${encodeURIComponent(session)}` : "/api/logs";
  const res = await fetch(url);
  return checkedJson(res);
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
    return checkedJson(res);
  } catch {
    // Fallback to proxy endpoint
    try {
      const res = await fetch("/api/bridge");
      return checkedJson(res);
    } catch {
      return { status: "offline", error: "Unreachable" };
    }
  }
}

/** POST with error checking — throws on non-2xx responses */
async function checkedPost(url: string, body?: string): Promise<void> {
  const opts: RequestInit = { method: "POST" };
  if (body) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = body;
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

/** Start a session */
export async function startSession(name: string): Promise<void> {
  await checkedPost(`/api/start/${encodeURIComponent(name)}`);
}

/** Stop a session */
export async function stopSession(name: string): Promise<void> {
  await checkedPost(`/api/stop/${encodeURIComponent(name)}`);
}

/** Restart a session */
export async function restartSession(name: string): Promise<void> {
  await checkedPost(`/api/restart/${encodeURIComponent(name)}`);
}

/** Send "go" to a Claude session */
export async function goSession(name: string): Promise<void> {
  await checkedPost(`/api/go/${encodeURIComponent(name)}`);
}

/** Send text to a session */
export async function sendToSession(name: string, text: string): Promise<void> {
  await checkedPost(
    `/api/send/${encodeURIComponent(name)}`,
    JSON.stringify({ text }),
  );
}

/** Open a Termux tab attached to a session */
export async function openTab(name: string): Promise<void> {
  await checkedPost(`/api/tab/${encodeURIComponent(name)}`);
}

/** Run build-on-termux.sh in a session's tmux pane */
export async function runBuild(name: string): Promise<void> {
  await checkedPost(`/api/run-build/${encodeURIComponent(name)}`);
}

/** Suspend (SIGSTOP) a session */
export async function suspendSession(name: string): Promise<void> {
  await checkedPost(`/api/suspend/${encodeURIComponent(name)}`);
}

/** Resume (SIGCONT) a session */
export async function resumeSession(name: string): Promise<void> {
  await checkedPost(`/api/resume/${encodeURIComponent(name)}`);
}

/** Fetch recent Claude projects from history */
export async function fetchRecent(): Promise<RecentProject[]> {
  const res = await fetch("/api/recent");
  return checkedJson<RecentProject[]>(res);
}

/** Open/start a session by name or path (fuzzy matched) */
export async function openSession(nameOrPath: string): Promise<void> {
  await checkedPost(`/api/open/${encodeURIComponent(nameOrPath)}`);
}

/** Close/remove a session from registry */
export async function closeSession(name: string): Promise<void> {
  await checkedPost(`/api/close/${encodeURIComponent(name)}`);
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
  return checkedJson(res);
}

/** Force-stop an Android app by package name */
export async function forceStopApp(pkg: string): Promise<void> {
  await fetch(`/api/kill/${encodeURIComponent(pkg)}`, { method: "POST" });
}

/** Fetch ADB device list */
export async function fetchAdbDevices(): Promise<import("./types").AdbDevice[]> {
  try {
    const res = await fetch("/api/adb");
    const data = await checkedJson<{ devices?: import("./types").AdbDevice[] }>(res);
    return data.devices ?? [];
  } catch {
    return [];
  }
}

/** Initiate ADB wireless connection */
export async function adbConnect(): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch("/api/adb/connect", { method: "POST" });
    return checkedJson(res);
  } catch {
    return { ok: false, message: "Request failed" };
  }
}

/** Disconnect all ADB devices */
export async function adbDisconnect(): Promise<void> {
  await fetch("/api/adb/disconnect", { method: "POST" });
}

/** Disconnect a specific ADB device by serial */
export async function adbDisconnectDevice(serial: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`/api/adb/disconnect/${encodeURIComponent(serial)}`, { method: "POST" });
    return checkedJson(res);
  } catch {
    return { ok: false, message: "Request failed" };
  }
}
