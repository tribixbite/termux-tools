import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";

// The two upstream system-prompt directives that conflict with the user's CLAUDE.md.
// Blanked with equal-length spaces (byte-preserving — a length change corrupts the
// bun-vfs blob in the compiled binary). Still present in 2.1.x binaries.
export const PATCH_TARGETS = [
  "NEVER commit changes unless the user explicitly asks you to.",
  "Default to writing no comments.",
] as const;

// DNS redirect (byte-preserving path swap, NOT a blank).
// bun's bundled c-ares reads the ABSOLUTE `/etc/resolv.conf` via a raw openat
// syscall (unreachable by LD_PRELOAD). On Termux `/etc` -> Android's read-only
// `/system/etc`, which has no resolv.conf, so c-ares gets ZERO nameservers and
// the OAuth login + silent token-refresh die with `getaddrinfo ETIMEOUT` on
// every network (inference still works — it resolves via glibc getaddrinfo).
// We rewrite the path literal to an equal-length one on writable storage that
// the launcher provisions. Must stay EXACTLY the same byte length as the
// original or the compiled-binary offsets shift and corrupt it.
export const RESOLV_FROM = "/etc/resolv.conf";
export const RESOLV_REDIRECT_PATH = "/sdcard/dns.conf";
export const RESOLV_CONTENT = "nameserver 8.8.8.8\nnameserver 8.8.4.4\noptions timeout:2 attempts:2\n";
if (RESOLV_FROM.length !== RESOLV_REDIRECT_PATH.length) {
  throw new Error(`resolv redirect length mismatch: "${RESOLV_FROM}" (${RESOLV_FROM.length}) != "${RESOLV_REDIRECT_PATH}" (${RESOLV_REDIRECT_PATH.length})`);
}

export interface PatchResult {
  occurrences: Record<string, number>;
  changed: boolean;
}

/** Blank each target string in `buf` in place with spaces. Returns per-target counts. */
export function patchBuffer(buf: Buffer, keep: readonly string[] = []): PatchResult {
  const occurrences: Record<string, number> = {};
  let changed = false;
  for (const target of PATCH_TARGETS) {
    if (keep.includes(target)) { occurrences[target] = 0; continue; }
    const needle = Buffer.from(target, "latin1");
    const filler = Buffer.alloc(needle.length, 0x20); // ASCII space
    let count = 0;
    let from = 0;
    for (;;) {
      const i = buf.indexOf(needle, from);
      if (i < 0) break;
      filler.copy(buf, i);
      from = i + needle.length;
      count++;
    }
    occurrences[target] = count;
    if (count > 0) changed = true;
  }

  // DNS path redirect: /etc/resolv.conf -> /sdcard/dns.conf (equal length).
  if (!keep.includes(RESOLV_FROM)) {
    const from = Buffer.from(RESOLV_FROM, "latin1");
    const to = Buffer.from(RESOLV_REDIRECT_PATH, "latin1");
    let count = 0;
    let at = 0;
    for (;;) {
      const i = buf.indexOf(from, at);
      if (i < 0) break;
      to.copy(buf, i);
      at = i + from.length;
      count++;
    }
    occurrences[RESOLV_FROM] = count;
    if (count > 0) changed = true;
  } else {
    occurrences[RESOLV_FROM] = 0;
  }

  return { occurrences, changed };
}

/** Patch a binary file in place, creating a one-time `.bak-prepatch` backup. */
export function patchFile(binaryPath: string, keep: readonly string[] = []): PatchResult {
  const backup = `${binaryPath}.bak-prepatch`;
  if (!existsSync(backup)) copyFileSync(binaryPath, backup);
  const buf = readFileSync(binaryPath);
  const before = buf.length;
  const result = patchBuffer(buf, keep);
  if (buf.length !== before) throw new Error("patch changed byte length — would corrupt the binary");
  if (result.changed) writeFileSync(binaryPath, buf);
  return result;
}

/** Map the CCPATCH_KEEP_* opt-out env vars to a keep-list. */
export function keepFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const keep: string[] = [];
  if (env.CCPATCH_KEEP_NO_COMMIT) keep.push(PATCH_TARGETS[0]);
  if (env.CCPATCH_KEEP_NO_COMMENTS) keep.push(PATCH_TARGETS[1]);
  if (env.CCPATCH_KEEP_RESOLV) keep.push(RESOLV_FROM);
  return keep;
}
