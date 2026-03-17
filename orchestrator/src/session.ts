/**
 * session.ts — Tmux session lifecycle management
 *
 * Handles creating, starting, stopping, and querying tmux sessions.
 * For Claude-type sessions, polls tmux capture-pane to detect readiness
 * instead of hardcoded sleep delays.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SessionConfig, SessionType } from "./types.js";
import type { Logger } from "./log.js";

/** Resolve full path for a Termux binary (bun's spawnSync can't find $PREFIX/bin via PATH) */
function resolveTermuxBin(name: string): string {
  const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
  const candidate = join(prefix, "bin", name);
  try { if (existsSync(candidate)) return candidate; } catch { /* fall through */ }
  return name;
}

/** Pre-resolved binary paths for termux-am, am, and tmux */
const TERMUX_AM_BIN = resolveTermuxBin("termux-am");
const AM_BIN = resolveTermuxBin("am");
const TMUX_BIN = resolveTermuxBin("tmux");

/**
 * Environment for am/termux-am commands.
 * Bun's glibc runner strips LD_PRELOAD, but the Termux exec interceptor
 * (libtermux-exec-ld-preload.so) is required for app_process to work.
 * Without it, `am` silently succeeds (exit 0) but does nothing.
 */
function amEnv(): NodeJS.ProcessEnv {
  const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
  const ldPreload = join(prefix, "lib", "libtermux-exec-ld-preload.so");
  return { ...process.env, LD_PRELOAD: ldPreload };
}

/** Timeout for Claude Code readiness polling (ms) */
const CLAUDE_READY_TIMEOUT = 60_000;
/** Interval between readiness polls (ms) */
const CLAUDE_POLL_INTERVAL = 500;
/** Patterns that indicate Claude Code is ready for input */
const CLAUDE_READY_PATTERNS = [
  />\s*$/,           // prompt indicator
  /\$\s*$/,          // shell prompt (fallback)
  /claude\s*>/i,     // claude prompt
  /\?\s*$/,          // question mark prompt (e.g., "What would you like to do?")
];
/** Delay before sending "go" after readiness detection (ms) */
const GO_SEND_DELAY = 500;

/**
 * The LD_PRELOAD value needed for Termux exec interception.
 * libtermux-exec.so rewrites /usr/bin/env → $PREFIX/bin/env (and similar).
 * Bun's glibc-runner (bun-termux) strips LD_PRELOAD from the environment,
 * so the daemon and any tmux server it spawns lack this. We must inject it
 * back into the env for tmux and bare processes to function correctly.
 */
const TERMUX_LD_PRELOAD = join(
  process.env.PREFIX ?? "/data/data/com.termux/files/usr",
  "lib",
  "libtermux-exec.so",
);

/**
 * Build a clean environment for tmux child processes.
 * Strips CLAUDECODE and CLAUDE_CODE_* vars to prevent nested-session
 * detection when launching Claude Code inside tmux panes.
 * Re-injects LD_PRELOAD with libtermux-exec.so for /usr/bin/env rewriting.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  for (const key of Object.keys(env)) {
    if (key.startsWith("CLAUDE_CODE_") || key.startsWith("CLAUDE_TMPDIR")) {
      delete env[key];
    }
  }
  // Also strip ENABLE_CLAUDE_CODE_* variants
  for (const key of Object.keys(env)) {
    if (key.startsWith("ENABLE_CLAUDE_CODE_")) {
      delete env[key];
    }
  }
  // Re-inject LD_PRELOAD for termux-exec (stripped by bun's glibc-runner)
  if (existsSync(TERMUX_LD_PRELOAD)) {
    env.LD_PRELOAD = TERMUX_LD_PRELOAD;
  }
  return env;
}

/** Cached clean env — recomputed once per process */
let _cleanEnv: NodeJS.ProcessEnv | null = null;
function getCleanEnv(): NodeJS.ProcessEnv {
  if (!_cleanEnv) _cleanEnv = cleanEnv();
  return _cleanEnv;
}

/**
 * Run a tmux command and return stdout, or null on failure.
 * Uses spawnSync with proper argument array to handle spaces in args.
 * Passes clean env to prevent Claude nesting detection.
 */
