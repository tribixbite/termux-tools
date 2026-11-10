#!/usr/bin/env node
// `termux-tools <command> [args...]` — dispatcher so the package can be run as
// `npx termux-tools phone-share start` / `bunx termux-tools ccx ...` without
// `-p`. npx/bunx pick the bin named after the package; this forwards to the
// sibling bin declared in package.json.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(realpathSync(fileURLToPath(import.meta.url))), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const bins = Object.fromEntries(Object.entries(pkg.bin).filter(([name]) => name !== pkg.name));
const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === "-h" || cmd === "--help" || !bins[cmd]) {
  if (cmd && !["-h", "--help"].includes(cmd)) console.error(`unknown command: ${cmd}\n`);
  console.log(`termux-tools ${pkg.version}\nusage: termux-tools <command> [args...]\n\ncommands:`);
  for (const name of Object.keys(bins)) console.log(`  ${name}`);
  process.exit(cmd && !["-h", "--help"].includes(cmd) ? 2 : 0);
}

const target = path.join(root, bins[cmd]);
// .js bins run under the current runtime (node or bun); others via their shebang.
const r = target.endsWith(".js")
  ? spawnSync(process.execPath, [target, ...args], { stdio: "inherit" })
  : spawnSync(target, args, { stdio: "inherit" });
if (r.error) {
  console.error(`termux-tools: failed to run ${cmd}: ${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
