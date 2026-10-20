/**
 * agx — pinned stable/next channels for Google's Antigravity CLI (`agy`) on Termux.
 *
 * Antigravity ships only as a glibc-linked Go binary, so every launch goes through
 * proot with Termux's glibc loader bound to /lib and the Termux resolver bound to
 * /etc/resolv.conf (see scripts/install-antigravity-termux.sh for the full story).
 * Each release lives immutably at <root>/versions/<version>/antigravity; promotion
 * and rollback are single state-file replacements, and the CLI's own background
 * self-updater is disabled per launch so a pinned channel never changes underneath.
 */
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { atomicWrite, downloadVerified, replaceCronEntry, run, shellQuote, validateVersion, VERSION_PATTERN } from "./managed";

/** Environment variable the Antigravity binary honours to skip its background auto-update. */
export const AGX_DISABLE_AUTO_UPDATE = "AGY_CLI_DISABLE_AUTO_UPDATE";
export const AGX_MANIFEST_BASE = "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app";
const CRON_MARKER = "# antigravity-channel agx auto-update";
const SHA512_HEX = /^[0-9a-f]{128}$/i;

export interface AgxRelease { url: string; sha512: string; seenAt: string; }
export interface AgxState { schema: 1; next: string | null; stable: string | null; archive: string[]; catalog: Record<string, AgxRelease>; }
export interface AgxManifest { version: string; url: string; sha512: string; }
export interface AgxContext {
  root: string;            // private release store: <home>/.local/share/antigravity-channel
  prefix: string;          // Termux $PREFIX
  localBin: string;        // launcher directory: <home>/.local/bin
  manifestUrl: string;     // Google's release manifest for this architecture
  legacyBinary: string;    // install-antigravity-termux.sh's binary, importable as the first stable
  proot: string | null;    // proot executable; null execs the binary directly (tests, native hosts)
  loader: string;          // glibc dynamic loader to bind at /lib/<basename>
  resolver: string;        // resolv.conf to bind at /etc/resolv.conf
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
}

/** Keep managed releases separate from the legacy installer, Google's config dir and the Claude/Codex stores. */
export function agxContext(): AgxContext {
  const home = process.env.HOME ?? homedir();
  const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : process.arch;
  return {
    root: path.join(home, ".local/share/antigravity-channel"),
    prefix,
    localBin: path.join(home, ".local/bin"),
    manifestUrl: `${process.env.AGX_MANIFEST_BASE ?? AGX_MANIFEST_BASE}/manifests/linux_${arch}.json`,
    legacyBinary: path.join(home, ".local/lib/antigravity/antigravity"),
    proot: path.join(prefix, "bin/proot"),
    loader: path.join(prefix, "glibc/lib", process.arch === "x64" ? "ld-linux-x86-64.so.2" : "ld-linux-aarch64.so.1"),
    resolver: path.join(prefix, "etc/resolv.conf"),
    fetchImpl: fetch,
  };
}

function isRelease(value: unknown): value is AgxRelease {
  const r = value as AgxRelease;
  return !!r && typeof r === "object" && typeof r.url === "string" && typeof r.sha512 === "string" && typeof r.seenAt === "string";
}

/** Fail closed on corrupt state rather than silently forgetting a working channel. */
export function readAgxState(ctx: AgxContext): AgxState {
  const file = path.join(ctx.root, "state.json");
  if (!existsSync(file)) return { schema: 1, next: null, stable: null, archive: [], catalog: {} };
  const s = JSON.parse(readFileSync(file, "utf8")) as AgxState;
  const versionOk = (v: unknown): boolean => v === null || (typeof v === "string" && VERSION_PATTERN.test(v));
  const catalogOk = !!s?.catalog && typeof s.catalog === "object" && !Array.isArray(s.catalog)
    && Object.entries(s.catalog).every(([v, r]) => VERSION_PATTERN.test(v) && isRelease(r));
  if (!s || s.schema !== 1 || !Array.isArray(s.archive) || !s.archive.every(v => typeof v === "string" && VERSION_PATTERN.test(v))
      || !versionOk(s.next) || !versionOk(s.stable) || !catalogOk) {
    throw new Error("Invalid agx state.json; refusing to replace it");
  }
  return s;
}

export function writeAgxState(ctx: AgxContext, state: AgxState): void {
  atomicWrite(path.join(ctx.root, "state.json"), JSON.stringify(state, null, 2) + "\n");
}

function releaseDir(ctx: AgxContext, version: string): string { return path.join(ctx.root, "versions", validateVersion(version)); }
export function agxBinary(ctx: AgxContext, version: string): string { return path.join(releaseDir(ctx, version), "antigravity"); }

