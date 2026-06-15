import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCtx } from "./ctx";
import { status, list, prune } from "./channel";
import { loadState, saveState, emptyState } from "./state";
import type { Platform } from "./platform/platform";
import type { Channel, ChannelKind } from "./types";

class FakePlatform implements Platform {
  readonly id = "termux" as const; readonly platformTag = "linux-arm64";
  constructor(private ctx: ReturnType<typeof makeCtx>) {}
  async resolveLatest(c: Channel) { return c === "latest" ? "2.1.180" : "2.1.153"; }
  binaryDir(v: string) { return path.join(this.ctx.binariesDir, `claude-${v}`); }
  binaryPath(v: string) { return path.join(this.binaryDir(v), "claude-binary"); }
  isInstalled(v: string) { return existsSync(this.binaryPath(v)); }
  async fetchBinary(v: string) { mkdirSync(this.binaryDir(v), { recursive: true }); writeFileSync(this.binaryPath(v), v); return this.binaryPath(v); }
  writeLauncher() {} readLauncherBinary(_k: ChannelKind) { return null; }
  async verify() { return "x"; } pathPrecedenceOk() { return true; }
  scheduleInstall() {} scheduleRemove() {}
}

function setup() {
  const ctx = makeCtx({ HOME: mkdtempSync(path.join(tmpdir(), "ccx-st-")) } as NodeJS.ProcessEnv);
  return { ctx, plat: new FakePlatform(ctx) };
}

test("status reports versions + update availability", async () => {
  const { ctx, plat } = setup();
  const s0 = await status(plat, ctx);
  expect(s0.next).toBeNull();
  expect(s0.channelLatest).toBe("2.1.180");
  const st = emptyState();
  st.next = { version: "2.1.175", binary: "/b", patched: true, updatedAt: "t" };
  saveState(ctx, st);
  const s1 = await status(plat, ctx);
  expect(s1.next?.version).toBe("2.1.175");
  expect(s1.updateAvailable).toBe(true); // channel latest 2.1.180 > installed next 2.1.175
});

test("prune keeps next+stable+N archived and removes the rest", async () => {
  const { ctx, plat } = setup();
  for (const v of ["2.1.170", "2.1.171", "2.1.172", "2.1.173", "2.1.180"]) await plat.fetchBinary(v);
  const st = emptyState();
  st.next = { version: "2.1.180", binary: plat.binaryPath("2.1.180"), patched: true, updatedAt: "t" };
  st.stable = { version: "2.1.173", binary: plat.binaryPath("2.1.173"), patched: true, promotedAt: "t" };
  st.archive = [
    { version: "2.1.172", binary: plat.binaryPath("2.1.172"), promotedAt: "t", archivedAt: "t" },
    { version: "2.1.171", binary: plat.binaryPath("2.1.171"), promotedAt: "t", archivedAt: "t" },
    { version: "2.1.170", binary: plat.binaryPath("2.1.170"), promotedAt: "t", archivedAt: "t" },
  ];
  saveState(ctx, st);
  const res = prune(ctx, 2);
  expect(existsSync(plat.binaryPath("2.1.170"))).toBe(false);
  expect(existsSync(plat.binaryPath("2.1.171"))).toBe(true);
  expect(existsSync(plat.binaryPath("2.1.173"))).toBe(true);
  expect(res.removed.some((d) => d.includes("2.1.170"))).toBe(true);
});

test("list reports installed dirs + archive", async () => {
  const { ctx, plat } = setup();
  await plat.fetchBinary("2.1.180");
  const r = list(ctx);
  expect(r.installed).toContain("2.1.180");
});
