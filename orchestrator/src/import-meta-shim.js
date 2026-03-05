// CJS shim for import.meta.url — injected by esbuild
// Must use ESM export syntax so esbuild hoists the variable to top scope
// (module.exports causes __commonJS wrapping which scopes the variable)
// Use fs.realpathSync to resolve symlinks (e.g. ~/.local/bin/tmx → orchestrator/dist/tmx.js)
export const import_meta_url = typeof __filename !== "undefined"
  ? require("url").pathToFileURL(require("fs").realpathSync(__filename)).href
  : undefined;
