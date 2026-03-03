/**
 * health.ts — Unified health checks for all session types
 *
 * Strategies:
 *   tmux_alive  — session exists in tmux
 *   http        — GET endpoint returns 2xx
 *   process     — process name/pattern found via pgrep
 *   custom      — shell command exits 0
 */

import { execSync, spawnSync } from "node:child_process";
import type { HealthCheckConfig, HealthResult, SessionConfig, TmxConfig } from "./types.js";
import type { Logger } from "./log.js";
import type { StateManager } from "./state.js";
import { sessionExists, isTmuxServerAlive } from "./session.js";
import { getHealthConfig } from "./config.js";

/** Run a single health check for a session */
export function checkSessionHealth(
  sessionName: string,
  healthConfig: HealthCheckConfig,
  log: Logger,
): HealthResult {
  const start = Date.now();

  try {
    switch (healthConfig.check) {
      case "tmux_alive":
        return tmuxAliveCheck(sessionName, start);

      case "http":
        return httpCheck(sessionName, healthConfig.url!, start);

      case "process":
        return processCheck(sessionName, healthConfig.process_pattern!, start);

      case "custom":
        return customCheck(sessionName, healthConfig.command!, start);

      default:
        return {
          session: sessionName,
          healthy: false,
          message: `Unknown check type: ${healthConfig.check}`,
          duration_ms: Date.now() - start,
        };
    }
  } catch (err) {
    return {
      session: sessionName,
      healthy: false,
      message: `Health check error: ${err}`,
      duration_ms: Date.now() - start,
    };
  }
}

/** Check if a tmux session exists */
function tmuxAliveCheck(sessionName: string, startMs: number): HealthResult {
  const alive = sessionExists(sessionName);
  return {
    session: sessionName,
    healthy: alive,
    message: alive ? "tmux session alive" : "tmux session not found",
    duration_ms: Date.now() - startMs,
  };
}

/** HTTP health check — GET url, expect 2xx */
function httpCheck(sessionName: string, url: string, startMs: number): HealthResult {
  try {
    // Use curl for HTTP checks (universally available)
    const result = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", url], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    const code = parseInt(result.stdout?.trim() ?? "0", 10);
    const healthy = code >= 200 && code < 300;
    return {
      session: sessionName,
      healthy,
      message: healthy ? `HTTP ${code}` : `HTTP ${code} (expected 2xx)`,
      duration_ms: Date.now() - startMs,
    };
  } catch (err) {
    return {
      session: sessionName,
      healthy: false,
      message: `HTTP check failed: ${err}`,
      duration_ms: Date.now() - startMs,
    };
  }
}

/** Process pattern check — pgrep for a pattern */
function processCheck(sessionName: string, pattern: string, startMs: number): HealthResult {
  const result = spawnSync("pgrep", ["-f", pattern], {
    timeout: 5000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const found = result.status === 0;
  return {
    session: sessionName,
    healthy: found,
    message: found ? `Process '${pattern}' found` : `Process '${pattern}' not found`,
    duration_ms: Date.now() - startMs,
  };
}

/** Custom command check — exit 0 = healthy */
function customCheck(sessionName: string, command: string, startMs: number): HealthResult {
  try {
    execSync(command, { timeout: 10_000, stdio: "ignore" });
    return {
      session: sessionName,
      healthy: true,
      message: "Custom check passed",
      duration_ms: Date.now() - startMs,
    };
  } catch {
    return {
      session: sessionName,
      healthy: false,
      message: "Custom check failed",
      duration_ms: Date.now() - startMs,
    };
  }
}

/**
 * Run a full health sweep across all running/degraded sessions.
 * Updates state and returns results.
 */
export function runHealthSweep(
  config: TmxConfig,
  state: StateManager,
  log: Logger,
): HealthResult[] {
  const results: HealthResult[] = [];

  // First, verify tmux server is alive
  if (!isTmuxServerAlive()) {
    log.error("Tmux server is not running — marking all sessions as failed");
    for (const session of config.sessions) {
      const s = state.getSession(session.name);
      if (s && (s.status === "running" || s.status === "degraded" || s.status === "starting")) {
        state.transition(session.name, "failed", "Tmux server not running");
        results.push({
          session: session.name,
          healthy: false,
          message: "Tmux server not running",
          duration_ms: 0,
        });
      }
    }
    return results;
  }

  for (const session of config.sessions) {
    const s = state.getSession(session.name);
    if (!s) continue;

    // Only health-check running or degraded sessions
    if (s.status !== "running" && s.status !== "degraded") continue;

    const healthConfig = getHealthConfig(session, config.health_defaults);
    const result = checkSessionHealth(session.name, healthConfig, log);
    results.push(result);

    // Record the result in state
    state.recordHealthCheck(session.name, result.healthy, result.message);

    if (result.healthy) {
      // If degraded and now healthy, transition back to running
      if (s.status === "degraded") {
        state.transition(session.name, "starting"); // will go running after next check
        log.info(`Session '${session.name}' recovered`, { session: session.name });
      }
    } else {
      log.warn(`Health check failed for '${session.name}': ${result.message}`, {
        session: session.name,
        consecutive_failures: s.consecutive_failures + 1,
        threshold: healthConfig.unhealthy_threshold,
      });

      // Check if we've exceeded the unhealthy threshold
      if (s.consecutive_failures + 1 >= healthConfig.unhealthy_threshold) {
        if (s.status === "running") {
          state.transition(session.name, "degraded");
        } else if (s.status === "degraded") {
          // Check if we should auto-restart or fail
          if (s.restart_count >= session.max_restarts) {
            state.transition(session.name, "failed",
              `Exceeded max restarts (${session.max_restarts})`);
          }
          // Auto-restart is handled by the daemon's main loop
        }
      }
    }
  }

  return results;
}
