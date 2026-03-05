/**
 * Dashboard TypeScript interfaces — mirrors daemon IPC response shapes
 */

/** Per-session state from daemon */
export interface SessionState {
  name: string;
  status: string;
  uptime_start: string | null;
  restart_count: number;
  last_error: string | null;
  last_health_check: string | null;
  consecutive_failures: number;
  tmux_pid: number | null;
  rss_mb: number | null;
  activity: "active" | "idle" | "stopped" | "unknown" | null;
  uptime: string | null;
}

/** Budget status */
export interface BudgetStatus {
  mode: string;
  total_procs: number;
  budget: number;
  usage_pct: number;
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
  budget: BudgetStatus;
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
