/**
 * claude-session.ts — Claude Code JSONL resolution, token tracking,
 * conversation parsing, and timeline merging.
 *
 * Maps operad session names → JSONL files and extracts structured data
 * from Claude Code's conversation logs.
 */

import { existsSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, basename } from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type {
  SessionTokenUsage, ProjectTokenUsage,
  ConversationEntry, ConversationBlock, ConversationPage,
  TimelineEvent, DailyCost,
} from "./types.js";

const HOME = process.env.HOME ?? "/data/data/com.termux/files/home";
const CLAUDE_DIR = join(HOME, ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const HISTORY_PATH = join(CLAUDE_DIR, "history.jsonl");

// -- Pricing (per million tokens) -------------------------------------------

const PRICING = {
  input: 15,       // $15/M input tokens
  output: 75,      // $75/M output tokens
  cache_read: 1.5, // $1.50/M cache read tokens
  cache_creation: 18.75, // $18.75/M cache creation tokens
} as const;

// -- Path mangling -----------------------------------------------------------

/** Mangle a project path to match Claude Code's directory naming convention */
export function manglePath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}

// -- JSONL file resolution ---------------------------------------------------

interface JsonlFileInfo {
  id: string;       // UUID from filename
  path: string;     // absolute path
  mtime: number;    // modification timestamp (ms)
  size: number;     // file size in bytes
}

/** List all JSONL files for a project path, sorted by mtime descending */
export function resolveJsonlFiles(projectPath: string): JsonlFileInfo[] {
  const mangled = manglePath(projectPath);
  const dir = join(PROJECTS_DIR, mangled);
  if (!existsSync(dir)) return [];

  const results: JsonlFileInfo[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".jsonl")) continue;
      const fullPath = join(dir, entry);
      try {
        const st = statSync(fullPath);
        if (!st.isFile()) continue;
        results.push({
          id: entry.replace(".jsonl", ""),
          path: fullPath,
          mtime: st.mtimeMs,
          size: st.size,
        });
      } catch { /* skip unreadable files */ }
    }
  } catch { /* dir unreadable */ }

  // Most recent first
  results.sort((a, b) => b.mtime - a.mtime);
  return results;
}

/**
 * Find the active JSONL file for a project by looking up the most recent
 * sessionId in history.jsonl. Falls back to most recently modified JSONL.
 */
export function resolveActiveJsonl(projectPath: string): JsonlFileInfo | null {
  const files = resolveJsonlFiles(projectPath);
  if (files.length === 0) return null;

  // Try to find the active session from history.jsonl
  if (existsSync(HISTORY_PATH)) {
    try {
      const content = readFileSync(HISTORY_PATH, "utf-8");
      const lines = content.trim().split("\n");
      // Read from end to find most recent entry for this project
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 500); i--) {
        try {
          const entry = JSON.parse(lines[i]) as { project?: string; sessionId?: string };
          if (entry.project === projectPath && entry.sessionId) {
            const match = files.find(f => f.id === entry.sessionId);
            if (match) return match;
          }
        } catch { /* skip malformed lines */ }
      }
    } catch { /* history unreadable */ }
  }

  // Fallback: most recently modified
  return files[0];
}

// -- Token usage streaming ---------------------------------------------------

/** LRU cache for token usage results — keyed by path+mtime+size */
const tokenCache = new Map<string, { result: SessionTokenUsage; accessTime: number }>();
const TOKEN_CACHE_MAX = 10;

function tokenCacheKey(path: string, mtime: number, size: number): string {
  return `${path}|${mtime}|${size}`;
}

/** Evict oldest entries if cache exceeds max size */
function evictTokenCache(): void {
  if (tokenCache.size <= TOKEN_CACHE_MAX) return;
  let oldest: string | null = null;
  let oldestTime = Infinity;
  for (const [key, val] of tokenCache) {
    if (val.accessTime < oldestTime) {
      oldestTime = val.accessTime;
      oldest = key;
    }
  }
  if (oldest) tokenCache.delete(oldest);
}

/** Calculate USD cost from token counts */
export function calculateCost(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}): number {
  return (
    (usage.input_tokens * PRICING.input) / 1_000_000 +
    (usage.output_tokens * PRICING.output) / 1_000_000 +
    (usage.cache_read_tokens * PRICING.cache_read) / 1_000_000 +
    (usage.cache_creation_tokens * PRICING.cache_creation) / 1_000_000
  );
}

