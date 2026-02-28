/**
 * claude-chrome-android CLI — CFC bridge + MCP server for Android/Termux.
 * Shebang added by esbuild banner during build.
 *
 * Usage:
 *   npx claude-chrome-android            Start the bridge server
 *   npx claude-chrome-android --mcp      MCP server mode (spawned by Claude Code)
 *   npx claude-chrome-android --stop     Stop a running bridge
 *   npx claude-chrome-android --setup    Register MCP server + create url-opener
 *   npx claude-chrome-android --version  Print version
 *   npx claude-chrome-android --help     Show help
 */

import { resolve, dirname } from "path";
import { writeFileSync, mkdirSync, chmodSync, existsSync, readFileSync } from "fs";

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
  claude-chrome-android --setup      Register MCP server in Claude Code + create url-opener
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
    if pgrep -f "(bun|node).*claude-chrome" > /dev/null 2>&1; then
      echo "[\$(date +%H:%M:%S)] bridge already running" >> "$PREFIX/tmp/url-opener.log"
      exit 0
    fi
    RUNTIME=""
    if [[ -x "$HOME/.bun/bin/bun" ]]; then RUNTIME="$HOME/.bun/bin/bun"
    elif command -v bun > /dev/null 2>&1; then RUNTIME="\$(command -v bun)"
    elif command -v node > /dev/null 2>&1; then RUNTIME="\$(command -v node)"
    fi
    if [[ -z "$RUNTIME" ]]; then exit 1; fi
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

  console.log(`
Setup complete!

Next steps:
  1. Start the bridge:  npx claude-chrome-android
  2. Open a new Claude Code session — browser tools (mcp__cfc-bridge__*) will be available
  3. Use ToolSearch to find and load cfc-bridge tools
`);
}

// =============================================================================
// Default: start the bridge server
// =============================================================================

async function cmdStart(): Promise<void> {
  if (await isBridgeAlive()) {
    console.log(`Bridge is already running on ws://${WS_HOST}:${WS_PORT}`);
    console.log("Use --stop to stop it first, or --help for more options.");
    process.exit(0);
  }

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
    const data = (await resp.json()) as Record<string, unknown>;
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

  for await (const chunk of process.stdin) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array);
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
