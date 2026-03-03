#!/usr/bin/env node
/**
 * fix-android-binaries.mjs — Postinstall for Termux/Android
 *
 * bun installs linux-arm64-gnu native binaries (glibc), but Astro's build
 * runs through Node.js (bionic) which needs android-arm64 variants.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "android") {
  console.log("[fix-android-binaries] Not on Android, skipping.");
  process.exit(0);
}

const nm = join(import.meta.dirname, "..", "node_modules");

/** Install a platform-specific package if missing */
function ensureAndroidBinary(pkg, versionSource, checkDir, cwd) {
  if (existsSync(checkDir)) {
    console.log(`[fix-android-binaries] ${pkg} already present, skipping.`);
    return;
  }
  let version;
  try {
    const pj = JSON.parse(readFileSync(versionSource, "utf8"));
    version = pj.version;
  } catch {
    console.warn(`[fix-android-binaries] Can't read version from ${versionSource}, skipping ${pkg}`);
    return;
  }
  const target = `${pkg}@${version}`;
  const dir = cwd || join(import.meta.dirname, "..");
  console.log(`[fix-android-binaries] Installing ${target} ...`);
  try {
    execSync(`npm install ${target} --no-save --no-audit --no-fund --legacy-peer-deps`, {
      cwd: dir, stdio: "pipe", timeout: 60_000,
    });
    console.log(`[fix-android-binaries] ${target} installed.`);
  } catch (e) {
    console.error(`[fix-android-binaries] Failed to install ${target}: ${e.message}`);
  }
}

/** Fix esbuild android-arm64 binary */
function fixEsbuild(esbuildDir) {
  if (!existsSync(esbuildDir)) return;
  const pj = JSON.parse(readFileSync(join(esbuildDir, "package.json"), "utf8"));
  const androidBinDir = join(esbuildDir, "node_modules", "@esbuild", "android-arm64");
  if (existsSync(join(androidBinDir, "bin/esbuild"))) {
    console.log(`[fix-android-binaries] @esbuild/android-arm64@${pj.version} already present.`);
    return;
  }
  console.log(`[fix-android-binaries] Installing @esbuild/android-arm64@${pj.version} ...`);
  try {
    execSync(`npm install @esbuild/android-arm64@${pj.version} --no-save --no-audit --no-fund --legacy-peer-deps`, {
      cwd: esbuildDir, stdio: "pipe", timeout: 60_000,
    });
    console.log(`[fix-android-binaries] @esbuild/android-arm64@${pj.version} installed.`);
  } catch (e) {
    console.error(`[fix-android-binaries] Failed to fix esbuild: ${e.message}`);
  }
}

// lightningcss
ensureAndroidBinary(
  "lightningcss-android-arm64",
  join(nm, "lightningcss/package.json"),
  join(nm, "lightningcss-android-arm64"),
);

// @tailwindcss/oxide
ensureAndroidBinary(
  "@tailwindcss/oxide-android-arm64",
  join(nm, "@tailwindcss/oxide/package.json"),
  join(nm, "@tailwindcss/oxide-android-arm64"),
);

// @rollup — bun installs linux-arm64-gnu, need android-arm64
ensureAndroidBinary(
  "@rollup/rollup-android-arm64",
  join(nm, "rollup/package.json"),
  join(nm, "@rollup/rollup-android-arm64"),
);

// esbuild (top-level and vite's nested copy)
fixEsbuild(join(nm, "esbuild"));
fixEsbuild(join(nm, "vite/node_modules/esbuild"));
