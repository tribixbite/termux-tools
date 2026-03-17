/**
 * budget.ts — Phantom process counter (informational only)
 *
 * Counts descendants of TERMUX_APP_PID to match what Android's
 * PhantomProcessList tracks. The phantom killer is disabled on this
 * device via device_config (applied by daemon on ADB connect), so
 * this is purely for dashboard display.
 *
 * Uses a 30s cache to avoid blocking the event loop with ps every
 * time the dashboard polls status (every 15s via SSE).
 */

import { spawnSync } from "node:child_process";
import type { Logger } from "./log.js";

/** Simple process count snapshot for dashboard display */
export interface ProcessCount {
  /** Number of phantom processes (descendants of app PID) */
  phantom_procs: number;
}

/** Cache TTL for process count (ms) */
const CACHE_TTL = 30_000;

export class BudgetTracker {
  private log: Logger;
  /** Cached Termux app PID — set once from env */
  private appPid: number | null = null;
  /** Cached count + timestamp to avoid blocking every 15s */
  private cachedCount = 0;
  private cacheTime = 0;

  constructor(_budget: number, log: Logger) {
    this.log = log;
    const envPid = process.env.TERMUX_APP_PID;
    if (envPid) {
      const parsed = parseInt(envPid, 10);
      if (parsed > 0) this.appPid = parsed;
    }
  }

  /** Count phantom processes (descendants of app PID) */
  private getProcessCount(): number {
    if (!this.appPid) return 0;
    try {
      const result = spawnSync("ps", ["-e", "-o", "pid=,ppid="], {
        encoding: "utf-8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      if (result.status !== 0 || !result.stdout) return 0;

      // Build parent → children map
      const childrenOf = new Map<number, number[]>();
      for (const line of result.stdout.split("\n")) {
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

  /** Get snapshot for dashboard/status display (cached 30s) */
  check(): ProcessCount {
    const now = Date.now();
    if (now - this.cacheTime > CACHE_TTL) {
      this.cachedCount = this.getProcessCount();
      this.cacheTime = now;
    }
    return { phantom_procs: this.cachedCount };
  }

  /** Always true — phantom killer is disabled, never block anything */
  canStartSession(): boolean {
    return true;
  }

  /** No-op — kept for config reload compatibility */
  setBudget(_budget: number): void {}
}
