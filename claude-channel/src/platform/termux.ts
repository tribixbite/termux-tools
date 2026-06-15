import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Ctx } from "../ctx";
import type { Channel, ChannelKind } from "../types";
import type { Platform } from "./platform";
import { resolveChannelVersion, fetchManifest, downloadBinary } from "../registry";
import { patchFile, keepFromEnv } from "../patch";
import { writeLauncher, readLauncherBinary, launcherPath } from "../launcher";
import { installCron, removeCron } from "../schedule";

export class TermuxPlatform implements Platform {
  readonly id = "termux" as const;
  readonly platformTag = "linux-arm64";
  constructor(private ctx: Ctx) {}

  resolveLatest(channel: Channel): Promise<string> { return resolveChannelVersion(this.ctx, channel); }
  binaryDir(v: string): string { return path.join(this.ctx.binariesDir, `claude-${v}`); }
  binaryPath(v: string): string { return path.join(this.binaryDir(v), "claude-binary"); }
  isInstalled(v: string): boolean { return existsSync(this.binaryPath(v)); }

  async fetchBinary(version: string): Promise<string> {
    const manifest = await fetchManifest(this.ctx, version);
    const info = manifest.platforms[this.platformTag];
    if (!info) throw new Error(`platform ${this.platformTag} not in manifest for ${version}`);
    mkdirSync(this.binaryDir(version), { recursive: true });
    const dest = this.binaryPath(version);
    await downloadBinary(this.ctx, version, this.platformTag, dest, info.checksum);
    chmodSync(dest, 0o755);
    patchFile(dest, keepFromEnv());
    return dest;
  }

  writeLauncher(kind: ChannelKind, binaryPath: string): void { writeLauncher(this.ctx, kind, binaryPath); }
  readLauncherBinary(kind: ChannelKind): string | null { return readLauncherBinary(this.ctx, kind); }

  async verify(kind: ChannelKind): Promise<string> {
    const out = execFileSync(launcherPath(this.ctx, kind), ["--version"], { encoding: "utf8", timeout: 90_000 });
    return out.trim().split("\n")[0];
  }

  pathPrecedenceOk(): boolean {
    const parts = (process.env.PATH ?? "").split(":");
    const a = parts.indexOf(this.ctx.localBin);
    const b = parts.indexOf(path.join(this.ctx.home, ".bun", "bin"));
    if (a < 0) return false;
    return b < 0 || a < b;
  }

  scheduleInstall(everyHours: number): void { installCron(this.ctx, everyHours); }
  scheduleRemove(): void { removeCron(this.ctx); }
}
