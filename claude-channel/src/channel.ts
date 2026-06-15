import { existsSync } from "node:fs";
import type { Ctx } from "./ctx";
import type { Platform } from "./platform/platform";
import type { Channel } from "./types";
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
  platform.writeLauncher("next", binary);
  const reported = await platform.verify("next");
  if (!reported.startsWith(target)) {
    throw new Error(`verify failed: claude-next reports "${reported}", expected ${target}`);
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
