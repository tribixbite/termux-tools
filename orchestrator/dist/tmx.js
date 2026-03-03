#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
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
var require_import_meta_shim = __commonJS({
  "src/import-meta-shim.js"(exports2, module2) {
    "use strict";
    var import_meta_url2 = require("url").pathToFileURL(__filename).href;
    module2.exports = { import_meta_url: import_meta_url2 };
  }
});

// src/tmx.ts
var import_import_meta_shim13 = __toESM(require_import_meta_shim());
var import_node_fs6 = require("node:fs");
var import_node_child_process6 = require("node:child_process");

// src/ipc.ts
var import_import_meta_shim = __toESM(require_import_meta_shim());
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
      const resp = await this.send({ cmd: "status" });
      return resp.ok;
    } catch {
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
var import_import_meta_shim11 = __toESM(require_import_meta_shim());
var import_node_child_process5 = require("node:child_process");

// src/config.ts
var import_import_meta_shim2 = __toESM(require_import_meta_shim());
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
    )
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
    phantom_fix: asBool(adbRaw.phantom_fix, "adb.phantom_fix", true)
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
var import_import_meta_shim3 = __toESM(require_import_meta_shim());
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
var import_import_meta_shim5 = __toESM(require_import_meta_shim());
var import_node_fs4 = require("node:fs");
var import_node_path = require("node:path");

// src/types.ts
var import_import_meta_shim4 = __toESM(require_import_meta_shim());
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
    tmux_pid: null
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
var import_import_meta_shim6 = __toESM(require_import_meta_shim());
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
var import_import_meta_shim7 = __toESM(require_import_meta_shim());
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
var import_import_meta_shim8 = __toESM(require_import_meta_shim());
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
var import_import_meta_shim10 = __toESM(require_import_meta_shim());
var import_node_child_process4 = require("node:child_process");

