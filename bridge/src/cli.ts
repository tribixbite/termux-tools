/**
 * claude-chrome-android CLI — starts/stops the CFC bridge on Android/Termux.
 * Shebang added by esbuild banner during build.
 *
 * Usage:
 *   npx claude-chrome-android          Start the bridge server
 *   npx claude-chrome-android --stop    Stop a running bridge
 *   npx claude-chrome-android --setup   Create ~/bin/termux-url-opener + verify deps
 *   npx claude-chrome-android --version Print version
 *   npx claude-chrome-android --help    Show help
 */

import { resolve, dirname } from "path";
import { writeFileSync, mkdirSync, chmodSync, existsSync, readFileSync } from "fs";

// --- Version -----------------------------------------------------------------

const PKG_VERSION: string = (() => {
  try {
    // When bundled as CJS, __dirname is available. When running as ESM, use import.meta.
    const dir = typeof __dirname !== "undefined" ? __dirname : dirname(new URL(import.meta.url).pathname);
    // dist/cli.js → package.json is one level up
    const pkgPath = resolve(dir, "../package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// --- Helpers -----------------------------------------------------------------

const WS_PORT = parseInt(process.env.BRIDGE_PORT ?? "18963", 10);
const WS_HOST = "127.0.0.1";
const HEALTH_URL = `http://${WS_HOST}:${WS_PORT}/health`;
const SHUTDOWN_URL = `http://${WS_HOST}:${WS_PORT}/shutdown`;

/** Fetch with a timeout (Node 18+ has AbortController) */
async function fetchWithTimeout(url: string, opts: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const { timeout = 3000, ...fetchOpts } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...fetchOpts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Check if the bridge is responding on its health endpoint */
async function isBridgeAlive(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(HEALTH_URL, { timeout: 2000 });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Commands ----------------------------------------------------------------

/** --version: print version and exit */
function cmdVersion(): void {
  console.log(`claude-chrome-android v${PKG_VERSION}`);
}

/** --help: show usage and exit */
function cmdHelp(): void {
  console.log(`
claude-chrome-android v${PKG_VERSION}
CFC Bridge — connects Claude Code CLI to Chrome/Edge on Android via WebSocket

Usage:
  claude-chrome-android              Start the bridge server
  claude-chrome-android --stop       Stop a running bridge
  claude-chrome-android --setup      Create ~/bin/termux-url-opener + verify deps
  claude-chrome-android --version    Print version
  claude-chrome-android --help       Show this help

Environment variables:
  BRIDGE_PORT       WebSocket port (default: 18963)
  BRIDGE_TOKEN      Optional shared secret for auth
  BRIDGE_LOG_LEVEL  Log level: debug|info|warn|error (default: info)
`.trim());
}

/** --stop: gracefully stop a running bridge, verify it's dead */
async function cmdStop(): Promise<void> {
  console.log("Stopping bridge...");

  // 1. Try graceful shutdown via POST /shutdown
  try {
    const res = await fetchWithTimeout(SHUTDOWN_URL, { method: "POST", timeout: 3000 });
    if (res.ok) {
      console.log("Shutdown request accepted");
    }
  } catch {
    // Bridge may already be dead or unresponsive
  }

  // 2. Wait a moment, then verify it's actually dead
  await new Promise((r) => setTimeout(r, 800));

  if (await isBridgeAlive()) {
    // Still alive — try pkill as fallback
    console.log("Bridge didn't stop gracefully, attempting pkill...");
    const { spawnSync } = await import("child_process");

    // Kill processes matching the bridge pattern (node or bun running claude-chrome-bridge)
    const result = spawnSync("pkill", ["-f", "(bun|node).*claude-chrome"], {
      stdio: "ignore",
    });

    // Wait and verify again
    await new Promise((r) => setTimeout(r, 500));
    if (await isBridgeAlive()) {
      console.error("Bridge is still running. Kill manually: pkill -f claude-chrome-bridge");
      process.exit(1);
    }
    console.log("Bridge killed via pkill");
  } else {
    console.log("Bridge stopped");
  }
}

/** --setup: create ~/bin/termux-url-opener and verify deps */
async function cmdSetup(): Promise<void> {
  console.log(`claude-chrome-android v${PKG_VERSION} — setup\n`);

  // Check environment
  const isTermux = existsSync("/data/data/com.termux/files/usr/bin/bash");
  if (!isTermux) {
    console.warn("Warning: This doesn't look like Termux. Setup is designed for Android/Termux.\n");
  }

  // Verify Node works (we're running on it)
  console.log(`Runtime: Node.js ${process.version}`);

  // Check if bun is available too
  const { spawnSync } = await import("child_process");
  const bunCheck = spawnSync("bun", ["--version"], { stdio: "pipe", encoding: "utf-8" });
  if (bunCheck.status === 0) {
    console.log(`Bun: ${bunCheck.stdout.trim()} (will prefer bun for performance)`);
  } else {
    console.log("Bun: not found (will use Node.js)");
  }

  // Check for claude CLI
  const claudeCheck = spawnSync("which", ["claude"], { stdio: "pipe", encoding: "utf-8" });
  if (claudeCheck.status === 0) {
    console.log(`Claude CLI: ${claudeCheck.stdout.trim()}`);
  } else {
    console.warn("Warning: Claude Code CLI not found. Install with: npm i -g @anthropic-ai/claude-code");
  }

  // Create ~/bin/ if it doesn't exist
  const binDir = resolve(process.env.HOME ?? "/data/data/com.termux/files/home", "bin");
  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
    console.log(`\nCreated ${binDir}/`);
  }

  // Create or update termux-url-opener
  const urlOpenerPath = resolve(binDir, "termux-url-opener");
  const urlOpenerExists = existsSync(urlOpenerPath);

  const urlOpenerScript = `#!/data/data/com.termux/files/usr/bin/bash
# termux-url-opener — handles URLs shared to Termux via Android share menu
# Called by TermuxFileReceiverActivity with the shared URL as $1
#
# Generated by: claude-chrome-android --setup v${PKG_VERSION}
# NOTE: TermuxFileReceiverActivity runs this in a terminal session managed by
# TermuxService. When the script exits, the session closes and SIGHUP is sent
# to the process group. We use setsid to escape the process group.

set -euo pipefail

url="\${1:-}"

# Debug log
echo "[\$(date +%H:%M:%S)] termux-url-opener: $url" >> "$PREFIX/tmp/url-opener.log"

case "$url" in
  *cfcbridge*/start*)
    # CFC bridge deep-link from the Chrome/Edge extension
    BRIDGE_LOG="$PREFIX/tmp/bridge.log"

    if pgrep -f "(bun|node).*claude-chrome" > /dev/null 2>&1; then
      echo "[\$(date +%H:%M:%S)] bridge already running" >> "$PREFIX/tmp/url-opener.log"
      exit 0
    fi

    # Prefer bun (faster startup), fallback to node
    RUNTIME=""
    if [[ -x "$HOME/.bun/bin/bun" ]]; then
      RUNTIME="$HOME/.bun/bin/bun"
    elif command -v bun > /dev/null 2>&1; then
      RUNTIME="\$(command -v bun)"
    elif command -v node > /dev/null 2>&1; then
      RUNTIME="\$(command -v node)"
    fi

    if [[ -z "$RUNTIME" ]]; then
      echo "[\$(date +%H:%M:%S)] ERROR: neither bun nor node found" >> "$PREFIX/tmp/url-opener.log"
      exit 1
    fi

    # Find the bridge script — check npx cache, repo checkout, or run via npx
    BRIDGE_SCRIPT=""
    # 1. Local repo checkout
    if [[ -f "$HOME/git/termux-tools/claude-chrome-bridge.ts" ]]; then
      BRIDGE_SCRIPT="$HOME/git/termux-tools/claude-chrome-bridge.ts"
    fi
    # 2. npm global install (bunx or npx)
    NPM_GLOBAL="$HOME/.npm/lib/node_modules/claude-chrome-android/dist/cli.js"
    BUN_GLOBAL="$HOME/.bun/install/global/node_modules/claude-chrome-android/dist/cli.js"
    if [[ -z "$BRIDGE_SCRIPT" && -f "$NPM_GLOBAL" ]]; then
      BRIDGE_SCRIPT="$NPM_GLOBAL"
    elif [[ -z "$BRIDGE_SCRIPT" && -f "$BUN_GLOBAL" ]]; then
      BRIDGE_SCRIPT="$BUN_GLOBAL"
    fi

    if [[ -n "$BRIDGE_SCRIPT" ]]; then
      # setsid creates a new session leader — the child process survives when
      # TermuxService kills this session's process group on script exit
      setsid nohup "$RUNTIME" "$BRIDGE_SCRIPT" > "$BRIDGE_LOG" 2>&1 &
      echo "[\$(date +%H:%M:%S)] bridge started PID=\$!" >> "$PREFIX/tmp/url-opener.log"
    else
      # Fallback: use npx to download and run on the fly
      setsid nohup npx claude-chrome-android > "$BRIDGE_LOG" 2>&1 &
      echo "[\$(date +%H:%M:%S)] bridge started via npx PID=\$!" >> "$PREFIX/tmp/url-opener.log"
    fi
    exit 0
    ;;

  *)
    # Default: open URL in browser
    if command -v termux-open-url > /dev/null 2>&1; then
      termux-open-url "$url"
    elif command -v xdg-open > /dev/null 2>&1; then
      xdg-open "$url"
    fi
    ;;
esac
`;

  if (urlOpenerExists) {
    // Check if it already handles cfcbridge
    const existing = readFileSync(urlOpenerPath, "utf-8");
    if (existing.includes("cfcbridge")) {
      // Backup existing and overwrite
      const backupPath = `${urlOpenerPath}.bak`;
      writeFileSync(backupPath, existing);
      console.log(`\nBacked up existing url-opener to ${backupPath}`);
    }
  }

  writeFileSync(urlOpenerPath, urlOpenerScript);
  chmodSync(urlOpenerPath, 0o755);
  console.log(`${urlOpenerExists ? "Updated" : "Created"} ${urlOpenerPath}`);

  // Summary
  console.log(`
Setup complete!

Next steps:
  1. Install the CRX extension in Chrome/Edge on your phone
  2. Start the bridge:  npx claude-chrome-android
  3. Or use the extension's "Launch Bridge" button (shares to Termux)

The bridge runs on ws://${WS_HOST}:${WS_PORT} and connects
Claude Code CLI to your browser via the Chrome extension.
`);
}

/** Default: start the bridge server */
async function cmdStart(): Promise<void> {
  // Check if bridge is already running
  if (await isBridgeAlive()) {
    console.log(`Bridge is already running on ws://${WS_HOST}:${WS_PORT}`);
    console.log("Use --stop to stop it first, or --help for more options.");
    process.exit(0);
  }

  // The bridge is the main claude-chrome-bridge.ts — we need to load and run it.
  // When bundled by esbuild, the bridge code is included in this same file.
  // We import it dynamically to keep the CLI commands fast for --version, --help etc.
  console.log(`Starting CFC Bridge v${PKG_VERSION} on ws://${WS_HOST}:${WS_PORT}...`);

  // The bridge module is a side-effectful script that starts the server when imported.
  // esbuild bundles it alongside this CLI; we just need to require/import it.
  try {
    await import("../../claude-chrome-bridge");
  } catch (err: any) {
    // If the relative import fails (e.g., running from npm global install),
    // the bridge code should already be bundled into this file by esbuild.
    // This catch handles the case where the TS source isn't available.
    console.error("Failed to start bridge:", err.message);
    console.error("\nIf you installed via npm, the bridge should be bundled in this file.");
    console.error("Try rebuilding: cd bridge && node build.js");
    process.exit(1);
  }
}

// --- Main --------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0] ?? "";

switch (command) {
  case "--version":
  case "-v":
    cmdVersion();
    break;
  case "--help":
  case "-h":
    cmdHelp();
    break;
  case "--stop":
    cmdStop();
    break;
  case "--setup":
    cmdSetup();
    break;
  case "":
    // Default: start bridge
    cmdStart();
    break;
  default:
    console.error(`Unknown option: ${command}`);
    cmdHelp();
    process.exit(1);
}
