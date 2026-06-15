# claude-channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TypeScript CLI (`ccx`, npm package `claude-channel`) that manages Claude Code as two pinned channels on Termux — `update` tracks the upstream `latest` release into `~/.local/bin/claude-next`, `promote` snapshots next→stable (`~/.local/bin/claude`) and archives the outgoing stable, with rollback/status/list/prune/schedule.

**Architecture:** A small `Ctx` (paths + injectable `fetch`/`baseUrl`) flows into stateless modules (`registry`, `patch`, `launcher`, `state`). A `Platform` interface (Termux implemented; others throw `NotImplementedError`) wraps them. `channel.ts` orchestrates the high-level ops against a `Platform`. `cli.ts` parses args and dispatches. Everything is dependency-injected so tests run against a temp `HOME` + a local fixture HTTP server — no network, no touching the real `~/.claude`.

**Tech Stack:** TypeScript (strict, `moduleResolution: bundler`, extensionless imports), runs under **node** (bionic node is fine), bundled with **Bun.build** to `dist/cli.js`, tested with **bun:test**. Update source is the native release channel `https://downloads.claude.ai/claude-code-releases` (NOT npm). Spec: `docs/superpowers/specs/2026-06-12-claude-channel-toolkit-design.md`.

**Local run commands (this Termux session):** use **`bun`** — the `~/.bun/bin/bun` wrapper unsets the leaked `BUN_BINARY_PATH` itself (`bun --version` → `1.3.10`, not Claude Code) AND loads glibc via grun. Do NOT use `buno` directly: it's the raw glibc bun ELF and fails with `cannot execute: required file not found` (no glibc loader). If `bun` ever does route to Claude Code, fall back to `grun buno`.
- Test: `cd claude-channel && bun test src/<file>.test.ts`
- Typecheck: `bunx tsc --noEmit -p claude-channel/tsconfig.json`
- Build: `cd claude-channel && bun run build.ts`

---

## File Structure

All under `termux-tools/claude-channel/`:

| File | Responsibility |
|---|---|
| `package.json` | name `claude-channel`, `bin.ccx → dist/cli.js`, `files` allowlist, scripts, devDeps |
| `tsconfig.json` | strict TS, `moduleResolution: bundler`, `noEmit` |
| `build.ts` | `Bun.build` → `dist/cli.js` + shebang + chmod |
| `README.md` | usage |
| `src/ctx.ts` | `Ctx` type + `makeCtx(env, overrides)`; `RELEASE_BASE_URL` |
| `src/types.ts` | `Channel`, `ChannelKind`, pins, `ChannelState`, `Manifest` |
| `src/patch.ts` | byte-preserving `patchBuffer`/`patchFile`, `PATCH_TARGETS`, `keepFromEnv` |
| `src/registry.ts` | release-channel client: `resolveChannelVersion`, `fetchManifest`, `downloadBinary` (sha256) |
| `src/launcher.ts` | render/write/read the bun-on-termux channel launchers |
| `src/state.ts` | load/save `channel-state.json` (atomic) |
| `src/platform/platform.ts` | `Platform` interface + `NotImplementedError` |
| `src/platform/termux.ts` | `TermuxPlatform implements Platform` |
| `src/platform/factory.ts` | `detectPlatform(ctx)` |
| `src/channel.ts` | `update`/`promote`/`rollback`/`status`/`list`/`prune` orchestration |
| `src/schedule.ts` | crontab line + install/remove |
| `src/cli.ts` | `parseArgs` + `main` dispatch + output |
| `src/*.test.ts` | colocated bun:test suites |

Convention for tests: build a `Ctx` pointing at a `mkdtemp` dir for `home` and (for registry/termux) a local HTTP fixture server for `baseUrl`. Never use the real `process.env.HOME` in a test.

---

## Task 1: Scaffold the package

**Files:**
- Create: `claude-channel/package.json`, `claude-channel/tsconfig.json`, `claude-channel/.gitignore`, `claude-channel/build.ts`
- Test: `claude-channel/src/smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test**

`claude-channel/src/smoke.test.ts`:
```ts
import { test, expect } from "bun:test";

