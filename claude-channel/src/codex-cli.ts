import { existsSync, readFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { atomicWrite, codexBinary, codexContext, codexLock, installedCodex, pruneCodex, readCodexState, resolveCodex, scheduleCodex, switchCodex, updateCodex, type CodexContext } from "./codex";
import { shellQuote as quote } from "./managed";
import { parseManagerArgs, type ManagerArgs } from "./manager-args";

const HELP = `cdx — Codex channel manager for ARM64 Termux
  cdx update [--pin VERSION]       stage, patch and verify codex-next
  cdx promote                     make next the stable codex
  cdx rollback [--to VERSION]      switch to an archived stable version
  cdx status [--json]              installed channels and upstream latest
  cdx list                        installed and archived versions
  cdx prune [--keep N] [--yes]      preview deletion; --yes applies (default keep 2)
  cdx setup                       install codex and codex-next launchers
  cdx schedule [--every HOURS]     opt-in next-only cron update (default daily)
  cdx unschedule                  remove only the cdx cron entry
  cdx alias                       print cdup alias and PATH setup
  cdx help
Updates use isolated Bun installs; no PRoot or changes to login/configuration.
`;
/** Install dispatchers once; future channel changes are a single atomic state update. */
export function setupCodex(ctx: CodexContext, cli: string): void {
  for (const name of ["cdx", "codex", "codex-next"]) {
    const file = path.join(ctx.localBin, name);
    if (existsSync(file) && (lstatSync(file).isSymbolicLink() || !readFileSync(file, "utf8").includes("# cdx managed launcher"))) throw new Error(`Refusing to overwrite unmanaged launcher ${file}`);
  }
  for (const [name, channel] of [["cdx", ""], ["codex", "stable"], ["codex-next", "next"]]) {
    atomicWrite(path.join(ctx.localBin, name), `#!${ctx.prefix}/bin/bash\n# cdx managed launcher\nexec ${quote(path.join(ctx.prefix, "bin/node"))} ${quote(cli)} ${channel ? `run ${channel} ` : ""}"$@"\n`, 0o755);
  }
}
/** cdx uses the shared manager vocabulary unchanged. */
export function parseCodexArgs(args: string[]): ManagerArgs { return parseManagerArgs(args); }
async function main(): Promise<void> {
  const ctx = codexContext();
  const args = process.argv.slice(2);
  if (args[0] === "run") {
    const channel = args[1]; if (channel !== "stable" && channel !== "next") throw new Error("Expected stable or next");
    const version = readCodexState(ctx)[channel]; if (!version) throw new Error(`No ${channel} installed; run cdx update${channel === "stable" ? " then cdx promote" : ""}`);
    if (args[2] === "update") throw new Error("Use cdx update to preserve Termux patches and channel pins");
    const binary = codexBinary(ctx, version);
    const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    env.PATH = `${path.join(path.dirname(path.dirname(binary)), "codex-path")}:${ctx.prefix}/bin:${env.PATH ?? ""}`;
    env.TMPDIR = env.TMP = env.TEMP = path.join(ctx.prefix, "tmp");
    const argv = [binary, "--disable", "daemon_auto_start", ...args.slice(2)];
    // execve preserves the terminal, signals and exit status without a supervisor.
    if (process.execve) process.execve(binary, argv, env);
    const result = spawnSync(binary, argv.slice(1), { env, stdio: "inherit" });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }
  const opts = parseCodexArgs(args[0] === "--help" ? ["help"] : args);
  if (opts.command === "help") { console.log(HELP); return; }
  if (opts.command === "alias") { console.log('export PATH="$HOME/.local/bin:$PATH"\nalias cdup="cdx update"'); return; }
  if (opts.command === "status") {
    const state = readCodexState(ctx);
    let latest: string | null = null, registryError: string | null = null;
    try { latest = await resolveCodex(ctx); } catch (e) { registryError = (e as Error).message; }
    const info = { ...state, latest, registryError, root: ctx.root, localBin: ctx.localBin };
    console.log(opts.json ? JSON.stringify(info, null, 2) : `stable: ${state.stable ?? "not installed"}\nnext: ${state.next ?? "not installed"}\nlatest: ${latest ?? registryError}\nlaunchers: ${ctx.localBin}`); return;
  }
  if (opts.command === "list") { console.log(JSON.stringify({ ...readCodexState(ctx), installed: installedCodex(ctx) }, null, 2)); return; }
  await codexLock(ctx, async () => {
    if (opts.command === "schedule" || opts.command === "unschedule") { scheduleCodex(ctx, path.resolve(process.argv[1]), opts.command === "schedule" ? opts.hours : undefined); console.log(opts.command === "schedule" ? "Scheduled next-only updates. Requires crond running; stable is never promoted automatically." : "Removed cdx schedule."); }
    if (opts.command === "setup") { setupCodex(ctx, path.resolve(process.argv[1])); console.log(`Installed launchers in ${ctx.localBin}; put that directory first on PATH.`); }
    if (opts.command === "update") console.log(JSON.stringify(await updateCodex(ctx, opts.value), null, 2));
    if (opts.command === "promote" || opts.command === "rollback") console.log(JSON.stringify(switchCodex(ctx, opts.command === "rollback", opts.value), null, 2));
    if (opts.command === "prune") console.log(JSON.stringify({ applied: opts.yes, removed: pruneCodex(ctx, opts.keep, opts.yes) }, null, 2));
  });
}
if (require.main === module) main().catch(error => { console.error(`cdx: ${(error as Error).message}`); process.exitCode = 1; });
