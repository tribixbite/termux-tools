#!/usr/bin/env bun
/**
 * Bridge MCP Server — MCP protocol wrapper for claude-chrome-bridge
 *
 * Speaks JSON-RPC 2.0 (MCP) over stdio and relays tool calls to the
 * bridge's HTTP POST /tool endpoint. This replaces Claude Code's
 * built-in CFC MCP server which crashes on Termux due to /tmp and
 * null-spread bugs in cli.js.
 *
 * Register in ~/.claude/settings.json:
 *   "mcpServers": {
 *     "claude-in-chrome": {
 *       "command": "bun",
 *       "args": ["<path>/bridge-mcp.ts"]
 *     }
 *   }
 *
 * — Opus 4.6
 */

// --- Configuration -----------------------------------------------------------

const BRIDGE_URL = process.env.BRIDGE_URL ?? "http://127.0.0.1:18963";
const TOOL_TIMEOUT_MS = 30_000;

// --- Tool Definitions --------------------------------------------------------
// Mirrors the tools from Claude Code's built-in CFC MCP server exactly,
// so Claude sees the same interface regardless of which backend serves them.

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: McpTool[] = [
  {
    name: "tabs_context_mcp",
    description:
      "Get context information about the current MCP tab group. Returns all tab IDs inside the group if it exists. CRITICAL: You must get the context at least once before using other browser automation tools so you know what tabs exist. Each new conversation should create its own new tab (using tabs_create_mcp) rather than reusing existing tabs, unless the user explicitly asks to use an existing tab.",
    inputSchema: {
      type: "object",
      properties: {
        createIfEmpty: {
          type: "boolean",
          description:
            "Creates a new MCP tab group if none exists, creates a new Window with a new tab group containing an empty tab (which can be used for this conversation). If a MCP tab group already exists, this parameter has no effect.",
        },
      },
      required: [],
    },
  },
  {
    name: "tabs_create_mcp",
    description:
      "Creates a new empty tab in the MCP tab group. CRITICAL: You must get the context using tabs_context_mcp at least once before using other browser automation tools so you know what tabs exist.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "navigate",
    description:
      'Navigate to a URL, or go forward/back in browser history. If you don\'t have a valid tab ID, use tabs_context_mcp first to get available tabs.',
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            'The URL to navigate to. Can be provided with or without protocol (defaults to https://). Use "forward" to go forward in history or "back" to go back in history.',
        },
        tabId: {
          type: "number",
          description:
            "Tab ID to navigate. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID.",
        },
      },
      required: ["url", "tabId"],
    },
  },
  {
    name: "computer",
    description:
      "Use a mouse and keyboard to interact with a web browser, and take screenshots. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs.\n* Whenever you intend to click on an element like an icon, you should consult a screenshot to determine the coordinates of the element before moving the cursor.\n* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "left_click", "right_click", "type", "screenshot", "wait",
            "scroll", "key", "left_click_drag", "double_click",
            "triple_click", "zoom", "scroll_to", "hover",
          ],
          description: "The action to perform.",
        },
        coordinate: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description: "(x, y): pixel coordinates from top-left.",
        },
        text: {
          type: "string",
          description:
            "The text to type (for `type` action) or the key(s) to press (for `key` action).",
        },
        duration: {
          type: "number",
          minimum: 0,
          maximum: 30,
          description: "Seconds to wait. Required for `wait`.",
        },
        scroll_direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "Direction to scroll. Required for `scroll`.",
        },
        scroll_amount: {
          type: "number",
          minimum: 1,
          maximum: 10,
          description: "Number of scroll ticks. Defaults to 3.",
        },
        start_coordinate: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description: "Starting coordinates for `left_click_drag`.",
        },
        region: {
          type: "array",
          items: { type: "number" },
          minItems: 4,
          maxItems: 4,
          description:
            "(x0, y0, x1, y1): rectangular region for `zoom`.",
        },
        repeat: {
          type: "number",
          minimum: 1,
          maximum: 100,
          description: "Times to repeat key sequence. For `key` only.",
        },
        ref: {
          type: "string",
          description:
            'Element reference ID from read_page or find tools. Required for `scroll_to`.',
        },
        modifiers: {
          type: "string",
          description:
            'Modifier keys for click actions: "ctrl", "shift", "alt", "cmd". Combine with "+".',
        },
        tabId: {
          type: "number",
          description: "Tab ID to execute the action on.",
        },
      },
      required: ["action", "tabId"],
    },
  },
  {
    name: "javascript_tool",
    description:
      "Execute JavaScript code in the context of the current page. Returns the result of the last expression or any thrown errors.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Must be set to 'javascript_exec'",
        },
        text: {
          type: "string",
          description:
            "The JavaScript code to execute. Do NOT use 'return' statements.",
        },
        tabId: {
          type: "number",
          description: "Tab ID to execute the code in.",
        },
      },
      required: ["action", "text", "tabId"],
    },
  },
  {
    name: "read_page",
    description:
      "Get an accessibility tree representation of elements on the page. Optionally filter for only interactive elements.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["interactive", "all"],
          description: 'Filter: "interactive" for buttons/links/inputs, "all" for everything.',
        },
        tabId: { type: "number", description: "Tab ID to read from." },
        depth: {
          type: "number",
          description: "Maximum tree depth (default: 15).",
        },
        ref_id: {
          type: "string",
          description: "Reference ID of a parent element to focus on.",
        },
        max_chars: {
          type: "number",
          description: "Maximum output characters (default: 50000).",
        },
      },
      required: ["tabId"],
    },
  },
  {
    name: "find",
    description:
      'Find elements on the page using natural language (e.g., "search bar", "login button").',
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language description of what to find.",
        },
        tabId: { type: "number", description: "Tab ID to search in." },
      },
      required: ["query", "tabId"],
    },
  },
  {
    name: "form_input",
    description:
      "Set values in form elements using element reference ID from read_page.",
    inputSchema: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: 'Element reference ID (e.g., "ref_1").',
        },
        value: {
          type: ["string", "boolean", "number"],
          description: "The value to set.",
        },
        tabId: { type: "number", description: "Tab ID." },
      },
      required: ["ref", "value", "tabId"],
    },
  },
  {
    name: "get_page_text",
    description:
      "Extract raw text content from the page, prioritizing article content.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID to extract text from." },
      },
      required: ["tabId"],
    },
  },
  {
    name: "read_console_messages",
    description:
      "Read browser console messages (log, error, warn) from a specific tab. Always provide a pattern to filter.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID." },
        onlyErrors: { type: "boolean", description: "Only return errors." },
        clear: { type: "boolean", description: "Clear after reading." },
        pattern: {
          type: "string",
          description: "Regex pattern to filter messages.",
        },
        limit: { type: "number", description: "Max messages (default: 100)." },
      },
      required: ["tabId"],
    },
  },
  {
    name: "read_network_requests",
    description:
      "Read HTTP network requests (XHR, Fetch, documents, images) from a tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID." },
        urlPattern: {
          type: "string",
          description: "URL substring to filter requests.",
        },
        clear: { type: "boolean", description: "Clear after reading." },
        limit: { type: "number", description: "Max requests (default: 100)." },
      },
      required: ["tabId"],
    },
  },
  {
    name: "resize_window",
    description: "Resize the browser window to specified dimensions.",
    inputSchema: {
      type: "object",
      properties: {
        width: { type: "number", description: "Target width in pixels." },
        height: { type: "number", description: "Target height in pixels." },
        tabId: { type: "number", description: "Tab ID." },
      },
      required: ["width", "height", "tabId"],
    },
  },
  {
    name: "gif_creator",
    description:
      "Manage GIF recording and export for browser automation sessions.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start_recording", "stop_recording", "export", "clear"],
          description: "Action to perform.",
        },
        tabId: { type: "number", description: "Tab ID." },
        download: {
          type: "boolean",
          description: "Set true for export action to download the GIF.",
        },
        filename: { type: "string", description: "Optional GIF filename." },
        options: {
          type: "object",
          description: "GIF enhancement options for export.",
        },
      },
      required: ["action", "tabId"],
    },
  },
  {
    name: "upload_image",
    description:
      "Upload a previously captured screenshot or image to a file input or drag & drop target.",
    inputSchema: {
      type: "object",
      properties: {
        imageId: {
          type: "string",
          description: "ID of a previously captured screenshot.",
        },
        ref: { type: "string", description: "Element reference ID." },
        coordinate: {
          type: "array",
          items: { type: "number" },
          description: "Viewport coordinates [x, y] for drag & drop.",
        },
        tabId: { type: "number", description: "Tab ID." },
        filename: { type: "string", description: "Optional filename." },
      },
      required: ["imageId", "tabId"],
    },
  },
  {
    name: "update_plan",
    description:
      "Present a plan to the user for approval before taking actions.",
    inputSchema: {
      type: "object",
      properties: {
        domains: {
          type: "array",
          items: { type: "string" },
          description: "List of domains you will visit.",
        },
        approach: {
          type: "array",
          items: { type: "string" },
          description: "High-level description of what you will do.",
        },
      },
      required: ["domains", "approach"],
    },
  },
  {
    name: "shortcuts_list",
    description: "List all available shortcuts and workflows.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID." },
      },
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
    description:
      "Switch which Chrome browser is used for browser automation. Broadcasts a connection request.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

