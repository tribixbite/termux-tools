/**
 * tmx.ts — CLI entry point and command router
 *
 * Usage: tmx [command] [args...]
 * See `tmx --help` for available commands.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { IpcClient } from "./ipc.js";
import { Daemon } from "./daemon.js";
import { loadConfig, findConfigPath, validateConfigFile } from "./config.js";
import { Logger } from "./log.js";
import { parseReposConf, generateToml, findReposConf } from "./migrate.js";
import type { IpcCommand, HealthResult } from "./types.js";
import type { DaemonStatusData, SessionDetailData, ConfigSessionRow, MemoryData } from "./display-types.js";

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

    case "--help":
    case "-h":
    case "help":
      return printHelp();

    case "--version":
    case "-v":
      return printVersion();

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
    // Start daemon in background (fork)
    console.log(`${CYAN}Starting daemon...${RESET}`);
    const daemonArgs = ["daemon"];
    if (configPath) daemonArgs.push("--config", configPath);

    // Use the same executable that invoked us
    const child = spawn(process.argv[0], [process.argv[1], ...daemonArgs], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    // Wait for daemon to be ready
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (await client.isRunning()) break;
    }

    if (!(await client.isRunning())) {
      console.error(`${RED}Daemon failed to start${RESET}`);
      process.exit(1);
    }
    console.log(`${GREEN}Daemon started${RESET}`);
  }

  // Send boot command
  const resp = await client.send({ cmd: "boot" });
  if (resp.ok) {
    console.log(`${GREEN}Boot sequence initiated${RESET}`);
  } else {
    console.error(`${RED}Boot failed: ${resp.error}${RESET}`);
    process.exit(1);
  }
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
  ${CYAN}go${RESET} <name>             Send "go" to a Claude session
  ${CYAN}send${RESET} <name> <text>    Send arbitrary text to a session
  ${CYAN}daemon${RESET}                Start daemon (foreground)
  ${CYAN}shutdown${RESET}              Stop everything + release wake lock + exit daemon

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
