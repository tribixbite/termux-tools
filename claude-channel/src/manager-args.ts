import { validateVersion } from "./managed";

export interface ManagerArgs { command: string; value?: string; keep: number; hours: number; yes: boolean; json: boolean; }

/** The command/flag vocabulary shared by every release-channel manager (cdx, agx). */
export const MANAGER_COMMANDS: Record<string, string[]> = {
  help: [], update: ["--pin"], promote: [], rollback: ["--to"], status: ["--json"], list: [],
  prune: ["--keep", "--yes"], setup: [], schedule: ["--every"], unschedule: [], alias: [],
};

/** Parse command-specific options strictly so a typo cannot trigger a mutation. */
export function parseManagerArgs(args: string[], extraCommands: Record<string, string[]> = {}): ManagerArgs {
  const allowed = { ...MANAGER_COMMANDS, ...extraCommands };
  const command = args[0] ?? "help";
  if (!Object.hasOwn(allowed, command)) throw new Error(`Unknown command: ${command}`);
  const out: ManagerArgs = { command, value: undefined, keep: 2, hours: 24, yes: false, json: false };
  const seen = new Set<string>();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (!allowed[command].includes(flag) || seen.has(flag)) throw new Error(`Unexpected option: ${flag}`);
    seen.add(flag);
    if (flag === "--yes") out.yes = true;
    else if (flag === "--json") out.json = true;
    else {
      const value = args[++i]; if (!value) throw new Error(`${flag} needs a value`);
      if (flag === "--keep") { if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid --keep"); out.keep = Number(value); }
      else if (flag === "--every") { if (!/^(1|2|3|4|6|8|12|24)$/.test(value)) throw new Error("Invalid --every interval"); out.hours = Number(value); }
      else out.value = validateVersion(value);
    }
  }
  return out;
}