test("test runner works", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 2: Create package files**

`claude-channel/package.json`:
```json
{
  "name": "claude-channel",
  "version": "0.1.0",
  "description": "Manage Claude Code as pinned next/stable channels on Termux",
  "bin": { "ccx": "./dist/cli.js" },
  "files": ["dist/", "README.md"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "bun run build.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.9.0"
  }
}
```

`claude-channel/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node", "bun"],
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "build.ts"]
}
```

`claude-channel/.gitignore`:
```
node_modules/
dist/
```

`claude-channel/build.ts`:
```ts
// Bundle the CLI to a single node-targeted dist/cli.js with an executable shebang.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const out = await Bun.build({
  entrypoints: ["src/cli.ts"],
  outdir: "dist",
  target: "node",
  format: "cjs",
  minify: false,
});
if (!out.success) {
  for (const log of out.logs) console.error(log);
  process.exit(1);
}
const cliPath = "dist/cli.js";
const body = readFileSync(cliPath, "utf8");
if (!body.startsWith("#!")) writeFileSync(cliPath, `#!/usr/bin/env node\n${body}`);
chmodSync(cliPath, 0o755);
console.log("built dist/cli.js");
```

- [ ] **Step 3: Install devDeps and run the smoke test**

Run:
```bash
cd claude-channel && env -u BUN_BINARY_PATH bun install
buno test src/smoke.test.ts
```
Expected: `1 pass`. (If `buno test` errors on a missing `bun-types`, it still runs — types are only needed for `tsc`.)

- [ ] **Step 4: Commit**

```bash
git add claude-channel/package.json claude-channel/tsconfig.json claude-channel/.gitignore claude-channel/build.ts claude-channel/src/smoke.test.ts
git commit -m "feat(claude-channel): scaffold package + smoke test"
```

---

## Task 2: Ctx + shared types

**Files:**
- Create: `claude-channel/src/ctx.ts`, `claude-channel/src/types.ts`
- Test: `claude-channel/src/ctx.test.ts`

- [ ] **Step 1: Write the failing test**

`claude-channel/src/ctx.test.ts`:
```ts
import { test, expect } from "bun:test";
import path from "node:path";
import { makeCtx, RELEASE_BASE_URL } from "./ctx";

test("makeCtx derives paths from HOME and PREFIX", () => {
  const ctx = makeCtx({ HOME: "/h", PREFIX: "/p" } as NodeJS.ProcessEnv);
  expect(ctx.home).toBe("/h");
  expect(ctx.binariesDir).toBe(path.join("/h", ".claude", "binaries"));
  expect(ctx.localBin).toBe(path.join("/h", ".local", "bin"));
  expect(ctx.bunTermux).toBe(path.join("/h", ".bun", "bin", "bun-termux"));
  expect(ctx.baseUrl).toBe(RELEASE_BASE_URL);
});

test("makeCtx honors overrides and CLAUDE_CHANNEL_BASE_URL", () => {
  const ctx = makeCtx({ HOME: "/h", CLAUDE_CHANNEL_BASE_URL: "http://x" } as NodeJS.ProcessEnv);
  expect(ctx.baseUrl).toBe("http://x");
  const ctx2 = makeCtx({ HOME: "/h" } as NodeJS.ProcessEnv, { baseUrl: "http://y" });
  expect(ctx2.baseUrl).toBe("http://y");
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `buno test src/ctx.test.ts`
Expected: FAIL (`Cannot find module './ctx'`).

- [ ] **Step 3: Implement**

`claude-channel/src/types.ts`:
```ts
export type Channel = "stable" | "latest";
export type ChannelKind = "next" | "stable";
export type PlatformId = "termux" | "linux" | "darwin";

export interface Pin {
  version: string;
  binary: string;   // absolute path to the claude-binary file
  patched: boolean;
}
export interface NextPin extends Pin { updatedAt: string; }
export interface StablePin extends Pin { promotedAt: string; }

export interface ArchiveEntry {
  version: string;
  binary: string;
  promotedAt: string;
  archivedAt: string;
}

export interface ChannelState {
  schema: 1;
  next: NextPin | null;
  stable: StablePin | null;
  archive: ArchiveEntry[];
}

export interface PlatformBinaryInfo {
  binary: string;
  checksum: string;   // sha256 hex
  size: number;
}
export interface Manifest {
  version: string;
  commit: string;
  buildDate: string;
  platforms: Record<string, PlatformBinaryInfo>;
}
```

`claude-channel/src/ctx.ts`:
```ts
import os from "node:os";
import path from "node:path";

export const RELEASE_BASE_URL = "https://downloads.claude.ai/claude-code-releases";

export interface Ctx {
  home: string;
  prefix: string;
  binariesDir: string;   // <home>/.claude/binaries
  localBin: string;      // <home>/.local/bin
  bunTermux: string;     // <home>/.bun/bin/bun-termux
  baseUrl: string;       // release-channel base URL
  fetchImpl: typeof fetch;
}

export function makeCtx(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<Ctx> = {},
): Ctx {
  const home = overrides.home ?? env.HOME ?? os.homedir();
  const prefix = overrides.prefix ?? env.PREFIX ?? "/data/data/com.termux/files/usr";
  const base: Ctx = {
    home,
    prefix,
    binariesDir: path.join(home, ".claude", "binaries"),
    localBin: path.join(home, ".local", "bin"),
    bunTermux: path.join(home, ".bun", "bin", "bun-termux"),
    baseUrl: env.CLAUDE_CHANNEL_BASE_URL ?? RELEASE_BASE_URL,
    fetchImpl: globalThis.fetch,
  };
  return { ...base, ...overrides };
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `buno test src/ctx.test.ts`
Expected: `2 pass`.

- [ ] **Step 5: Commit**

```bash
git add claude-channel/src/ctx.ts claude-channel/src/types.ts claude-channel/src/ctx.test.ts
git commit -m "feat(claude-channel): Ctx + shared types"
```

---

## Task 3: Byte-preserving patch

**Files:**
- Create: `claude-channel/src/patch.ts`
- Test: `claude-channel/src/patch.test.ts`

- [ ] **Step 1: Write the failing test**

`claude-channel/src/patch.test.ts`:
```ts
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { patchBuffer, patchFile, keepFromEnv, PATCH_TARGETS } from "./patch";

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
});

test("patchFile writes a .bak-prepatch and patches in place", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ccx-patch-"));
  const f = path.join(dir, "bin");
  writeFileSync(f, Buffer.from(`x${PATCH_TARGETS[0]}y`, "latin1"));
  const res = patchFile(f);
  expect(existsSync(`${f}.bak-prepatch`)).toBe(true);
  expect(res.occurrences[PATCH_TARGETS[0]]).toBe(1);
  expect(readFileSync(f, "latin1")).not.toContain(PATCH_TARGETS[0]);
  expect(readFileSync(`${f}.bak-prepatch`, "latin1")).toContain(PATCH_TARGETS[0]);
});
```

- [ ] **Step 2: Run it, expect fail** — Run: `buno test src/patch.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

`claude-channel/src/patch.ts`:
```ts
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";

// The two upstream system-prompt directives that conflict with the user's CLAUDE.md.
// Blanked with equal-length spaces (byte-preserving — a length change corrupts the
// bun-vfs blob in the compiled binary). Still present in 2.1.x binaries.
export const PATCH_TARGETS = [
  "NEVER commit changes unless the user explicitly asks you to.",
  "Default to writing no comments.",
] as const;

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
  return keep;
}
```

- [ ] **Step 4: Run it, expect pass** — Run: `buno test src/patch.test.ts` → `4 pass`.

- [ ] **Step 5: Commit**

```bash
git add claude-channel/src/patch.ts claude-channel/src/patch.test.ts
git commit -m "feat(claude-channel): byte-preserving binary patch"
```

---

## Task 4: Release-channel client (registry)

**Files:**
- Create: `claude-channel/src/registry.ts`
- Test: `claude-channel/src/registry.test.ts`

The test stands up a local HTTP server serving channel/manifest/binary fixtures and points `Ctx.baseUrl` at it. The fixture binary is the bytes `"hello"` whose sha256 is `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`.

- [ ] **Step 1: Write the failing test**

