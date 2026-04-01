/**
 * daemon.ts — Main orchestrator daemon
 *
 * Owns the full lifecycle: config validation, dependency-ordered startup,
 * health monitoring, process budget tracking, wake lock management,
 * auto-restart with backoff, session adoption, and graceful shutdown.
 *
 * Runs as a long-lived foreground process, protected by a bash watchdog
 * loop to survive OOM kills.
 */

import { execSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, appendFileSync, writeFileSync, readFileSync, chmodSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { TmxConfig, IpcCommand, IpcResponse, SessionConfig, SessionStatus } from "./types.js";
import { loadConfig } from "./config.js";
import { Logger } from "./log.js";
import { StateManager } from "./state.js";
import { IpcServer } from "./ipc.js";
import { BudgetTracker } from "./budget.js";
import { WakeLockManager } from "./wake.js";
import { computeStartupOrder, computeShutdownOrder } from "./deps.js";
import { runHealthSweep } from "./health.js";
import { MemoryMonitor } from "./memory.js";
import { ActivityDetector } from "./activity.js";
import { BatteryMonitor } from "./battery.js";
import { Registry, parseRecentProjects, findNamedSessions, deriveName, isValidName, nextSuffix } from "./registry.js";
import type { RecentProject } from "./registry.js";
import { DashboardServer } from "./http.js";
import {
  createSession,
  sessionExists,
  listTmuxSessions,
  sendGoToSession,
  waitForClaudeReady,
  stopSession,
  sendKeys,
  createTermuxTab,
  isTmuxServerAlive,
  discoverBareClaudeSessions,
  spawnBareProcess,
  ensureTmuxLdPreload,
  bringTermuxToForeground,
  suspendSession,
  resumeSession,
  runScriptInTab,
  capturePane,
} from "./session.js";

/** Pattern indicating Claude Code is actively processing (not waiting for input).
 * "esc to interrupt" appears in the status bar only when Claude is mid-task. */
const CLAUDE_WORKING_PATTERN = /esc to interrupt/;

/** Strip ANSI escape sequences */
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
/** Lines consisting entirely of box-drawing characters (U+2500–U+257F) */
const BOX_DRAWING_RE = /^[\u2500-\u257f\s]+$/;
/** Lines that are just a bare prompt character */
const BARE_PROMPT_RE = /^\s*[❯>$%#]\s*$/;
/** CC status bar / chrome lines to filter out */
const CC_CHROME_RE = /esc to interrupt|bypass permissions|shift\+tab to cycle|press enter to send|\/help for help|to cycle|tab to navigate/i;

/**
 * Clean raw tmux capture-pane output for display.
 * Strips ANSI escapes, box-drawing separator lines, bare prompts,
 * and CC status bar chrome. Returns last N meaningful content lines.
 */
function cleanPaneOutput(raw: string, maxLines = 3): string {
  const stripped = raw.replace(ANSI_RE, "");
  const lines = stripped.split("\n");
  const meaningful: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (BOX_DRAWING_RE.test(trimmed)) continue;
    if (BARE_PROMPT_RE.test(trimmed)) continue;
    if (CC_CHROME_RE.test(trimmed)) continue;
    meaningful.push(line);
  }
  return meaningful.slice(-maxLines).join("\n");
}

/** Promise-based sleep */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Crash-safe diagnostic trace — appends a line and immediately closes the FD.
 * If the daemon gets SIGKILL'd, the last trace line shows what it was doing.
 * Uses appendFileSync so each write is atomic (no open FD left dangling).
 */
const TRACE_PATH = join(
  process.env.HOME ?? "/data/data/com.termux/files/home",
  ".local", "share", "tmx", "logs", "trace.log",
);
function trace(msg: string): void {
  try {
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    appendFileSync(TRACE_PATH, `${ts} ${msg}\n`);
  } catch {
    // Non-fatal — trace is best-effort
  }
}

/** Resolve full ADB path — bun's spawnSync can't find it via PATH symlinks */
function resolveAdbPath(): string {
  try {
    const result = spawnSync("which", ["adb"], { encoding: "utf-8", timeout: 3000 });
    if (result.stdout?.trim()) return result.stdout.trim();
  } catch { /* fall through */ }
  // Fallback to common Termux locations
  const candidates = [
    join(process.env.PREFIX ?? "/data/data/com.termux/files/usr", "bin", "adb"),
    join(process.env.HOME ?? "", "android-sdk", "platform-tools", "adb"),
  ];
  for (const p of candidates) {
    try { if (existsSync(p)) return p; } catch { /* skip */ }
  }
  return "adb"; // Last resort — hope PATH works
}

const ADB_BIN = resolveAdbPath();

/** Resolve full path for a Termux binary (bun's spawnSync can't find $PREFIX/bin via PATH) */
function resolveTermuxBin(name: string): string {
  const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
  const candidate = join(prefix, "bin", name);
  try { if (existsSync(candidate)) return candidate; } catch { /* fall through */ }
  return name;
}

/** Env for Termux:API commands — bun's glibc runner strips LD_PRELOAD needed by am/app_process */
function termuxApiEnv(): NodeJS.ProcessEnv {
  const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
  const ldPreload = join(prefix, "lib", "libtermux-exec.so");
  return { ...process.env, LD_PRELOAD: ldPreload };
}

const TERMUX_NOTIFICATION_BIN = resolveTermuxBin("termux-notification");

/**
 * Spawn a Termux:API command non-blocking with a hard kill timeout.
 * termux-notification can hang indefinitely when Termux:API service is
 * unresponsive — using spawnSync would freeze the daemon's event loop.
 */
function spawnTermuxApi(bin: string, args: string[], timeoutMs = 8000): void {
  try {
    const child = spawn(bin, args, {
      stdio: "ignore",
      env: termuxApiEnv(),
      detached: true,
    });
    // Hard kill if it hasn't exited after timeout
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }, timeoutMs);
    child.on("exit", () => clearTimeout(timer));
    child.on("error", () => clearTimeout(timer));
    // Detach so it doesn't keep the daemon alive
    child.unref();
  } catch {
    // Non-fatal
  }
}

/**
 * Send a Termux notification (non-blocking).
 * Pass an id to update an existing notification in place (prevents spam).
 */
function notify(title: string, content: string, id?: string): void {
  const args = ["--title", title, "--content", content];
  if (id) args.push("--id", id, "--alert-once");
  spawnTermuxApi(TERMUX_NOTIFICATION_BIN, args);
}

/** Send a Termux notification with arbitrary extra args (non-blocking) */
function notifyWithArgs(args: string[]): void {
  spawnTermuxApi(TERMUX_NOTIFICATION_BIN, args);
}

/** Remove a Termux notification by ID (non-blocking) */
function removeNotification(id: string): void {
  spawnTermuxApi(resolveTermuxBin("termux-notification-remove"), [id]);
}

