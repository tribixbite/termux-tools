/**
 * session.ts — Tmux session lifecycle management
 *
 * Handles creating, starting, stopping, and querying tmux sessions.
 * For Claude-type sessions, polls tmux capture-pane to detect readiness
 * instead of hardcoded sleep delays.
 */

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
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

  // Ensure tmux propagates session name as terminal tab title (global option)
  tmux("set-option", "-g", "set-titles", "on");
  tmux("set-option", "-g", "set-titles-string", "#S");

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
 * Bring a tmux session to the visible Termux foreground.
 *
 * Strategy: find any existing tmux client and switch it to the target session
 * via `tmux switch-client`. With `set-titles on` (global), tmux automatically
 * updates the outer terminal title to the session name (#S).
 *
 * RunCommandService tab creation is unreliable on Android 15+ (foreground
 * service restrictions silently block new session creation from background
 * contexts), so we avoid it entirely.
 */
export function createTermuxTab(sessionName: string, log: Logger): boolean {
  const env = amEnv();

  // Ensure tmux propagates session name as outer terminal title
  tmux("set-option", "-g", "set-titles", "on");
  tmux("set-option", "-g", "set-titles-string", "#S");

  // Check if there's already a client on this exact session
  const targetClients = tmux("list-clients", "-t", sessionName, "-F", "#{client_tty}");
  if (targetClients && targetClients.trim().length > 0) {
    log.info(`Session '${sessionName}' already attached, bringing Termux to foreground`, { session: sessionName });
    // Write title escape to ensure tab label is correct
    const clientTty = targetClients.trim().split("\n")[0];
    try { writeFileSync(clientTty, `\x1b]0;${sessionName}\x07`); } catch { /* ignore */ }
    const actArgs = ["start", "-a", "android.intent.action.MAIN",
      "-c", "android.intent.category.LAUNCHER",
      "-n", "com.termux/com.termux.app.TermuxActivity"];
    spawnSync(AM_BIN, actArgs, { timeout: 3000, stdio: "ignore", env });
    return true;
  }

  // Find ANY existing tmux client to switch
  const allClients = tmux("list-clients", "-F", "#{client_name}:#{client_tty}");
  if (allClients && allClients.trim().length > 0) {
    const firstClient = allClients.trim().split("\n")[0];
    const colonIdx = firstClient.indexOf(":");
    const clientName = firstClient.substring(0, colonIdx);
    const clientTty = firstClient.substring(colonIdx + 1);

    const switched = tmux("switch-client", "-c", clientName, "-t", sessionName);
    if (switched !== null) {
      log.info(`Switched client '${clientName}' to session '${sessionName}'`, { session: sessionName });
      // Force tmux to resend title escape to the terminal
      tmux("refresh-client", "-c", clientName);
    } else {
      log.warn(`Failed to switch client to '${sessionName}', falling back to attach`, { session: sessionName });
    }

    // Write OSC title escape directly to the client's PTY as fallback.
    // Termux reads \033]0;title\007 and updates the tab label.
    try {
      writeFileSync(clientTty, `\x1b]0;${sessionName}\x07`);
      log.debug(`Wrote title escape to ${clientTty}`, { session: sessionName });
    } catch {
      log.debug(`Could not write title to ${clientTty}`, { session: sessionName });
    }
  } else {
    // No tmux clients exist — user may need to manually run tmux attach.
    log.warn(`No tmux clients found, cannot switch to '${sessionName}'`, { session: sessionName });
  }

  // Bring Termux to foreground
  const actArgs = ["start", "-a", "android.intent.action.MAIN",
    "-c", "android.intent.category.LAUNCHER",
    "-n", "com.termux/com.termux.app.TermuxActivity"];
  spawnSync(AM_BIN, actArgs, { timeout: 3000, stdio: "ignore", env });
  log.info(`Brought Termux to foreground for '${sessionName}'`, { session: sessionName });

  return true;
}

/** Promise-based sleep */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