`claude-channel/src/registry.test.ts`:
```ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import http from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCtx } from "./ctx";
import { resolveChannelVersion, fetchManifest, downloadBinary } from "./registry";

const HELLO_SHA = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (url.endsWith("/latest")) return void res.end("2.1.175\n");
    if (url.endsWith("/stable")) return void res.end("2.1.153\n");
    if (url.endsWith("/2.1.175/manifest.json")) {
      res.setHeader("content-type", "application/json");
      return void res.end(JSON.stringify({
        version: "2.1.175", commit: "abc", buildDate: "x",
        platforms: { "linux-arm64": { binary: "claude", checksum: HELLO_SHA, size: 5 } },
      }));
    }
    if (url.endsWith("/2.1.175/linux-arm64/claude")) return void res.end("hello");
    res.statusCode = 404; res.end("nope");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as import("node:net").AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => server.close());

function ctx() {
  return makeCtx({ HOME: mkdtempSync(path.join(tmpdir(), "ccx-reg-")) } as NodeJS.ProcessEnv, { baseUrl: base });
}

test("resolveChannelVersion returns the channel version", async () => {
  expect(await resolveChannelVersion(ctx(), "latest")).toBe("2.1.175");
  expect(await resolveChannelVersion(ctx(), "stable")).toBe("2.1.153");
});

test("resolveChannelVersion rejects non-version bodies", async () => {
  const bad = makeCtx({ HOME: "/h" } as NodeJS.ProcessEnv, {
    baseUrl: base,
    fetchImpl: (async () => new Response("<html>error</html>")) as typeof fetch,
  });
  await expect(resolveChannelVersion(bad, "latest")).rejects.toThrow(/non-version/);
});

test("fetchManifest parses platforms", async () => {
  const m = await fetchManifest(ctx(), "2.1.175");
  expect(m.platforms["linux-arm64"].checksum).toBe(HELLO_SHA);
});

test("downloadBinary verifies sha256", async () => {
  const c = ctx();
  const dest = path.join(c.home, "claude-binary");
  await downloadBinary(c, "2.1.175", "linux-arm64", dest, HELLO_SHA);
  expect(readFileSync(dest, "utf8")).toBe("hello");
  await expect(downloadBinary(c, "2.1.175", "linux-arm64", dest, "00".repeat(32)))
    .rejects.toThrow(/sha256 mismatch/);
});
```

- [ ] **Step 2: Run it, expect fail** — Run: `buno test src/registry.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

`claude-channel/src/registry.ts`:
```ts
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import type { Ctx } from "./ctx";
import type { Channel, Manifest } from "./types";

const VERSION_RE = /^\d+\.\d+\.\d+(-\S+)?$/;

export async function resolveChannelVersion(ctx: Ctx, channel: Channel): Promise<string> {
  const res = await ctx.fetchImpl(`${ctx.baseUrl}/${channel}`);
  if (!res.ok) throw new Error(`channel ${channel}: HTTP ${res.status}`);
  const version = (await res.text()).trim();
  if (!VERSION_RE.test(version)) {
    throw new Error(`channel ${channel} returned non-version content: ${version.slice(0, 40)}`);
  }
  return version;
}

export async function fetchManifest(ctx: Ctx, version: string): Promise<Manifest> {
  const res = await ctx.fetchImpl(`${ctx.baseUrl}/${version}/manifest.json`);
  if (!res.ok) throw new Error(`manifest ${version}: HTTP ${res.status}`);
  return (await res.json()) as Manifest;
}

/** Stream the raw binary to `destPath`, verifying sha256 against the manifest. */
export async function downloadBinary(
  ctx: Ctx, version: string, platformTag: string, destPath: string, expectedSha256: string,
): Promise<void> {
  const res = await ctx.fetchImpl(`${ctx.baseUrl}/${version}/${platformTag}/claude`);
  if (!res.ok || !res.body) throw new Error(`binary ${version}/${platformTag}: HTTP ${res.status}`);
  const hash = createHash("sha256");
  const file = createWriteStream(destPath);
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      hash.update(chunk);
      if (!file.write(chunk)) await new Promise((r) => file.once("drain", r));
    }
  } finally {
    await new Promise<void>((r) => file.end(() => r()));
  }
  const actual = hash.digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(`sha256 mismatch for ${version}/${platformTag}: expected ${expectedSha256}, got ${actual}`);
  }
}
```

- [ ] **Step 4: Run it, expect pass** — Run: `buno test src/registry.test.ts` → `4 pass`.

- [ ] **Step 5: Commit**

```bash
git add claude-channel/src/registry.ts claude-channel/src/registry.test.ts
git commit -m "feat(claude-channel): release-channel client with sha256 verify"
```

---

## Task 5: Channel launchers

**Files:**
- Create: `claude-channel/src/launcher.ts`
- Test: `claude-channel/src/launcher.test.ts`

- [ ] **Step 1: Write the failing test**

`claude-channel/src/launcher.test.ts`:
```ts
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
```

- [ ] **Step 2: Run it, expect fail** — `buno test src/launcher.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`claude-channel/src/launcher.ts`:
```ts
import { writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "./ctx";
import type { ChannelKind } from "./types";

export function launcherName(kind: ChannelKind): string {
  return kind === "next" ? "claude-next" : "claude";
}
export function launcherPath(ctx: Ctx, kind: ChannelKind): string {
  return path.join(ctx.localBin, launcherName(kind));
}

// NOTE on escaping: this is a JS template literal producing a bash script.
// `\${...}` and `$PREFIX` / `$@` stay LITERAL in the output (runtime shell vars);
// only `${ctx.*}` and `${binaryPath}` are interpolated by JS at generation time.
export function renderLauncher(ctx: Ctx, binaryPath: string): string {
  return [
    `#!${ctx.prefix}/bin/bash`,
    `# Generated by claude-channel (ccx) — pins this channel to a specific binary.`,
    `export CLAUDE_CODE_TMPDIR="\${CLAUDE_CODE_TMPDIR:-$PREFIX/tmp}"`,
    `export DISABLE_AUTOUPDATER=1`,
    `BUN_BINARY_PATH="${binaryPath}" exec "${ctx.bunTermux}" "$@"`,
    ``,
  ].join("\n");
}

export function writeLauncher(ctx: Ctx, kind: ChannelKind, binaryPath: string): void {
  mkdirSync(ctx.localBin, { recursive: true });
  const p = launcherPath(ctx, kind);
  writeFileSync(p, renderLauncher(ctx, binaryPath));
  chmodSync(p, 0o755);
}

export function readLauncherBinary(ctx: Ctx, kind: ChannelKind): string | null {
  const p = launcherPath(ctx, kind);
  if (!existsSync(p)) return null;
  const m = readFileSync(p, "utf8").match(/BUN_BINARY_PATH="([^"]+)"/);
  return m ? m[1] : null;
}
```

- [ ] **Step 4: Run it, expect pass** — `buno test src/launcher.test.ts` → `3 pass`.

- [ ] **Step 5: Commit**

```bash
git add claude-channel/src/launcher.ts claude-channel/src/launcher.test.ts
git commit -m "feat(claude-channel): channel launchers (DISABLE_AUTOUPDATER, bun-termux)"
```

---

## Task 6: State file

**Files:**
- Create: `claude-channel/src/state.ts`
- Test: `claude-channel/src/state.test.ts`

- [ ] **Step 1: Write the failing test**

`claude-channel/src/state.test.ts`:
```ts
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
```

- [ ] **Step 2: Run it, expect fail** — `buno test src/state.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`claude-channel/src/state.ts`:
```ts
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
```

- [ ] **Step 4: Run it, expect pass** — `buno test src/state.test.ts` → `3 pass`.

