// CJS shim for import.meta.url — injected by esbuild
// Must use ESM export syntax so esbuild hoists the variable to top scope
// (module.exports causes __commonJS wrapping which scopes the variable)
export const import_meta_url = typeof __filename !== "undefined"
  ? require("url").pathToFileURL(__filename).href
  : undefined;
