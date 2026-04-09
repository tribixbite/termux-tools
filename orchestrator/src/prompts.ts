/**
 * prompts.ts — Prompt library: search, star, and browse past prompts
 * extracted from ~/.claude/history.jsonl
 *
 * Uses mtime+size-keyed cache to avoid re-parsing on every request.
 * Starred prompt IDs are persisted to ~/.local/share/tmx/prompts.json.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

const HOME = process.env.HOME ?? "/data/data/com.termux/files/home";
const HISTORY_PATH = join(HOME, ".claude", "history.jsonl");
const PROMPTS_JSON = join(HOME, ".local", "share", "tmx", "prompts.json");

// -- Types -------------------------------------------------------------------

export interface PromptEntry {
  id: string;
  display: string;
  timestamp: number;
  project: string;
  sessionId?: string;
  starred: boolean;
}

export interface PromptSearchResult {
  prompts: PromptEntry[];
  total: number;
  offset: number;
  limit: number;
}

interface PromptsStorage {
  version: number;
  starred: string[];
}

// -- Cache -------------------------------------------------------------------

interface ParsedCache {
  mtime: number;
  size: number;
  entries: Array<Omit<PromptEntry, "starred">>;
}

let parsedCache: ParsedCache | null = null;

// -- Starred persistence -----------------------------------------------------

/** Read starred IDs from disk */
function getStarredIds(): Set<string> {
  try {
    if (!existsSync(PROMPTS_JSON)) return new Set();
    const data = JSON.parse(readFileSync(PROMPTS_JSON, "utf-8")) as PromptsStorage;
    return new Set(data.starred ?? []);
  } catch {
    return new Set();
  }
}

/** Write starred IDs atomically */
function writeStarredIds(ids: Set<string>): void {
  const dir = dirname(PROMPTS_JSON);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const data: PromptsStorage = { version: 1, starred: [...ids] };
  writeFileSync(PROMPTS_JSON, JSON.stringify(data, null, 2));
}

// -- Parsing -----------------------------------------------------------------

/** Generate deterministic ID for a prompt entry */
function promptId(display: string, timestamp: number): string {
  return createHash("sha256")
    .update(`${display}${timestamp}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Parse all prompts from history.jsonl.
 * Uses mtime+size cache to skip re-parsing when file hasn't changed.
 */
function parseAllPrompts(): Array<Omit<PromptEntry, "starred">> {
  if (!existsSync(HISTORY_PATH)) return [];

  const st = statSync(HISTORY_PATH);
  if (parsedCache && parsedCache.mtime === st.mtimeMs && parsedCache.size === st.size) {
    return parsedCache.entries;
  }

  const entries: Array<Omit<PromptEntry, "starred">> = [];
  const content = readFileSync(HISTORY_PATH, "utf-8");
  const lines = content.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line) as {
        type?: string;
        display?: string;
        timestamp?: string;
        project?: string;
        sessionId?: string;
      };
      if (!raw.display) continue;

      const display = raw.display.trim();
      if (!display) continue;

      const ts = raw.timestamp ? new Date(raw.timestamp).getTime() : 0;
      entries.push({
        id: promptId(display, ts),
        display,
        timestamp: ts,
        project: raw.project ?? "",
        sessionId: raw.sessionId,
      });
    } catch {
      // Skip malformed lines
    }
  }

  // Most recent first
  entries.sort((a, b) => b.timestamp - a.timestamp);

  parsedCache = { mtime: st.mtimeMs, size: st.size, entries };
  return entries;
}

// -- Public API --------------------------------------------------------------

/** Search/list prompts with optional filters and pagination */
export function searchPrompts(opts: {
  q?: string;
  starred?: boolean;
  project?: string;
  limit?: number;
  offset?: number;
}): PromptSearchResult {
  const { q, starred, project, limit = 50, offset = 0 } = opts;
  const allEntries = parseAllPrompts();
  const starredIds = getStarredIds();
  const lowerQ = q?.toLowerCase();

  // Filter
  let filtered = allEntries;
  if (lowerQ) {
    filtered = filtered.filter(e => e.display.toLowerCase().includes(lowerQ));
  }
  if (starred) {
    filtered = filtered.filter(e => starredIds.has(e.id));
  }
  if (project) {
    filtered = filtered.filter(e => e.project === project);
  }

  // Deduplicate by display text (keep most recent)
  const seen = new Set<string>();
  const deduped: typeof filtered = [];
  for (const entry of filtered) {
    const key = entry.display.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  const total = deduped.length;
  const page = deduped.slice(offset, offset + limit);

  return {
    prompts: page.map(e => ({
      ...e,
      starred: starredIds.has(e.id),
    })),
    total,
    offset,
    limit,
  };
}

/** Star a prompt by ID */
export function starPrompt(id: string): boolean {
  const ids = getStarredIds();
  ids.add(id);
  writeStarredIds(ids);
  return true;
}

/** Unstar a prompt by ID */
export function unstarPrompt(id: string): boolean {
  const ids = getStarredIds();
  const deleted = ids.delete(id);
  if (deleted) writeStarredIds(ids);
  return deleted;
}

/** Get unique project names from prompts (for filter dropdown) */
export function getPromptProjects(): string[] {
  const entries = parseAllPrompts();
  const projects = new Set<string>();
  for (const e of entries) {
    if (e.project) projects.add(e.project);
  }
  return [...projects].sort();
}