- [ ] **Step 5: Commit**

```bash
git add claude-channel/src/state.ts claude-channel/src/state.test.ts
git commit -m "feat(claude-channel): atomic channel-state file"
```

---

## Task 7: Platform interface + factory

**Files:**
- Create: `claude-channel/src/platform/platform.ts`, `claude-channel/src/platform/factory.ts`
- Test: `claude-channel/src/platform/factory.test.ts`

(Termux impl is Task 8; the factory test only checks the off-Termux rejection path, using a temp `home`/`prefix` with no `glibc`.)

- [ ] **Step 1: Write the failing test**

`claude-channel/src/platform/factory.test.ts`:
```ts
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCtx } from "../ctx";
import { detectPlatform } from "./factory";
import { NotImplementedError } from "./platform";

test("detectPlatform throws NotImplementedError when not Termux", () => {
  const ctx = makeCtx({ HOME: mkdtempSync(path.join(tmpdir(), "ccx-fac-")), PREFIX: "/no-such" } as NodeJS.ProcessEnv);
  expect(() => detectPlatform(ctx)).toThrow(NotImplementedError);
});
```

- [ ] **Step 2: Run it, expect fail** — `buno test src/platform/factory.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`claude-channel/src/platform/platform.ts`:
```ts
import type { Channel, ChannelKind } from "../types";

export class NotImplementedError extends Error {
  constructor(message: string) { super(message); this.name = "NotImplementedError"; }
}

export interface Platform {
  readonly id: "termux" | "linux" | "darwin";
  readonly platformTag: string;                      // e.g. "linux-arm64"
  resolveLatest(channel: Channel): Promise<string>;
  binaryDir(version: string): string;
  binaryPath(version: string): string;
  isInstalled(version: string): boolean;
  fetchBinary(version: string): Promise<string>;     // download + verify + patch -> binary path
  writeLauncher(kind: ChannelKind, binaryPath: string): void;
  readLauncherBinary(kind: ChannelKind): string | null;
  verify(kind: ChannelKind): Promise<string>;        // run the launcher --version
  pathPrecedenceOk(): boolean;
  scheduleInstall(everyHours: number): void;
  scheduleRemove(): void;
}
```

`claude-channel/src/platform/factory.ts`:
```ts
import { existsSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "../ctx";
import { type Platform, NotImplementedError } from "./platform";
import { TermuxPlatform } from "./termux";

export function detectPlatform(ctx: Ctx): Platform {
  const isTermux = existsSync(path.join(ctx.prefix, "glibc")) && existsSync(ctx.bunTermux);
  if (isTermux) return new TermuxPlatform(ctx);
  throw new NotImplementedError(
    "claude-channel currently supports Termux only (needs $PREFIX/glibc + bun-on-termux). " +
    "Cross-platform backends are planned behind the Platform interface.",
  );
}
```

(This won't compile until Task 8 creates `./termux`. Create `termux.ts` as an empty stub `export class TermuxPlatform {}` ONLY if needed to make this task's test run; Task 8 replaces it. Simpler: do Task 8 before running typecheck. The factory test itself passes because the not-Termux branch never constructs `TermuxPlatform`.)

- [ ] **Step 4: Run it, expect pass** — `buno test src/platform/factory.test.ts` → `1 pass`. (bun resolves the import lazily; if it complains about `./termux`, create the stub from Task 8 Step 3 first.)

- [ ] **Step 5: Commit**

```bash
git add claude-channel/src/platform/platform.ts claude-channel/src/platform/factory.ts claude-channel/src/platform/factory.test.ts
git commit -m "feat(claude-channel): Platform interface + factory"
```

---

## Task 8: TermuxPlatform

**Files:**
- Create: `claude-channel/src/platform/termux.ts`
- Test: `claude-channel/src/platform/termux.test.ts`

Test `fetchBinary` end-to-end against the same fixture server pattern (download → sha256 → patch → write under a temp `binariesDir`), and the pure helpers (`platformTag`, `binaryPath`, `pathPrecedenceOk`). `verify`/`scheduleInstall` (which shell out) are covered by channel/cli integration, not here.

- [ ] **Step 1: Write the failing test**

`claude-channel/src/platform/termux.test.ts`:
```ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import http from "node:http";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCtx } from "../ctx";
import { TermuxPlatform } from "./termux";
import { PATCH_TARGETS } from "../patch";

const PAYLOAD = `x${PATCH_TARGETS[0]}y`;
import { createHash } from "node:crypto";
const SHA = createHash("sha256").update(PAYLOAD).digest("hex");

let server: http.Server; let base: string;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = req.url ?? "";
    if (u.endsWith("/2.1.175/manifest.json")) {
      res.setHeader("content-type", "application/json");
      return void res.end(JSON.stringify({ version: "2.1.175", commit: "c", buildDate: "d",
        platforms: { "linux-arm64": { binary: "claude", checksum: SHA, size: PAYLOAD.length } } }));
    }
    if (u.endsWith("/2.1.175/linux-arm64/claude")) return void res.end(PAYLOAD);
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
});
afterAll(() => server.close());

function plat() {
  const ctx = makeCtx({ HOME: mkdtempSync(path.join(tmpdir(), "ccx-tmx-")), PREFIX: "/pfx" } as NodeJS.ProcessEnv, { baseUrl: base });
  return new TermuxPlatform(ctx);
}

test("platformTag and binary paths", () => {
  const p = plat();
  expect(p.platformTag).toBe("linux-arm64");
  expect(p.binaryPath("2.1.175").endsWith("/.claude/binaries/claude-2.1.175/claude-binary")).toBe(true);
});

test("fetchBinary downloads, verifies, patches, returns path", async () => {
  const p = plat();
  const bin = await p.fetchBinary("2.1.175");
  expect(existsSync(bin)).toBe(true);
  expect(existsSync(`${bin}.bak-prepatch`)).toBe(true);
  expect(readFileSync(bin, "latin1")).not.toContain(PATCH_TARGETS[0]);   // patched
  expect(readFileSync(`${bin}.bak-prepatch`, "latin1")).toContain(PATCH_TARGETS[0]); // backup raw
  expect(p.isInstalled("2.1.175")).toBe(true);
});