function tmux(...args: string[]): string | null {
  try {
    const result = spawnSync(TMUX_BIN, args, {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
      env: getCleanEnv(),
    });
    if (result.status !== 0) return null;
    return (result.stdout ?? "").trim();
  } catch {
    return null;
  }
}

// -- Bare (non-tmux) Claude session discovery ---------------------------------

/** A Claude Code process running outside tmux, matched to a config session */
export interface BareClaudeSession {
  pid: number;
  cwd: string;
  sessionName: string;
}

/**
 * Scan the process table for Claude Code instances running in plain Termux tabs
 * (not inside tmux). Matches each process's cwd against configured session paths.
 * Returns one entry per session — if multiple Claude PIDs share a cwd, the oldest
 * (lowest PID) wins.
 */
export function discoverBareClaudeSessions(
  configSessions: SessionConfig[],
): BareClaudeSession[] {
  // Build a lookup of resolved absolute path → session name
  const pathToName = new Map<string, string>();
  for (const s of configSessions) {
    if (s.path) {
      try {
        pathToName.set(resolve(s.path), s.name);
      } catch { /* skip unresolvable */ }
    }
  }
  if (pathToName.size === 0) return [];

  // Get all claude processes
  let psOutput: string;
  try {
    const result = spawnSync("ps", ["-eo", "pid,args"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0 || !result.stdout) return [];
    psOutput = result.stdout;
  } catch {
    return [];
  }

  // Parse PIDs of processes whose command is exactly "claude"
  const claudePids: number[] = [];
  for (const line of psOutput.split("\n")) {
    const trimmed = line.trim();
    // Match lines like "12345 claude" (PID followed by bare "claude" command)
    const match = trimmed.match(/^(\d+)\s+claude$/);
    if (match) claudePids.push(parseInt(match[1], 10));
  }

  // For each claude PID: resolve cwd, check if it's in tmux, match to config
  const results: BareClaudeSession[] = [];
  // Track best (lowest PID) per session name
  const bestBySession = new Map<string, BareClaudeSession>();

  for (const pid of claudePids) {
    // Resolve working directory
    let cwd: string;
    try {
      cwd = readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      continue; // Process may have exited
    }

    // Check if any ancestor is tmux (already managed)
    if (isInTmux(pid)) continue;

    // Match cwd to a configured session
    const sessionName = pathToName.get(cwd);
    if (!sessionName) continue;

    const existing = bestBySession.get(sessionName);
    if (!existing || pid < existing.pid) {
      bestBySession.set(sessionName, { pid, cwd, sessionName });
    }
  }

  for (const entry of bestBySession.values()) {
    results.push(entry);
  }
  return results;
}

/**
 * Walk the ancestor chain of a PID to check if any parent is a tmux process.
 * Reads /proc/PID/stat for ppid and /proc/PID/comm for process name.
 * Stops after 15 hops or at PID 1 to avoid infinite loops.
 */
function isInTmux(pid: number): boolean {
  let current = pid;
  for (let depth = 0; depth < 15; depth++) {
    // Read ppid from /proc/PID/stat (field 4, 1-indexed)
    let ppid: number;
    try {
      const stat = readFileSync(`/proc/${current}/stat`, "utf-8");
      // Format: "PID (comm) state PPID ..."
      // comm can contain spaces/parens, so find the last ')' first
      const closeParen = stat.lastIndexOf(")");
      const afterComm = stat.slice(closeParen + 2); // skip ") "
      const fields = afterComm.split(" ");
      ppid = parseInt(fields[1], 10); // field after state
    } catch {
      return false; // Process gone or unreadable
    }

    if (ppid <= 1) return false; // Reached init — not in tmux

    // Check if parent is tmux
    try {
      const comm = readFileSync(`/proc/${ppid}/comm`, "utf-8").trim();
      if (comm === "tmux" || comm.startsWith("tmux:")) return true;
    } catch {
      return false;
    }

    current = ppid;
  }
  return false;
}

/** Check if the tmux server is alive */
export function isTmuxServerAlive(): boolean {
  const result = spawnSync(TMUX_BIN, ["start-server"], {
    timeout: 5000,
    stdio: "ignore",
    env: getCleanEnv(),
  });
  return result.status === 0;
}

/** List all existing tmux session names */
export function listTmuxSessions(): string[] {
  const output = tmux("list-sessions", "-F", "#{session_name}");
  if (!output) return [];
  return output
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Check if a specific tmux session exists */
export function sessionExists(name: string): boolean {
  const result = spawnSync(TMUX_BIN, ["has-session", "-t", name], {
    timeout: 5000,
    stdio: "ignore",
    env: getCleanEnv(),
  });
  return result.status === 0;
}

/** Capture the current pane content for a session */
export function capturePane(sessionName: string, _lines = 5): string {
  // Note: tmux 3.5a doesn't support -l flag for capture-pane
  const output = tmux("capture-pane", "-t", sessionName, "-p");
  return output ?? "";
}

/** Send text to a tmux session */
export function sendKeys(sessionName: string, text: string, pressEnter = true): boolean {
  const args = ["send-keys", "-t", sessionName, text];
  if (pressEnter) args.push("Enter");
  return tmux(...args) !== null;
}

/**
 * Spawn a bare (non-tmux) detached process for sessions that crash inside tmux PTY.
 * Returns the child PID, or null on failure.
 */
export function spawnBareProcess(config: SessionConfig, log: Logger): number | null {
  const { name, command, env: sessionEnv } = config;
  if (!command) {
    log.error(`Bare session '${name}' has no command`, { session: name });
    return null;
  }

  const mergedEnv = { ...process.env, ...sessionEnv };
  // Re-inject LD_PRELOAD for termux-exec (stripped by bun's glibc-runner)
  if (existsSync(TERMUX_LD_PRELOAD)) {
    mergedEnv.LD_PRELOAD = TERMUX_LD_PRELOAD;
  }
  try {
    const child = spawn("sh", ["-c", command], {
      cwd: config.path ?? process.env.HOME,
      env: mergedEnv,
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    const pid = child.pid;
    if (pid) {
      log.info(`Spawned bare session '${name}' (PID ${pid})`, { session: name });
      return pid;
    }
    log.error(`Bare session '${name}' spawn returned no PID`, { session: name });
    return null;
  } catch (err) {
    log.error(`Failed to spawn bare session '${name}': ${err}`, { session: name });
    return null;
  }
}

/**
 * Inject LD_PRELOAD into the tmux global environment so new sessions
 * inherit termux-exec even when the tmux server was started without it.
 * Safe to call repeatedly — just a `tmux set-environment -g` call.
 */
let _tmuxEnvInjected = false;
export function ensureTmuxLdPreload(log: Logger): void {
  if (_tmuxEnvInjected) return;
  if (!existsSync(TERMUX_LD_PRELOAD)) return;
  const ok = tmux("set-environment", "-g", "LD_PRELOAD", TERMUX_LD_PRELOAD);
  if (ok !== null) {
    log.info(`Injected LD_PRELOAD into tmux global environment`);
    _tmuxEnvInjected = true;
  }
}

/** Create and start a new tmux session */
export function createSession(config: SessionConfig, log: Logger): boolean {
  const { name, type, path, command, env } = config;

  // Build environment prefix for tmux commands
  const envPrefix = Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");

  // Check if session already exists
  if (sessionExists(name)) {
    log.info(`Session '${name}' already exists in tmux, skipping create`, { session: name });
    return true;
  }

  // Ensure tmux global env has LD_PRELOAD for termux-exec
  ensureTmuxLdPreload(log);

  // Create detached session with optional working directory
  const createArgs = ["new-session", "-d", "-s", name];
  if (path) {
    createArgs.push("-c", path);
  }

  const result = spawnSync(TMUX_BIN, createArgs, {
    timeout: 10_000,
    stdio: "ignore",
    env: getCleanEnv(),
  });

  if (result.status !== 0) {
    log.error(`Failed to create tmux session '${name}'`, { session: name });
    return false;
  }

  log.info(`Created tmux session '${name}'`, { session: name, type, path });

  // Ensure tmux propagates session name as terminal tab title (global option)
  tmux("set-option", "-g", "set-titles", "on");
  tmux("set-option", "-g", "set-titles-string", "#S");

  // Start the appropriate process inside the session
  switch (type) {
    case "claude":
      // Use the cc alias (claude --continue --dangerously-skip-permissions).
      // --continue resumes the last conversation in the project directory.
      // LD_PRELOAD injection (above) ensures /usr/bin/env shebang works.
      sendKeys(name, "cc", true);
      break;

    case "daemon":
      if (command) {
        const fullCmd = envPrefix ? `${envPrefix} ${command}` : command;
        sendKeys(name, fullCmd, true);
      }
      break;

    case "service":
      if (command) {
        const fullCmd = envPrefix ? `${envPrefix} ${command}` : command;
        sendKeys(name, fullCmd, true);
      }
      break;
  }

  return true;
}

/** Result of Claude readiness check */
export type ReadinessResult = "ready" | "timeout" | "disappeared";

/**
 * Wait for a Claude-type session to become ready for input.
 * Polls tmux capture-pane looking for a prompt indicator.
 * Returns "ready" if a prompt was detected, "timeout" if the deadline passed,
 * or "disappeared" if the tmux session was killed.
 */
export async function waitForClaudeReady(name: string, log: Logger): Promise<ReadinessResult> {
  const start = Date.now();

  while (Date.now() - start < CLAUDE_READY_TIMEOUT) {
    if (!sessionExists(name)) {
      log.warn(`Session '${name}' disappeared while waiting for readiness`, { session: name });
      return "disappeared";
    }

    const pane = capturePane(name, 10);
    // Check for any ready pattern
    for (const pattern of CLAUDE_READY_PATTERNS) {
      if (pattern.test(pane)) {
        const elapsed = Date.now() - start;
        log.debug(`Session '${name}' ready in ${elapsed}ms`, { session: name, elapsed });
        return "ready";
      }
    }

    await sleep(CLAUDE_POLL_INTERVAL);
  }

  log.warn(`Session '${name}' readiness timeout after ${CLAUDE_READY_TIMEOUT}ms`, { session: name });
  return "timeout";
}

/**
 * Send "go" to a Claude session after waiting for readiness.
 * Returns the readiness result: "ready" if go was sent successfully,
 * "timeout" or "disappeared" if the session wasn't ready.
 */
export async function sendGoToSession(name: string, log: Logger): Promise<ReadinessResult> {
  const result = await waitForClaudeReady(name, log);
  if (result !== "ready") {
    log.warn(`Skipping 'go' for '${name}' — ${result}`, { session: name });
    return result;
  }

  // Brief delay to ensure the prompt is fully rendered
  await sleep(GO_SEND_DELAY);

  if (sendKeys(name, "go", true)) {
    log.info(`Sent 'go' to '${name}'`, { session: name });
    return "ready";
  }
  return "timeout";
}

/** Gracefully stop a tmux session */
export async function stopSession(name: string, log: Logger, timeoutMs = 10_000): Promise<boolean> {
  if (!sessionExists(name)) {
    log.debug(`Session '${name}' not running, nothing to stop`, { session: name });
    return true;
  }

  // Try sending Ctrl-C first for a graceful exit
  tmux("send-keys", "-t", name, "C-c");
  await sleep(1000);

  // Send "exit" command
  sendKeys(name, "exit", true);
  await sleep(1000);

  // If still alive, kill it
  if (sessionExists(name)) {
    log.info(`Force-killing session '${name}'`, { session: name });
    tmux("kill-session", "-t", name);
    await sleep(500);
  }

  const stopped = !sessionExists(name);
  if (stopped) {
    log.info(`Session '${name}' stopped`, { session: name });
  } else {
    log.error(`Failed to stop session '${name}'`, { session: name });
  }
  return stopped;
}

/** Kill a tmux session immediately */
export function killSession(name: string): boolean {
  return tmux("kill-session", "-t", name) !== null;
}

/** Get the number of attached clients for a session */
export function getAttachedClients(name: string): number {
  const output = tmux("list-clients", "-t", name);
  if (!output) return 0;
  return output.split("\n").filter(Boolean).length;
}

/**
 * Create an attach script in $PREFIX/tmp for TermuxService to execute.
 * The script sets the terminal title (for the Termux tab label) and execs
 * into tmux attach for the target session.
 */
function ensureAttachScript(): string {
  const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
  const scriptPath = join(prefix, "tmp", "tmx-attach.sh");
  try {
    writeFileSync(scriptPath, [
      `#!/data/data/com.termux/files/usr/bin/bash`,
      `printf '\\033]0;%s\\007' "$1"`,
      `exec tmux attach -t "$1"`,
      "",
    ].join("\n"), { mode: 0o755 });
  } catch { /* best effort — may already exist */ }
  return scriptPath;
}

/**
 * Bring Termux app to foreground via am start.
 * Uses TermuxActivity's standard launch intent.
 */
function bringTermuxToForeground(log: Logger): void {
  const env = amEnv();
  const result = spawnSync(AM_BIN, [
    "start", "-n", "com.termux/.app.TermuxActivity",
  ], { timeout: 5000, stdio: "ignore", env });
  if (result.status !== 0) {
    log.debug("Failed to bring Termux to foreground");
  }
}

/**
 * Open a Termux tab for a tmux session and bring Termux to foreground.
 *
 * If the session already has a client (tab exists), just brings Termux to
 * foreground. Otherwise creates a new tab via TermuxService service_execute
 * intent, with switch-client fallback for single-tab mode.
 */
export function createTermuxTab(sessionName: string, log: Logger): boolean {
  const env = amEnv();

  // Ensure tmux propagates session name as outer terminal title
  tmux("set-option", "-g", "set-titles", "on");
  tmux("set-option", "-g", "set-titles-string", "#S");

  // If there's already a client on this session, just bring Termux to foreground.
  // We don't switch-client because that would hijack whatever tab the user was
  // on and orphan its original session. The user can swipe to the labeled tab.
  const targetClients = tmux("list-clients", "-t", sessionName, "-F", "#{client_tty}");
  if (targetClients && targetClients.trim().length > 0) {
    log.info(`Session '${sessionName}' already has a tab, bringing Termux to foreground`, { session: sessionName });
    // Ensure the tab label is correct via OSC title escape
    const clientTty = targetClients.trim().split("\n")[0];
    try { writeFileSync(clientTty, `\x1b]0;${sessionName}\x07`); } catch { /* ignore */ }
    bringTermuxToForeground(log);
    return true;
  }

  // Primary: create a new Termux tab via TermuxService service_execute.
  // This sends an intent to the running TermuxService which creates a new
  // terminal session, opens a new Termux tab, and runs the attach script.
  // session_action=0 switches to the new session and opens the activity.
  const scriptPath = ensureAttachScript();
  const svcResult = spawnSync(AM_BIN, [
    "startservice",
    "-n", "com.termux/.app.TermuxService",
    "-a", "com.termux.service_execute",
    "-d", `file://${scriptPath}`,
    "--esa", "com.termux.execute.arguments", sessionName,
    "--ei", "com.termux.execute.session_action", "0",
    "--es", "com.termux.execute.shell_name", sessionName,
  ], { timeout: 5000, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8", env });

  if (svcResult.status === 0) {
    log.info(`Created Termux tab for '${sessionName}' via TermuxService`, { session: sessionName });
    bringTermuxToForeground(log);
    return true;
  }

  // Fallback: switch an existing tmux client to this session.
  // Only works when at least one tmux client exists (e.g. from watchdog.sh).
  log.debug(`TermuxService failed for '${sessionName}', trying switch-client fallback`, { session: sessionName });
  const allClients = tmux("list-clients", "-F", "#{client_name}:#{client_tty}");
  if (allClients && allClients.trim().length > 0) {
    const firstClient = allClients.trim().split("\n")[0];
    const colonIdx = firstClient.indexOf(":");
    const clientName = firstClient.substring(0, colonIdx);
    const clientTty = firstClient.substring(colonIdx + 1);

    const switched = tmux("switch-client", "-c", clientName, "-t", sessionName);
    if (switched !== null) {
      log.info(`Switched client '${clientName}' to session '${sessionName}'`, { session: sessionName });
      tmux("refresh-client", "-c", clientName);
    }

    // Write OSC title escape for Termux tab label
    try { writeFileSync(clientTty, `\x1b]0;${sessionName}\x07`); } catch { /* ignore */ }
  } else {
    log.warn(`No tmux clients found — open Termux and run: tmux attach -t ${sessionName}`, { session: sessionName });
  }

  bringTermuxToForeground(log);
  return true;
}

/** Promise-based sleep */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
