/**
 * Dashboard TypeScript interfaces — mirrors daemon IPC response shapes
 */

/** Per-session state from daemon */
export interface SessionState {
  name: string;
  type: "claude" | "daemon" | "service";
  status: string;
  uptime_start: string | null;
  restart_count: number;
  last_error: string | null;
  last_health_check: string | null;
  consecutive_failures: number;
  tmux_pid: number | null;
  rss_mb: number | null;
  activity: "active" | "idle" | "stopped" | "unknown" | null;
  suspended: boolean;
  auto_suspended: boolean;
  /** Last few lines of tmux pane output */
  last_output: string | null;
  /** Claude prompt state: "working" (mid-task) or "waiting" (at prompt) */
  claude_status: "working" | "waiting" | null;
  path: string | null;
  has_build_script: boolean;
  uptime: string | null;
}

/** Phantom process count (informational — killer is disabled) */
export interface ProcessCount {
  phantom_procs: number;
}

/** System memory */
export interface SystemMemory {
  total_mb: number;
  available_mb: number;
  swap_total_mb: number;
  swap_free_mb: number;
  pressure: string;
  used_pct: number;
}

/** Full daemon status response */
export interface DaemonStatus {
  daemon_start: string;
  boot_complete: boolean;
  adb_fixed: boolean;
  procs: ProcessCount;
  wake_lock: boolean;
  memory: SystemMemory | null;
  sessions: SessionState[];
}

/** Memory command response */
export interface MemoryResponse {
  system: SystemMemory;
  sessions: Array<{
    name: string;
    rss_mb: number | null;
    activity: string | null;
  }>;
}

/** Log entry */
export interface LogEntry {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  session?: string;
  [key: string]: unknown;
}

/** CFC bridge health response */
export interface BridgeHealth {
  status: string;
  version?: string;
  clients?: number;
  uptime?: number;
  cdp?: {
    state: string;
    edgePid?: number;
    port?: number;
    targets?: number;
  };
  lastTool?: string;
  lastToolTime?: string;
  error?: string;
}

/** ADB device info */
export interface AdbDevice {
  serial: string;
  state: string;
}

/** ADB status response from daemon */
export interface AdbStatus {
  devices: AdbDevice[];
  connecting?: boolean;
}

/** Recent Claude project from history.jsonl */
export interface RecentProject {
  name: string;
  path: string;
  last_active: string;
  session_id: string;
  status: "running" | "registered" | "config" | "untracked";
}

/** Script entry from daemon's script discovery */
export interface ScriptEntry {
  name: string;        // "build-on-termux.sh", "dev", "test"
  path: string;        // absolute path (empty for package.json)
  source: "root" | "scripts" | "package.json" | "saved";
  command?: string;    // for package.json: the command value
}

// -- Customization / Settings types ------------------------------------------

/** MCP server entry from ~/.claude.json or settings.json */
export interface McpServerInfo {
  name: string;
  scope: "user" | "project";
  source: "claude-json" | "settings-json" | "mcp-json";
  command: string;
  args: string[];
  env?: Record<string, string>;
  disabled: boolean;
}

/** Installed plugin from installed_plugins.json + enabledPlugins + blocklist */
export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  author: string;
  scope: "user" | "project";
  enabled: boolean;
  blocked: boolean;
  blockReason?: string;
  version: string;
  installedAt: string;
  installPath: string;
  type: "native" | "external";
  installs?: number;
}

/** Skill file (.md) from ~/.claude/skills/ or project .claude/skills/ */
export interface SkillInfo {
  name: string;
  path: string;
  scope: "user" | "project";
  source?: string;
}

/** CLAUDE.md / MEMORY.md file reference */
export interface ClaudeMdInfo {
  label: string;
  path: string;
  scope: "user" | "project" | "memory";
}

/** Hook definition from settings.json */
export interface HookInfo {
  event: string;
  matcher: string;
  type: string;
  command: string;
  timeout?: number;
}

/** Plugin available in a marketplace */
export interface MarketplacePlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  marketplace: string;
  type: "native" | "external";
  installed: boolean;
  enabled: boolean;
  installs: number;
}

/** Marketplace sources and available plugins */
export interface MarketplaceInfo {
  sources: Array<{ name: string; repo: string; lastUpdated: string }>;
  available: MarketplacePlugin[];
}

// -- Token tracking -----------------------------------------------------------