/**
 * Stream-parse a JSONL file to extract total token usage.
 * Uses readline for memory efficiency on large files (57MB+).
 * Results are LRU-cached by file path+mtime+size.
 */
export async function streamTokenUsage(jsonlPath: string): Promise<SessionTokenUsage> {
  const st = statSync(jsonlPath);
  const cacheKey = tokenCacheKey(jsonlPath, st.mtimeMs, st.size);

  // Check cache
  const cached = tokenCache.get(cacheKey);
  if (cached) {
    cached.accessTime = Date.now();
    return cached.result;
  }

  const sessionId = basename(jsonlPath, ".jsonl");
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let turns = 0;
  let lineCount = 0;

  return new Promise<SessionTokenUsage>((resolve, reject) => {
    const rl = createInterface({
      input: createReadStream(jsonlPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    rl.on("line", (line: string) => {
      lineCount++;
      // Yield to event loop periodically for large files
      if (lineCount % 2000 === 0) {
        rl.pause();
        setImmediate(() => rl.resume());
      }

      // Quick prefix check before parsing full JSON
      if (!line.includes('"type":"assistant"') && !line.includes('"type": "assistant"')) return;

      try {
        const entry = JSON.parse(line) as {
          type?: string;
          message?: {
            role?: string;
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            };
            stop_reason?: string | null;
          };
        };

        if (entry.type !== "assistant") return;

        const usage = entry.message?.usage;
        if (usage) {
          inputTokens += usage.input_tokens ?? 0;
          outputTokens += usage.output_tokens ?? 0;
          cacheReadTokens += usage.cache_read_input_tokens ?? 0;
          cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
        }

        // Count only final assistant turns (with stop_reason)
        if (entry.message?.stop_reason) {
          turns++;
        }
      } catch { /* skip malformed lines */ }
    });

    rl.on("close", () => {
      const result: SessionTokenUsage = {
        session_id: sessionId,
        jsonl_path: jsonlPath,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cache_creation_tokens: cacheCreationTokens,
        turns,
        cost_usd: calculateCost({
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: cacheReadTokens,
          cache_creation_tokens: cacheCreationTokens,
        }),
        file_size_bytes: st.size,
        last_modified: new Date(st.mtimeMs).toISOString(),
      };

      // Cache result
      tokenCache.set(cacheKey, { result, accessTime: Date.now() });
      evictTokenCache();

      resolve(result);
    });

    rl.on("error", reject);
  });
}

/**
 * Get aggregated token usage for all JSONL files of a project.
 */
export async function getProjectTokenUsage(
  name: string,
  projectPath: string,
): Promise<ProjectTokenUsage> {
  const files = resolveJsonlFiles(projectPath);
  const sessions: SessionTokenUsage[] = [];

  for (const file of files) {
    try {
      const usage = await streamTokenUsage(file.path);
      // Skip sessions with zero usage
      if (usage.turns > 0 || usage.output_tokens > 0) {
        sessions.push(usage);
      }
    } catch { /* skip unreadable files */ }
  }

  const total = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    turns: 0,
    cost_usd: 0,
  };
  for (const s of sessions) {
    total.input_tokens += s.input_tokens;
    total.output_tokens += s.output_tokens;
    total.cache_read_tokens += s.cache_read_tokens;
    total.cache_creation_tokens += s.cache_creation_tokens;
    total.turns += s.turns;
    total.cost_usd += s.cost_usd;
  }

  return { name, path: projectPath, sessions, total };
}

// -- Conversation tail reader -------------------------------------------------

/** Truncate a string to max length, appending ... if truncated */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

/** Extract text content from a user message */
function extractUserContent(message: { content?: unknown }): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return (message.content as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
  }
  return "";
}

/** Parse assistant message content blocks into structured ConversationBlocks */
function parseAssistantBlocks(content: unknown[]): { blocks: ConversationBlock[]; text: string } {
  const blocks: ConversationBlock[] = [];
  const textParts: string[] = [];

  for (const block of content as Array<{
    type?: string;
    text?: string;
    thinking?: string;
    name?: string;
    input?: unknown;
    content?: unknown;
  }>) {
    switch (block.type) {
      case "text":
        blocks.push({ type: "text", text: block.text ?? "" });
        textParts.push(block.text ?? "");
        break;
      case "thinking":
        blocks.push({ type: "thinking", text: truncate(block.thinking ?? "", 500) });
        break;
      case "tool_use":
        blocks.push({
          type: "tool_use",
          tool_name: block.name ?? "unknown",
          tool_input: truncate(
            typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {}),
            200,
          ),
        });
        break;
      case "tool_result":
        blocks.push({
          type: "tool_result",
          tool_result: truncate(
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content ?? ""),
            1000,
          ),
        });
        break;
      // Skip other types (signatures, etc.)
    }
  }

  return { blocks, text: textParts.join("\n") };
}

