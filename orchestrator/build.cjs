#!/usr/bin/env node
/**
 * Build script — bundles orchestrator into a single dist/tmx.js
 * using esbuild. Output is a self-contained Node.js CLI.
 */
const { build } = require("esbuild");
const { resolve } = require("path");

build({
  entryPoints: [resolve(__dirname, "src/tmx.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  outfile: resolve(__dirname, "dist/tmx.js"),
  format: "cjs",
  banner: { js: "#!/usr/bin/env node" },
  external: [],
  // Replace import.meta references with CJS equivalents
  define: {
    "import.meta.url": "import_meta_url",
  },
  inject: [resolve(__dirname, "src/import-meta-shim.js")],
  minify: false,
  sourcemap: false,
}).then(() => {
  console.log("Built dist/tmx.js");
}).catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
