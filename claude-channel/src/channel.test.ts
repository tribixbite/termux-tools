import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCtx, type Ctx } from "./ctx";
import type { Platform } from "./platform/platform";
import type { Channel, ChannelKind } from "./types";
import { update, promote, rollback } from "./channel";
import { loadState } from "./state";

// Minimal in-memory platform. fetchBinary "installs" a file on disk so existence checks work.
class FakePlatform implements Platform {
  readonly id = "termux" as const;
  readonly platformTag = "linux-arm64";
  latest = "2.1.175";
  launchers: Record<ChannelKind, string | null> = { next: null, stable: null };
  constructor(private ctx: Ctx) {}
  async resolveLatest(_c: Channel) { return this.latest; }
  binaryDir(v: string) { return path.join(this.ctx.binariesDir, `claude-${v}`); }
  binaryPath(v: string) { return path.join(this.binaryDir(v), "claude-binary"); }
  isInstalled(v: string) { return existsSync(this.binaryPath(v)); }
  async fetchBinary(v: string) {
    mkdirSync(this.binaryDir(v), { recursive: true });
    writeFileSync(this.binaryPath(v), `binary-${v}`);
    return this.binaryPath(v);
  }
  writeLauncher(kind: ChannelKind, bin: string) { this.launchers[kind] = bin; }
  readLauncherBinary(kind: ChannelKind) { return this.launchers[kind]; }
  async verify(kind: ChannelKind) { return `${this.latest} (Claude Code)`; }
  pathPrecedenceOk() { return true; }
  scheduleInstall() {}
  scheduleRemove() {}
}

function setup() {
  const ctx = makeCtx({ HOME: mkdtempSync(path.join(tmpdir(), "ccx-ch-")) } as NodeJS.ProcessEnv);
  return { ctx, plat: new FakePlatform(ctx) };
}

test("update installs next and is idempotent", async () => {
  const { ctx, plat } = setup();
  const r1 = await update(plat, ctx, "latest");
  expect(r1.action).toBe("updated");
  expect(r1.to).toBe("2.1.175");
  expect(loadState(ctx).next?.version).toBe("2.1.175");
  expect(plat.launchers.next).toBe(plat.binaryPath("2.1.175"));
  const r2 = await update(plat, ctx, "latest");
  expect(r2.action).toBe("current");
});

test("update verify-mismatch throws", async () => {
  const { ctx, plat } = setup();
  plat.verify = async () => "9.9.9 (Claude Code)";
  await expect(update(plat, ctx, "latest")).rejects.toThrow(/verify failed/);
});

test("promote snapshots next->stable and archives the outgoing stable", async () => {
  const { ctx, plat } = setup();
  await update(plat, ctx, "latest");                    // next=2.1.175
  const p1 = promote(plat, ctx);                        // stable=2.1.175, no prior to archive
  expect(p1.action).toBe("promoted");
  expect(loadState(ctx).stable?.version).toBe("2.1.175");
  expect(loadState(ctx).archive.length).toBe(0);
  plat.latest = "2.1.180";
  await update(plat, ctx, "latest");                    // next=2.1.180
  const p2 = promote(plat, ctx);                        // stable=2.1.180, archives 2.1.175
  expect(p2.from).toBe("2.1.175");
  expect(loadState(ctx).stable?.version).toBe("2.1.180");
  expect(loadState(ctx).archive[0].version).toBe("2.1.175");
  expect(plat.launchers.stable).toBe(plat.binaryPath("2.1.180"));
});

test("promote is a noop when stable already equals next", async () => {
  const { ctx, plat } = setup();
  await update(plat, ctx, "latest"); promote(plat, ctx);
  expect(promote(plat, ctx).action).toBe("noop");
});

test("rollback restores the most recent archived stable", async () => {
  const { ctx, plat } = setup();
  await update(plat, ctx, "latest"); promote(plat, ctx);         // stable 2.1.175
  plat.latest = "2.1.180"; await update(plat, ctx, "latest"); promote(plat, ctx); // stable 2.1.180, archive[0]=2.1.175
  const r = await rollback(plat, ctx);
  expect(r.to).toBe("2.1.175");
  expect(loadState(ctx).stable?.version).toBe("2.1.175");
  expect(loadState(ctx).archive.length).toBe(0);
  expect(plat.launchers.stable).toBe(plat.binaryPath("2.1.175"));
});

test("rollback re-fetches when the archived binary was pruned", async () => {
  const { ctx, plat } = setup();
  await update(plat, ctx, "latest"); promote(plat, ctx);
  plat.latest = "2.1.180"; await update(plat, ctx, "latest"); promote(plat, ctx);
  // simulate prune of the archived binary
  const { rmSync } = await import("node:fs");
  rmSync(plat.binaryDir("2.1.175"), { recursive: true, force: true });
  const r = await rollback(plat, ctx);
  expect(r.refetched).toBe(true);
  expect(existsSync(plat.binaryPath("2.1.175"))).toBe(true);
});
