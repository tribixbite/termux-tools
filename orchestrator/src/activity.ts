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

  /**
   * Sum CPU ticks for a process and all its children.
   * Reads /proc/PID/stat for the root and each child found via ppid matching.
   */
  private readTreeCpuTicks(rootPid: number): number | null {
    const rootTicks = this.readCpuTicks(rootPid);
    if (rootTicks === null) return null;

    let total = rootTicks;

    // Find children by reading /proc/PID/stat for all numeric /proc entries
    try {
      const procEntries = readdirSync("/proc").filter((e) => /^\d+$/.test(e));

      const stack = [rootPid];
      const visited = new Set<number>([rootPid]);

      while (stack.length > 0) {
        const parent = stack.pop()!;
        for (const entry of procEntries) {
          const childPid = parseInt(entry, 10);
          if (visited.has(childPid)) continue;

          try {
            const stat = readFileSync(`/proc/${childPid}/stat`, "utf-8");
            const closeParen = stat.lastIndexOf(")");
            if (closeParen === -1) continue;
            const fields = stat.slice(closeParen + 2).split(" ");
            const ppid = parseInt(fields[1], 10); // field 4 = ppid, index 1 after ')'
            if (ppid === parent) {
              visited.add(childPid);
              stack.push(childPid);
              const utime = parseInt(fields[11], 10);
              const stime = parseInt(fields[12], 10);
              if (!isNaN(utime) && !isNaN(stime)) {
                total += utime + stime;
              }
            }
          } catch {
            // Process may have exited
          }
        }
      }
    } catch {
      // Can't read /proc — return root ticks only
    }

    return total;
  }
}
