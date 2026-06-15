// Bundle the CLI to a single node-targeted dist/cli.js with an executable shebang.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const out = await Bun.build({
  entrypoints: ["src/cli.ts"],
  outdir: "dist",
  target: "node",
  format: "cjs",
  minify: false,
});
if (!out.success) {
  for (const log of out.logs) console.error(log);
  process.exit(1);
}
const cliPath = "dist/cli.js";
const body = readFileSync(cliPath, "utf8");
if (!body.startsWith("#!")) writeFileSync(cliPath, `#!/usr/bin/env node\n${body}`);
chmodSync(cliPath, 0o755);
console.log("built dist/cli.js");
