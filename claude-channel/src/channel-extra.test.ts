import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCtx, type Ctx } from "./ctx";
import { compareVersions, prunePlan } from "./channel";
import { emptyState, saveState } from "./state";

test("compareVersions handles releases and pre-releases (semver)", () => {
  expect(compareVersions("2.1.180", "2.1.175")).toBe(1);
  expect(compareVersions("2.1.175", "2.1.180")).toBe(-1);
  expect(compareVersions("2.1.175", "2.1.175")).toBe(0);
  expect(compareVersions("2.2.0", "2.1.999")).toBe(1);
  expect(compareVersions("2.1.175", "2.1.175-beta")).toBe(1);            // release outranks pre-release
  expect(compareVersions("2.1.175-beta", "2.1.175")).toBe(-1);
  expect(compareVersions("2.1.175-beta.2", "2.1.175-beta.10")).toBe(-1); // numeric pre-release ids
  expect(compareVersions("2.1.175-rc.1", "2.1.175-beta.1")).toBe(1);     // lexical: rc > beta
});

const bindir = (ctx: Ctx, v: string) => path.join(ctx.binariesDir, `claude-${v}`);
function mkbin(ctx: Ctx, v: string): void {
  mkdirSync(bindir(ctx, v), { recursive: true });
  writeFileSync(path.join(bindir(ctx, v), "claude-binary"), v);
}

test("prunePlan lists removable dirs (keeps next+stable+N archived) without deleting", () => {
  const ctx = makeCtx({ HOME: mkdtempSync(path.join(tmpdir(), "ccx-pp-")) } as NodeJS.ProcessEnv);
  for (const v of ["2.1.170", "2.1.171", "2.1.172", "2.1.173", "2.1.180"]) mkbin(ctx, v);
  const st = emptyState();
  st.next = { version: "2.1.180", binary: path.join(bindir(ctx, "2.1.180"), "claude-binary"), patched: true, updatedAt: "t" };
  st.stable = { version: "2.1.173", binary: path.join(bindir(ctx, "2.1.173"), "claude-binary"), patched: true, promotedAt: "t" };
  st.archive = [
    { version: "2.1.172", binary: path.join(bindir(ctx, "2.1.172"), "claude-binary"), promotedAt: "t", archivedAt: "t" },
    { version: "2.1.171", binary: path.join(bindir(ctx, "2.1.171"), "claude-binary"), promotedAt: "t", archivedAt: "t" },
    { version: "2.1.170", binary: path.join(bindir(ctx, "2.1.170"), "claude-binary"), promotedAt: "t", archivedAt: "t" },
  ];
  saveState(ctx, st);
  const plan = prunePlan(ctx, 2);
  expect(plan.toRemove.some((d) => d.includes("2.1.170"))).toBe(true);  // beyond keep 2
  expect(plan.toRemove.some((d) => d.includes("2.1.171"))).toBe(false); // kept (2nd-newest archived)
  expect(plan.toRemove.some((d) => d.includes("2.1.173"))).toBe(false); // stable
  expect(existsSync(bindir(ctx, "2.1.170"))).toBe(true);                // prunePlan does NOT delete
});
