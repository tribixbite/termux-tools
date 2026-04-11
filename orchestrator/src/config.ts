/**
 * config.ts — TOML config loader with validation and env var expansion
 *
 * Loads tmx.toml, expands $ENV_VAR references, validates schema,
 * and returns a fully typed TmxConfig.
 */

import { existsSync, readFileSync } from "node:fs";
import type {
  TmxConfig,
  OrchestratorConfig,
  AdbConfig,
  BatteryConfig,
  BootConfig,
  TelemetrySinkConfig,
  SessionConfig,
  HealthCheckConfig,
  HealthDefaults,
  SessionType,
  WakeLockPolicy,
  HealthCheckType,
} from "./types.js";

/** Default config search paths in priority order */
const CONFIG_PATHS = [
  "$HOME/.config/tmx/tmx.toml",
  "$HOME/.termux/tmx.toml",
];

/** Expand $VAR and ${VAR} references in a string */
function expandEnvVars(input: string): string {
  return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_match, braced, unbraced) => {
      const varName = braced ?? unbraced;
      return process.env[varName] ?? "";
    }
  );
}

/** Recursively expand env vars in all string values of an object */
function expandDeep(obj: unknown): unknown {
  if (typeof obj === "string") return expandEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(expandDeep);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = expandDeep(v);
    }
    return result;
  }
  return obj;
}

/** Parse TOML string — uses Bun's built-in TOML or our minimal parser */
function parseTOML(content: string): Record<string, unknown> {
  // Try Bun's built-in TOML support if available (untyped access avoids bun-types dep)
  const g = globalThis as Record<string, unknown>;
  if (g.Bun != null) {
    const bun = g.Bun as Record<string, unknown>;
    if (typeof bun.TOML === "object" && bun.TOML !== null) {
      const toml = bun.TOML as { parse: (s: string) => Record<string, unknown> };
      return toml.parse(content);
    }
  }
  // Fallback: use our minimal TOML parser (works in Node.js and Bun)
  return parseTomlMinimal(content);
}

/**
 * Minimal TOML parser — handles the subset we use:
 * - [section] and [[array]] headers
 * - key = "string", key = number, key = bool, key = ["array"]
 * - # comments, blank lines
 */
function parseTomlMinimal(content: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let currentSection: Record<string, unknown> = root;
  let currentPath: string[] = [];
  let isArrayTable = false;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Array table: [[section]]
    const arrayMatch = line.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayMatch) {
      isArrayTable = true;
      currentPath = arrayMatch[1].split(".");
      const newItem: Record<string, unknown> = {};

      // Navigate to parent, creating along the way
      let target = root;
      for (let i = 0; i < currentPath.length - 1; i++) {
        if (!(currentPath[i] in target)) target[currentPath[i]] = {};
        target = target[currentPath[i]] as Record<string, unknown>;
      }

      const key = currentPath[currentPath.length - 1];
      if (!(key in target)) target[key] = [];
      (target[key] as unknown[]).push(newItem);
      currentSection = newItem;
      continue;
    }

    // Table: [section]
    const tableMatch = line.match(/^\[([^\]]+)\]$/);
    if (tableMatch) {
      isArrayTable = false;
      currentPath = tableMatch[1].split(".");

      // If current array table context and this is a sub-section like [session.env]
      // attach to the last array item
      if (currentPath[0] === "session" && currentPath.length > 1) {
        const sessions = root["session"] as unknown[] | undefined;
        if (sessions && sessions.length > 0) {
          const lastSession = sessions[sessions.length - 1] as Record<string, unknown>;
          const subKey = currentPath.slice(1).join(".");
          if (!(subKey in lastSession)) lastSession[subKey] = {};
          currentSection = lastSession[subKey] as Record<string, unknown>;
          continue;
        }
      }

      // Navigate/create nested path
      let target = root;
      for (const segment of currentPath) {
        if (!(segment in target)) target[segment] = {};
        target = target[segment] as Record<string, unknown>;
      }
      currentSection = target;
      continue;
    }

    // Key = value
    const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      currentSection[key] = parseTomlValue(rawValue.trim());
    }
  }

  return root;
}

