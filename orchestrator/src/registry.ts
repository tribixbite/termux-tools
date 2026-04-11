/**
 * registry.ts — Dynamic session registry for non-config Claude sessions
 *
 * Persists "dynamically opened" Claude sessions in registry.json alongside
 * the static tmx.toml config. Both sources merge on boot so all sessions
 * survive OOM/crash/reboot. Also provides `recent` command by parsing
 * Claude Code's ~/.claude/history.jsonl.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { SessionConfig, SessionType } from "./types.js";

/** A dynamically registered Claude session */
export interface RegistryEntry {
  /** Session name (unique, lowercase, matches [a-z0-9-]+) */
  name: string;
  /** Absolute path to the project directory */
  path: string;
  /** ISO timestamp when first opened */
  opened_at: string;
  /** ISO timestamp of last known activity */
  last_active: string;
  /** Start priority (default 50 — lower than config sessions) */
  priority: number;
  /** Auto-send "go" after startup */
  auto_go: boolean;
  /** Claude session ID for --resume (multi-instance support) */
  session_id?: string;
}

/** Persisted registry data */
interface RegistryData {
  version: number;
  sessions: RegistryEntry[];
}

/** Entry from ~/.claude/history.jsonl */
export interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  sessionId: string;
}

/** Recent project info returned by `operad recent` */
export interface RecentProject {
  /** Derived name (basename of path) */
  name: string;
  /** Project path */
  path: string;
  /** Most recent timestamp */
  last_active: string;
  /** Claude session ID from history */
  session_id: string;
  /** Status: running in operad, registered in registry, in config, or untracked */
  status: "running" | "registered" | "config" | "untracked";
}

const CURRENT_VERSION = 1;
const NAME_PATTERN = /^[a-z0-9-]+$/;

export class Registry {
  private data: RegistryData;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = this.load();
  }

  /** Get all registry entries */
  entries(): RegistryEntry[] {
    return this.data.sessions;
  }

  /** Find an entry by name */
  find(name: string): RegistryEntry | undefined {
    return this.data.sessions.find((e) => e.name === name);
  }

  /** Find first entry by path */
  findByPath(path: string): RegistryEntry | undefined {
    const abs = resolve(path);
    return this.data.sessions.find((e) => e.path === abs);
  }

  /** Find all entries sharing a path (multi-instance) */
  findAllByPath(path: string): RegistryEntry[] {
    const abs = resolve(path);
    return this.data.sessions.filter((e) => e.path === abs);
  }

  /** Find entry by Claude session ID */
  findBySessionId(sessionId: string): RegistryEntry | undefined {
    return this.data.sessions.find((e) => e.session_id === sessionId);
  }

  /** Add a new entry. Returns the entry, or null if name conflict. */
  add(entry: Omit<RegistryEntry, "opened_at" | "last_active">): RegistryEntry | null {
    if (this.find(entry.name)) return null; // duplicate name

    const full: RegistryEntry = {
      ...entry,
      path: resolve(entry.path),
      opened_at: new Date().toISOString(),
      last_active: new Date().toISOString(),
    };
    this.data.sessions.push(full);
    this.save();
    return full;
  }

  /** Remove an entry by name. Returns true if found and removed. */
  remove(name: string): boolean {
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((e) => e.name !== name);
    if (this.data.sessions.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  /** Update last_active timestamp for a session */
  updateActivity(name: string): void {
    const entry = this.find(name);
    if (entry) {
      entry.last_active = new Date().toISOString();
      // Don't save on every poll — save periodically or on shutdown
    }
  }

  /** Save current registry state (call on shutdown or after mutations) */
  flush(): void {
    this.save();
  }

  /** Remove entries older than maxAgeDays */
  prune(maxAgeDays = 30): number {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((e) => {
      return new Date(e.last_active).getTime() > cutoff;
    });
    const pruned = before - this.data.sessions.length;
    if (pruned > 0) this.save();
    return pruned;
  }

  /** Convert registry entries to SessionConfig[] for merging with config */
  toSessionConfigs(): SessionConfig[] {
    return this.data.sessions.map((e): SessionConfig => ({
      name: e.name,
      type: "claude" as SessionType,
      path: e.path,
      command: undefined,
      auto_go: e.auto_go,
      priority: e.priority,
      depends_on: [],
      headless: false,
      env: {},
      health: undefined,
      max_restarts: 3,
      restart_backoff_s: 5,
      enabled: true,
      bare: false,
      session_id: e.session_id,
    }));
  }

  // -- Persistence ------------------------------------------------------------

  private load(): RegistryData {
    try {
      if (existsSync(this.filePath)) {
        const content = readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(content) as RegistryData;
        if (parsed.version === CURRENT_VERSION && Array.isArray(parsed.sessions)) {
          return parsed;
        }
      }
    } catch { /* start fresh */ }
    return { version: CURRENT_VERSION, sessions: [] };
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2) + "\n");
      renameSync(tmp, this.filePath);
    } catch { /* best effort */ }
  }
}

// -- History parsing ----------------------------------------------------------

/**
 * Parse ~/.claude/history.jsonl to find recently active projects.
 * Reads the tail of the file (last `maxLines` lines) for performance.
 * Deduplicates by project path, keeping the most recent entry.
 */
