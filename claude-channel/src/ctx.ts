import os from "node:os";
import path from "node:path";

export const RELEASE_BASE_URL = "https://downloads.claude.ai/claude-code-releases";

export interface Ctx {
  home: string;
  prefix: string;
  binariesDir: string;   // <home>/.claude/binaries
  localBin: string;      // <home>/.local/bin
  bunTermux: string;     // <home>/.bun/bin/bun-termux
  baseUrl: string;       // release-channel base URL
  fetchImpl: typeof fetch;
}

export function makeCtx(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<Ctx> = {},
): Ctx {
  const home = overrides.home ?? env.HOME ?? os.homedir();
  const prefix = overrides.prefix ?? env.PREFIX ?? "/data/data/com.termux/files/usr";
  const base: Ctx = {
    home,
    prefix,
    binariesDir: path.join(home, ".claude", "binaries"),
    localBin: path.join(home, ".local", "bin"),
    bunTermux: path.join(home, ".bun", "bin", "bun-termux"),
    baseUrl: env.CLAUDE_CHANNEL_BASE_URL ?? RELEASE_BASE_URL,
    fetchImpl: globalThis.fetch,
  };
  return { ...base, ...overrides };
}
