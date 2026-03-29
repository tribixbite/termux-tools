/**
 * state.ts — JSON state file R/W and session state transitions
 *
 * Persists restart counts, uptime timestamps, and error messages to disk.
 * For actual running status, always trust `tmux list-sessions` over persisted state.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionState, SessionStatus, SystemMemorySnapshot, BatterySnapshot, TmxState, SessionConfig } from "./types.js";
import { VALID_TRANSITIONS } from "./types.js";
import type { Logger } from "./log.js";

/** Create a fresh session state entry */
export function newSessionState(name: string): SessionState {
  return {
    name,
    status: "pending",
    uptime_start: null,
    restart_count: 0,
    last_error: null,
    last_health_check: null,
    consecutive_failures: 0,
    tmux_pid: null,
    rss_mb: null,
    activity: null,
    suspended: false,
    auto_suspended: false,
    last_output: null,
    claude_status: null,
  };
}

/** Create a fresh daemon state */
export function newDaemonState(): TmxState {
  return {
    daemon_start: new Date().toISOString(),
    boot_complete: false,
    adb_fixed: false,
    sessions: {},
  };
}

export class StateManager {
  private state: TmxState;
  private statePath: string;
  private log: Logger;

  constructor(statePath: string, log: Logger) {
    this.statePath = statePath;
    this.log = log;

    // Ensure parent directory exists
    const dir = dirname(statePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Load existing state or create fresh
    this.state = this.loadFromDisk();
  }

  /** Get the full state snapshot */
  getState(): TmxState {
    return this.state;
  }

  /** Get state for a specific session */
  getSession(name: string): SessionState | undefined {
    return this.state.sessions[name];
  }

  /** Initialize session states from config, preserving existing entries */
  initFromConfig(sessions: SessionConfig[]): void {
    for (const session of sessions) {
      if (!this.state.sessions[session.name]) {
        this.state.sessions[session.name] = newSessionState(session.name);
      }
    }
    // Remove state entries for sessions no longer in config
    for (const name of Object.keys(this.state.sessions)) {
      if (!sessions.find((s) => s.name === name)) {
        this.log.info(`Removing stale state for session '${name}'`, { session: name });
        delete this.state.sessions[name];
      }
    }
    this.persist();
  }

  /** Remove a session from state entirely */
  removeSession(name: string): void {
    if (this.state.sessions[name]) {
      delete this.state.sessions[name];
      this.persist();
    }
  }

  /** Transition a session to a new status with validation */
  transition(name: string, to: SessionStatus, error?: string): boolean {
    const session = this.state.sessions[name];
    if (!session) {
      this.log.error(`Cannot transition unknown session '${name}'`, { session: name });
      return false;
    }

    const from = session.status;
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed?.includes(to)) {
      this.log.warn(`Invalid transition ${from} → ${to} for '${name}'`, { session: name });
      return false;
    }

    session.status = to;

    // Track state-specific metadata
    switch (to) {
      case "running":
        session.uptime_start = new Date().toISOString();
        session.consecutive_failures = 0;
        session.last_error = null;
        break;
      case "starting":
        // Increment restart count if coming from degraded (auto-restart)
        if (from === "degraded") {
          session.restart_count++;
        }
        break;
      case "failed":
        session.last_error = error ?? "Unknown failure";
        session.uptime_start = null;
        break;
      case "stopped":
        session.uptime_start = null;
        break;
      case "pending":
        // Reset restart count on manual start
        session.restart_count = 0;
        session.consecutive_failures = 0;
        session.last_error = null;
        break;
    }

    this.log.info(`${name}: ${from} → ${to}${error ? ` (${error})` : ""}`, { session: name });
    this.persist();
    return true;
  }

  /** Record a health check result */
  recordHealthCheck(name: string, healthy: boolean, message?: string): void {
    const session = this.state.sessions[name];
    if (!session) return;

    session.last_health_check = new Date().toISOString();

    if (healthy) {
      session.consecutive_failures = 0;
    } else {
      session.consecutive_failures++;
      session.last_error = message ?? "Health check failed";
    }

    this.persist();
  }

