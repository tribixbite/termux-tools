/**
 * battery.ts — Battery monitoring for Termux/Android
 *
 * Reads battery status via termux-battery-status (Termux:API) or
 * /sys/class/power_supply/battery/* fallback. When battery drops below
 * a configurable threshold (default 10%) and is NOT charging, disables
 * wifi and mobile data to conserve power, and sends a notification.
 */

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Logger } from "./log.js";

/**
 * Environment for Termux:API commands (termux-battery-status, termux-wifi-enable, etc.).
 * Bun's glibc runner strips LD_PRELOAD, but the Termux exec interceptor
 * is required for the underlying am/app_process calls to work.
 */
function termuxApiEnv(): NodeJS.ProcessEnv {
  const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
  const ldPreload = join(prefix, "lib", "libtermux-exec.so");
  return { ...process.env, LD_PRELOAD: ldPreload };
}

/** Resolve full path for a Termux binary (bun's spawnSync can't find $PREFIX/bin via PATH) */
function resolveTermuxBin(name: string): string {
  const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
  const candidate = join(prefix, "bin", name);
  try { if (existsSync(candidate)) return candidate; } catch { /* fall through */ }
  return name;
}

/** Battery status snapshot */
export interface BatteryStatus {
  /** Battery level 0-100 */
  percentage: number;
  /** Whether device is plugged in / charging */
  charging: boolean;
  /** Temperature in Celsius */
  temperature: number;
  /** Health string from Android */
  health: string;
}

/** Actions already taken — prevents repeated toggling */
interface BatteryActionState {
  /** Whether low-battery actions (wifi/data off) have been applied */
  actionsApplied: boolean;
  /** Last percentage when actions were applied */
  appliedAtPct: number;
  /** Timestamp of last action */
  appliedAt: number;
}

export class BatteryMonitor {
  private log: Logger;
  private lowThresholdPct: number;
  private actionState: BatteryActionState = {
    actionsApplied: false,
    appliedAtPct: 0,
    appliedAt: 0,
  };

  constructor(log: Logger, lowThresholdPct = 10) {
    this.log = log;
    this.lowThresholdPct = lowThresholdPct;
  }

  /** Update threshold (e.g. from config reload) */
  setThreshold(pct: number): void {
    this.lowThresholdPct = pct;
  }

  /** Read current battery status */
  getBatteryStatus(): BatteryStatus | null {
    // Try termux-battery-status first (most reliable, needs Termux:API)
    // Must use full path + LD_PRELOAD — bun's glibc runner strips both PATH
    // resolution and LD_PRELOAD which termux-api needs for am/app_process.
    try {
      const bin = resolveTermuxBin("termux-battery-status");
      const result = spawnSync(bin, [], {
        encoding: "utf-8",
        timeout: 8000,
        stdio: ["ignore", "pipe", "pipe"],
        env: termuxApiEnv(),
      });
      if (result.status === 0 && result.stdout) {
        const data = JSON.parse(result.stdout) as {
          percentage: number;
          status: string;
          plugged: string;
          temperature: number;
          health: string;
        };
        return {
          percentage: data.percentage,
          charging: data.status === "CHARGING" || data.status === "FULL" ||
            data.plugged !== "UNPLUGGED",
          temperature: data.temperature,
          health: data.health ?? "UNKNOWN",
        };
      }
    } catch { /* fall through to sysfs */ }

    // Fallback: read from sysfs (works without Termux:API)
    try {
      const base = "/sys/class/power_supply/battery";
      if (!existsSync(base)) return null;

      const capacity = parseInt(readFileSync(`${base}/capacity`, "utf-8").trim(), 10);
      const statusStr = readFileSync(`${base}/status`, "utf-8").trim();
      let temp = 0;
      try {
        temp = parseInt(readFileSync(`${base}/temp`, "utf-8").trim(), 10) / 10;
      } catch { /* optional */ }

      return {
        percentage: isNaN(capacity) ? 0 : capacity,
        charging: statusStr === "Charging" || statusStr === "Full",
        temperature: temp,
        health: "UNKNOWN",
      };
    } catch {
      return null;
    }
  }

