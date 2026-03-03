// CJS shim for import.meta.url — injected by esbuild
const import_meta_url = require("url").pathToFileURL(__filename).href;
module.exports = { import_meta_url };
