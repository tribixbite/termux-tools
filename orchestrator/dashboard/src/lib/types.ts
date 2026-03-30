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