  /** Mark the boot sequence as complete */
  setBootComplete(complete: boolean): void {
    this.state.boot_complete = complete;
    this.persist();
  }

  /** Mark ADB fix status */
  setAdbFixed(fixed: boolean): void {
    this.state.adb_fixed = fixed;
    this.persist();
  }

  /** Update daemon start time (e.g., on daemon restart) */
  resetDaemonStart(): void {
    this.state.daemon_start = new Date().toISOString();
    this.persist();
  }

  /** Set tmux PID for a session */
  setTmuxPid(name: string, pid: number | null): void {
    const session = this.state.sessions[name];
    if (session) {
      session.tmux_pid = pid;
      this.persist();
    }
  }

  /** Update memory/activity metrics for a session (does not persist — transient data) */
  updateSessionMetrics(
    name: string,
    rss_mb: number | null,
    activity: SessionState["activity"],
    lastOutput?: string | null,
    claudeStatus?: SessionState["claude_status"],
  ): void {
    const session = this.state.sessions[name];
    if (session) {
      session.rss_mb = rss_mb;
      session.activity = activity;
      if (lastOutput !== undefined) session.last_output = lastOutput;
      if (claudeStatus !== undefined) session.claude_status = claudeStatus;
      // Don't persist — these are ephemeral metrics updated every poll cycle
    }
  }

  /** Update system memory snapshot (transient, not persisted) */
  updateSystemMemory(memory: SystemMemorySnapshot | null): void {
    this.state.memory = memory;
  }

  /** Update battery snapshot (transient, not persisted) */
  updateBattery(battery: BatterySnapshot | null): void {
    this.state.battery = battery;
  }

  /** Mark a session as suspended (SIGSTOP'd) */
  setSuspended(name: string, suspended: boolean, auto = false): void {
    const session = this.state.sessions[name];
    if (!session) return;
    session.suspended = suspended;
    if (auto) session.auto_suspended = suspended;
    if (!suspended) session.auto_suspended = false;
    this.persist();
  }

  /** Force-set a session's status (for adoption/reconciliation) */
  forceStatus(name: string, status: SessionStatus): void {
    const session = this.state.sessions[name];
    if (!session) return;
    session.status = status;
    this.persist();
  }

  // -- Persistence ------------------------------------------------------------

  private loadFromDisk(): TmxState {
    try {
      if (existsSync(this.statePath)) {
        const content = readFileSync(this.statePath, "utf-8");
        const parsed = JSON.parse(content);
        // Validate top-level shape
        if (!parsed || typeof parsed !== "object" || !parsed.daemon_start || !parsed.sessions || typeof parsed.sessions !== "object") {
          this.log.warn("State file has invalid shape, starting fresh");
          return newDaemonState();
        }
        // Validate each session entry — drop malformed entries instead of crashing
        const validSessions: Record<string, SessionState> = {};
        for (const [name, raw] of Object.entries(parsed.sessions)) {
          const s = raw as Record<string, unknown>;
          if (s && typeof s === "object" && typeof s.status === "string" && typeof s.name === "string") {
            // Ensure numeric fields are actually numbers
            if (typeof s.restart_count !== "number") s.restart_count = 0;
            if (typeof s.consecutive_failures !== "number") s.consecutive_failures = 0;
            validSessions[name] = s as unknown as SessionState;
          } else {
            this.log.warn(`Dropping malformed session state for '${name}'`);
          }
        }
        parsed.sessions = validSessions;
        return parsed as TmxState;
      }
    } catch (err) {
      this.log.warn(`Failed to load state from ${this.statePath}, starting fresh`, {
        error: String(err),
      });
    }
    return newDaemonState();
  }

  /** Write state to disk atomically (write to .tmp then rename) */
  private persist(): void {
    try {
      const tmp = `${this.statePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state, null, 2) + "\n");
      renameSync(tmp, this.statePath);
    } catch (err) {
      this.log.error(`Failed to persist state: ${err}`);
    }
  }
}
