/**
 * claude-chrome-android CLI — CFC bridge + MCP server for Android/Termux.
 * Shebang added by esbuild banner during build.
 *
 * Usage:
 *   npx claude-chrome-android            Start the bridge server
 *   npx claude-chrome-android --mcp      MCP server mode (spawned by Claude Code)
 *   npx claude-chrome-android --stop     Stop a running bridge
 *   npx claude-chrome-android --setup    Full setup: MCP + url-opener + Edge/extension
 *   npx claude-chrome-android --setup-edge  Browser-side setup: install Edge, patch, sideload extension
 *   npx claude-chrome-android --version  Print version
 *   npx claude-chrome-android --help     Show help
 */

import { resolve, dirname } from "path";
import { writeFileSync, mkdirSync, chmodSync, existsSync, readFileSync, readdirSync, copyFileSync } from "fs";

// --- Version -----------------------------------------------------------------

const PKG_VERSION: string = (() => {
  try {
    const dir = typeof __dirname !== "undefined" ? __dirname : dirname(new URL(import.meta.url).pathname);
    const pkgPath = resolve(dir, "../package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// --- Helpers -----------------------------------------------------------------

const WS_PORT = parseInt(process.env.BRIDGE_PORT ?? "18963", 10);
const WS_HOST = "127.0.0.1";
const BRIDGE_URL = process.env.BRIDGE_URL ?? `http://${WS_HOST}:${WS_PORT}`;
const HEALTH_URL = `${BRIDGE_URL}/health`;
const SHUTDOWN_URL = `${BRIDGE_URL}/shutdown`;
const TOOL_URL = `${BRIDGE_URL}/tool`;
const TOOL_TIMEOUT_MS = 30_000;

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

async function isBridgeAlive(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(HEALTH_URL, { timeout: 2000 });
    return res.ok;
  } catch {
    return false;
  }
}

/** Number of browser extensions currently connected to the bridge (0 if down). */
async function bridgeClientCount(): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(HEALTH_URL, { timeout: 2000 });
    if (!res.ok) return null;
    const d = (await res.json()) as Record<string, unknown>;
    return typeof d.clients === "number" ? d.clients : 0;
  } catch {
    return null;
  }
}

// --- Edge / extension environment probes -------------------------------------
// Shared by --setup, --doctor, and the startup preflight in cmdStart.

const EDGE_PACKAGES = [
  "com.microsoft.emmx.canary",
  "com.microsoft.emmx.dev",
  "com.microsoft.emmx.beta",
  "com.microsoft.emmx",
];
const EXT_DEST = "/data/local/tmp/cfc-ext";
const FLAGS_FILE = "/data/local/tmp/chrome-command-line";

type SpawnSync = typeof import("child_process").spawnSync;

/** Resolve the directory holding this CLI (works in CJS bundle + ESM). */
function selfDir(): string {
  return typeof __dirname !== "undefined" ? __dirname : dirname(new URL(import.meta.url).pathname);
}

/** Locate the unpacked CFC extension (source repo or shipped dist/). */
function findExtDir(): string | undefined {
  const dir = selfDir();
  const candidates = [
    resolve(dir, "../../edge-claude-ext"), // running from source repo
    resolve(dir, "edge-claude-ext"),       // npm package dist/edge-claude-ext/
  ];
  return candidates.find((d) => existsSync(resolve(d, "manifest.json")));
}

/** Locate edge-fix/build-from-device.sh for the self-build flow (source repo only). */
function findBuildScript(): string | undefined {
  const home = process.env.HOME ?? "/data/data/com.termux/files/home";
  const candidates = [
    resolve(selfDir(), "../../../edge-fix/build-from-device.sh"),
    resolve(home, "git/termux-tools/edge-fix/build-from-device.sh"),
  ];
  return candidates.find((p) => existsSync(p));
}

interface AdbDevice { serial: string; state: string; }

/** Parse `adb devices` into {serial, state} rows (skips the header line). */
function listAdbDevices(sp: SpawnSync): AdbDevice[] {
  const r = sp("adb", ["devices"], { stdio: "pipe", encoding: "utf-8" });
  if (r.status !== 0) return [];
  return (r.stdout ?? "")
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [serial, state] = l.split(/\s+/);
      return { serial, state: state ?? "" };
    })
    .filter((d) => d.serial && d.state);
}

/**
 * Resolve a single online device serial to pin every adb call to. A bare
 * `adb shell` fails with "more than one device/emulator" whenever more than one
 * device is listed — including when one is merely offline — so the probes must
 * always pass `-s <serial>`. Honors ADB_SERIAL / BRIDGE_ADB_SERIAL when it
 * names an online device; otherwise picks the sole online one. Returns "" when
 * none are online; with several online and no env hint, prefers the first.
 */
function resolveAdbSerial(sp: SpawnSync): string {
  const online = listAdbDevices(sp).filter((d) => d.state === "device");
  const env = process.env.ADB_SERIAL || process.env.BRIDGE_ADB_SERIAL || "";
  if (env && online.some((d) => d.serial === env)) return env;
  if (online.length === 1) return online[0].serial;
  if (online.length > 1) return env || online[0].serial;
  return "";
}

