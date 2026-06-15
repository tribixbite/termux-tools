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
      if (!file.write(chunk)) await new Promise<void>((r) => file.once("drain", () => r()));
    }
  } finally {
    await new Promise<void>((r) => file.end(() => r()));
  }
  const actual = hash.digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(`sha256 mismatch for ${version}/${platformTag}: expected ${expectedSha256}, got ${actual}`);
  }
}