test("pathPrecedenceOk true when localBin precedes ~/.bun/bin", () => {
  const ctx = makeCtx({ HOME: "/h" } as NodeJS.ProcessEnv);
  const p = new TermuxPlatform(ctx);
  const orig = process.env.PATH;
  process.env.PATH = "/h/.local/bin:/h/.bun/bin:/usr/bin";
  expect(p.pathPrecedenceOk()).toBe(true);
  process.env.PATH = "/h/.bun/bin:/h/.local/bin";
  expect(p.pathPrecedenceOk()).toBe(false);
  process.env.PATH = orig;
});
```

- [ ] **Step 2: Run it, expect fail** — `buno test src/platform/termux.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`claude-channel/src/platform/termux.ts`:
```ts
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Ctx } from "../ctx";
import type { Channel, ChannelKind } from "../types";
import type { Platform } from "./platform";
import { resolveChannelVersion, fetchManifest, downloadBinary } from "../registry";
import { patchFile, keepFromEnv } from "../patch";
import { writeLauncher, readLauncherBinary, launcherPath } from "../launcher";
import { installCron, removeCron } from "../schedule";

export class TermuxPlatform implements Platform {
  readonly id = "termux" as const;
  readonly platformTag = "linux-arm64";
  constructor(private ctx: Ctx) {}

  resolveLatest(channel: Channel): Promise<string> { return resolveChannelVersion(this.ctx, channel); }
  binaryDir(v: string): string { return path.join(this.ctx.binariesDir, `claude-${v}`); }
  binaryPath(v: string): string { return path.join(this.binaryDir(v), "claude-binary"); }
  isInstalled(v: string): boolean { return existsSync(this.binaryPath(v)); }

  async fetchBinary(version: string): Promise<string> {
    const manifest = await fetchManifest(this.ctx, version);
    const info = manifest.platforms[this.platformTag];
    if (!info) throw new Error(`platform ${this.platformTag} not in manifest for ${version}`);
    mkdirSync(this.binaryDir(version), { recursive: true });
    const dest = this.binaryPath(version);
    await downloadBinary(this.ctx, version, this.platformTag, dest, info.checksum);
    chmodSync(dest, 0o755);
    patchFile(dest, keepFromEnv());
    return dest;
  }

  writeLauncher(kind: ChannelKind, binaryPath: string): void { writeLauncher(this.ctx, kind, binaryPath); }
  readLauncherBinary(kind: ChannelKind): string | null { return readLauncherBinary(this.ctx, kind); }

  async verify(kind: ChannelKind): Promise<string> {
    const out = execFileSync(launcherPath(this.ctx, kind), ["--version"], { encoding: "utf8", timeout: 90_000 });
    return out.trim().split("\n")[0];
  }

  pathPrecedenceOk(): boolean {
    const parts = (process.env.PATH ?? "").split(":");
    const a = parts.indexOf(this.ctx.localBin);
    const b = parts.indexOf(path.join(this.ctx.home, ".bun", "bin"));
    if (a < 0) return false;
    return b < 0 || a < b;
  }

  scheduleInstall(everyHours: number): void { installCron(this.ctx, everyHours); }
  scheduleRemove(): void { removeCron(this.ctx); }
}
```

NOTE: this imports `../schedule` (Task 9). Do Task 9 before running this task's test, or create the schedule stub from Task 9 Step 3 first.

- [ ] **Step 4: Run it, expect pass** — `buno test src/platform/termux.test.ts` → `3 pass`.

- [ ] **Step 5: Commit**

```bash
git add claude-channel/src/platform/termux.ts claude-channel/src/platform/termux.test.ts
git commit -m "feat(claude-channel): TermuxPlatform (fetch+verify+patch+launcher)"
```

---

## Task 9: Scheduler

**Files:**
- Create: `claude-channel/src/schedule.ts`
- Test: `claude-channel/src/schedule.test.ts`

Only the pure `cronLine` is unit-tested; `installCron`/`removeCron` shell out to `crontab` and are exercised manually.

- [ ] **Step 1: Write the failing test**

`claude-channel/src/schedule.test.ts`:
```ts
import { test, expect } from "bun:test";
import { makeCtx } from "./ctx";
import { cronLine, CRON_MARKER } from "./schedule";

test("cronLine hourly and daily forms carry the marker + ccx update", () => {
  const c = makeCtx({ HOME: "/h" } as NodeJS.ProcessEnv);
  const hourly = cronLine(c, 6);
  expect(hourly).toContain("ccx update");
  expect(hourly).toContain(CRON_MARKER);
  expect(hourly.startsWith("0 */6 * * *")).toBe(true);
  const daily = cronLine(c, 48);
  expect(daily.startsWith("0 3 */2 * *")).toBe(true);
});
```

- [ ] **Step 2: Run it, expect fail** — `buno test src/schedule.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`claude-channel/src/schedule.ts`:
```ts
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Ctx } from "./ctx";

export const CRON_MARKER = "# claude-channel ccx auto-update";

export function cronLine(ctx: Ctx, everyHours: number): string {
  const spec = everyHours >= 24
    ? `0 3 */${Math.max(1, Math.round(everyHours / 24))} * *` // daily-ish, 03:00
    : `0 */${Math.max(1, everyHours)} * * *`;                  // every N hours
  const log = path.join(ctx.home, ".claude", "ccx-update.log");
  return `${spec} ccx update >> ${log} 2>&1 ${CRON_MARKER}`;
}

function readCrontab(): string[] {
  try {
    return execFileSync("crontab", ["-l"], { encoding: "utf8" }).split("\n").filter((l) => l.length > 0);
  } catch {
    return []; // no crontab yet
  }
}
function writeCrontab(lines: string[]): void {
  execFileSync("crontab", ["-"], { input: lines.join("\n") + "\n" });
}

export function installCron(ctx: Ctx, everyHours: number): void {
  const lines = readCrontab().filter((l) => !l.includes(CRON_MARKER));
  lines.push(cronLine(ctx, everyHours));
  writeCrontab(lines);
}
export function removeCron(ctx: Ctx): void {
  writeCrontab(readCrontab().filter((l) => !l.includes(CRON_MARKER)));
}
```

- [ ] **Step 4: Run it, expect pass** — `buno test src/schedule.test.ts` → `1 pass`.

- [ ] **Step 5: Commit**

```bash
git add claude-channel/src/schedule.ts claude-channel/src/schedule.test.ts
git commit -m "feat(claude-channel): crontab scheduler"
```

---

## Task 10: Channel orchestration — update / promote / rollback

**Files:**
- Create: `claude-channel/src/channel.ts`
- Test: `claude-channel/src/channel.test.ts`

Tests use a `FakePlatform` (in-memory, no network/exec) plus a temp-`HOME` `Ctx`, so they assert orchestration + state transitions deterministically.

- [ ] **Step 1: Write the failing test**

`claude-channel/src/channel.test.ts`:
```ts
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
```

- [ ] **Step 2: Run it, expect fail** — `buno test src/channel.test.ts` → FAIL.

- [ ] **Step 3: Implement (orchestration part 1)**

`claude-channel/src/channel.ts`:
```ts
import { existsSync } from "node:fs";
import type { Ctx } from "./ctx";
import type { Platform } from "./platform/platform";
import type { Channel } from "./types";
import { loadState, saveState } from "./state";

