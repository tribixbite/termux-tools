/**
 * display-types.ts — TypeScript interfaces for CLI display data
 *
 * These types describe the shape of IPC response data used by the CLI
 * for rendering status, session details, and config tables.
 */

import type { BudgetStatus, SessionState, SessionConfig, SessionType } from "./types.js";

/** Data returned by the daemon status IPC command (all sessions) */
export interface DaemonStatusData {
  daemon_start: string;
  boot_complete: boolean;
  adb_fixed: boolean;
  budget: BudgetStatus;
  wake_lock: boolean;
  sessions: SessionSummary[];
  memory?: SystemMemorySummary | null;
}

/** Per-session row in the status table */
export interface SessionSummary extends SessionState {
  /** Human-readable uptime string (e.g. "2h 15m") */
  uptime: string | null;
  /** RSS in megabytes (from memory monitor, if available) */
  rss_mb?: number | null;
  /** Activity classification */
  activity?: "active" | "idle" | "stopped" | "unknown";
}

/** Data returned for a single session detail view */
export interface SessionDetailData {
  session: SessionState;
  config: SessionConfig | undefined;
}

/** Config session summary used by `tmx config` */
export interface ConfigSessionRow {
  name: string;
  type: SessionType;
  enabled: boolean;
  priority: number;
  auto_go: boolean;
  headless: boolean;
  depends_on: string[];
}

/** System memory summary for display */
export interface SystemMemorySummary {
  total_mb: number;
  available_mb: number;
  swap_total_mb: number;
  swap_free_mb: number;
  pressure: string;
}