/** Parse a TOML value (string, number, bool, array) */
function parseTomlValue(raw: string): unknown {
  // Quoted string
  if ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  // Boolean
  if (raw === "true") return true;
  if (raw === "false") return false;
  // Array
  if (raw.startsWith("[")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => parseTomlValue(s.trim()));
  }
  // Number
  const num = Number(raw);
  if (!isNaN(num)) return num;
  // Fallback: treat as string
  return raw;
}

// -- Validation ---------------------------------------------------------------

class ConfigError extends Error {
  constructor(public path: string, message: string) {
    super(`Config error at '${path}': ${message}`);
    this.name = "ConfigError";
  }
}

const VALID_SESSION_TYPES: SessionType[] = ["claude", "daemon", "service"];
const VALID_WAKE_POLICIES: WakeLockPolicy[] = ["always", "active_sessions", "boot_only", "never"];
const VALID_HEALTH_CHECKS: HealthCheckType[] = ["tmux_alive", "http", "process", "custom"];
const NAME_PATTERN = /^[a-z0-9-]+$/;

function validateConfig(raw: Record<string, unknown>): TmxConfig {
  const errors: string[] = [];

  // Orchestrator section
  const orc = (raw.orchestrator ?? {}) as Record<string, unknown>;
  const orchestrator: OrchestratorConfig = {
    socket: asString(orc.socket, "orchestrator.socket",
      `${process.env.PREFIX ?? "/data/data/com.termux/files/usr"}/tmp/tmx.sock`),
    state_file: asString(orc.state_file, "orchestrator.state_file",
      `${process.env.HOME}/.local/share/tmx/state.json`),
    log_dir: asString(orc.log_dir, "orchestrator.log_dir",
      `${process.env.HOME}/.local/share/tmx/logs`),
    health_interval_s: asNumber(orc.health_interval_s, "orchestrator.health_interval_s", 120),
    boot_timeout_s: asNumber(orc.boot_timeout_s, "orchestrator.boot_timeout_s", 300),
    process_budget: asNumber(orc.process_budget, "orchestrator.process_budget", 32),
    wake_lock_policy: asEnum(orc.wake_lock_policy, VALID_WAKE_POLICIES,
      "orchestrator.wake_lock_policy", "active_sessions") as WakeLockPolicy,
    dashboard_port: asNumber(orc.dashboard_port, "orchestrator.dashboard_port", 18970),
    memory_warning_mb: asNumber(orc.memory_warning_mb, "orchestrator.memory_warning_mb", 2000),
    memory_critical_mb: asNumber(orc.memory_critical_mb, "orchestrator.memory_critical_mb", 1200),
    memory_emergency_mb: asNumber(orc.memory_emergency_mb, "orchestrator.memory_emergency_mb", 800),
  };

  // ADB section
  const adbRaw = (raw.adb ?? {}) as Record<string, unknown>;
  const adb: AdbConfig = {
    enabled: asBool(adbRaw.enabled, "adb.enabled", true),
    connect_script: asString(adbRaw.connect_script, "adb.connect_script",
      `${process.env.HOME}/git/termux-tools/tools/adb-wireless-connect.sh`),
    connect_timeout_s: asNumber(adbRaw.connect_timeout_s, "adb.connect_timeout_s", 45),
    retry_interval_s: asNumber(adbRaw.retry_interval_s, "adb.retry_interval_s", 300),
    phantom_fix: asBool(adbRaw.phantom_fix, "adb.phantom_fix", true),
    boot_delay_s: asNumber(adbRaw.boot_delay_s, "adb.boot_delay_s", 15),
  };

  // Battery section
  const batRaw = (raw.battery ?? {}) as Record<string, unknown>;
  const battery: BatteryConfig = {
    enabled: asBool(batRaw.enabled, "battery.enabled", true),
    low_threshold_pct: asNumber(batRaw.low_threshold_pct, "battery.low_threshold_pct", 10),
    poll_interval_s: asNumber(batRaw.poll_interval_s, "battery.poll_interval_s", 60),
  };

  // Telemetry sink section
  const tsRaw = (raw.telemetry_sink ?? {}) as Record<string, unknown>;
  const telemetry_sink: TelemetrySinkConfig = {
    enabled: asBool(tsRaw.enabled, "telemetry_sink.enabled", false),
    port: asNumber(tsRaw.port, "telemetry_sink.port", 18971),
    max_body_bytes: asNumber(tsRaw.max_body_bytes, "telemetry_sink.max_body_bytes", 4096),
    ring_buffer_size: asNumber(tsRaw.ring_buffer_size, "telemetry_sink.ring_buffer_size", 500),
    rotate_at_bytes: asNumber(tsRaw.rotate_at_bytes, "telemetry_sink.rotate_at_bytes", 10 * 1024 * 1024),
  };

  // Boot recency config
  const bootRaw = (raw.boot ?? {}) as Record<string, unknown>;
  const boot: BootConfig = {
    auto_start: asNumber(bootRaw.auto_start, "boot.auto_start", 6),
    visible: asNumber(bootRaw.visible, "boot.visible", 10),
  };

  // Health defaults
  const hdRaw = (raw.health_defaults ?? {}) as Record<string, Record<string, unknown>>;
  const health_defaults: HealthDefaults = {};
  for (const type of VALID_SESSION_TYPES) {
    const hd = hdRaw[type] ?? {};
    health_defaults[type] = {
      check: asEnum(hd.check, VALID_HEALTH_CHECKS, `health_defaults.${type}.check`, "tmux_alive") as HealthCheckType,
      unhealthy_threshold: asNumber(hd.unhealthy_threshold, `health_defaults.${type}.unhealthy_threshold`, 2),
      interval_s: hd.interval_s != null ? asNumber(hd.interval_s, `health_defaults.${type}.interval_s`, 120) : undefined,
    };
  }

  // Sessions
  const sessionRaw = (raw.session ?? []) as Record<string, unknown>[];
  const sessions: SessionConfig[] = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < sessionRaw.length; i++) {
    const s = sessionRaw[i];
    const prefix = `session[${i}]`;

    const name = asString(s.name, `${prefix}.name`, "");
    if (!name) {
      errors.push(`${prefix}: 'name' is required`);
      continue;
    }
    if (!NAME_PATTERN.test(name)) {
      errors.push(`${prefix}: name '${name}' must match [a-z0-9-]+`);
    }
    if (seenNames.has(name)) {
      errors.push(`${prefix}: duplicate session name '${name}'`);
    }
    seenNames.add(name);

    const type = asEnum(s.type, VALID_SESSION_TYPES, `${prefix}.type`, "claude") as SessionType;

    // Path required for claude/daemon types
    const path = s.path != null ? asString(s.path, `${prefix}.path`, "") : undefined;
    if ((type === "claude" || type === "daemon") && !path) {
      errors.push(`${prefix}: 'path' is required for type '${type}'`);
    }

    // Command required for service/daemon types
    const command = s.command != null ? asString(s.command, `${prefix}.command`, "") : undefined;
    if ((type === "service" || type === "daemon") && !command) {
      // Daemon type can have path-only (just cd into it), but service needs a command
      if (type === "service") {
        errors.push(`${prefix}: 'command' is required for type 'service'`);
      }
    }

    // Parse health override if present
    let health: HealthCheckConfig | undefined;
    const hRaw = s.health as Record<string, unknown> | undefined;
    if (hRaw) {
      health = {
        check: asEnum(hRaw.check, VALID_HEALTH_CHECKS, `${prefix}.health.check`, "tmux_alive") as HealthCheckType,
        unhealthy_threshold: asNumber(hRaw.unhealthy_threshold, `${prefix}.health.unhealthy_threshold`, 2),
        interval_s: hRaw.interval_s != null ? asNumber(hRaw.interval_s, `${prefix}.health.interval_s`, 120) : undefined,
        url: hRaw.url != null ? asString(hRaw.url, `${prefix}.health.url`, "") : undefined,
        process_pattern: hRaw.process_pattern != null ? asString(hRaw.process_pattern, `${prefix}.health.process_pattern`, "") : undefined,
        command: hRaw.command != null ? asString(hRaw.command, `${prefix}.health.command`, "") : undefined,
      };
    }

    // Parse env if present
    const env = (s.env ?? {}) as Record<string, string>;

    sessions.push({
      name,
      type,
      path,
      command,
      auto_go: asBool(s.auto_go, `${prefix}.auto_go`, false),
      priority: asNumber(s.priority, `${prefix}.priority`, 10),
      depends_on: asStringArray(s.depends_on, `${prefix}.depends_on`, []),
      headless: asBool(s.headless, `${prefix}.headless`, false),
      env,
      health,
      max_restarts: asNumber(s.max_restarts, `${prefix}.max_restarts`, 3),
      restart_backoff_s: asNumber(s.restart_backoff_s, `${prefix}.restart_backoff_s`, 5),
      enabled: asBool(s.enabled, `${prefix}.enabled`, true),
      bare: asBool(s.bare, `${prefix}.bare`, false),
    });
  }

  // Validate dependency references
  for (const session of sessions) {
    for (const dep of session.depends_on) {
      if (!seenNames.has(dep)) {
        errors.push(`session '${session.name}': depends_on '${dep}' does not exist`);
      }
    }
  }

  // Validate process budget
  const enabledCount = sessions.filter((s) => s.enabled).length;
  if (orchestrator.process_budget < enabledCount + 5) {
    errors.push(
      `orchestrator.process_budget (${orchestrator.process_budget}) must be >= ` +
      `enabled sessions (${enabledCount}) + 5 overhead`
    );
  }

  if (errors.length > 0) {
    throw new Error(`Config validation failed:\n  ${errors.join("\n  ")}`);
  }

  return { orchestrator, adb, battery, boot, telemetry_sink, sessions, health_defaults };
}

