/**
 * activity.ts — CPU-tick based activity detection for tmux sessions
 *
 * Reads /proc/PID/stat fields 14+15 (utime+stime) to compute CPU tick
 * deltas between polls. Active sessions (Claude thinking/executing)
 * show delta > 0; idle sessions (waiting for user) show delta == 0.
 *
 * Confirmed on device: active session delta=7, idle session delta=0.
 */

import { readFileSync, readdirSync } from "node:fs";
import type { Logger } from "./log.js";

/** Activity classification for a session */
export type ActivityState = "active" | "idle" | "stopped" | "unknown";

/** Stored CPU ticks for a PID */
interface CpuSnapshot {
  /** utime + stime from /proc/PID/stat */
  ticks: number;
  /** Timestamp of the snapshot */
  ts: number;
  /** Number of consecutive zero-delta polls */
  idle_streak: number;
}

/** Number of consecutive zero-delta polls before classifying as idle */
const IDLE_THRESHOLD = 3;

export class ActivityDetector {
  private log: Logger;
  /** Previous CPU tick snapshots keyed by session name */
  private snapshots = new Map<string, CpuSnapshot>();
  /** Cached /proc tree: ppid → children with ticks. Built once per sweep, shared across sessions. */
  private procCache: { childrenOf: Map<number, { pid: number; ticks: number }[]>; ts: number } | null = null;
  /** Cache TTL in ms — rebuild if older than this (matches poll interval) */
  private static readonly PROC_CACHE_TTL_MS = 10_000;

  constructor(log: Logger) {
    this.log = log;
  }

  /**
   * Classify the activity state of a process.
   * Must be called repeatedly (on each poll interval) for delta computation.
   *
   * @param name Session name (used as key for tracking)
   * @param pid Root PID of the process (tmux pane shell)
   * @returns Activity state classification
   */
  classify(name: string, pid: number): ActivityState {
    const ticks = this.readCpuTicks(pid);
    if (ticks === null) {
      // Process doesn't exist
      this.snapshots.delete(name);
      return "stopped";
    }

    const prev = this.snapshots.get(name);
    const now = Date.now();

    if (!prev) {
      // First observation — store baseline, report unknown
      this.snapshots.set(name, { ticks, ts: now, idle_streak: 0 });
      return "unknown";
    }

    const delta = ticks - prev.ticks;

    if (delta > 0) {
      // CPU ticks changed — process is doing work
      this.snapshots.set(name, { ticks, ts: now, idle_streak: 0 });
      return "active";
    }

    // No tick change — increment idle streak
    const newStreak = prev.idle_streak + 1;
    this.snapshots.set(name, { ticks, ts: now, idle_streak: newStreak });

    if (newStreak >= IDLE_THRESHOLD) {
      return "idle";
    }

    // Not enough consecutive zero-deltas yet to call it idle
    return "active";
  }

  /**
   * Classify activity for a process tree (sum ticks of pid + all children).
   * More accurate for sessions that spawn many child processes.
   *
   * @param name Session name
   * @param pid Root PID
   * @returns Activity state
   */
  classifyTree(name: string, pid: number): ActivityState {
    const ticks = this.readTreeCpuTicks(pid);
    if (ticks === null) {
      this.snapshots.delete(name);
      return "stopped";
    }

    const prev = this.snapshots.get(name);
    const now = Date.now();

    if (!prev) {
      this.snapshots.set(name, { ticks, ts: now, idle_streak: 0 });
      return "unknown";
    }

    const delta = ticks - prev.ticks;

    if (delta > 0) {
      this.snapshots.set(name, { ticks, ts: now, idle_streak: 0 });
      return "active";
    }

    const newStreak = prev.idle_streak + 1;
    this.snapshots.set(name, { ticks, ts: now, idle_streak: newStreak });
    return newStreak >= IDLE_THRESHOLD ? "idle" : "active";
  }

