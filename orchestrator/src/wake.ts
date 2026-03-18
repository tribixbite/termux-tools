/**
 * wake.ts — termux-wake-lock management (acquire-only)
 *
 * Manages the Termux wake lock. The wake lock is NEVER released by the daemon.
 * Android aggressively kills background processes when wake lock is not held.
 * The old startup.sh never released, and it was stable — we follow the same pattern.
 *
 * Policy controls when to acquire:
 *   always           — acquire on daemon start
 *   active_sessions  — acquire when any session is running
 *   boot_only        — acquire during boot
 *   never            — never acquire
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WakeLockPolicy, SessionState } from "./types.js";
import type { Logger } from "./log.js";

/**
 * Build env with LD_PRELOAD injected for termux-exec compatibility.
 * Bun's glibc-runner strips LD_PRELOAD, so child processes (like `am`)
 * invoked by termux-wake-lock need it re-injected.
 */
function termuxEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const ldPreload = join(
    process.env.PREFIX ?? "/data/data/com.termux/files/usr",
    "lib", "libtermux-exec.so",
  );
  if (existsSync(ldPreload)) {
    env.LD_PRELOAD = ldPreload;
  }
  return env;
}

export class WakeLockManager {
  private policy: WakeLockPolicy;
  private held = false;
  private log: Logger;

  constructor(policy: WakeLockPolicy, log: Logger) {
    this.policy = policy;
    this.log = log;
  }

  /** Acquire the wake lock if not already held */
  acquire(): void {
    if (this.held) return;
    try {
      execSync("termux-wake-lock", { timeout: 5000, stdio: "ignore", env: termuxEnv() });
      this.held = true;
      this.log.info("Wake lock acquired");
    } catch (err) {
      this.log.error(`Failed to acquire wake lock: ${err}`);
    }
  }

  /** Whether the wake lock is currently held */
  isHeld(): boolean {
    return this.held;
  }

  /**
   * Evaluate the policy and acquire if appropriate.
   * NOTE: Wake lock is NEVER released by the daemon. Only acquire paths exist.
   * Android kills background processes when wake lock is dropped — the old
   * tasker/startup.sh never released, and it was stable.
   */
  evaluate(phase: "boot_start" | "boot_end" | "shutdown" | "session_change", sessions?: Record<string, SessionState>): void {
    switch (this.policy) {
      case "always":
        // Always acquire, never release
        this.acquire();
        break;

      case "active_sessions":
        // Acquire when any session is active — never release
        if (sessions) {
          const hasActive = Object.values(sessions).some(
            (s) => s.status === "running" || s.status === "starting" || s.status === "degraded"
          );
          if (hasActive) {
            this.acquire();
          }
        }
        break;

      case "boot_only":
        if (phase === "boot_start") {
          this.acquire();
        }
        break;

      case "never":
        // Don't acquire, don't release
        break;
    }
  }
}
