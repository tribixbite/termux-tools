#!/usr/bin/env node
/**
 * Build script — bundles bridge + compat + ws into a single dist/cli.js
 * using esbuild. The output is a self-contained Node.js CLI.
 */
const { build } = require("esbuild");
const { resolve } = require("path");

build({
  entryPoints: [resolve(__dirname, "src/cli.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  outfile: resolve(__dirname, "dist/cli.js"),
  format: "cjs",
  // Banner adds shebang for npx
  banner: { js: "#!/usr/bin/env node" },
  // Bundle everything including ws — zero runtime deps
  external: [],
  // Replace import.meta references with CJS equivalents
  define: {
    "import.meta.url": "import_meta_url",
    "import.meta.dir": "import_meta_dir",
  },
  // Inject shims for import.meta in CJS context
  inject: [resolve(__dirname, "src/import-meta-shim.js")],
  minify: false, // keep readable for debugging
  sourcemap: false,
}).then(() => {
  console.log("Built dist/cli.js");
}).catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