/** Resolve this device's local IP address (for ADB self-identification) */
function resolveLocalIp(): string | null {
  try {
    const result = spawnSync("ip", ["route", "get", "1"], {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Output: "1.0.0.0 via X.X.X.X dev wlan0 src 192.168.1.100 uid 10223"
    const match = result.stdout?.match(/src\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch { /* fall through */ }
  try {
    // Fallback: ifconfig wlan0
    const result = spawnSync("ifconfig", ["wlan0"], {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const match = result.stdout?.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch { /* fall through */ }
  return null;
}

export class Daemon {
  private config: TmxConfig;
  private log: Logger;
  private state: StateManager;
  private ipc: IpcServer;
  private budget: BudgetTracker;
  private wake: WakeLockManager;
  private memory: MemoryMonitor;
  private activity: ActivityDetector;
  private battery: BatteryMonitor;
  private registry: Registry;
  private dashboard: DashboardServer | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private memoryTimer: ReturnType<typeof setInterval> | null = null;
  private batteryTimer: ReturnType<typeof setInterval> | null = null;
  private adbRetryTimer: ReturnType<typeof setInterval> | null = null;
  private registryFlushTimer: ReturnType<typeof setInterval> | null = null;
  /** Pending auto-restart timers — tracked so shutdown() can cancel them */
  private restartTimers = new Set<ReturnType<typeof setTimeout>>();
  private autoTabsTimer: ReturnType<typeof setTimeout> | null = null;
  /** PIDs of adopted bare (non-tmux) Claude sessions, keyed by session name */
  private adoptedPids = new Map<string, number>();
  /** Session names from last notification cycle — used to remove stale per-session notifications */
  private _prevNotifiedSessions: string[] = [];
  /** Content hash per session from last notification — only re-emit when changed */
  private _prevNotifContent = new Map<string, string>();
  /** Summary notification content from last cycle — skip re-emit if unchanged */
  private _prevSummaryContent = "";
  /** One-shot flag: service notifications cleaned up on first cycle */
  private _serviceNotifsCleared = false;
  private adbSerial: string | null = null;
  private adbSerialExpiry = 0;
  /** Cached local IP for ADB self-identification */
  private localIp: string | null = null;
  private localIpExpiry = 0;
  private static readonly LOCAL_IP_TTL_MS = 60_000;
  private running = false;
  /** Resolved when shutdown() completes — replaces 1s polling interval */
  private shutdownResolve: (() => void) | null = null;

  constructor(configPath?: string) {
    this.config = loadConfig(configPath);
    this.log = new Logger(this.config.orchestrator.log_dir);
    this.state = new StateManager(this.config.orchestrator.state_file, this.log);
    this.budget = new BudgetTracker(this.config.orchestrator.process_budget, this.log);
    this.wake = new WakeLockManager(this.config.orchestrator.wake_lock_policy, this.log);
    // Acquire wake lock immediately — never release it. Android kills
    // background processes when wake lock is dropped.
    this.wake.acquire();
    this.memory = new MemoryMonitor(
      this.log,
      this.config.orchestrator.memory_warning_mb,
      this.config.orchestrator.memory_critical_mb,
      this.config.orchestrator.memory_emergency_mb,
    );
    this.activity = new ActivityDetector(this.log);
    this.battery = new BatteryMonitor(this.log, this.config.battery.low_threshold_pct);

    // Load dynamic session registry
    const registryPath = join(dirname(this.config.orchestrator.state_file), "registry.json");
    this.registry = new Registry(registryPath);

    // Wire up IPC handler
    this.ipc = new IpcServer(
      this.config.orchestrator.socket,
      (cmd) => this.handleIpcCommand(cmd),
      this.log,
    );
  }

  /**
   * Pre-flight checks — ensure required directories exist and config is sane.
   * Called at the top of start() so the daemon crashes early with a clear message
   * rather than failing mysteriously later.
   */
  private preflight(): void {
    const { log_dir, state_file, socket } = this.config.orchestrator;

    // Ensure log directory exists
    if (!existsSync(log_dir)) {
      mkdirSync(log_dir, { recursive: true });
      this.log.debug(`Created log directory: ${log_dir}`);
    }

    // Ensure state file parent directory exists
    const stateDir = dirname(state_file);
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
      this.log.debug(`Created state directory: ${stateDir}`);
    }

    // Ensure socket parent directory exists
    const socketDir = dirname(socket);
    if (!existsSync(socketDir)) {
      mkdirSync(socketDir, { recursive: true });
      this.log.debug(`Created socket directory: ${socketDir}`);
    }

    // Validate session count vs budget
    const enabledCount = this.config.sessions.filter((s) => s.enabled).length;
    if (enabledCount === 0) {
      this.log.warn("No enabled sessions in config");
    }
  }

  /** Start the daemon — main entry point */
  async start(): Promise<void> {
    trace("daemon:start");
    this.preflight();
    this.running = true;
    this.log.info("Daemon starting", {
      sessions: this.config.sessions.length,
      budget: this.config.orchestrator.process_budget,
      wake_policy: this.config.orchestrator.wake_lock_policy,
    });

    // Initialize state from config + registry
    this.state.resetDaemonStart();
    this.mergeRegistrySessions();
    this.state.initFromConfig(this.config.sessions);

    // Inject LD_PRELOAD into tmux global env for termux-exec
    // (bun's glibc-runner strips it; without it /usr/bin/env fails)
    ensureTmuxLdPreload(this.log);

    // Adopt existing tmux sessions
    this.adoptExistingSessions();

    // Start IPC server
    await this.ipc.start();

    // Set up signal handlers
    this.setupSignalHandlers();

    // Start health check timer
    this.startHealthTimer();

    // Start memory monitoring timer (every 15s)
    this.startMemoryTimer();

    // Start battery monitoring timer
    this.startBatteryTimer();

    // Periodically flush registry activity timestamps (every 5 min)
    // Prevents data loss if daemon is SIGKILL'd between updateActivity calls
    this.registryFlushTimer = setInterval(() => {
      this.registry.flush();
    }, 5 * 60 * 1000);

    // Start HTTP dashboard if configured
    await this.startDashboard();

    notify("tmx daemon", "Orchestrator started");

    // Keep process alive until shutdown() resolves the promise
    await new Promise<void>((resolve) => {
      this.shutdownResolve = resolve;
    });
  }

  /** Full boot sequence: ADB fix → dependency-ordered start → cron */
  async boot(): Promise<void> {
    trace("boot:start");
    this.log.info("Boot sequence starting");
    this.wake.evaluate("boot_start");

    const bootDeadline = Date.now() + this.config.orchestrator.boot_timeout_s * 1000;

    // Step 1: ADB fix (with boot delay on first boot for wireless debugging to initialize)
    if (this.config.adb.enabled) {
      if (!this.state.getState().boot_complete && this.config.adb.boot_delay_s > 0) {
        this.log.info(`Waiting ${this.config.adb.boot_delay_s}s for wireless debugging to initialize`);
        await sleep(this.config.adb.boot_delay_s * 1000);
      }
      await this.fixAdb();
    }

    // Step 2: Resolve which Claude sessions to start based on recency
    this.resolveBootSessions();

    // Step 3: Start sessions in dependency order (with boot timeout)
    const timedOut = await this.startAllSessions(bootDeadline);

    // Step 4: Start cron daemon if not running
    this.startCron();

    // Step 5: Restore Termux tabs for non-headless running sessions.
    // Uses TermuxService service_execute intent to create real Termux tabs
    // that attach to tmux sessions. Brief delay to let sessions stabilize.
    this.autoTabsTimer = setTimeout(() => {
      this.autoTabsTimer = null;
      try {
        const tabResult = this.cmdTabs();
        if (tabResult.ok) {
          const data = tabResult.data as { restored: number; skipped: number };
          this.log.info(`Auto-tabs: restored=${data.restored} skipped=${data.skipped}`);
        }
      } catch (err) {
        this.log.warn(`Auto-tabs failed: ${err}`);
      }
    }, 3000);

    // Step 6: Mark boot complete
    this.state.setBootComplete(true);
    this.wake.evaluate("boot_end", this.state.getState().sessions);

    const sessionCount = this.config.sessions.filter((s) => s.enabled).length;
    const runningCount = Object.values(this.state.getState().sessions)
      .filter((s) => s.status === "running").length;

    if (timedOut) {
      this.log.warn(`Boot timed out after ${this.config.orchestrator.boot_timeout_s}s: ${runningCount}/${sessionCount} sessions running`);
      notify("tmx boot", `Timed out: ${runningCount}/${sessionCount} sessions`, "tmx-boot");
    } else {
      this.log.info(`Boot complete: ${runningCount}/${sessionCount} sessions running`);
      notify("tmx boot", `${runningCount}/${sessionCount} sessions running`, "tmx-boot");
    }

    // Initial persistent status notification
    this.updateStatusNotification();
  }

  /**
   * Graceful shutdown — detach from sessions, release resources, exit.
   * By default, tmux sessions are LEFT RUNNING so the next daemon can adopt them.
   * Pass killSessions=true only for explicit `tmx shutdown --kill`.
   */
  private shutdownInProgress = false;
  async shutdown(killSessions = false): Promise<void> {
    if (this.shutdownInProgress) return;
    this.shutdownInProgress = true;
    trace("shutdown:start");
    this.log.info("Shutdown sequence starting");

    // Stop health checks and memory monitoring
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.memoryTimer) {
      clearInterval(this.memoryTimer);
      this.memoryTimer = null;
    }
    if (this.batteryTimer) {
      clearInterval(this.batteryTimer);
      this.batteryTimer = null;
    }
    if (this.adbRetryTimer) {
      clearInterval(this.adbRetryTimer);
      this.adbRetryTimer = null;
    }
    if (this.registryFlushTimer) {
      clearInterval(this.registryFlushTimer);
      this.registryFlushTimer = null;
    }

    // Cancel pending auto-tabs and auto-restart timers
    if (this.autoTabsTimer) {
      clearTimeout(this.autoTabsTimer);
      this.autoTabsTimer = null;
    }
    for (const timer of this.restartTimers) {
      clearTimeout(timer);
    }
    this.restartTimers.clear();

    if (killSessions) {
      // Only kill tmux sessions when explicitly requested (tmx shutdown --kill)
      this.log.info("Killing all tmux sessions (--kill requested)");
      const shutdownOrder = computeShutdownOrder(this.config.sessions);
      for (const batch of shutdownOrder) {
        const stopPromises = batch.sessions.map(async (name) => {
          const s = this.state.getSession(name);
          if (!s || s.status === "stopped" || s.status === "pending") return;
          this.state.transition(name, "stopping");
          await stopSession(name, this.log);
          this.state.transition(name, "stopped");
        });
        await Promise.all(stopPromises);
      }
    } else {
      // Default: orphan sessions for next daemon to adopt
      this.log.info("Detaching from sessions (tmux sessions left running for adoption)");
    }

    // Flush registry with final activity timestamps
    this.registry.flush();

    // Wake lock intentionally NOT released — Android kills processes without it

    // Stop dashboard server
    if (this.dashboard) {
      this.dashboard.stop();
      this.dashboard = null;
    }

    // Stop IPC server
    this.ipc.stop();

    // Remove persistent notifications
    removeNotification("tmx-status");
    removeNotification("tmx-boot");
    removeNotification("tmx-memory");
    // Clean up per-session and failure notifications
    for (const session of this.config.sessions) {
      removeNotification(`tmx-fail-${session.name}`);
      removeNotification(`tmx-${session.name}`);
    }

    this.running = false;
    this.shutdownResolve?.();
    this.log.info("Shutdown complete");
    notify("tmx", "Orchestrator stopped");
  }

  // -- Session management -----------------------------------------------------

  /**
   * Start all enabled sessions in dependency order.
   * Returns true if boot_timeout_s was exceeded (remaining sessions skipped).
   */
  private async startAllSessions(deadline: number = Infinity): Promise<boolean> {
    const batches = computeStartupOrder(this.config.sessions);

    for (const batch of batches) {
      // Check boot timeout before each batch
      if (Date.now() >= deadline) {
        this.log.warn(`Boot timeout reached, skipping batch depth=${batch.depth}: ${batch.sessions.join(", ")}`);
        for (const name of batch.sessions) {
          const s = this.state.getSession(name);
          if (s && (s.status === "pending" || s.status === "waiting")) {
            this.state.transition(name, "failed", "Boot timeout exceeded");
          }
        }
        return true;
      }

      this.log.info(`Starting batch depth=${batch.depth}: ${batch.sessions.join(", ")}`);

      // Start all sessions in this batch in parallel
      const startPromises = batch.sessions.map((name) => this.startSession(name));
      await Promise.all(startPromises);

      // Brief pause between batches for stability
      await sleep(500);
    }

    // Retry sessions stuck in "waiting" whose dependencies are now satisfied.
    // This handles the case where a batch completes but deps within the same
    // batch weren't "running" yet when the dependent was first evaluated.
    const maxRetries = 3;
    for (let retry = 0; retry < maxRetries; retry++) {
      const waitingSessions = this.config.sessions.filter((s) => {
        const state = this.state.getSession(s.name);
        return state?.status === "waiting" && s.enabled;
      });

      if (waitingSessions.length === 0) break;
      if (Date.now() >= deadline) break;

      this.log.info(`Retrying ${waitingSessions.length} waiting sessions (attempt ${retry + 1}/${maxRetries})`);
      await sleep(1000); // Give recently-started sessions time to reach "running"

      const retryPromises = waitingSessions.map((s) => this.startSession(s.name));
      await Promise.all(retryPromises);

      // Check if any are still waiting
      const stillWaiting = waitingSessions.filter((s) => {
        const state = this.state.getSession(s.name);
        return state?.status === "waiting";
      });
      if (stillWaiting.length === 0) break;
    }

    return false;
  }

  /** Start a single session by name */
  private async startSession(name: string): Promise<boolean> {
    trace(`session:start:${name}`);
    const sessionConfig = this.config.sessions.find((s) => s.name === name);
    if (!sessionConfig) {
      this.log.error(`Unknown session '${name}'`);
      return false;
    }

    if (!sessionConfig.enabled) {
      this.log.debug(`Session '${name}' is disabled, skipping`, { session: name });
      return false;
    }

    // Skip sessions already adopted from bare Termux tabs
    if (this.adoptedPids.has(name)) {
      this.log.debug(`Session '${name}' is adopted (bare PID ${this.adoptedPids.get(name)}), skipping start`, { session: name });
      return true;
    }

    // Check dependencies
    const depsReady = sessionConfig.depends_on.every((dep) => {
      const depState = this.state.getSession(dep);
      return depState?.status === "running";
    });

    if (!depsReady) {
      this.state.forceStatus(name, "waiting");
      this.log.info(`Session '${name}' waiting on dependencies: ${sessionConfig.depends_on.join(", ")}`, {
        session: name,
      });
      return false;
    }

    // Transition to starting
    const s = this.state.getSession(name);
    if (s && s.status !== "pending" && s.status !== "waiting" && s.status !== "stopped" && s.status !== "failed") {
      // Already running or in transition
      if (s.status === "running") return true;
      this.log.debug(`Session '${name}' in status '${s.status}', skipping start`, { session: name });
      return false;
    }

    // Reset to pending first if needed (to allow valid transitions)
    if (s && s.status === "failed") {
      this.state.transition(name, "stopped");
      this.state.transition(name, "pending");
    } else if (s && s.status === "stopped") {
      this.state.transition(name, "pending");
    }

    this.state.transition(name, "waiting");
    this.state.transition(name, "starting");

    // Bare sessions: spawn as detached process, track PID directly
    if (sessionConfig.bare) {
      const pid = spawnBareProcess(sessionConfig, this.log);
      if (!pid) {
        this.state.transition(name, "failed", "Failed to spawn bare process");
        return false;
      }
      this.adoptedPids.set(name, pid);
      this.state.transition(name, "running");
      this.wake.evaluate("session_change", this.state.getState().sessions);
      return true;
    }

    // Create the tmux session
    const created = createSession(sessionConfig, this.log);
    if (!created) {
      this.state.transition(name, "failed", "Failed to create tmux session");
      return false;
    }

    // For Claude sessions, wait for readiness and optionally send "go"
    if (sessionConfig.type === "claude") {
      // Don't block the startup for readiness — handle in background
      this.handleClaudeStartup(name, sessionConfig).catch((err) => {
        this.log.error(`Claude startup failed for '${name}': ${(err as Error).message}`, { session: name });
        this.state.transition(name, "failed", `Startup error: ${(err as Error).message}`);
      });
    } else {
      // For non-Claude sessions, assume running after creation
      this.state.transition(name, "running");
    }

    // Update wake lock state
    this.wake.evaluate("session_change", this.state.getState().sessions);

    return true;
  }

  /** Handle Claude session startup: wait for readiness, send "go" if configured */
  private async handleClaudeStartup(name: string, config: SessionConfig): Promise<void> {
    // Give Claude Code a moment to initialize
    await sleep(2000);

    let readinessResult: "ready" | "timeout" | "disappeared" = "timeout";

    if (config.auto_go) {
      readinessResult = await sendGoToSession(name, this.log);
      if (readinessResult !== "ready") {
        this.log.warn(`Failed to send 'go' to '${name}' — ${readinessResult}`, { session: name });
      }
    } else {
      // Still poll for readiness even without auto_go, to set correct state
      readinessResult = await waitForClaudeReady(name, this.log);
    }

    const s = this.state.getSession(name);
    if (!s || s.status !== "starting") return;

    if (readinessResult === "ready" || readinessResult === "timeout") {
      // Both cases: session tmux is alive, mark running.
      // Timeout just means Claude Code hasn't shown the ? prompt yet — not degraded.
      this.state.transition(name, "running");
      if (readinessResult === "timeout") {
        this.log.info(`Session '${name}' running (readiness poll timed out, tmux alive)`, { session: name });
      }
    }
    // "disappeared" — session is gone, leave in starting (health check will handle)
  }

  /** Stop a single session by name */
  private async stopSessionByName(name: string): Promise<boolean> {
    trace(`session:stop:${name}`);
    const s = this.state.getSession(name);
    if (!s) return false;

    if (s.status === "stopped" || s.status === "pending") return true;

    // Resume first if suspended — SIGSTOP'd processes can't respond to graceful shutdown
    if (s.suspended) {
      resumeSession(name, this.log);
      this.state.setSuspended(name, false);
      // Brief delay for process to schedule and handle signals after SIGCONT
      await sleep(500);
    }

    this.state.transition(name, "stopping");
    const stopped = await stopSession(name, this.log);
    if (stopped) {
      this.state.transition(name, "stopped");
    } else {
      // Force-set to stopped anyway
      this.state.forceStatus(name, "stopped");
    }

    // Clear stale activity snapshot so next start gets a fresh baseline
    this.activity.remove(name);

    this.wake.evaluate("session_change", this.state.getState().sessions);
    return stopped;
  }

  /** Adopt existing tmux sessions on daemon restart */
  private adoptExistingSessions(): void {
    const tmuxAlive = isTmuxServerAlive();
    const existingSessions = tmuxAlive ? new Set(listTmuxSessions()) : new Set<string>();
    const configuredNames = new Set(this.config.sessions.map((s) => s.name));

    if (tmuxAlive) {
      // Adopt tmux sessions that are alive but daemon thinks are not running
      for (const name of existingSessions) {
        if (!configuredNames.has(name)) continue;

        const s = this.state.getSession(name);
        if (s && s.status !== "running") {
          this.log.info(`Adopting existing tmux session '${name}'`, { session: name });
          this.state.forceStatus(name, "running");
          if (!s.uptime_start) {
            this.state.getSession(name)!.uptime_start = new Date().toISOString();
          }
        }
      }
    }

    // Adopt bare Claude processes (non-tmux Termux tabs)
    const bareSessions = discoverBareClaudeSessions(this.config.sessions);
    const adoptedNames = new Set<string>();
    for (const bare of bareSessions) {
      const s = this.state.getSession(bare.sessionName);
      if (s && s.status !== "running") {
        this.log.info(`Adopting bare Claude session '${bare.sessionName}' (PID ${bare.pid})`, { session: bare.sessionName });
        this.state.forceStatus(bare.sessionName, "running");
        this.adoptedPids.set(bare.sessionName, bare.pid);
        adoptedNames.add(bare.sessionName);
        if (!s.uptime_start) {
          this.state.getSession(bare.sessionName)!.uptime_start = new Date().toISOString();
        }
      } else if (s && s.status === "running" && !existingSessions.has(bare.sessionName)) {
        // Running state but no tmux session — track the bare PID for monitoring
        this.adoptedPids.set(bare.sessionName, bare.pid);
        adoptedNames.add(bare.sessionName);
      }
    }

    // Recover sessions whose state claims they're active but tmux session is gone
    // AND no bare process was found. Handles: post-reboot (state.json persists but
    // tmux is dead), OOM kills, and sessions stuck in transient states.
    // Skip bare-config sessions — they don't use tmux at all.
    for (const cfg of this.config.sessions) {
      if (cfg.bare) continue; // bare sessions are tracked via adoptedPids
      const s = this.state.getSession(cfg.name);
      if (!s) continue;
      const isActiveState = s.status === "running" || s.status === "degraded" ||
        s.status === "stopping" || s.status === "starting";
      if (isActiveState && !existingSessions.has(cfg.name) && !adoptedNames.has(cfg.name)) {
        this.log.info(`Recovering stale '${s.status}' session '${cfg.name}' → stopped`, { session: cfg.name });
        this.state.forceStatus(cfg.name, "stopped");
      }
    }
  }

  /**
   * Re-scan for newly started bare Claude sessions during health sweeps.
   * Picks up sessions the user started manually after daemon boot.
   */
  private rescanBareClaudeSessions(): void {
    const bareSessions = discoverBareClaudeSessions(this.config.sessions);
    for (const bare of bareSessions) {
      // Skip if we already track this session (tmux or adopted)
      if (this.adoptedPids.has(bare.sessionName)) {
        // Update PID if it changed (process restarted)
        if (this.adoptedPids.get(bare.sessionName) !== bare.pid) {
          this.log.info(`Adopted session '${bare.sessionName}' PID changed: ${this.adoptedPids.get(bare.sessionName)} → ${bare.pid}`, { session: bare.sessionName });
          this.adoptedPids.set(bare.sessionName, bare.pid);
        }
        continue;
      }

      const s = this.state.getSession(bare.sessionName);
      if (!s) continue;

      // Only adopt if session is stopped/failed/pending — don't steal from tmux
      if (s.status === "stopped" || s.status === "failed" || s.status === "pending") {
        this.log.info(`Late-adopting bare Claude session '${bare.sessionName}' (PID ${bare.pid})`, { session: bare.sessionName });
        this.state.forceStatus(bare.sessionName, "running");
        this.adoptedPids.set(bare.sessionName, bare.pid);
        this.state.getSession(bare.sessionName)!.uptime_start = new Date().toISOString();
      }
    }
  }

  // -- ADB helpers ------------------------------------------------------------

  /** ADB serial cache TTL — re-resolve every 30s to handle reconnects */
  private static readonly ADB_SERIAL_TTL_MS = 30_000;

  /** Get local IP with caching (60s TTL) */
  private getLocalIp(): string | null {
    const now = Date.now();
    if (this.localIp && now < this.localIpExpiry) return this.localIp;
    this.localIp = resolveLocalIp();
    this.localIpExpiry = now + Daemon.LOCAL_IP_TTL_MS;
    if (this.localIp) this.log.debug(`Local IP resolved: ${this.localIp}`);
    return this.localIp;
  }

  /**
   * Resolve the active ADB device serial (needed when multiple devices are listed).
   * Prefers localhost/self-device connections over external phones.
   * Caches with a short TTL so reconnects with new ports are picked up.
   * Auto-disconnects stale offline/unauthorized entries to prevent confusion.
   */
  private resolveAdbSerial(): string | null {
    const now = Date.now();
    if (this.adbSerial && now < this.adbSerialExpiry) return this.adbSerial;
    try {
      const result = spawnSync(ADB_BIN, ["devices"], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (result.status !== 0 || !result.stdout) return null;

      const lines = result.stdout.split("\n").filter((l) => l.includes("\t"));
      const online: string[] = [];
      const stale: string[] = [];

      for (const line of lines) {
        const [serial, state] = line.split("\t");
        if (state?.trim() === "device") {
          online.push(serial.trim());
        } else if (state?.trim() === "offline" || state?.trim() === "unauthorized") {
          stale.push(serial.trim());
        }
      }

      // Auto-disconnect stale entries to prevent "more than one device" errors
      for (const serial of stale) {
        this.log.debug(`Disconnecting stale ADB device: ${serial}`);
        spawnSync(ADB_BIN, ["disconnect", serial], { timeout: 3000, stdio: "ignore" });
      }

      if (online.length === 0) {
        this.adbSerial = null;
        return null;
      }

      // Prefer localhost/self-device connections over external phones
      if (online.length > 1) {
        const localIp = this.getLocalIp();
        const localhost = online.find((s) =>
          s.startsWith("127.0.0.1:") ||
          s.startsWith("localhost:") ||
          (localIp && s.startsWith(`${localIp}:`))
        );
        if (localhost) {
          this.log.debug(`Multiple ADB devices, preferring localhost: ${localhost}`);
          this.adbSerial = localhost;
        } else {
          this.log.warn(`Multiple ADB devices, no localhost match — using ${online[0]}. ` +
            `Devices: ${online.join(", ")}`);
          this.adbSerial = online[0];
        }
      } else {
        this.adbSerial = online[0];
      }

      this.adbSerialExpiry = now + Daemon.ADB_SERIAL_TTL_MS;
      return this.adbSerial;
    } catch {
      return null;
    }
  }

  /** Build ADB shell args with serial selection for multi-device environments */
  private adbShellArgs(...shellArgs: string[]): string[] {
    const serial = this.resolveAdbSerial();
    const args: string[] = [];
    if (serial) args.push("-s", serial);
    args.push("shell", ...shellArgs);
    return args;
  }

  // -- ADB fix ----------------------------------------------------------------

  /** Attempt ADB connection and apply phantom process killer fix */
  private async fixAdb(): Promise<boolean> {
    trace("adb:fix:start");
    this.log.info("Attempting ADB connection for phantom process fix");

    const { connect_script, connect_timeout_s, phantom_fix } = this.config.adb;

    try {
      const result = spawnSync("timeout", [String(connect_timeout_s), connect_script], {
        encoding: "utf-8",
        timeout: (connect_timeout_s + 5) * 1000,
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (result.status !== 0) {
        this.log.warn("ADB connection failed", { stderr: result.stderr?.trim() });
        this.state.setAdbFixed(false);
        notify("tmx boot", "ADB fix failed — processes may be killed", "tmx-boot");

        // Set up retry timer
        this.startAdbRetryTimer();
        return false;
      }

      this.log.info("ADB connected");
      // Clear cached serial so it's re-resolved with the new connection
      this.adbSerial = null;
      this.adbSerialExpiry = 0;

      if (phantom_fix) {
        this.applyPhantomFix();
      }

      this.state.setAdbFixed(true);
      return true;
    } catch (err) {
      this.log.error(`ADB fix error: ${err}`);
      this.state.setAdbFixed(false);
      this.startAdbRetryTimer();
      return false;
    }
  }

  /**
   * Verify the resolved ADB device is this device (not an external phone).
   * When only one device is connected, it must be this device — skip IP matching.
   * IP matching is only needed when multiple devices are online to disambiguate.
   */
  private isLocalAdbDevice(): boolean {
    const serial = this.resolveAdbSerial();
    if (!serial) return false;

    // Localhost connections are always local
    if (serial.startsWith("127.0.0.1:") || serial.startsWith("localhost:")) return true;

    // Count online devices to decide if IP matching is needed
    try {
      const result = spawnSync(ADB_BIN, ["devices"], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const onlineCount = (result.stdout ?? "")
        .split("\n")
        .filter((l) => l.includes("\tdevice")).length;

      // Single device: must be this device — no need for IP matching
      if (onlineCount === 1) return true;

      // Multiple devices: fall through to IP check
    } catch { /* fall through to IP check */ }

    // Check if serial IP matches local IP (multi-device disambiguation)
    const localIp = this.getLocalIp();
    if (localIp && serial.startsWith(`${localIp}:`)) return true;

    // Serial doesn't match any local address — might be an external device
    return false;
  }

  /**
   * Apply Android 12+ process protection fixes via ADB.
   * Mirrors ALL the protections from the old tasker/startup.sh:
   * 1. Phantom process killer disable (device_config + settings)
   * 2. Doze whitelist (deviceidle) for Termux + Edge
   * 3. Active standby bucket for Termux + Edge
   * 4. Background execution allow for Termux + Edge
   */
  private applyPhantomFix(): void {
    // Safety check: only apply settings to this device, not external phones
    if (!this.isLocalAdbDevice()) {
      const serial = this.resolveAdbSerial();
      this.log.warn(`Skipping phantom fix — ADB device '${serial}' may not be this device`);
      return;
    }

    // 1. Phantom process killer fix
    const phantomCmds = [
      ["/system/bin/device_config", "put", "activity_manager", "max_phantom_processes", "2147483647"],
      ["settings", "put", "global", "settings_enable_monitor_phantom_procs", "false"],
    ];

    // 2. Doze whitelist — prevent Android from suspending these apps
    const dozeWhitelistPkgs = ["com.termux", "com.microsoft.emmx.canary"];

    // 3. Active standby bucket — prevent throttling
    const standbyPkgs = ["com.termux", "com.microsoft.emmx.canary"];

    // 4. Background execution — allow running in background unconditionally
    const bgPkgs = ["com.termux", "com.microsoft.emmx.canary"];

    // Apply phantom process fixes
    for (const cmd of phantomCmds) {
      try {
        spawnSync(ADB_BIN, this.adbShellArgs(...cmd), { timeout: 10_000, stdio: "ignore" });
      } catch (err) {
        this.log.warn(`Phantom fix command failed: ${cmd.join(" ")}`, { error: String(err) });
      }
    }

    // Apply Doze whitelist
    for (const pkg of dozeWhitelistPkgs) {
      try {
        spawnSync(ADB_BIN, this.adbShellArgs("cmd", "deviceidle", "whitelist", `+${pkg}`), {
          timeout: 10_000, stdio: "ignore",
        });
      } catch (err) {
        this.log.warn(`Doze whitelist failed for ${pkg}`, { error: String(err) });
      }
    }

    // Apply active standby bucket
    for (const pkg of standbyPkgs) {
      try {
        spawnSync(ADB_BIN, this.adbShellArgs("am", "set-standby-bucket", pkg, "active"), {
          timeout: 10_000, stdio: "ignore",
        });
      } catch (err) {
        this.log.warn(`Standby bucket failed for ${pkg}`, { error: String(err) });
      }
    }

    // Allow background execution
    for (const pkg of bgPkgs) {
      try {
        spawnSync(ADB_BIN, this.adbShellArgs("cmd", "appops", "set", pkg, "RUN_ANY_IN_BACKGROUND", "allow"), {
          timeout: 10_000, stdio: "ignore",
        });
      } catch (err) {
        this.log.warn(`Background allow failed for ${pkg}`, { error: String(err) });
      }
    }

    // 5. OOM score adjustment — make Termux less likely to be killed by LMK
    // oom_score_adj ranges from -1000 (never kill) to 1000 (kill first).
    // -200 is moderate — enough to survive pressure spikes without starving
    // foreground apps. Logcat shows Termux main process already at adj=0
    // (foreground), so this mainly protects against transient demotion.
    try {
      // Get Termux's main PID from the app process
      const pidResult = spawnSync(ADB_BIN, this.adbShellArgs(
        "sh", "-c", "pidof com.termux | head -1",
      ), { encoding: "utf-8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
      const termuxPid = pidResult.stdout?.trim();
      if (termuxPid && /^\d+$/.test(termuxPid)) {
        spawnSync(ADB_BIN, this.adbShellArgs(
          "sh", "-c", `echo -200 > /proc/${termuxPid}/oom_score_adj`,
        ), { timeout: 10_000, stdio: "ignore" });
        this.log.info(`Set oom_score_adj=-200 for Termux PID ${termuxPid}`);
      }
    } catch (err) {
      this.log.debug(`oom_score_adj failed (non-critical): ${err}`);
    }

    // 6. Prevent Android from classifying Termux as idle (which triggers restrictions)
    for (const pkg of ["com.termux", "com.microsoft.emmx.canary"]) {
      try {
        spawnSync(ADB_BIN, this.adbShellArgs("cmd", "activity", "set-inactive", pkg, "false"), {
          timeout: 10_000, stdio: "ignore",
        });
      } catch {
        // Non-critical — command may not exist on all Android versions
      }
    }

    // 7. Lower LMK trigger level to reduce aggressive kills under memory pressure
    try {
      spawnSync(ADB_BIN, this.adbShellArgs("settings", "put", "global", "low_power_trigger_level", "1"), {
        timeout: 10_000, stdio: "ignore",
      });
    } catch {
      // Non-critical
    }

    // Re-enable Samsung sensor packages
    const samsungPkgs = [
      "com.samsung.android.ssco",
      "com.samsung.android.mocca",
      "com.samsung.android.camerasdkservice",
    ];
    for (const pkg of samsungPkgs) {
      try {
        spawnSync(ADB_BIN, this.adbShellArgs("pm", "enable", pkg), { timeout: 10_000, stdio: "ignore" });
      } catch {
        // Non-critical
      }
    }

    trace("adb:fix:complete");
    this.log.info("Android process protection fixes applied (phantom + doze + standby + background + oom_adj + idle + lmk)");
  }

  /** Start a periodic ADB retry timer */
  private startAdbRetryTimer(): void {
    if (this.adbRetryTimer) return;
    const intervalMs = this.config.adb.retry_interval_s * 1000;
    this.adbRetryTimer = setInterval(async () => {
      if (this.state.getState().adb_fixed) {
        // Already fixed, stop retrying
        if (this.adbRetryTimer) {
          clearInterval(this.adbRetryTimer);
          this.adbRetryTimer = null;
        }
        return;
      }
      this.log.info("Retrying ADB connection...");
      const success = await this.fixAdb();
      if (success && this.adbRetryTimer) {
        clearInterval(this.adbRetryTimer);
        this.adbRetryTimer = null;
      }
    }, intervalMs);
  }

  // -- Health & auto-restart --------------------------------------------------

  /** Start periodic health check timer */
  private startHealthTimer(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthSweepAndRestart(); // Prevent starvation on rapid SIGHUP reloads
    }
    const intervalMs = this.config.orchestrator.health_interval_s * 1000;
    this.healthTimer = setInterval(() => {
      this.healthSweepAndRestart();
    }, intervalMs);
  }

  /** Re-create IPC socket if it was removed (e.g. Termux crash cleans $PREFIX/tmp) */
  private async ensureSocket(): Promise<void> {
    const socketPath = this.config.orchestrator.socket;
    if (!existsSync(socketPath)) {
      this.log.warn("IPC socket missing (tmpdir cleaned?) — recreating");
      this.ipc.stop(); // clean up old server state
      // Re-create the IPC server with the same handler
      this.ipc = new IpcServer(
        socketPath,
        (cmd) => this.handleIpcCommand(cmd),
        this.log,
      );
      try {
        await this.ipc.start();
        this.log.info("IPC socket re-created successfully");
      } catch (err) {
        this.log.error(`Failed to re-create IPC socket: ${err}`);
      }
    }
  }

  /** Run health sweep and handle auto-restarts for degraded sessions */
  private async healthSweepAndRestart(): Promise<void> {
    trace("health:sweep:start");

    // Self-heal: re-create IPC socket if tmpdir was cleaned
    await this.ensureSocket();

    // Prune stale activity snapshots for sessions no longer in config
    const activeNames = new Set(this.config.sessions.map((s) => s.name));
    this.activity.pruneStale(activeNames);

    // Re-scan for newly started bare Claude sessions
    this.rescanBareClaudeSessions();

    const results = runHealthSweep(this.config, this.state, this.log, this.adoptedPids);

    // Check for degraded sessions needing restart (skip suspended — they're intentionally frozen)
    for (const session of this.config.sessions) {
      const s = this.state.getSession(session.name);
      if (!s || s.status !== "degraded") continue;
      if (s.suspended) continue;

      // Check restart limit
      if (s.restart_count >= session.max_restarts) {
        this.state.transition(session.name, "failed",
          `Exceeded max restarts (${session.max_restarts})`);
        notify("tmx", `Session '${session.name}' failed — max restarts exceeded`, `tmx-fail-${session.name}`);
        continue;
      }

      // Apply backoff: wait restart_backoff_s * 2^restart_count
      const backoffMs = session.restart_backoff_s * Math.pow(2, s.restart_count) * 1000;
      this.log.info(`Auto-restarting '${session.name}' in ${backoffMs}ms (attempt ${s.restart_count + 1})`, {
        session: session.name,
      });

      // Transition to starting (increments restart_count)
      this.state.transition(session.name, "starting");

      // Schedule the actual restart (tracked for cleanup in shutdown)
      const timer = setTimeout(async () => {
        this.restartTimers.delete(timer);
        this.activity.remove(session.name); // Clear stale snapshot before restart
        await stopSession(session.name, this.log);
        const created = createSession(session, this.log);
        if (created) {
          if (session.type === "claude") {
            await this.handleClaudeStartup(session.name, session);
          } else {
            this.state.transition(session.name, "running");
          }
        } else {
          this.state.transition(session.name, "failed", "Restart failed");
        }
      }, backoffMs);
      this.restartTimers.add(timer);
    }

    trace("health:sweep:done");
  }

  // -- Memory monitoring -------------------------------------------------------

  /** Start periodic memory monitoring timer (every 5s — fast enough to catch burst OOM) */
  private startMemoryTimer(): void {
    if (this.memoryTimer) clearInterval(this.memoryTimer);
    this.memoryTimer = setInterval(() => {
      this.memoryPollAndShed();
    }, 5_000);
    // Run an initial poll immediately
    this.memoryPollAndShed();
  }

  /** Poll system memory and update per-session RSS/activity */
  private memoryPollAndShed(): void {
    trace("memory:poll");
    // Invalidate caches at start of each poll cycle so we get fresh data
    this.memory.invalidatePsCache();
    this.activity.invalidateProcCache();

    // System memory
    const sysMem = this.memory.getSystemMemory();
    this.state.updateSystemMemory(sysMem);

    // Per-session RSS and activity classification
    for (const session of this.config.sessions) {
      const s = this.state.getSession(session.name);
      if (!s || (s.status !== "running" && s.status !== "degraded")) {
        if (s) this.state.updateSessionMetrics(session.name, null, null);
        continue;
      }

      // Get PID: prefer adopted bare PID, fall back to tmux pane PID
      const adoptedPid = this.adoptedPids.get(session.name);
      let pid: number | null = null;
      if (adoptedPid !== undefined) {
        // Verify adopted PID is still alive
        if (existsSync(`/proc/${adoptedPid}`)) {
          pid = adoptedPid;
        } else {
          // Bare process died — remove from adopted, mark stopped
          this.log.info(`Adopted session '${session.name}' PID ${adoptedPid} exited`, { session: session.name });
          this.adoptedPids.delete(session.name);
          this.state.forceStatus(session.name, "stopped");
          this.state.updateSessionMetrics(session.name, null, "stopped");
          continue;
        }
      } else {
        pid = this.memory.getSessionPid(session.name);
      }
      if (pid === null) {
        this.state.updateSessionMetrics(session.name, null, "stopped");
        continue;
      }

      // Get RSS for the full process tree
      const { rss_mb } = this.memory.getProcessTreeRss(pid);

      // Classify activity based on CPU ticks
      const activityState = this.activity.classifyTree(session.name, pid);

      // Capture pane output + detect Claude prompt state for non-service sessions
      let lastOutput: string | null = null;
      let claudeStatus: "working" | "waiting" | null = null;
      if (session.type !== "service" && !session.bare) {
        const pane = capturePane(session.name, 10);
        if (pane) {
          // Extract meaningful content lines (strips CC chrome, box-drawing, ANSI)
          lastOutput = cleanPaneOutput(pane, 3) || null;
          // Detect if Claude is actively working vs waiting for input.
          // "esc to interrupt" in the status bar = Claude is processing.
          if (session.type === "claude") {
            claudeStatus = CLAUDE_WORKING_PATTERN.test(pane) ? "working" : "waiting";
          }
        }
      }

      this.state.updateSessionMetrics(session.name, rss_mb, activityState, lastOutput, claudeStatus);
    }

    // Auto-suspend/resume based on memory pressure
    this.autoSuspendOnPressure(sysMem?.pressure ?? "normal");

    // Push SSE update with combined state+memory
    this.pushSseState();

    // Update persistent status notification in system bar
    this.updateStatusNotification();
  }

  /**
   * Auto-suspend idle sessions when memory pressure is critical/emergency.
   * Auto-resume previously auto-suspended sessions when pressure returns to normal.
   * This is the key mechanism that prevents OOM death spirals during heavy builds.
   */
  private autoSuspendOnPressure(pressure: string): void {
    if (pressure === "critical" || pressure === "emergency") {
      // Sort running, non-suspended sessions by RSS descending (biggest first)
      const candidates: Array<{ name: string; rss: number }> = [];
      const sessions = this.state.getState().sessions;
      for (const [name, s] of Object.entries(sessions)) {
        if (s.suspended) continue;
        if (s.status !== "running" && s.status !== "degraded") continue;
        // Only auto-suspend idle sessions — don't freeze active builds
        if (s.activity !== "idle") continue;
        candidates.push({ name, rss: s.rss_mb ?? 0 });
      }
      candidates.sort((a, b) => b.rss - a.rss);

      if (candidates.length > 0) {
        // Emergency: suspend ALL idle sessions immediately (lmkd kills come in bursts)
        // Critical: suspend one per cycle to avoid over-freezing
        const limit = pressure === "emergency" ? candidates.length : 1;
        const targets = candidates.slice(0, limit);
        const names = targets.map((t) => t.name);
        this.log.warn(
          `Memory ${pressure}: auto-suspending ${names.join(", ")}`,
        );
        for (const target of targets) {
          if (suspendSession(target.name, this.log)) {
            this.state.setSuspended(target.name, true, true); // auto=true
          }
        }
        notify("tmx", `Paused ${names.join(", ")} — memory ${pressure}`, `tmx-autosuspend`);
      }
    } else if (pressure === "normal") {
      // Auto-resume sessions that were auto-suspended (not manually suspended)
      const sessions = this.state.getState().sessions;
      for (const [name, s] of Object.entries(sessions)) {
        if (!s.auto_suspended) continue;
        this.log.info(`Memory normal: auto-resuming '${name}'`, { session: name });
        if (resumeSession(name, this.log)) {
          this.state.setSuspended(name, false);
        }
      }
    }
    // Warning pressure: no action — just monitoring
  }

  /** Push current state snapshot to all SSE clients */
  private pushSseState(): void {
    if (!this.dashboard || this.dashboard.sseClientCount === 0) return;

    const statusResp = this.cmdStatus();
    if (statusResp.ok) {
      this.dashboard.pushEvent("state", statusResp.data);
    }
  }

  /**
   * Update the persistent Android notification with active/total session counts.
   * Shows "tmx ▶ 3/7" title with active/idle session names in the body.
   * Tapping opens the dashboard. Uses --ongoing + --alert-once for silent updates.
   */
  /**
   * Update the persistent Android notification with session counts + action buttons.
   *
   * Button layout (3 max from termux-notification):
   * - Button 1: "Pause All" / "Resume All" (toggles based on current state)
   * - Button 2: "Stop All" — emergency stop for all sessions
   * - Button 3: "Dashboard" — opens browser to localhost dashboard
   *
   * Actions use curl to hit the daemon's HTTP API — avoids needing tmx on PATH.
   */
  /**
   * Emit per-session notifications (one per active non-service session)
   * and a summary notification. Uses diff-based updates to avoid flickering —
   * only re-emits a notification when its content actually changes.
   */
  private updateStatusNotification(): void {
    const sessions = this.state.getState().sessions;
    const activeNames: string[] = [];
    const idleNames: string[] = [];
    const suspendedNames: string[] = [];
    let totalRunning = 0;

    // Build a set of service session names to exclude from notifications
    const serviceNames = new Set(
      this.config.sessions.filter((c) => c.type === "service").map((c) => c.name),
    );

    for (const [name, s] of Object.entries(sessions)) {
      if (s.status === "running" || s.status === "degraded") {
        totalRunning++;
        if (s.suspended) {
          suspendedNames.push(name);
        } else if (s.activity === "active") {
          activeNames.push(name);
        } else {
          idleNames.push(name);
        }
      }
    }

    const port = this.config.orchestrator.dashboard_port;
    const apiBase = `http://127.0.0.1:${port}/api`;

    // -- Per-session notifications (skip services, stable alpha order) --
    const allRunning = [...activeNames, ...idleNames, ...suspendedNames]
      .filter((n) => !serviceNames.has(n))
      .sort();

    for (const name of allRunning) {
      const s = sessions[name];
      const statusTag = s?.suspended ? "paused" : s?.activity === "active" ? "active" : "idle";
      const rss = s?.rss_mb != null ? ` ${s.rss_mb}MB` : "";
      const contentKey = `${statusTag}|${s?.rss_mb ?? ""}|${s?.suspended}`;

      // Only re-emit notification when content actually changed
      if (this._prevNotifContent.get(name) === contentKey) continue;
      this._prevNotifContent.set(name, contentKey);

      const tabAction = `curl -sX POST ${apiBase}/tab/${name} >/dev/null 2>&1`;
      const suspendAction = s?.suspended
        ? `curl -sX POST ${apiBase}/resume/${name} >/dev/null 2>&1`
        : `curl -sX POST ${apiBase}/suspend/${name} >/dev/null 2>&1`;
      const suspendLabel = s?.suspended ? "Resume" : "Pause";
      const stopAction = `curl -sX POST ${apiBase}/stop/${name} >/dev/null 2>&1`;

      notifyWithArgs([
        "--ongoing",
        "--alert-once",
        "--id", `tmx-${name}`,
        "--group", "tmx-sessions",
        "--priority", "low",
        "--title", `${name}`,
        "--content", `${statusTag}${rss}`,
        "--icon", "terminal",
        "--action", tabAction,
        "--button1", "Tab",
        "--button1-action", tabAction,
        "--button2", suspendLabel,
        "--button2-action", suspendAction,
        "--button3", "Stop",
        "--button3-action", stopAction,
      ]);
    }

    // Remove notifications for sessions that are no longer running
    for (const name of this._prevNotifiedSessions) {
      if (!allRunning.includes(name)) {
        removeNotification(`tmx-${name}`);
        this._prevNotifContent.delete(name);
      }
    }
    // One-shot: remove stale service notifications lingering from previous daemon cycle
    if (!this._serviceNotifsCleared) {
      this._serviceNotifsCleared = true;
      for (const svcName of serviceNames) {
        removeNotification(`tmx-${svcName}`);
      }
    }
    this._prevNotifiedSessions = allRunning;

    // -- Summary notification (diff-based) --
    const activeCount = activeNames.length;
    const suspendedCount = suspendedNames.length;
    const title = suspendedCount > 0
      ? `tmx ▶ ${activeCount}/${totalRunning} (${suspendedCount} paused)`
      : `tmx ▶ ${activeCount}/${totalRunning}`;

    const MAX_NAMES = 8;
    const parts: string[] = [];
    if (activeNames.length > 0) {
      const shown = activeNames.sort().slice(0, MAX_NAMES);
      const extra = activeNames.length - shown.length;
      parts.push(`active: ${shown.join(", ")}${extra > 0 ? ` (+${extra})` : ""}`);
    }
    if (idleNames.length > 0) {
      const shown = idleNames.sort().slice(0, MAX_NAMES);
      const extra = idleNames.length - shown.length;
      parts.push(`idle: ${shown.join(", ")}${extra > 0 ? ` (+${extra})` : ""}`);
    }
    if (suspendedNames.length > 0) {
      const shown = suspendedNames.sort().slice(0, MAX_NAMES);
      const extra = suspendedNames.length - shown.length;
      parts.push(`paused: ${shown.join(", ")}${extra > 0 ? ` (+${extra})` : ""}`);
    }
    const content = parts.length > 0 ? parts.join(" | ") : "no sessions running";

    // Skip re-emit if summary content hasn't changed
    const summaryKey = `${title}|${content}`;
    if (this._prevSummaryContent === summaryKey) return;
    this._prevSummaryContent = summaryKey;

    const anySuspended = suspendedCount > 0;
    const toggleLabel = anySuspended ? "Resume All" : "Pause All";
    const toggleEndpoint = anySuspended ? "resume-all" : "suspend-all";
    const toggleAction = `curl -sX POST ${apiBase}/${toggleEndpoint} >/dev/null 2>&1`;
    // Use am start for dashboard — termux-open-url can silently fail on Android
    const amBin = resolveTermuxBin("am");
    const dashboardAction = `${amBin} start -a android.intent.action.VIEW -d http://localhost:${port}`;

    notifyWithArgs([
      "--ongoing",
      "--alert-once",
      "--id", "tmx-status",
      "--group", "tmx-sessions",
      "--priority", "low",
      "--title", title,
      "--content", content,
      "--icon", "dashboard",
      "--action", dashboardAction,
      "--button1", toggleLabel,
      "--button1-action", toggleAction,
      "--button2", "Stop All",
      "--button2-action", `curl -sX POST ${apiBase}/stop >/dev/null 2>&1`,
      "--button3", "Dashboard",
      "--button3-action", dashboardAction,
    ]);
  }

  // -- Session registry ---------------------------------------------------------

  /** Merge registry sessions into config (config takes precedence) */
  private mergeRegistrySessions(): void {
    // Prune stale entries (>30 days inactive)
    const pruned = this.registry.prune(30);
    if (pruned > 0) this.log.info(`Pruned ${pruned} stale registry entries`);

    const configNames = new Set(this.config.sessions.map((s) => s.name));
    const registryConfigs = this.registry.toSessionConfigs();

    for (const rc of registryConfigs) {
      if (configNames.has(rc.name)) {
        this.log.warn(`Registry session '${rc.name}' conflicts with config — skipping`, { session: rc.name });
        continue;
      }
      this.config.sessions.push(rc);
      this.log.info(`Merged registry session '${rc.name}' (${rc.path})`, { session: rc.name });
    }
  }

  /**
   * Resolve which Claude sessions to auto-start based on recency.
   * Two types of sessions are started:
   *   1. Primary instances — one per project path, most recent, uses `cc` (--continue)
   *   2. Named instances — sessions with a user-assigned title (via /rename),
   *      resumed by session_id with --resume
   *
   * Non-claude sessions (services/daemons) are untouched — they always start.
   * Called during boot() after mergeRegistrySessions() but before startAllSessions().
   */
  private resolveBootSessions(): void {
    const home = process.env.HOME ?? "/data/data/com.termux/files/home";
    const historyPath = join(home, ".claude", "history.jsonl");
    const recentProjects = parseRecentProjects(historyPath, 1000);
    const namedSessions = findNamedSessions(historyPath, 7);
    const { auto_start, visible } = this.config.boot;

    // Build path→config lookup (one entry per path for primary matching)
    const configByPath = new Map<string, SessionConfig>();
    for (const s of this.config.sessions) {
      if (s.path) configByPath.set(resolve(s.path), s);
    }

    // Track ranked claude sessions for partitioning
    const recentClaude: { config: SessionConfig; rank: number }[] = [];
    let rank = 0;

    // --- Phase 1: Primary instances (one per project, no session_id, uses cc) ---
    for (const proj of recentProjects) {
      if (rank >= visible) break;

      const resolvedPath = resolve(proj.path);
      const existing = configByPath.get(resolvedPath);

      if (existing) {
        if (existing.type === "claude" && existing.enabled) {
          // Primary instance uses cc (--continue), no session_id
          existing.session_id = undefined;
          recentClaude.push({ config: existing, rank: rank++ });
        }
      } else {
        // Untracked project — auto-register
        const name = deriveName(proj.path);
        if (!this.config.sessions.find((s) => s.name === name)) {
          this.registry.add({ name, path: resolvedPath, priority: 50, auto_go: false });
          const newConfig: SessionConfig = {
            name, type: "claude", path: resolvedPath, command: undefined,
            auto_go: false, priority: 50, depends_on: [], headless: false,
            env: {}, health: undefined, max_restarts: 3, restart_backoff_s: 5,
            enabled: true, bare: false,
          };
          this.config.sessions.push(newConfig);
          configByPath.set(resolvedPath, newConfig);
          recentClaude.push({ config: newConfig, rank: rank++ });
        }
      }
    }

    // --- Phase 2: Named sessions (user-renamed via /rename, resumed by session_id) ---
    const registeredIds = new Set<string>();
    // Check existing config/registry for already-registered named sessions
    for (const s of this.config.sessions) {
      if (s.session_id) registeredIds.set(s.session_id);
    }

    for (const named of namedSessions) {
      if (rank >= visible) break;
      if (registeredIds.has(named.session_id)) continue;

      const resolvedPath = resolve(named.path);
      // Sanitize title to valid session name
      const titleName = named.title.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
      if (!titleName || !isValidName(titleName)) continue;

      // Check name conflicts — suffix if needed
      const existingNames = this.config.sessions.map((s) => s.name);
      const sessionName = existingNames.includes(titleName)
        ? nextSuffix(titleName, existingNames.filter((n) => n === titleName || n.match(new RegExp(`^${titleName}-\\d+$`))))
        : titleName;

      this.registry.add({
        name: sessionName, path: resolvedPath, priority: 50,
        auto_go: false, session_id: named.session_id,
      });

      const newConfig: SessionConfig = {
        name: sessionName, type: "claude", path: resolvedPath, command: undefined,
        auto_go: false, priority: 50, depends_on: [], headless: false,
        env: {}, health: undefined, max_restarts: 3, restart_backoff_s: 5,
        enabled: true, bare: false, session_id: named.session_id,
      };
      this.config.sessions.push(newConfig);
      registeredIds.add(named.session_id);
      recentClaude.push({ config: newConfig, rank: rank++ });
    }

    // Partition claude sessions: auto-start vs visible-only vs hidden
    const autoStartNames = new Set<string>();
    const visibleNames = new Set<string>();

    for (const { config, rank: r } of recentClaude) {
      if (r < auto_start) {
        autoStartNames.add(config.name);
      } else if (r < visible) {
        visibleNames.add(config.name);
      }
    }

    // Disable claude sessions not in auto-start set
    for (const s of this.config.sessions) {
      if (s.type !== "claude") continue;
      if (autoStartNames.has(s.name)) continue;
      if (visibleNames.has(s.name)) {
        s.enabled = false;
        continue;
      }
      if (!autoStartNames.has(s.name)) {
        s.enabled = false;
      }
    }

    // Re-init state entries for any newly added sessions
    this.state.initFromConfig(this.config.sessions);

    this.log.info(`Boot recency: auto-start=[${[...autoStartNames].join(",")}] ` +
      `visible=[${[...visibleNames].join(",")}]`);
  }

  /**
   * Fuzzy-match a name/fragment to a project path for `tmx open`.
   * Checks config sessions, registry, and recent history (in that order).
   * Supports exact, prefix, and substring matching.
   */
  private resolveOpenTarget(input: string): string | null {
    const lower = input.toLowerCase();

    // 1. Exact match against config session names
    const configExact = this.config.sessions.find((s) => s.name === lower && s.path);
    if (configExact?.path) return resolve(configExact.path);

    // 2. Exact match against registry entries
    const regExact = this.registry.find(lower);
    if (regExact) return regExact.path;

    // 3. Search recent projects from history.jsonl
    const home = process.env.HOME ?? "/data/data/com.termux/files/home";
    const historyPath = join(home, ".claude", "history.jsonl");
    const recent = parseRecentProjects(historyPath, 1000);

    // Exact name match in recent
    const recentExact = recent.find((p) => p.name === lower);
    if (recentExact) return recentExact.path;

    // 4. Prefix match across all sources
    const allSources: Array<{ name: string; path: string }> = [
      ...this.config.sessions.filter((s) => s.path).map((s) => ({ name: s.name, path: s.path! })),
      ...this.registry.entries().map((e) => ({ name: e.name, path: e.path })),
      ...recent,
    ];

    const prefixMatches = allSources.filter((s) => s.name.startsWith(lower));
    if (prefixMatches.length === 1) return resolve(prefixMatches[0].path);

    // 5. Substring match
    const substringMatches = allSources.filter((s) => s.name.includes(lower));
    if (substringMatches.length === 1) return resolve(substringMatches[0].path);

    // Multiple matches — pick the first (most recent from history, or config order)
    if (prefixMatches.length > 0) return resolve(prefixMatches[0].path);
    if (substringMatches.length > 0) return resolve(substringMatches[0].path);

    return null;
  }

  /** Open command — register and start a new dynamic Claude session (supports multi-instance) */
  private async cmdOpen(path: string, name?: string, autoGo = false, priority = 50): Promise<IpcResponse> {
    let resolvedPath: string;

    if (existsSync(path)) {
      resolvedPath = resolve(path);
    } else {
      // Not a valid path — fuzzy match against session names and recent projects
      const matched = this.resolveOpenTarget(path);
      if (!matched) {
        return { ok: false, error: `No project matching '${path}' found in config or recent history` };
      }
      resolvedPath = matched;
    }
    const baseName = name ?? deriveName(path);
    if (!isValidName(baseName)) {
      return { ok: false, error: `Invalid session name '${baseName}' — must match [a-z0-9-]+` };
    }

    // Check if any session already exists for this path — if so, create a suffixed instance
    const existingByPath = this.config.sessions.filter(
      (s) => s.path && resolve(s.path) === resolvedPath,
    );

    let sessionName: string;
    if (existingByPath.length === 0) {
      // First instance — check for name conflict only
      const nameConflict = this.config.sessions.find((s) => s.name === baseName);
      if (nameConflict) {
        return { ok: false, error: `Name '${baseName}' conflicts with an existing session at a different path` };
      }
      sessionName = baseName;
    } else {
      // Multi-instance — find next available suffix
      const pattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:-\\d+)?$`);
      const existingNames = this.config.sessions
        .filter((s) => pattern.test(s.name))
        .map((s) => s.name);
      sessionName = nextSuffix(baseName, existingNames);
    }

    // Add to registry
    const entry = this.registry.add({ name: sessionName, path: resolvedPath, priority, auto_go: autoGo });
    if (!entry) {
      return { ok: false, error: `Failed to register session '${sessionName}'` };
    }

    // Create SessionConfig and merge into live config
    const sessionConfig: SessionConfig = {
      name: sessionName,
      type: "claude",
      path: entry.path,
      command: undefined,
      auto_go: autoGo,
      priority,
      depends_on: [],
      headless: false,
      env: {},
      health: undefined,
      max_restarts: 3,
      restart_backoff_s: 5,
      enabled: true,
      bare: false,
    };
    this.config.sessions.push(sessionConfig);
    this.state.initFromConfig(this.config.sessions);

    // Start the session
    const started = await this.startSession(sessionName);
    this.log.info(`Opened session '${sessionName}' at ${entry.path}`, { session: sessionName });

    return {
      ok: true,
      data: `Opened '${sessionName}' (${entry.path})${started ? " — started" : " — registered but not started"}`,
    };
  }

  /** Close command — stop and unregister a dynamic session */
  private async cmdClose(name: string): Promise<IpcResponse> {
    const resolved = this.resolveName(name);
    if (!resolved) return { ok: false, error: `Unknown session: ${name}` };

    // Stop the session if it's running
    await this.stopSessionByName(resolved);

    // Remove from registry if dynamically opened
    const regEntry = this.registry.find(resolved);
    if (regEntry) {
      this.registry.remove(resolved);
    }

    // Remove from live session list (config sessions reappear on next boot)
    this.config.sessions = this.config.sessions.filter((s) => s.name !== resolved);

    // Remove session state so it vanishes from dashboard immediately
    this.state.removeSession(resolved);

    this.log.info(`Closed session '${resolved}'`, { session: resolved });
    return { ok: true, data: `Closed '${resolved}'` };
  }

  /** Recent command — parse history.jsonl for recently active projects */
  private cmdRecent(count = 20): IpcResponse {
    const home = process.env.HOME ?? "/data/data/com.termux/files/home";
    const historyPath = join(home, ".claude", "history.jsonl");
    const rawProjects = parseRecentProjects(historyPath, 1000);

    // Enrich with running/registered/config status
    const configNames = new Set(this.config.sessions.map((s) => s.name));
    const runningNames = new Set<string>();
    for (const s of Object.values(this.state.getState().sessions)) {
      if (s.status === "running" || s.status === "degraded" || s.status === "starting") {
        runningNames.add(s.name);
      }
    }

    const results: RecentProject[] = rawProjects.slice(0, count).map((p) => {
      // Try to match by derived name or by path
      const matchedConfig = this.config.sessions.find((s) => s.path === p.path);
      const matchedName = matchedConfig?.name ?? p.name;

      let status: RecentProject["status"] = "untracked";
      if (runningNames.has(matchedName)) {
        status = "running";
      } else if (this.registry.find(matchedName) || this.registry.findByPath(p.path)) {
        status = "registered";
      } else if (configNames.has(matchedName) || matchedConfig) {
        status = "config";
      }

      return {
        name: matchedName,
        path: p.path,
        last_active: p.last_active,
        session_id: p.session_id,
        status,
      };
    });

    return { ok: true, data: results };
  }

  /** Register projects by scanning a directory (default ~/git) */
  private cmdRegister(scanPath?: string): IpcResponse {
    const home = process.env.HOME ?? "/data/data/com.termux/files/home";
    const dirPath = resolve(scanPath ?? join(home, "git"));

    if (!existsSync(dirPath)) {
      return { ok: false, error: `Directory not found: ${dirPath}` };
    }

    // Read all entries, filter to directories, sort by mtime descending
    let entries: Array<{ name: string; path: string; mtime: number }>;
    try {
      const names = readdirSync(dirPath);
      entries = names
        .filter((n) => !n.startsWith(".")) // skip hidden dirs
        .map((n) => {
          const full = join(dirPath, n);
          try {
            const st = statSync(full);
            if (!st.isDirectory()) return null;
            return { name: n, path: full, mtime: st.mtimeMs };
          } catch { return null; }
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);
      entries.sort((a, b) => b.mtime - a.mtime);
    } catch (err) {
      return { ok: false, error: `Failed to scan ${dirPath}: ${err}` };
    }

    // Collect existing names for suffix dedup
    const existingNames = [
      ...this.config.sessions.map((s) => s.name),
      ...this.registry.entries().map((e) => e.name),
    ];

    const registered: string[] = [];
    let skipped = 0;
    for (const entry of entries) {
      // Skip if already in config or registry by path
      if (this.config.sessions.find((s) => s.path === entry.path)) { skipped++; continue; }
      if (this.registry.findByPath(entry.path)) { skipped++; continue; }

      let name = deriveName(entry.path);
      if (existingNames.includes(name)) {
        name = nextSuffix(name, existingNames);
      }

      const added = this.registry.add({ name, path: entry.path, priority: 50, auto_go: false });
      if (added) {
        registered.push(name);
        existingNames.push(name);
      } else {
        skipped++;
      }
    }

    this.log.info(`Register: ${registered.length} added, ${skipped} skipped from ${dirPath}`);
    return { ok: true, data: { registered, skipped, total: entries.length } };
  }

  /** Clone a git repo and register it */
  private cmdClone(url: string, nameOverride?: string): IpcResponse {
    const home = process.env.HOME ?? "/data/data/com.termux/files/home";
    const gitDir = join(home, "git");

    // Derive target dir name from URL: strip trailing .git, take basename
    const urlBasename = url.replace(/\.git$/, "").split("/").pop() ?? "unnamed";
    const dirName = nameOverride ?? urlBasename.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const targetDir = join(gitDir, dirName);

    if (existsSync(targetDir)) {
      // Dir exists — just register it if not already registered
      if (this.registry.findByPath(targetDir)) {
        return { ok: true, data: { name: dirName, path: targetDir, message: "Already registered" } };
      }
      const existingNames = [
        ...this.config.sessions.map((s) => s.name),
        ...this.registry.entries().map((e) => e.name),
      ];
      let name = deriveName(targetDir);
      if (existingNames.includes(name)) name = nextSuffix(name, existingNames);
      this.registry.add({ name, path: targetDir, priority: 50, auto_go: false });
      return { ok: true, data: { name, path: targetDir, message: "Existing dir registered" } };
    }

    // Clone the repo
    if (!existsSync(gitDir)) mkdirSync(gitDir, { recursive: true });
    const result = spawnSync("git", ["clone", url, targetDir], {
      timeout: 120_000,
      stdio: "pipe",
      env: process.env,
    });

    if (result.status !== 0) {
      const stderr = result.stderr?.toString().trim() ?? "Unknown error";
      return { ok: false, error: `git clone failed: ${stderr}` };
    }

    // Register the cloned dir
    const existingNames = [
      ...this.config.sessions.map((s) => s.name),
      ...this.registry.entries().map((e) => e.name),
    ];
    let name = deriveName(targetDir);
    if (existingNames.includes(name)) name = nextSuffix(name, existingNames);
    this.registry.add({ name, path: targetDir, priority: 50, auto_go: false });

    this.log.info(`Cloned ${url} → ${targetDir} as '${name}'`);
    return { ok: true, data: { name, path: targetDir } };
  }

  /** Create a new project directory, git init, and register it */
  private cmdCreate(name: string): IpcResponse {
    if (!isValidName(name)) {
      return { ok: false, error: `Invalid name '${name}' — must match [a-z0-9-]+` };
    }

    const home = process.env.HOME ?? "/data/data/com.termux/files/home";
    const targetDir = join(home, "git", name);

    if (existsSync(targetDir)) {
      return { ok: false, error: `Directory already exists: ${targetDir}` };
    }

    mkdirSync(targetDir, { recursive: true });
    spawnSync("git", ["init"], { cwd: targetDir, timeout: 10_000, stdio: "pipe" });

    // Register the new dir
    const existingNames = [
      ...this.config.sessions.map((s) => s.name),
      ...this.registry.entries().map((e) => e.name),
    ];
    let regName = name;
    if (existingNames.includes(regName)) regName = nextSuffix(regName, existingNames);
    this.registry.add({ name: regName, path: targetDir, priority: 50, auto_go: false });

    this.log.info(`Created project '${regName}' at ${targetDir}`);
    return { ok: true, data: { name: regName, path: targetDir } };
  }

  // -- Session suspension (SIGSTOP/SIGCONT) ------------------------------------

  /** Suspend a single session by name — freezes all processes via SIGSTOP */
  private cmdSuspend(name: string): IpcResponse {
    const resolved = this.resolveName(name);
    if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
    const s = this.state.getSession(resolved);
    if (!s) return { ok: false, error: `No state for session: ${resolved}` };
    if (s.suspended) return { ok: true, data: `'${resolved}' already suspended` };
    if (s.status !== "running" && s.status !== "degraded") {
      return { ok: false, error: `Cannot suspend '${resolved}' — status is ${s.status}` };
    }
    const ok = suspendSession(resolved, this.log);
    if (ok) {
      this.state.setSuspended(resolved, true);
      this.updateStatusNotification();
      this.pushSseState();
    }
    return { ok, data: ok ? `Suspended '${resolved}'` : `Failed to suspend '${resolved}'` };
  }

  /** Resume a single suspended session — unfreezes processes via SIGCONT */
  private cmdResume(name: string): IpcResponse {
    const resolved = this.resolveName(name);
    if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
    const s = this.state.getSession(resolved);
    if (!s) return { ok: false, error: `No state for session: ${resolved}` };
    if (!s.suspended) return { ok: true, data: `'${resolved}' not suspended` };
    const ok = resumeSession(resolved, this.log);
    if (ok) {
      this.state.setSuspended(resolved, false);
      this.updateStatusNotification();
      this.pushSseState();
    }
    return { ok, data: ok ? `Resumed '${resolved}'` : `Failed to resume '${resolved}'` };
  }

  /** Suspend all sessions except the named one — "make room" for a heavy build */
  private cmdSuspendOthers(name: string): IpcResponse {
    const resolved = this.resolveName(name);
    if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
    const sessions = this.state.getState().sessions;
    let suspended = 0;
    for (const [sName, s] of Object.entries(sessions)) {
      if (sName === resolved) continue;
      if (s.suspended) continue;
      if (s.status !== "running" && s.status !== "degraded") continue;
      if (suspendSession(sName, this.log)) {
        this.state.setSuspended(sName, true);
        suspended++;
      }
    }
    this.updateStatusNotification();
    this.pushSseState();
    return { ok: true, data: `Suspended ${suspended} sessions (except '${resolved}')` };
  }

  /** Suspend all running sessions */
  private cmdSuspendAll(): IpcResponse {
    const sessions = this.state.getState().sessions;
    let suspended = 0;
    for (const [sName, s] of Object.entries(sessions)) {
      if (s.suspended) continue;
      if (s.status !== "running" && s.status !== "degraded") continue;
      if (suspendSession(sName, this.log)) {
        this.state.setSuspended(sName, true);
        suspended++;
      }
    }
    this.updateStatusNotification();
    this.pushSseState();
    return { ok: true, data: `Suspended ${suspended} sessions` };
  }

  /** Resume all suspended sessions */
  private cmdResumeAll(): IpcResponse {
    const sessions = this.state.getState().sessions;
    let resumed = 0;
    for (const [sName, s] of Object.entries(sessions)) {
      if (!s.suspended) continue;
      if (resumeSession(sName, this.log)) {
        this.state.setSuspended(sName, false);
        resumed++;
      }
    }
    this.updateStatusNotification();
    this.pushSseState();
    return { ok: true, data: `Resumed ${resumed} sessions` };
  }

  // -- Battery monitoring ------------------------------------------------------

  /** Start periodic battery monitoring timer */
  private startBatteryTimer(): void {
    if (!this.config.battery.enabled) {
      this.log.debug("Battery monitoring disabled");
      return;
    }
    if (this.batteryTimer) clearInterval(this.batteryTimer);
    const intervalMs = this.config.battery.poll_interval_s * 1000;
    this.batteryTimer = setInterval(() => {
      this.batteryPoll();
    }, intervalMs);
    // Delay initial poll by 5s so it doesn't block IPC server startup.
    // termux-battery-status is synchronous (~5-8s) and blocks the event loop.
    setTimeout(() => this.batteryPoll(), 5000);
  }

  /** Poll battery status, take action if critically low */
  private batteryPoll(): void {
    trace("battery:poll");
    const status = this.battery.checkAndAct();
    if (!status) return;

    // Update state for dashboard/status display
    this.state.updateBattery({
      percentage: status.percentage,
      charging: status.charging,
      temperature: status.temperature,
      radios_disabled: this.battery.actionsActive,
    });
  }

  // -- Dashboard HTTP server ---------------------------------------------------

  /** Start HTTP dashboard server if port > 0 */
  private async startDashboard(): Promise<void> {
    const port = this.config.orchestrator.dashboard_port;
    if (port <= 0) {
      this.log.debug("Dashboard disabled (port=0)");
      return;
    }

    // Resolve static dir relative to the bundle location
    // In production: dist/tmx.js → dashboard should be at ../dashboard/dist/
    const scriptDir = typeof import.meta.url === "string"
      ? new URL(".", import.meta.url).pathname
      : __dirname ?? process.cwd();
    const staticDir = join(scriptDir, "..", "dashboard", "dist");

    this.dashboard = new DashboardServer(
      port,
      staticDir,
      (method, path, body) => this.handleDashboardApi(method, path, body),
      this.log,
    );

    try {
      await this.dashboard.start();
    } catch (err) {
      this.log.warn(`Dashboard server failed to start: ${err}`);
      this.dashboard = null;
    }
  }

  // -- Customization / Settings API -------------------------------------------

  /** Sensitive env var key patterns — values are redacted in API responses */
  private static readonly SENSITIVE_ENV_KEYS = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i;

  /** Read a JSON file, returning null on any error */
  private readJsonFile(path: string): unknown {
    try {
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      return null;
    }
  }

  /** Validate that a file path is safe to read/write (under ~/.claude/ or a known project) */
  private isAllowedCustomizationPath(filePath: string): boolean {
    const home = process.env.HOME ?? "/data/data/com.termux/files/home";
    const claudeDir = join(home, ".claude");
    const resolved = resolve(filePath);

    // Allow files under ~/.claude/
    if (resolved.startsWith(claudeDir + "/")) return true;

    // Allow CLAUDE.md and .claude/ in known project paths (from running sessions)
    const knownPaths = this.config.sessions
      .map((s: SessionConfig) => s.path)
      .filter(Boolean) as string[];
    // Also include registry paths
    if (this.registry) {
      for (const entry of this.registry.entries()) {
        if (entry.path) knownPaths.push(entry.path);
      }
    }
    for (const p of knownPaths) {
      const projectDir = resolve(p);
      // Allow <project>/CLAUDE.md or <project>/.claude/skills/*.md
      if (resolved === join(projectDir, "CLAUDE.md")) return true;
      if (resolved.startsWith(join(projectDir, ".claude") + "/")) return true;
    }

    return false;
  }

  /** Redact sensitive env values */
  private redactEnv(env: Record<string, string>): Record<string, string> {
    const redacted: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      redacted[k] = Daemon.SENSITIVE_ENV_KEYS.test(k) ? "***" : v;
    }
    return redacted;
  }

  /** Build full customization response */
  private cmdCustomization(projectPath?: string): { ok: boolean; data?: unknown; error?: string } {
    try {
      const home = process.env.HOME ?? "/data/data/com.termux/files/home";
      const claudeDir = join(home, ".claude");

      // 1. Read config files
      const claudeJson = this.readJsonFile(join(home, ".claude.json")) as Record<string, unknown> | null;
      const settingsJson = this.readJsonFile(join(claudeDir, "settings.json")) as Record<string, unknown> | null;
      const installedPluginsJson = this.readJsonFile(join(claudeDir, "plugins", "installed_plugins.json")) as Record<string, unknown> | null;
      const blocklistJson = this.readJsonFile(join(claudeDir, "plugins", "blocklist.json")) as Record<string, unknown> | null;
      const installCountsJson = this.readJsonFile(join(claudeDir, "plugins", "install-counts-cache.json")) as Record<string, unknown> | null;
      const marketplacesJson = this.readJsonFile(join(claudeDir, "plugins", "known_marketplaces.json")) as Record<string, unknown> | null;

      // 2. MCP Servers — merge from ~/.claude.json and settings.json
      const mcpServers: Array<{
        name: string; scope: string; source: string; command: string;
        args: string[]; env?: Record<string, string>; disabled: boolean;
      }> = [];

      // From ~/.claude.json mcpServers
      const cjMcps = (claudeJson?.mcpServers ?? {}) as Record<string, { command?: string; args?: string[]; env?: Record<string, string> }>;
      for (const [name, cfg] of Object.entries(cjMcps)) {
        mcpServers.push({
          name,
          scope: "user",
          source: "claude-json",
          command: cfg.command ?? "",
          args: cfg.args ?? [],
          env: cfg.env ? this.redactEnv(cfg.env) : undefined,
          disabled: false,
        });
      }

      // From settings.json mcpServers
      const sjMcps = ((settingsJson?.mcpServers ?? {}) as Record<string, { command?: string; args?: string[]; env?: Record<string, string> }>);
      for (const [name, cfg] of Object.entries(sjMcps)) {
        // Skip if already listed from ~/.claude.json (settings.json takes precedence for the duplicate name)
        const existing = mcpServers.find(m => m.name === name);
        if (existing) {
          existing.source = "settings-json";
          existing.command = cfg.command ?? existing.command;
          existing.args = cfg.args ?? existing.args;
          if (cfg.env) existing.env = this.redactEnv(cfg.env);
        } else {
          mcpServers.push({
            name,
            scope: "user",
            source: "settings-json",
            command: cfg.command ?? "",
            args: cfg.args ?? [],
            env: cfg.env ? this.redactEnv(cfg.env) : undefined,
            disabled: false,
          });
        }
      }

      // Check project-level disabled MCPs
      if (projectPath && claudeJson?.projects) {
        const projects = claudeJson.projects as Record<string, { disabledMcpServers?: string[]; mcpServers?: Record<string, unknown> }>;
        const projCfg = projects[projectPath];
        if (projCfg?.disabledMcpServers) {
          for (const disabledName of projCfg.disabledMcpServers) {
            const srv = mcpServers.find(m => m.name === disabledName);
            if (srv) srv.disabled = true;
          }
        }
        // Project-scoped MCPs from ~/.claude.json projects[path].mcpServers
        if (projCfg?.mcpServers) {
          for (const [name, cfg] of Object.entries(projCfg.mcpServers as Record<string, { command?: string; args?: string[]; env?: Record<string, string> }>)) {
            mcpServers.push({
              name,
              scope: "project",
              source: "claude-json",
              command: cfg.command ?? "",
              args: cfg.args ?? [],
              env: cfg.env ? this.redactEnv(cfg.env) : undefined,
              disabled: false,
            });
          }
        }
      }

      // 3. Plugins — from installed_plugins.json + enabledPlugins + blocklist
      const enabledPlugins = (settingsJson?.enabledPlugins ?? {}) as Record<string, boolean>;
      const blocklist = ((blocklistJson?.plugins ?? []) as Array<{ plugin: string; reason?: string }>);
      const blockMap = new Map(blocklist.map(b => [b.plugin, b.reason ?? "blocked"]));
      const installCounts = ((installCountsJson?.counts ?? []) as Array<{ plugin: string; unique_installs: number }>);
      const countMap = new Map(installCounts.map(c => [c.plugin, c.unique_installs]));

      const plugins: Array<{
        id: string; name: string; description: string; author: string; scope: string;
        enabled: boolean; blocked: boolean; blockReason?: string; version: string;
        installedAt: string; installPath: string; type: string; installs?: number;
      }> = [];

      const installedMap = ((installedPluginsJson?.plugins ?? {}) as Record<string, Array<{
        scope?: string; installPath?: string; version?: string; installedAt?: string;
      }>>);

      for (const [pluginId, entries] of Object.entries(installedMap)) {
        const entry = entries[0];
        if (!entry) continue;

        // Try to read plugin.json from install path for name/description
        let pluginName = pluginId.split("@")[0];
        let pluginDesc = "";
        let pluginAuthor = "";
        let pluginType: "native" | "external" = "native";

        if (entry.installPath) {
          const pjPath = join(entry.installPath, ".claude-plugin", "plugin.json");
          const pj = this.readJsonFile(pjPath) as { name?: string; description?: string; author?: { name?: string } } | null;
          if (pj) {
            pluginName = pj.name ?? pluginName;
            pluginDesc = pj.description ?? "";
            pluginAuthor = pj.author?.name ?? "";
          }
          // External plugins have .mcp.json
          if (existsSync(join(entry.installPath, ".mcp.json"))) {
            pluginType = "external";
          }
        }

        plugins.push({
          id: pluginId,
          name: pluginName,
          description: pluginDesc,
          author: pluginAuthor,
          scope: entry.scope ?? "user",
          enabled: enabledPlugins[pluginId] ?? false,
          blocked: blockMap.has(pluginId),
          blockReason: blockMap.get(pluginId),
          version: entry.version ?? "",
          installedAt: entry.installedAt ?? "",
          installPath: entry.installPath ?? "",
          type: pluginType,
          installs: countMap.get(pluginId),
        });
      }

      // 4. Skills — from ~/.claude/skills/ + project .claude/skills/
      const skills: Array<{ name: string; path: string; scope: string; source?: string }> = [];

      const userSkillsDir = join(claudeDir, "skills");
      if (existsSync(userSkillsDir)) {
        try {
          for (const f of readdirSync(userSkillsDir)) {
            if (!f.endsWith(".md")) continue;
            skills.push({
              name: f.replace(/\.md$/, ""),
              path: join(userSkillsDir, f),
              scope: "user",
            });
          }
        } catch { /* skip */ }
      }

      if (projectPath) {
        const projSkillsDir = join(projectPath, ".claude", "skills");
        if (existsSync(projSkillsDir)) {
          try {
            for (const f of readdirSync(projSkillsDir)) {
              if (!f.endsWith(".md")) continue;
              skills.push({
                name: f.replace(/\.md$/, ""),
                path: join(projSkillsDir, f),
                scope: "project",
              });
            }
          } catch { /* skip */ }
        }
      }

      // 5. CLAUDE.md files
      const claudeMds: Array<{ label: string; path: string; scope: string }> = [];

      const globalMd = join(claudeDir, "CLAUDE.md");
      if (existsSync(globalMd)) {
        claudeMds.push({ label: "Global (User)", path: globalMd, scope: "user" });
      }

      // Memory files — scan ~/.claude/projects/*/memory/*.md
      // Dir names are mangled paths like "-data-data-com-termux-files-home-git-termux-tools"
      // Decode to the real project name (last segment after final dash-separated known prefix)
      const projectsDir = join(claudeDir, "projects");
      if (existsSync(projectsDir)) {
        try {
          // If a project is selected, find its matching memory dir
          // Claude Code mangles paths: replace / and . with -, prefix with -
          const mangledProject = projectPath
            ? "-" + projectPath.replace(/[/.]/g, "-").replace(/^-+/, "")
            : null;

          for (const d of readdirSync(projectsDir)) {
            // When project selected, only show matching memory dir
            if (mangledProject && d !== mangledProject) continue;

            const memDir = join(projectsDir, d, "memory");
            if (!existsSync(memDir)) continue;

            // Decode project name: extract last meaningful segment from mangled dir
            // e.g. "-data-data-com-termux-files-home-git-termux-tools" → "termux-tools"
            // Strategy: split on "-git-" and take the last part, or fall back to last segment
            const gitIdx = d.lastIndexOf("-git-");
            const projName = gitIdx >= 0
              ? d.slice(gitIdx + 5) // after "-git-"
              : d.split("-").filter(Boolean).pop() ?? d;

            try {
              for (const f of readdirSync(memDir)) {
                if (!f.endsWith(".md")) continue;
                const fileName = f.replace(/\.md$/, "");
                claudeMds.push({
                  label: `${projName}: ${fileName}`,
                  path: join(memDir, f),
                  scope: "memory",
                });
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }

      if (projectPath) {
        const projMd = join(projectPath, "CLAUDE.md");
        if (existsSync(projMd)) {
          const projName = projectPath.split("/").pop() ?? projectPath;
          claudeMds.push({ label: `Project: ${projName}`, path: projMd, scope: "project" });
        }
      }

      // 6. Hooks — from settings.json
      const hooks: Array<{ event: string; matcher: string; type: string; command: string; timeout?: number }> = [];
      const hooksConfig = (settingsJson?.hooks ?? {}) as Record<string, Array<{
        matcher?: string;
        hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
      }>>;
      for (const [event, matchers] of Object.entries(hooksConfig)) {
        if (!Array.isArray(matchers)) continue;
        for (const m of matchers) {
          if (!m.hooks || !Array.isArray(m.hooks)) continue;
          for (const h of m.hooks) {
            hooks.push({
              event,
              matcher: m.matcher ?? "*",
              type: h.type ?? "command",
              command: h.command ?? "",
              timeout: h.timeout,
            });
          }
        }
      }

      // 7. Marketplace — scan marketplace dirs for available plugins
      const marketplaceSources: Array<{ name: string; repo: string; lastUpdated: string }> = [];
      const marketplacePlugins: Array<{
        id: string; name: string; description: string; author: string;
        marketplace: string; type: string; installed: boolean; enabled: boolean;
        installs: number;
      }> = [];

      const installedIds = new Set(Object.keys(installedMap));

      if (marketplacesJson) {
        for (const [mktName, mktCfg] of Object.entries(marketplacesJson as Record<string, {
          source?: { repo?: string }; installLocation?: string; lastUpdated?: string;
        }>)) {
          marketplaceSources.push({
            name: mktName,
            repo: mktCfg.source?.repo ?? "",
            lastUpdated: mktCfg.lastUpdated ?? "",
          });

          const mktDir = mktCfg.installLocation;
          if (!mktDir || !existsSync(mktDir)) continue;

          // Scan native plugins (plugins/ dir)
          const nativeDir = join(mktDir, "plugins");
          if (existsSync(nativeDir)) {
            try {
              for (const name of readdirSync(nativeDir)) {
                const pluginJsonPath = join(nativeDir, name, ".claude-plugin", "plugin.json");
                const pj = this.readJsonFile(pluginJsonPath) as { name?: string; description?: string; author?: { name?: string } } | null;
                if (!pj) continue;
                const pluginId = `${name}@${mktName}`;
                marketplacePlugins.push({
                  id: pluginId,
                  name: pj.name ?? name,
                  description: pj.description ?? "",
                  author: pj.author?.name ?? "",
                  marketplace: mktName,
                  type: "native",
                  installed: installedIds.has(pluginId),
                  enabled: enabledPlugins[pluginId] ?? false,
                  installs: countMap.get(pluginId) ?? 0,
                });
              }
            } catch { /* skip */ }
          }

          // Scan external plugins (external_plugins/ dir)
          const extDir = join(mktDir, "external_plugins");
          if (existsSync(extDir)) {
            try {
              for (const name of readdirSync(extDir)) {
                const pluginJsonPath = join(extDir, name, ".claude-plugin", "plugin.json");
                const pj = this.readJsonFile(pluginJsonPath) as { name?: string; description?: string; author?: { name?: string } } | null;
                if (!pj) continue;
                const pluginId = `${name}@${mktName}`;
                marketplacePlugins.push({
                  id: pluginId,
                  name: pj.name ?? name,
                  description: pj.description ?? "",
                  author: pj.author?.name ?? "",
                  marketplace: mktName,
                  type: "external",
                  installed: installedIds.has(pluginId),
                  enabled: enabledPlugins[pluginId] ?? false,
                  installs: countMap.get(pluginId) ?? 0,
                });
              }
            } catch { /* skip */ }
          }
        }
      }

      // Sort marketplace by install count descending
      marketplacePlugins.sort((a, b) => b.installs - a.installs);

      return {
        ok: true,
        data: {
          mcpServers,
          plugins,
          skills,
          claudeMds: claudeMds,
          hooks,
          marketplace: {
            sources: marketplaceSources,
            available: marketplacePlugins,
          },
          projectPath: projectPath ?? undefined,
        },
      };
    } catch (err) {
      return { ok: false, error: `Failed to read customization data: ${err}` };
    }
  }

  /** Read a customization file's content (skills, CLAUDE.md) */
  private cmdReadCustomizationFile(filePath: string): { ok: boolean; data?: unknown; error?: string } {
    if (!filePath || !this.isAllowedCustomizationPath(filePath)) {
      return { ok: false, error: "Path not allowed" };
    }
    try {
      const content = readFileSync(filePath, "utf-8");
      return { ok: true, data: { content } };
    } catch (err) {
      return { ok: false, error: `Failed to read file: ${err}` };
    }
  }

  /** Write a customization file's content (only .md files) */
  private cmdWriteCustomizationFile(filePath: string, content: string): { ok: boolean; data?: unknown; error?: string } {
    if (!filePath || !this.isAllowedCustomizationPath(filePath)) {
      return { ok: false, error: "Path not allowed" };
    }
    if (!filePath.endsWith(".md")) {
      return { ok: false, error: "Only .md files can be edited" };
    }
    try {
      writeFileSync(filePath, content, "utf-8");
      return { ok: true, data: { written: filePath } };
    } catch (err) {
      return { ok: false, error: `Failed to write file: ${err}` };
    }
  }

  /** Map REST API paths to IPC command handlers */
  private async handleDashboardApi(
    method: string,
    path: string,
    body: string,
  ): Promise<{ status: number; data: unknown }> {
    // Extract path segments: /api/command/name
    const segments = path.replace(/^\/api\//, "").split("/");
    const command = segments[0];
    const name = segments[1] ? decodeURIComponent(segments[1]) : undefined;

    try {
      let resp;
      switch (command) {
        case "status":
          resp = this.cmdStatus(name);
          break;
        case "memory":
          resp = this.cmdMemory();
          break;
        case "health":
          resp = this.cmdHealth();
          break;
        case "start":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          resp = await this.cmdStart(name);
          break;
        case "stop":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          resp = await this.cmdStop(name);
          break;
        case "restart":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          resp = await this.cmdRestart(name);
          break;
        case "go": {
          // Dashboard "go" sends keys immediately — no 60s readiness wait.
          // The readiness check (cmdGo) is for boot automation only.
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Session name required" } };
          const resolved = this.resolveName(name);
          if (!resolved) return { status: 400, data: { error: `Unknown session: ${name}` } };
          const sent = sendKeys(resolved, "go", true);
          return { status: sent ? 200 : 500, data: sent ? { ok: true } : { error: `Failed to send 'go' to '${resolved}'` } };
        }
        case "send":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Session name required" } };
          try {
            const parsed = JSON.parse(body) as { text: string };
            resp = this.cmdSend(name, parsed.text ?? "");
          } catch {
            return { status: 400, data: { error: "Invalid JSON body" } };
          }
          break;
        case "bridge": {
          // POST /api/bridge/termux-service — launch bridge via TermuxService intent
          if (method === "POST" && name === "termux-service") {
            // Check if already running
            try {
              const ctrl = new AbortController();
              const t = setTimeout(() => ctrl.abort(), 2000);
              const hResp = await fetch("http://127.0.0.1:18963/health", { signal: ctrl.signal });
              clearTimeout(t);
              if (hResp.ok) {
                return { status: 200, data: { status: "already_running" } };
              }
            } catch { /* bridge is down — proceed */ }

            // Write bridge startup script
            const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
            const home = process.env.HOME ?? "/data/data/com.termux/files/home";
            const scriptPath = join(prefix, "tmp", "tmx-bridge-start.sh");

            // Find bridge script and runtime (same logic as detached spawn below)
            const bridgeCandidates = [
              join(home, "git/termux-tools/claude-chrome-bridge.ts"),
              join(home, ".bun/install/global/node_modules/claude-chrome-android/dist/cli.js"),
              join(home, ".npm/lib/node_modules/claude-chrome-android/dist/cli.js"),
            ];
            const bridgeScript = bridgeCandidates.find(p => existsSync(p)) ?? bridgeCandidates[0];
            const bunPath = existsSync(join(home, ".bun/bin/bun")) ? join(home, ".bun/bin/bun") : "bun";
            const bridgeDir = dirname(bridgeScript);

            writeFileSync(scriptPath, [
              `#!/data/data/com.termux/files/usr/bin/bash`,
              `# CFC Bridge startup script (generated by tmx daemon)`,
              `cd "${bridgeDir}"`,
              `exec "${bunPath}" "${bridgeScript}" 2>&1 | tee -a "${prefix}/tmp/bridge.log"`,
            ].join("\n") + "\n");
            chmodSync(scriptPath, 0o755);

            // Fire TermuxService intent (same pattern as createTermuxTab in session.ts)
            const amBin = resolveTermuxBin("am");
            const svcResult = spawnSync(amBin, [
              "startservice",
              "-n", "com.termux/.app.TermuxService",
              "-a", "com.termux.service_execute",
              "-d", `file://${scriptPath}`,
              "--ei", "com.termux.execute.session_action", "0",
              "--es", "com.termux.execute.shell_name", "cfc-bridge",
            ], { timeout: 5000, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8", env: termuxApiEnv() });

            if (svcResult.status === 0) {
              this.log.info("Bridge started via TermuxService intent", { script: bridgeScript });
              return { status: 200, data: { status: "starting", method: "termux_service" } };
            }
            this.log.warn("TermuxService bridge start failed", { stderr: svcResult.stderr?.slice(0, 200) });
            return { status: 500, data: { error: "TermuxService intent failed", stderr: svcResult.stderr?.slice(0, 200) } };
          }

          if (method === "POST" && name !== "termux-service") {
            // POST /api/bridge/start — spawn bridge process (detached)
            try {
              // Check if already running first
              const ctrl = new AbortController();
              const t = setTimeout(() => ctrl.abort(), 2000);
              const hResp = await fetch("http://127.0.0.1:18963/health", { signal: ctrl.signal });
              clearTimeout(t);
              if (hResp.ok) {
                return { status: 200, data: { status: "already_running" } };
              }
            } catch { /* bridge is down — proceed to start */ }

            // Find the bridge script
            const home = process.env.HOME ?? "/data/data/com.termux/files/home";
            const bridgeCandidates = [
              join(home, "git/termux-tools/claude-chrome-bridge.ts"),
              join(home, ".bun/install/global/node_modules/claude-chrome-android/dist/cli.js"),
              join(home, ".npm/lib/node_modules/claude-chrome-android/dist/cli.js"),
            ];
            const bridgeScript = bridgeCandidates.find(p => existsSync(p));
            if (!bridgeScript) {
              return { status: 500, data: { error: "Bridge script not found" } };
            }

            // Resolve runtime (bun preferred)
            let runtime = "";
            const bunPath = join(home, ".bun/bin/bun");
            if (existsSync(bunPath)) runtime = bunPath;
            else {
              try {
                const which = spawnSync("which", ["bun"], { encoding: "utf-8", timeout: 3000 });
                if (which.stdout?.trim()) runtime = which.stdout.trim();
              } catch { /* fall through */ }
            }
            if (!runtime) {
              try {
                const which = spawnSync("which", ["node"], { encoding: "utf-8", timeout: 3000 });
                if (which.stdout?.trim()) runtime = which.stdout.trim();
              } catch { /* fall through */ }
            }
            if (!runtime) {
              return { status: 500, data: { error: "No runtime (bun/node) found" } };
            }

            // Spawn bridge detached
            const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
            const logPath = join(prefix, "tmp/bridge.log");
            const logFd = openSync(logPath, "a");
            try {
              const child = spawn(runtime, [bridgeScript], {
                detached: true,
                stdio: ["ignore", logFd, logFd],
              });
              child.unref();

              this.log.info("Bridge spawned via HTTP API", { pid: child.pid, script: bridgeScript });
              return { status: 200, data: { status: "starting", pid: child.pid } };
            } finally {
              closeSync(logFd);
            }
          }

          // GET /api/bridge — proxy to CFC bridge health endpoint
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            const bridgeResp = await fetch("http://127.0.0.1:18963/health", {
              signal: controller.signal,
            });
            clearTimeout(timeout);
            const bridgeData = await bridgeResp.json();
            return { status: 200, data: bridgeData };
          } catch {
            return { status: 200, data: { status: "offline", error: "Bridge not reachable" } };
          }
        }
        case "logs": {
          const sessionFilter = name ?? undefined;
          const log = new Logger(this.config.orchestrator.log_dir);
          const entries = log.readTail(100, sessionFilter);
          return { status: 200, data: entries };
        }
        case "tab": {
          // Open Termux tab attached to a session and bring Termux to foreground
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Session name required" } };
          // Bare sessions have no tmux session to attach to
          const tabCfg = this.config.sessions.find((s: SessionConfig) => s.name === name);
          if (tabCfg?.bare) {
            return { status: 400, data: { error: `'${name}' is a bare (headless) session — no tmux tab` } };
          }
          if (createTermuxTab(name, this.log)) {
            // Ensure tmux shows the correct window, then bring Termux to front
            try { spawnSync("tmux", ["select-window", "-t", name], { timeout: 3000 }); } catch { /* best-effort */ }
            bringTermuxToForeground(this.log);
            return { status: 200, data: { ok: true, session: name } };
          }
          return { status: 500, data: { error: `Failed to open tab for '${name}'` } };
        }
        case "run-build": {
          // Run build-on-termux.sh in a new Termux tab (not inside existing session)
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Session name required" } };
          const buildCfg = this.config.sessions.find((s: SessionConfig) => s.name === name);
          if (!buildCfg?.path) return { status: 400, data: { error: `Session '${name}' has no path` } };
          const buildScript = join(buildCfg.path, "build-on-termux.sh");
          if (!existsSync(buildScript)) {
            return { status: 404, data: { error: `No build-on-termux.sh in ${buildCfg.path}` } };
          }
          if (runScriptInTab(buildScript, buildCfg.path, name, this.log)) {
            return { status: 200, data: { ok: true, session: name } };
          }
          return { status: 500, data: { error: `Failed to launch build for '${name}'` } };
        }
        case "scripts": {
          // GET /api/scripts/:name — list available scripts for a session
          if (!name) return { status: 400, data: { error: "Session name required" } };
          return this.cmdListScripts(name);
        }
        case "run-script": {
          // POST /api/run-script/:name — run a script or ad-hoc command
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Session name required" } };
          try {
            const parsed = JSON.parse(body) as { command?: string; script?: string; source?: string };
            return this.cmdRunScript(name, parsed);
          } catch {
            return { status: 400, data: { error: "Invalid JSON body" } };
          }
        }
        case "save-script": {
          // POST /api/save-script/:name — save an ad-hoc command as a reusable script
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Session name required" } };
          try {
            const parsed = JSON.parse(body) as { name: string; command: string };
            return this.cmdSaveScript(name, parsed);
          } catch {
            return { status: 400, data: { error: "Invalid JSON body" } };
          }
        }
        case "processes":
          // List Android apps sorted by RSS (via ADB)
          return { status: 200, data: this.getAndroidApps() };
        case "kill":
          // Force-stop an Android app by package name
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Package name required" } };
          return this.forceStopApp(name);
        case "adb":
          // ADB device management
          if (!name) {
            // GET /api/adb — list devices
            return { status: 200, data: this.getAdbDevices() };
          }
          if (name === "connect") {
            if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
            return this.adbWirelessConnect();
          }
          if (name === "disconnect") {
            if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
            // /api/adb/disconnect/:serial — disconnect specific device
            const serial = segments[2] ? decodeURIComponent(segments[2]) : undefined;
            if (serial) return this.adbDisconnectDevice(serial);
            return this.adbDisconnectAll();
          }
          return { status: 400, data: { error: `Unknown ADB action: ${name}` } };
        case "recent":
          resp = this.cmdRecent(20);
          break;
        case "open":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Path or name required" } };
          resp = await this.cmdOpen(name);
          break;
        case "close":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Session name required" } };
          resp = await this.cmdClose(name);
          break;
        case "fix-socket":
          // CLI hits this when socket is missing but HTTP is alive
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          await this.ensureSocket();
          resp = { ok: true };
          break;
        case "suspend":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Session name required" } };
          resp = this.cmdSuspend(name);
          break;
        case "resume":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Session name required" } };
          resp = this.cmdResume(name);
          break;
        case "suspend-others":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Session name required" } };
          resp = this.cmdSuspendOthers(name);
          break;
        case "suspend-all":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          resp = this.cmdSuspendAll();
          break;
        case "resume-all":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          resp = this.cmdResumeAll();
          break;
        case "register": {
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          let scanPath: string | undefined;
          if (body) {
            try { scanPath = (JSON.parse(body) as { path?: string }).path; } catch { /* use default */ }
          }
          resp = this.cmdRegister(scanPath);
          break;
        }
        case "clone": {
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!body) return { status: 400, data: { error: "JSON body with url required" } };
          try {
            const parsed = JSON.parse(body) as { url: string; name?: string };
            if (!parsed.url) return { status: 400, data: { error: "url is required" } };
            resp = this.cmdClone(parsed.url, parsed.name);
          } catch {
            return { status: 400, data: { error: "Invalid JSON body" } };
          }
          break;
        }
        case "create": {
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Project name required" } };
          resp = this.cmdCreate(name);
          break;
        }
        case "customization":
          // GET /api/customization or GET /api/customization/<projectPath>
          resp = this.cmdCustomization(name);
          break;
        case "customization-file": {
          // GET /api/customization-file/<encoded-path> — read file content
          // POST /api/customization-file { path, content } — write file
          if (method === "GET") {
            // Reconstruct full path from remaining segments (path may contain slashes)
            const filePath = segments.slice(1).map(s => decodeURIComponent(s)).join("/");
            if (!filePath) return { status: 400, data: { error: "File path required" } };
            resp = this.cmdReadCustomizationFile(filePath);
          } else if (method === "POST") {
            try {
              const parsed = JSON.parse(body) as { path: string; content: string };
              if (!parsed.path || typeof parsed.content !== "string") {
                return { status: 400, data: { error: "path and content required" } };
              }
              resp = this.cmdWriteCustomizationFile(parsed.path, parsed.content);
            } catch {
              return { status: 400, data: { error: "Invalid JSON body" } };
            }
          } else {
            return { status: 405, data: { error: "Method not allowed" } };
          }
          break;
        }
        default:
          return { status: 404, data: { error: `Unknown endpoint: ${command}` } };
      }

      return { status: resp.ok ? 200 : 400, data: resp.ok ? resp.data : { error: resp.error } };
    } catch (err) {
      return { status: 500, data: { error: String(err) } };
    }
  }

  // -- Script runner ----------------------------------------------------------

  /** Resolve session path from config or registry */
  private resolveSessionPath(sessionName: string): string | null {
    const resolved = this.resolveName(sessionName);
    if (!resolved) return null;
    const cfg = this.config.sessions.find((s: SessionConfig) => s.name === resolved);
    if (cfg?.path) return cfg.path;
    // Check registry for dynamically opened sessions
    for (const entry of this.registry.entries()) {
      if (entry.name === resolved && entry.path) return entry.path;
    }
    return null;
  }

  /** List available scripts for a session project */
  private cmdListScripts(sessionName: string): { status: number; data: unknown } {
    const sessionPath = this.resolveSessionPath(sessionName);
    if (!sessionPath) return { status: 400, data: { error: `Session '${sessionName}' has no path` } };

    interface ScriptEntryOut {
      name: string;
      path: string;
      source: "root" | "scripts" | "package.json" | "saved";
      command?: string;
    }
    const scripts: ScriptEntryOut[] = [];

    // 1. Root .sh files
    try {
      const entries = readdirSync(sessionPath);
      for (const f of entries) {
        if (f.endsWith(".sh")) {
          const full = join(sessionPath, f);
          try {
            if (statSync(full).isFile()) {
              scripts.push({ name: f, path: full, source: "root" });
            }
          } catch { /* stat failed — skip */ }
        }
      }
    } catch { /* dir unreadable — skip */ }

    // 2. scripts/ directory
    try {
      const scriptsDir = join(sessionPath, "scripts");
      const entries = readdirSync(scriptsDir);
      for (const f of entries) {
        if (f.endsWith(".sh")) {
          scripts.push({ name: f, path: join(scriptsDir, f), source: "scripts" });
        }
      }
    } catch { /* no scripts/ dir — skip */ }

    // 3. package.json scripts
    try {
      const pkgPath = join(sessionPath, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { scripts?: Record<string, string> };
      if (pkg.scripts) {
        for (const [scriptName, cmd] of Object.entries(pkg.scripts)) {
          scripts.push({ name: scriptName, path: "", source: "package.json", command: cmd });
        }
      }
    } catch { /* no package.json or parse error — skip */ }

    // 4. Saved scripts (.tmx-scripts/)
    try {
      const savedDir = join(sessionPath, ".tmx-scripts");
      const entries = readdirSync(savedDir);
      for (const f of entries) {
        if (f.endsWith(".sh")) {
          scripts.push({ name: f, path: join(savedDir, f), source: "saved" });
        }
      }
    } catch { /* no saved scripts — skip */ }

    return { status: 200, data: { scripts } };
  }

  /** Run a script or ad-hoc command in a session's Termux tab */
  private cmdRunScript(
    sessionName: string,
    opts: { command?: string; script?: string; source?: string },
  ): { status: number; data: unknown } {
    const resolved = this.resolveName(sessionName);
    if (!resolved) return { status: 400, data: { error: `Unknown session: ${sessionName}` } };
    const sessionPath = this.resolveSessionPath(sessionName);
    if (!sessionPath) return { status: 400, data: { error: `Session '${sessionName}' has no path` } };

    const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";

    if (opts.command) {
      // Ad-hoc command — write to temp script and run
      const tempScript = join(prefix, "tmp", `tmx-cmd-${resolved}.sh`);
      writeFileSync(tempScript, `#!/data/data/com.termux/files/usr/bin/bash\n${opts.command}\n`, { mode: 0o755 });
      if (runScriptInTab(tempScript, sessionPath, resolved, this.log)) {
        return { status: 200, data: { ok: true } };
      }
      return { status: 500, data: { error: "Failed to launch command" } };
    }

    if (opts.script && opts.source) {
      let scriptPath: string;
      switch (opts.source) {
        case "root":
          scriptPath = join(sessionPath, opts.script);
          break;
        case "scripts":
          scriptPath = join(sessionPath, "scripts", opts.script);
          break;
        case "package.json": {
          // Write a temp script that runs `bun run <script>` in the project dir
          const tempScript = join(prefix, "tmp", `tmx-npm-${resolved}.sh`);
          writeFileSync(
            tempScript,
            `#!/data/data/com.termux/files/usr/bin/bash\ncd "${sessionPath}" || exit 1\nbun run ${opts.script}\n`,
            { mode: 0o755 },
          );
          if (runScriptInTab(tempScript, sessionPath, resolved, this.log)) {
            return { status: 200, data: { ok: true } };
          }
          return { status: 500, data: { error: "Failed to launch npm script" } };
        }
        case "saved":
          scriptPath = join(sessionPath, ".tmx-scripts", opts.script);
          break;
        default:
          return { status: 400, data: { error: `Unknown script source: ${opts.source}` } };
      }

      if (!existsSync(scriptPath)) {
        return { status: 404, data: { error: `Script not found: ${scriptPath}` } };
      }
      if (runScriptInTab(scriptPath, sessionPath, resolved, this.log)) {
        return { status: 200, data: { ok: true } };
      }
      return { status: 500, data: { error: `Failed to launch script: ${opts.script}` } };
    }

    return { status: 400, data: { error: "Provide either 'command' or 'script' + 'source'" } };
  }

  /** Save an ad-hoc command as a reusable .sh script in .tmx-scripts/ */
  private cmdSaveScript(
    sessionName: string,
    opts: { name: string; command: string },
  ): { status: number; data: unknown } {
    const sessionPath = this.resolveSessionPath(sessionName);
    if (!sessionPath) return { status: 400, data: { error: `Session '${sessionName}' has no path` } };

    // Validate name — alphanumeric, hyphens, underscores only (no path traversal)
    if (!/^[a-zA-Z0-9_-]+$/.test(opts.name)) {
      return { status: 400, data: { error: "Script name must be alphanumeric (a-z, 0-9, -, _)" } };
    }
    if (!opts.command?.trim()) {
      return { status: 400, data: { error: "Command cannot be empty" } };
    }

    const savedDir = join(sessionPath, ".tmx-scripts");
    mkdirSync(savedDir, { recursive: true });
    const fileName = opts.name.endsWith(".sh") ? opts.name : `${opts.name}.sh`;
    const filePath = join(savedDir, fileName);

    writeFileSync(
      filePath,
      `#!/data/data/com.termux/files/usr/bin/bash\n${opts.command}\n`,
      { mode: 0o755 },
    );

    this.log.info(`Saved script '${fileName}' for session '${sessionName}'`);
    return {
      status: 200,
      data: { name: fileName, path: filePath, source: "saved" as const },
    };
  }

  // -- Android app management -------------------------------------------------

  /** Well-known system packages that should not be force-stopped */
  private static readonly SYSTEM_PACKAGES = new Set([
    "system_server", "com.android.systemui", "com.google.android.gms.persistent",
    "com.termux", "com.termux.api", "com.sec.android.app.launcher",
    "com.android.phone", "com.android.providers.media",
    "com.samsung.android.providers.media", "com.google.android.gms",
    "com.android.bluetooth", "com.google.android.ext.services",
    "com.google.android.providers.media.module", "android.process.acore",
    "com.samsung.android.scs", "com.samsung.android.sead",
    "com.samsung.android.scpm", "com.sec.android.sdhms",
  ]);

  /** Friendly display names for known packages */
  private static readonly APP_LABELS: Record<string, string> = {
    "com.microsoft.emmx.canary": "Edge Canary",
    "com.microsoft.emmx": "Edge",
    "com.android.chrome": "Chrome",
    "com.discord": "Discord",
    "com.Slack": "Slack",
    "com.google.android.gm": "Gmail",
    "com.google.android.apps.photos": "Photos",
    "com.google.android.apps.chromecast.app": "Google Home",
    "com.google.android.apps.maps": "Maps",
    "com.google.android.apps.docs": "Drive",
    "com.google.android.apps.youtube": "YouTube",
    "com.google.android.apps.messaging": "Messages",
    "com.google.android.calendar": "Calendar",
    "com.google.android.googlequicksearchbox": "Google",
    "com.google.android.gms": "Play Services",
    "com.google.android.gms.persistent": "Play Services",
    "com.ubercab.eats": "Uber Eats",
    "com.samsung.android.app.spage": "Samsung Free",
    "com.samsung.android.smartsuggestions": "Smart Suggest",
    "com.samsung.android.incallui": "Phone",
    "com.samsung.android.messaging": "Samsung Messages",
    "com.samsung.android.spay": "Samsung Pay",
    "com.sec.android.daemonapp": "Weather",
    "com.sec.android.app.sbrowser": "Samsung Internet",
    "net.slickdeals.android": "Slickdeals",
    "dev.imranr.obtainium": "Obtainium",
    "com.teslacoilsw.launcher": "Nova Launcher",
    "com.sec.android.app.launcher": "One UI Home",
    "com.android.systemui": "System UI",
    "com.android.settings": "Settings",
    "com.android.vending": "Play Store",
    "com.termux": "Termux",
    "com.termux.api": "Termux:API",
    "tribixbite.cleverkeys": "CleverKeys",
    "com.microsoft.appmanager": "Link to Windows",
    "com.google.android.apps.nbu.files": "Files by Google",
    "com.reddit.frontpage": "Reddit",
    "io.homeassistant.companion.android": "Home Assistant",
    "com.adguard.android.contentblocker": "AdGuard",
    "com.samsung.android.app.smartcapture": "Smart Select",
    "com.samsung.android.app.routines": "Routines",
    "com.samsung.android.rubin.app": "Customization",
    "com.samsung.android.app.moments": "Memories",
    "com.samsung.android.ce": "Samsung Cloud",
    "com.samsung.android.mdx": "Link to Windows",
    "com.samsung.euicc": "SIM Manager",
    "com.sec.imsservice": "IMS Service",
    "com.sec.android.app.clockpackage": "Clock",
    "com.samsung.cmh": "Connected Home",
    "com.samsung.android.kmxservice": "Knox",
    "com.samsung.android.stplatform": "SmartThings",
    "com.samsung.android.service.stplatform": "SmartThings",
    "com.google.android.gms.unstable": "Play Services",
    "com.google.android.as.oss": "Private Compute",
    "com.google.android.cellbroadcastreceiver": "Emergency Alerts",
    "com.sec.android.app.chromecustomizations": "Chrome Custom",
    "org.mopria.printplugin": "Print Service",
    "com.samsung.android.samsungpositioning": "Location",
    "com.google.android.providers.media.module": "Media Storage",
  };

  /**
   * List Android apps via `adb shell ps`, grouped by base package.
   * Merges sandboxed/privileged child processes into the parent total.
   */
  private getAndroidApps(): { pkg: string; label: string; rss_mb: number; system: boolean }[] {
    try {
      const result = spawnSync(ADB_BIN, this.adbShellArgs("ps", "-A", "-o", "PID,RSS,NAME"), {
        encoding: "utf-8",
        timeout: 8000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (result.status !== 0 || !result.stdout) {
        this.log.warn("adb ps failed", {
          status: result.status,
          stderr: result.stderr?.trim().slice(0, 200),
          hasStdout: !!result.stdout,
          args: this.adbShellArgs("ps", "-A", "-o", "PID,RSS,NAME").join(" "),
        });
        return [];
      }

      // Aggregate RSS by base package name (strip :sandboxed_process*, :privileged_process*, etc.)
      const pkgMap = new Map<string, number>();
      for (const line of result.stdout.trim().split("\n")) {
        const match = line.trim().match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
        if (!match) continue;
        const rssKb = parseInt(match[2], 10);
        const rawName = match[3].trim();
        if (rssKb < 1024) continue; // Skip < 1MB (aggregate later)

        // Extract base package: "com.foo.bar:sandboxed_process0:..." → "com.foo.bar"
        const basePkg = rawName.split(":")[0];
        // Only include Android package names (at least 2 dots, e.g. com.foo.bar)
        const dotCount = (basePkg.match(/\./g) || []).length;
        if (dotCount < 2 && !Daemon.APP_LABELS[basePkg]) continue;
        // Skip zygote/isolated processes — they're OS-level, not user apps
        if (basePkg.endsWith("_zygote") || basePkg.startsWith("com.android.isolated")) continue;

        pkgMap.set(basePkg, (pkgMap.get(basePkg) ?? 0) + rssKb);
      }

      const apps: { pkg: string; label: string; rss_mb: number; system: boolean }[] = [];
      for (const [pkg, rssKb] of pkgMap) {
        const rssMb = Math.round(rssKb / 1024);
        if (rssMb < 50) continue; // Skip apps using < 50MB after aggregation
        const system = Daemon.SYSTEM_PACKAGES.has(pkg);
        // Derive a readable label: known name > last meaningful segment > raw package
        const label = Daemon.APP_LABELS[pkg] ?? Daemon.deriveLabel(pkg);
        apps.push({ pkg, label, rss_mb: rssMb, system });
      }

      apps.sort((a, b) => b.rss_mb - a.rss_mb);
      return apps;
    } catch (err) {
      this.log.warn("getAndroidApps exception", { error: String(err) });
      return [];
    }
  }

  /** Derive a human-readable label from a package name */
  private static deriveLabel(pkg: string): string {
    const parts = pkg.split(".");
    // Skip common prefixes: com, org, net, android, google, samsung, sec, app, apps
    const skip = new Set(["com", "org", "net", "android", "google", "samsung", "sec", "app", "apps", "software"]);
    const meaningful = parts.filter((p) => !skip.has(p) && p.length > 1);
    // Capitalize the last meaningful segment
    const name = meaningful.length > 0 ? meaningful[meaningful.length - 1] : parts[parts.length - 1];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  /** Force-stop an Android app via ADB */
  private forceStopApp(pkg: string): { status: number; data: unknown } {
    if (!pkg || !pkg.includes(".")) {
      return { status: 400, data: { error: "Invalid package name" } };
    }
    if (Daemon.SYSTEM_PACKAGES.has(pkg)) {
      return { status: 403, data: { error: `Cannot stop system package: ${pkg}` } };
    }

    try {
      const result = spawnSync(ADB_BIN, this.adbShellArgs("am", "force-stop", pkg), {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (result.status !== 0) {
        return { status: 500, data: { error: result.stderr?.trim() || "force-stop failed" } };
      }
      this.log.info(`Force-stopped ${pkg} via dashboard`);
      return { status: 200, data: { ok: true, pkg } };
    } catch (err) {
      return { status: 500, data: { error: `Failed to stop ${pkg}: ${(err as Error).message}` } };
    }
  }

  // -- ADB device management --------------------------------------------------

  /** List connected ADB devices */
  private getAdbDevices(): { devices: { serial: string; state: string }[] } {
    try {
      const result = spawnSync(ADB_BIN, ["devices"], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (result.status !== 0 || !result.stdout) return { devices: [] };
      const devices = result.stdout
        .split("\n")
        .slice(1) // skip "List of devices attached" header
        .filter((l) => l.includes("\t"))
        .map((l) => {
          const [serial, state] = l.split("\t");
          return { serial: serial.trim(), state: state.trim() };
        });
      return { devices };
    } catch {
      return { devices: [] };
    }
  }

  /** Initiate ADB wireless connection using the adbc script */
  private adbWirelessConnect(): { status: number; data: unknown } {
    const script = join(
      process.env.HOME ?? "/data/data/com.termux/files/home",
      "git/termux-tools/tools/adb-wireless-connect.sh",
    );
    try {
      // Run the connect script with a reasonable timeout (15s for port scanning)
      const result = spawnSync("bash", [script], {
        encoding: "utf-8",
        timeout: 20_000,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: process.env.PATH },
      });
      const output = (result.stdout ?? "") + (result.stderr ?? "");
      if (output.includes("connected") || output.includes("Reconnected")) {
        // Invalidate cached serial
        this.adbSerial = null;
        this.adbSerialExpiry = 0;
        return { status: 200, data: { ok: true, message: output.trim().split("\n").pop() } };
      }
      return { status: 500, data: { ok: false, message: output.trim().split("\n").pop() || "Connection failed" } };
    } catch (err) {
      return { status: 500, data: { ok: false, message: (err as Error).message } };
    }
  }

  /** Disconnect all ADB devices */
  private adbDisconnectAll(): { status: number; data: unknown } {
    try {
      spawnSync(ADB_BIN, ["disconnect", "-a"], {
        timeout: 5000,
        stdio: "ignore",
      });
      // Invalidate cached serial
      this.adbSerial = null;
      this.adbSerialExpiry = 0;
      return { status: 200, data: { ok: true } };
    } catch (err) {
      return { status: 500, data: { ok: false, message: (err as Error).message } };
    }
  }

  /** Disconnect a specific ADB device by serial */
  private adbDisconnectDevice(serial: string): { status: number; data: unknown } {
    try {
      const result = spawnSync(ADB_BIN, ["disconnect", serial], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      // Invalidate cached serial since the active device may have changed
      this.adbSerial = null;
      this.adbSerialExpiry = 0;
      const output = (result.stdout ?? "").trim();
      return { status: 200, data: { ok: true, serial, message: output } };
    } catch (err) {
      return { status: 500, data: { ok: false, message: (err as Error).message } };
    }
  }

  // -- Cron -------------------------------------------------------------------

  /** Start crond if not already running */
  private startCron(): void {
    try {
      const result = spawnSync("pgrep", ["-x", "crond"], { timeout: 5000, stdio: "ignore" });
      if (result.status !== 0) {
        spawnSync("crond", ["-s", "-P"], { timeout: 5000, stdio: "ignore" });
        this.log.info("Started crond");
      }
    } catch {
      this.log.warn("Failed to start crond");
    }
  }

  // -- Signal handling --------------------------------------------------------

  /** Set up process signal handlers for graceful shutdown */
  private setupSignalHandlers(): void {
    const handler = async (signal: string) => {
      trace(`signal:${signal}`);
      this.log.info(`Received ${signal}, shutting down...`);
      await this.shutdown();
      process.exit(0);
    };

    process.on("SIGTERM", () => handler("SIGTERM"));
    process.on("SIGINT", () => handler("SIGINT"));
    process.on("SIGHUP", () => {
      // Reload config on SIGHUP
      this.log.info("Received SIGHUP, reloading config...");
      try {
        this.config = loadConfig();
        this.state.initFromConfig(this.config.sessions);
        this.budget.setBudget(this.config.orchestrator.process_budget);
        this.memory.setThresholds(
          this.config.orchestrator.memory_warning_mb,
          this.config.orchestrator.memory_critical_mb,
          this.config.orchestrator.memory_emergency_mb,
        );
        this.battery.setThreshold(this.config.battery.low_threshold_pct);
        this.log.info("Config reloaded successfully");
      } catch (err) {
        this.log.error(`Config reload failed: ${err}`);
      }
    });
  }

  // -- IPC command handler ----------------------------------------------------

  /** Handle an IPC command from the CLI */
  private async handleIpcCommand(cmd: IpcCommand): Promise<IpcResponse> {
    trace(`ipc:${cmd.cmd}${(cmd as { name?: string }).name ? `:${(cmd as { name?: string }).name}` : ""}`);
    switch (cmd.cmd) {
      case "status":
        return this.cmdStatus(cmd.name);

      case "start":
        return this.cmdStart(cmd.name);

      case "stop":
        return this.cmdStop(cmd.name);

      case "restart":
        return this.cmdRestart(cmd.name);

      case "health":
        return this.cmdHealth();

      case "boot":
        // Run boot async and respond immediately
        this.boot().catch((err) => this.log.error(`Boot failed: ${err}`));
        return { ok: true, data: "Boot sequence started" };

      case "shutdown":
        // Run shutdown async and respond before exiting
        setTimeout(() => this.shutdown(cmd.kill).then(() => process.exit(0)), 100);
        return { ok: true, data: "Shutdown initiated" };

      case "go":
        return this.cmdGo(cmd.name);

      case "send":
        return this.cmdSend(cmd.name, cmd.text);

      case "tabs":
        return this.cmdTabs(cmd.names);

      case "config":
        return { ok: true, data: this.config };

      case "memory":
        return this.cmdMemory();

      case "open":
        return this.cmdOpen(cmd.path, cmd.name, cmd.auto_go, cmd.priority);

      case "close":
        return this.cmdClose(cmd.name);

      case "recent":
        return this.cmdRecent(cmd.count);

      case "suspend":
        return this.cmdSuspend(cmd.name);

      case "resume":
        return this.cmdResume(cmd.name);

      case "suspend-others":
        return this.cmdSuspendOthers(cmd.name);

      case "suspend-all":
        return this.cmdSuspendAll();

      case "resume-all":
        return this.cmdResumeAll();

      case "register":
        return this.cmdRegister(cmd.path);

      case "clone":
        return this.cmdClone(cmd.url, cmd.name);

      case "create":
        return this.cmdCreate(cmd.name);

      default:
        return { ok: false, error: `Unknown command: ${(cmd as { cmd: string }).cmd}` };
    }
  }

  /** Status command — return session states and daemon info */
  private cmdStatus(name?: string): IpcResponse {
    const state = this.state.getState();

    if (name) {
      const resolved = this.resolveName(name);
      if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
      const s = state.sessions[resolved];
      if (!s) return { ok: false, error: `No state for session: ${resolved}` };
      return { ok: true, data: { session: s, config: this.config.sessions.find((c) => c.name === resolved) } };
    }

    return {
      ok: true,
      data: {
        daemon_start: state.daemon_start,
        boot_complete: state.boot_complete,
        adb_fixed: state.adb_fixed,
        procs: this.budget.check(),
        wake_lock: this.wake.isHeld(),
        memory: state.memory ?? null,
        battery: state.battery ?? null,
        sessions: Object.values(state.sessions).map((s) => {
          const cfg = this.config.sessions.find((c) => c.name === s.name);
          return {
            ...s,
            type: cfg?.type ?? "daemon",
            path: cfg?.path ?? null,
            has_build_script: cfg?.path ? existsSync(join(cfg.path, "build-on-termux.sh")) : false,
            uptime: s.uptime_start ? formatUptime(new Date(s.uptime_start)) : null,
          };
        }),
      },
    };
  }

  /** Start command — start one or all sessions (re-enables boot-disabled sessions on demand) */
  private async cmdStart(name?: string): Promise<IpcResponse> {
    if (name) {
      const resolved = this.resolveName(name);
      if (!resolved) {
        // Not a loaded session — try fuzzy-matching to open it
        return this.cmdOpen(name);
      }
      // Re-enable if disabled by boot recency filtering (on-demand play)
      const sessionConfig = this.config.sessions.find((s) => s.name === resolved);
      if (sessionConfig && !sessionConfig.enabled) {
        sessionConfig.enabled = true;
        this.log.info(`Re-enabled session '${resolved}' for on-demand start`, { session: resolved });
      }
      const success = await this.startSession(resolved);
      return { ok: success, data: success ? `Started '${resolved}'` : `Failed to start '${resolved}'` };
    }
    await this.startAllSessions();
    return { ok: true, data: "All sessions started" };
  }

  /** Stop command — stop one or all sessions */
  private async cmdStop(name?: string): Promise<IpcResponse> {
    if (name) {
      const resolved = this.resolveName(name);
      if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
      const success = await this.stopSessionByName(resolved);
      return { ok: success, data: success ? `Stopped '${resolved}'` : `Failed to stop '${resolved}'` };
    }
    // Stop all in reverse dependency order
    const shutdownOrder = computeShutdownOrder(this.config.sessions);
    for (const batch of shutdownOrder) {
      await Promise.all(batch.sessions.map((n) => this.stopSessionByName(n)));
    }
    return { ok: true, data: "All sessions stopped" };
  }

  /** Restart command */
  private async cmdRestart(name?: string): Promise<IpcResponse> {
    if (name) {
      const resolved = this.resolveName(name);
      if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
      await this.stopSessionByName(resolved);
      await sleep(500);
      const success = await this.startSession(resolved);
      return { ok: success, data: success ? `Restarted '${resolved}'` : `Failed to restart '${resolved}'` };
    }
    await this.cmdStop();
    await sleep(500);
    return this.cmdStart();
  }

  /** Health command — run health sweep now */
  private cmdHealth(): IpcResponse {
    const results = runHealthSweep(this.config, this.state, this.log, this.adoptedPids);
    return { ok: true, data: results };
  }

  /** Memory command — return system memory + per-session RSS + pressure */
  private cmdMemory(): IpcResponse {
    const sysMem = this.memory.getSystemMemory();
    const sessions: Array<{ name: string; rss_mb: number | null; activity: string | null }> = [];

    for (const session of this.config.sessions) {
      const s = this.state.getSession(session.name);
      sessions.push({
        name: session.name,
        rss_mb: s?.rss_mb ?? null,
        activity: s?.activity ?? null,
      });
    }

    return {
      ok: true,
      data: {
        system: sysMem,
        sessions,
      },
    };
  }

  /** Go command — send "go" to a Claude session */
  private async cmdGo(name: string): Promise<IpcResponse> {
    const resolved = this.resolveName(name);
    if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
    const result = await sendGoToSession(resolved, this.log);
    const ok = result === "ready";
    return { ok, data: ok ? `Sent 'go' to '${resolved}'` : `Failed to send 'go' to '${resolved}' (${result})` };
  }

  /** Send command — send arbitrary text to a session */
  private cmdSend(name: string, text: string): IpcResponse {
    const resolved = this.resolveName(name);
    if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
    const sent = sendKeys(resolved, text, true);
    return { ok: sent, data: sent ? `Sent to '${resolved}'` : `Failed to send to '${resolved}'` };
  }

  /** Tabs command — create Termux UI tabs for sessions */
  private cmdTabs(names?: string[]): IpcResponse {
    const targetSessions = names?.length
      ? names.map((n) => this.resolveName(n)).filter((n): n is string => n !== null)
      : this.config.sessions
          .filter((s) => !s.headless && s.enabled)
          .map((s) => s.name);

    let restored = 0;
    let skipped = 0;

    for (let i = 0; i < targetSessions.length; i++) {
      const name = targetSessions[i];
      if (!sessionExists(name)) {
        skipped++;
        continue;
      }

      if (createTermuxTab(name, this.log)) {
        restored++;
      } else {
        skipped++;
      }

      // Stagger tab creation to avoid Termux UI race conditions.
      // TermuxService processes intents async — give each tab 1.5s to initialize.
      if (i < targetSessions.length - 1) {
        spawnSync("sleep", ["1.5"], { timeout: 3000 });
      }
    }

    return { ok: true, data: { restored, skipped, total: targetSessions.length } };
  }

  // -- Helpers ----------------------------------------------------------------

  /** Fuzzy-match a session name (prefix match) */
  private resolveName(input: string): string | null {
    const names = this.config.sessions.map((s) => s.name);
    // Also check registry entries not yet merged into config
    for (const entry of this.registry.entries()) {
      if (!names.includes(entry.name)) names.push(entry.name);
    }
    // Exact match
    if (names.includes(input)) return input;
    // Prefix match
    const matches = names.filter((n) => n.startsWith(input));
    if (matches.length === 1) return matches[0];
    // Substring match
    const substringMatches = names.filter((n) => n.includes(input));
    if (substringMatches.length === 1) return substringMatches[0];
    return null;
  }
}

/** Format uptime as a human-readable string (e.g., "2h 15m") */
function formatUptime(start: Date): string {
  const ms = Date.now() - start.getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
