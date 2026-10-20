/**
 * Helpers shared by the channel managers that keep immutable per-version
 * release directories under a private root (cdx for Codex, agx for Antigravity).
 * Everything here is filesystem/process plumbing with no tool-specific policy.
 */
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

/** Semver-shaped versions only: this doubles as a path-component allowlist. */
export const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

/** Reject paths and malformed versions before constructing install paths. */
export function validateVersion(version: string): string {
  if (!VERSION_PATTERN.test(version)) throw new Error(`Invalid version: ${version}`);
  return version;
}

/** Replace a file by rename, never by truncating an inode used by a running process. */
export function atomicWrite(file: string, contents: string, mode = 0o600): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const dir = mkdtempSync(path.join(path.dirname(file), ".write-"));
  try { const tmp = path.join(dir, "file"); writeFileSync(tmp, contents, { mode }); renameSync(tmp, file); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Serialize mutations with an atomic directory lock; never steal a live or ambiguous lock. */
export async function withDirLock<T>(root: string, label: string, action: () => Promise<T>): Promise<T> {
  mkdirSync(root, { recursive: true });
  const lock = path.join(root, ".lock");
  try { mkdirSync(lock); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    throw new Error(`Another ${label} mutation holds ${lock}. Check its owner.json before removing a stale lock.`);
  }
  try { writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, started: new Date().toISOString() })); return await action(); }
  finally { rmSync(lock, { recursive: true, force: true }); }
}

/** Run a command to completion and return trimmed stdout; non-zero exit is an error. */
export function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync(command, args, { encoding: "utf8", env, timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal}): ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

export function shellQuote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }

/** Replace (or remove, when `entry` is null) the single crontab line carrying `marker`, preserving everything else. */
export function replaceCronEntry(marker: string, entry: string | null): void {
  const previous = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  if (previous.error) throw previous.error;
  if (previous.status !== 0 && !/no crontab for/i.test(previous.stderr)) throw new Error(`Cannot read crontab: ${previous.stderr}`);
  const lines = previous.stdout.split("\n").filter(line => !line.endsWith(marker));
  while (lines.at(-1) === "") lines.pop();
  if (entry) lines.push(entry);
  const result = spawnSync("crontab", ["-"], { encoding: "utf8", input: lines.length ? lines.join("\n") + "\n" : "" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Cannot write crontab: ${result.stderr}`);
}

/** Stream a download to `dest`, hashing as it goes; a digest mismatch deletes the file and throws. */
export async function downloadVerified(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, url: string, dest: string,
  algorithm: "sha256" | "sha512", expectedHex: string,
): Promise<void> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok || !response.body) throw new Error(`download ${url}: HTTP ${response.status}`);
  const hash = createHash(algorithm);
  const file = createWriteStream(dest, { mode: 0o600 });
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      hash.update(chunk);
      if (!file.write(chunk)) await new Promise<void>(resolve => file.once("drain", () => resolve()));
    }
  } finally {
    await new Promise<void>(resolve => file.end(() => resolve()));
  }
  const actual = hash.digest("hex");
  if (actual !== expectedHex.toLowerCase()) {
    rmSync(dest, { force: true });
    throw new Error(`${algorithm} mismatch for ${url}: expected ${expectedHex}, got ${actual}`);
  }
}
