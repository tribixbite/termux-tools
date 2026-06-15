export type Channel = "stable" | "latest";
export type ChannelKind = "next" | "stable";
export type PlatformId = "termux" | "linux" | "darwin";

export interface Pin {
  version: string;
  binary: string;   // absolute path to the claude-binary file
  patched: boolean;
}
export interface NextPin extends Pin { updatedAt: string; }
export interface StablePin extends Pin { promotedAt: string; }

export interface ArchiveEntry {
  version: string;
  binary: string;
  promotedAt: string;
  archivedAt: string;
}

export interface ChannelState {
  schema: 1;
  next: NextPin | null;
  stable: StablePin | null;
  archive: ArchiveEntry[];
}

export interface PlatformBinaryInfo {
  binary: string;
  checksum: string;   // sha256 hex
  size: number;
}
export interface Manifest {
  version: string;
  commit: string;
  buildDate: string;
  platforms: Record<string, PlatformBinaryInfo>;
}
