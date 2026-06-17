import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCtx } from "./ctx";
import { withLock } from "./lock";

function ctx() {
  return makeCtx({ HOME: mkdtempSync(path.join(tmpdir(), "ccx-lock-")) } as NodeJS.ProcessEnv);
}
const lockFile = (c: ReturnType<typeof ctx>) => path.join(c.binariesDir, ".ccx.lock");

test("withLock runs fn and releases the lock", async () => {
  const c = ctx();
  let ran = false;
  const r = await withLock(c, () => { ran = true; return 42; });
  expect(ran).toBe(true);
  expect(r).toBe(42);
  expect(existsSync(lockFile(c))).toBe(false);
});

test("withLock releases the lock even when fn throws", async () => {
  const c = ctx();
  await expect(withLock(c, () => { throw new Error("boom"); })).rejects.toThrow(/boom/);
  expect(existsSync(lockFile(c))).toBe(false);
});

test("withLock refuses when a live lock is held", async () => {
  const c = ctx();
  mkdirSync(c.binariesDir, { recursive: true });
  // our own (alive) pid -> a genuinely held lock
  writeFileSync(lockFile(c), JSON.stringify({ pid: process.pid, at: Date.now() }));
  await expect(withLock(c, () => {})).rejects.toThrow(/another ccx operation is in progress/);
});

test("withLock reclaims a stale (dead-pid) lock", async () => {
  const c = ctx();
  mkdirSync(c.binariesDir, { recursive: true });
  writeFileSync(lockFile(c), JSON.stringify({ pid: 2147483646, at: Date.now() })); // ~impossible pid
  let ran = false;
  await withLock(c, () => { ran = true; });
  expect(ran).toBe(true);
  expect(existsSync(lockFile(c))).toBe(false);
});