/** Run an adb command pinned to a serial (when one was resolved). */
function runAdb(sp: SpawnSync, serial: string, args: string[]) {
  const base = serial ? ["-s", serial] : [];
  return sp("adb", [...base, ...args], { stdio: "pipe", encoding: "utf-8" });
}

function adbOnline(sp: SpawnSync): boolean {
  return resolveAdbSerial(sp) !== "";
}

/** Which Edge variant is installed on the device, if any. */
function detectEdgePkg(sp: SpawnSync, serial: string): string {
  for (const pkg of EDGE_PACKAGES) {
    const r = runAdb(sp, serial, ["shell", "pm", "list", "packages", pkg]);
    if (r.stdout?.includes(`package:${pkg}`)) return pkg;
  }
  return "";
}

/** True if the unpacked extension is present on the device. */
function extPushed(sp: SpawnSync, serial: string): boolean {
  const r = runAdb(sp, serial, ["shell", "ls", `${EXT_DEST}/manifest.json`]);
  return r.status === 0 && (r.stdout ?? "").includes("manifest.json");
}

/** True if chrome-command-line points --load-extension at our extension dir. */
function flagsLoadExt(sp: SpawnSync, serial: string): boolean {
  const r = runAdb(sp, serial, ["shell", "cat", FLAGS_FILE]);
  return (r.stdout ?? "").includes(EXT_DEST);
}

/**
 * Heuristic: the privacy patch strips the AD_ID tracking permission, so its
 * absence from the manifest is a strong signal the installed Edge is patched.
 * Returns null when we can't determine it (e.g. dumpsys unavailable).
 */
function edgeIsPatched(sp: SpawnSync, serial: string, pkg: string): boolean | null {
  const r = runAdb(sp, serial, ["shell", "dumpsys", "package", pkg]);
  if (r.status !== 0 || !r.stdout) return null;
  return !r.stdout.includes("com.google.android.gms.permission.AD_ID");
}

// --- Commands ----------------------------------------------------------------

function cmdVersion(): void {
  console.log(`claude-chrome-android v${PKG_VERSION}`);
}

function cmdHelp(): void {
  console.log(`
claude-chrome-android v${PKG_VERSION}
CFC Bridge — connects Claude Code CLI to Chrome/Edge on Android via WebSocket

Usage:
  claude-chrome-android              Start the bridge server
  claude-chrome-android --mcp        MCP server mode (spawned by Claude Code)
  claude-chrome-android --stop       Stop a running bridge
  claude-chrome-android --setup      Full setup: register MCP + create url-opener + Edge/extension
  claude-chrome-android --setup-edge Browser-side setup only: install Edge, patch, sideload extension
  claude-chrome-android --version    Print version
  claude-chrome-android --help       Show this help

Environment variables:
  BRIDGE_PORT       WebSocket port (default: 18963)
  BRIDGE_TOKEN      Optional shared secret for auth
  BRIDGE_LOG_LEVEL  Log level: debug|info|warn|error (default: info)
`.trim());
}

