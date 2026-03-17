/**
 * wake.ts — termux-wake-lock/unlock management
 *
 * Manages the Termux wake lock based on policy:
 *   always           — acquire on daemon start, release on shutdown
 *   active_sessions  — acquire when any session is running, release when all stopped
 *   boot_only        — acquire during boot, release after boot completes
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
 * invoked by termux-wake-lock/unlock need it re-injected.
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

  /** Release the wake lock if held */
  release(): void {
    if (!this.held) return;
    try {
      execSync("termux-wake-unlock", { timeout: 5000, stdio: "ignore", env: termuxEnv() });
      this.held = false;
      this.log.info("Wake lock released");
    } catch (err) {
      this.log.error(`Failed to release wake lock: ${err}`);
    }
  }

  /** Whether the wake lock is currently held */
  isHeld(): boolean {
    return this.held;
  }

  /** Evaluate the policy and acquire/release accordingly */
  evaluate(phase: "boot_start" | "boot_end" | "shutdown" | "session_change", sessions?: Record<string, SessionState>): void {
    switch (this.policy) {
      case "always":
        if (phase === "shutdown") {
          this.release();
        } else {
          this.acquire();
        }
        break;

      case "active_sessions":
        if (phase === "shutdown") {
          this.release();
        } else if (sessions) {
          const hasActive = Object.values(sessions).some(
            (s) => s.status === "running" || s.status === "starting" || s.status === "degraded"
          );
          if (hasActive) {
            this.acquire();
          } else {
            this.release();
          }
        }
        break;

      case "boot_only":
        if (phase === "boot_start") {
          this.acquire();
        } else if (phase === "boot_end" || phase === "shutdown") {
          this.release();
        }
        break;

      case "never":
        this.release();
        break;
    }
  }

  /** Force release on shutdown regardless of policy */
  forceRelease(): void {
    this.release();
  }
}
