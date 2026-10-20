import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  AGX_DISABLE_AUTO_UPDATE, agxBinary, agxCronLine, fetchAgxManifest, importLegacyAgx, installedAgx, launchArgv, launchEnv,
  pruneAgx, readAgxState, resolveAgx, switchAgx, updateAgx, type AgxContext,
} from "./antigravity";
import { parseAgxArgs, setupAgx } from "./antigravity-cli";
import { atomicWrite } from "./managed";

const dirs: string[] = [];
// Fixture scripts need a real bash: Termux keeps it under $PREFIX, CI runners under /bin.
const shell = ["/data/data/com.termux/files/usr/bin/bash", process.env.PREFIX ? `${process.env.PREFIX}/bin/bash` : "", "/bin/bash", "/usr/bin/bash"]
  .filter(Boolean).find(candidate => existsSync(candidate)) ?? "/bin/bash";
const MANIFEST_URL = "https://updater.test/manifests/linux_arm64.json";

interface Release { version: string; url: string; sha512: string; tarball: string; }

/** Build a tar.gz holding a fake `antigravity` that prints `reported` for --version. */
function release(dir: string, version: string, reported = version): Release {
  const stage = path.join(dir, `stage-${version}`);
  mkdirSync(stage, { recursive: true });
  writeFileSync(path.join(stage, "antigravity"), `#!${shell}\nif [ "$1" = --version ]; then echo '${reported}'; else echo "ran:$*"; fi\n`, { mode: 0o755 });
  const tarball = path.join(dir, `cli-${version}.tar.gz`);
  const tar = spawnSync("tar", ["-czf", tarball, "-C", stage, "antigravity"], { encoding: "utf8" });
  if (tar.status !== 0) throw new Error(`fixture tar failed: ${tar.stderr}`);
  const sha512 = createHash("sha512").update(readFileSync(tarball)).digest("hex");
  return { version, url: `https://storage.test/antigravity-cli/${version}-123/linux-arm/cli_linux_arm64.tar.gz`, sha512, tarball };
}

/** Offline-by-default context; `serve` wires a manifest + tarball responses. */
function fixture(): AgxContext & { serve: (current: Release | null, ...known: Release[]) => void } {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), "agx-test-")); dirs.push(dir);
  const ctx: AgxContext & { serve: (current: Release | null, ...known: Release[]) => void } = {
    root: path.join(dir, "root"),
    prefix: process.env.PREFIX ?? "/data/data/com.termux/files/usr",
    localBin: path.join(dir, "launchers"),
    manifestUrl: MANIFEST_URL,
    legacyBinary: path.join(dir, "legacy", "antigravity"),
    proot: null,
    loader: path.join(dir, "ld-linux-aarch64.so.1"),
    resolver: path.join(dir, "resolv.conf"),
    fetchImpl: async () => { throw new Error("offline"); },
    serve(current, ...known) {
      const all = current ? [current, ...known] : known;
      ctx.fetchImpl = async (url: string) => {
        if (url === MANIFEST_URL) {
          if (!current) return new Response("gone", { status: 404 });
          return new Response(JSON.stringify({ version: current.version, url: current.url, sha512: current.sha512 }));
        }
        const hit = all.find(r => r.url === url);
        return hit ? new Response(readFileSync(hit.tarball)) : new Response("missing", { status: 404 });
      };
    },
  };
  return ctx;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test("launch environment drops the bionic preload and disables the CLI self-updater", () => {
  const env = launchEnv({ PATH: "/x", LD_PRELOAD: "/libtermux-exec.so", HOME: "/h" });
  expect(env.LD_PRELOAD).toBeUndefined();
  expect(env[AGX_DISABLE_AUTO_UPDATE]).toBe("true");
  expect(env.PATH).toBe("/x");
});

test("launch argv binds the glibc loader and resolver under proot, or execs directly without it", () => {
  const ctx = fixture();
  expect(launchArgv(ctx, "/bin/ag", ["--version"])).toEqual(["/bin/ag", "--version"]);
  const prooted = { ...ctx, proot: "/usr/bin/proot" };
  expect(launchArgv(prooted, "/bin/ag", ["-p", "hi"])).toEqual([
    "/usr/bin/proot", "-b", `${ctx.loader}:/lib/ld-linux-aarch64.so.1`, "-b", `${ctx.resolver}:/etc/resolv.conf`, "/bin/ag", "-p", "hi",
  ]);
});