/** Launch environment: no bionic LD_PRELOAD inside the glibc process, and no self-update behind the channel's back. */
export function launchEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined && key !== "LD_PRELOAD") out[key] = value;
  out[AGX_DISABLE_AUTO_UPDATE] = "true";
  return out;
}

/** The argv that runs `binary`: proot binds the glibc loader + resolver and remaps faccessat2 for the Go runtime. */
export function launchArgv(ctx: AgxContext, binary: string, args: string[]): string[] {
  if (!ctx.proot) return [binary, ...args];
  return [ctx.proot, "-b", `${ctx.loader}:/lib/${path.basename(ctx.loader)}`, "-b", `${ctx.resolver}:/etc/resolv.conf`, binary, ...args];
}

/** Read Google's manifest and validate it before anything derives a path or a download from it. */
export async function fetchAgxManifest(ctx: AgxContext): Promise<AgxManifest> {
  const response = await ctx.fetchImpl(ctx.manifestUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Antigravity manifest: HTTP ${response.status}`);
  const data = await response.json() as Partial<AgxManifest>;
  if (typeof data.version !== "string" || typeof data.url !== "string" || typeof data.sha512 !== "string") throw new Error("Antigravity manifest is missing version, url or sha512");
  validateVersion(data.version);
  if (!data.url.startsWith("https://")) throw new Error(`Antigravity manifest download URL must be https: ${data.url}`);
  if (!SHA512_HEX.test(data.sha512)) throw new Error("Antigravity manifest sha512 is not a 128-hex digest");
  return { version: data.version, url: data.url, sha512: data.sha512.toLowerCase() };
}

/**
 * Resolve the version to install. Without a pin this fetches the manifest and records
 * it in the catalog; a pin must already be installed or catalogued, because Google's
 * manifest only ever describes the current release and download URLs embed a build id.
 */
export async function resolveAgx(ctx: AgxContext, pin?: string): Promise<string> {
  if (pin) {
    validateVersion(pin);
    const state = readAgxState(ctx);
    if (existsSync(agxBinary(ctx, pin)) || state.catalog[pin]) return pin;
    throw new Error(`Version ${pin} is not installed and not in the catalog; only releases seen in Google's manifest can be pinned`);
  }
  const manifest = await fetchAgxManifest(ctx);
  const state = readAgxState(ctx);
  const existing = state.catalog[manifest.version];
  if (!existing || existing.url !== manifest.url || existing.sha512 !== manifest.sha512) {
    state.catalog[manifest.version] = { url: manifest.url, sha512: manifest.sha512, seenAt: new Date().toISOString() };
    writeAgxState(ctx, state);
  }
  return manifest.version;
}

/** The binary must report exactly the version its directory claims before any channel points at it. */
export function verifyAgx(ctx: AgxContext, version: string): void {
  const binary = agxBinary(ctx, version);
  if (!existsSync(binary)) throw new Error(`Release ${version} is missing its binary at ${binary}`);
  const [command, ...args] = launchArgv(ctx, binary, ["--version"]);
  const reported = run(command, args, launchEnv()).split("\n")[0].trim();
  if (reported !== version) throw new Error(`Expected antigravity ${version}; got ${reported || "(no output)"}`);
}