export function parseRecentProjects(historyPath: string, maxLines = 1000): Array<{
  name: string;
  path: string;
  last_active: string;
  session_id: string;
}> {
  if (!existsSync(historyPath)) return [];

  try {
    const content = readFileSync(historyPath, "utf-8");
    const lines = content.trim().split("\n");
    // Take last N lines
    const tail = lines.slice(-maxLines);

    // Deduplicate by project path, keeping latest timestamp
    const byPath = new Map<string, { timestamp: number; sessionId: string }>();
    for (const line of tail) {
      try {
        const entry = JSON.parse(line) as HistoryEntry;
        if (!entry.project || !entry.timestamp) continue;
        const existing = byPath.get(entry.project);
        if (!existing || entry.timestamp > existing.timestamp) {
          byPath.set(entry.project, {
            timestamp: entry.timestamp,
            sessionId: entry.sessionId,
          });
        }
      } catch { /* skip malformed lines */ }
    }

    // Convert to sorted array (most recent first)
    const results: Array<{
      name: string;
      path: string;
      last_active: string;
      session_id: string;
    }> = [];

    for (const [path, info] of byPath) {
      results.push({
        name: deriveName(path),
        path,
        last_active: new Date(info.timestamp).toISOString(),
        session_id: info.sessionId,
      });
    }

    results.sort((a, b) => b.last_active.localeCompare(a.last_active));
    return results;
  } catch {
    return [];
  }
}

/** Derive a session name from a path (basename, lowercased, sanitized) */
export function deriveName(path: string): string {
  const base = basename(path).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  return base || "unnamed";
}

/** Validate a session name */
export function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

/** A named Claude session discovered from session JSONL custom-title entries */
export interface NamedSession {
  /** User-assigned session title (from /rename) */
  title: string;
  /** Claude session UUID */
  session_id: string;
  /** Project path */
  path: string;
  /** Most recent activity timestamp (ISO) */
  last_active: string;
}

/**
 * Find Claude sessions that have user-assigned names (via /rename).
 * Scans history.jsonl for recent sessions, then checks each session's JSONL
 * for `type: "custom-title"` entries. Only returns sessions with short titles
 * (< 30 chars) active within maxAgeDays — these are intentional named sessions.
 */
export function findNamedSessions(historyPath: string, maxAgeDays = 7): NamedSession[] {
  if (!existsSync(historyPath)) return [];

  try {
    const content = readFileSync(historyPath, "utf-8");
    const lines = content.trim().split("\n");
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

    // Collect recent sessions: sessionId → { path, timestamp }
    const recentById = new Map<string, { path: string; timestamp: number }>();
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as HistoryEntry;
        if (!entry.project || !entry.timestamp || !entry.sessionId) continue;
        if (entry.timestamp < cutoff) continue;
        const existing = recentById.get(entry.sessionId);
        if (!existing || entry.timestamp > existing.timestamp) {
          recentById.set(entry.sessionId, { path: entry.project, timestamp: entry.timestamp });
        }
      } catch { /* skip malformed */ }
    }

    // Scan each session's JSONL for custom-title entries
    const claudeDir = dirname(historyPath); // ~/.claude
    const projectsDir = join(claudeDir, "projects");
    const results: NamedSession[] = [];

    for (const [sessionId, info] of recentById) {
      // Derive project dir name from path (same encoding Claude uses: all non-alnum to -)
      const projectDirName = info.path.replace(/[^a-zA-Z0-9]/g, "-");
      const sessionJsonl = join(projectsDir, projectDirName, `${sessionId}.jsonl`);

      if (!existsSync(sessionJsonl)) continue;

      try {
        const sessionContent = readFileSync(sessionJsonl, "utf-8");
        // Find the LAST custom-title entry (most recent rename)
        let customTitle: string | null = null;
        for (const sLine of sessionContent.split("\n")) {
          if (!sLine.includes("custom-title")) continue;
          try {
            const entry = JSON.parse(sLine) as { type: string; customTitle?: string };
            if (entry.type === "custom-title" && entry.customTitle) {
              customTitle = entry.customTitle;
            }
          } catch { /* skip */ }
        }

        // Only include sessions with short, meaningful titles
        if (customTitle && customTitle.length < 30 && !customTitle.includes("(Fork)")) {
          results.push({
            title: customTitle,
            session_id: sessionId,
            path: info.path,
            last_active: new Date(info.timestamp).toISOString(),
          });
        }
      } catch { /* skip unreadable */ }
    }

    results.sort((a, b) => b.last_active.localeCompare(a.last_active));
    return results;
  } catch {
    return [];
  }
}

/** Find next available suffixed name: torch → torch-2 → torch-3 */
export function nextSuffix(baseName: string, existingNames: string[]): string {
  const pattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:-(\\d+))?$`);
  const nums = existingNames
    .map((n) => {
      const m = n.match(pattern);
      if (!m) return NaN;
      return m[1] ? parseInt(m[1], 10) : 1; // bare name counts as 1
    })
    .filter((n) => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `${baseName}-${max + 1}`;
}