// -- Type coercion helpers ----------------------------------------------------

function asString(val: unknown, path: string, fallback: string): string {
  if (val == null) return fallback;
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  throw new ConfigError(path, `expected string, got ${typeof val}`);
}

function asNumber(val: unknown, path: string, fallback: number): number {
  if (val == null) return fallback;
  const n = Number(val);
  if (isNaN(n)) throw new ConfigError(path, `expected number, got '${val}'`);
  return n;
}

function asBool(val: unknown, path: string, fallback: boolean): boolean {
  if (val == null) return fallback;
  if (typeof val === "boolean") return val;
  if (val === "true") return true;
  if (val === "false") return false;
  throw new ConfigError(path, `expected boolean, got '${val}'`);
}

function asEnum<T extends string>(val: unknown, valid: T[], path: string, fallback: T): T {
  if (val == null) return fallback;
  const s = String(val);
  if (valid.includes(s as T)) return s as T;
  throw new ConfigError(path, `must be one of: ${valid.join(", ")} (got '${s}')`);
}

function asStringArray(val: unknown, path: string, fallback: string[]): string[] {
  if (val == null) return fallback;
  if (Array.isArray(val)) return val.map(String);
  throw new ConfigError(path, `expected array, got '${typeof val}'`);
}

// -- Public API ---------------------------------------------------------------