async function cmdStop(): Promise<void> {
  console.log("Stopping bridge...");
  try {
    const res = await fetchWithTimeout(SHUTDOWN_URL, { method: "POST", timeout: 3000 });
    if (res.ok) console.log("Shutdown request accepted");
  } catch { /* bridge may be dead */ }

  await new Promise((r) => setTimeout(r, 800));

  if (await isBridgeAlive()) {
    console.log("Bridge didn't stop gracefully, attempting pkill...");
    const { spawnSync } = await import("child_process");
    spawnSync("pkill", ["-f", "(bun|node).*claude-chrome"], { stdio: "ignore" });
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

// =============================================================================
// --setup: register MCP server in Claude Code settings + create url-opener
// =============================================================================

async function cmdSetup(): Promise<void> {
  console.log(`claude-chrome-android v${PKG_VERSION} — setup\n`);

  const isTermux = existsSync("/data/data/com.termux/files/usr/bin/bash");
  if (!isTermux) {
    console.warn("Warning: This doesn't look like Termux. Setup is designed for Android/Termux.\n");
  }

  console.log(`Runtime: Node.js ${process.version}`);
  const { spawnSync } = await import("child_process");
  const bunCheck = spawnSync("bun", ["--version"], { stdio: "pipe", encoding: "utf-8" });
  if (bunCheck.status === 0) {
    console.log(`Bun: ${bunCheck.stdout.trim()}`);
  }

  // --- Register MCP server in Claude Code settings.json ---
  const claudeDir = resolve(process.env.HOME ?? "~", ".claude");
  const settingsPath = resolve(claudeDir, "settings.json");

  // Resolve the path to this CLI for the MCP command
  // When installed globally: ~/.bun/install/global/node_modules/claude-chrome-android/dist/cli.js
  // When running via npx: use "npx" as command
  const cliPath = typeof __filename !== "undefined" ? __filename : "";
  let mcpCommand: string;
  let mcpArgs: string[];

  if (cliPath && existsSync(cliPath)) {
    // Direct path — fastest, no npx overhead
    mcpCommand = "node";
    mcpArgs = [cliPath, "--mcp"];
  } else {
    // Fallback to npx
    mcpCommand = "npx";
    mcpArgs = ["claude-chrome-android", "--mcp"];
  }

  try {
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }

    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    }

    const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;

    // Always set/update the entry so stale paths get corrected
    const existing = mcpServers["cfc-bridge"] as Record<string, unknown> | undefined;
    const desired = { command: mcpCommand, args: mcpArgs };
    const changed =
      !existing ||
      existing.command !== desired.command ||
      JSON.stringify(existing.args) !== JSON.stringify(desired.args);

    if (changed) {
      mcpServers["cfc-bridge"] = desired;
      settings.mcpServers = mcpServers;
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
      console.log(`Registered MCP server "cfc-bridge" in ${settingsPath}`);
      console.log(`  command: ${mcpCommand} ${mcpArgs.join(" ")}`);
    } else {
      console.log(`MCP server already registered in ${settingsPath}`);
    }
  } catch (err) {
    console.error(`Failed to register MCP server: ${(err as Error).message}`);
  }

  // --- Create ~/bin/termux-url-opener ---
  const binDir = resolve(process.env.HOME ?? "/data/data/com.termux/files/home", "bin");
  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
    console.log(`\nCreated ${binDir}/`);
  }

  const urlOpenerPath = resolve(binDir, "termux-url-opener");
  const urlOpenerExists = existsSync(urlOpenerPath);

  const urlOpenerScript = `#!/data/data/com.termux/files/usr/bin/bash
# termux-url-opener — handles URLs shared to Termux via Android share menu
# Generated by: claude-chrome-android --setup v${PKG_VERSION}

set -euo pipefail
url="\${1:-}"
echo "[\$(date +%H:%M:%S)] termux-url-opener: $url" >> "$PREFIX/tmp/url-opener.log"

case "$url" in
  *cfcbridge*/start*)
    BRIDGE_LOG="$PREFIX/tmp/bridge.log"
    # Health-check the bridge directly — avoids pgrep self-match
    if curl -sf --connect-timeout 2 http://127.0.0.1:18963/health > /dev/null 2>&1; then
      echo "[\$(date +%H:%M:%S)] bridge already running" >> "$PREFIX/tmp/url-opener.log"
      exit 0
    fi
    # Find a JS runtime that can actually execute code.
    # bun on Termux uses a C wrapper (bun-termux) that may fail if its
    # shim library is missing — test with a real eval, not just --version.
    _try_runtime() {
      "$1" -e "process.exit(0)" > /dev/null 2>&1
    }
    RUNTIME=""
    if [[ -x "$HOME/.bun/bin/bun" ]] && _try_runtime "$HOME/.bun/bin/bun"; then
      RUNTIME="$HOME/.bun/bin/bun"
    elif command -v bun > /dev/null 2>&1 && _try_runtime bun; then
      RUNTIME="\$(command -v bun)"
    elif command -v node > /dev/null 2>&1 && _try_runtime node; then
      RUNTIME="\$(command -v node)"
    fi
    if [[ -z "$RUNTIME" ]]; then
      echo "[\$(date +%H:%M:%S)] no working JS runtime found" >> "$PREFIX/tmp/url-opener.log"
      exit 1
    fi
    BRIDGE_SCRIPT=""
    if [[ -f "$HOME/git/termux-tools/claude-chrome-bridge.ts" ]]; then
      BRIDGE_SCRIPT="$HOME/git/termux-tools/claude-chrome-bridge.ts"
    fi
    NPM_GLOBAL="$HOME/.npm/lib/node_modules/claude-chrome-android/dist/cli.js"
    BUN_GLOBAL="$HOME/.bun/install/global/node_modules/claude-chrome-android/dist/cli.js"
    if [[ -z "$BRIDGE_SCRIPT" && -f "$NPM_GLOBAL" ]]; then BRIDGE_SCRIPT="$NPM_GLOBAL"
    elif [[ -z "$BRIDGE_SCRIPT" && -f "$BUN_GLOBAL" ]]; then BRIDGE_SCRIPT="$BUN_GLOBAL"
    fi
    if [[ -n "$BRIDGE_SCRIPT" ]]; then
      setsid nohup "$RUNTIME" "$BRIDGE_SCRIPT" > "$BRIDGE_LOG" 2>&1 &
    else
      setsid nohup npx claude-chrome-android > "$BRIDGE_LOG" 2>&1 &
    fi
    exit 0 ;;
  *)
    if command -v termux-open-url > /dev/null 2>&1; then termux-open-url "$url"
    elif command -v xdg-open > /dev/null 2>&1; then xdg-open "$url"
    fi ;;
esac
`;

  if (urlOpenerExists) {
    const existing = readFileSync(urlOpenerPath, "utf-8");
    if (existing.includes("cfcbridge")) {
      writeFileSync(`${urlOpenerPath}.bak`, existing);
      console.log(`Backed up existing url-opener to ${urlOpenerPath}.bak`);
    }
  }

  writeFileSync(urlOpenerPath, urlOpenerScript);
  chmodSync(urlOpenerPath, 0o755);
  console.log(`${urlOpenerExists ? "Updated" : "Created"} ${urlOpenerPath}`);

  // --- Guided Edge + extension setup ------------------------------------------
  await runEdgeSetup(spawnSync, Boolean(process.stdin.isTTY));

  console.log(`
Setup complete!

Next steps:
  1. Start the bridge:  npx claude-chrome-android
  2. Open Edge — the extension loads automatically via --load-extension
  3. Open a new Claude Code session — browser tools (mcp__cfc-bridge__*) will be available
  4. Use ToolSearch to find and load cfc-bridge tools

To re-run just the browser-side setup later:
  npx claude-chrome-android --setup-edge   (Edge + patch + extension)
`);
}

