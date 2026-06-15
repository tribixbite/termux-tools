import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "./ctx";
import type { Platform } from "./platform/platform";
import type { Channel, ArchiveEntry } from "./types";
import { loadState, saveState } from "./state";

const nowIso = (): string => new Date().toISOString();

export interface UpdateResult { action: "updated" | "current"; from: string | null; to: string; }
export async function update(platform: Platform, ctx: Ctx, channel: Channel = "latest", pin?: string): Promise<UpdateResult> {
  const state = loadState(ctx);
  const target = pin ?? (await platform.resolveLatest(channel));
  if (state.next && state.next.version === target && existsSync(state.next.binary)) {
    return { action: "current", from: state.next.version, to: target };
  }
  const binary = await platform.fetchBinary(target);
  const priorNext = platform.readLauncherBinary("next");
  platform.writeLauncher("next", binary);
  try {
    const reported = await platform.verify("next");
    if (!reported.startsWith(target)) {
      throw new Error(`verify failed: claude-next reports "${reported}", expected ${target}`);
    }
  } catch (e) {
    if (priorNext) platform.writeLauncher("next", priorNext); // don't leave next pointing at an unverified binary
    throw e;
  }
  const from = state.next?.version ?? null;
  state.next = { version: target, binary, patched: true, updatedAt: nowIso() };
  saveState(ctx, state);
  return { action: "updated", from, to: target };
}

export interface PromoteResult { action: "promoted" | "noop"; from: string | null; to: string; }
export function promote(platform: Platform, ctx: Ctx): PromoteResult {
  const state = loadState(ctx);
  if (!state.next) throw new Error("no 'next' channel installed — run `ccx update` first");
  if (state.stable && state.stable.version === state.next.version) {
    return { action: "noop", from: state.stable.version, to: state.next.version };
  }
  if (state.stable) {
    state.archive.unshift({
      version: state.stable.version, binary: state.stable.binary,
      promotedAt: state.stable.promotedAt, archivedAt: nowIso(),
    });
  }
  platform.writeLauncher("stable", state.next.binary);
  const from = state.stable?.version ?? null;
  state.stable = { version: state.next.version, binary: state.next.binary, patched: state.next.patched, promotedAt: nowIso() };
  saveState(ctx, state);
  return { action: "promoted", from, to: state.next.version };
}

export interface RollbackResult { to: string; refetched: boolean; }
export async function rollback(platform: Platform, ctx: Ctx, toVersion?: string): Promise<RollbackResult> {
  const state = loadState(ctx);
  if (state.archive.length === 0) throw new Error("nothing to roll back to (empty archive)");
  const idx = toVersion ? state.archive.findIndex((a) => a.version === toVersion) : 0;
  if (idx < 0) throw new Error(`version ${toVersion} not in archive`);
  const target = state.archive[idx];
  let binary = target.binary;
  let refetched = false;
  if (!existsSync(binary)) { binary = await platform.fetchBinary(target.version); refetched = true; }
  platform.writeLauncher("stable", binary);
  state.archive.splice(idx, 1);
  state.stable = { version: target.version, binary, patched: true, promotedAt: nowIso() };
  saveState(ctx, state);
  return { to: target.version, refetched };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export interface StatusInfo {
  next: { version: string; binary: string } | null;
  stable: { version: string; binary: string } | null;
  channelLatest: string | null;
  channelStable: string | null;
  updateAvailable: boolean;
  pathOk: boolean;
  nextHasAutoupdaterOff: boolean;
}
export async function status(platform: Platform, ctx: Ctx): Promise<StatusInfo> {
  const state = loadState(ctx);
  let channelLatest: string | null = null;
  let channelStable: string | null = null;
  try { channelLatest = await platform.resolveLatest("latest"); } catch { /* offline */ }
  try { channelStable = await platform.resolveLatest("stable"); } catch { /* offline */ }
  const updateAvailable = !!(channelLatest && (!state.next || compareVersions(channelLatest, state.next.version) > 0));
  return {
    next: state.next ? { version: state.next.version, binary: state.next.binary } : null,
    stable: state.stable ? { version: state.stable.version, binary: state.stable.binary } : null,
    channelLatest, channelStable, updateAvailable,
    pathOk: platform.pathPrecedenceOk(),
    nextHasAutoupdaterOff: hasAutoupdaterOff(ctx),
  };
}

function hasAutoupdaterOff(ctx: Ctx): boolean {
  const p = path.join(ctx.localBin, "claude-next");
  if (!existsSync(p)) return true; // nothing installed yet — nothing to warn about
  try {
    return readFileSync(p, "utf8").includes("DISABLE_AUTOUPDATER=1");
  } catch {
    return false;
  }
}

function installedDirs(ctx: Ctx): string[] {
  try {
    return readdirSync(ctx.binariesDir)
      .filter((n) => n.startsWith("claude-"))
      .map((n) => path.join(ctx.binariesDir, n))
      .filter((d) => statSync(d).isDirectory());
  } catch { return []; }
}

export function list(ctx: Ctx): { installed: string[]; archive: ArchiveEntry[] } {
  const installed = installedDirs(ctx).map((d) => path.basename(d).replace(/^claude-/, ""));
  return { installed, archive: loadState(ctx).archive };
}

export interface PruneResult { removed: string[]; kept: string[]; }
export function prune(ctx: Ctx, keep = 2): PruneResult {
  const state = loadState(ctx);
  const protectedBins = new Set<string>();
  if (state.next) protectedBins.add(state.next.binary);
  if (state.stable) protectedBins.add(state.stable.binary);
  for (const a of state.archive.slice(0, keep)) protectedBins.add(a.binary);
  const removed: string[] = [];
  for (const dir of installedDirs(ctx)) {
    const bin = path.join(dir, "claude-binary");
    if (!protectedBins.has(bin)) { rmSync(dir, { recursive: true, force: true }); removed.push(dir); }
  }
  return { removed, kept: [...protectedBins] };
}
