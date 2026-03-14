/**
 * budget.ts — Android 12+ phantom process budget tracker (informational only)
 *
 * Counts phantom processes the way Android's PhantomProcessList does:
 * descendants of the Termux app process (TERMUX_APP_PID), excluding
 * the app process itself. This matches what the phantom process killer
 * actually monitors — NOT all processes under the Termux UID.
 *
 * Budget modes are purely informational — they never block session
 * starts or trigger auto-kills.
 */

import { execSync } from "node:child_process";
import type { BudgetMode, BudgetStatus } from "./types.js";
import type { Logger } from "./log.js";

/** Threshold percentages for budget modes */
const WARNING_PCT = 70;
const CRITICAL_PCT = 90;

export class BudgetTracker {
  private budget: number;
  private log: Logger;
  private lastStatus: BudgetStatus | null = null;
  /** Cached Termux app PID — set once from env, doesn't change */
  private appPid: number | null = null;

  constructor(budget: number, log: Logger) {
    this.budget = budget;
    this.log = log;

    // Resolve TERMUX_APP_PID from env (set by Termux on every session)
    const envPid = process.env.TERMUX_APP_PID;
    if (envPid) {
      const parsed = parseInt(envPid, 10);
      if (parsed > 0) this.appPid = parsed;
    }
    if (!this.appPid) {
      this.log.warn("TERMUX_APP_PID not set — phantom process count will use UID fallback");
    }
  }

  /**
   * Count phantom processes: descendants of TERMUX_APP_PID.
   * This matches what Android's PhantomProcessList tracks.
   */
  getProcessCount(): number {
    if (this.appPid) {
      return this.countDescendants(this.appPid);
    }
    // Fallback: count all UID processes (overestimates, but better than nothing)
    return this.countUidProcesses();
  }

  /** Walk the process tree to count all descendants of a given PID */
  private countDescendants(rootPid: number): number {
    try {
      // Parse all pid,ppid pairs from ps
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

      // BFS from rootPid, count all descendants (excluding root itself)
      let count = 0;
      const queue = childrenOf.get(rootPid) ?? [];
      const visited = new Set<number>([rootPid]);

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
      this.log.warn("Failed to walk process tree, falling back to UID count");
      return this.countUidProcesses();
    }
  }

  /** Fallback: count all processes owned by our UID */
  private countUidProcesses(): number {
    try {
      const uid = String(process.getuid!());
      const output = execSync(
        `ps -e -o uid=,pid= 2>/dev/null | awk '$1 == ${uid}' | wc -l`,
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
      return parseInt(output, 10) || 0;
    } catch {
      this.log.warn("Failed to count processes");
      return 0;
    }
  }

  /** Determine budget mode from process count (informational only) */
  private computeMode(count: number): BudgetMode {
    const pct = (count / this.budget) * 100;
    if (pct >= CRITICAL_PCT) return "critical";
    if (pct >= WARNING_PCT) return "warning";
    return "normal";
  }

  /** Get current budget status (informational — never blocks anything) */
  check(): BudgetStatus {
    const total_procs = this.getProcessCount();
    const usage_pct = Math.round((total_procs / this.budget) * 100);
    const mode = this.computeMode(total_procs);

    const status: BudgetStatus = {
      mode,
      total_procs,
      budget: this.budget,
      usage_pct,
    };

    // Log transitions between modes
    if (this.lastStatus && this.lastStatus.mode !== mode) {
      this.log[mode === "critical" ? "warn" : "info"](
        `Process budget: ${this.lastStatus.mode} → ${mode}`,
        { total_procs, budget: this.budget, usage_pct }
      );
    }

    this.lastStatus = status;
    return status;
  }

  /** Informational check — always returns true (budget never blocks starts) */
  canStartSession(): boolean {
    this.check(); // update metrics
    return true;
  }

  /** Update the budget limit (e.g., from config reload) */
  setBudget(budget: number): void {
    this.budget = budget;
  }
}