/**
 * Push the unpacked CFC extension to the device and wire up the
 * --load-extension flag + debug_app so Edge loads it on next launch.
 * Edge Android's MV3 service workers don't start for sideloaded extensions and
 * CRX downloads don't trigger install, so we sideload unpacked files instead.
 */
async function installExtension(sp: SpawnSync, serial?: string): Promise<boolean> {
  const extDir = findExtDir();
  const adbSerial = serial ?? resolveAdbSerial(sp);

  if (!extDir) {
    console.log("\nExtension source not found. Skipping extension install.");
    console.log("To install manually, clone the repo and run push-extension.sh.");
    return false;
  }
  if (!adbSerial) {
    console.log("\nADB not available. Extension install requires ADB connection.");
    console.log("Connect via: adb tcpip 5555 && adb connect <device-ip>");
    return false;
  }

  const extVersion = (() => {
    try {
      return JSON.parse(readFileSync(resolve(extDir, "manifest.json"), "utf-8")).version as string;
    } catch { return PKG_VERSION; }
  })();

  const EXT_FILES = [
    "manifest.json", "background.js", "content.js",
    "popup.html", "popup.js", "launcher.html", "launcher.js",
    "icon16.png", "icon48.png", "icon128.png",
  ];
  const LOAD_EXT_FLAG = `--load-extension=${EXT_DEST}`;

  console.log(`\nInstalling CFC extension v${extVersion} via --load-extension...`);

  runAdb(sp, adbSerial, ["shell", "mkdir", "-p", EXT_DEST]);

  let pushed = 0;
  for (const f of EXT_FILES) {
    const src = resolve(extDir, f);
    if (existsSync(src)) {
      const r = runAdb(sp, adbSerial, ["push", src, `${EXT_DEST}/${f}`]);
      if (r.status === 0) pushed++;
    }
  }
  console.log(`  Pushed ${pushed}/${EXT_FILES.length} files to ${EXT_DEST}`);

  const flagsResult = runAdb(sp, adbSerial, ["shell", "cat", FLAGS_FILE]);
  let currentFlags = flagsResult.stdout?.trim() || "";

  if (!currentFlags.includes("--load-extension=")) {
    currentFlags = currentFlags ? `${currentFlags} ${LOAD_EXT_FLAG}` : `_ ${LOAD_EXT_FLAG}`;
    runAdb(sp, adbSerial, ["shell", `echo '${currentFlags}' > ${FLAGS_FILE}`]);
    console.log("  Added --load-extension flag to chrome-command-line");
  } else if (!currentFlags.includes(EXT_DEST)) {
    currentFlags = currentFlags.replace(/--load-extension=\S+/, LOAD_EXT_FLAG);
    runAdb(sp, adbSerial, ["shell", `echo '${currentFlags}' > ${FLAGS_FILE}`]);
    console.log("  Updated --load-extension path in chrome-command-line");
  } else {
    console.log("  --load-extension flag already set");
  }

  const edgePkg = detectEdgePkg(sp, adbSerial);
  if (edgePkg) {
    runAdb(sp, adbSerial, ["shell", "settings", "put", "global", "debug_app", edgePkg]);
    console.log(`  Set debug_app=${edgePkg} for flag reading`);
    runAdb(sp, adbSerial, ["shell", "am", "force-stop", edgePkg]);
    console.log(`  Restarted ${edgePkg} to apply changes`);
  } else {
    console.log("  WARNING: No Edge browser found. Install Edge Canary from the Play Store.");
  }

  console.log("  Extension will load automatically when Edge starts.");
  return true;
}

// =============================================================================
// Guided Edge setup: detect missing pieces (Edge / patch / extension) and fix
// =============================================================================

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function ask(question: string): Promise<string> {
  return new Promise((res) => {
    const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer: string) => { rl.close(); res(answer.trim().toLowerCase()); });
  });
}

const isYes = (a: string) => a === "" || a === "y" || a === "yes";

const EDGE_CANARY = "com.microsoft.emmx.canary";

/**
 * Ensure an Edge variant is installed. If none is found and we're interactive,
 * open the Play Store listing for Edge Canary via an ADB deeplink, wait for the
 * user to tap Install, then poll until the package appears. Play has no silent
 * install API, so the one tap is unavoidable — we just make it one tap.
 */
