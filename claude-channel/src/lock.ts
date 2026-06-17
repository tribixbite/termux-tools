import { openSync, writeSync, closeSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "./ctx";

const STALE_MS = 60 * 60 * 1000; // an hour — older than any real ccx operation

function lockPath(ctx: Ctx): string {
  return path.join(ctx.binariesDir, ".ccx.lock");
}

/** A lock is stale if its holder PID is dead, it's older than STALE_MS, or it's unparseable. */
function isStale(lock: string): boolean {
  try {
    const { pid, at } = JSON.parse(readFileSync(lock, "utf8")) as { pid?: number; at?: number };
    if (typeof pid === "number") {
      try { process.kill(pid, 0); } catch { return true; } // signal 0 just probes existence
    }
    if (typeof at === "number" && Date.now() - at > STALE_MS) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Run `fn` while holding an exclusive lock on the binaries dir, so a scheduled
 * `ccx update` and a manual run can't mutate state/launchers concurrently. A lock
 * left by a dead/stale process is reclaimed; a live one causes a clear error.
 */
export async function withLock<T>(ctx: Ctx, fn: () => Promise<T> | T): Promise<T> {
  mkdirSync(ctx.binariesDir, { recursive: true });
  const lock = lockPath(ctx);
  let fd: number;
  try {
    fd = openSync(lock, "wx"); // exclusive create — fails if the file exists
  } catch {
    if (existsSync(lock) && isStale(lock)) {
      rmSync(lock, { force: true });
      fd = openSync(lock, "wx");
    } else {
      throw new Error(`another ccx operation is in progress (lock: ${lock}) — remove it if you're sure it's stale`);
    }
  }
  writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
  closeSync(fd);
  try {
    return await fn();
  } finally {
    rmSync(lock, { force: true });
  }
}
