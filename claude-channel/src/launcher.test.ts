import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCtx } from "./ctx";
import { renderLauncher, writeLauncher, readLauncherBinary, launcherPath } from "./launcher";

function ctx() {
  return makeCtx({ HOME: mkdtempSync(path.join(tmpdir(), "ccx-lnch-")), PREFIX: "/pfx" } as NodeJS.ProcessEnv);
}

test("renderLauncher contains the pin, autoupdater-off, and literal shell vars", () => {
  const c = ctx();
  const out = renderLauncher(c, "/bins/claude-2.1.175/claude-binary");
  expect(out).toContain('#!/pfx/bin/bash');
  expect(out).toContain('export DISABLE_AUTOUPDATER=1');
  expect(out).toContain('BUN_BINARY_PATH="/bins/claude-2.1.175/claude-binary"');
  expect(out).toContain(`exec "${c.bunTermux}" "$@"`);
  expect(out).toContain('${CLAUDE_CODE_TMPDIR:-$PREFIX/tmp}'); // literal, not interpolated
});

test("write then read round-trips the binary path; next vs stable name", () => {
  const c = ctx();
  writeLauncher(c, "next", "/b/n/claude-binary");
  writeLauncher(c, "stable", "/b/s/claude-binary");
  expect(launcherPath(c, "next").endsWith("/claude-next")).toBe(true);
  expect(launcherPath(c, "stable").endsWith("/claude")).toBe(true);
  expect(readLauncherBinary(c, "next")).toBe("/b/n/claude-binary");
  expect(readLauncherBinary(c, "stable")).toBe("/b/s/claude-binary");
  expect((readFileSync(launcherPath(c, "next"), "utf8")).startsWith("#!")).toBe(true);
});

test("readLauncherBinary returns null when absent", () => {
  expect(readLauncherBinary(ctx(), "next")).toBeNull();
});
