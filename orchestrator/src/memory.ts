/**
 * memory.ts — System and per-process memory monitoring
 *
 * Parses /proc/meminfo for system-wide stats and uses `ps` to compute
 * per-session RSS including all child processes (MCP servers, LSP, etc.).
 * Defines pressure levels for dashboard display.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import type { Logger } from "./log.js";

/** Memory pressure levels based on MemAvailable thresholds */
export type MemoryPressure = "normal" | "warning" | "critical" | "emergency";

/** System-wide memory snapshot */
export interface SystemMemory {
  /** Total physical RAM in MB */
  total_mb: number;
  /** Available memory in MB (MemAvailable from /proc/meminfo) */
  available_mb: number;
  /** Total swap in MB */
  swap_total_mb: number;
  /** Free swap in MB */
  swap_free_mb: number;
  /** Current pressure level */
  pressure: MemoryPressure;
  /** Used memory percentage (0-100) */
  used_pct: number;
}

/** Per-process RSS entry from ps */
interface PsEntry {
  pid: number;
  ppid: number;
  rss_kb: number;
}

/** Per-session memory stats */
export interface SessionMemoryInfo {
  /** Session name */
  name: string;
  /** Total RSS of session process tree in MB */
  rss_mb: number;
  /** Number of processes in the tree */
  process_count: number;
}

export class MemoryMonitor {
  private log: Logger;
  private warningMb: number;
  private criticalMb: number;
  private emergencyMb: number;

  constructor(log: Logger, warningMb = 1500, criticalMb = 800, emergencyMb = 500) {
    this.log = log;
    this.warningMb = warningMb;
    this.criticalMb = criticalMb;
    this.emergencyMb = emergencyMb;
  }

  /** Update pressure thresholds (e.g. from config reload) */
  setThresholds(warningMb: number, criticalMb: number, emergencyMb: number): void {
    this.warningMb = warningMb;
    this.criticalMb = criticalMb;
    this.emergencyMb = emergencyMb;
  }

  /** Read system memory stats from /proc/meminfo */
  getSystemMemory(): SystemMemory {
    try {
      const content = readFileSync("/proc/meminfo", "utf-8");
      const fields = new Map<string, number>();

      for (const line of content.split("\n")) {
        const match = line.match(/^(\w+):\s+(\d+)\s+kB/);
        if (match) {
          fields.set(match[1], parseInt(match[2], 10));
        }
      }

      const totalKb = fields.get("MemTotal") ?? 0;
      const availableKb = fields.get("MemAvailable") ?? 0;
      const swapTotalKb = fields.get("SwapTotal") ?? 0;
      const swapFreeKb = fields.get("SwapFree") ?? 0;

      const totalMb = Math.round(totalKb / 1024);
      const availableMb = Math.round(availableKb / 1024);
      const usedPct = totalMb > 0 ? Math.round(((totalMb - availableMb) / totalMb) * 100) : 0;

      return {
        total_mb: totalMb,
        available_mb: availableMb,
        swap_total_mb: Math.round(swapTotalKb / 1024),
        swap_free_mb: Math.round(swapFreeKb / 1024),
        pressure: this.classifyPressure(availableMb),
        used_pct: usedPct,
      };
    } catch (err) {
      this.log.warn(`Failed to read /proc/meminfo: ${err}`);
      return {
        total_mb: 0,
        available_mb: 0,
        swap_total_mb: 0,
        swap_free_mb: 0,
        pressure: "normal",
        used_pct: 0,
      };
    }
  }

  /** Classify pressure from MemAvailable */
  private classifyPressure(availableMb: number): MemoryPressure {
    if (availableMb < this.emergencyMb) return "emergency";
    if (availableMb < this.criticalMb) return "critical";
    if (availableMb < this.warningMb) return "warning";
    return "normal";
  }

  /**
   * Get the total RSS for a process tree rooted at the given PID.
   * Sums RSS of the process and all descendants using ps output.
   */
  getProcessTreeRss(rootPid: number): { rss_mb: number; process_count: number } {
    const entries = this.getAllProcesses();
    const descendants = this.findDescendants(rootPid, entries);
    // Include the root process itself
    const root = entries.find((e) => e.pid === rootPid);
    if (root) descendants.push(root);

    const totalKb = descendants.reduce((sum, e) => sum + e.rss_kb, 0);
    return {
      rss_mb: Math.round(totalKb / 1024),
      process_count: descendants.length,
    };
  }

  /**
   * Get memory stats for named sessions given their tmux pane PIDs.
   * @param sessions Map of session name → shell PID inside the tmux pane
   */
  getSessionMemory(sessions: Map<string, number>): SessionMemoryInfo[] {
    const entries = this.getAllProcesses();
    const results: SessionMemoryInfo[] = [];

    for (const [name, pid] of sessions) {
      const descendants = this.findDescendants(pid, entries);
      const root = entries.find((e) => e.pid === pid);
      if (root) descendants.push(root);

      const totalKb = descendants.reduce((sum, e) => sum + e.rss_kb, 0);
      results.push({
        name,
        rss_mb: Math.round(totalKb / 1024),
        process_count: descendants.length,
      });
    }

    return results;
  }

  /** Get PID of the shell inside a tmux session pane */
  getSessionPid(sessionName: string): number | null {
    try {
      const output = execSync(
        `tmux list-panes -t "${sessionName}" -F "#{pane_pid}" 2>/dev/null`,
        { encoding: "utf-8", timeout: 5000 },
      ).trim();
      const pid = parseInt(output.split("\n")[0], 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /** Parse ps output to get all processes with pid, ppid, rss */
  private getAllProcesses(): PsEntry[] {
    try {
      const output = execSync("ps -e -o pid=,ppid=,rss= 2>/dev/null", {
        encoding: "utf-8",
        timeout: 5000,
      });
      const entries: PsEntry[] = [];
      for (const line of output.trim().split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          entries.push({
            pid: parseInt(parts[0], 10),
            ppid: parseInt(parts[1], 10),
            rss_kb: parseInt(parts[2], 10),
          });
        }
      }
      return entries;
    } catch {
      this.log.warn("Failed to read process list via ps");
      return [];
    }
  }

  /** Find all descendant processes of a given PID */
  private findDescendants(rootPid: number, entries: PsEntry[]): PsEntry[] {
    const children: PsEntry[] = [];
    const stack = [rootPid];

    while (stack.length > 0) {
      const parent = stack.pop()!;
      for (const entry of entries) {
        if (entry.ppid === parent && entry.pid !== rootPid) {
          children.push(entry);
          stack.push(entry.pid);
        }
      }
    }

    return children;
  }
}
