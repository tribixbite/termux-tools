/**
 * tmx.ts — CLI entry point and command router
 *
 * Usage: tmx [command] [args...]
 * See `tmx --help` for available commands.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { IpcClient } from "./ipc.js";
import { Daemon } from "./daemon.js";
import { loadConfig, findConfigPath, validateConfigFile } from "./config.js";
import { Logger } from "./log.js";
import { parseReposConf, generateToml, findReposConf } from "./migrate.js";
import type { IpcCommand, HealthResult } from "./types.js";
import type { DaemonStatusData, SessionDetailData, ConfigSessionRow, MemoryData } from "./display-types.js";
import { parseRecentProjects } from "./registry.js";
import type { RecentProject } from "./registry.js";

// -- ANSI helpers -------------------------------------------------------------

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

/** Status → colored display string */
const STATUS_COLORS: Record<string, string> = {
  running:  `${GREEN}running${RESET}`,
  degraded: `${YELLOW}degraded${RESET}`,
  starting: `${CYAN}starting${RESET}`,
  waiting:  `${CYAN}waiting${RESET}`,
  stopping: `${YELLOW}stopping${RESET}`,
  stopped:  `${DIM}stopped${RESET}`,
  failed:   `${RED}failed${RESET}`,
  pending:  `${DIM}pending${RESET}`,
};

/**
 * Resolve the bun wrapper path for spawning child processes.
 * On Termux, `bun` is a bash wrapper that invokes grun (glibc-runner) + buno.
 * process.argv[0] resolves to the raw buno binary which can't run standalone
 * on Android (causes "invalid ELF header"). We need the wrapper script.
 */