async function ensureEdgeInstalled(sp: SpawnSync, serial: string, interactive: boolean): Promise<string> {
  let pkg = detectEdgePkg(sp, serial);
  if (pkg) return pkg;

  const listing = `https://play.google.com/store/apps/details?id=${EDGE_CANARY}`;
  if (!interactive) {
    console.log(`\nEdge not installed. Install Edge Canary, then re-run:\n  ${listing}`);
    return "";
  }

  const a = await ask("\nEdge isn't installed. Open the Play Store to install Edge Canary now? [Y/n] ");
  if (!isYes(a)) { console.log("Skipped Edge install."); return ""; }

  runAdb(sp, serial, ["shell", `am start -a android.intent.action.VIEW -d 'market://details?id=${EDGE_CANARY}'`]);
  console.log("Opened the Play Store on your device. Tap Install, wait for it to finish, then return here.");
  await ask("Press Enter once Edge Canary has finished installing... ");

  for (let i = 0; i < 5 && !pkg; i++) {
    pkg = detectEdgePkg(sp, serial);
    if (!pkg) await sleep(2000);
  }
  if (pkg) console.log(`Detected ${pkg}.`);
  else console.log("Still don't see Edge installed — skipping the rest of setup.");
  return pkg;
}

interface EdgeStatus {
  hasAdb: boolean;
  serial: string;
  multiOnline: boolean;
  edgePkg: string;
  patched: boolean | null;
  extPushed: boolean;
  flagsLoadExt: boolean;
  clients: number | null;
}

async function probeEdge(sp: SpawnSync): Promise<EdgeStatus> {
  const serial = resolveAdbSerial(sp);
  const hasAdb = serial !== "";
  const multiOnline = listAdbDevices(sp).filter((d) => d.state === "device").length > 1;
  const edgePkg = hasAdb ? detectEdgePkg(sp, serial) : "";
  return {
    hasAdb,
    serial,
    multiOnline,
    edgePkg,
    patched: hasAdb && edgePkg ? edgeIsPatched(sp, serial, edgePkg) : null,
    extPushed: hasAdb ? extPushed(sp, serial) : false,
    flagsLoadExt: hasAdb ? flagsLoadExt(sp, serial) : false,
    clients: await bridgeClientCount(),
  };
}

function printEdgeStatus(s: EdgeStatus): void {
  const mark = (ok: boolean | null) => (ok === null ? "?" : ok ? "OK" : "MISSING");
  console.log("CFC environment check:");
  console.log(`  [${mark(s.hasAdb)}] ADB device connected${s.serial ? ` (${s.serial})` : ""}`);
  console.log(`  [${s.edgePkg ? "OK" : "MISSING"}] Edge installed${s.edgePkg ? ` (${s.edgePkg})` : ""}`);
  console.log(`  [${mark(s.patched)}] Edge privacy-patched (AD_ID stripped)`);
  console.log(`  [${mark(s.extPushed && s.flagsLoadExt)}] CFC extension sideloaded + flag set`);
  console.log(`  [${s.clients === null ? "—" : s.clients > 0 ? "OK" : "MISSING"}] Extension connected to bridge${s.clients !== null ? ` (${s.clients} client${s.clients === 1 ? "" : "s"})` : " (bridge not running)"}`);
  if (s.multiOnline) {
    console.log(`  note: multiple devices online — targeting ${s.serial}; set ADB_SERIAL to override`);
  }
}

/**
 * Offer to (re)build a privacy-patched Edge from the installed copy via
 * edge-fix/build-from-device.sh. Requires the source repo + build toolchain;
 * we never auto-download base Edge (no Play/APKMirror API) and never touch the
 * keystore here.
 */
async function offerPatchBuild(sp: SpawnSync, serial: string, edgePkg: string, interactive: boolean): Promise<void> {
  const script = findBuildScript();
  // build-from-device.sh takes `-s <serial>` to pin the device it pulls from.
  const serialArgs = serial ? ["-s", serial] : [];
  if (!script) {
    console.log("\nTo build a privacy-patched Edge from your installed copy:");
    console.log("  git clone https://github.com/tribixbite/termux-tools");
    console.log(`  cd termux-tools/edge-fix && ./build-from-device.sh ${serialArgs.join(" ")} --install`.replace(/\s+/g, " "));
    console.log("(needs apktool, zipalign/apksigner, java, python3 + the tool jars in tools/)");
    return;
  }
  if (!interactive) {
    console.log(`\nRun the self-build to patch Edge (no data wipe on re-sign):`);
    console.log(`  ${script} ${serialArgs.join(" ")} --install`.replace(/\s+$/, ""));
    return;
  }
  const a = await ask(`\nBuild + install a privacy-patched ${edgePkg} now via build-from-device.sh? [Y/n] `);
  if (!isYes(a)) { console.log("Skipped patch build."); return; }
  console.log("\nRunning build-from-device.sh --install (this takes a few minutes)...\n");
  const r = sp("bash", [script, ...serialArgs, "--install"], { stdio: "inherit" });
  if (r.status === 0) console.log("\nPatched Edge installed.");
  else console.log(`\nbuild-from-device.sh exited ${r.status}. See output above.`);
}

/**
 * The guided browser-side setup, shared by `--setup`, the standalone
 * `--setup-edge`, and the default `claude-chrome-android` run. Prints a status
 * table, then (when interactive) walks the user through installing Edge,
 * building the privacy-patched build, and sideloading the CFC extension.
 * Returns true if everything looks ready (Edge + patched + extension wired).
 */