/**
 * Read conversation entries from the tail of a JSONL file.
 * Reads backwards in 64KB chunks for efficiency on large files.
 * Coalesces streaming assistant entries (stop_reason: null → keep only final).
 */
export function readConversationTail(
  jsonlPath: string,
  limit = 20,
  beforeUuid?: string,
): { entries: ConversationEntry[]; hasMore: boolean } {
  if (!existsSync(jsonlPath)) return { entries: [], hasMore: false };

  const st = statSync(jsonlPath);
  if (st.size === 0) return { entries: [], hasMore: false };

  // Read file in reverse 64KB chunks to find entries near the tail
  const CHUNK_SIZE = 65536;
  const fd = openSync(jsonlPath, "r");
  const entries: ConversationEntry[] = [];
  let reachedBeforeUuid = !beforeUuid; // If no cursor, start from end
  let hasMore = false;

  try {
    let offset = st.size;
    let remainder = "";
    const linesToParse: string[] = [];

    // Collect enough lines by reading backwards
    while (offset > 0 && linesToParse.length < limit * 10) {
      const readSize = Math.min(CHUNK_SIZE, offset);
      offset -= readSize;
      const buf = Buffer.alloc(readSize);
      readSync(fd, buf, 0, readSize, offset);
      const chunk = buf.toString("utf-8") + remainder;
      const lines = chunk.split("\n");

      // First element may be partial (unless we're at file start)
      remainder = offset > 0 ? (lines.shift() ?? "") : "";

      // Add lines in reverse order (most recent first)
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line) linesToParse.push(line);
      }

      if (linesToParse.length >= limit * 10) break;
    }

    // If there's still a remainder from the very beginning of the file
    if (remainder.trim()) {
      linesToParse.push(remainder.trim());
    }

    // Parse lines (already in reverse chronological order) and collect entries
    // We need to coalesce streaming assistant messages and track UUIDs
    const rawEntries: Array<{
      uuid: string;
      type: string;
      timestamp: string;
      entry: ConversationEntry;
    }> = [];

    for (const line of linesToParse) {
      // Quick prefix filter — skip non-conversation entries
      if (line.includes('"type":"file-history-snapshot"') || line.includes('"type": "file-history-snapshot"')) continue;
      if (line.includes('"type":"progress"') || line.includes('"type": "progress"')) continue;

      try {
        const raw = JSON.parse(line) as {
          type?: string;
          uuid?: string;
          timestamp?: string;
          message?: {
            role?: string;
            content?: unknown;
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            };
            model?: string;
            stop_reason?: string | null;
          };
        };

        if (!raw.uuid || !raw.type) continue;

        if (raw.type === "user" && raw.message) {
          const content = extractUserContent(raw.message);

          // Check if this is a tool_result continuation (no human text, just tool responses)
          if (!content && Array.isArray(raw.message.content)) {
            const toolResults = (raw.message.content as Array<{ type?: string; content?: unknown; tool_use_id?: string }>)
              .filter(b => b.type === "tool_result");
            if (toolResults.length > 0) {
              // Parse as tool_result entries
              const { blocks } = parseAssistantBlocks(raw.message.content as unknown[]);
              rawEntries.push({
                uuid: raw.uuid,
                type: "tool_result",
                timestamp: raw.timestamp ?? "",
                entry: {
                  uuid: raw.uuid,
                  type: "tool_result",
                  timestamp: raw.timestamp ?? "",
                  content: "",
                  blocks,
                },
              });
              continue;
            }
          }
          // Skip truly empty entries with no meaningful content
          if (!content) continue;
          rawEntries.push({
            uuid: raw.uuid,
            type: "user",
            timestamp: raw.timestamp ?? "",
            entry: {
              uuid: raw.uuid,
              type: "user",
              timestamp: raw.timestamp ?? "",
              content,
            },
          });
        } else if (raw.type === "assistant" && raw.message) {
          const contentArr = Array.isArray(raw.message.content) ? raw.message.content : [];
          const { blocks, text } = parseAssistantBlocks(contentArr);
          const usage = raw.message.usage;

          rawEntries.push({
            uuid: raw.uuid,
            type: "assistant",
            timestamp: raw.timestamp ?? "",
            entry: {
              uuid: raw.uuid,
              type: "assistant",
              timestamp: raw.timestamp ?? "",
              content: text,
              blocks,
              usage: usage ? {
                input: usage.input_tokens ?? 0,
                output: usage.output_tokens ?? 0,
                cache_read: usage.cache_read_input_tokens ?? 0,
                cache_create: usage.cache_creation_input_tokens ?? 0,
              } : undefined,
              model: raw.message.model,
            },
          });
        }
      } catch { /* skip malformed lines */ }
    }

    // Claude Code writes one JSONL line per API call — no streaming partials.
    // rawEntries are in reverse chronological order (newest first).
    // Apply beforeUuid cursor and limit.
    for (const raw of rawEntries) {
      if (!reachedBeforeUuid) {
        if (raw.uuid === beforeUuid) {
          reachedBeforeUuid = true;
        }
        continue;
      }

      entries.push(raw.entry);
      if (entries.length >= limit) {
        hasMore = true;
        break;
      }
    }

    // Check if there are more entries beyond what we collected
    if (!hasMore && entries.length < rawEntries.length - (beforeUuid ? 1 : 0)) {
      hasMore = true;
    }
  } finally {
    closeSync(fd);
  }

  // Reverse to chronological order (oldest first)
  entries.reverse();
  return { entries, hasMore };
}