// --- JSON-RPC helpers --------------------------------------------------------

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
  error?: { code: number; message: string; data?: unknown };
}

function jsonRpcResult(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(
  id: number | string | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function send(response: JsonRpcResponse): void {
  const json = JSON.stringify(response);
  process.stdout.write(json + "\n");
}

// --- Bridge HTTP client ------------------------------------------------------

async function callBridgeTool(
  method: string,
  params: Record<string, unknown>,
): Promise<{ result?: unknown; error?: string }> {
  try {
    const resp = await fetch(`${BRIDGE_URL}/tool`, {
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

    // Bridge returns {type: "tool_response", result: {...}} or {type: "tool_response", error: "..."}
    if (data.error) return { error: String(data.error) };
    return { result: data.result ?? data };
  } catch (err) {
    return { error: `Bridge unreachable: ${(err as Error).message}` };
  }
}

// --- MCP request handler -----------------------------------------------------

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  // Notifications (no id) — just acknowledge
  if (req.id === undefined || req.id === null) return;

  switch (req.method) {
    case "initialize":
      send(
        jsonRpcResult(req.id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "Claude in Chrome (Bridge)", version: "1.0.0" },
        }),
      );
      break;

    case "tools/list":
      send(jsonRpcResult(req.id, { tools: TOOLS }));
      break;

    case "tools/call": {
      const toolName = (req.params?.name as string) ?? "";
      const toolArgs = (req.params?.arguments as Record<string, unknown>) ?? {};

      const tool = TOOLS.find((t) => t.name === toolName);
      if (!tool) {
        send(
          jsonRpcResult(req.id, {
            content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
            isError: true,
          }),
        );
        break;
      }

      const { result, error } = await callBridgeTool(toolName, toolArgs);

      if (error) {
        send(
          jsonRpcResult(req.id, {
            content: [{ type: "text", text: error }],
            isError: true,
          }),
        );
      } else {
        // Format result as MCP content
        const content = formatToolResult(result);
        send(jsonRpcResult(req.id, { content }));
      }
      break;
    }

    default:
      send(jsonRpcError(req.id, -32601, `Method not found: ${req.method}`));
  }
}

/** Convert bridge tool_response result to MCP content blocks */
function formatToolResult(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== "object") {
    return [{ type: "text", text: JSON.stringify(result) }];
  }

  const r = result as Record<string, unknown>;

  // Already MCP-formatted content array
  if (Array.isArray(r.content)) return r.content as Array<Record<string, unknown>>;

  // Image result (screenshot)
  if (r.data && typeof r.data === "string" && r.media_type) {
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: r.media_type,
          data: r.data,
        },
      },
    ];
  }

  // Nested result object
  if (r.result !== undefined) {
    return formatToolResult(r.result);
  }

  // Plain text/JSON result
  return [{ type: "text", text: JSON.stringify(result, null, 2) }];
}