async function runEdgeSetup(sp: SpawnSync, interactive: boolean): Promise<boolean> {
  const s = await probeEdge(sp);
  printEdgeStatus(s);

  if (!s.hasAdb) {
    console.log("\nNo ADB device. Connect with: adb tcpip 5555 && adb connect <device-ip>");
    return false;
  }

  const serial = s.serial;

  // 1. Edge installed? Offer the Play Store deeplink install.
  const edgePkg = s.edgePkg || (await ensureEdgeInstalled(sp, serial, interactive));
  if (!edgePkg) return false;

  // 2. Privacy-patched? Offer the self-build (no data wipe on re-sign).
  const patched = s.edgePkg ? s.patched : edgeIsPatched(sp, serial, edgePkg);
  if (patched !== true) {
    if (patched === false) console.log("\nYour Edge still ships tracking permissions.");
    await offerPatchBuild(sp, serial, edgePkg, interactive);
  }

  // 3. Extension sideloaded + connected?
  const reProbe = await probeEdge(sp);
  if (!reProbe.extPushed || !reProbe.flagsLoadExt || reProbe.clients === 0) {
    if (interactive) {
      const a = await ask("\nSideload the CFC extension into Edge now? [Y/n] ");
      if (isYes(a)) await installExtension(sp, serial);
      else console.log("Skipped extension install.");
    } else {
      console.log("\nInstall the CFC extension with: claude-chrome-android --setup");
    }
  }

  const final = await probeEdge(sp);
  return Boolean(final.edgePkg && final.patched === true && final.extPushed && final.flagsLoadExt);
}

async function cmdSetupEdge(): Promise<void> {
  console.log(`claude-chrome-android v${PKG_VERSION} — Edge setup\n`);
  const { spawnSync } = await import("child_process");
  await runEdgeSetup(spawnSync, Boolean(process.stdin.isTTY));
  console.log("\nDone. Start the bridge with: claude-chrome-android");
}

// =============================================================================
// Default: run setup if needed, then start the bridge server
// =============================================================================

async function cmdStart(): Promise<void> {
  if (await isBridgeAlive()) {
    console.log(`Bridge is already running on ws://${WS_HOST}:${WS_PORT}`);
    console.log("Use --stop to stop it first, or --help for more options.");
    process.exit(0);
  }

  // First-run guidance: when launched from a terminal and the browser side
  // isn't wired up, walk the user through setup before starting. Never block a
  // non-interactive launch (e.g. spawned by termux-url-opener under nohup).
  const interactive = Boolean(process.stdin.isTTY);
  try {
    const { spawnSync } = await import("child_process");
    const serial = resolveAdbSerial(spawnSync);
    if (serial) {
      const edgePkg = detectEdgePkg(spawnSync, serial);
      const ready = edgePkg && extPushed(spawnSync, serial) && flagsLoadExt(spawnSync, serial);
      if (!ready) {
        if (interactive) {
          console.log("First-time setup: let's get Edge + the CFC extension ready.\n");
          await runEdgeSetup(spawnSync, true);
          console.log("");
        } else {
          console.log("\nHeads up: Edge + CFC extension don't look fully set up.");
          console.log("Run `claude-chrome-android --setup-edge` to finish setup.\n");
        }
      }
    }
  } catch { /* best-effort only — never block the bridge */ }

  console.log(`Starting CFC Bridge v${PKG_VERSION} on ws://${WS_HOST}:${WS_PORT}...`);

  try {
    await import("../../claude-chrome-bridge");
  } catch (err: any) {
    console.error("Failed to start bridge:", err.message);
    console.error("\nIf you installed via npm, the bridge should be bundled in this file.");
    console.error("Try rebuilding: cd bridge && node build.cjs");
    process.exit(1);
  }
}

// =============================================================================
// --mcp: MCP server mode — thin stdio relay to bridge HTTP /tool endpoint
// Spawned by Claude Code as a child process. Minimal memory footprint (~5MB).
// =============================================================================

