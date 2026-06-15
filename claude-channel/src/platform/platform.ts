import type { Channel, ChannelKind } from "../types";

export class NotImplementedError extends Error {
  constructor(message: string) { super(message); this.name = "NotImplementedError"; }
}

export interface Platform {
  readonly id: "termux" | "linux" | "darwin";
  readonly platformTag: string;                      // e.g. "linux-arm64"
  resolveLatest(channel: Channel): Promise<string>;
  binaryDir(version: string): string;
  binaryPath(version: string): string;
  isInstalled(version: string): boolean;
  fetchBinary(version: string): Promise<string>;     // download + verify + patch -> binary path
  writeLauncher(kind: ChannelKind, binaryPath: string): void;
  readLauncherBinary(kind: ChannelKind): string | null;
  verify(kind: ChannelKind): Promise<string>;        // run the launcher --version
  pathPrecedenceOk(): boolean;
  scheduleInstall(everyHours: number): void;
  scheduleRemove(): void;
}
