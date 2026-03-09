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

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
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
} from "./session.js";

/** Promise-based sleep */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    try { if (require("fs").existsSync(p)) return p; } catch { /* skip */ }
  }
  return "adb"; // Last resort — hope PATH works
}

const ADB_BIN = resolveAdbPath();

/** Send a Termux notification */
function notify(title: string, content: string): void {
  try {
    spawnSync("termux-notification", ["--title", title, "--content", content], {
      timeout: 5000,
      stdio: "ignore",
    });
  } catch {
    // Non-fatal
  }
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
  private dashboard: DashboardServer | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private memoryTimer: ReturnType<typeof setInterval> | null = null;
  private adbRetryTimer: ReturnType<typeof setInterval> | null = null;
  private adbSerial: string | null = null;
  private adbSerialExpiry = 0;
  /** Cached local IP for ADB self-identification */
  private localIp: string | null = null;
  private localIpExpiry = 0;
  private static readonly LOCAL_IP_TTL_MS = 60_000;
  private running = false;

  constructor(configPath?: string) {
    this.config = loadConfig(configPath);
    this.log = new Logger(this.config.orchestrator.log_dir);
    this.state = new StateManager(this.config.orchestrator.state_file, this.log);
    this.budget = new BudgetTracker(this.config.orchestrator.process_budget, this.log);
    this.wake = new WakeLockManager(this.config.orchestrator.wake_lock_policy, this.log);
    this.memory = new MemoryMonitor(
      this.log,
      this.config.orchestrator.memory_warning_mb,
      this.config.orchestrator.memory_critical_mb,
      this.config.orchestrator.memory_emergency_mb,
    );
    this.activity = new ActivityDetector(this.log);

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
    this.preflight();
    this.running = true;
    this.log.info("Daemon starting", {
      sessions: this.config.sessions.length,
      budget: this.config.orchestrator.process_budget,
      wake_policy: this.config.orchestrator.wake_lock_policy,
    });

    // Initialize state from config
    this.state.resetDaemonStart();
    this.state.initFromConfig(this.config.sessions);

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

    // Start HTTP dashboard if configured
    await this.startDashboard();

    notify("tmx daemon", "Orchestrator started");

    // Keep process alive
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!this.running) {
          clearInterval(check);
          resolve();
        }
      }, 1000);
    });
  }

  /** Full boot sequence: ADB fix → dependency-ordered start → cron */
  async boot(): Promise<void> {
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

    // Step 2: Start sessions in dependency order (with boot timeout)
    const timedOut = await this.startAllSessions(bootDeadline);

    // Step 3: Start cron daemon if not running
    this.startCron();

    // Step 4: Restore Termux tabs for non-headless running sessions.
    // The watchdog.sh handles the initial tmux attach (exec tmux attach),
    // but switch-client needs a client to exist first. Run after a brief
    // delay so the watchdog has time to attach.
    setTimeout(() => {
      const tabResult = this.cmdTabs();
      if (tabResult.ok) {
        const data = tabResult.data as { restored: number; skipped: number };
        this.log.info(`Auto-tabs: restored=${data.restored} skipped=${data.skipped}`);
      }
    }, 3000);

    // Step 5: Mark boot complete
    this.state.setBootComplete(true);
    this.wake.evaluate("boot_end", this.state.getState().sessions);

    const sessionCount = this.config.sessions.filter((s) => s.enabled).length;
    const runningCount = Object.values(this.state.getState().sessions)
      .filter((s) => s.status === "running").length;

    if (timedOut) {
      this.log.warn(`Boot timed out after ${this.config.orchestrator.boot_timeout_s}s: ${runningCount}/${sessionCount} sessions running`);
      notify("tmx boot", `Timed out: ${runningCount}/${sessionCount} sessions`);
    } else {
      this.log.info(`Boot complete: ${runningCount}/${sessionCount} sessions running`);
      notify("tmx boot", `${runningCount}/${sessionCount} sessions running`);
    }
  }

  /** Graceful shutdown — reverse-order stop, release wake lock, exit */
  private shutdownInProgress = false;
  async shutdown(): Promise<void> {
    if (this.shutdownInProgress) return;
    this.shutdownInProgress = true;
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
    if (this.adbRetryTimer) {
      clearInterval(this.adbRetryTimer);
      this.adbRetryTimer = null;
    }

    // Stop sessions in reverse dependency order
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

    // Release wake lock
    this.wake.forceRelease();

    // Stop dashboard server
    if (this.dashboard) {
      this.dashboard.stop();
      this.dashboard = null;
    }

    // Stop IPC server
    this.ipc.stop();

    this.running = false;
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
    const sessionConfig = this.config.sessions.find((s) => s.name === name);
    if (!sessionConfig) {
      this.log.error(`Unknown session '${name}'`);
      return false;
    }

    if (!sessionConfig.enabled) {
      this.log.debug(`Session '${name}' is disabled, skipping`, { session: name });
      return false;
    }

    // Check process budget
    if (!this.budget.canStartSession()) {
      this.log.error(`Cannot start '${name}' — process budget critical`, { session: name });
      this.state.transition(name, "failed", "Process budget critical");
      notify("tmx budget", `Cannot start '${name}' — process budget critical`);
      return false;
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

    // Create the tmux session
    const created = createSession(sessionConfig, this.log);
    if (!created) {
      this.state.transition(name, "failed", "Failed to create tmux session");
      return false;
    }

    // For Claude sessions, wait for readiness and optionally send "go"
    if (sessionConfig.type === "claude") {
      // Don't block the startup for readiness — handle in background
      this.handleClaudeStartup(name, sessionConfig);
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

    if (readinessResult === "ready") {
      this.state.transition(name, "running");
    } else if (readinessResult === "timeout") {
      // Timeout — session may still be loading, mark degraded so health checks kick in
      this.state.transition(name, "running"); // must go through running first
      this.state.transition(name, "degraded");
      this.log.warn(`Session '${name}' entered degraded state (readiness timeout)`, { session: name });
    }
    // "disappeared" — session is gone, leave in starting (health check will handle)
  }

  /** Stop a single session by name */
  private async stopSessionByName(name: string): Promise<boolean> {
    const s = this.state.getSession(name);
    if (!s) return false;

    if (s.status === "stopped" || s.status === "pending") return true;

    this.state.transition(name, "stopping");
    const stopped = await stopSession(name, this.log);
    if (stopped) {
      this.state.transition(name, "stopped");
    } else {
      // Force-set to stopped anyway
      this.state.forceStatus(name, "stopped");
    }

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

    // Recover sessions whose state claims they're active but tmux session is gone.
    // Handles: post-reboot (state.json persists but tmux is dead), OOM kills,
    // and sessions stuck in transient states (stopping/starting).
    for (const cfg of this.config.sessions) {
      const s = this.state.getSession(cfg.name);
      if (!s) continue;
      const isActiveState = s.status === "running" || s.status === "degraded" ||
        s.status === "stopping" || s.status === "starting";
      if (isActiveState && !existingSessions.has(cfg.name)) {
        this.log.info(`Recovering stale '${s.status}' session '${cfg.name}' → stopped`, { session: cfg.name });
        this.state.forceStatus(cfg.name, "stopped");
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
        notify("tmx boot", "ADB fix failed — processes may be killed");

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
   * Checks that the serial IP matches localhost or this device's local IP.
   */
  private isLocalAdbDevice(): boolean {
    const serial = this.resolveAdbSerial();
    if (!serial) return false;

    // Localhost connections are always local
    if (serial.startsWith("127.0.0.1:") || serial.startsWith("localhost:")) return true;

    // Check if serial IP matches local IP
    const localIp = this.getLocalIp();
    if (localIp && serial.startsWith(`${localIp}:`)) return true;

    // Serial doesn't match any local address — might be an external device
    return false;
  }

  /** Apply Android 12+ phantom process killer fix via ADB */
  private applyPhantomFix(): void {
    // Safety check: only apply settings to this device, not external phones
    if (!this.isLocalAdbDevice()) {
      const serial = this.resolveAdbSerial();
      this.log.warn(`Skipping phantom fix — ADB device '${serial}' may not be this device`);
      return;
    }

    const shellCmds = [
      ["/system/bin/device_config", "put", "activity_manager", "max_phantom_processes", "2147483647"],
      ["settings", "put", "global", "settings_enable_monitor_phantom_procs", "false"],
    ];

    // Also re-enable Samsung sensor packages
    const samsungPkgs = [
      "com.samsung.android.ssco",
      "com.samsung.android.mocca",
      "com.samsung.android.camerasdkservice",
    ];

    for (const cmd of shellCmds) {
      try {
        spawnSync(ADB_BIN, this.adbShellArgs(...cmd), { timeout: 10_000, stdio: "ignore" });
      } catch (err) {
        this.log.warn(`Phantom fix command failed: ${cmd.join(" ")}`, { error: String(err) });
      }
    }

    for (const pkg of samsungPkgs) {
      try {
        spawnSync(ADB_BIN, this.adbShellArgs("pm", "enable", pkg), { timeout: 10_000, stdio: "ignore" });
      } catch {
        // Non-critical
      }
    }

    this.log.info("Phantom process fix applied");
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
    const intervalMs = this.config.orchestrator.health_interval_s * 1000;
    this.healthTimer = setInterval(() => {
      this.healthSweepAndRestart();
    }, intervalMs);
  }

  /** Run health sweep and handle auto-restarts for degraded sessions */
  private async healthSweepAndRestart(): Promise<void> {
    const results = runHealthSweep(this.config, this.state, this.log);

    // Check for degraded sessions needing restart
    for (const session of this.config.sessions) {
      const s = this.state.getSession(session.name);
      if (!s || s.status !== "degraded") continue;

      // Check restart limit
      if (s.restart_count >= session.max_restarts) {
        this.state.transition(session.name, "failed",
          `Exceeded max restarts (${session.max_restarts})`);
        notify("tmx", `Session '${session.name}' failed — max restarts exceeded`);
        continue;
      }

      // Apply backoff: wait restart_backoff_s * 2^restart_count
      const backoffMs = session.restart_backoff_s * Math.pow(2, s.restart_count) * 1000;
      this.log.info(`Auto-restarting '${session.name}' in ${backoffMs}ms (attempt ${s.restart_count + 1})`, {
        session: session.name,
      });

      // Transition to starting (increments restart_count)
      this.state.transition(session.name, "starting");

      // Schedule the actual restart
      setTimeout(async () => {
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
    }

    // Check process budget
    const budgetStatus = this.budget.check();
    if (budgetStatus.mode === "critical") {
      this.log.error("Process budget critical", budgetStatus as unknown as Record<string, unknown>);
      notify("tmx budget", `Critical: ${budgetStatus.total_procs}/${budgetStatus.budget} processes`);
    }
  }

  // -- Memory monitoring & OOM shedding ----------------------------------------

  /** Start periodic memory monitoring timer (every 15s) */
  private startMemoryTimer(): void {
    this.memoryTimer = setInterval(() => {
      this.memoryPollAndShed();
    }, 15_000);
    // Run an initial poll immediately
    this.memoryPollAndShed();
  }

  /** Poll system memory, update per-session RSS/activity, shed if needed */
  private memoryPollAndShed(): void {
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

      // Get tmux pane PID for this session
      const pid = this.memory.getSessionPid(session.name);
      if (pid === null) {
        this.state.updateSessionMetrics(session.name, null, "stopped");
        continue;
      }

      // Get RSS for the full process tree
      const { rss_mb } = this.memory.getProcessTreeRss(pid);

      // Classify activity based on CPU ticks
      const activityState = this.activity.classifyTree(session.name, pid);

      this.state.updateSessionMetrics(session.name, rss_mb, activityState);
    }

    // Check if we need to shed sessions due to memory pressure
    if (sysMem.pressure !== "normal") {
      this.log.warn(`Memory pressure: ${sysMem.pressure} (${sysMem.available_mb}MB available)`, {
        available_mb: sysMem.available_mb,
        total_mb: sysMem.total_mb,
        pressure: sysMem.pressure,
      });
    }

    if (sysMem.pressure === "critical" || sysMem.pressure === "emergency") {
      this.shedIdleSessions(sysMem.pressure);
    }

    // Push SSE update with combined state+memory
    this.pushSseState();
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
   * Shed sessions to reduce memory pressure.
   * Priority: stop idle sessions first (lowest priority number = most important),
   * then active sessions if still in emergency.
   */
  private async shedIdleSessions(pressure: "critical" | "emergency"): Promise<void> {
    // Collect candidate sessions sorted by priority (highest number = least important)
    const candidates: Array<{ name: string; priority: number; activity: string | null }> = [];
    for (const session of this.config.sessions) {
      const s = this.state.getSession(session.name);
      if (!s || s.status !== "running") continue;
      candidates.push({
        name: session.name,
        priority: session.priority,
        activity: s.activity,
      });
    }

    // Sort: idle first, then by priority descending (least important first)
    candidates.sort((a, b) => {
      const aIdle = a.activity === "idle" ? 0 : 1;
      const bIdle = b.activity === "idle" ? 0 : 1;
      if (aIdle !== bIdle) return aIdle - bIdle;
      return b.priority - a.priority; // higher priority number = less important
    });

    // In critical mode, shed idle headless services first
    // In emergency mode, shed any idle session
    const maxShed = pressure === "emergency" ? 2 : 1;
    let shedCount = 0;

    for (const candidate of candidates) {
      if (shedCount >= maxShed) break;

      const sessionConfig = this.config.sessions.find((s) => s.name === candidate.name);
      if (!sessionConfig) continue;

      // In critical, only shed idle sessions; in emergency, shed idle first then active
      if (pressure === "critical" && candidate.activity !== "idle") continue;
      if (pressure === "emergency" && candidate.activity !== "idle" && shedCount === 0) {
        // Try idle first even in emergency
        const hasIdle = candidates.some((c) => c.activity === "idle");
        if (hasIdle) continue;
      }

      this.log.warn(`Shedding session '${candidate.name}' due to ${pressure} memory pressure`, {
        session: candidate.name,
        activity: candidate.activity,
        priority: candidate.priority,
      });

      notify("tmx memory", `Shedding '${candidate.name}' — ${pressure} memory pressure`);
      await this.stopSessionByName(candidate.name);
      shedCount++;
    }

    if (shedCount === 0) {
      this.log.warn("No sessions available to shed");
      notify("tmx memory", `${pressure} memory pressure — no sessions to shed`);
    }
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
        case "go":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Session name required" } };
          resp = await this.cmdGo(name);
          break;
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
          // Proxy to CFC bridge health endpoint
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
        case "tab":
          // Open Termux tab attached to a session
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Session name required" } };
          if (createTermuxTab(name, this.log)) {
            return { status: 200, data: { ok: true, session: name } };
          }
          return { status: 500, data: { error: `Failed to open tab for '${name}'` } };
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
        default:
          return { status: 404, data: { error: `Unknown endpoint: ${command}` } };
      }

      return { status: resp.ok ? 200 : 400, data: resp.ok ? resp.data : { error: resp.error } };
    } catch (err) {
      return { status: 500, data: { error: String(err) } };
    }
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
        this.log.info("Config reloaded successfully");
      } catch (err) {
        this.log.error(`Config reload failed: ${err}`);
      }
    });
  }

  // -- IPC command handler ----------------------------------------------------

  /** Handle an IPC command from the CLI */
  private async handleIpcCommand(cmd: IpcCommand): Promise<IpcResponse> {
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
        setTimeout(() => this.shutdown().then(() => process.exit(0)), 100);
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
        budget: this.budget.check(),
        wake_lock: this.wake.isHeld(),
        memory: state.memory ?? null,
        sessions: Object.values(state.sessions).map((s) => ({
          ...s,
          uptime: s.uptime_start ? formatUptime(new Date(s.uptime_start)) : null,
        })),
      },
    };
  }

  /** Start command — start one or all sessions */
  private async cmdStart(name?: string): Promise<IpcResponse> {
    if (name) {
      const resolved = this.resolveName(name);
      if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
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
    const results = runHealthSweep(this.config, this.state, this.log);
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
      ? names.map((n) => this.resolveName(n)).filter(Boolean) as string[]
      : this.config.sessions
          .filter((s) => !s.headless && s.enabled)
          .map((s) => s.name);

    let restored = 0;
    let skipped = 0;

    for (const name of targetSessions) {
      if (!sessionExists(name)) {
        skipped++;
        continue;
      }

      if (createTermuxTab(name, this.log)) {
        restored++;
      } else {
        skipped++;
      }

      // Stagger to avoid UI race conditions (same as restore-tabs.sh)
      // This is synchronous within the loop
    }

    return { ok: true, data: { restored, skipped, total: targetSessions.length } };
  }

  // -- Helpers ----------------------------------------------------------------

  /** Fuzzy-match a session name (prefix match) */
  private resolveName(input: string): string | null {
    const names = this.config.sessions.map((s) => s.name);
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
