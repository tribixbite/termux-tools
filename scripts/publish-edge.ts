#!/usr/bin/env bun
/**
 * Publish extension update to Microsoft Edge Add-ons store.
 *
 * Uses the Edge Add-ons REST API v1.1 (API Key auth).
 * Reads credentials from .env or environment variables.
 *
 * Flow:
 *   1. Zip edge-claude-ext/ directory
 *   2. Upload zip to draft package
 *   3. Poll until upload succeeds
 *   4. Publish the draft
 *   5. Poll until publish completes
 *
 * Usage:
 *   bun scripts/publish-edge.ts              # build + publish
 *   bun scripts/publish-edge.ts --dry-run    # build zip only, don't publish
 */

import { readFileSync, existsSync, statSync } from "fs";
import { resolve, join } from "path";
import { spawnSync } from "child_process";

const ROOT = resolve(import.meta.dirname!, "..");
const EXT_DIR = join(ROOT, "edge-claude-ext");
const DIST_DIR = join(ROOT, "dist");
const MANIFEST = JSON.parse(readFileSync(join(EXT_DIR, "manifest.json"), "utf-8"));
const VERSION: string = MANIFEST.version;

// ── Load .env if present ──────────────────────────────────────────────
const envPath = join(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

// ── Config ────────────────────────────────────────────────────────────
const CLIENT_ID = process.env.EDGE_CLIENT_ID;
const API_KEY = process.env.EDGE_API_KEY;
const PRODUCT_ID = process.env.EDGE_PRODUCT_ID;
const DRY_RUN = process.argv.includes("--dry-run");

const API_BASE = "https://api.addons.microsoftedge.microsoft.com";

if (!CLIENT_ID || !API_KEY || !PRODUCT_ID) {
  console.error("Missing EDGE_CLIENT_ID, EDGE_API_KEY, or EDGE_PRODUCT_ID");
  console.error("Set in .env or environment variables");
  process.exit(1);
}

/** Auth headers for Edge Add-ons API v1.1 */
function authHeaders(): Record<string, string> {
  return {
    "Authorization": `ApiKey ${API_KEY}`,
    "X-ClientID": CLIENT_ID!,
  };
}

// ── Step 1: Create zip ────────────────────────────────────────────────
function buildZip(): string {
  const zipName = `claude-code-bridge-v${VERSION}.zip`;
  const zipPath = join(DIST_DIR, zipName);

  // Remove old zip if exists
  spawnSync("rm", ["-f", zipPath]);
  spawnSync("mkdir", ["-p", DIST_DIR]);

  // Zip the extension directory contents (not the directory itself)
  const result = spawnSync("zip", ["-r", zipPath, "."], {
    cwd: EXT_DIR,
    stdio: "pipe",
  });

  if (result.status !== 0) {
    console.error("zip failed:", result.stderr?.toString());
    process.exit(1);
  }

  const size = statSync(zipPath).size;
  console.log(`📦 Built ${zipName} (${(size / 1024).toFixed(1)} KB)`);
  return zipPath;
}

// ── Step 2: Upload package ────────────────────────────────────────────
async function uploadPackage(zipPath: string): Promise<string> {
  const zipData = readFileSync(zipPath);
  const url = `${API_BASE}/v1/products/${PRODUCT_ID}/submissions/draft/package`;

  console.log(`⬆️  Uploading to Edge Add-ons API...`);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/zip",
    },
    body: zipData,
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`Upload failed (${resp.status}): ${body}`);
    process.exit(1);
  }

  // Operation ID from Location header
  const location = resp.headers.get("Location");
  if (!location) {
    console.error("No Location header in upload response");
    process.exit(1);
  }

  const operationId = location.split("/").pop()!;
  console.log(`   Upload started, operation: ${operationId}`);
  return operationId;
}

// ── Step 3: Poll operation status ─────────────────────────────────────
async function pollOperation(
  path: string,
  label: string,
  maxRetries = 30,
  intervalMs = 5000
): Promise<void> {
  const url = `${API_BASE}${path}`;

  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const resp = await fetch(url, { headers: authHeaders() });
    if (!resp.ok) {
      console.error(`${label} poll failed (${resp.status}): ${await resp.text()}`);
      process.exit(1);
    }

    const data = await resp.json() as { status: string; message?: string; errorCode?: string };
    const status = data.status;

    if (status === "Succeeded") {
      console.log(`   ${label} succeeded`);
      return;
    }
    if (status === "Failed") {
      console.error(`   ${label} failed: ${data.message || data.errorCode || JSON.stringify(data)}`);
      process.exit(1);
    }

    // InProgress or other transient state
    process.stdout.write(`   ${label} ${status}... (${i + 1}/${maxRetries})\r`);
  }

  console.error(`\n   ${label} timed out after ${maxRetries} attempts`);
  process.exit(1);
}

// ── Step 4: Publish draft ─────────────────────────────────────────────
async function publishDraft(): Promise<string> {
  const url = `${API_BASE}/v1/products/${PRODUCT_ID}/submissions`;

  console.log(`🚀 Publishing v${VERSION} to Edge Add-ons...`);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      notes: `v${VERSION} update`,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`Publish failed (${resp.status}): ${body}`);
    process.exit(1);
  }

  const location = resp.headers.get("Location");
  if (!location) {
    console.error("No Location header in publish response");
    process.exit(1);
  }

  const operationId = location.split("/").pop()!;
  console.log(`   Publish started, operation: ${operationId}`);
  return operationId;
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Edge Add-ons Publish — v${VERSION} ===\n`);

  // Build zip
  const zipPath = buildZip();

  if (DRY_RUN) {
    console.log(`\n--dry-run: zip built at ${zipPath}, skipping upload/publish`);
    return;
  }

  // Upload
  const uploadOpId = await uploadPackage(zipPath);
  await pollOperation(
    `/v1/products/${PRODUCT_ID}/submissions/draft/package/operations/${uploadOpId}`,
    "Upload"
  );

  // Publish
  const publishOpId = await publishDraft();
  await pollOperation(
    `/v1/products/${PRODUCT_ID}/submissions/operations/${publishOpId}`,
    "Publish"
  );

  console.log(`\n✅ v${VERSION} submitted to Edge Add-ons store`);
  console.log(`   Review typically takes 5-7 business days\n`);
}

main().catch((err) => {
  console.error("Publish failed:", err);
  process.exit(1);
});
