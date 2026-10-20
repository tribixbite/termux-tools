// Bundle each manager CLI to a single node-targeted dist/*.js with an executable
// shebang, and stage the self-contained Termux shell tools from ../scripts into
// bin/ so one npm package ("termux-tools") carries all of them.
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const CLIS = ["dist/cli.js", "dist/codex-cli.js", "dist/antigravity-cli.js"] as const;
/** published bin name -> source script in the repo's scripts/ directory */
const SHELL_TOOLS: Record<string, string> = {
  "pip-tool-install": "pip-tool-install.sh",
  "install-ghostty-termux": "install-ghostty-termux.sh",
  "install-antigravity-termux": "install-antigravity-termux.sh",
  "migrate-termux": "migrate-termux.sh",
  "threads-dl": "threads-dl.mjs",
};

const out = await Bun.build({
  entrypoints: ["src/cli.ts", "src/codex-cli.ts", "src/antigravity-cli.ts"],
  outdir: "dist",
  target: "node",
  format: "cjs",
  minify: false,
});
if (!out.success) {
  for (const log of out.logs) console.error(log);
  process.exit(1);
}
for (const cliPath of CLIS) {
  const body = readFileSync(cliPath, "utf8");
  if (!body.startsWith("#!")) writeFileSync(cliPath, `#!/usr/bin/env node\n${body}`);
  chmodSync(cliPath, 0o755);
  console.log(`built ${cliPath}`);
}

copyFileSync(path.join("..", "LICENSE"), "LICENSE");
mkdirSync("bin", { recursive: true });
for (const [name, source] of Object.entries(SHELL_TOOLS)) {
  const dest = path.join("bin", name);
  copyFileSync(path.join("..", "scripts", source), dest);
  chmodSync(dest, 0o755);
  console.log(`staged bin/${name} <- scripts/${source}`);
}
