#!/usr/bin/env node
/**
 * fix-android-binaries.mjs — Postinstall script for Termux/Android
 *
 * Problem: bun runs under glibc-runner on Termux, so it detects the platform
 * as "linux arm64" and installs the linux-arm64 native bindings. The build
 * then runs through Node.js (bionic), which reports process.platform ===
 * "android" and looks for the *android-arm64* binding packages instead, so
 * the build fails (e.g. rolldown: "Cannot find module
 * './rolldown-binding.wasi.cjs'").
 *
 * Solution: for every installed copy of a package with a native binding
 * (top-level and nested, since different dependents can pin different
 * versions), make sure the android-arm64 binding of EXACTLY that version
 * sits next to it. A binding that exists but has another version counts as
 * missing: a stale binding loads and then fails its version check.
 *
 * Bindings are fetched with `npm pack` and unpacked in place, which works for
 * nested copies too (no npm install inside node_modules).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Only run on Android/Termux
if (process.platform !== "android") {
  console.log("[fix-android-binaries] Not on Android, skipping.");
  process.exit(0);
}

const nm = join(import.meta.dirname, "..", "node_modules");

/** Directory names to never descend into while looking for packages. */
const SKIP_DIRS = new Set([".bin", ".cache", ".vite"]);

/** Binding package names for Android on 64-bit ARM (not arm-eabi, x64, ...). */
const ANDROID_ARM64 = /android-arm64$/;

/**
 * Find every installed package (top-level and nested) that ships its native
 * code as an android-arm64 optional dependency: rolldown, the Rust Astro
 * compiler, Sätteri, Tailwind's oxide, lightningcss, esbuild, rollup, ...
 * Discovered from package.json rather than listed, so new native packages in
 * future Astro/Vite releases are covered without editing this script.
 * @param {string} root - a node_modules directory
 * @param {number} depth - remaining nesting levels to search
 * @returns {{ dir: string, name: string, binding: string, version: string }[]}
 */
function findHosts(root, depth = 4) {
  const hosts = [];
  if (depth < 0 || !existsSync(root)) return hosts;
  for (const entry of readdirSync(root)) {
    if (SKIP_DIRS.has(entry)) continue;
    const dirs = entry.startsWith("@")
      ? readdirSync(join(root, entry)).map((s) => join(root, entry, s))
      : [join(root, entry)];
    for (const dir of dirs) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        for (const [binding, version] of Object.entries(pkg.optionalDependencies ?? {})) {
          if (ANDROID_ARM64.test(binding)) hosts.push({ dir, name: pkg.name, binding, version });
        }
      } catch {
        // not a package directory
      }
      hosts.push(...findHosts(join(dir, "node_modules"), depth - 1));
    }
  }
  return hosts;
}

/** @param {string} dir @returns {string | null} package version, or null */
function versionOf(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

/**
 * Where Node resolves `binding` from for `host` installed at `hostDir`: the
 * host's own node_modules first, then the node_modules directory holding the
 * host. Only one copy of `host` can live in that directory, so the sibling
 * binding there belongs to this copy alone and is safe to replace.
 * @param {string} hostDir - .../node_modules/<host>
 * @param {string} host - package name (may be scoped)
 * @param {string} binding
 */
function bindingDirFor(hostDir, host, binding) {
  const own = join(hostDir, "node_modules", binding);
  if (existsSync(own)) return own;
  const containingNodeModules = hostDir.slice(0, hostDir.length - host.length - 1);
  return join(containingNodeModules, binding);
}

/**
 * Replace `targetDir` with the published `binding@version` package.
 * @param {string} binding
 * @param {string} version
 * @param {string} targetDir
 */
function installBinding(binding, version, targetDir) {
  const work = mkdtempSync(join(tmpdir(), "fix-android-"));
  try {
    const tarball = execFileSync("npm", ["pack", `${binding}@${version}`, "--silent", "--pack-destination", work], {
      cwd: work,
      encoding: "utf8",
      timeout: 120_000,
    }).trim().split("\n").pop();
    execFileSync("tar", ["-xzf", join(work, tarball), "-C", work], { timeout: 60_000 });
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(dirname(targetDir), { recursive: true });
    renameSync(join(work, "package"), targetDir);
    console.log(`[fix-android-binaries] installed ${binding}@${version} → ${targetDir}`);
  } catch (e) {
    console.error(`[fix-android-binaries] failed to install ${binding}@${version}: ${e.message}`);
    process.exitCode = 1;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

for (const { dir, name, binding, version } of findHosts(nm)) {
  // optionalDependencies pin the exact binding version for these packages.
  const target = bindingDirFor(dir, name, binding);
  const have = versionOf(target);
  if (have === version) {
    console.log(`[fix-android-binaries] ${binding}@${version} ok for ${name}`);
    continue;
  }
  console.log(`[fix-android-binaries] ${binding} for ${name}: ${have ? `found ${have}, need ${version}` : `missing, need ${version}`}`);
  installBinding(binding, version, target);
}
