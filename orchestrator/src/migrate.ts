/**
 * migrate.ts — Convert repos.conf (bash associative array) to operad.toml
 *
 * Parses the old-format repos.conf and generates a valid TOML config
 * for the operad orchestrator.
 */

import { existsSync, readFileSync } from "node:fs";

/** Parsed entry from repos.conf */
interface RepoEntry {
  path: string;
  name: string;
  auto_go: boolean;
  enabled: boolean;
}

/**
 * Parse a repos.conf file (bash associative array format).
 *
 * Expected format:
 *   declare -A REPOS
 *   REPOS["$HOME/git/project"]="auto_go:enabled"  # 1:1 or 0:1 etc.
 */
export function parseReposConf(filePath: string): RepoEntry[] {
  if (!existsSync(filePath)) {
    throw new Error(`repos.conf not found at: ${filePath}`);
  }

  const content = readFileSync(filePath, "utf-8");
  const entries: RepoEntry[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip comments, blanks, and non-REPOS lines
    if (!trimmed || trimmed.startsWith("#") || !trimmed.startsWith("REPOS[")) continue;

    // Parse: REPOS["$HOME/git/project"]="auto_go:enabled"
    const match = trimmed.match(/^REPOS\["([^"]+)"\]\s*=\s*"([^"]+)"/);
    if (!match) continue;

    const [, rawPath, config] = match;
    const [autoGoStr, enabledStr] = config.split(":");

    // Expand $HOME in path
    const path = rawPath.replace(/\$HOME/g, process.env.HOME ?? "~");
    const name = path.split("/").pop() ?? "unknown";

    entries.push({
      path: rawPath, // Keep $HOME unexpanded for TOML
      name: name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      auto_go: autoGoStr === "1",
      enabled: enabledStr === "1",
    });
  }

  return entries;
}

/** Generate TOML content from parsed repos.conf entries */
export function generateToml(entries: RepoEntry[]): string {
  const lines: string[] = [
    "# operad.toml — Generated from repos.conf by `operad migrate`",
    `# Generated at ${new Date().toISOString()}`,
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
    "# ─── Sessions (migrated from repos.conf) ─────────────────────────────────────",
    "",
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

  // Add standard service sessions
  lines.push(
    "# ─── Standard services ────────────────────────────────────────────────────────",
    "",
    "[[session]]",
    'name = "termux-x11"',
    'type = "service"',
    "command = \"termux-x11 :1 -legacy-drawing -xstartup 'xfce4-session'\"",
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
    "",
  );

  return lines.join("\n");
}

/** Find repos.conf in standard locations */
export function findReposConf(): string | null {
  const candidates = [
    `${process.env.HOME}/.config/termux-boot/repos.conf`,
    `${process.env.HOME}/.termux/boot/repos.conf`,
  ];
  return candidates.find(existsSync) ?? null;
}