// --- MCP Tool definitions (mirrors CFC built-in) -----------------------------

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const MCP_TOOLS: McpTool[] = [
  {
    name: "tabs_context_mcp",
    description: "Get context information about the current MCP tab group. Returns all tab IDs inside the group if it exists. CRITICAL: You must get the context at least once before using other browser automation tools so you know what tabs exist.",
    inputSchema: {
      type: "object",
      properties: { createIfEmpty: { type: "boolean", description: "Creates a new MCP tab group if none exists." } },
      required: [],
    },
  },
  {
    name: "tabs_create_mcp",
    description: "Creates a new empty tab in the MCP tab group.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "navigate",
    description: "Navigate to a URL, or go forward/back in browser history.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: 'URL to navigate to. Use "forward" or "back" for history.' },
        tabId: { type: "number", description: "Tab ID to navigate." },
      },
      required: ["url", "tabId"],
    },
  },
  {
    name: "computer",
    description: "Use a mouse and keyboard to interact with a web browser, and take screenshots.\n* Consult a screenshot to determine coordinates before clicking.\n* Click buttons/icons in the center of the element.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["left_click", "right_click", "type", "screenshot", "wait", "scroll", "key", "left_click_drag", "double_click", "triple_click", "zoom", "scroll_to", "hover"],
          description: "The action to perform.",
        },
        coordinate: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "(x, y) pixel coordinates." },
        text: { type: "string", description: "Text to type or key(s) to press." },
        duration: { type: "number", minimum: 0, maximum: 30, description: "Seconds to wait." },
        scroll_direction: { type: "string", enum: ["up", "down", "left", "right"], description: "Scroll direction." },
        scroll_amount: { type: "number", minimum: 1, maximum: 10, description: "Scroll ticks (default: 3)." },
        start_coordinate: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "Start coords for drag." },
        region: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4, description: "(x0,y0,x1,y1) for zoom." },
        repeat: { type: "number", minimum: 1, maximum: 100, description: "Key repeat count." },
        ref: { type: "string", description: "Element ref ID for scroll_to." },
        modifiers: { type: "string", description: 'Modifier keys: "ctrl", "shift", "alt", "cmd".' },
        tabId: { type: "number", description: "Tab ID." },
      },
      required: ["action", "tabId"],
    },
  },
  {
    name: "javascript_tool",
    description: "Execute JavaScript in the page context. Returns the last expression result.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "Must be 'javascript_exec'" },
        text: { type: "string", description: "JavaScript code. Don't use 'return'." },
        tabId: { type: "number", description: "Tab ID." },
      },
      required: ["action", "text", "tabId"],
    },
  },
  {
    name: "read_page",
    description: "Get accessibility tree of page elements. Filter for interactive elements or get all.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["interactive", "all"], description: "Element filter." },
        tabId: { type: "number", description: "Tab ID." },
        depth: { type: "number", description: "Max tree depth (default: 15)." },
        ref_id: { type: "string", description: "Parent element ref to focus on." },
        max_chars: { type: "number", description: "Max output chars (default: 50000)." },
      },
      required: ["tabId"],
    },
  },
  {
    name: "find",
    description: 'Find elements by natural language (e.g., "search bar", "login button").',
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to find." },
        tabId: { type: "number", description: "Tab ID." },
      },
      required: ["query", "tabId"],
    },
  },
  {
    name: "form_input",
    description: "Set form element values using ref ID from read_page.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Element ref ID." },
        value: { type: ["string", "boolean", "number"], description: "Value to set." },
        tabId: { type: "number", description: "Tab ID." },
      },
      required: ["ref", "value", "tabId"],
    },
  },
  {
    name: "get_page_text",
    description: "Extract raw text content from the page.",
    inputSchema: {
      type: "object",
      properties: { tabId: { type: "number", description: "Tab ID." } },
      required: ["tabId"],
    },
  },
  {
    name: "read_console_messages",
    description: "Read browser console messages. Always provide a pattern to filter.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID." },
        onlyErrors: { type: "boolean", description: "Errors only." },
        clear: { type: "boolean", description: "Clear after reading." },
        pattern: { type: "string", description: "Regex filter pattern." },
        limit: { type: "number", description: "Max messages (default: 100)." },
      },
      required: ["tabId"],
    },
  },
  {
    name: "read_network_requests",
    description: "Read HTTP network requests from a tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID." },
        urlPattern: { type: "string", description: "URL substring filter." },
        clear: { type: "boolean", description: "Clear after reading." },
        limit: { type: "number", description: "Max requests (default: 100)." },
      },
      required: ["tabId"],
    },
  },
  {
    name: "resize_window",
    description: "Resize browser window.",
    inputSchema: {
      type: "object",
      properties: {
        width: { type: "number", description: "Width in pixels." },
        height: { type: "number", description: "Height in pixels." },
        tabId: { type: "number", description: "Tab ID." },
      },
      required: ["width", "height", "tabId"],
    },
  },
  {
    name: "gif_creator",
    description: "Record and export browser session GIFs.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start_recording", "stop_recording", "export", "clear"], description: "Action." },
        tabId: { type: "number", description: "Tab ID." },
        download: { type: "boolean", description: "Download GIF on export." },
        filename: { type: "string", description: "GIF filename." },
        options: { type: "object", description: "GIF options." },
      },
      required: ["action", "tabId"],
    },
  },
  {
    name: "upload_image",
    description: "Upload a screenshot to a file input or drag & drop target.",
    inputSchema: {
      type: "object",
      properties: {
        imageId: { type: "string", description: "Screenshot ID." },
        ref: { type: "string", description: "Element ref ID." },
        coordinate: { type: "array", items: { type: "number" }, description: "Drop coords [x,y]." },
        tabId: { type: "number", description: "Tab ID." },
        filename: { type: "string", description: "Filename." },
      },
      required: ["imageId", "tabId"],
    },
  },
  {
    name: "update_plan",
    description: "Present a plan to the user for approval.",
    inputSchema: {
      type: "object",
      properties: {
        domains: { type: "array", items: { type: "string" }, description: "Domains to visit." },
        approach: { type: "array", items: { type: "string" }, description: "Steps to take." },
      },
      required: ["domains", "approach"],
    },
  },
  {
    name: "shortcuts_list",
    description: "List available shortcuts and workflows.",
    inputSchema: {
      type: "object",
      properties: { tabId: { type: "number", description: "Tab ID." } },
      required: ["tabId"],
    },
  },
  {
    name: "shortcuts_execute",
    description: "Execute a shortcut or workflow.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID." },
        shortcutId: { type: "string", description: "Shortcut ID." },
        command: { type: "string", description: "Command name." },
      },
      required: ["tabId"],
    },
  },
  {
    name: "switch_browser",
    description: "Switch which Chrome browser is used for automation.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

// --- MCP JSON-RPC helpers ----------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function mcpResult(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function mcpError(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function mcpSend(response: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(response) + "\n");
}