/**
 * Get a paginated conversation page for a session.
 */
export function getConversationPage(
  projectPath: string,
  sessionId?: string,
  limit = 20,
  beforeUuid?: string,
): ConversationPage {
  const files = resolveJsonlFiles(projectPath);
  const sessionList = files.map(f => ({
    id: f.id,
    last_modified: new Date(f.mtime).toISOString(),
  }));

  // Resolve JSONL file
  let jsonlFile: JsonlFileInfo | null = null;
  if (sessionId) {
    jsonlFile = files.find(f => f.id === sessionId) ?? null;
  }
  if (!jsonlFile) {
    jsonlFile = resolveActiveJsonl(projectPath);
  }

  if (!jsonlFile) {
    return {
      entries: [],
      oldest_uuid: null,
      has_more: false,
      session_id: "",
      session_list: sessionList,
    };
  }

  const { entries, hasMore } = readConversationTail(jsonlFile.path, limit, beforeUuid);

  return {
    entries,
    oldest_uuid: entries.length > 0 ? entries[0].uuid : null,
    has_more: hasMore,
    session_id: jsonlFile.id,
    session_list: sessionList,
  };
}

// -- Timeline reader ----------------------------------------------------------

/**
 * Read and merge timeline events from trace.log and JSONL user entries.
 * Filters trace.log lines by session name, parses timestamps.
 */
export function readTimeline(
  sessionName: string,
  tracePath: string,
  jsonlPath?: string,
  since?: string,
  limit = 100,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const sinceDate = since ? new Date(since) : null;

  // 1. Parse trace.log for session-related events
  if (existsSync(tracePath)) {
    try {
      const content = readFileSync(tracePath, "utf-8");
      const lines = content.split("\n");
      // Get file modification date for constructing full timestamps
      const traceStat = statSync(tracePath);
      const fileDate = new Date(traceStat.mtimeMs).toISOString().slice(0, 10);

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line.includes(sessionName)) continue;

        // Parse HH:MM:SS.mmm prefix
        const timeMatch = line.match(/^(\d{2}:\d{2}:\d{2}\.\d{3})\s+(.+)/);
        if (!timeMatch) continue;

        const timestamp = `${fileDate}T${timeMatch[1]}Z`;
        if (sinceDate && new Date(timestamp) < sinceDate) continue;

        events.push({
          timestamp,
          source: "trace",
          event: timeMatch[2].trim(),
        });

        if (events.length >= limit * 2) break; // Collect extra for merge
      }
    } catch { /* trace unreadable */ }
  }

  // 2. Parse JSONL user entries for conversation events
  if (jsonlPath && existsSync(jsonlPath)) {
    try {
      const content = readFileSync(jsonlPath, "utf-8");
      const lines = content.split("\n");

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        // Quick prefix check
        if (!line.includes('"type":"user"') && !line.includes('"type": "user"')) continue;

        try {
          const entry = JSON.parse(line) as {
            type?: string;
            timestamp?: string;
            message?: { content?: unknown };
          };
          if (entry.type !== "user" || !entry.timestamp) continue;

          if (sinceDate && new Date(entry.timestamp) < sinceDate) continue;

          const content = extractUserContent(entry.message ?? {});
          events.push({
            timestamp: entry.timestamp,
            source: "conversation",
            event: "User prompt",
            detail: truncate(content, 80),
          });

          if (events.length >= limit * 3) break;
        } catch { /* skip malformed */ }
      }
    } catch { /* jsonl unreadable */ }
  }

  // Sort by timestamp descending and limit
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return events.slice(0, limit);
}

