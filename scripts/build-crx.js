#!/usr/bin/env node
/**
 * Build a signed CRX3 from edge-claude-ext/ directory.
 *
 * Reads version from manifest.json and outputs:
 *   claude-code-bridge-v{version}.crx
 *
 * Usage:
 *   node scripts/build-crx.js                  # uses edge-claude-ext.pem
 *   CRX_PEM="base64..." node scripts/build-crx.js  # uses PEM from env (CI)
 */

const { readFileSync, writeFileSync, mkdirSync } = require("fs");
const { join, resolve } = require("path");
const crx3 = require("crx3");

const ROOT = resolve(__dirname, "..");
const EXT_DIR = join(ROOT, "edge-claude-ext");
const DIST_DIR = join(ROOT, "dist");
const MANIFEST = JSON.parse(readFileSync(join(EXT_DIR, "manifest.json"), "utf-8"));
const VERSION = MANIFEST.version;
const OUT_NAME = `claude-code-bridge-v${VERSION}.crx`;

async function main() {
  mkdirSync(DIST_DIR, { recursive: true });

  // Resolve PEM: env var (base64) > local file
  let pemPath = join(ROOT, "edge-claude-ext.pem");
  if (process.env.CRX_PEM) {
    pemPath = join(DIST_DIR, "_signing.pem");
    writeFileSync(pemPath, Buffer.from(process.env.CRX_PEM, "base64"));
  }

  const outPath = join(DIST_DIR, OUT_NAME);

  await crx3([EXT_DIR], {
    keyPath: pemPath,
    crxPath: outPath,
  });

  // Clean up temp PEM if we created one
  if (process.env.CRX_PEM) {
    require("fs").unlinkSync(pemPath);
  }

  console.log(`Built ${OUT_NAME} (v${VERSION}) → ${outPath}`);
}

main().catch((err) => {
  console.error("CRX build failed:", err);
  process.exit(1);
});