/** Find the config file in standard locations */
export function findConfigPath(explicit?: string): string | null {
  if (explicit) {
    const expanded = expandEnvVars(explicit);
    return existsSync(expanded) ? expanded : null;
  }
  for (const p of CONFIG_PATHS) {
    const expanded = expandEnvVars(p);
    if (existsSync(expanded)) return expanded;
  }
  return null;
}

/** Load, expand, validate, and return a TmxConfig */
export function loadConfig(configPath?: string): TmxConfig {
  const path = findConfigPath(configPath);
  if (!path) {
    throw new Error(
      `Config file not found. Searched:\n  ${CONFIG_PATHS.map(expandEnvVars).join("\n  ")}\n` +
      `Copy tmx.toml.example to ~/.config/tmx/tmx.toml to get started.`
    );
  }

  const content = readFileSync(path, "utf-8");
  const raw = parseTOML(content);
  const expanded = expandDeep(raw) as Record<string, unknown>;
  return validateConfig(expanded);
}

/** Validate a config file and return errors (empty array = valid) */
export function validateConfigFile(configPath: string): string[] {
  try {
    const content = readFileSync(configPath, "utf-8");
    const raw = parseTOML(content);
    const expanded = expandDeep(raw) as Record<string, unknown>;
    validateConfig(expanded);
    return [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.split("\n").filter(Boolean);
  }
}

/** Get resolved health config for a session (session override > type default) */
export function getHealthConfig(session: SessionConfig, defaults: HealthDefaults): HealthCheckConfig {
  const typeDefault = defaults[session.type] ?? {
    check: "tmux_alive" as HealthCheckType,
    unhealthy_threshold: 2,
  };
  if (session.health) {
    return { ...typeDefault, ...session.health };
  }
  return typeDefault;
}
