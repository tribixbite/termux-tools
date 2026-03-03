/**
 * types.ts — All shared interfaces for the tmx orchestrator
 */

// -- Session state machine ----------------------------------------------------

/** Valid session states (see state diagram in plan) */
export type SessionStatus =
  | "pending"    // configured but not yet evaluated
  | "waiting"    // deps not yet satisfied
  | "starting"   // tmux session created, waiting for health check
  | "running"    // healthy and active
  | "degraded"   // health checks failing, may auto-restart
  | "failed"     // exceeded restart limit or explicit failure
  | "stopping"   // graceful shutdown in progress
  | "stopped";   // cleanly stopped

/** Valid state transitions */
export const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  pending:  ["waiting", "stopped"],
  waiting:  ["starting", "stopped"],
  starting: ["running", "failed", "stopping"],
  running:  ["degraded", "stopping", "stopped"],
  degraded: ["starting", "stopping", "failed"],
  failed:   ["stopping", "stopped", "pending"],
  stopping: ["stopped"],
  stopped:  ["pending"],
};

// -- Config types (parsed from TOML) ------------------------------------------

/** Session type determines startup and health check behavior */
export type SessionType = "claude" | "daemon" | "service";

/** Wake lock acquisition policy */
export type WakeLockPolicy = "always" | "active_sessions" | "boot_only" | "never";

/** Health check method */
export type HealthCheckType = "tmux_alive" | "http" | "process" | "custom";

/** Per-session health check config */
export interface HealthCheckConfig {
  check: HealthCheckType;
  /** Override global interval for this session */
  interval_s?: number;
  /** Consecutive failures before transitioning to degraded */
  unhealthy_threshold: number;
  /** HTTP endpoint for http checks */
  url?: string;
  /** Process name pattern for process checks */
  process_pattern?: string;
  /** Shell command for custom checks (exit 0 = healthy) */
  command?: string;
}

/** Per-session environment variables */
export interface SessionEnv {
  [key: string]: string;
}

/** Single session definition from config */
export interface SessionConfig {
  name: string;
  type: SessionType;
  /** Working directory (for claude/daemon types) */
  path?: string;
  /** Command to run (for service/daemon types) */
  command?: string;
  /** Auto-send "go" after startup (claude type only) */
  auto_go: boolean;
  /** Start priority — lower number starts first, used for topological tie-breaking */
  priority: number;
  /** Session names this depends on */
  depends_on: string[];
  /** Whether this session runs without a UI tab */
  headless: boolean;
  /** Per-session env vars */
  env: SessionEnv;
  /** Health check override */
  health?: HealthCheckConfig;
  /** Max restart attempts before entering failed state */
  max_restarts: number;
  /** Restart backoff base in seconds */
  restart_backoff_s: number;
  /** Whether to auto-start on boot */
  enabled: boolean;
}

/** ADB configuration block */
export interface AdbConfig {
  enabled: boolean;
  connect_script: string;
  connect_timeout_s: number;
  retry_interval_s: number;
  /** Apply phantom process killer fix */
  phantom_fix: boolean;
}

/** Top-level orchestrator config */
export interface OrchestratorConfig {
  socket: string;
  state_file: string;
  log_dir: string;
  /** Seconds between health sweeps */
  health_interval_s: number;
  /** Max seconds to wait for full boot sequence */
  boot_timeout_s: number;
  /** Android 12+ phantom process limit */
  process_budget: number;
  wake_lock_policy: WakeLockPolicy;
  /** HTTP dashboard port (0 = disabled) */
  dashboard_port: number;
  /** MemAvailable threshold for warning pressure (MB) */
  memory_warning_mb: number;
  /** MemAvailable threshold for critical pressure (MB) */
  memory_critical_mb: number;
  /** MemAvailable threshold for emergency pressure (MB) */
  memory_emergency_mb: number;
}

/** Default health check configs by session type */
export interface HealthDefaults {
  [type: string]: HealthCheckConfig;
}

/** Full parsed config file */
export interface TmxConfig {
  orchestrator: OrchestratorConfig;
  adb: AdbConfig;
  sessions: SessionConfig[];
  health_defaults: HealthDefaults;
}

// -- Runtime state (persisted to JSON) ----------------------------------------

/** Per-session runtime state */
export interface SessionState {
  name: string;
  status: SessionStatus;
  /** ISO timestamp when session entered running state */
  uptime_start: string | null;
  /** Number of restarts since last manual start */
  restart_count: number;
  /** Last error message */
  last_error: string | null;
  /** ISO timestamp of last health check */
  last_health_check: string | null;
  /** Consecutive health check failures */
  consecutive_failures: number;
  /** PID of the tmux server process (if known) */
  tmux_pid: number | null;
  /** Resident set size of session process tree in MB (from memory monitor) */
  rss_mb: number | null;
  /** CPU activity classification (from activity detector) */
  activity: "active" | "idle" | "stopped" | "unknown" | null;
}

/** Full persisted state */
export interface TmxState {
  /** ISO timestamp of daemon start */
  daemon_start: string;
  /** Whether boot sequence has completed */
  boot_complete: boolean;
  /** Whether ADB fix was applied */
  adb_fixed: boolean;
  /** Per-session states keyed by name */
  sessions: Record<string, SessionState>;
  /** Latest system memory snapshot (populated by daemon, not persisted) */
  memory?: SystemMemorySnapshot | null;
}

/** System memory snapshot stored in state (mirrors SystemMemory from memory.ts) */
export interface SystemMemorySnapshot {
  total_mb: number;
  available_mb: number;
  swap_total_mb: number;
  swap_free_mb: number;
  pressure: string;
  used_pct: number;
}

// -- IPC protocol -------------------------------------------------------------

/** Commands the CLI can send to the daemon */
export type IpcCommand =
  | { cmd: "status"; name?: string }
  | { cmd: "start"; name?: string }
  | { cmd: "stop"; name?: string }
  | { cmd: "restart"; name?: string }
  | { cmd: "health" }
  | { cmd: "boot" }
  | { cmd: "shutdown" }
  | { cmd: "go"; name: string }
  | { cmd: "send"; name: string; text: string }
  | { cmd: "tabs"; names?: string[] }
  | { cmd: "config" }
  | { cmd: "memory" };

/** Response from daemon to CLI */
export interface IpcResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

// -- Logging ------------------------------------------------------------------

/** Structured log entry */
export interface LogEntry {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  session?: string;
  [key: string]: unknown;
}

// -- Budget -------------------------------------------------------------------

/** Process budget mode */
export type BudgetMode = "normal" | "warning" | "critical";

/** Budget status snapshot */
export interface BudgetStatus {
  mode: BudgetMode;
  total_procs: number;
  budget: number;
  /** Percentage of budget used (0-100) */
  usage_pct: number;
}

// -- Health check result ------------------------------------------------------

export interface HealthResult {
  session: string;
  healthy: boolean;
  message: string;
  /** Duration of check in milliseconds */
  duration_ms: number;
}

// -- Dependency graph ---------------------------------------------------------

/** Batch of sessions that can start in parallel */
export interface DepBatch {
  /** Depth level in the dependency graph (0 = no deps) */
  depth: number;
  /** Session names in this batch */
  sessions: string[];
}