const nowIso = (): string => new Date().toISOString();

export interface UpdateResult { action: "updated" | "current"; from: string | null; to: string; }
export async function update(platform: Platform, ctx: Ctx, channel: Channel = "latest", pin?: string): Promise<UpdateResult> {
  const state = loadState(ctx);
  const target = pin ?? (await platform.resolveLatest(channel));
  if (state.next && state.next.version === target && existsSync(state.next.binary)) {
    return { action: "current", from: state.next.version, to: target };
  }
  const binary = await platform.fetchBinary(target);
  platform.writeLauncher("next", binary);
  const reported = await platform.verify("next");
  if (!reported.startsWith(target)) {
    throw new Error(`verify failed: claude-next reports "${reported}", expected ${target}`);
  }
  const from = state.next?.version ?? null;
  state.next = { version: target, binary, patched: true, updatedAt: nowIso() };
  saveState(ctx, state);
  return { action: "updated", from, to: target };
}

export interface PromoteResult { action: "promoted" | "noop"; from: string | null; to: string; }
export function promote(platform: Platform, ctx: Ctx): PromoteResult {
  const state = loadState(ctx);
  if (!state.next) throw new Error("no 'next' channel installed — run `ccx update` first");
  if (state.stable && state.stable.version === state.next.version) {
    return { action: "noop", from: state.stable.version, to: state.next.version };
  }
  if (state.stable) {
    state.archive.unshift({
      version: state.stable.version, binary: state.stable.binary,
      promotedAt: state.stable.promotedAt, archivedAt: nowIso(),
    });
  }
  platform.writeLauncher("stable", state.next.binary);
  const from = state.stable?.version ?? null;
  state.stable = { version: state.next.version, binary: state.next.binary, patched: state.next.patched, promotedAt: nowIso() };
  saveState(ctx, state);
  return { action: "promoted", from, to: state.next.version };
}

export interface RollbackResult { to: string; refetched: boolean; }
export async function rollback(platform: Platform, ctx: Ctx, toVersion?: string): Promise<RollbackResult> {
  const state = loadState(ctx);
  if (state.archive.length === 0) throw new Error("nothing to roll back to (empty archive)");
  const idx = toVersion ? state.archive.findIndex((a) => a.version === toVersion) : 0;
  if (idx < 0) throw new Error(`version ${toVersion} not in archive`);
  const target = state.archive[idx];
  let binary = target.binary;
  let refetched = false;
  if (!existsSync(binary)) { binary = await platform.fetchBinary(target.version); refetched = true; }
  platform.writeLauncher("stable", binary);
  state.archive.splice(idx, 1);
  state.stable = { version: target.version, binary, patched: true, promotedAt: nowIso() };
  saveState(ctx, state);
  return { to: target.version, refetched };
}
```

- [ ] **Step 4: Run it, expect pass** — `buno test src/channel.test.ts` → `7 pass`.

- [ ] **Step 5: Commit**

```bash
git add claude-channel/src/channel.ts claude-channel/src/channel.test.ts
git commit -m "feat(claude-channel): update/promote/rollback orchestration"
```

---

## Task 11: Channel orchestration — status / list / prune

**Files:**
- Modify: `claude-channel/src/channel.ts` (append functions)
- Test: `claude-channel/src/channel-status.test.ts`

- [ ] **Step 1: Write the failing test**

`claude-channel/src/channel-status.test.ts`:
```ts
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCtx } from "./ctx";
import { status, list, prune } from "./channel";
import { loadState, saveState, emptyState } from "./state";
// Reuse the FakePlatform shape inline:
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
  // kept: 2.1.180 (next), 2.1.173 (stable), 2.1.172 + 2.1.171 (2 newest archived). removed: 2.1.170
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
```

- [ ] **Step 2: Run it, expect fail** — `buno test src/channel-status.test.ts` → FAIL (functions not exported).

- [ ] **Step 3: Implement (append to `channel.ts`)**

Append to `claude-channel/src/channel.ts`:
```ts
import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { ArchiveEntry } from "./types";

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export interface StatusInfo {
  next: { version: string; binary: string } | null;
  stable: { version: string; binary: string } | null;
  channelLatest: string | null;
  channelStable: string | null;
  updateAvailable: boolean;
  pathOk: boolean;
  nextHasAutoupdaterOff: boolean;
}
export async function status(platform: Platform, ctx: Ctx): Promise<StatusInfo> {
  const state = loadState(ctx);
  let channelLatest: string | null = null;
  let channelStable: string | null = null;
  try { channelLatest = await platform.resolveLatest("latest"); } catch { /* offline */ }
  try { channelStable = await platform.resolveLatest("stable"); } catch { /* offline */ }
  const updateAvailable = !!(channelLatest && (!state.next || compareVersions(channelLatest, state.next.version) > 0));
  return {
    next: state.next ? { version: state.next.version, binary: state.next.binary } : null,
    stable: state.stable ? { version: state.stable.version, binary: state.stable.binary } : null,
    channelLatest, channelStable, updateAvailable,
    pathOk: platform.pathPrecedenceOk(),
    nextHasAutoupdaterOff: hasAutoupdaterOff(ctx, platform),
  };
}

function hasAutoupdaterOff(ctx: Ctx, platform: Platform): boolean {
  const bin = platform.readLauncherBinary("next");
  if (bin === null) return true; // nothing installed yet — nothing to warn about
  // The launcher is generated by us and always carries the flag; this guards manual edits.
  try {
    const p = path.join(ctx.localBin, "claude-next");
    return require("node:fs").readFileSync(p, "utf8").includes("DISABLE_AUTOUPDATER=1");
  } catch { return false; }
}

function installedDirs(ctx: Ctx): string[] {
  try {
    return readdirSync(ctx.binariesDir)
      .filter((n) => n.startsWith("claude-"))
      .map((n) => path.join(ctx.binariesDir, n))
      .filter((d) => statSync(d).isDirectory());
  } catch { return []; }
}

export function list(ctx: Ctx): { installed: string[]; archive: ArchiveEntry[] } {
  const installed = installedDirs(ctx).map((d) => path.basename(d).replace(/^claude-/, ""));
  return { installed, archive: loadState(ctx).archive };
}

