/**
 * Shim for import.meta.url / import.meta.dir in CJS context (esbuild).
 *
 * esbuild replaces import.meta.url → import_meta_url and import.meta.dir → import_meta_dir
 * via the `define` config. This file is injected via esbuild's `inject` to provide those globals.
 *
 * esbuild inject requires named exports — it rewrites references to these names
 * as imports from this shim module.
 */
export const import_meta_url = typeof __filename !== "undefined"
  ? require("url").pathToFileURL(__filename).href
  : "";
export const import_meta_dir = typeof __dirname !== "undefined"
  ? __dirname
  : "";
