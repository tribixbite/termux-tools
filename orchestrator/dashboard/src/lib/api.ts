/**
 * api.ts — SSE client + REST helpers for the dashboard
 *
 * Connects to /api/events for real-time updates and provides
 * fetch wrappers for REST endpoints.
 */

import type {
  DaemonStatus, MemoryResponse, LogEntry, BridgeHealth, RecentProject,
  CustomizationResponse, ScriptEntry, ProjectTokenUsage, ConversationPage,
  TimelineEvent, McpServerInfo, PromptSearchResult, DailyCost,
  NotificationRecord, GitInfo, FileEntry, FileContentResponse,
  TelemetryResponse, TelemetryRecord,
} from "./types";

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
    for (const event of ["state", "memory", "log", "connected", "conversation", "notification", "telemetry"]) {
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

/** Fetch available scripts for a session */
export async function fetchScripts(name: string): Promise<ScriptEntry[]> {
  const res = await fetch(`/api/scripts/${encodeURIComponent(name)}`);
  const data = await checkedJson<{ scripts: ScriptEntry[] }>(res);
  return data.scripts;
}

/** Run a script or ad-hoc command in a session's Termux tab */
export async function runScript(
  name: string,
  opts: { command?: string; script?: string; source?: string },
): Promise<void> {
  await checkedPost(
    `/api/run-script/${encodeURIComponent(name)}`,
    JSON.stringify(opts),
  );
}

/** Save an ad-hoc command as a reusable script */
export async function saveScript(
  name: string,
  scriptName: string,
  command: string,
): Promise<ScriptEntry> {
  const res = await fetch(`/api/save-script/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: scriptName, command }),
  });
  return checkedJson<ScriptEntry>(res);
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

/** Register projects by scanning a directory (default ~/git) */
export async function registerProjects(path?: string): Promise<{ registered: string[]; skipped: number; total: number }> {
  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: path ? JSON.stringify({ path }) : "{}",
  });
  const data = await checkedJson<{ registered: string[]; skipped: number; total: number }>(res);
  return data;
}

/** Clone a git repo and register it */
export async function cloneRepo(url: string, name?: string): Promise<{ name: string; path: string }> {
  const res = await fetch("/api/clone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, name }),
  });
  return checkedJson(res);
}

/** Create a new project directory and register it */
export async function createProject(name: string): Promise<{ name: string; path: string }> {
  const res = await fetch(`/api/create/${encodeURIComponent(name)}`, { method: "POST" });
  return checkedJson(res);
}

/** Android app info from the daemon */
export interface AppInfo {
  pkg: string;
  label: string;
  rss_mb: number;
  system: boolean;
  autostop: boolean;
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

/** Toggle auto-stop flag for an app (force-stops on memory pressure) */
export async function toggleAutoStop(pkg: string): Promise<{ pkg: string; autostop: boolean }> {
  const res = await fetch(`/api/autostop/${encodeURIComponent(pkg)}`, { method: "POST" });
  return checkedJson(res);
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

// -- Customization / Settings ------------------------------------------------

/** Fetch full customization data (MCP servers, plugins, skills, etc.) */
export async function fetchCustomization(project?: string): Promise<CustomizationResponse> {
  const url = project
    ? `/api/customization/${encodeURIComponent(project)}`
    : "/api/customization";
  const res = await fetch(url);
  return checkedJson(res);
}

/** Fetch file content for expand/edit (skills, CLAUDE.md) */
export async function fetchFileContent(filePath: string): Promise<string> {
  // Encode each path segment individually to preserve slashes
  const encoded = filePath.split("/").map(s => encodeURIComponent(s)).join("/");
  const res = await fetch(`/api/customization-file/${encoded}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json() as { content: string };
  return data.content;
}

/** Save file content (only .md files allowed) */
export async function saveFileContent(path: string, content: string): Promise<void> {
  await checkedPost("/api/customization-file", JSON.stringify({ path, content }));
}

// -- Token tracking -----------------------------------------------------------

/** Fetch token usage for all running Claude sessions */
export async function fetchTokens(): Promise<ProjectTokenUsage[]> {
  const res = await fetch("/api/tokens");
  return checkedJson(res);
}

/** Fetch token usage for a specific session */
export async function fetchSessionTokens(name: string): Promise<ProjectTokenUsage> {
  const res = await fetch(`/api/tokens/${encodeURIComponent(name)}`);
  return checkedJson(res);
}

// -- Conversation viewer ------------------------------------------------------

/** Fetch paginated conversation entries for a session */
export async function fetchConversation(
  name: string,
  opts?: { before?: string; limit?: number; session_id?: string },
): Promise<ConversationPage> {
  const params = new URLSearchParams();
  if (opts?.before) params.set("before", opts.before);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.session_id) params.set("session_id", opts.session_id);
  const qs = params.toString();
  const res = await fetch(`/api/conversation/${encodeURIComponent(name)}${qs ? `?${qs}` : ""}`);
  return checkedJson(res);
}

// -- Session timeline ---------------------------------------------------------

/** Fetch timeline events for a session */
export async function fetchTimeline(
  name: string,
  opts?: { since?: string; limit?: number },
): Promise<TimelineEvent[]> {
  const params = new URLSearchParams();
  if (opts?.since) params.set("since", opts.since);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await fetch(`/api/timeline/${encodeURIComponent(name)}${qs ? `?${qs}` : ""}`);
  return checkedJson(res);
}

// -- MCP CRUD -----------------------------------------------------------------

/** Add a new MCP server */
export async function addMcpServer(
  name: string, command: string, args?: string[], env?: Record<string, string>,
): Promise<void> {
  await checkedPost("/api/mcp", JSON.stringify({ name, command, args, env }));
}

/** Update an existing MCP server */
export async function updateMcpServer(
  name: string, config: { command?: string; args?: string[]; env?: Record<string, string> },
): Promise<void> {
  const res = await fetch(`/api/mcp/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

/** Delete an MCP server */
export async function deleteMcpServer(name: string): Promise<void> {
  const res = await fetch(`/api/mcp/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

/** Toggle MCP server enable/disable */
export async function toggleMcpServer(name: string): Promise<{ disabled: boolean }> {
  const res = await fetch(`/api/mcp/${encodeURIComponent(name)}/toggle`, { method: "POST" });
  return checkedJson(res);
}

// -- Prompt library -----------------------------------------------------------

/** Search/list prompts from history */
export async function fetchPrompts(opts?: {
  q?: string; starred?: boolean; project?: string; limit?: number; offset?: number;
}): Promise<PromptSearchResult> {
  const params = new URLSearchParams();
  if (opts?.q) params.set("q", opts.q);
  if (opts?.starred) params.set("starred", "true");
  if (opts?.project) params.set("project", opts.project);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  const qs = params.toString();
  const res = await fetch(`/api/prompts${qs ? `?${qs}` : ""}`);
  return checkedJson(res);
}

/** Star a prompt */
export async function starPrompt(id: string): Promise<void> {
  await checkedPost(`/api/prompts/${encodeURIComponent(id)}/star`);
}

/** Unstar a prompt */
export async function unstarPrompt(id: string): Promise<void> {
  const res = await fetch(`/api/prompts/${encodeURIComponent(id)}/star`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// -- Cost timeline ------------------------------------------------------------

/** Fetch daily cost aggregation */
export async function fetchCostTimeline(days = 14): Promise<DailyCost[]> {
  const res = await fetch(`/api/cost-timeline?days=${days}`);
  return checkedJson(res);
}

// -- Notification history -----------------------------------------------------

/** Fetch notification history */
export async function fetchNotifications(opts?: {
  limit?: number; since?: string;
}): Promise<NotificationRecord[]> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.since) params.set("since", opts.since);
  const qs = params.toString();
  const res = await fetch(`/api/notifications${qs ? `?${qs}` : ""}`);
  return checkedJson(res);
}

// -- Git info -----------------------------------------------------------------

/** Fetch git info for a session */
export async function fetchGitInfo(name: string): Promise<GitInfo> {
  const res = await fetch(`/api/git/${encodeURIComponent(name)}`);
  return checkedJson(res);
}

/** Fetch file tree for a session */
export async function fetchFileTree(name: string, subPath?: string): Promise<FileEntry[]> {
  const params = subPath ? `?path=${encodeURIComponent(subPath)}` : "";
  const res = await fetch(`/api/files/${encodeURIComponent(name)}${params}`);
  return checkedJson(res);
}

/** Fetch file content for a session */
export async function fetchFileContentForSession(
  name: string, filePath: string,
): Promise<FileContentResponse> {
  const res = await fetch(`/api/file-content/${encodeURIComponent(name)}?path=${encodeURIComponent(filePath)}`);
  return checkedJson(res);
}

/** Create a branch (resume session) */
export async function branchSession(
  name: string, sessionId: string,
): Promise<{ ok: boolean; name?: string }> {
  const res = await fetch(`/api/branch/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  return checkedJson(res);
}

// -- Telemetry sink -----------------------------------------------------------

/** Fetch telemetry records and stats from the sink */
export async function fetchTelemetry(opts?: {
  sdk?: string; limit?: number;
}): Promise<TelemetryResponse> {
  const params = new URLSearchParams();
  if (opts?.sdk) params.set("sdk", opts.sdk);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await fetch(`/api/telemetry${qs ? `?${qs}` : ""}`);
  return checkedJson(res);
}

/** Client-side blob download for a file */
export function downloadFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
