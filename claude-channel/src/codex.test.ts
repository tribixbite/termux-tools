import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { atomicWrite, codexLock, patchCodex, pruneCodex, readCodexState, resolveCodex, switchCodex, updateCodex, validateVersion, type CodexContext } from "./codex";
import { parseCodexArgs, setupCodex } from "./codex-cli";
import { PATCH_TARGETS, RESOLV_FROM, RESOLV_REDIRECT_PATH } from "./patch";
const dirs: string[] = [];
function fixture(): CodexContext {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), "cdx-test-")); dirs.push(dir);
  return { root: dir, prefix: process.env.PREFIX ?? "/data/data/com.termux/files/usr", localBin: path.join(dir, "launchers"), resolver: path.join(dir, "dns.conf"), fetchImpl: async () => { throw new Error("offline"); } };
}
function installed(ctx: CodexContext, version: string, reported = version): void {
  const dir = path.join(ctx.root, "versions", version);
  mkdirSync(path.join(dir, "bin"), { recursive: true }); mkdirSync(path.join(dir, "codex-path"));
  const shell = existsSync(`${ctx.prefix}/bin/bash`) ? `${ctx.prefix}/bin/bash` : "/bin/bash";
  writeFileSync(path.join(dir, "bin/codex"), `#!${shell}\nif [ "$1" = --version ]; then echo 'codex-cli ${reported}'; else echo 'daemon_auto_start stable false'; fi\n`, { mode: 0o755 });
  writeFileSync(path.join(dir, "codex-path/rg"), `#!${shell}\necho ripgrep\n`, { mode: 0o755 });
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
test("version and CLI validation reject paths, invalid and duplicate flags", () => {
  expect(() => validateVersion("../../bad")).toThrow();
  expect(validateVersion("0.157.1-alpha.2")).toBe("0.157.1-alpha.2");
  for (const args of [["promote", "--pin", "1.2.3"], ["prune", "--keep", "2junk"], ["update", "--pin"], ["status", "--json", "--json"]]) expect(() => parseCodexArgs(args)).toThrow();
});
test("DNS patch preserves prompt text, byte length and supports repeated patching", () => {
  const b = Buffer.from(`${PATCH_TARGETS.join("\n")}\0${RESOLV_FROM}`); const length = b.length;
  patchCodex(b); expect(b.length).toBe(length); expect(b.toString()).toContain(PATCH_TARGETS[0]); expect(b.toString()).toContain(RESOLV_REDIRECT_PATH);
  const once = Buffer.from(b); patchCodex(b); expect(b).toEqual(once);
  expect(() => patchCodex(Buffer.from("changed layout"))).toThrow();
});
test("corrupt state fails closed", () => {
  const ctx = fixture(); writeFileSync(path.join(ctx.root, "state.json"), "{"); expect(() => readCodexState(ctx)).toThrow();
});
test("next update is isolated; promotion archives and rollback retains outgoing stable", async () => {
  const ctx = fixture(); installed(ctx, "0.157.1"); installed(ctx, "0.158.0");
  await updateCodex(ctx, "0.157.1"); switchCodex(ctx);
  await updateCodex(ctx, "0.158.0"); expect(readCodexState(ctx).stable).toBe("0.157.1");
  switchCodex(ctx); expect(readCodexState(ctx).archive).toEqual(["0.157.1"]);
  switchCodex(ctx, true); expect(readCodexState(ctx).stable).toBe("0.157.1"); expect(readCodexState(ctx).archive).toEqual(["0.158.0"]);
});
test("failed verification does not change either channel", async () => {
  const ctx = fixture(); installed(ctx, "0.157.1"); installed(ctx, "0.158.0", "0.100.0");
  await updateCodex(ctx, "0.157.1"); switchCodex(ctx); const before = readCodexState(ctx);
  await expect(updateCodex(ctx, "0.158.0")).rejects.toThrow("Expected"); expect(readCodexState(ctx)).toEqual(before);
});
test("prune previews and protects both channels plus retained rollback versions", async () => {
  const ctx = fixture(); for (const v of ["0.156.0", "0.157.0", "0.158.0", "0.159.0"]) { installed(ctx, v); await updateCodex(ctx, v); switchCodex(ctx); }
  expect(pruneCodex(ctx, 1, false)).toEqual(["0.156.0", "0.157.0"]);
  expect(existsSync(path.join(ctx.root, "versions/0.156.0"))).toBe(true);
  pruneCodex(ctx, 1, true); expect(readCodexState(ctx).archive).toEqual(["0.158.0"]); expect(readCodexState(ctx).stable).toBe("0.159.0");
});
test("concurrent mutation lock is rejected and lock is released on failure", async () => {
  const ctx = fixture(); await codexLock(ctx, async () => { await expect(codexLock(ctx, async () => {})).rejects.toThrow("holds"); });
  await expect(codexLock(ctx, async () => { throw new Error("failed"); })).rejects.toThrow("failed");
  expect(existsSync(path.join(ctx.root, ".lock"))).toBe(false);
});
test("setup refuses unmanaged launchers and writes managed regular files", () => {
  const ctx = fixture(); setupCodex(ctx, "/path with space/cdx.js"); const file = path.join(ctx.localBin, "codex");
  expect(lstatSync(file).isSymbolicLink()).toBe(false); expect(readFileSync(file, "utf8")).toContain("run stable");
  atomicWrite(file, "unmanaged\n"); expect(() => setupCodex(ctx, "/manager")).toThrow("unmanaged"); expect(readFileSync(file, "utf8")).toBe("unmanaged\n");
});
test("registry failures do not invent a latest version", async () => {
  await expect(resolveCodex(fixture())).rejects.toThrow("offline");
});

test("cron command quotes runtime paths, limits intervals and only updates next", async () => {
  const { codexCronLine } = await import("./codex");
  const ctx = fixture(); const line = codexCronLine(ctx, "/manager path/cdx.js", 6);
  expect(line).toStartWith("0 */6 * * * "); expect(line).toContain("'/manager path/cdx.js' update"); expect(line).not.toContain("promote");
  expect(() => codexCronLine(ctx, "/manager", 5)).toThrow();
  expect(parseCodexArgs(["schedule", "--every", "12"]).hours).toBe(12);
});

test("repeated updates preserve the installed executable inode", async () => {
  const ctx = fixture(); installed(ctx, "0.157.1"); await updateCodex(ctx, "0.157.1");
  const file = path.join(ctx.root, "versions/0.157.1/bin/codex"); const inode = lstatSync(file).ino;
  await updateCodex(ctx, "0.157.1"); expect(lstatSync(file).ino).toBe(inode);
});
test("foreign and null archive entries are rejected", () => {
  const ctx = fixture();
  for (const value of [null, {schema: 1, next: null, stable: null, archive: [null]}, {schema: 2, next: null, stable: null, archive: []}]) {
    writeFileSync(path.join(ctx.root, "state.json"), JSON.stringify(value)); expect(() => readCodexState(ctx)).toThrow();
  }
});