test("state defaults include an empty catalog and corrupt state fails closed", () => {
  const ctx = fixture();
  expect(readAgxState(ctx)).toEqual({ schema: 1, next: null, stable: null, archive: [], catalog: {} });
  mkdirSync(ctx.root, { recursive: true });
  for (const bad of ["{", JSON.stringify({ schema: 1, next: null, stable: null, archive: [], catalog: { "1.0.0": { url: 1 } } }), JSON.stringify({ schema: 1, next: "../x", stable: null, archive: [], catalog: {} })]) {
    writeFileSync(path.join(ctx.root, "state.json"), bad);
    expect(() => readAgxState(ctx)).toThrow();
  }
});

test("manifest fetch rejects missing fields, malformed versions and non-https download URLs", async () => {
  const ctx = fixture();
  const cases = [
    { version: "1.4.3", url: "https://storage.test/a.tar.gz" },
    { version: "latest", url: "https://storage.test/a.tar.gz", sha512: "ab" },
    { version: "1.4.3", url: "http://storage.test/a.tar.gz", sha512: "ab" },
  ];
  for (const body of cases) {
    ctx.fetchImpl = async () => new Response(JSON.stringify(body));
    await expect(fetchAgxManifest(ctx)).rejects.toThrow();
  }
  ctx.fetchImpl = async () => new Response("nope", { status: 503 });
  await expect(fetchAgxManifest(ctx)).rejects.toThrow("503");
});

test("update installs the manifest release into next, records the catalog and verifies the reported version", async () => {
  const ctx = fixture(); const r = release(ctx.root + "-fixtures", "1.4.3"); ctx.serve(r);
  const state = await updateAgx(ctx);
  expect(state.next).toBe("1.4.3"); expect(state.stable).toBeNull();
  expect(state.catalog["1.4.3"]).toMatchObject({ url: r.url, sha512: r.sha512 });
  const binary = agxBinary(ctx, "1.4.3");
  expect(lstatSync(binary).mode & 0o111).not.toBe(0);
  const inode = lstatSync(binary).ino;
  await updateAgx(ctx);
  expect(lstatSync(binary).ino).toBe(inode);
  expect(existsSync(path.join(ctx.root, "versions", "1.4.3", "antigravity"))).toBe(true);
  expect(installedAgx(ctx)).toEqual(["1.4.3"]);
});

test("a pinned version resolves from the catalog when the manifest has moved on, and unknown pins are refused", async () => {
  const ctx = fixture(); const dir = ctx.root + "-fixtures";
  const old = release(dir, "1.4.2"); const current = release(dir, "1.4.3");
  ctx.serve(old); await updateAgx(ctx);
  ctx.serve(current, old);
  expect(await resolveAgx(ctx, "1.4.2")).toBe("1.4.2");
  await expect(resolveAgx(ctx, "9.9.9")).rejects.toThrow("not in the catalog");
  await expect(resolveAgx(ctx, "../etc")).rejects.toThrow("Invalid version");
  expect(await resolveAgx(ctx)).toBe("1.4.3");
  // Catalog survives across a manifest outage, so the pin still installs offline.
  ctx.serve(null, old, current); rmSync(path.join(ctx.root, "versions"), { recursive: true, force: true });
  expect((await updateAgx(ctx, "1.4.2")).next).toBe("1.4.2");
});

test("promotion archives the outgoing stable and rollback restores it", async () => {
  const ctx = fixture(); const dir = ctx.root + "-fixtures";
  ctx.serve(release(dir, "1.4.2")); await updateAgx(ctx); switchAgx(ctx);
  ctx.serve(release(dir, "1.4.3")); await updateAgx(ctx);
  expect(readAgxState(ctx).stable).toBe("1.4.2");
  switchAgx(ctx); expect(readAgxState(ctx)).toMatchObject({ stable: "1.4.3", archive: ["1.4.2"] });
  switchAgx(ctx, true); expect(readAgxState(ctx)).toMatchObject({ stable: "1.4.2", archive: ["1.4.3"] });
  expect(() => switchAgx(ctx, true, "0.0.1")).toThrow("archived");
});

test("a release whose binary reports the wrong version is discarded and leaves both channels untouched", async () => {
  const ctx = fixture(); const dir = ctx.root + "-fixtures";
  ctx.serve(release(dir, "1.4.2")); await updateAgx(ctx); switchAgx(ctx);
  const before = readAgxState(ctx);
  ctx.serve(release(dir, "1.4.3", "0.0.0"));
  await expect(updateAgx(ctx)).rejects.toThrow("Expected");
  expect(readAgxState(ctx)).toEqual({ ...before, catalog: readAgxState(ctx).catalog });
  expect(existsSync(path.join(ctx.root, "versions", "1.4.3"))).toBe(false);
});