/** Token usage for a single Claude session JSONL file */
export interface SessionTokenUsage {
  session_id: string;
  jsonl_path: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  turns: number;
  cost_usd: number;
  file_size_bytes: number;
  last_modified: string;
}

/** Aggregated token usage for a project (all JSONL files) */
export interface ProjectTokenUsage {
  name: string;
  path: string;
  sessions: SessionTokenUsage[];
  total: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    turns: number;
    cost_usd: number;
  };
}

// -- Conversation viewer ------------------------------------------------------

/** A single structured block within an assistant message */
export interface ConversationBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result";
  text?: string;
  tool_name?: string;
  tool_input?: string;
  tool_result?: string;
}

/** A single conversation entry */
export interface ConversationEntry {
  uuid: string;
  type: "user" | "assistant" | "tool_result";
  timestamp: string;
  content: string;
  blocks?: ConversationBlock[];
  usage?: { input: number; output: number; cache_read: number; cache_create: number };
  model?: string;
}

/** Paginated conversation response */
export interface ConversationPage {
  entries: ConversationEntry[];
  oldest_uuid: string | null;
  has_more: boolean;
  session_id: string;
  session_list: Array<{ id: string; last_modified: string }>;
}

// -- Session timeline ---------------------------------------------------------

/** A single event in the session timeline */
export interface TimelineEvent {
  timestamp: string;
  source: "trace" | "conversation" | "state";
  event: string;
  detail?: string;
}

// -- Prompt library -----------------------------------------------------------

/** A single prompt from history.jsonl */
export interface PromptEntry {
  id: string;
  display: string;
  timestamp: number;
  project: string;
  sessionId?: string;
  starred: boolean;
}

/** Paginated prompt search result */
export interface PromptSearchResult {
  prompts: PromptEntry[];
  total: number;
  offset: number;
  limit: number;
}

// -- Daily cost timeline ------------------------------------------------------

/** Aggregated cost data for a single day */
export interface DailyCost {
  date: string;
  input_cost: number;
  output_cost: number;
  cache_cost: number;
  total_cost: number;
  turns: number;
  sessions: Array<{ session_id: string; name: string; cost: number }>;
}

// -- Conversation delta (live streaming) --------------------------------------

/** New conversation entries pushed via SSE */
export interface ConversationDelta {
  session: string;
  entries: ConversationEntry[];
  session_id: string;
}

// -- Notification history -----------------------------------------------------

/** Notification types emitted by the daemon */
export type NotificationType =
  | "session_start" | "session_stop" | "session_error"
  | "battery_low" | "memory_pressure"
  | "daemon_start" | "daemon_stop";

/** A single notification record */
export interface NotificationRecord {
  id: string;
  timestamp: string;
  type: NotificationType;
  title: string;
  content: string;
  session?: string;
}

// -- Git info -----------------------------------------------------------------

/** Git repository status for a session */
export interface GitInfo {
  branch: string;
  dirty_files: string[];
  recent_commits: Array<{ hash: string; message: string }>;
}

/** File entry in a directory listing */
export interface FileEntry {
  name: string;
  type: "file" | "directory";
  size?: number;
}

/** File content response */
export interface FileContentResponse {
  content: string;
  language: string;
  size: number;
  truncated: boolean;
}

// -- Telemetry sink -----------------------------------------------------------

/** Known telemetry SDK identifiers */
export type TelemetrySdk =
  | "aria" | "onecollector" | "adjust" | "appcenter" | "ecs"
  | "analytics" | "vortex" | "google" | "rewards" | "webxt" | "unknown";

/** A single captured telemetry request */
export interface TelemetryRecord {
  ts: string;
  method: string;
  path: string;
  host: string;
  content_type: string;
  user_agent: string;
  body_bytes: number;
  body_preview: string;
  sdk: TelemetrySdk;
}

/** Aggregated telemetry stats */
export interface TelemetryStats {
  total: number;
  per_hour: number;
  by_sdk: Record<string, number>;
  started_at: string;
}

/** Full telemetry API response */
export interface TelemetryResponse {
  records: TelemetryRecord[];
  stats: TelemetryStats;
}

// -- Customization / Settings types ------------------------------------------

/** Full customization response from /api/customization */
export interface CustomizationResponse {
  mcpServers: McpServerInfo[];
  plugins: PluginInfo[];
  skills: SkillInfo[];
  claudeMds: ClaudeMdInfo[];
  hooks: HookInfo[];
  marketplace: MarketplaceInfo;
  projectPath?: string;
}