// -- Conversation delta (live streaming) --------------------------------------

/**
 * Get new conversation entries after a given UUID.
 * Reads the tail of the active JSONL file and returns entries newer than afterUuid.
 * Returns null if no active JSONL file or no new entries.
 */
export function getConversationDelta(
  projectPath: string,
  afterUuid: string | null,
  limit = 10,
): { entries: ConversationEntry[]; session_id: string } | null {
  const active = resolveActiveJsonl(projectPath);
  if (!active) return null;

  // Read last 50 entries (enough to catch new ones since last check)
  const { entries } = readConversationTail(active.path, 50);
  if (entries.length === 0) return null;

  if (!afterUuid) {
    // First call — return the last `limit` entries
    return {
      entries: entries.slice(-limit),
      session_id: active.id,
    };
  }

  // Find afterUuid and return everything after it
  const idx = entries.findIndex(e => e.uuid === afterUuid);
  if (idx < 0) {
    // UUID not found in recent entries — return last few as catchup
    return {
      entries: entries.slice(-limit),
      session_id: active.id,
    };
  }

  const newEntries = entries.slice(idx + 1);
  if (newEntries.length === 0) return null;

  return {
    entries: newEntries.slice(-limit),
    session_id: active.id,
  };
}

// -- Daily cost timeline ------------------------------------------------------

/**
 * Compute daily cost aggregation across all Claude sessions for the last N days.
 * Stream-parses JSONL files, bucketing assistant entries by UTC date.
 */
export async function getDailyCostTimeline(
  projects: Array<{ name: string; path: string }>,
  days = 14,
): Promise<DailyCost[]> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const dailyMap = new Map<string, DailyCost>();

  for (const project of projects) {
    const files = resolveJsonlFiles(project.path);

    for (const file of files) {
      // Skip files not modified within the window
      if (file.mtime < cutoff) continue;

      // Stream-parse the JSONL file
      const content = readFileSync(file.path, "utf-8");
      const lines = content.split("\n");

      for (const line of lines) {
        if (!line.includes('"type":"assistant"') && !line.includes('"type": "assistant"')) continue;

        try {
          const raw = JSON.parse(line) as {
            type?: string;
            timestamp?: string;
            message?: {
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                cache_read_input_tokens?: number;
                cache_creation_input_tokens?: number;
              };
              stop_reason?: string | null;
            };
          };

          if (raw.type !== "assistant" || !raw.timestamp) continue;

          const ts = new Date(raw.timestamp);
          if (ts.getTime() < cutoff) continue;

          const dateKey = ts.toISOString().slice(0, 10); // YYYY-MM-DD
          const usage = raw.message?.usage;
          if (!usage) continue;

          const inputCost = (usage.input_tokens ?? 0) * PRICING.input / 1_000_000;
          const outputCost = (usage.output_tokens ?? 0) * PRICING.output / 1_000_000;
          const cacheCost = (
            (usage.cache_read_input_tokens ?? 0) * PRICING.cache_read +
            (usage.cache_creation_input_tokens ?? 0) * PRICING.cache_creation
          ) / 1_000_000;

          let day = dailyMap.get(dateKey);
          if (!day) {
            day = {
              date: dateKey,
              input_cost: 0,
              output_cost: 0,
              cache_cost: 0,
              total_cost: 0,
              turns: 0,
              sessions: [],
            };
            dailyMap.set(dateKey, day);
          }

          day.input_cost += inputCost;
          day.output_cost += outputCost;
          day.cache_cost += cacheCost;
          day.total_cost += inputCost + outputCost + cacheCost;

          if (raw.message?.stop_reason) {
            day.turns++;
          }

          // Track per-session costs within the day
          let sessionEntry = day.sessions.find(s => s.session_id === file.id);
          if (!sessionEntry) {
            sessionEntry = { session_id: file.id, name: project.name, cost: 0 };
            day.sessions.push(sessionEntry);
          }
          sessionEntry.cost += inputCost + outputCost + cacheCost;
        } catch {
          // Skip malformed lines
        }
      }
    }
  }

  // Sort by date ascending
  return [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
}