// --- Stdio transport ---------------------------------------------------------

async function main(): Promise<void> {
  // Log to stderr so it doesn't interfere with MCP protocol on stdout
  const log = (msg: string) => process.stderr.write(`[bridge-mcp] ${msg}\n`);

  log(`Starting — bridge at ${BRIDGE_URL}`);

  // Verify bridge is reachable
  try {
    const health = await fetch(`${BRIDGE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const data = (await health.json()) as Record<string, unknown>;
    log(`Bridge health: clients=${data.clients}, version=${data.version}`);
  } catch {
    log("WARNING: Bridge not reachable — tool calls will fail until bridge starts");
  }

  // Read newline-delimited JSON-RPC from stdin
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of process.stdin) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array);

    // Process complete lines
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);

      if (!line) continue;

      try {
        const req = JSON.parse(line) as JsonRpcRequest;
        // Handle asynchronously but don't block the read loop
        handleRequest(req).catch((err) => {
          log(`Error handling ${req.method}: ${(err as Error).message}`);
          if (req.id !== undefined && req.id !== null) {
            send(jsonRpcError(req.id, -32603, (err as Error).message));
          }
        });
      } catch (err) {
        log(`Invalid JSON-RPC: ${(err as Error).message}`);
      }
    }
  }

  log("stdin closed — shutting down");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[bridge-mcp] Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