  /** Remove tracking state for a session */
  remove(name: string): void {
    this.snapshots.delete(name);
  }

  /** Evict stale entries for sessions no longer in the active set */
  pruneStale(activeNames: Set<string>): void {
    for (const name of this.snapshots.keys()) {
      if (!activeNames.has(name)) this.snapshots.delete(name);
    }
  }

  /**
   * Read utime + stime from /proc/PID/stat.
   * Fields are space-separated; field 14 = utime, field 15 = stime (1-indexed).
   * The comm field (2) can contain spaces within parens, so we parse after ')'.
   */
  private readCpuTicks(pid: number): number | null {
    try {
      const content = readFileSync(`/proc/${pid}/stat`, "utf-8");
      return this.parseCpuTicks(content);
    } catch {
      return null;
    }
  }

  /** Parse utime + stime from a /proc/PID/stat line */
  private parseCpuTicks(statLine: string): number | null {
    // Skip past the comm field (enclosed in parens, may contain spaces)
    const closeParen = statLine.lastIndexOf(")");
    if (closeParen === -1) return null;

    const fields = statLine.slice(closeParen + 2).split(" ");
    // After ')' and space: field index 0=state, ..., 11=utime (field 14), 12=stime (field 15)
    const utime = parseInt(fields[11], 10);
    const stime = parseInt(fields[12], 10);

    if (isNaN(utime) || isNaN(stime)) return null;
    return utime + stime;
  }

  /** Invalidate the proc cache (call at the start of each sweep) */
  invalidateProcCache(): void {
    this.procCache = null;
  }

  /**
   * Build the /proc tree once, caching ppid → children with ticks.
   * Shared across all sessions in a single sweep — O(n) instead of O(sessions*procs).
   */
  private buildProcTree(): Map<number, { pid: number; ticks: number }[]> {
    const now = Date.now();
    if (this.procCache && now - this.procCache.ts < ActivityDetector.PROC_CACHE_TTL_MS) {
      return this.procCache.childrenOf;
    }

    const childrenOf = new Map<number, { pid: number; ticks: number }[]>();

    try {
      const procEntries = readdirSync("/proc").filter((e) => /^\d+$/.test(e));

      for (const entry of procEntries) {
        try {
          const pid = parseInt(entry, 10);
          const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
          const closeParen = stat.lastIndexOf(")");
          if (closeParen === -1) continue;
          const fields = stat.slice(closeParen + 2).split(" ");
          const ppid = parseInt(fields[1], 10);
          const utime = parseInt(fields[11], 10);
          const stime = parseInt(fields[12], 10);
          if (isNaN(ppid) || isNaN(utime) || isNaN(stime)) continue;

          const ticks = utime + stime;
          let children = childrenOf.get(ppid);
          if (!children) {
            children = [];
            childrenOf.set(ppid, children);
          }
          children.push({ pid, ticks });
        } catch {
          // Process may have exited between readdir and stat read
        }
      }
    } catch {
      // Can't read /proc
    }

    this.procCache = { childrenOf, ts: now };
    return childrenOf;
  }

  /**
   * Sum CPU ticks for a process and all its children.
   * Uses the cached proc tree (built once per sweep) for O(tree_depth) lookup.
   */
  private readTreeCpuTicks(rootPid: number): number | null {
    const rootTicks = this.readCpuTicks(rootPid);
    if (rootTicks === null) return null;

    let total = rootTicks;
    const childrenOf = this.buildProcTree();

    // Walk the tree from root → descendants
    const stack = [rootPid];
    const visited = new Set<number>([rootPid]);

    while (stack.length > 0) {
      const parent = stack.pop()!;
      const children = childrenOf.get(parent);
      if (!children) continue;

      for (const child of children) {
        if (visited.has(child.pid)) continue;
        visited.add(child.pid);
        total += child.ticks;
        stack.push(child.pid);
      }
    }

    return total;
  }
}
