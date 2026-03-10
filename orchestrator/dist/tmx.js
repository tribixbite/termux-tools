#!/usr/bin/env bun
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/import-meta-shim.js
var import_meta_url = typeof __filename !== "undefined" ? require("url").pathToFileURL(require("fs").realpathSync(__filename)).href : void 0;

// src/tmx.ts
var import_node_fs11 = require("node:fs");
var import_node_child_process7 = require("node:child_process");
var import_node_path5 = require("node:path");

// src/ipc.ts
var net = __toESM(require("node:net"));
var import_node_fs = require("node:fs");
var IpcServer = class {
  server = null;
  socketPath;
  handler;
  log;
  constructor(socketPath, handler, log) {
    this.socketPath = socketPath;
    this.handler = handler;
    this.log = log;
  }
  /** Start listening. Cleans up stale socket first. */
  start() {
    return new Promise((resolve, reject) => {
      if ((0, import_node_fs.existsSync)(this.socketPath)) {
        this.log.debug("Removing stale socket file");
        try {
          (0, import_node_fs.unlinkSync)(this.socketPath);
        } catch (err) {
          this.log.warn(`Failed to remove stale socket: ${err}`);
        }
      }
      this.server = net.createServer((conn) => this.handleConnection(conn));
      this.server.on("error", (err) => {
        this.log.error(`IPC server error: ${err}`);
        reject(err);
      });
      this.server.listen(this.socketPath, () => {
        this.log.info(`IPC server listening on ${this.socketPath}`);
        resolve();
      });
    });
  }
  /** Handle a single client connection */
  handleConnection(conn) {
    let buffer = "";
    conn.on("data", (data) => {
      buffer += data.toString();
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        this.processMessage(line, conn);
      }
    });
    conn.on("error", (err) => {
      if (err.code === "ECONNRESET") return;
      this.log.debug(`IPC client error: ${err}`);
    });
  }
  /** Parse and handle a single JSON message */
  async processMessage(line, conn) {
    let cmd;
    try {
      cmd = JSON.parse(line);
    } catch {
      this.sendResponse(conn, { ok: false, error: "Invalid JSON" });
      return;
    }
    try {
      const response = await this.handler(cmd);
      this.sendResponse(conn, response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.sendResponse(conn, { ok: false, error: msg });
    }
  }
  /** Send a response back to the client */
  sendResponse(conn, response) {
    try {
      conn.write(JSON.stringify(response) + "\n");
    } catch {
    }
  }
  /** Stop the server and clean up the socket file */
  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    try {
      if ((0, import_node_fs.existsSync)(this.socketPath)) {
        (0, import_node_fs.unlinkSync)(this.socketPath);
      }
    } catch {
    }
    this.log.info("IPC server stopped");
  }
};
var IpcClient = class {
  socketPath;
  constructor(socketPath) {
    this.socketPath = socketPath;
  }
  /** Check if the daemon is running (socket exists and is connectable) */
  async isRunning() {
    if (!(0, import_node_fs.existsSync)(this.socketPath)) return false;
    try {
      const resp = await this.send({ cmd: "status" }, 3e3);
      return resp.ok;
    } catch {
      try {
        (0, import_node_fs.unlinkSync)(this.socketPath);
      } catch {
      }
      return false;
    }
  }
  /** Send a command to the daemon and return the response */
  send(cmd, timeoutMs = 3e4) {
    return new Promise((resolve, reject) => {
      const conn = net.createConnection(this.socketPath);
      let buffer = "";
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          conn.destroy();
          reject(new Error("IPC request timed out"));
        }
      }, timeoutMs);
      conn.on("connect", () => {
        conn.write(JSON.stringify(cmd) + "\n");
      });
      conn.on("data", (data) => {
        buffer += data.toString();
        const newlineIdx = buffer.indexOf("\n");
        if (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          clearTimeout(timer);
          resolved = true;
          conn.end();
          try {
            resolve(JSON.parse(line));
          } catch {
            reject(new Error(`Invalid response: ${line}`));
          }
        }
      });
      conn.on("error", (err) => {
        if (!resolved) {
          clearTimeout(timer);
          resolved = true;
          conn.destroy();
          reject(err);
        }
      });
      conn.on("close", () => {
        if (!resolved) {
          clearTimeout(timer);
          resolved = true;
          reject(new Error("Connection closed before response"));
        }
      });
    });
  }
};

// src/daemon.ts
var import_node_child_process6 = require("node:child_process");
var import_node_fs9 = require("node:fs");
var import_node_path4 = require("node:path");

