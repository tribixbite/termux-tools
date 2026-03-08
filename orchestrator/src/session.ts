/**
 * session.ts — Tmux session lifecycle management
 *
 * Handles creating, starting, stopping, and querying tmux sessions.
 * For Claude-type sessions, polls tmux capture-pane to detect readiness
 * instead of hardcoded sleep delays.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
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
const CLAUDE_READY_TIMEOUT = 30_000;
/** Interval between readiness polls (ms) */
const CLAUDE_POLL_INTERVAL = 500;
/** Patterns that indicate Claude Code is ready for input */
const CLAUDE_READY_PATTERNS = [
  />\s*$/,           // prompt indicator
  /\$\s*$/,          // shell prompt (fallback)
  /claude\s*>/i,     // claude prompt
];
/** Delay before sending "go" after readiness detection (ms) */
const GO_SEND_DELAY = 500;

/**
 * Build a clean environment for tmux child processes.
 * Strips CLAUDECODE and CLAUDE_CODE_* vars to prevent nested-session
 * detection when launching Claude Code inside tmux panes.
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

  // Start the appropriate process inside the session
  switch (type) {
    case "claude":
      // Start Claude Code via node explicitly — Termux lacks /usr/bin/env
      // which the claude shebang requires. Using node + resolved path bypasses this.
      sendKeys(name, "node $(readlink -f $(which claude)) --dangerously-skip-permissions", true);
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

/**
 * Wait for a Claude-type session to become ready for input.
 * Polls tmux capture-pane looking for a prompt indicator.
 * Returns true if ready, false if timeout exceeded.
 */
export async function waitForClaudeReady(name: string, log: Logger): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < CLAUDE_READY_TIMEOUT) {
    if (!sessionExists(name)) {
      log.warn(`Session '${name}' disappeared while waiting for readiness`, { session: name });
      return false;
    }

    const pane = capturePane(name, 10);
    // Check for any ready pattern
    for (const pattern of CLAUDE_READY_PATTERNS) {
      if (pattern.test(pane)) {
        const elapsed = Date.now() - start;
        log.debug(`Session '${name}' ready in ${elapsed}ms`, { session: name, elapsed });
        return true;
      }
    }

    await sleep(CLAUDE_POLL_INTERVAL);
  }

  log.warn(`Session '${name}' readiness timeout after ${CLAUDE_READY_TIMEOUT}ms`, { session: name });
  return false;
}

/**
 * Send "go" to a Claude session after waiting for readiness.
 * Returns true if "go" was sent, false if session wasn't ready.
 */
export async function sendGoToSession(name: string, log: Logger): Promise<boolean> {
  const ready = await waitForClaudeReady(name, log);
  if (!ready) {
    log.warn(`Skipping 'go' for '${name}' — not ready`, { session: name });
    return false;
  }

  // Brief delay to ensure the prompt is fully rendered
  await sleep(GO_SEND_DELAY);

  if (sendKeys(name, "go", true)) {
    log.info(`Sent 'go' to '${name}'`, { session: name });
    return true;
  }
  return false;
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
 * Open a Termux tab attached to a tmux session.
 *
 * Uses $PREFIX/bin/am (app_process wrapper) to call RunCommandService with
 * BACKGROUND=false, which creates a visible foreground Termux tab.
 * Note: ADB's `am` lacks the RUN_COMMAND permission, and `termux-am` socket
 * IPC is often unavailable — only $PREFIX/bin/am works reliably.
 */
export function createTermuxTab(sessionName: string, log: Logger): boolean {
  const env = amEnv();
  const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
  const bash = join(prefix, "bin", "bash");

  // Check if a tmux client is already attached to this session
  const clients = tmux("list-clients", "-t", sessionName, "-F", "#{client_tty}");
  if (clients && clients.trim().length > 0) {
    // Already attached — just bring Termux to foreground
    log.info(`Session '${sessionName}' already attached, bringing Termux to foreground`, { session: sessionName });
    const actArgs = ["start", "-n", "com.termux/com.termux.app.TermuxActivity"];
    spawnSync(AM_BIN, actArgs, { timeout: 3000, stdio: "ignore", env });
    return true;
  }

  // Write a tiny attach script that sets the Termux tab title before attaching.
  // --esa comma escaping makes inline args fragile; a script file is reliable.
  const scriptPath = join(prefix, "tmp", `tmx-tab-${sessionName}.sh`);
  const script = [
    `#!/data/data/com.termux/files/usr/bin/bash`,
    `# Set Termux tab title (ESC ]0; title BEL)`,
    `printf '\\033]0;${sessionName}\\007'`,
    `exec ${TMUX_BIN} attach-session -t ${sessionName}`,
  ].join("\n");
  try {
    const { writeFileSync, chmodSync } = require("fs");
    writeFileSync(scriptPath, script);
    chmodSync(scriptPath, 0o755);
  } catch (e) {
    log.warn(`Failed to write tab script: ${(e as Error).message}`, { session: sessionName });
  }

  // RunCommandService BACKGROUND=false creates a visible tab
  const svcArgs = [
    "startservice", "--user", "0",
    "-n", "com.termux/com.termux.app.RunCommandService",
    "-a", "com.termux.RUN_COMMAND",
    "--es", "com.termux.RUN_COMMAND_PATH", bash,
    "--esa", "com.termux.RUN_COMMAND_ARGUMENTS", scriptPath,
    "--ez", "com.termux.RUN_COMMAND_BACKGROUND", "false",
  ];

  const result = spawnSync(AM_BIN, svcArgs, { timeout: 5000, stdio: "ignore", env });
  if (result.status !== 0) {
    log.warn(`RunCommandService failed for '${sessionName}'`, { session: sessionName });
  }

  // Bring Termux to foreground
  const actArgs = ["start", "-n", "com.termux/com.termux.app.TermuxActivity"];
  spawnSync(AM_BIN, actArgs, { timeout: 3000, stdio: "ignore", env });
  log.info(`Opened Termux tab for '${sessionName}'`, { session: sessionName });

  return true;
}

/** Promise-based sleep */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