export interface PruneResult { removed: string[]; kept: string[]; }
export function prune(ctx: Ctx, keep = 2): PruneResult {
  const state = loadState(ctx);
  const protectedBins = new Set<string>();
  if (state.next) protectedBins.add(state.next.binary);
  if (state.stable) protectedBins.add(state.stable.binary);
  for (const a of state.archive.slice(0, keep)) protectedBins.add(a.binary);
  const removed: string[] = [];
  for (const dir of installedDirs(ctx)) {
    const bin = path.join(dir, "claude-binary");
    if (!protectedBins.has(bin)) { rmSync(dir, { recursive: true, force: true }); removed.push(dir); }
  }
  return { removed, kept: [...protectedBins] };
}
```

NOTE: `hasAutoupdaterOff` uses `require("node:fs")` to avoid reshuffling imports; if the bundler complains, hoist `readFileSync` into the top import block of `channel.ts`.

- [ ] **Step 4: Run it, expect pass** — `buno test src/channel-status.test.ts` → `3 pass`.

- [ ] **Step 5: Commit**

```bash
git add claude-channel/src/channel.ts claude-channel/src/channel-status.test.ts
git commit -m "feat(claude-channel): status/list/prune"
```

---

## Task 12: CLI — parse + dispatch

**Files:**
- Create: `claude-channel/src/cli.ts`
- Test: `claude-channel/src/cli.test.ts`

`parseArgs` is pure and unit-tested. `main()` wires `makeCtx` + `detectPlatform` + the channel ops and prints; it's exercised by the e2e task.

- [ ] **Step 1: Write the failing test**

`claude-channel/src/cli.test.ts`:
```ts
import { test, expect } from "bun:test";
import { parseArgs } from "./cli";

test("parseArgs: update defaults to latest channel", () => {
  expect(parseArgs(["update"])).toEqual({ command: "update", channel: "latest", json: false, yes: false });
});
test("parseArgs: update --channel stable --pin", () => {
  const p = parseArgs(["update", "--channel", "stable", "--pin", "2.1.175"]);
  expect(p).toMatchObject({ command: "update", channel: "stable", pin: "2.1.175" });
});
test("parseArgs: rollback --to", () => {
  expect(parseArgs(["rollback", "--to", "2.1.170"])).toMatchObject({ command: "rollback", to: "2.1.170" });
});
test("parseArgs: prune --keep, schedule --every, global --json", () => {
  expect(parseArgs(["prune", "--keep", "3"])).toMatchObject({ command: "prune", keep: 3 });
  expect(parseArgs(["schedule", "--every", "12"])).toMatchObject({ command: "schedule", everyHours: 12 });
  expect(parseArgs(["status", "--json"])).toMatchObject({ command: "status", json: true });
});
test("parseArgs: unknown command throws", () => {
  expect(() => parseArgs(["frobnicate"])).toThrow(/unknown command/);
});
```

- [ ] **Step 2: Run it, expect fail** — `buno test src/cli.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`claude-channel/src/cli.ts`:
```ts
import { makeCtx } from "./ctx";
import { detectPlatform } from "./platform/factory";
import { NotImplementedError } from "./platform/platform";
import { update, promote, rollback, status, list, prune } from "./channel";
import { launcherPath } from "./launcher";
import type { Channel } from "./types";

export interface ParsedArgs {
  command: string;
  channel: Channel;
  pin?: string;
  to?: string;
  keep: number;
  everyHours: number;
  json: boolean;
  yes: boolean;
}

const COMMANDS = new Set([
  "update", "promote", "rollback", "status", "list", "prune", "schedule", "unschedule", "alias", "help",
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (!command || !COMMANDS.has(command)) throw new Error(`unknown command: ${command ?? "(none)"}`);
  const out: ParsedArgs = { command, channel: "latest", keep: 2, everyHours: 24, json: false, yes: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const next = (): string => { const v = rest[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    switch (a) {
      case "--channel": { const c = next(); if (c !== "stable" && c !== "latest") throw new Error("--channel must be stable|latest"); out.channel = c; break; }
      case "--pin": out.pin = next(); break;
      case "--to": out.to = next(); break;
      case "--keep": out.keep = parseInt(next(), 10); break;
      case "--every": out.everyHours = parseInt(next(), 10); break;
      case "--json": out.json = true; break;
      case "--yes": case "-y": out.yes = true; break;
      default: throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

const HELP = `ccx — Claude Code channel manager (Termux)

  ccx update [--channel latest|stable] [--pin X.Y.Z]   fetch+patch latest into claude-next
  ccx promote                                          snapshot next -> claude (archives prev)
  ccx rollback [--to X.Y.Z]                            restore an archived stable
  ccx status [--json]                                  show channels + update availability
  ccx list                                             installed versions + archive
  ccx prune [--keep N]                                 free disk (default keep 2)
  ccx schedule [--every H] | ccx unschedule            opt-in auto-update (crontab)
  ccx alias                                            print shell alias + PATH hint
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let args: ParsedArgs;
  try { args = parseArgs(argv.length ? argv : ["help"]); }
  catch (e) { console.error(String((e as Error).message)); console.error(HELP); return 2; }

  if (args.command === "help") { console.log(HELP); return 0; }

  const ctx = makeCtx();
  if (args.command === "alias") {
    console.log(`alias cnup='ccx update'`);
    console.log(`# ensure ~/.local/bin precedes ~/.bun/bin on PATH:`);
    console.log(`export PATH="$HOME/.local/bin:$PATH"`);
    return 0;
  }

  let platform;
  try { platform = detectPlatform(ctx); }
  catch (e) { console.error((e as NotImplementedError).message); return 1; }

  try {
    switch (args.command) {
      case "update": {
        const r = await update(platform, ctx, args.channel, args.pin);
        console.log(r.action === "current" ? `claude-next already at ${r.to}` : `claude-next: ${r.from ?? "(none)"} -> ${r.to}`);
        return 0;
      }
      case "promote": {
        const r = promote(platform, ctx);
        console.log(r.action === "noop" ? `claude already at ${r.to}` : `promoted claude: ${r.from ?? "(none)"} -> ${r.to} (archived ${r.from ?? "nothing"})`);
        return 0;
      }
      case "rollback": {
        const r = await rollback(platform, ctx, args.to);
        console.log(`claude rolled back to ${r.to}${r.refetched ? " (re-fetched)" : ""}`);
        return 0;
      }
      case "status": {
        const s = await status(platform, ctx);
        if (args.json) { console.log(JSON.stringify(s, null, 2)); return 0; }
        console.log(`next:    ${s.next?.version ?? "(none)"}`);
        console.log(`stable:  ${s.stable?.version ?? "(none)"}   (${launcherPath(ctx, "stable")})`);
        console.log(`channel: latest=${s.channelLatest ?? "?"} stable=${s.channelStable ?? "?"}`);
        console.log(`update:  ${s.updateAvailable ? "AVAILABLE (run ccx update)" : "up to date"}`);
        if (!s.pathOk) console.log(`WARNING: ~/.local/bin is not ahead of ~/.bun/bin on PATH (run ccx alias)`);
        if (!s.nextHasAutoupdaterOff) console.log(`WARNING: claude-next launcher missing DISABLE_AUTOUPDATER=1`);
        return 0;
      }
      case "list": {
        const r = list(ctx);
        console.log(`installed: ${r.installed.join(", ") || "(none)"}`);
        console.log(`archive:   ${r.archive.map((a) => a.version).join(", ") || "(none)"}`);
        return 0;
      }
      case "prune": {
        const r = prune(ctx, args.keep);
        console.log(`pruned ${r.removed.length} version(s); kept ${r.kept.length}`);
        return 0;
      }
      case "schedule": { platform.scheduleInstall(args.everyHours); console.log(`scheduled: ccx update every ~${args.everyHours}h`); return 0; }
      case "unschedule": { platform.scheduleRemove(); console.log(`unscheduled ccx auto-update`); return 0; }
      default: console.error(HELP); return 2;
    }
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}
```

- [ ] **Step 4: Run it, expect pass** — `buno test src/cli.test.ts` → `5 pass`.

- [ ] **Step 5: Typecheck the whole package**

Run: `bunx tsc --noEmit -p claude-channel/tsconfig.json`
Expected: no errors. (If `hasAutoupdaterOff`'s `require` trips strict types, hoist `readFileSync` to the import block as the note says.)

- [ ] **Step 6: Commit**

```bash
git add claude-channel/src/cli.ts claude-channel/src/cli.test.ts
git commit -m "feat(claude-channel): CLI parse + dispatch"
```

---

## Task 13: Build, end-to-end smoke, README

**Files:**
- Create: `claude-channel/README.md`
- Test: manual e2e (build + run against a temp HOME + the live channel)

- [ ] **Step 1: Build the bundle**

Run: `cd claude-channel && buno run build.ts`
Expected: `built dist/cli.js`, and `dist/cli.js` starts with `#!/usr/bin/env node`.