// src/config.ts
var import_node_fs2 = require("node:fs");
var CONFIG_PATHS = [
  "$HOME/.config/tmx/tmx.toml",
  "$HOME/.termux/tmx.toml"
];
function expandEnvVars(input) {
  return input.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_match, braced, unbraced) => {
      const varName = braced ?? unbraced;
      return process.env[varName] ?? "";
    }
  );
}
function expandDeep(obj) {
  if (typeof obj === "string") return expandEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(expandDeep);
  if (obj !== null && typeof obj === "object") {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = expandDeep(v);
    }
    return result;
  }
  return obj;
}
function parseTOML(content) {
  const g = globalThis;
  if (g.Bun != null) {
    const bun = g.Bun;
    if (typeof bun.TOML === "object" && bun.TOML !== null) {
      const toml = bun.TOML;
      return toml.parse(content);
    }
  }
  return parseTomlMinimal(content);
}
function parseTomlMinimal(content) {
  const root = {};
  let currentSection = root;
  let currentPath = [];
  let isArrayTable = false;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const arrayMatch = line.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayMatch) {
      isArrayTable = true;
      currentPath = arrayMatch[1].split(".");
      const newItem = {};
      let target = root;
      for (let i = 0; i < currentPath.length - 1; i++) {
        if (!(currentPath[i] in target)) target[currentPath[i]] = {};
        target = target[currentPath[i]];
      }
      const key = currentPath[currentPath.length - 1];
      if (!(key in target)) target[key] = [];
      target[key].push(newItem);
      currentSection = newItem;
      continue;
    }
    const tableMatch = line.match(/^\[([^\]]+)\]$/);
    if (tableMatch) {
      isArrayTable = false;
      currentPath = tableMatch[1].split(".");
      if (currentPath[0] === "session" && currentPath.length > 1) {
        const sessions = root["session"];
        if (sessions && sessions.length > 0) {
          const lastSession = sessions[sessions.length - 1];
          const subKey = currentPath.slice(1).join(".");
          if (!(subKey in lastSession)) lastSession[subKey] = {};
          currentSection = lastSession[subKey];
          continue;
        }
      }
      let target = root;
      for (const segment of currentPath) {
        if (!(segment in target)) target[segment] = {};
        target = target[segment];
      }
      currentSection = target;
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      currentSection[key] = parseTomlValue(rawValue.trim());
    }
  }
  return root;
}
function parseTomlValue(raw) {
  if (raw.startsWith('"') && raw.endsWith('"') || raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1);
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.startsWith("[")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => parseTomlValue(s.trim()));
  }
  const num = Number(raw);
  if (!isNaN(num)) return num;
  return raw;
}
var ConfigError = class extends Error {
  constructor(path, message) {
    super(`Config error at '${path}': ${message}`);
    this.path = path;
    this.name = "ConfigError";
  }
};
var VALID_SESSION_TYPES = ["claude", "daemon", "service"];
var VALID_WAKE_POLICIES = ["always", "active_sessions", "boot_only", "never"];
var VALID_HEALTH_CHECKS = ["tmux_alive", "http", "process", "custom"];
var NAME_PATTERN = /^[a-z0-9-]+$/;
function validateConfig(raw) {
  const errors = [];
  const orc = raw.orchestrator ?? {};
  const orchestrator = {
    socket: asString(
      orc.socket,
      "orchestrator.socket",
      `${process.env.PREFIX ?? "/data/data/com.termux/files/usr"}/tmp/tmx.sock`
    ),
    state_file: asString(
      orc.state_file,
      "orchestrator.state_file",
      `${process.env.HOME}/.local/share/tmx/state.json`
    ),
    log_dir: asString(
      orc.log_dir,
      "orchestrator.log_dir",
      `${process.env.HOME}/.local/share/tmx/logs`
    ),
    health_interval_s: asNumber(orc.health_interval_s, "orchestrator.health_interval_s", 120),
    boot_timeout_s: asNumber(orc.boot_timeout_s, "orchestrator.boot_timeout_s", 300),
    process_budget: asNumber(orc.process_budget, "orchestrator.process_budget", 32),
    wake_lock_policy: asEnum(
      orc.wake_lock_policy,
      VALID_WAKE_POLICIES,
      "orchestrator.wake_lock_policy",
      "active_sessions"
    ),
    dashboard_port: asNumber(orc.dashboard_port, "orchestrator.dashboard_port", 18970),
    memory_warning_mb: asNumber(orc.memory_warning_mb, "orchestrator.memory_warning_mb", 1500),
    memory_critical_mb: asNumber(orc.memory_critical_mb, "orchestrator.memory_critical_mb", 800),
    memory_emergency_mb: asNumber(orc.memory_emergency_mb, "orchestrator.memory_emergency_mb", 500)
  };
  const adbRaw = raw.adb ?? {};
  const adb = {
    enabled: asBool(adbRaw.enabled, "adb.enabled", true),
    connect_script: asString(
      adbRaw.connect_script,
      "adb.connect_script",
      `${process.env.HOME}/git/termux-tools/tools/adb-wireless-connect.sh`
    ),
    connect_timeout_s: asNumber(adbRaw.connect_timeout_s, "adb.connect_timeout_s", 45),
    retry_interval_s: asNumber(adbRaw.retry_interval_s, "adb.retry_interval_s", 300),
    phantom_fix: asBool(adbRaw.phantom_fix, "adb.phantom_fix", true),
    boot_delay_s: asNumber(adbRaw.boot_delay_s, "adb.boot_delay_s", 15)
  };
  const hdRaw = raw.health_defaults ?? {};
  const health_defaults = {};
  for (const type of VALID_SESSION_TYPES) {
    const hd = hdRaw[type] ?? {};
    health_defaults[type] = {
      check: asEnum(hd.check, VALID_HEALTH_CHECKS, `health_defaults.${type}.check`, "tmux_alive"),
      unhealthy_threshold: asNumber(hd.unhealthy_threshold, `health_defaults.${type}.unhealthy_threshold`, 2),
      interval_s: hd.interval_s != null ? asNumber(hd.interval_s, `health_defaults.${type}.interval_s`, 120) : void 0
    };
  }
  const sessionRaw = raw.session ?? [];
  const sessions = [];
  const seenNames = /* @__PURE__ */ new Set();
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
    const type = asEnum(s.type, VALID_SESSION_TYPES, `${prefix}.type`, "claude");
    const path = s.path != null ? asString(s.path, `${prefix}.path`, "") : void 0;
    if ((type === "claude" || type === "daemon") && !path) {
      errors.push(`${prefix}: 'path' is required for type '${type}'`);
    }
    const command2 = s.command != null ? asString(s.command, `${prefix}.command`, "") : void 0;
    if ((type === "service" || type === "daemon") && !command2) {
      if (type === "service") {
        errors.push(`${prefix}: 'command' is required for type 'service'`);
      }
    }
    let health;
    const hRaw = s.health;
    if (hRaw) {
      health = {
        check: asEnum(hRaw.check, VALID_HEALTH_CHECKS, `${prefix}.health.check`, "tmux_alive"),
        unhealthy_threshold: asNumber(hRaw.unhealthy_threshold, `${prefix}.health.unhealthy_threshold`, 2),
        interval_s: hRaw.interval_s != null ? asNumber(hRaw.interval_s, `${prefix}.health.interval_s`, 120) : void 0,
        url: hRaw.url != null ? asString(hRaw.url, `${prefix}.health.url`, "") : void 0,
        process_pattern: hRaw.process_pattern != null ? asString(hRaw.process_pattern, `${prefix}.health.process_pattern`, "") : void 0,
        command: hRaw.command != null ? asString(hRaw.command, `${prefix}.health.command`, "") : void 0
      };
    }
    const env = s.env ?? {};
    sessions.push({
      name,
      type,
      path,
      command: command2,
      auto_go: asBool(s.auto_go, `${prefix}.auto_go`, false),
      priority: asNumber(s.priority, `${prefix}.priority`, 10),
      depends_on: asStringArray(s.depends_on, `${prefix}.depends_on`, []),
      headless: asBool(s.headless, `${prefix}.headless`, false),
      env,
      health,
      max_restarts: asNumber(s.max_restarts, `${prefix}.max_restarts`, 3),
      restart_backoff_s: asNumber(s.restart_backoff_s, `${prefix}.restart_backoff_s`, 5),
      enabled: asBool(s.enabled, `${prefix}.enabled`, true)
    });
  }
  for (const session of sessions) {
    for (const dep of session.depends_on) {
      if (!seenNames.has(dep)) {
        errors.push(`session '${session.name}': depends_on '${dep}' does not exist`);
      }
    }
  }
  const enabledCount = sessions.filter((s) => s.enabled).length;
  if (orchestrator.process_budget < enabledCount + 5) {
    errors.push(
      `orchestrator.process_budget (${orchestrator.process_budget}) must be >= enabled sessions (${enabledCount}) + 5 overhead`
    );
  }
  if (errors.length > 0) {
    throw new Error(`Config validation failed:
  ${errors.join("\n  ")}`);
  }
  return { orchestrator, adb, sessions, health_defaults };
}
function asString(val, path, fallback) {
  if (val == null) return fallback;
  if (typeof val === "string") return val;
  return String(val);
}
function asNumber(val, path, fallback) {
  if (val == null) return fallback;
  const n = Number(val);
  if (isNaN(n)) throw new ConfigError(path, `expected number, got '${val}'`);
  return n;
}
function asBool(val, path, fallback) {
  if (val == null) return fallback;
  if (typeof val === "boolean") return val;
  if (val === "true") return true;
  if (val === "false") return false;
  throw new ConfigError(path, `expected boolean, got '${val}'`);
}
function asEnum(val, valid, path, fallback) {
  if (val == null) return fallback;
  const s = String(val);
  if (valid.includes(s)) return s;
  throw new ConfigError(path, `must be one of: ${valid.join(", ")} (got '${s}')`);
}
function asStringArray(val, path, fallback) {
  if (val == null) return fallback;
  if (Array.isArray(val)) return val.map(String);
  throw new ConfigError(path, `expected array, got '${typeof val}'`);
}
function findConfigPath(explicit) {
  if (explicit) {
    const expanded = expandEnvVars(explicit);
    return (0, import_node_fs2.existsSync)(expanded) ? expanded : null;
  }
  for (const p of CONFIG_PATHS) {
    const expanded = expandEnvVars(p);
    if ((0, import_node_fs2.existsSync)(expanded)) return expanded;
  }
  return null;
}
function loadConfig(configPath) {
  const path = findConfigPath(configPath);
  if (!path) {
    throw new Error(
      `Config file not found. Searched:
  ${CONFIG_PATHS.map(expandEnvVars).join("\n  ")}
Copy tmx.toml.example to ~/.config/tmx/tmx.toml to get started.`
    );
  }
  const content = (0, import_node_fs2.readFileSync)(path, "utf-8");
  const raw = parseTOML(content);
  const expanded = expandDeep(raw);
  return validateConfig(expanded);
}
function validateConfigFile(configPath) {
  try {
    const content = (0, import_node_fs2.readFileSync)(configPath, "utf-8");
    const raw = parseTOML(content);
    const expanded = expandDeep(raw);
    validateConfig(expanded);
    return [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.split("\n").filter(Boolean);
  }
}
function getHealthConfig(session, defaults) {
  const typeDefault = defaults[session.type] ?? {
    check: "tmux_alive",
    unhealthy_threshold: 2
  };
  if (session.health) {
    return { ...typeDefault, ...session.health };
  }
  return typeDefault;
}

// src/log.ts
var import_node_fs3 = require("node:fs");
var MAX_LOG_SIZE = 5 * 1024 * 1024;
var MAX_ROTATED = 3;
var LEVEL_COLORS = {
  debug: "\x1B[90m",
  // gray
  info: "\x1B[36m",
  // cyan
  warn: "\x1B[33m",
  // yellow
  error: "\x1B[31m"
  // red
};
var RESET = "\x1B[0m";
var DIM = "\x1B[2m";
var Logger = class {
  logFile;
  logDir;
  verbose;
  constructor(logDir, verbose = false) {
    this.logDir = logDir;
    this.logFile = `${logDir}/tmx.jsonl`;
    this.verbose = verbose;
    if (!(0, import_node_fs3.existsSync)(logDir)) {
      (0, import_node_fs3.mkdirSync)(logDir, { recursive: true });
    }
  }
  /** Log at debug level */
  debug(msg, extra) {
    this.log("debug", msg, extra);
  }
  /** Log at info level */
  info(msg, extra) {
    this.log("info", msg, extra);
  }
  /** Log at warn level */
  warn(msg, extra) {
    this.log("warn", msg, extra);
  }
  /** Log at error level */
  error(msg, extra) {
    this.log("error", msg, extra);
  }
  /** Set verbose mode (show debug messages on stderr) */
  setVerbose(v) {
    this.verbose = v;
  }
  /** Write a structured log entry */
  log(level, msg, extra) {
    const entry = {
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      msg,
      ...extra
    };
    this.writeToFile(entry);
    if (level !== "debug" || this.verbose) {
      this.writeToStderr(entry);
    }
  }
  /** Append a JSONL line to the log file, rotating if needed */
  writeToFile(entry) {
    try {
      this.rotateIfNeeded();
      (0, import_node_fs3.appendFileSync)(this.logFile, JSON.stringify(entry) + "\n");
    } catch {
      process.stderr.write(`[log-write-error] ${JSON.stringify(entry)}
`);
    }
  }
  /** Print a human-readable log line to stderr */
  writeToStderr(entry) {
    const color = LEVEL_COLORS[entry.level] ?? "";
    const time = entry.ts.slice(11, 23);
    const levelTag = entry.level.toUpperCase().padEnd(5);
    const sessionTag = entry.session ? ` ${DIM}[${entry.session}]${RESET}` : "";
    const extras = [];
    for (const [k, v] of Object.entries(entry)) {
      if (k === "ts" || k === "level" || k === "msg" || k === "session") continue;
      extras.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
    const extraStr = extras.length > 0 ? ` ${DIM}${extras.join(" ")}${RESET}` : "";
    process.stderr.write(
      `${DIM}${time}${RESET} ${color}${levelTag}${RESET}${sessionTag} ${entry.msg}${extraStr}
`
    );
  }
  /** Rotate log file if it exceeds MAX_LOG_SIZE */
  rotateIfNeeded() {
    try {
      if (!(0, import_node_fs3.existsSync)(this.logFile)) return;
      const { size } = (0, import_node_fs3.statSync)(this.logFile);
      if (size < MAX_LOG_SIZE) return;
      for (let i = MAX_ROTATED - 1; i >= 1; i--) {
        const from = `${this.logFile}.${i}`;
        const to = `${this.logFile}.${i + 1}`;
        if ((0, import_node_fs3.existsSync)(from)) {
          (0, import_node_fs3.renameSync)(from, to);
        }
      }
      (0, import_node_fs3.renameSync)(this.logFile, `${this.logFile}.1`);
    } catch {
    }
  }
  /** Read the last N lines from the log file (for `tmx logs`) */
  readTail(lines, sessionFilter) {
    try {
      if (!(0, import_node_fs3.existsSync)(this.logFile)) return [];
      const content = (0, import_node_fs3.readFileSync)(this.logFile, "utf-8");
      const allLines = content.trim().split("\n").filter(Boolean);
      let entries = allLines.map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter((e) => e !== null);
      if (sessionFilter) {
        entries = entries.filter((e) => e.session === sessionFilter);
      }
      return entries.slice(-lines);
    } catch {
      return [];
    }
  }
};

// src/state.ts
var import_node_fs4 = require("node:fs");
var import_node_path = require("node:path");

// src/types.ts
var VALID_TRANSITIONS = {
  pending: ["waiting", "stopped"],
  waiting: ["starting", "stopped"],
  starting: ["running", "failed", "stopping"],
  running: ["degraded", "stopping", "stopped"],
  degraded: ["starting", "stopping", "failed"],
  failed: ["stopping", "stopped", "pending"],
  stopping: ["stopped"],
  stopped: ["pending"]
};

// src/state.ts
function newSessionState(name) {
  return {
    name,
    status: "pending",
    uptime_start: null,
    restart_count: 0,
    last_error: null,
    last_health_check: null,
    consecutive_failures: 0,
    tmux_pid: null,
    rss_mb: null,
    activity: null
  };
}
function newDaemonState() {
  return {
    daemon_start: (/* @__PURE__ */ new Date()).toISOString(),
    boot_complete: false,
    adb_fixed: false,
    sessions: {}
  };
}
var StateManager = class {
  state;
  statePath;
  log;
  constructor(statePath, log) {
    this.statePath = statePath;
    this.log = log;
    const dir = (0, import_node_path.dirname)(statePath);
    if (!(0, import_node_fs4.existsSync)(dir)) {
      (0, import_node_fs4.mkdirSync)(dir, { recursive: true });
    }
    this.state = this.loadFromDisk();
  }
  /** Get the full state snapshot */
  getState() {
    return this.state;
  }
  /** Get state for a specific session */
  getSession(name) {
    return this.state.sessions[name];
  }
  /** Initialize session states from config, preserving existing entries */
  initFromConfig(sessions) {
    for (const session of sessions) {
      if (!this.state.sessions[session.name]) {
        this.state.sessions[session.name] = newSessionState(session.name);
      }
    }
    for (const name of Object.keys(this.state.sessions)) {
      if (!sessions.find((s) => s.name === name)) {
        this.log.info(`Removing stale state for session '${name}'`, { session: name });
        delete this.state.sessions[name];
      }
    }
    this.persist();
  }
  /** Transition a session to a new status with validation */
  transition(name, to, error) {
    const session = this.state.sessions[name];
    if (!session) {
      this.log.error(`Cannot transition unknown session '${name}'`, { session: name });
      return false;
    }
    const from = session.status;
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed?.includes(to)) {
      this.log.warn(`Invalid transition ${from} \u2192 ${to} for '${name}'`, { session: name });
      return false;
    }
    session.status = to;
    switch (to) {
      case "running":
        session.uptime_start = (/* @__PURE__ */ new Date()).toISOString();
        session.consecutive_failures = 0;
        session.last_error = null;
        break;
      case "starting":
        if (from === "degraded") {
          session.restart_count++;
        }
        break;
      case "failed":
        session.last_error = error ?? "Unknown failure";
        session.uptime_start = null;
        break;
      case "stopped":
        session.uptime_start = null;
        break;
      case "pending":
        session.restart_count = 0;
        session.consecutive_failures = 0;
        session.last_error = null;
        break;
    }
    this.log.info(`${name}: ${from} \u2192 ${to}${error ? ` (${error})` : ""}`, { session: name });
    this.persist();
    return true;
  }
  /** Record a health check result */
  recordHealthCheck(name, healthy, message) {
    const session = this.state.sessions[name];
    if (!session) return;
    session.last_health_check = (/* @__PURE__ */ new Date()).toISOString();
    if (healthy) {
      session.consecutive_failures = 0;
    } else {
      session.consecutive_failures++;
      session.last_error = message ?? "Health check failed";
    }
    this.persist();
  }
  /** Mark the boot sequence as complete */
  setBootComplete(complete) {
    this.state.boot_complete = complete;
    this.persist();
  }
  /** Mark ADB fix status */
  setAdbFixed(fixed) {
    this.state.adb_fixed = fixed;
    this.persist();
  }
  /** Update daemon start time (e.g., on daemon restart) */
  resetDaemonStart() {
    this.state.daemon_start = (/* @__PURE__ */ new Date()).toISOString();
    this.persist();
  }
  /** Set tmux PID for a session */
  setTmuxPid(name, pid) {
    const session = this.state.sessions[name];
    if (session) {
      session.tmux_pid = pid;
      this.persist();
    }
  }
  /** Update memory/activity metrics for a session (does not persist — transient data) */
  updateSessionMetrics(name, rss_mb, activity) {
    const session = this.state.sessions[name];
    if (session) {
      session.rss_mb = rss_mb;
      session.activity = activity;
    }
  }
  /** Update system memory snapshot (transient, not persisted) */
  updateSystemMemory(memory) {
    this.state.memory = memory;
  }
  /** Force-set a session's status (for adoption/reconciliation) */
  forceStatus(name, status) {
    const session = this.state.sessions[name];
    if (!session) return;
    session.status = status;
    this.persist();
  }
  // -- Persistence ------------------------------------------------------------
  loadFromDisk() {
    try {
      if ((0, import_node_fs4.existsSync)(this.statePath)) {
        const content = (0, import_node_fs4.readFileSync)(this.statePath, "utf-8");
        const parsed = JSON.parse(content);
        if (parsed.daemon_start && parsed.sessions) {
          return parsed;
        }
      }
    } catch (err) {
      this.log.warn(`Failed to load state from ${this.statePath}, starting fresh`, {
        error: String(err)
      });
    }
    return newDaemonState();
  }
  /** Write state to disk atomically (write to .tmp then rename) */
  persist() {
    try {
      const tmp = `${this.statePath}.tmp`;
      (0, import_node_fs4.writeFileSync)(tmp, JSON.stringify(this.state, null, 2) + "\n");
      (0, import_node_fs4.renameSync)(tmp, this.statePath);
    } catch (err) {
      this.log.error(`Failed to persist state: ${err}`);
    }
  }
};

// src/budget.ts
var import_node_child_process = require("node:child_process");
var WARNING_PCT = 70;
var CRITICAL_PCT = 90;
var BudgetTracker = class {
  budget;
  log;
  lastStatus = null;
  constructor(budget, log) {
    this.budget = budget;
    this.log = log;
  }
  /** Get current process count for the Termux UID (our app sandbox) */
  getProcessCount() {
    try {
      const uid = String(process.getuid());
      const output = (0, import_node_child_process.execSync)(`ps -e -o uid=,pid= 2>/dev/null | awk '$1 == ${uid}' | wc -l`, {
        encoding: "utf-8",
        timeout: 5e3
      }).trim();
      return parseInt(output, 10) || 0;
    } catch {
      try {
        const uid = String(process.getuid());
        const output = (0, import_node_child_process.execSync)(
          `ls -ldn /proc/[0-9]* 2>/dev/null | awk '$3 == ${uid}' | wc -l`,
          { encoding: "utf-8", timeout: 5e3 }
        ).trim();
        return parseInt(output, 10) || 0;
      } catch {
        this.log.warn("Failed to count processes, assuming 0");
        return 0;
      }
    }
  }
  /** Determine budget mode from process count */
  computeMode(count) {
    const pct = count / this.budget * 100;
    if (pct >= CRITICAL_PCT) return "critical";
    if (pct >= WARNING_PCT) return "warning";
    return "normal";
  }
  /** Get current budget status */
  check() {
    const total_procs = this.getProcessCount();
    const usage_pct = Math.round(total_procs / this.budget * 100);
    const mode = this.computeMode(total_procs);
    const status = {
      mode,
      total_procs,
      budget: this.budget,
      usage_pct
    };
    if (this.lastStatus && this.lastStatus.mode !== mode) {
      const logFn = mode === "critical" ? "error" : mode === "warning" ? "warn" : "info";
      this.log[logFn](`Process budget: ${this.lastStatus.mode} \u2192 ${mode}`, {
        total_procs,
        budget: this.budget,
        usage_pct
      });
    }
    this.lastStatus = status;
    return status;
  }
  /** Check if we can safely start another session */
  canStartSession() {
    const status = this.check();
    return status.mode !== "critical";
  }
  /** Update the budget limit (e.g., from config reload) */
  setBudget(budget) {
    this.budget = budget;
  }
};

// src/wake.ts
var import_node_child_process2 = require("node:child_process");
var WakeLockManager = class {
  policy;
  held = false;
  log;
  constructor(policy, log) {
    this.policy = policy;
    this.log = log;
  }
  /** Acquire the wake lock if not already held */
  acquire() {
    if (this.held) return;
    try {
      (0, import_node_child_process2.execSync)("termux-wake-lock", { timeout: 5e3, stdio: "ignore" });
      this.held = true;
      this.log.info("Wake lock acquired");
    } catch (err) {
      this.log.error(`Failed to acquire wake lock: ${err}`);
    }
  }
  /** Release the wake lock if held */
  release() {
    if (!this.held) return;
    try {
      (0, import_node_child_process2.execSync)("termux-wake-unlock", { timeout: 5e3, stdio: "ignore" });
      this.held = false;
      this.log.info("Wake lock released");
    } catch (err) {
      this.log.error(`Failed to release wake lock: ${err}`);
    }
  }
  /** Whether the wake lock is currently held */
  isHeld() {
    return this.held;
  }
  /** Evaluate the policy and acquire/release accordingly */
  evaluate(phase, sessions) {
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
  forceRelease() {
    this.release();
  }
};

// src/deps.ts
var CycleError = class extends Error {
  constructor(cycle) {
    super(`Dependency cycle detected: ${cycle.join(" \u2192 ")}`);
    this.cycle = cycle;
    this.name = "CycleError";
  }
};
function computeStartupOrder(sessions) {
  const enabled = sessions.filter((s) => s.enabled);
  const nameSet = new Set(enabled.map((s) => s.name));
  const adj = /* @__PURE__ */ new Map();
  const inDegree = /* @__PURE__ */ new Map();
  for (const s of enabled) {
    adj.set(s.name, []);
    inDegree.set(s.name, 0);
  }
  for (const s of enabled) {
    for (const dep of s.depends_on) {
      if (!nameSet.has(dep)) continue;
      adj.get(dep).push(s.name);
      inDegree.set(s.name, (inDegree.get(s.name) ?? 0) + 1);
    }
  }
  const batches = [];
  const processed = /* @__PURE__ */ new Set();
  let queue = enabled.filter((s) => (inDegree.get(s.name) ?? 0) === 0).map((s) => s.name);
  let depth = 0;
  while (queue.length > 0) {
    const byPriority = new Map(enabled.map((s) => [s.name, s.priority]));
    queue.sort((a, b) => (byPriority.get(a) ?? 10) - (byPriority.get(b) ?? 10));
    batches.push({ depth, sessions: [...queue] });
    const nextQueue = [];
    for (const name of queue) {
      processed.add(name);
      for (const dependent of adj.get(name) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          nextQueue.push(dependent);
        }
      }
    }
    queue = nextQueue;
    depth++;
  }
  if (processed.size < enabled.length) {
    const remaining = enabled.filter((s) => !processed.has(s.name)).map((s) => s.name);
    throw new CycleError(remaining);
  }
  return batches;
}
function computeShutdownOrder(sessions) {
  const startOrder = computeStartupOrder(sessions);
  return startOrder.reverse().map((batch, i) => ({
    ...batch,
    depth: i
  }));
}

// src/health.ts
var import_node_child_process4 = require("node:child_process");

// src/session.ts
var import_node_child_process3 = require("node:child_process");
var import_node_fs5 = require("node:fs");
var import_node_path2 = require("node:path");
function resolveTermuxBin(name) {
  const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
  const candidate = (0, import_node_path2.join)(prefix, "bin", name);
  try {
    if ((0, import_node_fs5.existsSync)(candidate)) return candidate;
  } catch {
  }
  return name;
}
var TERMUX_AM_BIN = resolveTermuxBin("termux-am");
var AM_BIN = resolveTermuxBin("am");
var TMUX_BIN = resolveTermuxBin("tmux");
function amEnv() {
  const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
  const ldPreload = (0, import_node_path2.join)(prefix, "lib", "libtermux-exec-ld-preload.so");
  return { ...process.env, LD_PRELOAD: ldPreload };
}
var CLAUDE_READY_TIMEOUT = 6e4;
var CLAUDE_POLL_INTERVAL = 500;
var CLAUDE_READY_PATTERNS = [
  />\s*$/,
  // prompt indicator
  /\$\s*$/,
  // shell prompt (fallback)
  /claude\s*>/i,
  // claude prompt
  /\?\s*$/
  // question mark prompt (e.g., "What would you like to do?")
];
var GO_SEND_DELAY = 500;
function cleanEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  for (const key of Object.keys(env)) {
    if (key.startsWith("CLAUDE_CODE_") || key.startsWith("CLAUDE_TMPDIR")) {
      delete env[key];
    }
  }
  for (const key of Object.keys(env)) {
    if (key.startsWith("ENABLE_CLAUDE_CODE_")) {
      delete env[key];
    }
  }
  return env;
}
var _cleanEnv = null;
function getCleanEnv() {
  if (!_cleanEnv) _cleanEnv = cleanEnv();
  return _cleanEnv;
}
function tmux(...args2) {
  try {
    const result = (0, import_node_child_process3.spawnSync)(TMUX_BIN, args2, {
      encoding: "utf-8",
      timeout: 1e4,
      stdio: ["ignore", "pipe", "pipe"],
      env: getCleanEnv()
    });
    if (result.status !== 0) return null;
    return (result.stdout ?? "").trim();
  } catch {
    return null;
  }
}
function isTmuxServerAlive() {
  const result = (0, import_node_child_process3.spawnSync)(TMUX_BIN, ["start-server"], {
    timeout: 5e3,
    stdio: "ignore",
    env: getCleanEnv()
  });
  return result.status === 0;
}
function listTmuxSessions() {
  const output = tmux("list-sessions", "-F", "#{session_name}");
  if (!output) return [];
  return output.split("\n").map((s) => s.trim()).filter(Boolean);
}
function sessionExists(name) {
  const result = (0, import_node_child_process3.spawnSync)(TMUX_BIN, ["has-session", "-t", name], {
    timeout: 5e3,
    stdio: "ignore",
    env: getCleanEnv()
  });
  return result.status === 0;
}
function capturePane(sessionName, _lines = 5) {
  const output = tmux("capture-pane", "-t", sessionName, "-p");
  return output ?? "";
}
function sendKeys(sessionName, text, pressEnter = true) {
  const args2 = ["send-keys", "-t", sessionName, text];
  if (pressEnter) args2.push("Enter");
  return tmux(...args2) !== null;
}
function createSession(config, log) {
  const { name, type, path, command: command2, env } = config;
  const envPrefix = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ");
  if (sessionExists(name)) {
    log.info(`Session '${name}' already exists in tmux, skipping create`, { session: name });
    return true;
  }
  const createArgs = ["new-session", "-d", "-s", name];
  if (path) {
    createArgs.push("-c", path);
  }
  const result = (0, import_node_child_process3.spawnSync)(TMUX_BIN, createArgs, {
    timeout: 1e4,
    stdio: "ignore",
    env: getCleanEnv()
  });
  if (result.status !== 0) {
    log.error(`Failed to create tmux session '${name}'`, { session: name });
    return false;
  }
  log.info(`Created tmux session '${name}'`, { session: name, type, path });
  tmux("set-option", "-g", "set-titles", "on");
  tmux("set-option", "-g", "set-titles-string", "#S");
  switch (type) {
    case "claude":
      sendKeys(name, "node $(readlink -f $(which claude)) --dangerously-skip-permissions", true);
      break;
    case "daemon":
      if (command2) {
        const fullCmd = envPrefix ? `${envPrefix} ${command2}` : command2;
        sendKeys(name, fullCmd, true);
      }
      break;
    case "service":
      if (command2) {
        const fullCmd = envPrefix ? `${envPrefix} ${command2}` : command2;
        sendKeys(name, fullCmd, true);
      }
      break;
  }
  return true;
}
async function waitForClaudeReady(name, log) {
  const start = Date.now();
  while (Date.now() - start < CLAUDE_READY_TIMEOUT) {
    if (!sessionExists(name)) {
      log.warn(`Session '${name}' disappeared while waiting for readiness`, { session: name });
      return "disappeared";
    }
    const pane = capturePane(name, 10);
    for (const pattern of CLAUDE_READY_PATTERNS) {
      if (pattern.test(pane)) {
        const elapsed = Date.now() - start;
        log.debug(`Session '${name}' ready in ${elapsed}ms`, { session: name, elapsed });
        return "ready";
      }
    }
    await sleep(CLAUDE_POLL_INTERVAL);
  }
  log.warn(`Session '${name}' readiness timeout after ${CLAUDE_READY_TIMEOUT}ms`, { session: name });
  return "timeout";
}
async function sendGoToSession(name, log) {
  const result = await waitForClaudeReady(name, log);
  if (result !== "ready") {
    log.warn(`Skipping 'go' for '${name}' \u2014 ${result}`, { session: name });
    return result;
  }
  await sleep(GO_SEND_DELAY);
  if (sendKeys(name, "go", true)) {
    log.info(`Sent 'go' to '${name}'`, { session: name });
    return "ready";
  }
  return "timeout";
}
async function stopSession(name, log, timeoutMs = 1e4) {
  if (!sessionExists(name)) {
    log.debug(`Session '${name}' not running, nothing to stop`, { session: name });
    return true;
  }
  tmux("send-keys", "-t", name, "C-c");
  await sleep(1e3);
  sendKeys(name, "exit", true);
  await sleep(1e3);
  if (sessionExists(name)) {
    log.info(`Force-killing session '${name}'`, { session: name });
    tmux("kill-session", "-t", name);
    await sleep(500);
  }
  const stopped = !sessionExists(name);
  if (stopped) {
    log.info(`Session '${name}' stopped`, { session: name });
  } else {
    log.error(`Failed to stop session '${name}'`, { session: name });
  }
  return stopped;
}
function createTermuxTab(sessionName, log) {
  const env = amEnv();
  tmux("set-option", "-g", "set-titles", "on");
  tmux("set-option", "-g", "set-titles-string", "#S");
  const targetClients = tmux("list-clients", "-t", sessionName, "-F", "#{client_tty}");
  if (targetClients && targetClients.trim().length > 0) {
    log.info(`Session '${sessionName}' already attached, bringing Termux to foreground`, { session: sessionName });
    const clientTty = targetClients.trim().split("\n")[0];
    try {
      (0, import_node_fs5.writeFileSync)(clientTty, `\x1B]0;${sessionName}\x07`);
    } catch {
    }
    const actArgs2 = [
      "start",
      "-a",
      "android.intent.action.MAIN",
      "-c",
      "android.intent.category.LAUNCHER",
      "-n",
      "com.termux/com.termux.app.TermuxActivity"
    ];
    (0, import_node_child_process3.spawnSync)(AM_BIN, actArgs2, { timeout: 3e3, stdio: "ignore", env });
    return true;
  }
  const allClients = tmux("list-clients", "-F", "#{client_name}:#{client_tty}");
  if (allClients && allClients.trim().length > 0) {
    const firstClient = allClients.trim().split("\n")[0];
    const colonIdx = firstClient.indexOf(":");
    const clientName = firstClient.substring(0, colonIdx);
    const clientTty = firstClient.substring(colonIdx + 1);
    const switched = tmux("switch-client", "-c", clientName, "-t", sessionName);
    if (switched !== null) {
      log.info(`Switched client '${clientName}' to session '${sessionName}'`, { session: sessionName });
      tmux("refresh-client", "-c", clientName);
    } else {
      log.warn(`Failed to switch client to '${sessionName}'`, { session: sessionName });
    }
    try {
      (0, import_node_fs5.writeFileSync)(clientTty, `\x1B]0;${sessionName}\x07`);
      log.debug(`Wrote title escape to ${clientTty}`, { session: sessionName });
    } catch {
      log.debug(`Could not write title to ${clientTty}`, { session: sessionName });
    }
  } else {
    log.warn(`No tmux clients found \u2014 open Termux and run: tmux attach -t ${sessionName}`, { session: sessionName });
  }
  const actArgs = [
    "start",
    "-a",
    "android.intent.action.MAIN",
    "-c",
    "android.intent.category.LAUNCHER",
    "-n",
    "com.termux/com.termux.app.TermuxActivity"
  ];
  (0, import_node_child_process3.spawnSync)(AM_BIN, actArgs, { timeout: 3e3, stdio: "ignore", env });
  log.info(`Brought Termux to foreground for '${sessionName}'`, { session: sessionName });
  return true;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/health.ts
function checkSessionHealth(sessionName, healthConfig, log) {
  const start = Date.now();
  try {
    switch (healthConfig.check) {
      case "tmux_alive":
        return tmuxAliveCheck(sessionName, start);
      case "http":
        if (!healthConfig.url) {
          return { session: sessionName, healthy: false, message: "HTTP check missing 'url' config", duration_ms: Date.now() - start };
        }
        return httpCheck(sessionName, healthConfig.url, start);
      case "process":
        if (!healthConfig.process_pattern) {
          return { session: sessionName, healthy: false, message: "Process check missing 'process_pattern' config", duration_ms: Date.now() - start };
        }
        return processCheck(sessionName, healthConfig.process_pattern, start);
      case "custom":
        if (!healthConfig.command) {
          return { session: sessionName, healthy: false, message: "Custom check missing 'command' config", duration_ms: Date.now() - start };
        }
        return customCheck(sessionName, healthConfig.command, start);
      default:
        return {
          session: sessionName,
          healthy: false,
          message: `Unknown check type: ${healthConfig.check}`,
          duration_ms: Date.now() - start
        };
    }
  } catch (err) {
    return {
      session: sessionName,
      healthy: false,
      message: `Health check error: ${err}`,
      duration_ms: Date.now() - start
    };
  }
}
function tmuxAliveCheck(sessionName, startMs) {
  const alive = sessionExists(sessionName);
  return {
    session: sessionName,
    healthy: alive,
    message: alive ? "tmux session alive" : "tmux session not found",
    duration_ms: Date.now() - startMs
  };
}
function httpCheck(sessionName, url, startMs) {
  try {
    const result = (0, import_node_child_process4.spawnSync)("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", url], {
      encoding: "utf-8",
      timeout: 1e4
    });
    const code = parseInt(result.stdout?.trim() ?? "0", 10);
    const healthy = code >= 200 && code < 300;
    return {
      session: sessionName,
      healthy,
      message: healthy ? `HTTP ${code}` : `HTTP ${code} (expected 2xx)`,
      duration_ms: Date.now() - startMs
    };
  } catch (err) {
    return {
      session: sessionName,
      healthy: false,
      message: `HTTP check failed: ${err}`,
      duration_ms: Date.now() - startMs
    };
  }
}
function processCheck(sessionName, pattern, startMs) {
  const result = (0, import_node_child_process4.spawnSync)("pgrep", ["-f", pattern], {
    timeout: 5e3,
    stdio: ["ignore", "pipe", "ignore"]
  });
  const found = result.status === 0;
  return {
    session: sessionName,
    healthy: found,
    message: found ? `Process '${pattern}' found` : `Process '${pattern}' not found`,
    duration_ms: Date.now() - startMs
  };
}
function customCheck(sessionName, command2, startMs) {
  try {
    (0, import_node_child_process4.execSync)(command2, { timeout: 1e4, stdio: "ignore" });
    return {
      session: sessionName,
      healthy: true,
      message: "Custom check passed",
      duration_ms: Date.now() - startMs
    };
  } catch {
    return {
      session: sessionName,
      healthy: false,
      message: "Custom check failed",
      duration_ms: Date.now() - startMs
    };
  }
}
function runHealthSweep(config, state, log) {
  const results = [];
  if (!isTmuxServerAlive()) {
    log.error("Tmux server is not running \u2014 marking all sessions as failed");
    for (const session of config.sessions) {
      const s = state.getSession(session.name);
      if (s && (s.status === "running" || s.status === "degraded" || s.status === "starting")) {
        state.transition(session.name, "failed", "Tmux server not running");
        results.push({
          session: session.name,
          healthy: false,
          message: "Tmux server not running",
          duration_ms: 0
        });
      }
    }
    return results;
  }
  for (const session of config.sessions) {
    const s = state.getSession(session.name);
    if (!s) continue;
    if (s.status !== "running" && s.status !== "degraded") continue;
    const healthConfig = getHealthConfig(session, config.health_defaults);
    const result = checkSessionHealth(session.name, healthConfig, log);
    results.push(result);
    state.recordHealthCheck(session.name, result.healthy, result.message);
    const updated = state.getSession(session.name);
    if (!updated) continue;
    if (result.healthy) {
      if (updated.status === "degraded") {
        state.transition(session.name, "starting");
        log.info(`Session '${session.name}' recovered`, { session: session.name });
      }
    } else {
      log.warn(`Health check failed for '${session.name}': ${result.message}`, {
        session: session.name,
        consecutive_failures: updated.consecutive_failures,
        threshold: healthConfig.unhealthy_threshold
      });
      if (updated.consecutive_failures >= healthConfig.unhealthy_threshold) {
        if (updated.status === "running") {
          state.transition(session.name, "degraded");
        } else if (updated.status === "degraded") {
          if (updated.restart_count >= session.max_restarts) {
            state.transition(
              session.name,
              "failed",
              `Exceeded max restarts (${session.max_restarts})`
            );
          }
        }
      }
    }
  }
  return results;
}

