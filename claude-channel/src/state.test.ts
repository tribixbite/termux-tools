import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCtx } from "./ctx";
import { loadState, saveState, emptyState, statePath } from "./state";

function ctx() {
  return makeCtx({ HOME: mkdtempSync(path.join(tmpdir(), "ccx-state-")) } as NodeJS.ProcessEnv);
}

test("loadState returns empty when missing", () => {
  expect(loadState(ctx())).toEqual(emptyState());
});

test("save then load round-trips", () => {
  const c = ctx();
  const s = emptyState();
  s.next = { version: "2.1.175", binary: "/b", patched: true, updatedAt: "t" };
  saveState(c, s);
  const back = loadState(c);
  expect(back.next?.version).toBe("2.1.175");
  expect(statePath(c).endsWith("/.claude/binaries/channel-state.json")).toBe(true);
});

test("loadState rebuilds on corrupt/foreign schema", () => {
  const c = ctx();
  mkdirSync(c.binariesDir, { recursive: true });
  writeFileSync(statePath(c), "{ not json");
  expect(loadState(c)).toEqual(emptyState());
  writeFileSync(statePath(c), JSON.stringify({ schema: 99 }));
  expect(loadState(c)).toEqual(emptyState());
});
