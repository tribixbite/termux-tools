import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { PATCH_TARGETS, patchBuffer, RESOLV_CONTENT, RESOLV_FROM, RESOLV_REDIRECT_PATH } from "./patch";

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const TRIPLE = "aarch64-unknown-linux-musl";
export interface CodexState { schema: 1; next: string | null; stable: string | null; archive: string[]; }
export interface CodexContext { root: string; prefix: string; localBin: string; resolver: string; fetchImpl: (url: string, init?: RequestInit) => Promise<Response>; }
/** Keep managed packages separate from authentication, configuration, and Bun globals. */
export function codexContext(): CodexContext {
  const home = process.env.HOME ?? homedir();
  return { root: path.join(home, ".local/share/codex-channel"), prefix: process.env.PREFIX ?? "/data/data/com.termux/files/usr", localBin: path.join(home, ".local/bin"), resolver: RESOLV_REDIRECT_PATH, fetchImpl: fetch };
}
/** Reject paths and malformed versions before constructing install paths. */
export function validateVersion(version: string): string {
  if (!VERSION.test(version)) throw new Error(`Invalid version: ${version}`);
  return version;
}
/** Fail closed on corrupt state rather than silently forgetting a working channel. */
export function readCodexState(ctx: CodexContext): CodexState {
  const file = path.join(ctx.root, "state.json");
  if (!existsSync(file)) return { schema: 1, next: null, stable: null, archive: [] };
  const s = JSON.parse(readFileSync(file, "utf8")) as CodexState;
  if (!s || s.schema !== 1 || !Array.isArray(s.archive) || !s.archive.every(v => typeof v === "string" && VERSION.test(v)) || ![s.next, s.stable].every(v => v === null || typeof v === "string" && VERSION.test(v))) throw new Error("Invalid cdx state.json; refusing to replace it");
  return s;
}
/** Replace a file by rename, never by truncating an inode used by a running process. */
export function atomicWrite(file: string, contents: string, mode = 0o600): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const dir = mkdtempSync(path.join(path.dirname(file), ".cdx-write-"));
  try { const tmp = path.join(dir, "file"); writeFileSync(tmp, contents, { mode }); renameSync(tmp, file); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
/** Serialize mutations with an atomic directory lock; never steal a live or ambiguous lock. */
export async function codexLock<T>(ctx: CodexContext, action: () => Promise<T>): Promise<T> {
  mkdirSync(ctx.root, { recursive: true });
  const lock = path.join(ctx.root, ".lock");
  try { mkdirSync(lock); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; throw new Error(`Another cdx mutation holds ${lock}. Check its owner.json before removing a stale lock.`); }
  try { writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, started: new Date().toISOString() })); return await action(); }
  finally { rmSync(lock, { recursive: true, force: true }); }
}
function release(ctx: CodexContext, version: string): string { return path.join(ctx.root, "versions", validateVersion(version)); }
export function codexBinary(ctx: CodexContext, version: string): string { return path.join(release(ctx, version), "bin/codex"); }
function run(command: string, args: string[], env = process.env): string {
  const result = spawnSync(command, args, { encoding: "utf8", env, timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal}): ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
/** Resolve the official stable registry tag; pin installs never guess platform versions. */
export async function resolveCodex(ctx: CodexContext, pin?: string): Promise<string> {
  if (pin) return validateVersion(pin);
  const response = await ctx.fetchImpl("https://registry.npmjs.org/@openai/codex/latest", { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Codex registry: HTTP ${response.status}`);
  const data = await response.json() as { version?: string };
  return validateVersion(data.version ?? "");
}
/** Patch only resolver literals. Prompt directives from the shared patcher are preserved. */
export function patchCodex(buffer: Buffer): void {
  const result = patchBuffer(buffer, PATCH_TARGETS);
  if (!(result.occurrences[RESOLV_FROM] || buffer.includes(Buffer.from(RESOLV_REDIRECT_PATH)))) throw new Error("Codex resolver layout changed; refusing to install an unpatched release");
}
/** Check both the executable and required foreground compatibility before activation. */
export function verifyCodex(ctx: CodexContext, version: string): void {
  const binary = codexBinary(ctx, version);
  const actual = run(binary, ["--version"]);
  if (actual !== `codex-cli ${version}`) throw new Error(`Expected codex-cli ${version}; got ${actual}`);
  const features = run(binary, ["features", "list"]);
  if (!/^daemon_auto_start\s/m.test(features)) throw new Error("Release lacks daemon_auto_start compatibility setting; review before activation");
  const rg = path.join(release(ctx, version), "codex-path/rg");
  if (lstatSync(rg).isSymbolicLink()) throw new Error("Bundled ripgrep must be a regular file");
  run(rg, ["--version"]);
}
/** Fetch using Bun's package integrity checks, then patch a private immutable release. */
export async function installCodex(ctx: CodexContext, version: string): Promise<void> {
  validateVersion(version);
  if (existsSync(release(ctx, version))) { verifyCodex(ctx, version); return; }
  if (process.arch !== "arm64" || !existsSync(path.join(ctx.prefix, "bin/bash"))) throw new Error("cdx currently supports ARM64 Termux only");
  mkdirSync(path.join(ctx.root, "versions"), { recursive: true });
  const staging = mkdtempSync(path.join(ctx.root, ".install-"));
  try {
    const env = { ...process.env }; delete env.BUN_BINARY_PATH;
    run("bun", ["add", "--cwd", staging, "--ignore-scripts", "--exact", `@openai/codex@${version}`], env);
    const vendor = path.join(staging, "node_modules/@openai/codex-linux-arm64/vendor", TRIPLE);
    const prepared = path.join(staging, "release");
    cpSync(vendor, prepared, { recursive: true, dereference: true });
    const bin = path.join(prepared, "bin/codex");
    const contents = readFileSync(bin); patchCodex(contents); writeFileSync(bin, contents);
    mkdirSync(path.join(prepared, "codex-path"), { recursive: true });
    copyFileSync(path.join(ctx.prefix, "bin/rg"), path.join(prepared, "codex-path/rg"));
    if (!existsSync(ctx.resolver) || readFileSync(ctx.resolver).length === 0) writeFileSync(ctx.resolver, RESOLV_CONTENT);
    // Verification uses the exact final layout but still precedes any channel change.
    renameSync(prepared, release(ctx, version));
    try { verifyCodex(ctx, version); }
    catch (error) { rmSync(release(ctx, version), { recursive: true, force: true }); throw error; }
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
/** Update next without touching stable or rewriting existing installed binaries. */
export async function updateCodex(ctx: CodexContext, pin?: string): Promise<CodexState> {
  const version = await resolveCodex(ctx, pin);
  await installCodex(ctx, version);
  const state = readCodexState(ctx); state.next = version;
  atomicWrite(path.join(ctx.root, "state.json"), JSON.stringify(state, null, 2) + "\n");
  return state;
}
/** Switch stable in one state-file replacement, retaining the outgoing version. */
export function switchCodex(ctx: CodexContext, rollback = false, to?: string): CodexState {
  const state = readCodexState(ctx);
  const version = rollback ? (to ?? state.archive[0]) : state.next;
  if (!version || rollback && !state.archive.includes(version)) throw new Error(rollback ? "No matching archived version" : "Run cdx update first");
  verifyCodex(ctx, version);
  if (state.stable !== version) {
    state.archive = state.archive.filter(v => v !== version && v !== state.stable);
    if (state.stable) state.archive.unshift(state.stable);
    state.stable = version;
    atomicWrite(path.join(ctx.root, "state.json"), JSON.stringify(state, null, 2) + "\n");
  }
  return state;
}
/** List only version-shaped managed directories; leave staging and unrelated files alone. */
export function installedCodex(ctx: CodexContext): string[] {
  const root = path.join(ctx.root, "versions");
  return existsSync(root) ? readdirSync(root).filter(v => VERSION.test(v) && lstatSync(path.join(root, v)).isDirectory()).sort() : [];
}
/** Prune never removes next, stable, or the requested number of rollback versions. */
export function pruneCodex(ctx: CodexContext, keep: number, apply: boolean): string[] {
  if (!Number.isSafeInteger(keep) || keep < 0) throw new Error("--keep must be a non-negative integer");
  const state = readCodexState(ctx);
  const protectedVersions = new Set([state.next, state.stable, ...state.archive.slice(0, keep)]);
  const removed = installedCodex(ctx).filter(v => !protectedVersions.has(v));
  if (apply) {
    for (const version of removed) rmSync(release(ctx, version), { recursive: true });
    state.archive = state.archive.filter(v => !removed.includes(v));
    atomicWrite(path.join(ctx.root, "state.json"), JSON.stringify(state, null, 2) + "\n");
  }
  return removed;
}

const CRON_MARKER = "# codex-channel cdx auto-update";
function shellQuote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }
/** Produce a cron entry with an explicit runtime PATH; scheduled updates only change next. */
export function codexCronLine(ctx: CodexContext, cli: string, hours: number): string {
  if (![1, 2, 3, 4, 6, 8, 12, 24].includes(hours)) throw new Error("--every must be 1, 2, 3, 4, 6, 8, 12, or 24 hours");
  const home = path.dirname(path.dirname(ctx.localBin));
  const spec = hours === 24 ? "0 3 * * *" : `0 */${hours} * * *`;
  const command = `PATH=${shellQuote(`${ctx.prefix}/bin:${home}/.bun/bin:${ctx.localBin}`)} ${shellQuote(`${ctx.prefix}/bin/node`)} ${shellQuote(cli)} update >> ${shellQuote(path.join(ctx.root, "update.log"))} 2>&1`;
  return `${spec} ${command.replaceAll("%", "\\%")} ${CRON_MARKER}`;
}
/** Preserve unrelated cron entries and fail on access/tool errors instead of clearing them. */
export function scheduleCodex(ctx: CodexContext, cli: string, hours?: number): void {
  const entry = hours === undefined ? null : codexCronLine(ctx, cli, hours);
  const previous = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  if (previous.error) throw previous.error;
  if (previous.status !== 0 && !/no crontab for/i.test(previous.stderr)) throw new Error(`Cannot read crontab: ${previous.stderr}`);
  const lines = previous.stdout.split("\n").filter(line => !line.endsWith(CRON_MARKER));
  while (lines.at(-1) === "") lines.pop();
  if (entry) lines.push(entry);
  const result = spawnSync("crontab", ["-"], { encoding: "utf8", input: lines.length ? lines.join("\n") + "\n" : "" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Cannot write crontab: ${result.stderr}`);
}
