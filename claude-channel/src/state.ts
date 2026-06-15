import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "./ctx";
import type { ChannelState } from "./types";

export function statePath(ctx: Ctx): string {
  return path.join(ctx.binariesDir, "channel-state.json");
}

export function emptyState(): ChannelState {
  return { schema: 1, next: null, stable: null, archive: [] };
}

export function loadState(ctx: Ctx): ChannelState {
  const p = statePath(ctx);
  if (!existsSync(p)) return emptyState();
  try {
    const s = JSON.parse(readFileSync(p, "utf8")) as ChannelState;
    if (s.schema !== 1) return emptyState();
    return { schema: 1, next: s.next ?? null, stable: s.stable ?? null, archive: s.archive ?? [] };
  } catch {
    return emptyState();
  }
}

export function saveState(ctx: Ctx, state: ChannelState): void {
  mkdirSync(ctx.binariesDir, { recursive: true });
  const p = statePath(ctx);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, p); // atomic on the same filesystem
}