function resolveBunPath(): string {
  // Try `which bun` first — returns the wrapper script path
  try {
    const result = spawnSync("which", ["bun"], { encoding: "utf-8", timeout: 3000 });
    if (result.stdout?.trim()) return result.stdout.trim();
  } catch { /* fall through */ }
  // Fallback: check common locations
  const home = process.env.HOME ?? "/data/data/com.termux/files/home";
  const candidates = [
    join(home, ".bun", "bin", "bun"),
    join(process.env.PREFIX ?? "/data/data/com.termux/files/usr", "bin", "bun"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Last resort — use process.argv[0] and hope for the best
  return process.argv[0];
}

// -- CLI router ---------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0] ?? "status";
const subArgs = args.slice(1);

main().catch((err) => {
  console.error(`${RED}Error: ${err.message}${RESET}`);
  process.exit(1);
});

async function main(): Promise<void> {
  switch (command) {
    case "daemon":
      return runDaemon();

    case "boot":
      return runBoot();

    case "config":
      return runConfig();

    case "migrate":
      return runMigrate();

    case "logs":
      return runLogs();

    case "recent":
      return runRecentOrIpc();

    case "--help":
    case "-h":
    case "help":
      return printHelp();

    case "--version":
    case "-v":
      return printVersion();

    case "upgrade":
      return runUpgrade();

    // Commands that proxy to daemon via IPC
    case "status":
    case "start":
    case "stop":
    case "restart":
    case "health":
    case "memory":
    case "shutdown":
    case "go":
    case "send":
    case "tabs":
    case "open":
    case "close":
      return runIpcCommand();

    default:
      // Try as a fuzzy session name → status
      return runIpcCommand();
  }
}

// -- Command implementations -------------------------------------------------

/** Start the daemon in foreground mode */
async function runDaemon(): Promise<void> {
  const configPath = getConfigFlag();
  const daemon = new Daemon(configPath);
  await daemon.start();
}

/** Boot sequence: start daemon if needed, then boot all sessions */
async function runBoot(): Promise<void> {
  const configPath = getConfigFlag();
  const client = getClient(configPath);

  // Check if daemon is already running
  const running = await client.isRunning();
  if (!running) {
    // Start daemon in background (fork), capturing stderr for diagnostics
    console.log(`${CYAN}Starting daemon...${RESET}`);
    const daemonArgs = ["daemon"];
    if (configPath) daemonArgs.push("--config", configPath);

    // Resolve log dir for stderr capture
    let logDir: string;
    try {
      const config = loadConfig(configPath);
      logDir = config.orchestrator.log_dir;
    } catch {
      logDir = `${process.env.HOME}/.local/share/tmx/logs`;
    }
    mkdirSync(logDir, { recursive: true });
    const stderrPath = `${logDir}/daemon-stderr.log`;
    const stderrFd = openSync(stderrPath, "a");

    // Spawn daemon using the bun wrapper (not process.argv[0] which may be the
    // raw buno binary under glibc-runner — spawning it directly bypasses grun
    // and causes "invalid ELF header" on Android/Termux).
    const bunPath = resolveBunPath();
    const child = spawn(bunPath, [process.argv[1], ...daemonArgs], {
      detached: true,
      stdio: ["ignore", "ignore", stderrFd],
    });
    child.unref();
    closeSync(stderrFd);

    // Wait for daemon to be ready (10s max)
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (await client.isRunning()) break;
    }

    if (!(await client.isRunning())) {
      console.error(`${RED}Daemon failed to start${RESET}`);
      // Show diagnostic information
      printStartupDiagnostics(logDir, stderrPath);
      process.exit(1);
    }
    console.log(`${GREEN}Daemon started${RESET}`);
  }

  // Send boot command — use extended timeout because boot runs ADB connect
  // (spawnSync, up to 50s) which blocks the event loop before the response is flushed.
  const bootTimeoutMs = 90_000;
  const resp = await client.send({ cmd: "boot" }, bootTimeoutMs);
  if (resp.ok) {
    console.log(`${GREEN}Boot sequence initiated${RESET}`);
  } else {
    console.error(`${RED}Boot failed: ${resp.error}${RESET}`);
    process.exit(1);
  }

  // --attach: exec into tmux after boot so this terminal becomes a tmux client.
  // Used by watchdog.sh to make its Termux tab interactive after boot.
  // The daemon's auto-tabs create dedicated tabs via TermuxService; this flag
  // makes the watchdog's own tab usable as an additional tmux client.
  if (subArgs.includes("--attach")) {
    // Brief delay for daemon's auto-tabs setTimeout(3s) to fire
    await sleep(1000);
    // Replace this process with tmux attach (first non-headless session)
    const tmuxBin = join(
      process.env.PREFIX ?? "/data/data/com.termux/files/usr", "bin", "tmux"
    );
    const { execSync: execSyncLocal } = await import("node:child_process");
    try {
      // exec replaces this process — doesn't return
      execSyncLocal(`exec "${tmuxBin}" attach`, { stdio: "inherit" });
    } catch {
      // tmux attach exited (user detached or daemon shut down) — normal exit
    }
  }
}

/**
 * Upgrade: rebuild dist, shut down the running daemon, let watchdog auto-restart.
 * If no watchdog is running, restart the daemon directly.
 */
async function runUpgrade(): Promise<void> {
  const configPath = getConfigFlag();
  const client = getClient(configPath);

  // Step 1: Build
  console.log(`${CYAN}Building...${RESET}`);
  const buildResult = spawnSync("bun", ["run", "build"], {
    cwd: join(process.env.HOME ?? "", "git/termux-tools/orchestrator"),
    encoding: "utf-8",
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (buildResult.status !== 0) {
    console.error(`${RED}Build failed:${RESET}`);
    console.error(buildResult.stderr?.trim() || buildResult.stdout?.trim());
    process.exit(1);
  }
  console.log(`${GREEN}Build OK${RESET}`);

  // Step 2: Check if daemon is running
  const running = await client.isRunning();
  if (!running) {
    console.log(`${DIM}Daemon not running — nothing to restart${RESET}`);
    return;
  }

  // Step 3: Send shutdown — watchdog will auto-restart with new build
  console.log(`${CYAN}Shutting down daemon...${RESET}`);
  try {
    await client.send({ cmd: "shutdown" }, 10_000);
  } catch {
    // May timeout because daemon exits before responding — that's fine
  }

  // Step 4: Wait for daemon to die
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    if (!(await client.isRunning())) break;
  }

  if (await client.isRunning()) {
    console.error(`${RED}Daemon didn't stop cleanly${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}Daemon stopped${RESET}`);

  // Step 5: Check if watchdog is running — if so, it will auto-restart
  const watchdogCheck = spawnSync("pgrep", ["-f", "watchdog.sh"], {
    timeout: 3000,
    stdio: "ignore",
  });
  if (watchdogCheck.status === 0) {
    console.log(`${DIM}Watchdog detected — daemon will auto-restart${RESET}`);
    // Wait for the watchdog to restart the daemon
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      if (await client.isRunning()) {
        console.log(`${GREEN}Daemon restarted by watchdog${RESET}`);
        return;
      }
    }
    console.error(`${YELLOW}Watchdog didn't restart daemon within 20s — try 'tmx boot'${RESET}`);
    return;
  }

  // No watchdog — restart daemon directly
  console.log(`${CYAN}No watchdog — restarting daemon directly...${RESET}`);
  const bootArgs = ["boot"];
  if (configPath) bootArgs.push("--config", configPath);

  // Re-use runBoot logic by running tmx boot as a subprocess
  const bunPath = resolveBunPath();
  const bootResult = spawnSync(bunPath, [process.argv[1], ...bootArgs], {
    encoding: "utf-8",
    timeout: 120_000,
    stdio: "inherit",
  });
  process.exit(bootResult.status ?? 1);
}

/** Print diagnostic info when daemon fails to start */
function printStartupDiagnostics(logDir: string, stderrPath: string): void {
  console.error();

  // Show stderr output if available
  try {
    if (existsSync(stderrPath)) {
      const stderr = readFileSync(stderrPath, "utf-8").trim();
      if (stderr) {
        const lines = stderr.split("\n").slice(-20);
        console.error(`${YELLOW}Daemon stderr (last ${lines.length} lines):${RESET}`);
        for (const line of lines) {
          console.error(`  ${DIM}${line}${RESET}`);
        }
        console.error();
      }
    }
  } catch { /* ignore */ }

  // Show recent log entries if available
  try {
    const logFile = `${logDir}/tmx.jsonl`;
    if (existsSync(logFile)) {
      const content = readFileSync(logFile, "utf-8").trim();
      if (content) {
        const entries = content.split("\n").slice(-10);
        console.error(`${YELLOW}Recent log entries:${RESET}`);
        for (const raw of entries) {
          try {
            const entry = JSON.parse(raw) as { ts: string; level: string; msg: string };
            const time = entry.ts?.slice(11, 23) ?? "";
            const color = entry.level === "error" ? RED : entry.level === "warn" ? YELLOW : DIM;
            console.error(`  ${DIM}${time}${RESET} ${color}${entry.level}${RESET} ${entry.msg}`);
          } catch {
            console.error(`  ${DIM}${raw.slice(0, 120)}${RESET}`);
          }
        }
        console.error();
      }
    }
  } catch { /* ignore */ }

  console.error(`${CYAN}Suggestions:${RESET}`);
  console.error(`  ${DIM}1.${RESET} Check logs:    ${BOLD}tmx logs${RESET}`);
  console.error(`  ${DIM}2.${RESET} Validate config: ${BOLD}tmx config${RESET}`);
  console.error(`  ${DIM}3.${RESET} Run foreground: ${BOLD}tmx daemon${RESET}`);
  console.error(`  ${DIM}4.${RESET} Check stderr:   ${BOLD}cat ${stderrPath}${RESET}`);
}

/** Validate and print resolved config */
function runConfig(): void {
  const configPath = getConfigFlag();
  const found = findConfigPath(configPath);
  if (!found) {
    console.error(`${RED}No config file found${RESET}`);
    console.error(`Copy tmx.toml.example to ~/.config/tmx/tmx.toml`);
    process.exit(1);
  }

  console.log(`${DIM}Config: ${found}${RESET}`);
  const errors = validateConfigFile(found);
  if (errors.length > 0) {
    console.error(`${RED}Validation errors:${RESET}`);
    for (const e of errors) {
      console.error(`  ${e}`);
    }
    process.exit(1);
  }

  const config = loadConfig(configPath);
  console.log(`${GREEN}Config valid${RESET}`);
  console.log();

  // Print summary table
  console.log(`${BOLD}Orchestrator${RESET}`);
  console.log(`  socket:           ${config.orchestrator.socket}`);
  console.log(`  state_file:       ${config.orchestrator.state_file}`);
  console.log(`  log_dir:          ${config.orchestrator.log_dir}`);
  console.log(`  health_interval:  ${config.orchestrator.health_interval_s}s`);
  console.log(`  process_budget:   ${config.orchestrator.process_budget}`);
  console.log(`  wake_lock_policy: ${config.orchestrator.wake_lock_policy}`);
  console.log(`  dashboard_port:   ${config.orchestrator.dashboard_port}`);
  console.log(`  memory_warn/crit: ${config.orchestrator.memory_warning_mb}/${config.orchestrator.memory_critical_mb}/${config.orchestrator.memory_emergency_mb} MB`);
  console.log();

  console.log(`${BOLD}ADB${RESET}`);
  console.log(`  enabled:     ${config.adb.enabled}`);
  console.log(`  phantom_fix: ${config.adb.phantom_fix}`);
  console.log(`  boot_delay:  ${config.adb.boot_delay_s}s`);
  console.log();

  console.log(`${BOLD}Battery${RESET}`);
  console.log(`  enabled:     ${config.battery.enabled}`);
  console.log(`  low_thresh:  ${config.battery.low_threshold_pct}%`);
  console.log(`  poll_every:  ${config.battery.poll_interval_s}s`);
  console.log();

  console.log(`${BOLD}Sessions (${config.sessions.length})${RESET}`);
  printSessionTable(config.sessions.map((s) => ({
    name: s.name,
    type: s.type,
    enabled: s.enabled,
    priority: s.priority,
    auto_go: s.auto_go,
    headless: s.headless,
    depends_on: s.depends_on,
  })));
}

/** Migrate repos.conf to tmx.toml */
function runMigrate(): void {
  const confPath = subArgs[0] ?? findReposConf();
  if (!confPath) {
    console.error(`${RED}repos.conf not found${RESET}`);
    console.error("Usage: tmx migrate [path/to/repos.conf]");
    process.exit(1);
  }

  console.log(`${DIM}Parsing: ${confPath}${RESET}`);
  const entries = parseReposConf(confPath);
  console.log(`Found ${entries.length} entries`);

  const toml = generateToml(entries);

  const outPath = subArgs[1] ?? `${process.env.HOME}/.config/tmx/tmx.toml`;
  const outDir = outPath.substring(0, outPath.lastIndexOf("/"));
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  if (existsSync(outPath)) {
    console.log(`${YELLOW}${outPath} already exists — writing to ${outPath}.new${RESET}`);
    writeFileSync(`${outPath}.new`, toml);
    console.log(`${GREEN}Written to ${outPath}.new${RESET}`);
  } else {
    writeFileSync(outPath, toml);
    console.log(`${GREEN}Written to ${outPath}${RESET}`);
  }

  // Print entries for review
  console.log();
  for (const entry of entries) {
    const status = entry.enabled ? `${GREEN}enabled${RESET}` : `${DIM}disabled${RESET}`;
    const go = entry.auto_go ? ` ${CYAN}auto_go${RESET}` : "";
    console.log(`  ${entry.name}: ${status}${go}`);
  }
}

/** Tail structured logs */
function runLogs(): void {
  const configPath = getConfigFlag();
  try {
    const config = loadConfig(configPath);
    const log = new Logger(config.orchestrator.log_dir);
    const sessionFilter = subArgs[0];
    const entries = log.readTail(50, sessionFilter);

    if (entries.length === 0) {
      console.log(`${DIM}No log entries${sessionFilter ? ` for '${sessionFilter}'` : ""}${RESET}`);
      return;
    }

    for (const entry of entries) {
      const time = entry.ts.slice(11, 23);
      const level = entry.level.toUpperCase().padEnd(5);
      const color = STATUS_COLORS[entry.level] ? "" :
        entry.level === "error" ? RED :
        entry.level === "warn" ? YELLOW :
        entry.level === "info" ? CYAN : DIM;
      const session = entry.session ? ` ${DIM}[${entry.session}]${RESET}` : "";
      console.log(`${DIM}${time}${RESET} ${color}${level}${RESET}${session} ${entry.msg}`);
    }
  } catch (err) {
    console.error(`${RED}${(err as Error).message}${RESET}`);
    process.exit(1);
  }
}

/** Show recent projects — works with or without daemon */
async function runRecentOrIpc(): Promise<void> {
  const configPath = getConfigFlag();
  const client = getClient(configPath);
  const count = subArgs[0] ? parseInt(subArgs[0], 10) : 20;

  // Try daemon first (has enriched status info)
  if (await client.isRunning()) {
    const resp = await client.send({ cmd: "recent", count });
    if (resp.ok) {
      formatOutput("recent", resp.data);
      return;
    }
  }

  // Fallback: parse history.jsonl directly (no running/registered status)
  const home = process.env.HOME ?? "";
  const historyPath = join(home, ".claude", "history.jsonl");
  const projects = parseRecentProjects(historyPath, 1000);

  if (projects.length === 0) {
    console.log(`${DIM}No recent projects found${RESET}`);
    return;
  }

  console.log(`${BOLD}Recent projects${RESET} ${DIM}(daemon not running — status unavailable)${RESET}`);
  for (const p of projects.slice(0, count)) {
    const shortPath = p.path.startsWith(home) ? "~" + p.path.slice(home.length) : p.path;
    const ago = timeSince(p.last_active);
    console.log(`  ${p.name.padEnd(20)} ${shortPath.padEnd(40)} ${DIM}${ago} ago${RESET}`);
  }
}

/** Send a command to the daemon via IPC */
async function runIpcCommand(): Promise<void> {
  const configPath = getConfigFlag();
  const client = getClient(configPath);

  // Check daemon is running
  const running = await client.isRunning();
  if (!running) {
    console.error(`${RED}Daemon not running. Start with: tmx boot${RESET}`);
    process.exit(1);
  }

  let cmd: IpcCommand;

  switch (command) {
    case "status":
      cmd = { cmd: "status", name: subArgs[0] };
      break;
    case "start":
      cmd = { cmd: "start", name: subArgs[0] };
      break;
    case "stop":
      cmd = { cmd: "stop", name: subArgs[0] };
      break;
    case "restart":
      cmd = { cmd: "restart", name: subArgs[0] };
      break;
    case "health":
      cmd = { cmd: "health" };
      break;
    case "shutdown":
      cmd = { cmd: "shutdown" };
      break;
    case "memory":
      cmd = { cmd: "memory" };
      break;
    case "go":
      if (!subArgs[0]) {
        console.error(`Usage: tmx go <session-name>`);
        process.exit(1);
      }
      cmd = { cmd: "go", name: subArgs[0] };
      break;
    case "send":
      if (!subArgs[0] || !subArgs[1]) {
        console.error(`Usage: tmx send <session-name> <text>`);
        process.exit(1);
      }
      cmd = { cmd: "send", name: subArgs[0], text: subArgs.slice(1).join(" ") };
      break;
    case "tabs":
      cmd = { cmd: "tabs", names: subArgs.length ? subArgs : undefined };
      break;
    case "open":
      if (!subArgs[0]) {
        console.error(`Usage: tmx open <path> [--name <n>] [--auto-go] [--priority N]`);
        process.exit(1);
      }
      cmd = {
        cmd: "open",
        path: subArgs[0],
        name: getFlag(subArgs, "--name"),
        auto_go: subArgs.includes("--auto-go"),
        priority: getFlag(subArgs, "--priority") ? parseInt(getFlag(subArgs, "--priority")!, 10) : undefined,
      };
      break;
    case "close":
      if (!subArgs[0]) {
        console.error(`Usage: tmx close <name>`);
        process.exit(1);
      }
      cmd = { cmd: "close", name: subArgs[0] };
      break;
    case "recent":
      cmd = { cmd: "recent", count: subArgs[0] ? parseInt(subArgs[0], 10) : undefined };
      break;
    default:
      // Try as fuzzy session name → status
      cmd = { cmd: "status", name: command };
      break;
  }

  const resp = await client.send(cmd);

  if (!resp.ok) {
    console.error(`${RED}${resp.error}${RESET}`);
    process.exit(1);
  }

  // Format output based on command
  formatOutput(command, resp.data);
}

// -- Output formatting --------------------------------------------------------

function formatOutput(cmd: string, data: unknown): void {
  if (!data) return;

  switch (cmd) {
    case "status": {
      const d = data as Record<string, unknown>;
      if (d.session) {
        // Single session detail
        const detail = data as SessionDetailData;
        formatSingleSession(detail.session, detail.config);
      } else {
        // All sessions overview
        formatDaemonStatus(data as DaemonStatusData);
      }
      break;
    }

    case "health": {
      if (Array.isArray(data)) {
        for (const r of data as HealthResult[]) {
          const icon = r.healthy ? `${GREEN}ok${RESET}` : `${RED}fail${RESET}`;
          console.log(`  ${icon}  ${r.session.padEnd(20)} ${r.message} ${DIM}(${r.duration_ms}ms)${RESET}`);
        }
        if (data.length === 0) {
          console.log(`${DIM}No sessions to check${RESET}`);
        }
      }
      break;
    }

    case "tabs": {
      const t = data as { restored: number; skipped: number };
      console.log(`${GREEN}Restored: ${t.restored}${RESET}  ${DIM}Skipped: ${t.skipped}${RESET}`);
      break;
    }

    case "memory": {
      formatMemory(data as MemoryData);
      break;
    }

    case "recent": {
      if (Array.isArray(data)) {
        const projects = data as RecentProject[];
        if (projects.length === 0) {
          console.log(`${DIM}No recent projects found${RESET}`);
          break;
        }
        console.log(`${BOLD}Recent projects${RESET}`);
        const home = process.env.HOME ?? "";
        for (const p of projects) {
          const shortPath = p.path.startsWith(home) ? "~" + p.path.slice(home.length) : p.path;
          const statusColor = p.status === "running" ? GREEN
            : p.status === "registered" ? CYAN
            : p.status === "config" ? DIM
            : YELLOW;
          const statusLabel = `${statusColor}${p.status}${RESET}`;
          const ago = timeSince(p.last_active);
          console.log(`  ${p.name.padEnd(20)} ${shortPath.padEnd(40)} [${statusLabel}] ${DIM}${ago} ago${RESET}`);
        }
      }
      break;
    }

    default:
      if (typeof data === "string") {
        console.log(data);
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
  }
}

function formatDaemonStatus(data: DaemonStatusData): void {
  const uptimeMs = Date.now() - new Date(data.daemon_start).getTime();
  const uptime = formatDuration(uptimeMs);

  console.log(`${BOLD}tmx daemon${RESET} ${DIM}uptime ${uptime}${RESET}`);
  console.log(`  boot: ${data.boot_complete ? `${GREEN}complete${RESET}` : `${YELLOW}pending${RESET}`}`);
  console.log(`  adb:  ${data.adb_fixed ? `${GREEN}fixed${RESET}` : `${YELLOW}not fixed${RESET}`}`);
  console.log(`  wake: ${data.wake_lock ? `${GREEN}held${RESET}` : `${DIM}released${RESET}`}`);

  const b = data.budget;
  const budgetColor = b.mode === "critical" ? RED : b.mode === "warning" ? YELLOW : GREEN;
  console.log(`  procs: ${budgetColor}${b.total_procs}/${b.budget}${RESET} (${b.usage_pct}%)`);

  // Show memory if available
  if (data.memory) {
    const m = data.memory;
    const pressureColor = m.pressure === "emergency" || m.pressure === "critical" ? RED
      : m.pressure === "warning" ? YELLOW : GREEN;
    console.log(`  mem:   ${pressureColor}${m.available_mb}MB free${RESET} / ${m.total_mb}MB (${m.pressure})`);
  }

  // Show battery if available
  if (data.battery) {
    const bat = data.battery;
    const batColor = bat.percentage <= 10 ? RED : bat.percentage <= 25 ? YELLOW : GREEN;
    const chargeIcon = bat.charging ? `${GREEN}charging${RESET}` : `${DIM}discharging${RESET}`;
    const radios = bat.radios_disabled ? ` ${RED}radios off${RESET}` : "";
    console.log(`  bat:   ${batColor}${bat.percentage}%${RESET} ${chargeIcon} ${DIM}${bat.temperature.toFixed(0)}°C${RESET}${radios}`);
  }
  console.log();

  // Session table
  if (data.sessions?.length > 0) {
    const header = `${"NAME".padEnd(22)} ${"STATUS".padEnd(18)} ${"ACT".padEnd(8)} ${"RSS".padEnd(8)} ${"UPTIME".padEnd(10)} HEALTH`;
    console.log(`${DIM}${header}${RESET}`);

    for (const s of data.sessions) {
      const status = STATUS_COLORS[s.status] ?? s.status;
      const uptime = s.uptime ?? "-";
      // Activity indicator
      const actIcon = s.activity === "active" ? `${GREEN}run${RESET}`
        : s.activity === "idle" ? `${YELLOW}idle${RESET}`
        : s.activity === "stopped" ? `${DIM}stop${RESET}`
        : `${DIM}-${RESET}`;
      // RSS display
      const rss = s.rss_mb != null ? `${s.rss_mb}MB` : "-";
      const health = s.last_health_check
        ? (s.consecutive_failures > 0
          ? `${RED}${s.consecutive_failures} fail${RESET}`
          : `${GREEN}ok${RESET}`)
        : `${DIM}-${RESET}`;
      console.log(`${s.name.padEnd(22)} ${status.padEnd(27)} ${actIcon.padEnd(17)} ${rss.padEnd(8)} ${uptime.padEnd(10)} ${health}`);
    }
  }
}

/** Format memory command output */
function formatMemory(data: MemoryData): void {
  const m = data.system;
  const pressureColor = m.pressure === "emergency" || m.pressure === "critical" ? RED
    : m.pressure === "warning" ? YELLOW : GREEN;

  console.log(`${BOLD}System Memory${RESET}`);
  console.log(`  total:     ${m.total_mb} MB`);
  console.log(`  available: ${pressureColor}${m.available_mb} MB${RESET}`);
  console.log(`  used:      ${m.used_pct}%`);
  console.log(`  pressure:  ${pressureColor}${m.pressure}${RESET}`);
  if (m.swap_total_mb > 0) {
    console.log(`  swap:      ${m.swap_free_mb}/${m.swap_total_mb} MB free`);
  }
  console.log();

  // Per-session RSS
  const sessionsWithRss = data.sessions.filter((s) => s.rss_mb !== null);
  if (sessionsWithRss.length > 0) {
    console.log(`${BOLD}Session Memory${RESET}`);
    const header = `${"NAME".padEnd(22)} ${"RSS".padEnd(10)} ACTIVITY`;
    console.log(`${DIM}${header}${RESET}`);

    // Sort by RSS descending
    sessionsWithRss.sort((a, b) => (b.rss_mb ?? 0) - (a.rss_mb ?? 0));

    let totalRss = 0;
    for (const s of sessionsWithRss) {
      const rss = `${s.rss_mb}MB`;
      const actIcon = s.activity === "active" ? `${GREEN}active${RESET}`
        : s.activity === "idle" ? `${YELLOW}idle${RESET}`
        : s.activity === "stopped" ? `${DIM}stopped${RESET}`
        : `${DIM}unknown${RESET}`;
      console.log(`  ${s.name.padEnd(20)} ${rss.padEnd(10)} ${actIcon}`);
      totalRss += s.rss_mb ?? 0;
    }
    console.log(`${DIM}${"".padEnd(22)} ${(totalRss + "MB").padEnd(10)} total${RESET}`);
  } else {
    console.log(`${DIM}No session memory data available${RESET}`);
  }
}

function formatSingleSession(session: SessionDetailData["session"], config: SessionDetailData["config"]): void {
  console.log(`${BOLD}${session.name}${RESET}`);
  console.log(`  status:     ${STATUS_COLORS[session.status] ?? session.status}`);
  console.log(`  type:       ${config?.type ?? "-"}`);
  console.log(`  uptime:     ${session.uptime_start ? formatDuration(Date.now() - new Date(session.uptime_start).getTime()) : "-"}`);
  console.log(`  restarts:   ${session.restart_count}`);
  console.log(`  health:     ${session.last_health_check ? `checked ${timeSince(session.last_health_check)} ago` : "never"}`);
  if (session.consecutive_failures > 0) {
    console.log(`  failures:   ${RED}${session.consecutive_failures}${RESET}`);
  }
  if (session.last_error) {
    console.log(`  last error: ${RED}${session.last_error}${RESET}`);
  }
  if (config?.depends_on && config.depends_on.length > 0) {
    console.log(`  depends_on: ${config.depends_on.join(", ")}`);
  }
  if (config?.path) {
    console.log(`  path:       ${DIM}${config.path}${RESET}`);
  }
}

/** Print a table of sessions (for config command) */
function printSessionTable(sessions: ConfigSessionRow[]): void {
  const header = `${"NAME".padEnd(22)} ${"TYPE".padEnd(10)} ${"PRI".padEnd(5)} ${"FLAGS".padEnd(20)} DEPS`;
  console.log(`${DIM}${header}${RESET}`);

  for (const s of sessions) {
    const flags: string[] = [];
    if (!s.enabled) flags.push(`${DIM}disabled${RESET}`);
    if (s.auto_go) flags.push(`${CYAN}auto_go${RESET}`);
    if (s.headless) flags.push(`${DIM}headless${RESET}`);
    const flagStr = flags.join(" ") || `${DIM}-${RESET}`;
    const deps = s.depends_on?.length > 0 ? s.depends_on.join(", ") : `${DIM}-${RESET}`;
    console.log(`${s.name.padEnd(22)} ${s.type.padEnd(10)} ${String(s.priority).padEnd(5)} ${flagStr.padEnd(29)} ${deps}`);
  }
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function timeSince(iso: string): string {
  return formatDuration(Date.now() - new Date(iso).getTime());
}

// -- Helpers ------------------------------------------------------------------

/** Get an IPC client configured from the config file */
function getClient(configPath?: string): IpcClient {
  try {
    const config = loadConfig(configPath);
    return new IpcClient(config.orchestrator.socket);
  } catch {
    // Fallback: use default socket path
    const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
    return new IpcClient(`${prefix}/tmp/tmx.sock`);
  }
}

/** Extract --config flag from args */
function getConfigFlag(): string | undefined {
  const idx = args.indexOf("--config");
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  const shortIdx = args.indexOf("-c");
  if (shortIdx >= 0 && args[shortIdx + 1]) return args[shortIdx + 1];
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract a flag value from args (e.g., --name foo → "foo") */
function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return undefined;
}

function printHelp(): void {
  console.log(`${BOLD}tmx${RESET} — Tmux session orchestrator for Termux

${BOLD}USAGE${RESET}
  tmx [command] [args...]

${BOLD}COMMANDS${RESET}
  ${CYAN}status${RESET} [name]         Session table with status/uptime/health/restarts
  ${CYAN}start${RESET} [name]          Start all or one session (resolves dependencies)
  ${CYAN}stop${RESET} [name]           Graceful stop (reverse dependency order)
  ${CYAN}restart${RESET} [name]        Stop then start
  ${CYAN}boot${RESET}                  Full sequence: daemon + ADB fix + start all + cron
  ${CYAN}health${RESET}                Run health sweep now
  ${CYAN}memory${RESET}                System memory + per-session RSS + pressure level
  ${CYAN}logs${RESET} [name]           Tail structured logs
  ${CYAN}tabs${RESET} [name...]        Restore Termux UI tabs for running sessions
  ${CYAN}config${RESET}                Validate and print resolved config
  ${CYAN}migrate${RESET} [path]        Convert repos.conf to tmx.toml
  ${CYAN}open${RESET} <path> [opts]     Register and start a dynamic Claude session
  ${CYAN}close${RESET} <name>          Stop and unregister a dynamic session
  ${CYAN}recent${RESET} [count]        Show recently active Claude projects
  ${CYAN}go${RESET} <name>             Send "go" to a Claude session
  ${CYAN}send${RESET} <name> <text>    Send arbitrary text to a session
  ${CYAN}daemon${RESET}                Start daemon (foreground)
  ${CYAN}shutdown${RESET}              Stop everything + release wake lock + exit daemon
  ${CYAN}upgrade${RESET}               Rebuild, shutdown daemon, let watchdog auto-restart

${BOLD}OPTIONS${RESET}
  -c, --config <path>  Config file path (default: ~/.config/tmx/tmx.toml)
  -h, --help           Show this help
  -v, --version        Show version

${BOLD}EXAMPLES${RESET}
  tmx boot              # Start everything after device boot
  tmx status clev       # Fuzzy match → cleverkeys status
  tmx go clev           # Send "go" to cleverkeys
  tmx restart play      # Restart playwright
  tmx tabs              # Restore UI tabs for all non-headless sessions
`);
}

function printVersion(): void {
  try {
    const pkgPath = new URL("../package.json", import.meta.url).pathname;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
    console.log(`tmx v${pkg.version}`);
  } catch {
    console.log("tmx v0.1.0");
  }
}