test("a checksum mismatch refuses the download and installs nothing", async () => {
  const ctx = fixture(); const r = release(ctx.root + "-fixtures", "1.4.3");
  ctx.serve({ ...r, sha512: "0".repeat(128) });
  await expect(updateAgx(ctx)).rejects.toThrow("sha512");
  expect(installedAgx(ctx)).toEqual([]);
  expect(readAgxState(ctx).next).toBeNull();
});

test("prune previews by default and protects next, stable and retained archive entries", async () => {
  const ctx = fixture(); const dir = ctx.root + "-fixtures";
  for (const v of ["1.4.0", "1.4.1", "1.4.2", "1.4.3"]) { ctx.serve(release(dir, v)); await updateAgx(ctx); switchAgx(ctx); }
  expect(pruneAgx(ctx, 1, false)).toEqual(["1.4.0", "1.4.1"]);
  expect(installedAgx(ctx)).toHaveLength(4);
  pruneAgx(ctx, 1, true);
  expect(installedAgx(ctx)).toEqual(["1.4.2", "1.4.3"]);
  expect(readAgxState(ctx).archive).toEqual(["1.4.2"]);
  expect(() => pruneAgx(ctx, -1, false)).toThrow("--keep");
});

test("importing the legacy installer binary seeds stable once and is idempotent", () => {
  const ctx = fixture();
  expect(importLegacyAgx(ctx)).toBeNull();
  mkdirSync(path.dirname(ctx.legacyBinary), { recursive: true });
  writeFileSync(ctx.legacyBinary, `#!${shell}\necho 1.4.2\n`, { mode: 0o755 });
  expect(importLegacyAgx(ctx)).toBe("1.4.2");
  expect(readAgxState(ctx)).toMatchObject({ stable: "1.4.2", next: null });
  expect(existsSync(agxBinary(ctx, "1.4.2"))).toBe(true);
  expect(existsSync(ctx.legacyBinary)).toBe(true); // never deletes the legacy install
  const inode = lstatSync(agxBinary(ctx, "1.4.2")).ino;
  expect(importLegacyAgx(ctx)).toBe("1.4.2");
  expect(lstatSync(agxBinary(ctx, "1.4.2")).ino).toBe(inode);
});

test("setup replaces only managed or legacy-installer launchers and writes channel dispatchers", () => {
  const ctx = fixture(); mkdirSync(ctx.localBin, { recursive: true });
  writeFileSync(path.join(ctx.localBin, "agy"), "#!/bin/bash\n# Antigravity CLI launcher for Termux -- generated by install-antigravity-termux.sh.\nexec proot x\n");
  setupAgx(ctx, "/path with space/agx.js");
  const agy = readFileSync(path.join(ctx.localBin, "agy"), "utf8");
  expect(agy).toContain("# agx managed launcher"); expect(agy).toContain("run stable"); expect(agy).toContain("'/path with space/agx.js'");
  expect(readFileSync(path.join(ctx.localBin, "agy-next"), "utf8")).toContain("run next");
  expect(lstatSync(path.join(ctx.localBin, "agx")).isSymbolicLink()).toBe(false);
  atomicWrite(path.join(ctx.localBin, "agy"), "unmanaged\n");
  expect(() => setupAgx(ctx, "/manager")).toThrow("unmanaged");
  expect(readFileSync(path.join(ctx.localBin, "agy"), "utf8")).toBe("unmanaged\n");
});

test("cron entries quote the manager path, limit intervals and only touch next", () => {
  const ctx = fixture();
  const line = agxCronLine(ctx, "/manager path/agx.js", 12);
  expect(line).toStartWith("0 */12 * * * "); expect(line).toContain("'/manager path/agx.js' update"); expect(line).not.toContain("promote");
  expect(line).toEndWith("# antigravity-channel agx auto-update");
  expect(() => agxCronLine(ctx, "/m", 7)).toThrow();
});

test("argument parsing accepts import and rejects foreign, duplicate or valueless flags", () => {
  expect(parseAgxArgs(["import"]).command).toBe("import");
  expect(parseAgxArgs(["update", "--pin", "1.4.2"]).value).toBe("1.4.2");
  for (const args of [["import", "--pin", "1.2.3"], ["prune", "--keep", "x"], ["update", "--pin"], ["status", "--json", "--json"], ["frobnicate"]]) {
    expect(() => parseAgxArgs(args)).toThrow();
  }
});
