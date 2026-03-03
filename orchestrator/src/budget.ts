/**
 * budget.ts — Android 12+ process count tracker
 *
 * Counts ALL processes under the Termux UID (not just tmux sessions)
 * using `ps` and determines budget mode:
 *   normal   (<70% of budget)
 *   warning  (70-90% of budget)
 *   critical (>90% of budget — should shed non-essential sessions)
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

  constructor(budget: number, log: Logger) {
    this.budget = budget;
    this.log = log;
  }

  /** Get current process count for the Termux UID (our app sandbox) */
  getProcessCount(): number {
    try {
      // Count processes owned by our UID only — not all system processes.
      // Android assigns each app a unique UID (u0_aXXX). The phantom
      // process killer counts per-UID, so we must filter to our UID.
      const uid = String(process.getuid!());
      const output = execSync(`ps -e -o uid=,pid= 2>/dev/null | awk '$1 == ${uid}' | wc -l`, {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      return parseInt(output, 10) || 0;
    } catch {
      // Fallback: count /proc entries owned by us
      try {
        const uid = String(process.getuid!());
        const output = execSync(
          `ls -ldn /proc/[0-9]* 2>/dev/null | awk '$3 == ${uid}' | wc -l`,
          { encoding: "utf-8", timeout: 5000 }
        ).trim();
        return parseInt(output, 10) || 0;
      } catch {
        this.log.warn("Failed to count processes, assuming 0");
        return 0;
      }
    }
  }

  /** Determine budget mode from process count */
  private computeMode(count: number): BudgetMode {
    const pct = (count / this.budget) * 100;
    if (pct >= CRITICAL_PCT) return "critical";
    if (pct >= WARNING_PCT) return "warning";
    return "normal";
  }

  /** Get current budget status */
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
      const logFn = mode === "critical" ? "error" : mode === "warning" ? "warn" : "info";
      this.log[logFn](`Process budget: ${this.lastStatus.mode} → ${mode}`, {
        total_procs,
        budget: this.budget,
        usage_pct,
      });
    }

    this.lastStatus = status;
    return status;
  }

  /** Check if we can safely start another session */
  canStartSession(): boolean {
    const status = this.check();
    return status.mode !== "critical";
  }

  /** Update the budget limit (e.g., from config reload) */
  setBudget(budget: number): void {
    this.budget = budget;
  }
}
