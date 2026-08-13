import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// On Termux, the glibc buno binary reports os.tmpdir() as /tmp (not writable).
// Walk candidates in order: PREFIX/tmp, TMPDIR, os.tmpdir().
// The Termux prefix is always /data/data/com.termux/files/usr.
import { accessSync, constants as FsConstants } from "node:fs";
function pickTmpDir(): string {
  const candidates = [
    process.env.PREFIX ? `${process.env.PREFIX}/tmp` : null,
    "/data/data/com.termux/files/usr/tmp",
    process.env.TMPDIR,
    tmpdir(),
  ];
  for (const c of candidates) {
    if (!c) continue;
    try { accessSync(c, FsConstants.W_OK); return c; } catch { /* try next */ }
  }
  return tmpdir();
}
const TMP = pickTmpDir();
import { patchBuffer, patchFile, keepFromEnv, PATCH_TARGETS, RESOLV_FROM, RESOLV_REDIRECT_PATH } from "./patch";

test("patchBuffer blanks targets with equal-length spaces, length preserved", () => {
  const text = `aaa${PATCH_TARGETS[0]}bbb${PATCH_TARGETS[1]}ccc${PATCH_TARGETS[1]}ddd`;
  const buf = Buffer.from(text, "latin1");
  const before = buf.length;
  const res = patchBuffer(buf);
  expect(buf.length).toBe(before);
  expect(res.occurrences[PATCH_TARGETS[0]]).toBe(1);
  expect(res.occurrences[PATCH_TARGETS[1]]).toBe(2);
  expect(res.changed).toBe(true);
  const out = buf.toString("latin1");
  expect(out).not.toContain(PATCH_TARGETS[0]);
  expect(out).not.toContain(PATCH_TARGETS[1]);
  expect(out).toContain("aaa");
  expect(out).toContain(" ".repeat(PATCH_TARGETS[0].length));
});

test("patchBuffer respects keep list", () => {
  const buf = Buffer.from(PATCH_TARGETS[0], "latin1");
  const res = patchBuffer(buf, [PATCH_TARGETS[0]]);
  expect(res.occurrences[PATCH_TARGETS[0]]).toBe(0);
  expect(buf.toString("latin1")).toBe(PATCH_TARGETS[0]);
});

test("keepFromEnv maps the CCPATCH_KEEP_* vars", () => {
  expect(keepFromEnv({} as NodeJS.ProcessEnv)).toEqual([]);
  expect(keepFromEnv({ CCPATCH_KEEP_NO_COMMIT: "1" } as NodeJS.ProcessEnv)).toEqual([PATCH_TARGETS[0]]);
  expect(keepFromEnv({ CCPATCH_KEEP_NO_COMMENTS: "1" } as NodeJS.ProcessEnv)).toEqual([PATCH_TARGETS[1]]);
  expect(keepFromEnv({ CCPATCH_KEEP_RESOLV: "1" } as NodeJS.ProcessEnv)).toEqual([RESOLV_FROM]);
});

test("patchBuffer redirects /etc/resolv.conf -> /sdcard/dns.conf, length preserved", () => {
  expect(RESOLV_FROM.length).toBe(RESOLV_REDIRECT_PATH.length); // byte-preserving invariant
  const text = `pre\0${RESOLV_FROM}\0/etc/nsswitch.conf\0post`;
  const buf = Buffer.from(text, "latin1");
  const before = buf.length;
  const res = patchBuffer(buf);
  expect(buf.length).toBe(before);
  expect(res.occurrences[RESOLV_FROM]).toBe(1);
  const out = buf.toString("latin1");
  expect(out).toContain(RESOLV_REDIRECT_PATH);
  expect(out).not.toContain(RESOLV_FROM);
  expect(out).toContain("/etc/nsswitch.conf"); // adjacent string untouched
});

test("patchBuffer respects CCPATCH_KEEP_RESOLV via keep list", () => {
  const buf = Buffer.from(RESOLV_FROM, "latin1");
  const res = patchBuffer(buf, [RESOLV_FROM]);
  expect(res.occurrences[RESOLV_FROM]).toBe(0);
  expect(buf.toString("latin1")).toBe(RESOLV_FROM);
});

test("patchFile writes a .bak-prepatch and patches in place", () => {
  const dir = mkdtempSync(path.join(TMP, "ccx-patch-"));
  const f = path.join(dir, "bin");
  writeFileSync(f, Buffer.from(`x${PATCH_TARGETS[0]}y`, "latin1"));
  const res = patchFile(f);
  expect(existsSync(`${f}.bak-prepatch`)).toBe(true);
  expect(res.occurrences[PATCH_TARGETS[0]]).toBe(1);
  expect(readFileSync(f, "latin1")).not.toContain(PATCH_TARGETS[0]);
  expect(readFileSync(`${f}.bak-prepatch`, "latin1")).toContain(PATCH_TARGETS[0]);
});
