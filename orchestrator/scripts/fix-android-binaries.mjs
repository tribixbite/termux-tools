#!/usr/bin/env node
/**
 * fix-android-binaries.mjs — Postinstall script for Termux/Android
 *
 * On Termux, bun installs linux-arm64-gnu native binaries (glibc),
 * but Node.js (bionic) needs android-arm64 variants.
 * This script installs @esbuild/android-arm64 to match the esbuild version.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Only run on Android/Termux
if (process.platform !== "android") {
  console.log("[fix-android-binaries] Not on Android, skipping.");
  process.exit(0);
}

const projectRoot = join(import.meta.dirname, "..");
const nm = join(projectRoot, "node_modules");

/**
 * Fix esbuild for Android: install @esbuild/android-arm64 matching the
 * installed esbuild version, since bun installs @esbuild/linux-arm64 instead.
 * @param {string} esbuildDir - path to an esbuild install directory
 */
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
    execSync(`npm install @esbuild/android-arm64@${pj.version} --no-save --no-audit --no-fund`, {
      cwd: esbuildDir,
      stdio: "pipe",
      timeout: 60_000,
    });
    console.log(`[fix-android-binaries] @esbuild/android-arm64@${pj.version} installed.`);
  } catch (e) {
    console.error(`[fix-android-binaries] Failed to fix esbuild: ${e.message}`);
  }
}

// Fix top-level esbuild (used by build.cjs)
fixEsbuild(join(nm, "esbuild"));