// src/memory.ts
var import_node_fs6 = require("node:fs");
var import_node_child_process5 = require("node:child_process");
var MemoryMonitor = class {
  log;
  warningMb;
  criticalMb;
  emergencyMb;
  constructor(log, warningMb = 1500, criticalMb = 800, emergencyMb = 500) {
    this.log = log;
    this.warningMb = warningMb;
    this.criticalMb = criticalMb;
    this.emergencyMb = emergencyMb;
  }
  /** Update pressure thresholds (e.g. from config reload) */
  setThresholds(warningMb, criticalMb, emergencyMb) {
    this.warningMb = warningMb;
    this.criticalMb = criticalMb;
    this.emergencyMb = emergencyMb;
  }
  /** Read system memory stats from /proc/meminfo */
  getSystemMemory() {
    try {
      const content = (0, import_node_fs6.readFileSync)("/proc/meminfo", "utf-8");
      const fields = /* @__PURE__ */ new Map();
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
      const usedPct = totalMb > 0 ? Math.round((totalMb - availableMb) / totalMb * 100) : 0;
      return {
        total_mb: totalMb,
        available_mb: availableMb,
        swap_total_mb: Math.round(swapTotalKb / 1024),
        swap_free_mb: Math.round(swapFreeKb / 1024),
        pressure: this.classifyPressure(availableMb),
        used_pct: usedPct
      };
    } catch (err) {
      this.log.warn(`Failed to read /proc/meminfo: ${err}`);
      return {
        total_mb: 0,
        available_mb: 0,
        swap_total_mb: 0,
        swap_free_mb: 0,
        pressure: "normal",
        used_pct: 0
      };
    }
  }
  /** Classify pressure from MemAvailable */
  classifyPressure(availableMb) {
    if (availableMb < this.emergencyMb) return "emergency";
    if (availableMb < this.criticalMb) return "critical";
    if (availableMb < this.warningMb) return "warning";
    return "normal";
  }
  /**
   * Get the total RSS for a process tree rooted at the given PID.
   * Sums RSS of the process and all descendants using ps output.
   */
  getProcessTreeRss(rootPid) {
    const entries = this.getAllProcesses();
    const descendants = this.findDescendants(rootPid, entries);
    const root = entries.find((e) => e.pid === rootPid);
    if (root) descendants.push(root);
    const totalKb = descendants.reduce((sum, e) => sum + e.rss_kb, 0);
    return {
      rss_mb: Math.round(totalKb / 1024),
      process_count: descendants.length
    };
  }
  /**
   * Get memory stats for named sessions given their tmux pane PIDs.
   * @param sessions Map of session name → shell PID inside the tmux pane
   */
  getSessionMemory(sessions) {
    const entries = this.getAllProcesses();
    const results = [];
    for (const [name, pid] of sessions) {
      const descendants = this.findDescendants(pid, entries);
      const root = entries.find((e) => e.pid === pid);
      if (root) descendants.push(root);
      const totalKb = descendants.reduce((sum, e) => sum + e.rss_kb, 0);
      results.push({
        name,
        rss_mb: Math.round(totalKb / 1024),
        process_count: descendants.length
      });
    }
    return results;
  }
  /** Get PID of the shell inside a tmux session pane */
  getSessionPid(sessionName) {
    try {
      const output = (0, import_node_child_process5.execSync)(
        `tmux list-panes -t "${sessionName}" -F "#{pane_pid}" 2>/dev/null`,
        { encoding: "utf-8", timeout: 5e3 }
      ).trim();
      const pid = parseInt(output.split("\n")[0], 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }
  /** Parse ps output to get all processes with pid, ppid, rss */
  getAllProcesses() {
    try {
      const output = (0, import_node_child_process5.execSync)("ps -e -o pid=,ppid=,rss= 2>/dev/null", {
        encoding: "utf-8",
        timeout: 5e3
      });
      const entries = [];
      for (const line of output.trim().split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          entries.push({
            pid: parseInt(parts[0], 10),
            ppid: parseInt(parts[1], 10),
            rss_kb: parseInt(parts[2], 10)
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
  findDescendants(rootPid, entries) {
    const children = [];
    const stack = [rootPid];
    while (stack.length > 0) {
      const parent = stack.pop();
      for (const entry of entries) {
        if (entry.ppid === parent && entry.pid !== rootPid) {
          children.push(entry);
          stack.push(entry.pid);
        }
      }
    }
    return children;
  }
};

// src/activity.ts
var import_node_fs7 = require("node:fs");
var IDLE_THRESHOLD = 3;
var ActivityDetector = class {
  log;
  /** Previous CPU tick snapshots keyed by session name */
  snapshots = /* @__PURE__ */ new Map();
  constructor(log) {
    this.log = log;
  }
  /**
   * Classify the activity state of a process.
   * Must be called repeatedly (on each poll interval) for delta computation.
   *
   * @param name Session name (used as key for tracking)
   * @param pid Root PID of the process (tmux pane shell)
   * @returns Activity state classification
   */
  classify(name, pid) {
    const ticks = this.readCpuTicks(pid);
    if (ticks === null) {
      this.snapshots.delete(name);
      return "stopped";
    }
    const prev = this.snapshots.get(name);
    const now = Date.now();
    if (!prev) {
      this.snapshots.set(name, { ticks, ts: now, idle_streak: 0 });
      return "unknown";
    }
    const delta = ticks - prev.ticks;
    if (delta > 0) {
      this.snapshots.set(name, { ticks, ts: now, idle_streak: 0 });
      return "active";
    }
    const newStreak = prev.idle_streak + 1;
    this.snapshots.set(name, { ticks, ts: now, idle_streak: newStreak });
    if (newStreak >= IDLE_THRESHOLD) {
      return "idle";
    }
    return "active";
  }
  /**
   * Classify activity for a process tree (sum ticks of pid + all children).
   * More accurate for sessions that spawn many child processes.
   *
   * @param name Session name
   * @param pid Root PID
   * @returns Activity state
   */
  classifyTree(name, pid) {
    const ticks = this.readTreeCpuTicks(pid);
    if (ticks === null) {
      this.snapshots.delete(name);
      return "stopped";
    }
    const prev = this.snapshots.get(name);
    const now = Date.now();
    if (!prev) {
      this.snapshots.set(name, { ticks, ts: now, idle_streak: 0 });
      return "unknown";
    }
    const delta = ticks - prev.ticks;
    if (delta > 0) {
      this.snapshots.set(name, { ticks, ts: now, idle_streak: 0 });
      return "active";
    }
    const newStreak = prev.idle_streak + 1;
    this.snapshots.set(name, { ticks, ts: now, idle_streak: newStreak });
    return newStreak >= IDLE_THRESHOLD ? "idle" : "active";
  }
  /** Remove tracking state for a session */
  remove(name) {
    this.snapshots.delete(name);
  }
  /**
   * Read utime + stime from /proc/PID/stat.
   * Fields are space-separated; field 14 = utime, field 15 = stime (1-indexed).
   * The comm field (2) can contain spaces within parens, so we parse after ')'.
   */
  readCpuTicks(pid) {
    try {
      const content = (0, import_node_fs7.readFileSync)(`/proc/${pid}/stat`, "utf-8");
      return this.parseCpuTicks(content);
    } catch {
      return null;
    }
  }
  /** Parse utime + stime from a /proc/PID/stat line */
  parseCpuTicks(statLine) {
    const closeParen = statLine.lastIndexOf(")");
    if (closeParen === -1) return null;
    const fields = statLine.slice(closeParen + 2).split(" ");
    const utime = parseInt(fields[11], 10);
    const stime = parseInt(fields[12], 10);
    if (isNaN(utime) || isNaN(stime)) return null;
    return utime + stime;
  }
  /**
   * Sum CPU ticks for a process and all its children.
   * Reads /proc/PID/stat for the root and each child found via ppid matching.
   */
  readTreeCpuTicks(rootPid) {
    const rootTicks = this.readCpuTicks(rootPid);
    if (rootTicks === null) return null;
    let total = rootTicks;
    try {
      const procEntries = (0, import_node_fs7.readdirSync)("/proc").filter((e) => /^\d+$/.test(e));
      const stack = [rootPid];
      const visited = /* @__PURE__ */ new Set([rootPid]);
      while (stack.length > 0) {
        const parent = stack.pop();
        for (const entry of procEntries) {
          const childPid = parseInt(entry, 10);
          if (visited.has(childPid)) continue;
          try {
            const stat = (0, import_node_fs7.readFileSync)(`/proc/${childPid}/stat`, "utf-8");
            const closeParen = stat.lastIndexOf(")");
            if (closeParen === -1) continue;
            const fields = stat.slice(closeParen + 2).split(" ");
            const ppid = parseInt(fields[1], 10);
            if (ppid === parent) {
              visited.add(childPid);
              stack.push(childPid);
              const utime = parseInt(fields[11], 10);
              const stime = parseInt(fields[12], 10);
              if (!isNaN(utime) && !isNaN(stime)) {
                total += utime + stime;
              }
            }
          } catch {
          }
        }
      }
    } catch {
    }
    return total;
  }
};

// src/http.ts
var http = __toESM(require("node:http"));
var import_node_fs8 = require("node:fs");
var import_node_path3 = require("node:path");
var MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf"
};
var DashboardServer = class {
  server = null;
  log;
  port;
  staticDir;
  apiHandler;
  sseClients = [];
  sseIdCounter = 0;
  constructor(port, staticDir, apiHandler, log) {
    this.port = port;
    this.log = log;
    this.staticDir = staticDir;
    this.apiHandler = apiHandler;
  }
  /** Start the HTTP server */
  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.on("error", (err) => {
        this.log.error(`Dashboard server error: ${err}`);
        reject(err);
      });
      this.server.listen(this.port, "0.0.0.0", () => {
        this.log.info(`Dashboard server listening on http://0.0.0.0:${this.port}`);
        resolve();
      });
    });
  }
  /** Stop the HTTP server */
  stop() {
    for (const client of this.sseClients) {
      client.res.end();
    }
    this.sseClients = [];
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
  /** Push an SSE event to all connected clients */
  pushEvent(event, data) {
    const payload = `event: ${event}
data: ${JSON.stringify(data)}

`;
    const dead = [];
    for (const client of this.sseClients) {
      try {
        client.res.write(payload);
      } catch {
        dead.push(client.id);
      }
    }
    if (dead.length > 0) {
      this.sseClients = this.sseClients.filter((c) => !dead.includes(c.id));
    }
  }
  /** Get number of connected SSE clients */
  get sseClientCount() {
    return this.sseClients.length;
  }
  // -- Request handling -------------------------------------------------------
  async handleRequest(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      if (path === "/api/events") {
        this.handleSse(req, res);
        return;
      }
      if (path.startsWith("/api/")) {
        await this.handleApi(req, res, path);
        return;
      }
      this.handleStatic(res, path);
    } catch (err) {
      this.log.error(`HTTP error: ${err}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
  /** Handle SSE connection */
  handleSse(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    const clientId = ++this.sseIdCounter;
    const client = { res, id: clientId };
    this.sseClients.push(client);
    this.log.debug(`SSE client connected (id=${clientId}, total=${this.sseClients.length})`);
    res.write(`event: connected
data: ${JSON.stringify({ id: clientId })}

`);
    req.on("close", () => {
      this.sseClients = this.sseClients.filter((c) => c.id !== clientId);
      this.log.debug(`SSE client disconnected (id=${clientId}, remaining=${this.sseClients.length})`);
    });
  }
  /** Handle API request */
  async handleApi(req, res, path) {
    let body = "";
    if (req.method === "POST") {
      body = await new Promise((resolve) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      });
    }
    const result = await this.apiHandler(req.method ?? "GET", path, body);
    res.writeHead(result.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.data));
  }
  /** Serve static files from the dashboard dist directory */
  handleStatic(res, urlPath) {
    let filePath = urlPath === "/" ? "/index.html" : urlPath;
    filePath = filePath.replace(/\.\./g, "");
    let fullPath = (0, import_node_path3.join)(this.staticDir, filePath);
    if ((0, import_node_fs8.existsSync)(fullPath) && (0, import_node_fs8.statSync)(fullPath).isDirectory()) {
      fullPath = (0, import_node_path3.join)(fullPath, "index.html");
    } else if (!(0, import_node_fs8.existsSync)(fullPath) || !(0, import_node_fs8.statSync)(fullPath).isFile()) {
      const dirIndex = (0, import_node_path3.join)(this.staticDir, filePath, "index.html");
      if ((0, import_node_fs8.existsSync)(dirIndex) && (0, import_node_fs8.statSync)(dirIndex).isFile()) {
        fullPath = dirIndex;
      }
    }
    if (!(0, import_node_fs8.existsSync)(fullPath) || !(0, import_node_fs8.statSync)(fullPath).isFile()) {
      const indexPath = (0, import_node_path3.join)(this.staticDir, "index.html");
      if ((0, import_node_fs8.existsSync)(indexPath)) {
        const content2 = (0, import_node_fs8.readFileSync)(indexPath);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(content2);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(this.getFallbackHtml());
      return;
    }
    const ext = (0, import_node_path3.extname)(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    const content = (0, import_node_fs8.readFileSync)(fullPath);
    const cacheControl = ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl
    });
    res.end(content);
  }
  /** Minimal HTML fallback when dashboard isn't built */
  getFallbackHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>tmx dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
      background: #0d1117; color: #c9d1d9;
      padding: 1rem; max-width: 800px; margin: 0 auto;
    }
    h1 { color: #58a6ff; margin-bottom: 1rem; font-size: 1.2rem; }
    pre { background: #161b22; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; }
    .status { margin: 1rem 0; }
    .green { color: #3fb950; } .yellow { color: #d29922; } .red { color: #f85149; }
    .dim { color: #484f58; }
    #data { white-space: pre-wrap; }
    .err { color: #f85149; font-style: italic; }
  </style>
</head>
<body>
  <h1>tmx dashboard</h1>
  <p class="dim">Dashboard not built. Run: <code>cd orchestrator/dashboard && bun install && bun run build</code></p>
  <div class="status">
    <h2>Live Status</h2>
    <pre id="data">Loading...</pre>
  </div>
  <script>
    async function refresh() {
      try {
        const [status, memory] = await Promise.all([
          fetch('/api/status').then(r => r.json()),
          fetch('/api/memory').then(r => r.json()).catch(() => null),
        ]);
        let out = JSON.stringify(status, null, 2);
        if (memory) out += '\\n\\n--- Memory ---\\n' + JSON.stringify(memory, null, 2);
        document.getElementById('data').textContent = out;
      } catch (e) {
        document.getElementById('data').innerHTML = '<span class="err">Failed to fetch: ' + e.message + '</span>';
      }
    }
    refresh();
    setInterval(refresh, 5000);

    // SSE for real-time updates
    const es = new EventSource('/api/events');
    es.addEventListener('state', () => refresh());
    es.addEventListener('memory', () => refresh());
  </script>
</body>
</html>`;
  }
};

// src/daemon.ts
function sleep2(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function resolveAdbPath() {
  try {
    const result = (0, import_node_child_process6.spawnSync)("which", ["adb"], { encoding: "utf-8", timeout: 3e3 });
    if (result.stdout?.trim()) return result.stdout.trim();
  } catch {
  }
  const candidates = [
    (0, import_node_path4.join)(process.env.PREFIX ?? "/data/data/com.termux/files/usr", "bin", "adb"),
    (0, import_node_path4.join)(process.env.HOME ?? "", "android-sdk", "platform-tools", "adb")
  ];
  for (const p of candidates) {
    try {
      if (require("fs").existsSync(p)) return p;
    } catch {
    }
  }
  return "adb";
}
var ADB_BIN = resolveAdbPath();
function notify(title, content) {
  try {
    (0, import_node_child_process6.spawnSync)("termux-notification", ["--title", title, "--content", content], {
      timeout: 5e3,
      stdio: "ignore"
    });
  } catch {
  }
}
function resolveLocalIp() {
  try {
    const result = (0, import_node_child_process6.spawnSync)("ip", ["route", "get", "1"], {
      encoding: "utf-8",
      timeout: 3e3,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const match = result.stdout?.match(/src\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch {
  }
  try {
    const result = (0, import_node_child_process6.spawnSync)("ifconfig", ["wlan0"], {
      encoding: "utf-8",
      timeout: 3e3,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const match = result.stdout?.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch {
  }
  return null;
}
var Daemon = class _Daemon {
  config;
  log;
  state;
  ipc;
  budget;
  wake;
  memory;
  activity;
  dashboard = null;
  healthTimer = null;
  memoryTimer = null;
  adbRetryTimer = null;
  /** Pending auto-restart timers — tracked so shutdown() can cancel them */
  restartTimers = /* @__PURE__ */ new Set();
  adbSerial = null;
  adbSerialExpiry = 0;
  /** Cached local IP for ADB self-identification */
  localIp = null;
  localIpExpiry = 0;
  static LOCAL_IP_TTL_MS = 6e4;
  running = false;
  constructor(configPath) {
    this.config = loadConfig(configPath);
    this.log = new Logger(this.config.orchestrator.log_dir);
    this.state = new StateManager(this.config.orchestrator.state_file, this.log);
    this.budget = new BudgetTracker(this.config.orchestrator.process_budget, this.log);
    this.wake = new WakeLockManager(this.config.orchestrator.wake_lock_policy, this.log);
    this.memory = new MemoryMonitor(
      this.log,
      this.config.orchestrator.memory_warning_mb,
      this.config.orchestrator.memory_critical_mb,
      this.config.orchestrator.memory_emergency_mb
    );
    this.activity = new ActivityDetector(this.log);
    this.ipc = new IpcServer(
      this.config.orchestrator.socket,
      (cmd) => this.handleIpcCommand(cmd),
      this.log
    );
  }
  /**
   * Pre-flight checks — ensure required directories exist and config is sane.
   * Called at the top of start() so the daemon crashes early with a clear message
   * rather than failing mysteriously later.
   */
  preflight() {
    const { log_dir, state_file, socket } = this.config.orchestrator;
    if (!(0, import_node_fs9.existsSync)(log_dir)) {
      (0, import_node_fs9.mkdirSync)(log_dir, { recursive: true });
      this.log.debug(`Created log directory: ${log_dir}`);
    }
    const stateDir = (0, import_node_path4.dirname)(state_file);
    if (!(0, import_node_fs9.existsSync)(stateDir)) {
      (0, import_node_fs9.mkdirSync)(stateDir, { recursive: true });
      this.log.debug(`Created state directory: ${stateDir}`);
    }
    const socketDir = (0, import_node_path4.dirname)(socket);
    if (!(0, import_node_fs9.existsSync)(socketDir)) {
      (0, import_node_fs9.mkdirSync)(socketDir, { recursive: true });
      this.log.debug(`Created socket directory: ${socketDir}`);
    }
    const enabledCount = this.config.sessions.filter((s) => s.enabled).length;
    if (enabledCount === 0) {
      this.log.warn("No enabled sessions in config");
    }
  }
  /** Start the daemon — main entry point */
  async start() {
    this.preflight();
    this.running = true;
    this.log.info("Daemon starting", {
      sessions: this.config.sessions.length,
      budget: this.config.orchestrator.process_budget,
      wake_policy: this.config.orchestrator.wake_lock_policy
    });
    this.state.resetDaemonStart();
    this.state.initFromConfig(this.config.sessions);
    this.adoptExistingSessions();
    await this.ipc.start();
    this.setupSignalHandlers();
    this.startHealthTimer();
    this.startMemoryTimer();
    await this.startDashboard();
    notify("tmx daemon", "Orchestrator started");
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (!this.running) {
          clearInterval(check);
          resolve();
        }
      }, 1e3);
    });
  }
  /** Full boot sequence: ADB fix → dependency-ordered start → cron */
  async boot() {
    this.log.info("Boot sequence starting");
    this.wake.evaluate("boot_start");
    const bootDeadline = Date.now() + this.config.orchestrator.boot_timeout_s * 1e3;
    if (this.config.adb.enabled) {
      if (!this.state.getState().boot_complete && this.config.adb.boot_delay_s > 0) {
        this.log.info(`Waiting ${this.config.adb.boot_delay_s}s for wireless debugging to initialize`);
        await sleep2(this.config.adb.boot_delay_s * 1e3);
      }
      await this.fixAdb();
    }
    const timedOut = await this.startAllSessions(bootDeadline);
    this.startCron();
    setTimeout(() => {
      try {
        const tabResult = this.cmdTabs();
        if (tabResult.ok) {
          const data = tabResult.data;
          this.log.info(`Auto-tabs: restored=${data.restored} skipped=${data.skipped}`);
        }
      } catch (err) {
        this.log.warn(`Auto-tabs failed: ${err}`);
      }
    }, 3e3);
    this.state.setBootComplete(true);
    this.wake.evaluate("boot_end", this.state.getState().sessions);
    const sessionCount = this.config.sessions.filter((s) => s.enabled).length;
    const runningCount = Object.values(this.state.getState().sessions).filter((s) => s.status === "running").length;
    if (timedOut) {
      this.log.warn(`Boot timed out after ${this.config.orchestrator.boot_timeout_s}s: ${runningCount}/${sessionCount} sessions running`);
      notify("tmx boot", `Timed out: ${runningCount}/${sessionCount} sessions`);
    } else {
      this.log.info(`Boot complete: ${runningCount}/${sessionCount} sessions running`);
      notify("tmx boot", `${runningCount}/${sessionCount} sessions running`);
    }
  }
  /** Graceful shutdown — reverse-order stop, release wake lock, exit */
  shutdownInProgress = false;
  async shutdown() {
    if (this.shutdownInProgress) return;
    this.shutdownInProgress = true;
    this.log.info("Shutdown sequence starting");
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.memoryTimer) {
      clearInterval(this.memoryTimer);
      this.memoryTimer = null;
    }
    if (this.adbRetryTimer) {
      clearInterval(this.adbRetryTimer);
      this.adbRetryTimer = null;
    }
    for (const timer of this.restartTimers) {
      clearTimeout(timer);
    }
    this.restartTimers.clear();
    const shutdownOrder = computeShutdownOrder(this.config.sessions);
    for (const batch of shutdownOrder) {
      const stopPromises = batch.sessions.map(async (name) => {
        const s = this.state.getSession(name);
        if (!s || s.status === "stopped" || s.status === "pending") return;
        this.state.transition(name, "stopping");
        await stopSession(name, this.log);
        this.state.transition(name, "stopped");
      });
      await Promise.all(stopPromises);
    }
    this.wake.forceRelease();
    if (this.dashboard) {
      this.dashboard.stop();
      this.dashboard = null;
    }
    this.ipc.stop();
    this.running = false;
    this.log.info("Shutdown complete");
    notify("tmx", "Orchestrator stopped");
  }
  // -- Session management -----------------------------------------------------
  /**
   * Start all enabled sessions in dependency order.
   * Returns true if boot_timeout_s was exceeded (remaining sessions skipped).
   */
  async startAllSessions(deadline = Infinity) {
    const batches = computeStartupOrder(this.config.sessions);
    for (const batch of batches) {
      if (Date.now() >= deadline) {
        this.log.warn(`Boot timeout reached, skipping batch depth=${batch.depth}: ${batch.sessions.join(", ")}`);
        for (const name of batch.sessions) {
          const s = this.state.getSession(name);
          if (s && (s.status === "pending" || s.status === "waiting")) {
            this.state.transition(name, "failed", "Boot timeout exceeded");
          }
        }
        return true;
      }
      this.log.info(`Starting batch depth=${batch.depth}: ${batch.sessions.join(", ")}`);
      const startPromises = batch.sessions.map((name) => this.startSession(name));
      await Promise.all(startPromises);
      await sleep2(500);
    }
    const maxRetries = 3;
    for (let retry = 0; retry < maxRetries; retry++) {
      const waitingSessions = this.config.sessions.filter((s) => {
        const state = this.state.getSession(s.name);
        return state?.status === "waiting" && s.enabled;
      });
      if (waitingSessions.length === 0) break;
      if (Date.now() >= deadline) break;
      this.log.info(`Retrying ${waitingSessions.length} waiting sessions (attempt ${retry + 1}/${maxRetries})`);
      await sleep2(1e3);
      const retryPromises = waitingSessions.map((s) => this.startSession(s.name));
      await Promise.all(retryPromises);
      const stillWaiting = waitingSessions.filter((s) => {
        const state = this.state.getSession(s.name);
        return state?.status === "waiting";
      });
      if (stillWaiting.length === 0) break;
    }
    return false;
  }
  /** Start a single session by name */
  async startSession(name) {
    const sessionConfig = this.config.sessions.find((s2) => s2.name === name);
    if (!sessionConfig) {
      this.log.error(`Unknown session '${name}'`);
      return false;
    }
    if (!sessionConfig.enabled) {
      this.log.debug(`Session '${name}' is disabled, skipping`, { session: name });
      return false;
    }
    if (!this.budget.canStartSession()) {
      this.log.error(`Cannot start '${name}' \u2014 process budget critical`, { session: name });
      this.state.transition(name, "failed", "Process budget critical");
      notify("tmx budget", `Cannot start '${name}' \u2014 process budget critical`);
      return false;
    }
    const depsReady = sessionConfig.depends_on.every((dep) => {
      const depState = this.state.getSession(dep);
      return depState?.status === "running";
    });
    if (!depsReady) {
      this.state.forceStatus(name, "waiting");
      this.log.info(`Session '${name}' waiting on dependencies: ${sessionConfig.depends_on.join(", ")}`, {
        session: name
      });
      return false;
    }
    const s = this.state.getSession(name);
    if (s && s.status !== "pending" && s.status !== "waiting" && s.status !== "stopped" && s.status !== "failed") {
      if (s.status === "running") return true;
      this.log.debug(`Session '${name}' in status '${s.status}', skipping start`, { session: name });
      return false;
    }
    if (s && s.status === "failed") {
      this.state.transition(name, "stopped");
      this.state.transition(name, "pending");
    } else if (s && s.status === "stopped") {
      this.state.transition(name, "pending");
    }
    this.state.transition(name, "waiting");
    this.state.transition(name, "starting");
    const created = createSession(sessionConfig, this.log);
    if (!created) {
      this.state.transition(name, "failed", "Failed to create tmux session");
      return false;
    }
    if (sessionConfig.type === "claude") {
      this.handleClaudeStartup(name, sessionConfig);
    } else {
      this.state.transition(name, "running");
    }
    this.wake.evaluate("session_change", this.state.getState().sessions);
    return true;
  }
  /** Handle Claude session startup: wait for readiness, send "go" if configured */
  async handleClaudeStartup(name, config) {
    await sleep2(2e3);
    let readinessResult = "timeout";
    if (config.auto_go) {
      readinessResult = await sendGoToSession(name, this.log);
      if (readinessResult !== "ready") {
        this.log.warn(`Failed to send 'go' to '${name}' \u2014 ${readinessResult}`, { session: name });
      }
    } else {
      readinessResult = await waitForClaudeReady(name, this.log);
    }
    const s = this.state.getSession(name);
    if (!s || s.status !== "starting") return;
    if (readinessResult === "ready") {
      this.state.transition(name, "running");
    } else if (readinessResult === "timeout") {
      this.state.transition(name, "running");
      this.state.transition(name, "degraded");
      this.log.warn(`Session '${name}' entered degraded state (readiness timeout)`, { session: name });
    }
  }
  /** Stop a single session by name */
  async stopSessionByName(name) {
    const s = this.state.getSession(name);
    if (!s) return false;
    if (s.status === "stopped" || s.status === "pending") return true;
    this.state.transition(name, "stopping");
    const stopped = await stopSession(name, this.log);
    if (stopped) {
      this.state.transition(name, "stopped");
    } else {
      this.state.forceStatus(name, "stopped");
    }
    this.activity.remove(name);
    this.wake.evaluate("session_change", this.state.getState().sessions);
    return stopped;
  }
  /** Adopt existing tmux sessions on daemon restart */
  adoptExistingSessions() {
    const tmuxAlive = isTmuxServerAlive();
    const existingSessions = tmuxAlive ? new Set(listTmuxSessions()) : /* @__PURE__ */ new Set();
    const configuredNames = new Set(this.config.sessions.map((s) => s.name));
    if (tmuxAlive) {
      for (const name of existingSessions) {
        if (!configuredNames.has(name)) continue;
        const s = this.state.getSession(name);
        if (s && s.status !== "running") {
          this.log.info(`Adopting existing tmux session '${name}'`, { session: name });
          this.state.forceStatus(name, "running");
          if (!s.uptime_start) {
            this.state.getSession(name).uptime_start = (/* @__PURE__ */ new Date()).toISOString();
          }
        }
      }
    }
    for (const cfg of this.config.sessions) {
      const s = this.state.getSession(cfg.name);
      if (!s) continue;
      const isActiveState = s.status === "running" || s.status === "degraded" || s.status === "stopping" || s.status === "starting";
      if (isActiveState && !existingSessions.has(cfg.name)) {
        this.log.info(`Recovering stale '${s.status}' session '${cfg.name}' \u2192 stopped`, { session: cfg.name });
        this.state.forceStatus(cfg.name, "stopped");
      }
    }
  }
  // -- ADB helpers ------------------------------------------------------------
  /** ADB serial cache TTL — re-resolve every 30s to handle reconnects */
  static ADB_SERIAL_TTL_MS = 3e4;
  /** Get local IP with caching (60s TTL) */
  getLocalIp() {
    const now = Date.now();
    if (this.localIp && now < this.localIpExpiry) return this.localIp;
    this.localIp = resolveLocalIp();
    this.localIpExpiry = now + _Daemon.LOCAL_IP_TTL_MS;
    if (this.localIp) this.log.debug(`Local IP resolved: ${this.localIp}`);
    return this.localIp;
  }
  /**
   * Resolve the active ADB device serial (needed when multiple devices are listed).
   * Prefers localhost/self-device connections over external phones.
   * Caches with a short TTL so reconnects with new ports are picked up.
   * Auto-disconnects stale offline/unauthorized entries to prevent confusion.
   */
  resolveAdbSerial() {
    const now = Date.now();
    if (this.adbSerial && now < this.adbSerialExpiry) return this.adbSerial;
    try {
      const result = (0, import_node_child_process6.spawnSync)(ADB_BIN, ["devices"], {
        encoding: "utf-8",
        timeout: 5e3,
        stdio: ["ignore", "pipe", "pipe"]
      });
      if (result.status !== 0 || !result.stdout) return null;
      const lines = result.stdout.split("\n").filter((l) => l.includes("	"));
      const online = [];
      const stale = [];
      for (const line of lines) {
        const [serial, state] = line.split("	");
        if (state?.trim() === "device") {
          online.push(serial.trim());
        } else if (state?.trim() === "offline" || state?.trim() === "unauthorized") {
          stale.push(serial.trim());
        }
      }
      for (const serial of stale) {
        this.log.debug(`Disconnecting stale ADB device: ${serial}`);
        (0, import_node_child_process6.spawnSync)(ADB_BIN, ["disconnect", serial], { timeout: 3e3, stdio: "ignore" });
      }
      if (online.length === 0) {
        this.adbSerial = null;
        return null;
      }
      if (online.length > 1) {
        const localIp = this.getLocalIp();
        const localhost = online.find(
          (s) => s.startsWith("127.0.0.1:") || s.startsWith("localhost:") || localIp && s.startsWith(`${localIp}:`)
        );
        if (localhost) {
          this.log.debug(`Multiple ADB devices, preferring localhost: ${localhost}`);
          this.adbSerial = localhost;
        } else {
          this.log.warn(`Multiple ADB devices, no localhost match \u2014 using ${online[0]}. Devices: ${online.join(", ")}`);
          this.adbSerial = online[0];
        }
      } else {
        this.adbSerial = online[0];
      }
      this.adbSerialExpiry = now + _Daemon.ADB_SERIAL_TTL_MS;
      return this.adbSerial;
    } catch {
      return null;
    }
  }
  /** Build ADB shell args with serial selection for multi-device environments */
  adbShellArgs(...shellArgs) {
    const serial = this.resolveAdbSerial();
    const args2 = [];
    if (serial) args2.push("-s", serial);
    args2.push("shell", ...shellArgs);
    return args2;
  }
  // -- ADB fix ----------------------------------------------------------------
  /** Attempt ADB connection and apply phantom process killer fix */
  async fixAdb() {
    this.log.info("Attempting ADB connection for phantom process fix");
    const { connect_script, connect_timeout_s, phantom_fix } = this.config.adb;
    try {
      const result = (0, import_node_child_process6.spawnSync)("timeout", [String(connect_timeout_s), connect_script], {
        encoding: "utf-8",
        timeout: (connect_timeout_s + 5) * 1e3,
        stdio: ["ignore", "pipe", "pipe"]
      });
      if (result.status !== 0) {
        this.log.warn("ADB connection failed", { stderr: result.stderr?.trim() });
        this.state.setAdbFixed(false);
        notify("tmx boot", "ADB fix failed \u2014 processes may be killed");
        this.startAdbRetryTimer();
        return false;
      }
      this.log.info("ADB connected");
      this.adbSerial = null;
      this.adbSerialExpiry = 0;
      if (phantom_fix) {
        this.applyPhantomFix();
      }
      this.state.setAdbFixed(true);
      return true;
    } catch (err) {
      this.log.error(`ADB fix error: ${err}`);
      this.state.setAdbFixed(false);
      this.startAdbRetryTimer();
      return false;
    }
  }
  /**
   * Verify the resolved ADB device is this device (not an external phone).
   * Checks that the serial IP matches localhost or this device's local IP.
   */
  isLocalAdbDevice() {
    const serial = this.resolveAdbSerial();
    if (!serial) return false;
    if (serial.startsWith("127.0.0.1:") || serial.startsWith("localhost:")) return true;
    const localIp = this.getLocalIp();
    if (localIp && serial.startsWith(`${localIp}:`)) return true;
    return false;
  }
  /** Apply Android 12+ phantom process killer fix via ADB */
  applyPhantomFix() {
    if (!this.isLocalAdbDevice()) {
      const serial = this.resolveAdbSerial();
      this.log.warn(`Skipping phantom fix \u2014 ADB device '${serial}' may not be this device`);
      return;
    }
    const shellCmds = [
      ["/system/bin/device_config", "put", "activity_manager", "max_phantom_processes", "2147483647"],
      ["settings", "put", "global", "settings_enable_monitor_phantom_procs", "false"]
    ];
    const samsungPkgs = [
      "com.samsung.android.ssco",
      "com.samsung.android.mocca",
      "com.samsung.android.camerasdkservice"
    ];
    for (const cmd of shellCmds) {
      try {
        (0, import_node_child_process6.spawnSync)(ADB_BIN, this.adbShellArgs(...cmd), { timeout: 1e4, stdio: "ignore" });
      } catch (err) {
        this.log.warn(`Phantom fix command failed: ${cmd.join(" ")}`, { error: String(err) });
      }
    }
    for (const pkg of samsungPkgs) {
      try {
        (0, import_node_child_process6.spawnSync)(ADB_BIN, this.adbShellArgs("pm", "enable", pkg), { timeout: 1e4, stdio: "ignore" });
      } catch {
      }
    }
    this.log.info("Phantom process fix applied");
  }
  /** Start a periodic ADB retry timer */
  startAdbRetryTimer() {
    if (this.adbRetryTimer) return;
    const intervalMs = this.config.adb.retry_interval_s * 1e3;
    this.adbRetryTimer = setInterval(async () => {
      if (this.state.getState().adb_fixed) {
        if (this.adbRetryTimer) {
          clearInterval(this.adbRetryTimer);
          this.adbRetryTimer = null;
        }
        return;
      }
      this.log.info("Retrying ADB connection...");
      const success = await this.fixAdb();
      if (success && this.adbRetryTimer) {
        clearInterval(this.adbRetryTimer);
        this.adbRetryTimer = null;
      }
    }, intervalMs);
  }
  // -- Health & auto-restart --------------------------------------------------
  /** Start periodic health check timer */
  startHealthTimer() {
    const intervalMs = this.config.orchestrator.health_interval_s * 1e3;
    this.healthTimer = setInterval(() => {
      this.healthSweepAndRestart();
    }, intervalMs);
  }
  /** Run health sweep and handle auto-restarts for degraded sessions */
  async healthSweepAndRestart() {
    const results = runHealthSweep(this.config, this.state, this.log);
    for (const session of this.config.sessions) {
      const s = this.state.getSession(session.name);
      if (!s || s.status !== "degraded") continue;
      if (s.restart_count >= session.max_restarts) {
        this.state.transition(
          session.name,
          "failed",
          `Exceeded max restarts (${session.max_restarts})`
        );
        notify("tmx", `Session '${session.name}' failed \u2014 max restarts exceeded`);
        continue;
      }
      const backoffMs = session.restart_backoff_s * Math.pow(2, s.restart_count) * 1e3;
      this.log.info(`Auto-restarting '${session.name}' in ${backoffMs}ms (attempt ${s.restart_count + 1})`, {
        session: session.name
      });
      this.state.transition(session.name, "starting");
      const timer = setTimeout(async () => {
        this.restartTimers.delete(timer);
        this.activity.remove(session.name);
        await stopSession(session.name, this.log);
        const created = createSession(session, this.log);
        if (created) {
          if (session.type === "claude") {
            await this.handleClaudeStartup(session.name, session);
          } else {
            this.state.transition(session.name, "running");
          }
        } else {
          this.state.transition(session.name, "failed", "Restart failed");
        }
      }, backoffMs);
      this.restartTimers.add(timer);
    }
    const budgetStatus = this.budget.check();
    if (budgetStatus.mode === "critical") {
      this.log.error("Process budget critical", budgetStatus);
      notify("tmx budget", `Critical: ${budgetStatus.total_procs}/${budgetStatus.budget} processes`);
    }
  }
  // -- Memory monitoring & OOM shedding ----------------------------------------
  /** Start periodic memory monitoring timer (every 15s) */
  startMemoryTimer() {
    this.memoryTimer = setInterval(() => {
      this.memoryPollAndShed();
    }, 15e3);
    this.memoryPollAndShed();
  }
  /** Poll system memory, update per-session RSS/activity, shed if needed */
  memoryPollAndShed() {
    const sysMem = this.memory.getSystemMemory();
    this.state.updateSystemMemory(sysMem);
    for (const session of this.config.sessions) {
      const s = this.state.getSession(session.name);
      if (!s || s.status !== "running" && s.status !== "degraded") {
        if (s) this.state.updateSessionMetrics(session.name, null, null);
        continue;
      }
      const pid = this.memory.getSessionPid(session.name);
      if (pid === null) {
        this.state.updateSessionMetrics(session.name, null, "stopped");
        continue;
      }
      const { rss_mb } = this.memory.getProcessTreeRss(pid);
      const activityState = this.activity.classifyTree(session.name, pid);
      this.state.updateSessionMetrics(session.name, rss_mb, activityState);
    }
    if (sysMem.pressure !== "normal") {
      this.log.warn(`Memory pressure: ${sysMem.pressure} (${sysMem.available_mb}MB available)`, {
        available_mb: sysMem.available_mb,
        total_mb: sysMem.total_mb,
        pressure: sysMem.pressure
      });
    }
    if (sysMem.pressure === "critical" || sysMem.pressure === "emergency") {
      this.shedIdleSessions(sysMem.pressure);
    }
    this.pushSseState();
  }
  /** Push current state snapshot to all SSE clients */
  pushSseState() {
    if (!this.dashboard || this.dashboard.sseClientCount === 0) return;
    const statusResp = this.cmdStatus();
    if (statusResp.ok) {
      this.dashboard.pushEvent("state", statusResp.data);
    }
  }
  /**
   * Shed sessions to reduce memory pressure.
   * Priority: stop idle sessions first (lowest priority number = most important),
   * then active sessions if still in emergency.
   */
  async shedIdleSessions(pressure) {
    const candidates = [];
    for (const session of this.config.sessions) {
      const s = this.state.getSession(session.name);
      if (!s || s.status !== "running") continue;
      candidates.push({
        name: session.name,
        priority: session.priority,
        activity: s.activity
      });
    }
    candidates.sort((a, b) => {
      const aIdle = a.activity === "idle" ? 0 : 1;
      const bIdle = b.activity === "idle" ? 0 : 1;
      if (aIdle !== bIdle) return aIdle - bIdle;
      return b.priority - a.priority;
    });
    const maxShed = pressure === "emergency" ? 2 : 1;
    let shedCount = 0;
    for (const candidate of candidates) {
      if (shedCount >= maxShed) break;
      const sessionConfig = this.config.sessions.find((s) => s.name === candidate.name);
      if (!sessionConfig) continue;
      if (pressure === "critical" && candidate.activity !== "idle") continue;
      if (pressure === "emergency" && candidate.activity !== "idle" && shedCount === 0) {
        const hasIdle = candidates.some((c) => c.activity === "idle");
        if (hasIdle) continue;
      }
      this.log.warn(`Shedding session '${candidate.name}' due to ${pressure} memory pressure`, {
        session: candidate.name,
        activity: candidate.activity,
        priority: candidate.priority
      });
      notify("tmx memory", `Shedding '${candidate.name}' \u2014 ${pressure} memory pressure`);
      await this.stopSessionByName(candidate.name);
      shedCount++;
    }
    if (shedCount === 0) {
      this.log.warn("No sessions available to shed");
      notify("tmx memory", `${pressure} memory pressure \u2014 no sessions to shed`);
    }
  }
  // -- Dashboard HTTP server ---------------------------------------------------
  /** Start HTTP dashboard server if port > 0 */
  async startDashboard() {
    const port = this.config.orchestrator.dashboard_port;
    if (port <= 0) {
      this.log.debug("Dashboard disabled (port=0)");
      return;
    }
    const scriptDir = typeof import_meta_url === "string" ? new URL(".", import_meta_url).pathname : __dirname ?? process.cwd();
    const staticDir = (0, import_node_path4.join)(scriptDir, "..", "dashboard", "dist");
    this.dashboard = new DashboardServer(
      port,
      staticDir,
      (method, path, body) => this.handleDashboardApi(method, path, body),
      this.log
    );
    try {
      await this.dashboard.start();
    } catch (err) {
      this.log.warn(`Dashboard server failed to start: ${err}`);
      this.dashboard = null;
    }
  }
  /** Map REST API paths to IPC command handlers */
  async handleDashboardApi(method, path, body) {
    const segments = path.replace(/^\/api\//, "").split("/");
    const command2 = segments[0];
    const name = segments[1] ? decodeURIComponent(segments[1]) : void 0;
    try {
      let resp;
      switch (command2) {
        case "status":
          resp = this.cmdStatus(name);
          break;
        case "memory":
          resp = this.cmdMemory();
          break;
        case "health":
          resp = this.cmdHealth();
          break;
        case "start":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          resp = await this.cmdStart(name);
          break;
        case "stop":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          resp = await this.cmdStop(name);
          break;
        case "restart":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          resp = await this.cmdRestart(name);
          break;
        case "go":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Session name required" } };
          resp = await this.cmdGo(name);
          break;
        case "send":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Session name required" } };
          try {
            const parsed = JSON.parse(body);
            resp = this.cmdSend(name, parsed.text ?? "");
          } catch {
            return { status: 400, data: { error: "Invalid JSON body" } };
          }
          break;
        case "bridge": {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3e3);
            const bridgeResp = await fetch("http://127.0.0.1:18963/health", {
              signal: controller.signal
            });
            clearTimeout(timeout);
            const bridgeData = await bridgeResp.json();
            return { status: 200, data: bridgeData };
          } catch {
            return { status: 200, data: { status: "offline", error: "Bridge not reachable" } };
          }
        }
        case "logs": {
          const sessionFilter = name ?? void 0;
          const log = new Logger(this.config.orchestrator.log_dir);
          const entries = log.readTail(100, sessionFilter);
          return { status: 200, data: entries };
        }
        case "tab":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Session name required" } };
          if (createTermuxTab(name, this.log)) {
            return { status: 200, data: { ok: true, session: name } };
          }
          return { status: 500, data: { error: `Failed to open tab for '${name}'` } };
        case "processes":
          return { status: 200, data: this.getAndroidApps() };
        case "kill":
          if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
          if (!name) return { status: 400, data: { error: "Package name required" } };
          return this.forceStopApp(name);
        case "adb":
          if (!name) {
            return { status: 200, data: this.getAdbDevices() };
          }
          if (name === "connect") {
            if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
            return this.adbWirelessConnect();
          }
          if (name === "disconnect") {
            if (method !== "POST") return { status: 405, data: { error: "Method not allowed" } };
            const serial = segments[2] ? decodeURIComponent(segments[2]) : void 0;
            if (serial) return this.adbDisconnectDevice(serial);
            return this.adbDisconnectAll();
          }
          return { status: 400, data: { error: `Unknown ADB action: ${name}` } };
        default:
          return { status: 404, data: { error: `Unknown endpoint: ${command2}` } };
      }
      return { status: resp.ok ? 200 : 400, data: resp.ok ? resp.data : { error: resp.error } };
    } catch (err) {
      return { status: 500, data: { error: String(err) } };
    }
  }
  // -- Android app management -------------------------------------------------
  /** Well-known system packages that should not be force-stopped */
  static SYSTEM_PACKAGES = /* @__PURE__ */ new Set([
    "system_server",
    "com.android.systemui",
    "com.google.android.gms.persistent",
    "com.termux",
    "com.termux.api",
    "com.sec.android.app.launcher",
    "com.android.phone",
    "com.android.providers.media",
    "com.samsung.android.providers.media",
    "com.google.android.gms",
    "com.android.bluetooth",
    "com.google.android.ext.services",
    "com.google.android.providers.media.module",
    "android.process.acore",
    "com.samsung.android.scs",
    "com.samsung.android.sead",
    "com.samsung.android.scpm",
    "com.sec.android.sdhms"
  ]);
  /** Friendly display names for known packages */
  static APP_LABELS = {
    "com.microsoft.emmx.canary": "Edge Canary",
    "com.microsoft.emmx": "Edge",
    "com.android.chrome": "Chrome",
    "com.discord": "Discord",
    "com.Slack": "Slack",
    "com.google.android.gm": "Gmail",
    "com.google.android.apps.photos": "Photos",
    "com.google.android.apps.chromecast.app": "Google Home",
    "com.google.android.apps.maps": "Maps",
    "com.google.android.apps.docs": "Drive",
    "com.google.android.apps.youtube": "YouTube",
    "com.google.android.apps.messaging": "Messages",
    "com.google.android.calendar": "Calendar",
    "com.google.android.googlequicksearchbox": "Google",
    "com.google.android.gms": "Play Services",
    "com.google.android.gms.persistent": "Play Services",
    "com.ubercab.eats": "Uber Eats",
    "com.samsung.android.app.spage": "Samsung Free",
    "com.samsung.android.smartsuggestions": "Smart Suggest",
    "com.samsung.android.incallui": "Phone",
    "com.samsung.android.messaging": "Samsung Messages",
    "com.samsung.android.spay": "Samsung Pay",
    "com.sec.android.daemonapp": "Weather",
    "com.sec.android.app.sbrowser": "Samsung Internet",
    "net.slickdeals.android": "Slickdeals",
    "dev.imranr.obtainium": "Obtainium",
    "com.teslacoilsw.launcher": "Nova Launcher",
    "com.sec.android.app.launcher": "One UI Home",
    "com.android.systemui": "System UI",
    "com.android.settings": "Settings",
    "com.android.vending": "Play Store",
    "com.termux": "Termux",
    "com.termux.api": "Termux:API",
    "tribixbite.cleverkeys": "CleverKeys",
    "com.microsoft.appmanager": "Link to Windows",
    "com.google.android.apps.nbu.files": "Files by Google",
    "com.reddit.frontpage": "Reddit",
    "io.homeassistant.companion.android": "Home Assistant",
    "com.adguard.android.contentblocker": "AdGuard",
    "com.samsung.android.app.smartcapture": "Smart Select",
    "com.samsung.android.app.routines": "Routines",
    "com.samsung.android.rubin.app": "Customization",
    "com.samsung.android.app.moments": "Memories",
    "com.samsung.android.ce": "Samsung Cloud",
    "com.samsung.android.mdx": "Link to Windows",
    "com.samsung.euicc": "SIM Manager",
    "com.sec.imsservice": "IMS Service",
    "com.sec.android.app.clockpackage": "Clock",
    "com.samsung.cmh": "Connected Home",
    "com.samsung.android.kmxservice": "Knox",
    "com.samsung.android.stplatform": "SmartThings",
    "com.samsung.android.service.stplatform": "SmartThings",
    "com.google.android.gms.unstable": "Play Services",
    "com.google.android.as.oss": "Private Compute",
    "com.google.android.cellbroadcastreceiver": "Emergency Alerts",
    "com.sec.android.app.chromecustomizations": "Chrome Custom",
    "org.mopria.printplugin": "Print Service",
    "com.samsung.android.samsungpositioning": "Location",
    "com.google.android.providers.media.module": "Media Storage"
  };
  /**
   * List Android apps via `adb shell ps`, grouped by base package.
   * Merges sandboxed/privileged child processes into the parent total.
   */
  getAndroidApps() {
    try {
      const result = (0, import_node_child_process6.spawnSync)(ADB_BIN, this.adbShellArgs("ps", "-A", "-o", "PID,RSS,NAME"), {
        encoding: "utf-8",
        timeout: 8e3,
        stdio: ["ignore", "pipe", "pipe"]
      });
      if (result.status !== 0 || !result.stdout) {
        this.log.warn("adb ps failed", {
          status: result.status,
          stderr: result.stderr?.trim().slice(0, 200),
          hasStdout: !!result.stdout,
          args: this.adbShellArgs("ps", "-A", "-o", "PID,RSS,NAME").join(" ")
        });
        return [];
      }
      const pkgMap = /* @__PURE__ */ new Map();
      for (const line of result.stdout.trim().split("\n")) {
        const match = line.trim().match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
        if (!match) continue;
        const rssKb = parseInt(match[2], 10);
        const rawName = match[3].trim();
        if (rssKb < 1024) continue;
        const basePkg = rawName.split(":")[0];
        const dotCount = (basePkg.match(/\./g) || []).length;
        if (dotCount < 2 && !_Daemon.APP_LABELS[basePkg]) continue;
        if (basePkg.endsWith("_zygote") || basePkg.startsWith("com.android.isolated")) continue;
        pkgMap.set(basePkg, (pkgMap.get(basePkg) ?? 0) + rssKb);
      }
      const apps = [];
      for (const [pkg, rssKb] of pkgMap) {
        const rssMb = Math.round(rssKb / 1024);
        if (rssMb < 50) continue;
        const system = _Daemon.SYSTEM_PACKAGES.has(pkg);
        const label = _Daemon.APP_LABELS[pkg] ?? _Daemon.deriveLabel(pkg);
        apps.push({ pkg, label, rss_mb: rssMb, system });
      }
      apps.sort((a, b) => b.rss_mb - a.rss_mb);
      return apps;
    } catch (err) {
      this.log.warn("getAndroidApps exception", { error: String(err) });
      return [];
    }
  }
  /** Derive a human-readable label from a package name */
  static deriveLabel(pkg) {
    const parts = pkg.split(".");
    const skip = /* @__PURE__ */ new Set(["com", "org", "net", "android", "google", "samsung", "sec", "app", "apps", "software"]);
    const meaningful = parts.filter((p) => !skip.has(p) && p.length > 1);
    const name = meaningful.length > 0 ? meaningful[meaningful.length - 1] : parts[parts.length - 1];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  /** Force-stop an Android app via ADB */
  forceStopApp(pkg) {
    if (!pkg || !pkg.includes(".")) {
      return { status: 400, data: { error: "Invalid package name" } };
    }
    if (_Daemon.SYSTEM_PACKAGES.has(pkg)) {
      return { status: 403, data: { error: `Cannot stop system package: ${pkg}` } };
    }
    try {
      const result = (0, import_node_child_process6.spawnSync)(ADB_BIN, this.adbShellArgs("am", "force-stop", pkg), {
        encoding: "utf-8",
        timeout: 5e3,
        stdio: ["ignore", "pipe", "pipe"]
      });
      if (result.status !== 0) {
        return { status: 500, data: { error: result.stderr?.trim() || "force-stop failed" } };
      }
      this.log.info(`Force-stopped ${pkg} via dashboard`);
      return { status: 200, data: { ok: true, pkg } };
    } catch (err) {
      return { status: 500, data: { error: `Failed to stop ${pkg}: ${err.message}` } };
    }
  }
  // -- ADB device management --------------------------------------------------
  /** List connected ADB devices */
  getAdbDevices() {
    try {
      const result = (0, import_node_child_process6.spawnSync)(ADB_BIN, ["devices"], {
        encoding: "utf-8",
        timeout: 5e3,
        stdio: ["ignore", "pipe", "pipe"]
      });
      if (result.status !== 0 || !result.stdout) return { devices: [] };
      const devices = result.stdout.split("\n").slice(1).filter((l) => l.includes("	")).map((l) => {
        const [serial, state] = l.split("	");
        return { serial: serial.trim(), state: state.trim() };
      });
      return { devices };
    } catch {
      return { devices: [] };
    }
  }
  /** Initiate ADB wireless connection using the adbc script */
  adbWirelessConnect() {
    const script = (0, import_node_path4.join)(
      process.env.HOME ?? "/data/data/com.termux/files/home",
      "git/termux-tools/tools/adb-wireless-connect.sh"
    );
    try {
      const result = (0, import_node_child_process6.spawnSync)("bash", [script], {
        encoding: "utf-8",
        timeout: 2e4,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: process.env.PATH }
      });
      const output = (result.stdout ?? "") + (result.stderr ?? "");
      if (output.includes("connected") || output.includes("Reconnected")) {
        this.adbSerial = null;
        this.adbSerialExpiry = 0;
        return { status: 200, data: { ok: true, message: output.trim().split("\n").pop() } };
      }
      return { status: 500, data: { ok: false, message: output.trim().split("\n").pop() || "Connection failed" } };
    } catch (err) {
      return { status: 500, data: { ok: false, message: err.message } };
    }
  }
  /** Disconnect all ADB devices */
  adbDisconnectAll() {
    try {
      (0, import_node_child_process6.spawnSync)(ADB_BIN, ["disconnect", "-a"], {
        timeout: 5e3,
        stdio: "ignore"
      });
      this.adbSerial = null;
      this.adbSerialExpiry = 0;
      return { status: 200, data: { ok: true } };
    } catch (err) {
      return { status: 500, data: { ok: false, message: err.message } };
    }
  }
  /** Disconnect a specific ADB device by serial */
  adbDisconnectDevice(serial) {
    try {
      const result = (0, import_node_child_process6.spawnSync)(ADB_BIN, ["disconnect", serial], {
        encoding: "utf-8",
        timeout: 5e3,
        stdio: ["ignore", "pipe", "pipe"]
      });
      this.adbSerial = null;
      this.adbSerialExpiry = 0;
      const output = (result.stdout ?? "").trim();
      return { status: 200, data: { ok: true, serial, message: output } };
    } catch (err) {
      return { status: 500, data: { ok: false, message: err.message } };
    }
  }
  // -- Cron -------------------------------------------------------------------
  /** Start crond if not already running */
  startCron() {
    try {
      const result = (0, import_node_child_process6.spawnSync)("pgrep", ["-x", "crond"], { timeout: 5e3, stdio: "ignore" });
      if (result.status !== 0) {
        (0, import_node_child_process6.spawnSync)("crond", ["-s", "-P"], { timeout: 5e3, stdio: "ignore" });
        this.log.info("Started crond");
      }
    } catch {
      this.log.warn("Failed to start crond");
    }
  }
  // -- Signal handling --------------------------------------------------------
  /** Set up process signal handlers for graceful shutdown */
  setupSignalHandlers() {
    const handler = async (signal) => {
      this.log.info(`Received ${signal}, shutting down...`);
      await this.shutdown();
      process.exit(0);
    };
    process.on("SIGTERM", () => handler("SIGTERM"));
    process.on("SIGINT", () => handler("SIGINT"));
    process.on("SIGHUP", () => {
      this.log.info("Received SIGHUP, reloading config...");
      try {
        this.config = loadConfig();
        this.state.initFromConfig(this.config.sessions);
        this.budget.setBudget(this.config.orchestrator.process_budget);
        this.memory.setThresholds(
          this.config.orchestrator.memory_warning_mb,
          this.config.orchestrator.memory_critical_mb,
          this.config.orchestrator.memory_emergency_mb
        );
        this.log.info("Config reloaded successfully");
      } catch (err) {
        this.log.error(`Config reload failed: ${err}`);
      }
    });
  }
  // -- IPC command handler ----------------------------------------------------
  /** Handle an IPC command from the CLI */
  async handleIpcCommand(cmd) {
    switch (cmd.cmd) {
      case "status":
        return this.cmdStatus(cmd.name);
      case "start":
        return this.cmdStart(cmd.name);
      case "stop":
        return this.cmdStop(cmd.name);
      case "restart":
        return this.cmdRestart(cmd.name);
      case "health":
        return this.cmdHealth();
      case "boot":
        this.boot().catch((err) => this.log.error(`Boot failed: ${err}`));
        return { ok: true, data: "Boot sequence started" };
      case "shutdown":
        setTimeout(() => this.shutdown().then(() => process.exit(0)), 100);
        return { ok: true, data: "Shutdown initiated" };
      case "go":
        return this.cmdGo(cmd.name);
      case "send":
        return this.cmdSend(cmd.name, cmd.text);
      case "tabs":
        return this.cmdTabs(cmd.names);
      case "config":
        return { ok: true, data: this.config };
      case "memory":
        return this.cmdMemory();
      default:
        return { ok: false, error: `Unknown command: ${cmd.cmd}` };
    }
  }
  /** Status command — return session states and daemon info */
  cmdStatus(name) {
    const state = this.state.getState();
    if (name) {
      const resolved = this.resolveName(name);
      if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
      const s = state.sessions[resolved];
      if (!s) return { ok: false, error: `No state for session: ${resolved}` };
      return { ok: true, data: { session: s, config: this.config.sessions.find((c) => c.name === resolved) } };
    }
    return {
      ok: true,
      data: {
        daemon_start: state.daemon_start,
        boot_complete: state.boot_complete,
        adb_fixed: state.adb_fixed,
        budget: this.budget.check(),
        wake_lock: this.wake.isHeld(),
        memory: state.memory ?? null,
        sessions: Object.values(state.sessions).map((s) => ({
          ...s,
          uptime: s.uptime_start ? formatUptime(new Date(s.uptime_start)) : null
        }))
      }
    };
  }
  /** Start command — start one or all sessions */
  async cmdStart(name) {
    if (name) {
      const resolved = this.resolveName(name);
      if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
      const success = await this.startSession(resolved);
      return { ok: success, data: success ? `Started '${resolved}'` : `Failed to start '${resolved}'` };
    }
    await this.startAllSessions();
    return { ok: true, data: "All sessions started" };
  }
  /** Stop command — stop one or all sessions */
  async cmdStop(name) {
    if (name) {
      const resolved = this.resolveName(name);
      if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
      const success = await this.stopSessionByName(resolved);
      return { ok: success, data: success ? `Stopped '${resolved}'` : `Failed to stop '${resolved}'` };
    }
    const shutdownOrder = computeShutdownOrder(this.config.sessions);
    for (const batch of shutdownOrder) {
      await Promise.all(batch.sessions.map((n) => this.stopSessionByName(n)));
    }
    return { ok: true, data: "All sessions stopped" };
  }
  /** Restart command */
  async cmdRestart(name) {
    if (name) {
      const resolved = this.resolveName(name);
      if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
      await this.stopSessionByName(resolved);
      await sleep2(500);
      const success = await this.startSession(resolved);
      return { ok: success, data: success ? `Restarted '${resolved}'` : `Failed to restart '${resolved}'` };
    }
    await this.cmdStop();
    await sleep2(500);
    return this.cmdStart();
  }
  /** Health command — run health sweep now */
  cmdHealth() {
    const results = runHealthSweep(this.config, this.state, this.log);
    return { ok: true, data: results };
  }
  /** Memory command — return system memory + per-session RSS + pressure */
  cmdMemory() {
    const sysMem = this.memory.getSystemMemory();
    const sessions = [];
    for (const session of this.config.sessions) {
      const s = this.state.getSession(session.name);
      sessions.push({
        name: session.name,
        rss_mb: s?.rss_mb ?? null,
        activity: s?.activity ?? null
      });
    }
    return {
      ok: true,
      data: {
        system: sysMem,
        sessions
      }
    };
  }
  /** Go command — send "go" to a Claude session */
  async cmdGo(name) {
    const resolved = this.resolveName(name);
    if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
    const result = await sendGoToSession(resolved, this.log);
    const ok = result === "ready";
    return { ok, data: ok ? `Sent 'go' to '${resolved}'` : `Failed to send 'go' to '${resolved}' (${result})` };
  }
  /** Send command — send arbitrary text to a session */
  cmdSend(name, text) {
    const resolved = this.resolveName(name);
    if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
    const sent = sendKeys(resolved, text, true);
    return { ok: sent, data: sent ? `Sent to '${resolved}'` : `Failed to send to '${resolved}'` };
  }
  /** Tabs command — create Termux UI tabs for sessions */
  cmdTabs(names) {
    const targetSessions = names?.length ? names.map((n) => this.resolveName(n)).filter((n) => n !== null) : this.config.sessions.filter((s) => !s.headless && s.enabled).map((s) => s.name);
    let restored = 0;
    let skipped = 0;
    for (const name of targetSessions) {
      if (!sessionExists(name)) {
        skipped++;
        continue;
      }
      if (createTermuxTab(name, this.log)) {
        restored++;
      } else {
        skipped++;
      }
    }
    return { ok: true, data: { restored, skipped, total: targetSessions.length } };
  }
  // -- Helpers ----------------------------------------------------------------
  /** Fuzzy-match a session name (prefix match) */
  resolveName(input) {
    const names = this.config.sessions.map((s) => s.name);
    if (names.includes(input)) return input;
    const matches = names.filter((n) => n.startsWith(input));
    if (matches.length === 1) return matches[0];
    const substringMatches = names.filter((n) => n.includes(input));
    if (substringMatches.length === 1) return substringMatches[0];
    return null;
  }
};
function formatUptime(start) {
  const ms = Date.now() - start.getTime();
  const seconds = Math.floor(ms / 1e3);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// src/migrate.ts
var import_node_fs10 = require("node:fs");
function parseReposConf(filePath) {
  if (!(0, import_node_fs10.existsSync)(filePath)) {
    throw new Error(`repos.conf not found at: ${filePath}`);
  }
  const content = (0, import_node_fs10.readFileSync)(filePath, "utf-8");
  const entries = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.startsWith("REPOS[")) continue;
    const match = trimmed.match(/^REPOS\["([^"]+)"\]\s*=\s*"([^"]+)"/);
    if (!match) continue;
    const [, rawPath, config] = match;
    const [autoGoStr, enabledStr] = config.split(":");
    const path = rawPath.replace(/\$HOME/g, process.env.HOME ?? "~");
    const name = path.split("/").pop() ?? "unknown";
    entries.push({
      path: rawPath,
      // Keep $HOME unexpanded for TOML
      name: name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      auto_go: autoGoStr === "1",
      enabled: enabledStr === "1"
    });
  }
  return entries;
}
function generateToml(entries) {
  const lines = [
    "# tmx.toml \u2014 Generated from repos.conf by `tmx migrate`",
    `# Generated at ${(/* @__PURE__ */ new Date()).toISOString()}`,
    "",
    "[orchestrator]",
    'socket = "$PREFIX/tmp/tmx.sock"',
    'state_file = "$HOME/.local/share/tmx/state.json"',
    'log_dir = "$HOME/.local/share/tmx/logs"',
    "health_interval_s = 120",
    "boot_timeout_s = 300",
    "process_budget = 32",
    'wake_lock_policy = "active_sessions"',
    "",
    "[adb]",
    "enabled = true",
    'connect_script = "$HOME/git/termux-tools/tools/adb-wireless-connect.sh"',
    "connect_timeout_s = 45",
    "retry_interval_s = 300",
    "phantom_fix = true",
    "",
    "[health_defaults.claude]",
    'check = "tmux_alive"',
    "unhealthy_threshold = 2",
    "",
    "[health_defaults.daemon]",
    'check = "tmux_alive"',
    "unhealthy_threshold = 3",
    "",
    "[health_defaults.service]",
    'check = "tmux_alive"',
    "unhealthy_threshold = 2",
    "",
    "# \u2500\u2500\u2500 Sessions (migrated from repos.conf) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    ""
  ];
  entries.forEach((entry, i) => {
    lines.push("[[session]]");
    lines.push(`name = "${entry.name}"`);
    lines.push('type = "claude"');
    lines.push(`path = "${entry.path}"`);
    lines.push(`auto_go = ${entry.auto_go}`);
    lines.push(`priority = ${i + 1}`);
    lines.push(`enabled = ${entry.enabled}`);
    lines.push("");
  });
  lines.push(
    "# \u2500\u2500\u2500 Standard services \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "",
    "[[session]]",
    'name = "termux-x11"',
    'type = "service"',
    `command = "termux-x11 :1 -legacy-drawing -xstartup 'xfce4-session'"`,
    "priority = 1",
    "headless = true",
    "",
    "[[session]]",
    'name = "playwright"',
    'type = "service"',
    'command = "DISPLAY=:1 mcp-server-playwright --port 8989 --browser chromium --executable-path /data/data/com.termux/files/usr/bin/chromium-browser"',
    'depends_on = ["termux-x11"]',
    "priority = 2",
    "headless = true",
    ""
  );
  return lines.join("\n");
}
function findReposConf() {
  const candidates = [
    `${process.env.HOME}/.config/termux-boot/repos.conf`,
    `${process.env.HOME}/.termux/boot/repos.conf`
  ];
  return candidates.find(import_node_fs10.existsSync) ?? null;
}

// src/tmx.ts
var BOLD = "\x1B[1m";
var DIM2 = "\x1B[2m";
var RED = "\x1B[31m";
var GREEN = "\x1B[32m";
var YELLOW = "\x1B[33m";
var CYAN = "\x1B[36m";
var RESET2 = "\x1B[0m";
var STATUS_COLORS = {
  running: `${GREEN}running${RESET2}`,
  degraded: `${YELLOW}degraded${RESET2}`,
  starting: `${CYAN}starting${RESET2}`,
  waiting: `${CYAN}waiting${RESET2}`,
  stopping: `${YELLOW}stopping${RESET2}`,
  stopped: `${DIM2}stopped${RESET2}`,
  failed: `${RED}failed${RESET2}`,
  pending: `${DIM2}pending${RESET2}`
};
function resolveBunPath() {
  try {
    const result = (0, import_node_child_process7.spawnSync)("which", ["bun"], { encoding: "utf-8", timeout: 3e3 });
    if (result.stdout?.trim()) return result.stdout.trim();
  } catch {
  }
  const home = process.env.HOME ?? "/data/data/com.termux/files/home";
  const candidates = [
    (0, import_node_path5.join)(home, ".bun", "bin", "bun"),
    (0, import_node_path5.join)(process.env.PREFIX ?? "/data/data/com.termux/files/usr", "bin", "bun")
  ];
  for (const p of candidates) {
    if ((0, import_node_fs11.existsSync)(p)) return p;
  }
  return process.argv[0];
}
var args = process.argv.slice(2);
var command = args[0] ?? "status";
var subArgs = args.slice(1);
main().catch((err) => {
  console.error(`${RED}Error: ${err.message}${RESET2}`);
  process.exit(1);
});
async function main() {
  switch (command) {
    case "daemon":
      return runDaemon();
    case "boot":
      return runBoot();
    case "config":
      return runConfig();
    case "migrate":
      return runMigrate();
    case "logs":
      return runLogs();
    case "--help":
    case "-h":
    case "help":
      return printHelp();
    case "--version":
    case "-v":
      return printVersion();
    // Commands that proxy to daemon via IPC
    case "status":
    case "start":
    case "stop":
    case "restart":
    case "health":
    case "memory":
    case "shutdown":
    case "go":
    case "send":
    case "tabs":
      return runIpcCommand();
    default:
      return runIpcCommand();
  }
}
async function runDaemon() {
  const configPath = getConfigFlag();
  const daemon = new Daemon(configPath);
  await daemon.start();
}
async function runBoot() {
  const configPath = getConfigFlag();
  const client = getClient(configPath);
  const running = await client.isRunning();
  if (!running) {
    console.log(`${CYAN}Starting daemon...${RESET2}`);
    const daemonArgs = ["daemon"];
    if (configPath) daemonArgs.push("--config", configPath);
    let logDir;
    try {
      const config = loadConfig(configPath);
      logDir = config.orchestrator.log_dir;
    } catch {
      logDir = `${process.env.HOME}/.local/share/tmx/logs`;
    }
    (0, import_node_fs11.mkdirSync)(logDir, { recursive: true });
    const stderrPath = `${logDir}/daemon-stderr.log`;
    const stderrFd = (0, import_node_fs11.openSync)(stderrPath, "a");
    const bunPath = resolveBunPath();
    const child = (0, import_node_child_process7.spawn)(bunPath, [process.argv[1], ...daemonArgs], {
      detached: true,
      stdio: ["ignore", "ignore", stderrFd]
    });
    child.unref();
    (0, import_node_fs11.closeSync)(stderrFd);
    for (let i = 0; i < 20; i++) {
      await sleep3(500);
      if (await client.isRunning()) break;
    }
    if (!await client.isRunning()) {
      console.error(`${RED}Daemon failed to start${RESET2}`);
      printStartupDiagnostics(logDir, stderrPath);
      process.exit(1);
    }
    console.log(`${GREEN}Daemon started${RESET2}`);
  }
  const resp = await client.send({ cmd: "boot" });
  if (resp.ok) {
    console.log(`${GREEN}Boot sequence initiated${RESET2}`);
  } else {
    console.error(`${RED}Boot failed: ${resp.error}${RESET2}`);
    process.exit(1);
  }
}
function printStartupDiagnostics(logDir, stderrPath) {
  console.error();
  try {
    if ((0, import_node_fs11.existsSync)(stderrPath)) {
      const stderr = (0, import_node_fs11.readFileSync)(stderrPath, "utf-8").trim();
      if (stderr) {
        const lines = stderr.split("\n").slice(-20);
        console.error(`${YELLOW}Daemon stderr (last ${lines.length} lines):${RESET2}`);
        for (const line of lines) {
          console.error(`  ${DIM2}${line}${RESET2}`);
        }
        console.error();
      }
    }
  } catch {
  }
  try {
    const logFile = `${logDir}/tmx.jsonl`;
    if ((0, import_node_fs11.existsSync)(logFile)) {
      const content = (0, import_node_fs11.readFileSync)(logFile, "utf-8").trim();
      if (content) {
        const entries = content.split("\n").slice(-10);
        console.error(`${YELLOW}Recent log entries:${RESET2}`);
        for (const raw of entries) {
          try {
            const entry = JSON.parse(raw);
            const time = entry.ts?.slice(11, 23) ?? "";
            const color = entry.level === "error" ? RED : entry.level === "warn" ? YELLOW : DIM2;
            console.error(`  ${DIM2}${time}${RESET2} ${color}${entry.level}${RESET2} ${entry.msg}`);
          } catch {
            console.error(`  ${DIM2}${raw.slice(0, 120)}${RESET2}`);
          }
        }
        console.error();
      }
    }
  } catch {
  }
  console.error(`${CYAN}Suggestions:${RESET2}`);
  console.error(`  ${DIM2}1.${RESET2} Check logs:    ${BOLD}tmx logs${RESET2}`);
  console.error(`  ${DIM2}2.${RESET2} Validate config: ${BOLD}tmx config${RESET2}`);
  console.error(`  ${DIM2}3.${RESET2} Run foreground: ${BOLD}tmx daemon${RESET2}`);
  console.error(`  ${DIM2}4.${RESET2} Check stderr:   ${BOLD}cat ${stderrPath}${RESET2}`);
}
function runConfig() {
  const configPath = getConfigFlag();
  const found = findConfigPath(configPath);
  if (!found) {
    console.error(`${RED}No config file found${RESET2}`);
    console.error(`Copy tmx.toml.example to ~/.config/tmx/tmx.toml`);
    process.exit(1);
  }
  console.log(`${DIM2}Config: ${found}${RESET2}`);
  const errors = validateConfigFile(found);
  if (errors.length > 0) {
    console.error(`${RED}Validation errors:${RESET2}`);
    for (const e of errors) {
      console.error(`  ${e}`);
    }
    process.exit(1);
  }
  const config = loadConfig(configPath);
  console.log(`${GREEN}Config valid${RESET2}`);
  console.log();
  console.log(`${BOLD}Orchestrator${RESET2}`);
  console.log(`  socket:           ${config.orchestrator.socket}`);
  console.log(`  state_file:       ${config.orchestrator.state_file}`);
  console.log(`  log_dir:          ${config.orchestrator.log_dir}`);
  console.log(`  health_interval:  ${config.orchestrator.health_interval_s}s`);
  console.log(`  process_budget:   ${config.orchestrator.process_budget}`);
  console.log(`  wake_lock_policy: ${config.orchestrator.wake_lock_policy}`);
  console.log(`  dashboard_port:   ${config.orchestrator.dashboard_port}`);
  console.log(`  memory_warn/crit: ${config.orchestrator.memory_warning_mb}/${config.orchestrator.memory_critical_mb}/${config.orchestrator.memory_emergency_mb} MB`);
  console.log();
  console.log(`${BOLD}ADB${RESET2}`);
  console.log(`  enabled:     ${config.adb.enabled}`);
  console.log(`  phantom_fix: ${config.adb.phantom_fix}`);
  console.log(`  boot_delay:  ${config.adb.boot_delay_s}s`);
  console.log();
  console.log(`${BOLD}Sessions (${config.sessions.length})${RESET2}`);
  printSessionTable(config.sessions.map((s) => ({
    name: s.name,
    type: s.type,
    enabled: s.enabled,
    priority: s.priority,
    auto_go: s.auto_go,
    headless: s.headless,
    depends_on: s.depends_on
  })));
}
function runMigrate() {
  const confPath = subArgs[0] ?? findReposConf();
  if (!confPath) {
    console.error(`${RED}repos.conf not found${RESET2}`);
    console.error("Usage: tmx migrate [path/to/repos.conf]");
    process.exit(1);
  }
  console.log(`${DIM2}Parsing: ${confPath}${RESET2}`);
  const entries = parseReposConf(confPath);
  console.log(`Found ${entries.length} entries`);
  const toml = generateToml(entries);
  const outPath = subArgs[1] ?? `${process.env.HOME}/.config/tmx/tmx.toml`;
  const outDir = outPath.substring(0, outPath.lastIndexOf("/"));
  if (!(0, import_node_fs11.existsSync)(outDir)) {
    (0, import_node_fs11.mkdirSync)(outDir, { recursive: true });
  }
  if ((0, import_node_fs11.existsSync)(outPath)) {
    console.log(`${YELLOW}${outPath} already exists \u2014 writing to ${outPath}.new${RESET2}`);
    (0, import_node_fs11.writeFileSync)(`${outPath}.new`, toml);
    console.log(`${GREEN}Written to ${outPath}.new${RESET2}`);
  } else {
    (0, import_node_fs11.writeFileSync)(outPath, toml);
    console.log(`${GREEN}Written to ${outPath}${RESET2}`);
  }
  console.log();
  for (const entry of entries) {
    const status = entry.enabled ? `${GREEN}enabled${RESET2}` : `${DIM2}disabled${RESET2}`;
    const go = entry.auto_go ? ` ${CYAN}auto_go${RESET2}` : "";
    console.log(`  ${entry.name}: ${status}${go}`);
  }
}
function runLogs() {
  const configPath = getConfigFlag();
  try {
    const config = loadConfig(configPath);
    const log = new Logger(config.orchestrator.log_dir);
    const sessionFilter = subArgs[0];
    const entries = log.readTail(50, sessionFilter);
    if (entries.length === 0) {
      console.log(`${DIM2}No log entries${sessionFilter ? ` for '${sessionFilter}'` : ""}${RESET2}`);
      return;
    }
    for (const entry of entries) {
      const time = entry.ts.slice(11, 23);
      const level = entry.level.toUpperCase().padEnd(5);
      const color = STATUS_COLORS[entry.level] ? "" : entry.level === "error" ? RED : entry.level === "warn" ? YELLOW : entry.level === "info" ? CYAN : DIM2;
      const session = entry.session ? ` ${DIM2}[${entry.session}]${RESET2}` : "";
      console.log(`${DIM2}${time}${RESET2} ${color}${level}${RESET2}${session} ${entry.msg}`);
    }
  } catch (err) {
    console.error(`${RED}${err.message}${RESET2}`);
    process.exit(1);
  }
}
async function runIpcCommand() {
  const configPath = getConfigFlag();
  const client = getClient(configPath);
  const running = await client.isRunning();
  if (!running) {
    console.error(`${RED}Daemon not running. Start with: tmx boot${RESET2}`);
    process.exit(1);
  }
  let cmd;
  switch (command) {
    case "status":
      cmd = { cmd: "status", name: subArgs[0] };
      break;
    case "start":
      cmd = { cmd: "start", name: subArgs[0] };
      break;
    case "stop":
      cmd = { cmd: "stop", name: subArgs[0] };
      break;
    case "restart":
      cmd = { cmd: "restart", name: subArgs[0] };
      break;
    case "health":
      cmd = { cmd: "health" };
      break;
    case "shutdown":
      cmd = { cmd: "shutdown" };
      break;
    case "memory":
      cmd = { cmd: "memory" };
      break;
    case "go":
      if (!subArgs[0]) {
        console.error(`Usage: tmx go <session-name>`);
        process.exit(1);
      }
      cmd = { cmd: "go", name: subArgs[0] };
      break;
    case "send":
      if (!subArgs[0] || !subArgs[1]) {
        console.error(`Usage: tmx send <session-name> <text>`);
        process.exit(1);
      }
      cmd = { cmd: "send", name: subArgs[0], text: subArgs.slice(1).join(" ") };
      break;
    case "tabs":
      cmd = { cmd: "tabs", names: subArgs.length ? subArgs : void 0 };
      break;
    default:
      cmd = { cmd: "status", name: command };
      break;
  }
  const resp = await client.send(cmd);
  if (!resp.ok) {
    console.error(`${RED}${resp.error}${RESET2}`);
    process.exit(1);
  }
  formatOutput(command, resp.data);
}
function formatOutput(cmd, data) {
  if (!data) return;
  switch (cmd) {
    case "status": {
      const d = data;
      if (d.session) {
        const detail = data;
        formatSingleSession(detail.session, detail.config);
      } else {
        formatDaemonStatus(data);
      }
      break;
    }
    case "health": {
      if (Array.isArray(data)) {
        for (const r of data) {
          const icon = r.healthy ? `${GREEN}ok${RESET2}` : `${RED}fail${RESET2}`;
          console.log(`  ${icon}  ${r.session.padEnd(20)} ${r.message} ${DIM2}(${r.duration_ms}ms)${RESET2}`);
        }
        if (data.length === 0) {
          console.log(`${DIM2}No sessions to check${RESET2}`);
        }
      }
      break;
    }
    case "tabs": {
      const t = data;
      console.log(`${GREEN}Restored: ${t.restored}${RESET2}  ${DIM2}Skipped: ${t.skipped}${RESET2}`);
      break;
    }
    case "memory": {
      formatMemory(data);
      break;
    }
    default:
      if (typeof data === "string") {
        console.log(data);
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
  }
}
function formatDaemonStatus(data) {
  const uptimeMs = Date.now() - new Date(data.daemon_start).getTime();
  const uptime = formatDuration(uptimeMs);
  console.log(`${BOLD}tmx daemon${RESET2} ${DIM2}uptime ${uptime}${RESET2}`);
  console.log(`  boot: ${data.boot_complete ? `${GREEN}complete${RESET2}` : `${YELLOW}pending${RESET2}`}`);
  console.log(`  adb:  ${data.adb_fixed ? `${GREEN}fixed${RESET2}` : `${YELLOW}not fixed${RESET2}`}`);
  console.log(`  wake: ${data.wake_lock ? `${GREEN}held${RESET2}` : `${DIM2}released${RESET2}`}`);
  const b = data.budget;
  const budgetColor = b.mode === "critical" ? RED : b.mode === "warning" ? YELLOW : GREEN;
  console.log(`  procs: ${budgetColor}${b.total_procs}/${b.budget}${RESET2} (${b.usage_pct}%)`);
  if (data.memory) {
    const m = data.memory;
    const pressureColor = m.pressure === "emergency" || m.pressure === "critical" ? RED : m.pressure === "warning" ? YELLOW : GREEN;
    console.log(`  mem:   ${pressureColor}${m.available_mb}MB free${RESET2} / ${m.total_mb}MB (${m.pressure})`);
  }
  console.log();
  if (data.sessions?.length > 0) {
    const header = `${"NAME".padEnd(22)} ${"STATUS".padEnd(18)} ${"ACT".padEnd(8)} ${"RSS".padEnd(8)} ${"UPTIME".padEnd(10)} HEALTH`;
    console.log(`${DIM2}${header}${RESET2}`);
    for (const s of data.sessions) {
      const status = STATUS_COLORS[s.status] ?? s.status;
      const uptime2 = s.uptime ?? "-";
      const actIcon = s.activity === "active" ? `${GREEN}run${RESET2}` : s.activity === "idle" ? `${YELLOW}idle${RESET2}` : s.activity === "stopped" ? `${DIM2}stop${RESET2}` : `${DIM2}-${RESET2}`;
      const rss = s.rss_mb != null ? `${s.rss_mb}MB` : "-";
      const health = s.last_health_check ? s.consecutive_failures > 0 ? `${RED}${s.consecutive_failures} fail${RESET2}` : `${GREEN}ok${RESET2}` : `${DIM2}-${RESET2}`;
      console.log(`${s.name.padEnd(22)} ${status.padEnd(27)} ${actIcon.padEnd(17)} ${rss.padEnd(8)} ${uptime2.padEnd(10)} ${health}`);
    }
  }
}
function formatMemory(data) {
  const m = data.system;
  const pressureColor = m.pressure === "emergency" || m.pressure === "critical" ? RED : m.pressure === "warning" ? YELLOW : GREEN;
  console.log(`${BOLD}System Memory${RESET2}`);
  console.log(`  total:     ${m.total_mb} MB`);
  console.log(`  available: ${pressureColor}${m.available_mb} MB${RESET2}`);
  console.log(`  used:      ${m.used_pct}%`);
  console.log(`  pressure:  ${pressureColor}${m.pressure}${RESET2}`);
  if (m.swap_total_mb > 0) {
    console.log(`  swap:      ${m.swap_free_mb}/${m.swap_total_mb} MB free`);
  }
  console.log();
  const sessionsWithRss = data.sessions.filter((s) => s.rss_mb !== null);
  if (sessionsWithRss.length > 0) {
    console.log(`${BOLD}Session Memory${RESET2}`);
    const header = `${"NAME".padEnd(22)} ${"RSS".padEnd(10)} ACTIVITY`;
    console.log(`${DIM2}${header}${RESET2}`);
    sessionsWithRss.sort((a, b) => (b.rss_mb ?? 0) - (a.rss_mb ?? 0));
    let totalRss = 0;
    for (const s of sessionsWithRss) {
      const rss = `${s.rss_mb}MB`;
      const actIcon = s.activity === "active" ? `${GREEN}active${RESET2}` : s.activity === "idle" ? `${YELLOW}idle${RESET2}` : s.activity === "stopped" ? `${DIM2}stopped${RESET2}` : `${DIM2}unknown${RESET2}`;
      console.log(`  ${s.name.padEnd(20)} ${rss.padEnd(10)} ${actIcon}`);
      totalRss += s.rss_mb ?? 0;
    }
    console.log(`${DIM2}${"".padEnd(22)} ${(totalRss + "MB").padEnd(10)} total${RESET2}`);
  } else {
    console.log(`${DIM2}No session memory data available${RESET2}`);
  }
}
function formatSingleSession(session, config) {
  console.log(`${BOLD}${session.name}${RESET2}`);
  console.log(`  status:     ${STATUS_COLORS[session.status] ?? session.status}`);
  console.log(`  type:       ${config?.type ?? "-"}`);
  console.log(`  uptime:     ${session.uptime_start ? formatDuration(Date.now() - new Date(session.uptime_start).getTime()) : "-"}`);
  console.log(`  restarts:   ${session.restart_count}`);
  console.log(`  health:     ${session.last_health_check ? `checked ${timeSince(session.last_health_check)} ago` : "never"}`);
  if (session.consecutive_failures > 0) {
    console.log(`  failures:   ${RED}${session.consecutive_failures}${RESET2}`);
  }
  if (session.last_error) {
    console.log(`  last error: ${RED}${session.last_error}${RESET2}`);
  }
  if (config?.depends_on && config.depends_on.length > 0) {
    console.log(`  depends_on: ${config.depends_on.join(", ")}`);
  }
  if (config?.path) {
    console.log(`  path:       ${DIM2}${config.path}${RESET2}`);
  }
}
function printSessionTable(sessions) {
  const header = `${"NAME".padEnd(22)} ${"TYPE".padEnd(10)} ${"PRI".padEnd(5)} ${"FLAGS".padEnd(20)} DEPS`;
  console.log(`${DIM2}${header}${RESET2}`);
  for (const s of sessions) {
    const flags = [];
    if (!s.enabled) flags.push(`${DIM2}disabled${RESET2}`);
    if (s.auto_go) flags.push(`${CYAN}auto_go${RESET2}`);
    if (s.headless) flags.push(`${DIM2}headless${RESET2}`);
    const flagStr = flags.join(" ") || `${DIM2}-${RESET2}`;
    const deps = s.depends_on?.length > 0 ? s.depends_on.join(", ") : `${DIM2}-${RESET2}`;
    console.log(`${s.name.padEnd(22)} ${s.type.padEnd(10)} ${String(s.priority).padEnd(5)} ${flagStr.padEnd(29)} ${deps}`);
  }
}
function formatDuration(ms) {
  const s = Math.floor(ms / 1e3);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
function timeSince(iso) {
  return formatDuration(Date.now() - new Date(iso).getTime());
}
function getClient(configPath) {
  try {
    const config = loadConfig(configPath);
    return new IpcClient(config.orchestrator.socket);
  } catch {
    const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
    return new IpcClient(`${prefix}/tmp/tmx.sock`);
  }
}
function getConfigFlag() {
  const idx = args.indexOf("--config");
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  const shortIdx = args.indexOf("-c");
  if (shortIdx >= 0 && args[shortIdx + 1]) return args[shortIdx + 1];
  return void 0;
}
function sleep3(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function printHelp() {
  console.log(`${BOLD}tmx${RESET2} \u2014 Tmux session orchestrator for Termux

${BOLD}USAGE${RESET2}
  tmx [command] [args...]

${BOLD}COMMANDS${RESET2}
  ${CYAN}status${RESET2} [name]         Session table with status/uptime/health/restarts
  ${CYAN}start${RESET2} [name]          Start all or one session (resolves dependencies)
  ${CYAN}stop${RESET2} [name]           Graceful stop (reverse dependency order)
  ${CYAN}restart${RESET2} [name]        Stop then start
  ${CYAN}boot${RESET2}                  Full sequence: daemon + ADB fix + start all + cron
  ${CYAN}health${RESET2}                Run health sweep now
  ${CYAN}memory${RESET2}                System memory + per-session RSS + pressure level
  ${CYAN}logs${RESET2} [name]           Tail structured logs
  ${CYAN}tabs${RESET2} [name...]        Restore Termux UI tabs for running sessions
  ${CYAN}config${RESET2}                Validate and print resolved config
  ${CYAN}migrate${RESET2} [path]        Convert repos.conf to tmx.toml
  ${CYAN}go${RESET2} <name>             Send "go" to a Claude session
  ${CYAN}send${RESET2} <name> <text>    Send arbitrary text to a session
  ${CYAN}daemon${RESET2}                Start daemon (foreground)
  ${CYAN}shutdown${RESET2}              Stop everything + release wake lock + exit daemon

${BOLD}OPTIONS${RESET2}
  -c, --config <path>  Config file path (default: ~/.config/tmx/tmx.toml)
  -h, --help           Show this help
  -v, --version        Show version

${BOLD}EXAMPLES${RESET2}
  tmx boot              # Start everything after device boot
  tmx status clev       # Fuzzy match \u2192 cleverkeys status
  tmx go clev           # Send "go" to cleverkeys
  tmx restart play      # Restart playwright
  tmx tabs              # Restore UI tabs for all non-headless sessions
`);
}
function printVersion() {
  try {
    const pkgPath = new URL("../package.json", import_meta_url).pathname;
    const pkg = JSON.parse((0, import_node_fs11.readFileSync)(pkgPath, "utf-8"));
    console.log(`tmx v${pkg.version}`);
  } catch {
    console.log("tmx v0.1.0");
  }
}