// --- MCP bridge client -------------------------------------------------------

async function callBridgeTool(
  method: string,
  params: Record<string, unknown>,
): Promise<{ result?: unknown; error?: string }> {
  try {
    const resp = await fetch(TOOL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
      signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const body = await resp.text();
      return { error: `Bridge HTTP ${resp.status}: ${body}` };
    }
    // Read as text first, then parse — avoids body-consumed error if JSON parsing fails
    const text = await resp.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { error: `Bridge returned non-JSON: ${text.slice(0, 200)}` };
    }
    if (data.error) return { error: String(data.error) };
    return { result: data.result ?? data };
  } catch (err) {
    return { error: `Bridge unreachable: ${(err as Error).message}` };
  }
}

/** Convert bridge tool_response to MCP content blocks */
function formatToolResult(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== "object") {
    return [{ type: "text", text: JSON.stringify(result) }];
  }
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.content)) return r.content as Array<Record<string, unknown>>;
  if (r.data && typeof r.data === "string" && r.media_type) {
    return [{ type: "image", source: { type: "base64", media_type: r.media_type, data: r.data } }];
  }
  if (r.result !== undefined) return formatToolResult(r.result);
  return [{ type: "text", text: JSON.stringify(result, null, 2) }];
}

// --- MCP request handler -----------------------------------------------------

async function handleMcpRequest(req: JsonRpcRequest): Promise<void> {
  if (req.id === undefined || req.id === null) return; // notification

  switch (req.method) {
    case "initialize":
      mcpSend(mcpResult(req.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "Claude in Chrome (Bridge)", version: PKG_VERSION },
      }));
      break;

    case "tools/list":
      mcpSend(mcpResult(req.id, { tools: MCP_TOOLS }));
      break;

    case "tools/call": {
      const toolName = (req.params?.name as string) ?? "";
      const toolArgs = (req.params?.arguments as Record<string, unknown>) ?? {};
      const tool = MCP_TOOLS.find((t) => t.name === toolName);
      if (!tool) {
        mcpSend(mcpResult(req.id, { content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true }));
        break;
      }
      const { result, error } = await callBridgeTool(toolName, toolArgs);
      if (error) {
        mcpSend(mcpResult(req.id, { content: [{ type: "text", text: error }], isError: true }));
      } else {
        mcpSend(mcpResult(req.id, { content: formatToolResult(result) }));
      }
      break;
    }

    default:
      mcpSend(mcpError(req.id, -32601, `Method not found: ${req.method}`));
  }
}

// --- MCP stdio transport -----------------------------------------------------

async function cmdMcp(): Promise<void> {
  const log = (msg: string) => process.stderr.write(`[cfc-mcp] ${msg}\n`);
  log(`MCP server v${PKG_VERSION} — bridge at ${BRIDGE_URL}`);

  // Quick health check (non-blocking)
  try {
    const h = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
    const d = (await h.json()) as Record<string, unknown>;
    log(`Bridge OK: clients=${d.clients}, v${d.version}`);
  } catch {
    log("Bridge not reachable — tool calls will fail until bridge starts");
  }

  // Read newline-delimited JSON-RPC from stdin
  const decoder = new TextDecoder();
  let buffer = "";
  const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB — prevent OOM from malformed input

  for await (const chunk of process.stdin) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array);

    // Guard against unbounded buffer growth (no newline in input)
    if (buffer.length > MAX_BUFFER_SIZE) {
      log(`WARN: MCP buffer exceeded ${MAX_BUFFER_SIZE} bytes, discarding`);
      buffer = "";
      mcpSend(mcpError(0, -32600, "Request too large"));
      continue;
    }

    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const req = JSON.parse(line) as JsonRpcRequest;
        handleMcpRequest(req).catch((err) => {
          log(`Error: ${req.method}: ${(err as Error).message}`);
          if (req.id != null) mcpSend(mcpError(req.id, -32603, (err as Error).message));
        });
      } catch (err) {
        log(`Bad JSON-RPC: ${(err as Error).message}`);
      }
    }
  }

  log("stdin closed");
  process.exit(0);
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
  case "--setup-edge":
  case "--doctor":
    cmdSetupEdge();
    break;
  case "--mcp":
    cmdMcp();
    break;
  case "":
    cmdStart();
    break;
  default:
    console.error(`Unknown option: ${command}`);
    cmdHelp();
    process.exit(1);
}
