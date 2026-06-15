import { makeCtx } from "./ctx";
import { detectPlatform } from "./platform/factory";
import { NotImplementedError } from "./platform/platform";
import { update, promote, rollback, status, list, prune } from "./channel";
import { launcherPath } from "./launcher";
import type { Channel } from "./types";

export interface ParsedArgs {
  command: string;
  channel: Channel;
  /** Only present when --pin flag was provided */
  pin?: string;
  /** Only present when --to flag was provided */
  to?: string;
  /** Only present when --keep flag was provided */
  keep?: number;
  /** Only present when --every flag was provided */
  everyHours?: number;
  json: boolean;
  yes: boolean;
}

const COMMANDS = new Set([
  "update", "promote", "rollback", "status", "list", "prune", "schedule", "unschedule", "alias", "help",
]);

/**
 * Parse CLI argv array into a structured ParsedArgs object.
 * Only includes optional keys (keep/everyHours/pin/to) when their flags are actually provided,
 * so that the returned object is exactly { command, channel, json, yes } for bare commands.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (!command || !COMMANDS.has(command)) throw new Error(`unknown command: ${command ?? "(none)"}`);

  // Only always-present fields — optional keys are added only when flags are present
  const out: ParsedArgs = { command, channel: "latest", json: false, yes: false };

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const next = (): string => {
      const v = rest[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case "--channel": {
        const c = next();
        if (c !== "stable" && c !== "latest") throw new Error("--channel must be stable|latest");
        out.channel = c;
        break;
      }
      case "--pin":
        out.pin = next();
        break;
      case "--to":
        out.to = next();
        break;
      case "--keep":
        out.keep = parseInt(next(), 10);
        break;
      case "--every":
        out.everyHours = parseInt(next(), 10);
        break;
      case "--json":
        out.json = true;
        break;
      case "--yes":
      case "-y":
        out.yes = true;
        break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

const HELP = `ccx — Claude Code channel manager (Termux)

  ccx update [--channel latest|stable] [--pin X.Y.Z]   fetch+patch latest into claude-next
  ccx promote                                          snapshot next -> claude (archives prev)
  ccx rollback [--to X.Y.Z]                            restore an archived stable
  ccx status [--json]                                  show channels + update availability
  ccx list                                             installed versions + archive
  ccx prune [--keep N]                                 free disk (default keep 2)
  ccx schedule [--every H] | ccx unschedule            opt-in auto-update (crontab)
  ccx alias                                            print shell alias + PATH hint
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv.length ? argv : ["help"]);
  } catch (e) {
    console.error(String((e as Error).message));
    console.error(HELP);
    return 2;
  }

  if (args.command === "help") {
    console.log(HELP);
    return 0;
  }

  const ctx = makeCtx();

  if (args.command === "alias") {
    console.log(`alias cnup='ccx update'`);
    console.log(`# ensure ~/.local/bin precedes ~/.bun/bin on PATH:`);
    console.log(`export PATH="$HOME/.local/bin:$PATH"`);
    return 0;
  }

  let platform;
  try {
    platform = detectPlatform(ctx);
  } catch (e) {
    console.error((e as NotImplementedError).message);
    return 1;
  }

  try {
    switch (args.command) {
      case "update": {
        const r = await update(platform, ctx, args.channel, args.pin);
        console.log(
          r.action === "current"
            ? `claude-next already at ${r.to}`
            : `claude-next: ${r.from ?? "(none)"} -> ${r.to}`,
        );
        return 0;
      }
      case "promote": {
        const r = promote(platform, ctx);
        console.log(
          r.action === "noop"
            ? `claude already at ${r.to}`
            : `promoted claude: ${r.from ?? "(none)"} -> ${r.to} (archived ${r.from ?? "nothing"})`,
        );
        return 0;
      }
      case "rollback": {
        const r = await rollback(platform, ctx, args.to);
        console.log(`claude rolled back to ${r.to}${r.refetched ? " (re-fetched)" : ""}`);
        return 0;
      }
      case "status": {
        const s = await status(platform, ctx);
        if (args.json) {
          console.log(JSON.stringify(s, null, 2));
          return 0;
        }
        console.log(`next:    ${s.next?.version ?? "(none)"}`);
        console.log(`stable:  ${s.stable?.version ?? "(none)"}   (${launcherPath(ctx, "stable")})`);
        console.log(`channel: latest=${s.channelLatest ?? "?"} stable=${s.channelStable ?? "?"}`);
        console.log(`update:  ${s.updateAvailable ? "AVAILABLE (run ccx update)" : "up to date"}`);
        if (!s.pathOk) console.log(`WARNING: ~/.local/bin is not ahead of ~/.bun/bin on PATH (run ccx alias)`);
        if (!s.nextHasAutoupdaterOff) console.log(`WARNING: claude-next launcher missing DISABLE_AUTOUPDATER=1`);
        return 0;
      }
      case "list": {
        const r = list(ctx);
        console.log(`installed: ${r.installed.join(", ") || "(none)"}`);
        console.log(`archive:   ${r.archive.map((a) => a.version).join(", ") || "(none)"}`);
        return 0;
      }
      case "prune": {
        // Default keep=2 applied at use site since keep is optional in ParsedArgs
        const r = prune(ctx, args.keep ?? 2);
        console.log(`pruned ${r.removed.length} version(s); kept ${r.kept.length}`);
        return 0;
      }
      case "schedule": {
        // Default everyHours=24 applied at use site since everyHours is optional in ParsedArgs
        platform.scheduleInstall(args.everyHours ?? 24);
        console.log(`scheduled: ccx update every ~${args.everyHours ?? 24}h`);
        return 0;
      }
      case "unschedule": {
        platform.scheduleRemove();
        console.log(`unscheduled ccx auto-update`);
        return 0;
      }
      default:
        console.error(HELP);
        return 2;
    }
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 1;
  }
}

// Entrypoint guard — works for both CJS bundle and direct run
if (typeof require !== "undefined" && require.main === module) {
  main().then((code) => process.exit(code));
}
