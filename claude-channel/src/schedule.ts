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