// src/session.ts
var import_import_meta_shim9 = __toESM(require_import_meta_shim());
var import_node_child_process3 = require("node:child_process");
var CLAUDE_READY_TIMEOUT = 3e4;
var CLAUDE_POLL_INTERVAL = 500;
var CLAUDE_READY_PATTERNS = [
  />\s*$/,
  // prompt indicator
  /\$\s*$/,
  // shell prompt (fallback)
  /claude\s*>/i
  // claude prompt
];
var GO_SEND_DELAY = 500;
function tmux(...args2) {
  try {
    return (0, import_node_child_process3.execSync)(`tmux ${args2.join(" ")}`, {
      encoding: "utf-8",
      timeout: 1e4,
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch {
    return null;
  }
}
function isTmuxServerAlive() {
  const result = (0, import_node_child_process3.spawnSync)("tmux", ["start-server"], {
    timeout: 5e3,
    stdio: "ignore"
  });
  return result.status === 0;
}
function listTmuxSessions() {
  const output = tmux("list-sessions", "-F", "'#{session_name}'");
  if (!output) return [];
  return output.split("\n").map((s) => s.replace(/'/g, "").trim()).filter(Boolean);
}
function sessionExists(name) {
  const result = (0, import_node_child_process3.spawnSync)("tmux", ["has-session", "-t", name], {
    timeout: 5e3,
    stdio: "ignore"
  });
  return result.status === 0;
}
function capturePane(sessionName, lines = 5) {
  const output = tmux("capture-pane", "-t", sessionName, "-p", "-l", String(lines));
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
  const result = (0, import_node_child_process3.spawnSync)("tmux", createArgs, {
    timeout: 1e4,
    stdio: "ignore"
  });
  if (result.status !== 0) {
    log.error(`Failed to create tmux session '${name}'`, { session: name });
    return false;
  }
  log.info(`Created tmux session '${name}'`, { session: name, type, path });
  switch (type) {
    case "claude":
      sendKeys(name, "cc", true);
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
      return false;
    }
    const pane = capturePane(name, 10);
    for (const pattern of CLAUDE_READY_PATTERNS) {
      if (pattern.test(pane)) {
        const elapsed = Date.now() - start;
        log.debug(`Session '${name}' ready in ${elapsed}ms`, { session: name, elapsed });
        return true;
      }
    }
    await sleep(CLAUDE_POLL_INTERVAL);
  }
  log.warn(`Session '${name}' readiness timeout after ${CLAUDE_READY_TIMEOUT}ms`, { session: name });
  return false;
}
async function sendGoToSession(name, log) {
  const ready = await waitForClaudeReady(name, log);
  if (!ready) {
    log.warn(`Skipping 'go' for '${name}' \u2014 not ready`, { session: name });
    return false;
  }
  await sleep(GO_SEND_DELAY);
  if (sendKeys(name, "go", true)) {
    log.info(`Sent 'go' to '${name}'`, { session: name });
    return true;
  }
  return false;
}
async function stopSession(name, log, timeoutMs = 1e4) {
  if (!sessionExists(name)) {
    log.debug(`Session '${name}' not running, nothing to stop`, { session: name });
    return true;
  }
  tmux("send-keys", "-t", name, "C-c", "");
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
  const attachCmd = `printf '\\033]0;${sessionName}\\007' && tmux attach -t '${sessionName}'`;
  const amResult = (0, import_node_child_process3.spawnSync)("termux-am", [
    "start",
    "-n",
    "com.termux/.app.TermuxActivity",
    "--es",
    "com.termux.execute.background",
    "true",
    "-e",
    "com.termux.execute.command",
    attachCmd
  ], {
    timeout: 5e3,
    stdio: "ignore"
  });
  if (amResult.status === 0) {
    log.debug(`Created Termux tab for '${sessionName}' via termux-am`, { session: sessionName });
    return true;
  }
  const svcResult = (0, import_node_child_process3.spawnSync)("am", [
    "startservice",
    "-n",
    "com.termux/com.termux.app.RunCommandService",
    "-a",
    "com.termux.RUN_COMMAND",
    "--es",
    "com.termux.RUN_COMMAND_PATH",
    "/data/data/com.termux/files/usr/bin/bash",
    "--esa",
    "com.termux.RUN_COMMAND_ARGUMENTS",
    `-c,${attachCmd}`,
    "--ez",
    "com.termux.RUN_COMMAND_BACKGROUND",
    "false",
    "--es",
    "com.termux.RUN_COMMAND_SESSION_ACTION",
    "0"
  ], {
    timeout: 5e3,
    stdio: "ignore"
  });
  if (svcResult.status === 0) {
    log.debug(`Created Termux tab for '${sessionName}' via RunCommandService`, { session: sessionName });
    return true;
  }
  log.error(`Failed to create Termux tab for '${sessionName}'`, { session: sessionName });
  return false;
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
        return httpCheck(sessionName, healthConfig.url, start);
      case "process":
        return processCheck(sessionName, healthConfig.process_pattern, start);
      case "custom":
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
    if (result.healthy) {
      if (s.status === "degraded") {
        state.transition(session.name, "starting");
        log.info(`Session '${session.name}' recovered`, { session: session.name });
      }
    } else {
      log.warn(`Health check failed for '${session.name}': ${result.message}`, {
        session: session.name,
        consecutive_failures: s.consecutive_failures + 1,
        threshold: healthConfig.unhealthy_threshold
      });
      if (s.consecutive_failures + 1 >= healthConfig.unhealthy_threshold) {
        if (s.status === "running") {
          state.transition(session.name, "degraded");
        } else if (s.status === "degraded") {
          if (s.restart_count >= session.max_restarts) {
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

// src/daemon.ts
function sleep2(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function notify(title, content) {
  try {
    (0, import_node_child_process5.spawnSync)("termux-notification", ["--title", title, "--content", content], {
      timeout: 5e3,
      stdio: "ignore"
    });
  } catch {
  }
}
var Daemon = class {
  config;
  log;
  state;
  ipc;
  budget;
  wake;
  healthTimer = null;
  adbRetryTimer = null;
  running = false;
  constructor(configPath) {
    this.config = loadConfig(configPath);
    this.log = new Logger(this.config.orchestrator.log_dir);
    this.state = new StateManager(this.config.orchestrator.state_file, this.log);
    this.budget = new BudgetTracker(this.config.orchestrator.process_budget, this.log);
    this.wake = new WakeLockManager(this.config.orchestrator.wake_lock_policy, this.log);
    this.ipc = new IpcServer(
      this.config.orchestrator.socket,
      (cmd) => this.handleIpcCommand(cmd),
      this.log
    );
  }
  /** Start the daemon — main entry point */
  async start() {
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
    if (this.config.adb.enabled) {
      await this.fixAdb();
    }
    await this.startAllSessions();
    this.startCron();
    this.state.setBootComplete(true);
    this.wake.evaluate("boot_end", this.state.getState().sessions);
    const sessionCount = this.config.sessions.filter((s) => s.enabled).length;
    const runningCount = Object.values(this.state.getState().sessions).filter((s) => s.status === "running").length;
    this.log.info(`Boot complete: ${runningCount}/${sessionCount} sessions running`);
    notify("tmx boot", `${runningCount}/${sessionCount} sessions running`);
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
    if (this.adbRetryTimer) {
      clearInterval(this.adbRetryTimer);
      this.adbRetryTimer = null;
    }
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
    this.ipc.stop();
    this.running = false;
    this.log.info("Shutdown complete");
    notify("tmx", "Orchestrator stopped");
  }
  // -- Session management -----------------------------------------------------
  /** Start all enabled sessions in dependency order */
  async startAllSessions() {
    const batches = computeStartupOrder(this.config.sessions);
    for (const batch of batches) {
      this.log.info(`Starting batch depth=${batch.depth}: ${batch.sessions.join(", ")}`);
      const startPromises = batch.sessions.map((name) => this.startSession(name));
      await Promise.all(startPromises);
      await sleep2(500);
    }
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
    if (config.auto_go) {
      const sent = await sendGoToSession(name, this.log);
      if (!sent) {
        this.log.warn(`Failed to send 'go' to '${name}' \u2014 Claude may not be ready`, { session: name });
      }
    }
    const s = this.state.getSession(name);
    if (s?.status === "starting") {
      this.state.transition(name, "running");
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
    this.wake.evaluate("session_change", this.state.getState().sessions);
    return stopped;
  }
  /** Adopt existing tmux sessions on daemon restart */
  adoptExistingSessions() {
    if (!isTmuxServerAlive()) return;
    const existingSessions = listTmuxSessions();
    const configuredNames = new Set(this.config.sessions.map((s) => s.name));
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
  // -- ADB fix ----------------------------------------------------------------
  /** Attempt ADB connection and apply phantom process killer fix */
  async fixAdb() {
    this.log.info("Attempting ADB connection for phantom process fix");
    const { connect_script, connect_timeout_s, phantom_fix } = this.config.adb;
    try {
      const result = (0, import_node_child_process5.spawnSync)("timeout", [String(connect_timeout_s), connect_script], {
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
  /** Apply Android 12+ phantom process killer fix via ADB */
  applyPhantomFix() {
    const commands = [
      'adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647"',
      'adb shell "settings put global settings_enable_monitor_phantom_procs false"'
    ];
    const samsungPkgs = [
      "com.samsung.android.ssco",
      "com.samsung.android.mocca",
      "com.samsung.android.camerasdkservice"
    ];
    for (const cmd of commands) {
      try {
        (0, import_node_child_process5.execSync)(cmd, { timeout: 1e4, stdio: "ignore" });
      } catch (err) {
        this.log.warn(`Phantom fix command failed: ${cmd}`, { error: String(err) });
      }
    }
    for (const pkg of samsungPkgs) {
      try {
        (0, import_node_child_process5.execSync)(`adb shell "pm enable ${pkg}"`, { timeout: 1e4, stdio: "ignore" });
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
      setTimeout(async () => {
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
    }
    const budgetStatus = this.budget.check();
    if (budgetStatus.mode === "critical") {
      this.log.error("Process budget critical", budgetStatus);
      notify("tmx budget", `Critical: ${budgetStatus.total_procs}/${budgetStatus.budget} processes`);
    }
  }
  // -- Cron -------------------------------------------------------------------
  /** Start crond if not already running */
  startCron() {
    try {
      const result = (0, import_node_child_process5.spawnSync)("pgrep", ["-x", "crond"], { timeout: 5e3, stdio: "ignore" });
      if (result.status !== 0) {
        (0, import_node_child_process5.spawnSync)("crond", ["-s", "-P"], { timeout: 5e3, stdio: "ignore" });
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
  /** Go command — send "go" to a Claude session */
  async cmdGo(name) {
    const resolved = this.resolveName(name);
    if (!resolved) return { ok: false, error: `Unknown session: ${name}` };
    const sent = await sendGoToSession(resolved, this.log);
    return { ok: sent, data: sent ? `Sent 'go' to '${resolved}'` : `Failed to send 'go' to '${resolved}'` };
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
    const targetSessions = names?.length ? names.map((n) => this.resolveName(n)).filter(Boolean) : this.config.sessions.filter((s) => !s.headless && s.enabled).map((s) => s.name);
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
var import_import_meta_shim12 = __toESM(require_import_meta_shim());
var import_node_fs5 = require("node:fs");
function parseReposConf(filePath) {
  if (!(0, import_node_fs5.existsSync)(filePath)) {
    throw new Error(`repos.conf not found at: ${filePath}`);
  }
  const content = (0, import_node_fs5.readFileSync)(filePath, "utf-8");
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
  return candidates.find(import_node_fs5.existsSync) ?? null;
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
    const child = (0, import_node_child_process6.spawn)(process.argv[0], [process.argv[1], ...daemonArgs], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    for (let i = 0; i < 20; i++) {
      await sleep3(500);
      if (await client.isRunning()) break;
    }
    if (!await client.isRunning()) {
      console.error(`${RED}Daemon failed to start${RESET2}`);
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
  console.log();
  console.log(`${BOLD}ADB${RESET2}`);
  console.log(`  enabled:     ${config.adb.enabled}`);
  console.log(`  phantom_fix: ${config.adb.phantom_fix}`);
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
  if (!(0, import_node_fs6.existsSync)(outDir)) {
    (0, import_node_fs6.mkdirSync)(outDir, { recursive: true });
  }
  if ((0, import_node_fs6.existsSync)(outPath)) {
    console.log(`${YELLOW}${outPath} already exists \u2014 writing to ${outPath}.new${RESET2}`);
    (0, import_node_fs6.writeFileSync)(`${outPath}.new`, toml);
    console.log(`${GREEN}Written to ${outPath}.new${RESET2}`);
  } else {
    (0, import_node_fs6.writeFileSync)(outPath, toml);
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
  console.log();
  if (data.sessions?.length > 0) {
    const header = `${"NAME".padEnd(22)} ${"STATUS".padEnd(18)} ${"UPTIME".padEnd(10)} ${"RESTARTS".padEnd(10)} HEALTH`;
    console.log(`${DIM2}${header}${RESET2}`);
    for (const s of data.sessions) {
      const status = STATUS_COLORS[s.status] ?? s.status;
      const uptime2 = s.uptime ?? "-";
      const restarts = s.restart_count > 0 ? `${YELLOW}${s.restart_count}${RESET2}` : `${DIM2}0${RESET2}`;
      const health = s.last_health_check ? s.consecutive_failures > 0 ? `${RED}${s.consecutive_failures} fail${RESET2}` : `${GREEN}ok${RESET2}` : `${DIM2}-${RESET2}`;
      console.log(`${s.name.padEnd(22)} ${status.padEnd(27)} ${uptime2.padEnd(10)} ${restarts.padEnd(19)} ${health}`);
    }
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
    const pkg = JSON.parse((0, import_node_fs6.readFileSync)(pkgPath, "utf-8"));
    console.log(`tmx v${pkg.version}`);
  } catch {
    console.log("tmx v0.1.0");
  }
}