  /**
   * Check battery and take action if below threshold.
   * Returns the battery status, or null if unavailable.
   * Only takes action (disable wifi/data) when:
   * - Battery is below threshold
   * - Device is NOT charging
   * - Actions haven't already been applied at this level
   */
  checkAndAct(): BatteryStatus | null {
    const status = this.getBatteryStatus();
    if (!status) return null;

    const isLow = status.percentage <= this.lowThresholdPct && !status.charging;

    if (isLow && !this.actionState.actionsApplied) {
      this.log.warn(`Battery critically low: ${status.percentage}% (threshold: ${this.lowThresholdPct}%), not charging — disabling radios`, {
        battery_pct: status.percentage,
        charging: status.charging,
      });
      this.disableRadios();
      this.sendAlert(status.percentage);
      this.actionState = {
        actionsApplied: true,
        appliedAtPct: status.percentage,
        appliedAt: Date.now(),
      };
    }

    // Re-enable once charging AND above threshold + 5% hysteresis
    if (this.actionState.actionsApplied && status.charging &&
        status.percentage > this.lowThresholdPct + 5) {
      this.log.info(`Battery recovered to ${status.percentage}% and charging — re-enabling radios`);
      this.enableRadios();
      this.actionState.actionsApplied = false;
    }

    return status;
  }

  /** Whether low-battery actions are currently in effect */
  get actionsActive(): boolean {
    return this.actionState.actionsApplied;
  }

  /** Disable wifi and mobile data to conserve battery */
  private disableRadios(): void {
    const env = termuxApiEnv();
    const wifiBin = resolveTermuxBin("termux-wifi-enable");

    // Disable WiFi via termux-wifi-enable (Termux:API)
    try {
      const result = spawnSync(wifiBin, ["false"], {
        timeout: 8000,
        stdio: "ignore",
        env,
      });
      if (result.status === 0) {
        this.log.info("WiFi disabled (battery saver)");
      } else {
        this.log.warn("termux-wifi-enable failed");
      }
    } catch (err) {
      this.log.warn(`Failed to disable WiFi: ${err}`);
    }

    // Disable mobile data via svc (requires adb shell or root)
    try {
      spawnSync("svc", ["data", "disable"], { timeout: 3000, stdio: "ignore", env });
      this.log.info("Mobile data disabled (battery saver)");
    } catch (err) {
      this.log.warn(`Failed to disable mobile data: ${err}`);
    }
  }

  /** Re-enable wifi and mobile data */
  private enableRadios(): void {
    const env = termuxApiEnv();
    const wifiBin = resolveTermuxBin("termux-wifi-enable");

    try {
      spawnSync(wifiBin, ["true"], { timeout: 8000, stdio: "ignore", env });
      this.log.info("WiFi re-enabled (battery recovered)");
    } catch (err) {
      this.log.warn(`Failed to re-enable WiFi: ${err}`);
    }

    try {
      spawnSync("svc", ["data", "enable"], { timeout: 3000, stdio: "ignore", env });
      this.log.info("Mobile data re-enabled (battery recovered)");
    } catch (err) {
      this.log.warn(`Failed to re-enable mobile data: ${err}`);
    }
  }

  /** Send notification about low battery */
  private sendAlert(pct: number): void {
    const env = termuxApiEnv();
    const notifyBin = resolveTermuxBin("termux-notification");
    const toastBin = resolveTermuxBin("termux-toast");

    try {
      spawnSync(notifyBin, [
        "--title", "LOW BATTERY",
        "--content", `Battery at ${pct}% and not charging. WiFi & mobile data disabled to conserve power. Plug in to restore.`,
        "--priority", "max",
        "--id", "tmx-battery-low",
        "--vibrate", "500,200,500",
      ], { timeout: 8000, stdio: "ignore", env });
    } catch {
      // Non-fatal — log already captured the event
    }

    // Also try termux-toast for immediate visibility
    try {
      spawnSync(toastBin, [
        "-b", "red",
        "-c", "white",
        `BATTERY ${pct}% — radios disabled`,
      ], { timeout: 5000, stdio: "ignore", env });
    } catch { /* non-fatal */ }
  }
}