/** Download, checksum, unpack and verify a release into an immutable directory; never touches existing releases. */
export async function installAgx(ctx: AgxContext, version: string): Promise<void> {
  validateVersion(version);
  if (existsSync(releaseDir(ctx, version))) { verifyAgx(ctx, version); return; }
  const entry = readAgxState(ctx).catalog[version];
  if (!entry) throw new Error(`No catalogued download for ${version}; run agx update first`);
  mkdirSync(path.join(ctx.root, "versions"), { recursive: true });
  const staging = mkdtempSync(path.join(ctx.root, ".install-"));
  try {
    const payload = path.join(staging, "payload.tar.gz");
    await downloadVerified(ctx.fetchImpl, entry.url, payload, "sha512", entry.sha512);
    const unpacked = path.join(staging, "unpacked");
    mkdirSync(unpacked);
    run("tar", ["-xzf", payload, "-C", unpacked, "antigravity"]);
    const prepared = path.join(staging, "release");
    mkdirSync(prepared);
    renameSync(path.join(unpacked, "antigravity"), path.join(prepared, "antigravity"));
    chmodSync(path.join(prepared, "antigravity"), 0o755);
    // Verification runs against the final layout, but still precedes any channel change.
    renameSync(prepared, releaseDir(ctx, version));
    try { verifyAgx(ctx, version); }
    catch (error) { rmSync(releaseDir(ctx, version), { recursive: true, force: true }); throw error; }
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

/** Update next without touching stable or rewriting an installed binary's inode. */
export async function updateAgx(ctx: AgxContext, pin?: string): Promise<AgxState> {
  const version = await resolveAgx(ctx, pin);
  await installAgx(ctx, version);
  const state = readAgxState(ctx);
  state.next = version;
  writeAgxState(ctx, state);
  return state;
}

/** Switch stable in one state-file replacement, retaining the outgoing version for rollback. */
export function switchAgx(ctx: AgxContext, rollback = false, to?: string): AgxState {
  const state = readAgxState(ctx);
  const version = rollback ? (to ?? state.archive[0]) : state.next;
  if (!version || (rollback && !state.archive.includes(version))) throw new Error(rollback ? "No matching archived version" : "Run agx update first");
  verifyAgx(ctx, version);
  if (state.stable !== version) {
    state.archive = state.archive.filter(v => v !== version && v !== state.stable);
    if (state.stable) state.archive.unshift(state.stable);
    state.stable = version;
    writeAgxState(ctx, state);
  }
  return state;
}

/** List only version-shaped managed directories; staging and foreign files are ignored. */
export function installedAgx(ctx: AgxContext): string[] {
  const root = path.join(ctx.root, "versions");
  return existsSync(root) ? readdirSync(root).filter(v => VERSION_PATTERN.test(v) && lstatSync(path.join(root, v)).isDirectory()).sort() : [];
}

/** Prune never removes next, stable, or the requested number of rollback versions. */
export function pruneAgx(ctx: AgxContext, keep: number, apply: boolean): string[] {
  if (!Number.isSafeInteger(keep) || keep < 0) throw new Error("--keep must be a non-negative integer");
  const state = readAgxState(ctx);
  const protectedVersions = new Set([state.next, state.stable, ...state.archive.slice(0, keep)]);
  const removed = installedAgx(ctx).filter(v => !protectedVersions.has(v));
  if (apply) {
    for (const version of removed) rmSync(releaseDir(ctx, version), { recursive: true });
    state.archive = state.archive.filter(v => !removed.includes(v));
    writeAgxState(ctx, state);
  }
  return removed;
}

/**
 * Adopt the binary left by install-antigravity-termux.sh as a managed release so the
 * pre-agx version stays available for rollback. The legacy file is copied, never moved,
 * and stable is only seeded when no channel exists yet. Returns the imported version.
 */
export function importLegacyAgx(ctx: AgxContext): string | null {
  if (!existsSync(ctx.legacyBinary)) return null;
  const [command, ...args] = launchArgv(ctx, ctx.legacyBinary, ["--version"]);
  const version = validateVersion(run(command, args, launchEnv()).split("\n")[0].trim());
  if (!existsSync(agxBinary(ctx, version))) {
    mkdirSync(path.join(ctx.root, "versions"), { recursive: true });
    const staging = mkdtempSync(path.join(ctx.root, ".import-"));
    try {
      copyFileSync(ctx.legacyBinary, path.join(staging, "antigravity"));
      chmodSync(path.join(staging, "antigravity"), 0o755);
      renameSync(staging, releaseDir(ctx, version));
    } finally { rmSync(staging, { recursive: true, force: true }); }
    verifyAgx(ctx, version);
  }
  const state = readAgxState(ctx);
  if (!state.stable) { state.stable = version; writeAgxState(ctx, state); }
  return version;
}

/** Produce a cron entry with an explicit runtime PATH; scheduled updates only change next. */
export function agxCronLine(ctx: AgxContext, cli: string, hours: number): string {
  if (![1, 2, 3, 4, 6, 8, 12, 24].includes(hours)) throw new Error("--every must be 1, 2, 3, 4, 6, 8, 12, or 24 hours");
  const spec = hours === 24 ? "0 3 * * *" : `0 */${hours} * * *`;
  const command = `PATH=${shellQuote(`${ctx.prefix}/bin:${ctx.localBin}`)} ${shellQuote(`${ctx.prefix}/bin/node`)} ${shellQuote(cli)} update >> ${shellQuote(path.join(ctx.root, "update.log"))} 2>&1`;
  return `${spec} ${command.replaceAll("%", "\\%")} ${CRON_MARKER}`;
}

/** Install (hours given) or remove (hours undefined) the agx cron entry without disturbing other entries. */
export function scheduleAgx(ctx: AgxContext, cli: string, hours?: number): void {
  replaceCronEntry(CRON_MARKER, hours === undefined ? null : agxCronLine(ctx, cli, hours));
}