- [ ] **Step 2: Run the full suite + typecheck**

Run:
```bash
cd claude-channel
buno test
bunx tsc --noEmit
```
Expected: all suites pass; tsc clean.

- [ ] **Step 3: E2E against the live release channel (read-only paths)**

Run (uses a throwaway HOME so nothing real is touched; `status` only reads channels + the empty state):
```bash
cd claude-channel
TESTHOME=$(mktemp -d)
HOME="$TESTHOME" PREFIX="$PREFIX" node dist/cli.js status
node dist/cli.js help
```
Expected: `status` prints `next: (none)`, `channel: latest=2.1.1xx ...`, `update: AVAILABLE`. `help` prints usage. (A real `update` downloads ~250 MB; only run it intentionally.)

- [ ] **Step 4: Write the README**

`claude-channel/README.md`:
```markdown
# claude-channel (`ccx`)

Manage Claude Code as two pinned channels on Termux:

- **next** — `ccx update` fetches the latest release, Termux-patches it, and pins it to
  `~/.local/bin/claude-next`. Re-run anytime; it no-ops when already current.
- **stable** — `ccx promote` snapshots next → `~/.local/bin/claude` and archives the
  outgoing stable. `ccx rollback` restores it (re-fetching if pruned).

## Install

```bash
npm i -g claude-channel    # or: bun add -g claude-channel
ccx alias >> ~/.bashrc      # adds `cnup` alias + PATH hint
```

Requires Termux with bun-on-termux (`~/.bun/bin/bun-termux`) and the glibc runtime
(`$PREFIX/glibc`). Updates come from the native release channel
`https://downloads.claude.ai/claude-code-releases` (not npm).

## Commands

| Command | What |
|---|---|
| `ccx update [--channel latest\|stable] [--pin X.Y.Z]` | install/refresh **next** |
| `ccx promote` | next → stable, archiving the old stable |
| `ccx rollback [--to X.Y.Z]` | restore an archived stable |
| `ccx status [--json]` | versions + update availability + PATH check |
| `ccx list` | installed versions + archive |
| `ccx prune [--keep N]` | reclaim disk (default keep 2; ~250 MB/binary) |
| `ccx schedule [--every H]` / `ccx unschedule` | opt-in crontab auto-update |
| `ccx alias` | print the `cnup` alias + PATH line |

The pinned launchers export `DISABLE_AUTOUPDATER=1` so `ccx` is the sole updater and a
channel never changes underneath you.
```

- [ ] **Step 5: Commit**

```bash
git add claude-channel/README.md
git commit -m "feat(claude-channel): build script, README, e2e smoke"
```

---

## Self-Review

**Spec coverage:** update (T10) ✓; promote+archive (T10) ✓; rollback w/ re-fetch (T10) ✓; status (T11) ✓; list (T11) ✓; prune --keep 2 (T11) ✓; schedule/unschedule (T9, T12) ✓; alias (T12) ✓; platform layer + Termux backend + NotImplemented (T7, T8) ✓; native release channel + sha256, no npm (T4, T8) ✓; byte-preserving patch + CCPATCH_KEEP_* (T3) ✓; DISABLE_AUTOUPDATER launchers (T5) ✓; two-pin model + state file (T5, T6) ✓; node runtime + Bun.build packaging + files allowlist (T1, T13) ✓; atomic writes (T6) ✓.

**Deferred from spec (acceptable for v1, noted):** the `~/.claude/binaries/.ccx.lock` re-entrancy lock and the post-failure auto-rollback of a channel pin are NOT implemented in these tasks — add as a follow-up task if the opt-in scheduler runs concurrently with manual use in practice. `ccx status` surfaces the PATH + autoupdater-flag warnings in lieu of auto-fixing.

**Placeholder scan:** no TBD/TODO; every code step has complete code.

**Type consistency:** `Platform` method names (`resolveLatest`, `fetchBinary`, `writeLauncher`, `readLauncherBinary`, `verify`, `pathPrecedenceOk`, `scheduleInstall/Remove`, `binaryDir/binaryPath/isInstalled`) are identical across `platform.ts`, `termux.ts`, both `FakePlatform`s, and `channel.ts`. `ChannelState`/pins fields (`version`, `binary`, `patched`, `updatedAt`/`promotedAt`/`archivedAt`) match `types.ts` across `state.ts`, `channel.ts`, and tests. `Ctx` fields consistent everywhere.

**Cross-task build-order note:** Tasks 7→8→9 have circular-ish imports (factory→termux→schedule). Implement 7, 8, 9 before running `tsc` (Step in T12) or each other's tests; bun resolves lazily per-test-file so individual suites pass in order.
