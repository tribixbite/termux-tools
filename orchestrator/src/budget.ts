/**
 * budget.ts — Phantom process counter (informational only)
 *
 * Counts descendants of TERMUX_APP_PID to match what Android's
 * PhantomProcessList tracks. The phantom killer is disabled on this
 * device via device_config (applied by daemon on ADB connect), so
 * this is purely for dashboard display.
 */

import { execSync } from "node:child_process";
import type { Logger } from "./log.js";

/** Simple process count snapshot for dashboard display */
export interface ProcessCount {
  /** Number of phantom processes (descendants of app PID) */
  phantom_procs: number;
}

export class BudgetTracker {
  private log: Logger;
  /** Cached Termux app PID — set once from env */
  private appPid: number | null = null;

  constructor(_budget: number, log: Logger) {
    this.log = log;
    const envPid = process.env.TERMUX_APP_PID;
    if (envPid) {
      const parsed = parseInt(envPid, 10);
      if (parsed > 0) this.appPid = parsed;
    }
  }

  /** Count phantom processes (descendants of app PID) */
  getProcessCount(): number {
    if (!this.appPid) return 0;
    try {
      const output = execSync("ps -e -o pid=,ppid= 2>/dev/null", {
        encoding: "utf-8",
        timeout: 5000,
      });

      // Build parent → children map
      const childrenOf = new Map<number, number[]>();
      for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) continue;
        const pid = parseInt(parts[0], 10);
        const ppid = parseInt(parts[1], 10);
        if (isNaN(pid) || isNaN(ppid)) continue;
        let siblings = childrenOf.get(ppid);
        if (!siblings) {
          siblings = [];
          childrenOf.set(ppid, siblings);
        }
        siblings.push(pid);
      }

      // BFS from appPid, count descendants (excluding root)
      let count = 0;
      const queue = childrenOf.get(this.appPid) ?? [];
      const visited = new Set<number>([this.appPid]);
      while (queue.length > 0) {
        const pid = queue.shift()!;
        if (visited.has(pid)) continue;
        visited.add(pid);
        count++;
        const kids = childrenOf.get(pid);
        if (kids) {
          for (const kid of kids) {
            if (!visited.has(kid)) queue.push(kid);
          }
        }
      }
      return count;
    } catch {
      return 0;
    }
  }

  /** Get snapshot for dashboard/status display */
  check(): ProcessCount {
    return { phantom_procs: this.getProcessCount() };
  }

  /** Always true — phantom killer is disabled, never block anything */
  canStartSession(): boolean {
    return true;
  }

  /** No-op — kept for config reload compatibility */
  setBudget(_budget: number): void {}
}
