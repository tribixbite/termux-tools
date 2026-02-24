#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/import-meta-shim.js
var import_meta_url;
var init_import_meta_shim = __esm({
  "src/import-meta-shim.js"() {
    import_meta_url = typeof __filename !== "undefined" ? require("url").pathToFileURL(__filename).href : "";
  }
});

// ../../../node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "../../../node_modules/ws/lib/constants.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module2.exports = {
      BINARY_TYPES,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: /* @__PURE__ */ Symbol("kIsForOnEventAttribute"),
      kListener: /* @__PURE__ */ Symbol("kListener"),
      kStatusCode: /* @__PURE__ */ Symbol("status-code"),
      kWebSocket: /* @__PURE__ */ Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// ../../../node_modules/node-gyp-build/node-gyp-build.js
var require_node_gyp_build = __commonJS({
  "../../../node_modules/node-gyp-build/node-gyp-build.js"(exports2, module2) {
    init_import_meta_shim();
    var fs = require("fs");
    var path = require("path");
    var os = require("os");
    var runtimeRequire = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
    var vars = process.config && process.config.variables || {};
    var prebuildsOnly = !!process.env.PREBUILDS_ONLY;
    var abi = process.versions.modules;
    var runtime = isElectron() ? "electron" : isNwjs() ? "node-webkit" : "node";
    var arch = process.env.npm_config_arch || os.arch();
    var platform = process.env.npm_config_platform || os.platform();
    var libc = process.env.LIBC || (isAlpine(platform) ? "musl" : "glibc");
    var armv = process.env.ARM_VERSION || (arch === "arm64" ? "8" : vars.arm_version) || "";
    var uv = (process.versions.uv || "").split(".")[0];
    module2.exports = load;
    function load(dir) {
      return runtimeRequire(load.resolve(dir));
    }
    load.resolve = load.path = function(dir) {
      dir = path.resolve(dir || ".");
      try {
        var name = runtimeRequire(path.join(dir, "package.json")).name.toUpperCase().replace(/-/g, "_");
        if (process.env[name + "_PREBUILD"]) dir = process.env[name + "_PREBUILD"];
      } catch (err) {
      }
      if (!prebuildsOnly) {
        var release = getFirst(path.join(dir, "build/Release"), matchBuild);
        if (release) return release;
        var debug = getFirst(path.join(dir, "build/Debug"), matchBuild);
        if (debug) return debug;
      }
      var prebuild = resolve3(dir);
      if (prebuild) return prebuild;
      var nearby = resolve3(path.dirname(process.execPath));
      if (nearby) return nearby;
      var target = [
        "platform=" + platform,
        "arch=" + arch,
        "runtime=" + runtime,
        "abi=" + abi,
        "uv=" + uv,
        armv ? "armv=" + armv : "",
        "libc=" + libc,
        "node=" + process.versions.node,
        process.versions.electron ? "electron=" + process.versions.electron : "",
        typeof __webpack_require__ === "function" ? "webpack=true" : ""
        // eslint-disable-line
      ].filter(Boolean).join(" ");
      throw new Error("No native build was found for " + target + "\n    loaded from: " + dir + "\n");
      function resolve3(dir2) {
        var tuples = readdirSync(path.join(dir2, "prebuilds")).map(parseTuple);
        var tuple = tuples.filter(matchTuple(platform, arch)).sort(compareTuples)[0];
        if (!tuple) return;
        var prebuilds = path.join(dir2, "prebuilds", tuple.name);
        var parsed = readdirSync(prebuilds).map(parseTags);
        var candidates = parsed.filter(matchTags(runtime, abi));
        var winner = candidates.sort(compareTags(runtime))[0];
        if (winner) return path.join(prebuilds, winner.file);
      }
    };
    function readdirSync(dir) {
      try {
        return fs.readdirSync(dir);
      } catch (err) {
        return [];
      }
    }
    function getFirst(dir, filter) {
      var files = readdirSync(dir).filter(filter);
      return files[0] && path.join(dir, files[0]);
    }
    function matchBuild(name) {
      return /\.node$/.test(name);
    }
    function parseTuple(name) {
      var arr = name.split("-");
      if (arr.length !== 2) return;
      var platform2 = arr[0];
      var architectures = arr[1].split("+");
      if (!platform2) return;
      if (!architectures.length) return;
      if (!architectures.every(Boolean)) return;
      return { name, platform: platform2, architectures };
    }
    function matchTuple(platform2, arch2) {
      return function(tuple) {
        if (tuple == null) return false;
        if (tuple.platform !== platform2) return false;
        return tuple.architectures.includes(arch2);
      };
    }
    function compareTuples(a, b) {
      return a.architectures.length - b.architectures.length;
    }
    function parseTags(file) {
      var arr = file.split(".");
      var extension = arr.pop();
      var tags = { file, specificity: 0 };
      if (extension !== "node") return;
      for (var i = 0; i < arr.length; i++) {
        var tag = arr[i];
        if (tag === "node" || tag === "electron" || tag === "node-webkit") {
          tags.runtime = tag;
        } else if (tag === "napi") {
          tags.napi = true;
        } else if (tag.slice(0, 3) === "abi") {
          tags.abi = tag.slice(3);
        } else if (tag.slice(0, 2) === "uv") {
          tags.uv = tag.slice(2);
        } else if (tag.slice(0, 4) === "armv") {
          tags.armv = tag.slice(4);
        } else if (tag === "glibc" || tag === "musl") {
          tags.libc = tag;
        } else {
          continue;
        }
        tags.specificity++;
      }
      return tags;
    }
    function matchTags(runtime2, abi2) {
      return function(tags) {
        if (tags == null) return false;
        if (tags.runtime && tags.runtime !== runtime2 && !runtimeAgnostic(tags)) return false;
        if (tags.abi && tags.abi !== abi2 && !tags.napi) return false;
        if (tags.uv && tags.uv !== uv) return false;
        if (tags.armv && tags.armv !== armv) return false;
        if (tags.libc && tags.libc !== libc) return false;
        return true;
      };
    }
    function runtimeAgnostic(tags) {
      return tags.runtime === "node" && tags.napi;
    }
    function compareTags(runtime2) {
      return function(a, b) {
        if (a.runtime !== b.runtime) {
          return a.runtime === runtime2 ? -1 : 1;
        } else if (a.abi !== b.abi) {
          return a.abi ? -1 : 1;
        } else if (a.specificity !== b.specificity) {
          return a.specificity > b.specificity ? -1 : 1;
        } else {
          return 0;
        }
      };
    }
    function isNwjs() {
      return !!(process.versions && process.versions.nw);
    }
    function isElectron() {
      if (process.versions && process.versions.electron) return true;
      if (process.env.ELECTRON_RUN_AS_NODE) return true;
      return typeof window !== "undefined" && window.process && window.process.type === "renderer";
    }
    function isAlpine(platform2) {
      return platform2 === "linux" && fs.existsSync("/etc/alpine-release");
    }
    load.parseTags = parseTags;
    load.matchTags = matchTags;
    load.compareTags = compareTags;
    load.parseTuple = parseTuple;
    load.matchTuple = matchTuple;
    load.compareTuples = compareTuples;
  }
});

// ../../../node_modules/node-gyp-build/index.js
var require_node_gyp_build2 = __commonJS({
  "../../../node_modules/node-gyp-build/index.js"(exports2, module2) {
    init_import_meta_shim();
    var runtimeRequire = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
    if (typeof runtimeRequire.addon === "function") {
      module2.exports = runtimeRequire.addon.bind(runtimeRequire);
    } else {
      module2.exports = require_node_gyp_build();
    }
  }
});

// ../../../node_modules/bufferutil/fallback.js
var require_fallback = __commonJS({
  "../../../node_modules/bufferutil/fallback.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    var mask = (source, mask2, output, offset, length) => {
      for (var i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask2[i & 3];
      }
    };
    var unmask = (buffer, mask2) => {
      const length = buffer.length;
      for (var i = 0; i < length; i++) {
        buffer[i] ^= mask2[i & 3];
      }
    };
    module2.exports = { mask, unmask };
  }
});

// ../../../node_modules/bufferutil/index.js
var require_bufferutil = __commonJS({
  "../../../node_modules/bufferutil/index.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    try {
      module2.exports = require_node_gyp_build2()(__dirname);
    } catch (e) {
      module2.exports = require_fallback();
    }
  }
});

// ../../../node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "../../../node_modules/ws/lib/buffer-util.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0) return EMPTY_BUFFER;
      if (list.length === 1) return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module2.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = require_bufferutil();
        module2.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module2.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32) _unmask(buffer, mask);
          else bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// ../../../node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "../../../node_modules/ws/lib/limiter.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    var kDone = /* @__PURE__ */ Symbol("kDone");
    var kRun = /* @__PURE__ */ Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module2.exports = Limiter;
  }
});

// ../../../node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "../../../node_modules/ws/lib/permessage-deflate.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    var zlib = require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = /* @__PURE__ */ Symbol("permessage-deflate");
    var kTotalLength = /* @__PURE__ */ Symbol("total-length");
    var kCallback = /* @__PURE__ */ Symbol("callback");
    var kBuffers = /* @__PURE__ */ Symbol("buffers");
    var kError = /* @__PURE__ */ Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       * @param {Boolean} [isServer=false] Create the instance in either server or
       *     client mode
       * @param {Number} [maxPayload=0] The maximum allowed message length
       */
      constructor(options, isServer, maxPayload) {
        this._maxPayload = maxPayload | 0;
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._isServer = !!isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num = +value;
                if (!Number.isInteger(num) || num < 8 || num > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module2.exports = PerMessageDeflate;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// ../../../node_modules/utf-8-validate/fallback.js
var require_fallback2 = __commonJS({
  "../../../node_modules/utf-8-validate/fallback.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    function isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    module2.exports = isValidUTF8;
  }
});

// ../../../node_modules/utf-8-validate/index.js
var require_utf_8_validate = __commonJS({
  "../../../node_modules/utf-8-validate/index.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    try {
      module2.exports = require_node_gyp_build2()(__dirname);
    } catch (e) {
      module2.exports = require_fallback2();
    }
  }
});

// ../../../node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "../../../node_modules/ws/lib/validation.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    var { isUtf8 } = require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module2.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module2.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = require_utf_8_validate();
        module2.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// ../../../node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "../../../node_modules/ws/lib/receiver.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    var { Writable } = require("stream");
    var PerMessageDeflate = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err) return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module2.exports = Receiver2;
  }
});

// ../../../node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "../../../node_modules/ws/lib/sender.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    var { Duplex } = require("stream");
    var { randomFillSync } = require("crypto");
    var PerMessageDeflate = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = /* @__PURE__ */ Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else {
            buf.set(data, 2);
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module2.exports = Sender2;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// ../../../node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "../../../node_modules/ws/lib/event-target.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = /* @__PURE__ */ Symbol("kCode");
    var kData = /* @__PURE__ */ Symbol("kData");
    var kError = /* @__PURE__ */ Symbol("kError");
    var kMessage = /* @__PURE__ */ Symbol("kMessage");
    var kReason = /* @__PURE__ */ Symbol("kReason");
    var kTarget = /* @__PURE__ */ Symbol("kTarget");
    var kType = /* @__PURE__ */ Symbol("kType");
    var kWasClean = /* @__PURE__ */ Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module2.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// ../../../node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "../../../node_modules/ws/lib/extension.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension) => {
        let configurations = extensions[extension];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module2.exports = { format, parse };
  }
});

// ../../../node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "../../../node_modules/ws/lib/websocket.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    var EventEmitter = require("events");
    var https = require("https");
    var http2 = require("http");
    var net = require("net");
    var tls = require("tls");
    var { randomBytes, createHash } = require("crypto");
    var { Duplex, Readable: Readable2 } = require("stream");
    var { URL: URL2 } = require("url");
    var PerMessageDeflate = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse } = require_extension();
    var { toBuffer } = require_buffer_util();
    var closeTimeout = 30 * 1e3;
    var kAborted = /* @__PURE__ */ Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket3 = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            protocols = [];
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              protocols = [];
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate.extensionName]) {
          this._extensions[PerMessageDeflate.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._readyState = _WebSocket.CLOSING;
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket3, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket3.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket3, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket3.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket3, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket3.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket3, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket3.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket3.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket3.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket3.prototype.addEventListener = addEventListener;
    WebSocket3.prototype.removeEventListener = removeEventListener;
    module2.exports = WebSocket3;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        protocolVersion: protocolVersions[1],
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL2) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL2(address);
        } catch (e) {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes(16).toString("base64");
      const request = isSecure ? https.request : http2.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate(
          opts.perMessageDeflate !== true ? opts.perMessageDeflate : {},
          false,
          opts.maxPayload
        );
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL2(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket3.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket3.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket3.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket3.CLOSED) return;
      if (websocket.readyState === WebSocket3.OPEN) {
        websocket._readyState = WebSocket3.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket3.CLOSING;
      let chunk;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && (chunk = websocket._socket.read()) !== null) {
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket3.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket3.CLOSING;
        this.destroy();
      }
    }
  }
});

// ../../../node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "../../../node_modules/ws/lib/stream.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    var WebSocket3 = require_websocket();
    var { Duplex } = require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream2(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null) return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused) ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module2.exports = createWebSocketStream2;
  }
});

// ../../../node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "../../../node_modules/ws/lib/subprotocol.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    var { tokenChars } = require_validation();
    function parse(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module2.exports = { parse };
  }
});

// ../../../node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "../../../node_modules/ws/lib/websocket-server.js"(exports2, module2) {
    "use strict";
    init_import_meta_shim();
    var EventEmitter = require("events");
    var http2 = require("http");
    var { Duplex } = require("stream");
    var { createHash } = require("crypto");
    var extension = require_extension();
    var PerMessageDeflate = require_permessage_deflate();
    var subprotocol = require_subprotocol();
    var WebSocket3 = require_websocket();
    var { GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket3,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http2.createServer((req, res) => {
            const body = http2.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server2 = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server2.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate(
            this.options.perMessageDeflate,
            true,
            this.options.maxPayload
          );
          try {
            const offers = extension.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
              extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket, 503);
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate.extensionName]) {
          const params = extensions[PerMessageDeflate.extensionName].params;
          const value = extension.format({
            [PerMessageDeflate.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module2.exports = WebSocketServer2;
    function addListeners(server2, map) {
      for (const event of Object.keys(map)) server2.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server2.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server2) {
      server2._state = CLOSED;
      server2.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http2.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http2.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server2, req, socket, code, message, headers) {
      if (server2.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server2.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// ../../../node_modules/ws/wrapper.mjs
var import_stream, import_receiver, import_sender, import_websocket, import_websocket_server;
var init_wrapper = __esm({
  "../../../node_modules/ws/wrapper.mjs"() {
    init_import_meta_shim();
    import_stream = __toESM(require_stream(), 1);
    import_receiver = __toESM(require_receiver(), 1);
    import_sender = __toESM(require_sender(), 1);
    import_websocket = __toESM(require_websocket(), 1);
    import_websocket_server = __toESM(require_websocket_server(), 1);
  }
});

// ../compat.ts
async function fileExists(path) {
  if (IS_BUN) {
    return Bun.file(path).exists();
  }
  try {
    await (0, import_promises.access)(path);
    return true;
  } catch {
    return false;
  }
}
async function getFileSize(path) {
  if (IS_BUN) {
    return Bun.file(path).size;
  }
  return (await (0, import_promises.stat)(path)).size;
}
async function createFileStream(path) {
  if (IS_BUN) {
    return Bun.file(path).stream();
  }
  const nodeStream = (0, import_node_fs.createReadStream)(path);
  return import_node_stream.Readable.toWeb(nodeStream);
}
function runSync(cmd, opts) {
  if (IS_BUN) {
    const result2 = Bun.spawnSync({
      cmd,
      stdout: opts?.stdout ?? "pipe",
      stderr: opts?.stderr ?? "pipe"
    });
    return {
      success: result2.success,
      stdout: Buffer.from(result2.stdout ?? ""),
      stderr: Buffer.from(result2.stderr ?? ""),
      exitCode: result2.exitCode
    };
  }
  const result = cp.spawnSync(cmd[0], cmd.slice(1), {
    stdio: [
      opts?.stdin ?? "pipe",
      opts?.stdout ?? "pipe",
      opts?.stderr ?? "pipe"
    ],
    encoding: "buffer"
  });
  return {
    success: result.status === 0,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
    exitCode: result.status
  };
}
function runDetached(cmd) {
  if (IS_BUN) {
    Bun.spawn({ cmd, stdout: "ignore", stderr: "ignore" });
    return;
  }
  const child = cp.spawn(cmd[0], cmd.slice(1), {
    stdio: "ignore",
    detached: true
  });
  child.unref();
}
function spawnProcess(cmd, env) {
  if (IS_BUN) {
    const proc = Bun.spawn({
      cmd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: env ?? process.env
    });
    return {
      stdin: proc.stdin,
      stdout: proc.stdout,
      stderr: proc.stderr,
      pid: proc.pid,
      kill: (sig) => proc.kill(sig),
      exited: proc.exited
    };
  }
  const child = cp.spawn(cmd[0], cmd.slice(1), {
    stdio: ["pipe", "pipe", "pipe"],
    env: env ?? process.env
  });
  const toWebStream = (nodeStream) => {
    if (!nodeStream) return null;
    return import_node_stream.Readable.toWeb(nodeStream);
  };
  return {
    stdin: child.stdin,
    stdout: toWebStream(child.stdout),
    stderr: toWebStream(child.stderr),
    pid: child.pid,
    kill: (sig) => child.kill(sig ?? "SIGTERM"),
    exited: new Promise((resolve3) => {
      child.on("exit", (code) => resolve3(code ?? 1));
      child.on("error", () => resolve3(1));
    })
  };
}
function createBridgeServer(config) {
  if (IS_BUN) {
    return createBunServer(config);
  }
  return createNodeServer(config);
}
function createBunServer(config) {
  const bunWsClients = /* @__PURE__ */ new Map();
  const server2 = Bun.serve({
    hostname: config.hostname,
    port: config.port,
    async fetch(req, server3) {
      const upgrade = (data) => {
        return server3.upgrade(req, { data: data ?? {} });
      };
      return await config.fetch(new Request(req.url, req), upgrade);
    },
    websocket: {
      open(bunWs) {
        const wrapper = {
          send: (data) => bunWs.send(data),
          close: (code, reason) => bunWs.close(code, reason),
          data: bunWs.data ?? {}
        };
        bunWsClients.set(bunWs, wrapper);
        config.websocket.open(wrapper);
      },
      message(bunWs, message) {
        const wrapper = bunWsClients.get(bunWs);
        if (!wrapper) return;
        const data = typeof message === "string" ? message : Buffer.from(message);
        config.websocket.message(wrapper, data);
      },
      close(bunWs) {
        const wrapper = bunWsClients.get(bunWs);
        if (wrapper) {
          config.websocket.close(wrapper);
          bunWsClients.delete(bunWs);
        }
      },
      maxPayloadLength: config.maxPayloadLength,
      idleTimeout: config.idleTimeout
    }
  });
  return {
    stop: () => server2.stop(),
    port: server2.port
  };
}
function createNodeServer(config) {
  const wss = new import_websocket_server.default({ noServer: true });
  let pendingUpgradeData = null;
  const httpServer = http.createServer(
    async (nodeReq, nodeRes) => {
      const chunks = [];
      for await (const chunk of nodeReq) {
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const url = `http://${config.hostname}:${config.port}${nodeReq.url ?? "/"}`;
      const headers = new Headers();
      for (const [key, val] of Object.entries(nodeReq.headers)) {
        if (val) headers.set(key, Array.isArray(val) ? val.join(", ") : val);
      }
      const reqInit = {
        method: nodeReq.method,
        headers
      };
      if (nodeReq.method !== "GET" && nodeReq.method !== "HEAD" && body.length > 0) {
        reqInit.body = body;
      }
      const request = new Request(url, reqInit);
      const upgrade = (data) => {
        pendingUpgradeData = data ?? {};
        return true;
      };
      try {
        const response = await config.fetch(request, upgrade);
        if (response === void 0 || pendingUpgradeData !== null) {
          if (pendingUpgradeData === null) {
            nodeRes.writeHead(500);
            nodeRes.end("WebSocket upgrade not triggered");
          }
          return;
        }
        nodeRes.writeHead(response.status, Object.fromEntries(response.headers));
        const responseBody = await response.arrayBuffer();
        nodeRes.end(Buffer.from(responseBody));
      } catch (err) {
        nodeRes.writeHead(500);
        nodeRes.end("Internal Server Error");
      }
    }
  );
  httpServer.on(
    "upgrade",
    (req, socket, head) => {
      const url = `http://${config.hostname}:${config.port}${req.url ?? "/"}`;
      const request = new Request(url, {
        method: req.method,
        headers: new Headers(
          Object.entries(req.headers).reduce(
            (acc, [k, v]) => {
              if (v) acc[k] = Array.isArray(v) ? v.join(", ") : v;
              return acc;
            },
            {}
          )
        )
      });
      pendingUpgradeData = null;
      const upgradeFunc = (data) => {
        pendingUpgradeData = data ?? {};
        return true;
      };
      Promise.resolve(config.fetch(request, upgradeFunc)).then((response) => {
        if (pendingUpgradeData !== null) {
          wss.handleUpgrade(req, socket, head, (nodeWs) => {
            const wrapper = {
              send: (data) => {
                if (nodeWs.readyState === 1) nodeWs.send(data);
              },
              close: (code, reason) => nodeWs.close(code, reason),
              data: pendingUpgradeData ?? {}
            };
            nodeWs._bridgeWrapper = wrapper;
            config.websocket.open(wrapper);
            nodeWs.on("message", (msg) => {
              const data = typeof msg === "string" ? msg : Buffer.from(msg);
              config.websocket.message(wrapper, data);
            });
            nodeWs.on("close", () => {
              config.websocket.close(wrapper);
            });
          });
        } else {
          socket.destroy();
        }
      });
    }
  );
  httpServer.listen(config.port, config.hostname);
  return {
    stop: () => {
      wss.close();
      httpServer.close();
    },
    port: config.port
  };
}
var import_promises, import_node_fs, import_node_stream, cp, http, IS_BUN;
var init_compat = __esm({
  "../compat.ts"() {
    init_import_meta_shim();
    import_promises = require("node:fs/promises");
    import_node_fs = require("node:fs");
    import_node_stream = require("node:stream");
    cp = __toESM(require("node:child_process"));
    http = __toESM(require("node:http"));
    init_wrapper();
    IS_BUN = typeof globalThis.Bun !== "undefined";
  }
});

// ../claude-chrome-bridge.ts
var claude_chrome_bridge_exports = {};
function adbNotify(tag, title, text) {
  try {
    runDetached([ADB_PATH, "shell", "cmd", "notification", "post", "-t", title, tag, text]);
  } catch {
  }
}
function findRuntime() {
  const { existsSync: existsSync2 } = require("fs");
  if (IS_BUN) {
    const candidates = [
      (0, import_path.resolve)(process.env.HOME ?? "~", ".bun/bin/bun"),
      "/data/data/com.termux/files/home/.bun/bin/bun",
      "/usr/local/bin/bun"
    ];
    for (const p of candidates) {
      if (existsSync2(p)) return p;
    }
    return "bun";
  }
  return process.execPath;
}
function log(level, msg, ...args2) {
  if (LOG_PRIORITY[level] < LOG_PRIORITY[LOG_LEVEL]) return;
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  const prefix = `[${ts}] [bridge:${level}]`;
  if (level === "error") console.error(prefix, msg, ...args2);
  else console.log(prefix, msg, ...args2);
}
function encodeNativeMessage(json) {
  const body = Buffer.from(json, "utf-8");
  if (body.length > MAX_MESSAGE_SIZE) {
    throw new Error(`Message too large: ${body.length} > ${MAX_MESSAGE_SIZE}`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}
function crc32(data) {
  let crc = 4294967295;
  for (let i = 0; i < data.length; i++) crc = crc32Table[(crc ^ data[i]) & 255] ^ crc >>> 8;
  return (crc ^ 4294967295) >>> 0;
}
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
function decodePNG(dataUrl) {
  const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(b64, "base64");
  let offset = 8;
  let width = 0, height = 0, colorType = 0;
  const idatChunks = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") break;
    offset += 12 + length;
  }
  const raw = (0, import_node_zlib.inflateSync)(Buffer.concat(idatChunks));
  const bpp = colorType === 6 ? 4 : 3;
  const rowBytes = width * bpp;
  const rgba = new Uint8Array(width * height * 4);
  const prevRow = new Uint8Array(rowBytes);
  const curRow = new Uint8Array(rowBytes);
  let rawIdx = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawIdx++];
    for (let x = 0; x < rowBytes; x++) {
      const rawByte = raw[rawIdx++];
      const a = x >= bpp ? curRow[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      switch (filterType) {
        case 0:
          curRow[x] = rawByte;
          break;
        case 1:
          curRow[x] = rawByte + a & 255;
          break;
        case 2:
          curRow[x] = rawByte + b & 255;
          break;
        case 3:
          curRow[x] = rawByte + (a + b >> 1) & 255;
          break;
        case 4:
          curRow[x] = rawByte + paethPredictor(a, b, c) & 255;
          break;
      }
    }
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      if (bpp === 4) {
        rgba[di] = curRow[x * 4];
        rgba[di + 1] = curRow[x * 4 + 1];
        rgba[di + 2] = curRow[x * 4 + 2];
        rgba[di + 3] = curRow[x * 4 + 3];
      } else {
        rgba[di] = curRow[x * 3];
        rgba[di + 1] = curRow[x * 3 + 1];
        rgba[di + 2] = curRow[x * 3 + 2];
        rgba[di + 3] = 255;
      }
    }
    prevRow.set(curRow);
  }
  return { width, height, rgba };
}
function encodePNG(rgba, width, height) {
  const rowLen = width * 4;
  const filtered = Buffer.alloc(height * (1 + rowLen));
  for (let y = 0; y < height; y++) {
    filtered[y * (1 + rowLen)] = 0;
    filtered.set(rgba.subarray(y * rowLen, (y + 1) * rowLen), y * (1 + rowLen) + 1);
  }
  const compressed = (0, import_node_zlib.deflateSync)(filtered);
  function writeChunk(type, data) {
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write(type, 4, "ascii");
    data.copy(chunk, 8);
    const crcBuf = Buffer.alloc(4 + data.length);
    crcBuf.write(type, 0, "ascii");
    data.copy(crcBuf, 4);
    chunk.writeUInt32BE(crc32(crcBuf), 8 + data.length);
    return chunk;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = writeChunk("IDAT", compressed);
  const iend = writeChunk("IEND", Buffer.alloc(0));
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, writeChunk("IHDR", ihdr), idat, iend]);
}
function scalePixels(rgba, srcW, srcH, maxW) {
  if (srcW <= maxW) return { rgba, width: srcW, height: srcH };
  const scale = maxW / srcW;
  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);
  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(srcH - 1, Math.floor(y / scale));
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(srcW - 1, Math.floor(x / scale));
      const si = (srcY * srcW + srcX) * 4, di = (y * dstW + x) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  }
  return { rgba: out, width: dstW, height: dstH };
}
function cropPixels(rgba, srcW, _srcH, cx, cy, cw, ch) {
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcOff = ((cy + y) * srcW + cx) * 4;
    const dstOff = y * cw * 4;
    out.set(rgba.subarray(srcOff, srcOff + cw * 4), dstOff);
  }
  return out;
}
function quantizeColors(rgba, width, height) {
  const palette = new Uint8Array(256 * 3);
  let pi = 0;
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++) {
        palette[pi * 3] = Math.round(r * 255 / 5);
        palette[pi * 3 + 1] = Math.round(g * 255 / 5);
        palette[pi * 3 + 2] = Math.round(b * 255 / 5);
        pi++;
      }
  while (pi < 256) {
    palette[pi * 3] = palette[pi * 3 + 1] = palette[pi * 3 + 2] = 0;
    pi++;
  }
  const total = width * height;
  const indexed = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const ri = Math.min(5, Math.round(rgba[i * 4] * 5 / 255));
    const gi = Math.min(5, Math.round(rgba[i * 4 + 1] * 5 / 255));
    const bi = Math.min(5, Math.round(rgba[i * 4 + 2] * 5 / 255));
    indexed[i] = ri * 36 + gi * 6 + bi;
  }
  return { indexed, palette };
}
function lzwEncode(indexed, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const maxTableSize = 4096;
  function newRoots() {
    const roots2 = [];
    for (let i = 0; i < clearCode; i++) roots2[i] = { children: /* @__PURE__ */ new Map(), code: i };
    return roots2;
  }
  const output = [minCodeSize];
  let curByte = 0, curBit = 0;
  const subBlock = [];
  function writeBits(code, codeSize2) {
    curByte |= code << curBit;
    curBit += codeSize2;
    while (curBit >= 8) {
      subBlock.push(curByte & 255);
      curByte >>>= 8;
      curBit -= 8;
      if (subBlock.length === 255) {
        output.push(255, ...subBlock);
        subBlock.length = 0;
      }
    }
  }
  function flush() {
    if (curBit > 0) {
      subBlock.push(curByte & 255);
      curByte = 0;
      curBit = 0;
    }
    if (subBlock.length > 0) {
      output.push(subBlock.length, ...subBlock);
      subBlock.length = 0;
    }
  }
  let roots = newRoots();
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  writeBits(clearCode, codeSize);
  if (indexed.length === 0) {
    writeBits(eoiCode, codeSize);
    flush();
    output.push(0);
    return new Uint8Array(output);
  }
  let node = roots[indexed[0]];
  for (let i = 1; i < indexed.length; i++) {
    const pixel = indexed[i];
    const child = node.children.get(pixel);
    if (child) {
      node = child;
      continue;
    }
    writeBits(node.code, codeSize);
    if (nextCode < maxTableSize) {
      node.children.set(pixel, { children: /* @__PURE__ */ new Map(), code: nextCode++ });
      if (nextCode > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      writeBits(clearCode, codeSize);
      roots = newRoots();
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
    }
    node = roots[pixel];
  }
  writeBits(node.code, codeSize);
  writeBits(eoiCode, codeSize);
  flush();
  output.push(0);
  return new Uint8Array(output);
}
function encodeGIF(frames, delayMs) {
  if (frames.length === 0) return new Uint8Array(0);
  const { width, height } = frames[0];
  const delay = Math.max(2, Math.round(delayMs / 10));
  const { palette } = quantizeColors(frames[0].rgba, width, height);
  const chunks = [];
  chunks.push(new Uint8Array([71, 73, 70, 56, 57, 97]));
  const lsd = new Uint8Array(7);
  lsd[0] = width & 255;
  lsd[1] = width >> 8 & 255;
  lsd[2] = height & 255;
  lsd[3] = height >> 8 & 255;
  lsd[4] = 247;
  chunks.push(lsd);
  chunks.push(palette);
  chunks.push(new Uint8Array([
    33,
    255,
    11,
    78,
    69,
    84,
    83,
    67,
    65,
    80,
    69,
    50,
    46,
    48,
    // "NETSCAPE2.0"
    3,
    1,
    0,
    0,
    // loop forever
    0
    // block terminator
  ]));
  for (const frame of frames) {
    const { indexed } = quantizeColors(frame.rgba, width, height);
    chunks.push(new Uint8Array([
      33,
      249,
      4,
      0,
      delay & 255,
      delay >> 8 & 255,
      0,
      0
    ]));
    const desc = new Uint8Array(10);
    desc[0] = 44;
    desc[5] = width & 255;
    desc[6] = width >> 8 & 255;
    desc[7] = height & 255;
    desc[8] = height >> 8 & 255;
    chunks.push(desc);
    chunks.push(lzwEncode(indexed, 8));
  }
  chunks.push(new Uint8Array([59]));
  let total = 0;
  for (const c of chunks) total += c.length;
  const result = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    result.set(c, off);
    off += c.length;
  }
  return result;
}
function spawnNativeHost() {
  if (nativeHost) {
    log("warn", "Native host already running, killing first");
    nativeHost.kill();
    nativeHost = null;
  }
  log("info", `Spawning native host: ${RUNTIME_PATH} ${CLI_PATH} --chrome-native-host`);
  nativeHost = spawnProcess(
    [RUNTIME_PATH, CLI_PATH, "--chrome-native-host"],
    {
      ...process.env,
      // Ensure CFC is enabled
      CLAUDE_CODE_ENABLE_CFC: "true",
      // Termux has no USER set — os.userInfo().username may return "unknown",
      // creating a socket dir mismatch vs the MCP server. Force it.
      USER: process.env.USER || runSync(["id", "-un"]).stdout.toString().trim() || "u0_a364"
    }
  );
  const readStdout = async () => {
    if (!nativeHost?.stdout) return;
    const reader = nativeHost.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stdoutDecoder.append(Buffer.from(value));
        for (const json of stdoutDecoder.drain()) {
          handleNativeMessage(json);
        }
      }
    } catch (err) {
      log("error", "stdout read error:", err);
    }
    log("info", "Native host stdout closed");
  };
  const readStderr = async () => {
    if (!nativeHost?.stderr) return;
    const reader = nativeHost.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split("\n").filter(Boolean)) {
          log("debug", `[native-host] ${line}`);
        }
      }
    } catch (err) {
      log("error", "stderr read error:", err);
    }
  };
  readStdout();
  readStderr();
  nativeHost.exited.then((code) => {
    log("warn", `Native host exited with code ${code}`);
    nativeHost = null;
    if (wsClients.size > 0) {
      log("info", `Restarting native host in ${RECONNECT_DELAY_MS}ms (${wsClients.size} clients connected)`);
      setTimeout(spawnNativeHost, RECONNECT_DELAY_MS);
    }
  });
}
function handleNativeMessage(json) {
  log("debug", `native\u2192ws: ${json.slice(0, 200)}`);
  let outJson = json;
  try {
    const parsed = JSON.parse(json);
    if (parsed.type === "tool_request" && parsed.method === "execute_tool" && parsed.params?.tool) {
      parsed.method = parsed.params.tool;
      parsed.params = parsed.params.args ?? {};
      outJson = JSON.stringify(parsed);
      log("debug", `Unwrapped execute_tool \u2192 ${parsed.method}`);
    }
    if (parsed.type === "tool_request" && parsed.method === "javascript_tool" && cdpManager.isAvailable()) {
      const code = parsed.params?.text ?? "";
      const tabId = parsed.params?.tabId;
      log("info", `CDP: intercepting javascript_tool (${code.slice(0, 80)})`);
      cdpManager.evaluateJS(code, tabId).then((cdpResult) => {
        const response = JSON.stringify({ type: "tool_response", result: cdpResult });
        log("debug", `CDP\u2192native: ${response.slice(0, 200)}`);
        sendToNativeHost(response);
      }).catch((err) => {
        log("warn", `CDP eval failed, forwarding to extension: ${err.message}`);
        for (const client of wsClients) {
          try {
            client.send(outJson);
          } catch {
          }
        }
      });
      return;
    }
    if (parsed.type === "tool_request" && parsed.method === "computer" && parsed.params?.action === "screenshot" && cdpManager.isAvailable()) {
      const tabId = parsed.params?.tabId;
      log("info", `CDP: intercepting computer screenshot (tab ${tabId ?? "active"})`);
      cdpManager.captureScreenshot(tabId).then((cdpResult) => {
        if (cdpResult.data) {
          sendToNativeHost(JSON.stringify({
            type: "tool_response",
            result: {
              content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: cdpResult.data } }]
            }
          }));
        } else {
          log("warn", `CDP screenshot failed: ${cdpResult.error}`);
          for (const client of wsClients) {
            try {
              client.send(outJson);
            } catch {
            }
          }
        }
      }).catch((err) => {
        log("warn", `CDP screenshot error: ${err.message}`);
        for (const client of wsClients) {
          try {
            client.send(outJson);
          } catch {
          }
        }
      });
      return;
    }
    if (parsed.type === "tool_request" && parsed.method === "computer" && parsed.params?.action === "zoom" && cdpManager.isAvailable()) {
      const tabId = parsed.params?.tabId;
      const zoomFactor = parsed.params?.zoom_factor ?? 2;
      const coord = parsed.params?.coordinate ?? null;
      log("info", `CDP: intercepting computer zoom \xD7${zoomFactor} (tab ${tabId ?? "active"})`);
      cdpManager.captureScreenshot(tabId).then((cdpResult) => {
        if (!cdpResult.data) {
          log("warn", `CDP zoom screenshot failed: ${cdpResult.error}`);
          for (const client of wsClients) {
            try {
              client.send(outJson);
            } catch {
            }
          }
          return;
        }
        try {
          const { width, height, rgba } = decodePNG(cdpResult.data);
          const cx = coord?.[0] ?? Math.round(width / 2);
          const cy = coord?.[1] ?? Math.round(height / 2);
          const cropW = Math.round(width / zoomFactor);
          const cropH = Math.round(height / zoomFactor);
          const cropX = Math.max(0, Math.min(Math.round(cx - cropW / 2), width - cropW));
          const cropY = Math.max(0, Math.min(Math.round(cy - cropH / 2), height - cropH));
          const croppedRGBA = cropPixels(rgba, width, height, cropX, cropY, cropW, cropH);
          const pngBuf = encodePNG(croppedRGBA, cropW, cropH);
          const b64 = pngBuf.toString("base64");
          sendToNativeHost(JSON.stringify({
            type: "tool_response",
            result: {
              content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }]
            }
          }));
        } catch (cropErr) {
          log("warn", `CDP zoom crop failed: ${cropErr.message}`);
          for (const client of wsClients) {
            try {
              client.send(outJson);
            } catch {
            }
          }
        }
      }).catch((err) => {
        log("warn", `CDP zoom error: ${err.message}`);
        for (const client of wsClients) {
          try {
            client.send(outJson);
          } catch {
          }
        }
      });
      return;
    }
    const CDP_ACTIONS = /* @__PURE__ */ new Set([
      "left_click",
      "right_click",
      "double_click",
      "triple_click",
      "hover",
      "type",
      "key",
      "scroll",
      "left_click_drag"
    ]);
    if (parsed.type === "tool_request" && parsed.method === "computer" && CDP_ACTIONS.has(parsed.params?.action) && cdpManager.isAvailable()) {
      const action = parsed.params.action;
      const tabId = parsed.params?.tabId;
      log("info", `CDP: intercepting computer ${action} (tab ${tabId ?? "active"})`);
      cdpManager.dispatchComputerAction(action, parsed.params ?? {}, tabId).then((cdpResult) => {
        if (cdpResult.result) {
          sendToNativeHost(JSON.stringify({
            type: "tool_response",
            result: { result: cdpResult.result }
          }));
        } else {
          log("warn", `CDP ${action} failed: ${cdpResult.error}`);
          for (const client of wsClients) {
            try {
              client.send(outJson);
            } catch {
            }
          }
        }
      }).catch((err) => {
        log("warn", `CDP ${action} error: ${err.message}`);
        for (const client of wsClients) {
          try {
            client.send(outJson);
          } catch {
          }
        }
      });
      return;
    }
    if (parsed.type === "tool_request" && parsed.method === "resize_window" && cdpManager.isAvailable()) {
      const { width, height } = parsed.params ?? {};
      if (width && height) {
        log("info", `CDP: intercepting resize_window (${width}\xD7${height})`);
        cdpManager.setDeviceMetrics(width, height, parsed.params?.tabId).then((r) => {
          sendToNativeHost(JSON.stringify({ type: "tool_response", result: r }));
        }).catch(() => {
          for (const client of wsClients) {
            try {
              client.send(outJson);
            } catch {
            }
          }
        });
        return;
      }
    }
    if (parsed.type === "tool_request" && parsed.method === "read_network_requests" && cdpManager.isAvailable()) {
      const tabId = parsed.params?.tabId;
      const since = parsed.params?.since;
      const typeFilter = parsed.params?.type_filter;
      const cdpRequests = cdpManager.getNetworkRequests(tabId, since, typeFilter);
      if (cdpRequests.length > 0) {
        log("info", `CDP: returning ${cdpRequests.length} network requests`);
        sendToNativeHost(JSON.stringify({
          type: "tool_response",
          result: { result: cdpRequests, count: cdpRequests.length, source: "cdp" }
        }));
        return;
      }
    }
  } catch {
  }
  for (const ws of wsClients) {
    try {
      ws.send(outJson);
    } catch (err) {
      log("error", "Failed to send to WS client:", err);
    }
  }
}
function sendToNativeHost(json) {
  if (!nativeHost?.stdin) {
    log("error", "Cannot send to native host: not running or stdin closed");
    return false;
  }
  try {
    const encoded = encodeNativeMessage(json);
    nativeHost.stdin.write(encoded);
    log("debug", `ws\u2192native: ${json.slice(0, 200)}`);
    return true;
  } catch (err) {
    log("error", "Failed to write to native host stdin:", err);
    return false;
  }
}
function shutdown() {
  log("info", "Shutting down bridge...");
  for (const ws of wsClients) {
    try {
      ws.close(1001, "Bridge shutting down");
    } catch {
    }
  }
  wsClients.clear();
  if (nativeHost) {
    nativeHost.kill();
    nativeHost = null;
  }
  cdpManager.cleanup();
  adbNotify("cfc-bridge", "CFC Bridge stopped", "Bridge is no longer running");
  server.stop();
  log("info", "Bridge stopped");
  process.exit(0);
}
var import_path, import_node_zlib, SCRIPT_DIR, MANIFEST_PATH, BRIDGE_VERSION, WS_PORT, WS_HOST, BRIDGE_TOKEN, MAX_MESSAGE_SIZE, RECONNECT_DELAY_MS, HEARTBEAT_INTERVAL_MS, TERMUX_PREFIX, TERMUX_BIN, ADB_PATH, REPO_CLI, BUN_GLOBAL_CLI, NPM_GLOBAL_CLI, CLI_PATH, RUNTIME_PATH, LOG_LEVEL, LOG_PRIORITY, NativeMessageDecoder, CDP_PORT, CDP_PID_CHECK_INTERVAL_MS, CDP_TARGET_CACHE_TTL_MS, CDP_TIMEOUT_MS, CdpManager, cdpManager, crc32Table, nativeHost, stdoutDecoder, wsClients, server, TEST_PAGE_HTML;
var init_claude_chrome_bridge = __esm({
  "../claude-chrome-bridge.ts"() {
    init_import_meta_shim();
    import_path = require("path");
    import_node_zlib = require("node:zlib");
    init_compat();
    SCRIPT_DIR = IS_BUN ? globalThis.Bun.main ? (0, import_path.dirname)(globalThis.Bun.main) : (0, import_path.dirname)(new URL(import_meta_url).pathname) : (0, import_path.dirname)(new URL(import_meta_url).pathname);
    MANIFEST_PATH = (0, import_path.resolve)(SCRIPT_DIR, "edge-claude-ext/manifest.json");
    BRIDGE_VERSION = (() => {
      try {
        const { readFileSync: readFileSync2 } = require("fs");
        const manifest = JSON.parse(readFileSync2(MANIFEST_PATH, "utf-8"));
        return manifest.version ?? "0.0.0";
      } catch {
        return "0.0.0";
      }
    })();
    WS_PORT = parseInt(process.env.BRIDGE_PORT ?? "18963", 10);
    WS_HOST = "127.0.0.1";
    BRIDGE_TOKEN = process.env.BRIDGE_TOKEN ?? "";
    MAX_MESSAGE_SIZE = 1048576;
    RECONNECT_DELAY_MS = 2e3;
    HEARTBEAT_INTERVAL_MS = 15e3;
    TERMUX_PREFIX = "/data/data/com.termux/files/usr";
    TERMUX_BIN = `${TERMUX_PREFIX}/bin`;
    ADB_PATH = `${TERMUX_BIN}/adb`;
    REPO_CLI = (0, import_path.resolve)(SCRIPT_DIR, "cli.js");
    BUN_GLOBAL_CLI = (0, import_path.resolve)(
      process.env.HOME ?? "~",
      ".bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js"
    );
    NPM_GLOBAL_CLI = (0, import_path.resolve)(
      process.env.HOME ?? "~",
      ".npm/lib/node_modules/@anthropic-ai/claude-code/cli.js"
    );
    CLI_PATH = (() => {
      const { existsSync: existsSync2 } = require("fs");
      for (const p of [REPO_CLI, BUN_GLOBAL_CLI, NPM_GLOBAL_CLI]) {
        if (existsSync2(p)) return p;
      }
      const result = runSync(["which", "claude"]);
      if (result.success) {
        const claudeBin = result.stdout.toString().trim();
        const resolved = (0, import_path.resolve)((0, import_path.dirname)(claudeBin), "../lib/node_modules/@anthropic-ai/claude-code/cli.js");
        if (existsSync2(resolved)) return resolved;
      }
      return BUN_GLOBAL_CLI;
    })();
    RUNTIME_PATH = findRuntime();
    LOG_LEVEL = process.env.BRIDGE_LOG_LEVEL ?? "info";
    LOG_PRIORITY = { debug: 0, info: 1, warn: 2, error: 3 };
    NativeMessageDecoder = class {
      buffer = Buffer.alloc(0);
      append(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
      }
      /** Drain all complete messages from the buffer */
      drain() {
        const messages = [];
        while (this.buffer.length >= 4) {
          const len = this.buffer.readUInt32LE(0);
          if (len === 0 || len > MAX_MESSAGE_SIZE) {
            log("error", `Invalid native message length: ${len}, discarding buffer`);
            this.buffer = Buffer.alloc(0);
            break;
          }
          if (this.buffer.length < 4 + len) break;
          const body = this.buffer.subarray(4, 4 + len);
          this.buffer = this.buffer.subarray(4 + len);
          messages.push(body.toString("utf-8"));
        }
        return messages;
      }
    };
    CDP_PORT = parseInt(process.env.CDP_PORT ?? "9223", 10);
    CDP_PID_CHECK_INTERVAL_MS = 6e4;
    CDP_TARGET_CACHE_TTL_MS = 1e4;
    CDP_TIMEOUT_MS = 15e3;
    CdpManager = class {
      ws = null;
      edgePid = null;
      state = "disconnected";
      msgId = 0;
      /** Pending CDP JSON-RPC responses keyed by message id */
      pending = /* @__PURE__ */ new Map();
      /** Extension tabId → CDP targetId mapping */
      tabTargetMap = /* @__PURE__ */ new Map();
      /** Extension tabId → URL cache (populated from tabs_context_mcp responses) */
      tabUrlCache = /* @__PURE__ */ new Map();
      /** CDP targetId → sessionId for attached targets */
      sessionMap = /* @__PURE__ */ new Map();
      /** Last time targets were fetched */
      targetsLastFetched = 0;
      /** Cached CDP targets */
      cachedTargets = [];
      /** PID recheck interval handle */
      pidCheckTimer = null;
      /** Sessions where Network domain has been enabled */
      networkEnabledSessions = /* @__PURE__ */ new Set();
      /** Network request events per sessionId */
      networkEvents = /* @__PURE__ */ new Map();
      /** Attempt connection — safe to call multiple times, no-op if already connected */
      async connect() {
        if (this.state === "connected" && this.ws?.readyState === WebSocket.OPEN) return true;
        if (this.state === "connecting") return false;
        this.state = "connecting";
        try {
          const pidResult = runSync([ADB_PATH, "shell", "pidof", "com.microsoft.emmx.canary"]);
          const pidStr = pidResult.stdout.toString().trim().split(/\s+/)[0];
          if (!pidStr || pidResult.exitCode !== 0) {
            log("debug", "CDP: Edge not running or ADB unavailable");
            this.state = "disconnected";
            return false;
          }
          this.edgePid = parseInt(pidStr, 10);
          if (isNaN(this.edgePid)) {
            log("warn", `CDP: invalid PID "${pidStr}"`);
            this.state = "disconnected";
            return false;
          }
          const socketCandidates = [
            `chrome_devtools_remote_${this.edgePid}`,
            // Chrome convention (PID-suffixed)
            "chrome_devtools_remote"
            // Edge Android convention (plain)
          ];
          let versionData = null;
          for (const socketName of socketCandidates) {
            const fwdResult = runSync(
              [ADB_PATH, "forward", `tcp:${CDP_PORT}`, `localabstract:${socketName}`]
            );
            if (fwdResult.exitCode !== 0) continue;
            try {
              const resp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
              versionData = await resp.json();
              log("info", `CDP: Edge version \u2014 ${versionData["Browser"] ?? "unknown"}, pkg: ${versionData["Android-Package"] ?? "unknown"} (socket: ${socketName})`);
              break;
            } catch {
              runSync([ADB_PATH, "forward", "--remove", `tcp:${CDP_PORT}`]);
            }
          }
          if (!versionData) {
            log("warn", "CDP: no working DevTools socket found");
            this.state = "disconnected";
            return false;
          }
          const wsUrl = versionData.webSocketDebuggerUrl?.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${CDP_PORT}`) ?? `ws://127.0.0.1:${CDP_PORT}/devtools/browser`;
          await this.connectWebSocket(wsUrl);
          if (!this.pidCheckTimer) {
            this.pidCheckTimer = setInterval(() => this.recheckPid(), CDP_PID_CHECK_INTERVAL_MS);
          }
          this.state = "connected";
          log("info", `CDP: connected to Edge (PID ${this.edgePid}) on port ${CDP_PORT}`);
          return true;
        } catch (err) {
          log("warn", `CDP: connect failed \u2014 ${err.message}`);
          this.state = "disconnected";
          return false;
        }
      }
      /** Connect WebSocket to browser-level endpoint */
      connectWebSocket(url) {
        return new Promise((resolve3, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("CDP WebSocket connection timeout"));
          }, CDP_TIMEOUT_MS);
          this.ws = new WebSocket(url);
          this.ws.addEventListener("open", () => {
            clearTimeout(timeout);
            log("debug", `CDP: WebSocket open to ${url}`);
            resolve3();
          });
          this.ws.addEventListener("error", (ev) => {
            clearTimeout(timeout);
            log("error", `CDP: WebSocket error`);
            reject(new Error("CDP WebSocket error"));
          });
          this.ws.addEventListener("close", () => {
            log("info", "CDP: WebSocket closed");
            this.state = "disconnected";
            this.ws = null;
            this.sessionMap.clear();
            this.tabTargetMap.clear();
          });
          this.ws.addEventListener("message", (ev) => {
            try {
              const data = JSON.parse(String(ev.data));
              if (data.id !== void 0) {
                const p = this.pending.get(data.id);
                if (p) {
                  clearTimeout(p.timer);
                  this.pending.delete(data.id);
                  if (data.error) p.reject(new Error(data.error.message));
                  else p.resolve(data.result);
                }
              }
              if (data.method === "Network.responseReceived") {
                const sessionId = data.sessionId;
                if (sessionId) {
                  const p = data.params;
                  const resp = p.response;
                  if (!this.networkEvents.has(sessionId)) this.networkEvents.set(sessionId, []);
                  const buf = this.networkEvents.get(sessionId);
                  buf.push({
                    url: resp?.url ?? "",
                    method: resp?.requestMethod ?? "GET",
                    statusCode: resp?.status ?? 0,
                    type: p.type ?? "other",
                    timestamp: Date.now()
                  });
                  if (buf.length > 500) buf.shift();
                }
              }
            } catch {
              log("debug", "CDP: unparseable message");
            }
          });
        });
      }
      /** Send a CDP command and await its response */
      sendCommand(method, params = {}, sessionId) {
        return new Promise((resolve3, reject) => {
          if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            reject(new Error("CDP not connected"));
            return;
          }
          const id = ++this.msgId;
          const timer = setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`CDP timeout: ${method}`));
          }, CDP_TIMEOUT_MS);
          this.pending.set(id, { resolve: resolve3, reject, timer });
          const msg = { id, method, params };
          if (sessionId) msg.sessionId = sessionId;
          this.ws.send(JSON.stringify(msg));
        });
      }
      /** Execute JavaScript on a specific tab via CDP */
      async evaluateJS(code, tabId) {
        if (!this.isAvailable()) {
          const connected = await this.connect();
          if (!connected) return { error: "CDP not available" };
        }
        try {
          const targetId = await this.resolveTarget(tabId);
          if (!targetId) {
            return { error: `CDP: no target found for tab ${tabId ?? "active"}` };
          }
          let sessionId = this.sessionMap.get(targetId);
          if (!sessionId) {
            const attachResult = await this.sendCommand("Target.attachToTarget", {
              targetId,
              flatten: true
            });
            sessionId = attachResult.sessionId;
            this.sessionMap.set(targetId, sessionId);
            if (!this.networkEnabledSessions.has(sessionId)) {
              try {
                await this.sendCommand("Network.enable", {}, sessionId);
                this.networkEnabledSessions.add(sessionId);
              } catch {
              }
            }
          }
          const evalResult = await this.sendCommand("Runtime.evaluate", {
            expression: code,
            returnByValue: true,
            awaitPromise: true,
            // Allow accessing async results
            generatePreview: false,
            userGesture: true
          }, sessionId);
          if (evalResult.exceptionDetails) {
            const excMsg = evalResult.exceptionDetails.exception?.description ?? evalResult.exceptionDetails.text ?? "Unknown error";
            return { error: excMsg };
          }
          const r = evalResult.result;
          if (!r) return { result: "undefined" };
          if (r.type === "undefined") return { result: "undefined" };
          if (r.value !== void 0) return { result: JSON.stringify(r.value) };
          if (r.description) return { result: r.description };
          return { result: String(r) };
        } catch (err) {
          return { error: `CDP eval failed: ${err.message}` };
        }
      }
      /** Resolve an extension tabId to a CDP targetId by URL matching */
      async resolveTarget(tabId) {
        if (Date.now() - this.targetsLastFetched > CDP_TARGET_CACHE_TTL_MS) {
          await this.refreshTargets();
        }
        if (tabId !== void 0 && this.tabTargetMap.has(tabId)) {
          log("debug", `CDP: resolveTarget(${tabId}) \u2192 cached ${this.tabTargetMap.get(tabId).slice(0, 16)}...`);
          return this.tabTargetMap.get(tabId);
        }
        if (tabId !== void 0) {
          const tabUrl = this.tabUrlCache.get(tabId);
          if (tabUrl) {
            const target = this.cachedTargets.find((t) => t.url === tabUrl && t.type === "page");
            if (target) {
              this.tabTargetMap.set(tabId, target.targetId);
              log("debug", `CDP: resolveTarget(${tabId}) \u2192 URL match ${target.targetId.slice(0, 16)}... (${tabUrl})`);
              return target.targetId;
            }
            log("debug", `CDP: resolveTarget(${tabId}) \u2014 URL ${tabUrl} not found in ${this.cachedTargets.length} targets`);
          } else {
            log("debug", `CDP: resolveTarget(${tabId}) \u2014 no cached URL (cache size: ${this.tabUrlCache.size})`);
          }
        }
        const firstPage = this.cachedTargets.find((t) => t.type === "page");
        log("debug", `CDP: resolveTarget(${tabId ?? "none"}) \u2192 fallback to first page: ${firstPage?.url ?? "none"}`);
        return firstPage?.targetId ?? null;
      }
      /** Fetch CDP targets via Target.getTargets (not /json/list — those IDs differ) */
      async refreshTargets() {
        try {
          const result = await this.sendCommand("Target.getTargets");
          this.cachedTargets = result.targetInfos;
          this.targetsLastFetched = Date.now();
          for (const [tabId, url] of this.tabUrlCache) {
            const target = this.cachedTargets.find((t) => t.url === url && t.type === "page");
            if (target) this.tabTargetMap.set(tabId, target.targetId);
          }
        } catch (err) {
          log("debug", `CDP: refreshTargets failed \u2014 ${err.message}`);
        }
      }
      /** Cache tab URL from tabs_context_mcp responses for CDP target mapping */
      cacheTabUrl(tabId, url) {
        this.tabUrlCache.set(tabId, url);
        this.tabTargetMap.delete(tabId);
      }
      /** Get buffered network requests, optionally filtered by tab/time/type */
      getNetworkRequests(tabId, since, typeFilter) {
        let allEvents = [];
        if (tabId !== void 0) {
          const targetId = this.tabTargetMap.get(tabId);
          const sessionId = targetId ? this.sessionMap.get(targetId) : void 0;
          if (sessionId) allEvents = this.networkEvents.get(sessionId) ?? [];
        } else {
          for (const events of this.networkEvents.values()) allEvents = allEvents.concat(events);
        }
        if (since) allEvents = allEvents.filter((e) => e.timestamp > since);
        if (typeFilter) allEvents = allEvents.filter((e) => e.type === typeFilter);
        return allEvents.slice(-100);
      }
      /** Resize viewport via CDP Emulation.setDeviceMetricsOverride */
      async setDeviceMetrics(width, height, tabId) {
        if (!this.isAvailable()) return { error: "CDP not available" };
        try {
          const targetId = await this.resolveTarget(tabId);
          if (!targetId) return { error: "No CDP target" };
          let sessionId = this.sessionMap.get(targetId);
          if (!sessionId) {
            const attach = await this.sendCommand("Target.attachToTarget", { targetId, flatten: true });
            sessionId = attach.sessionId;
            this.sessionMap.set(targetId, sessionId);
          }
          await this.sendCommand("Emulation.setDeviceMetricsOverride", {
            width,
            height,
            deviceScaleFactor: 0,
            mobile: true
          }, sessionId);
          return { result: `Viewport set to ${width}\xD7${height} via CDP Emulation` };
        } catch (err) {
          return { error: `CDP resize failed: ${err.message}` };
        }
      }
      /**
       * Capture a PNG screenshot. Tries CDP Page.captureScreenshot first, then
       * falls back to ADB screencap (Edge Android doesn't support CDP screenshots).
       */
      async captureScreenshot(tabId) {
        if (!this.isAvailable()) return { error: "CDP not available" };
        try {
          const targetId = await this.resolveTarget(tabId);
          if (targetId) {
            let sessionId = this.sessionMap.get(targetId);
            if (!sessionId) {
              const attach = await this.sendCommand("Target.attachToTarget", { targetId, flatten: true });
              sessionId = attach.sessionId;
              this.sessionMap.set(targetId, sessionId);
            }
            try {
              await this.sendCommand("Page.bringToFront", {}, sessionId);
            } catch {
            }
          }
        } catch {
        }
        try {
          const tmpPath = "/data/data/com.termux/files/usr/tmp/cdp-screencap.png";
          const cap = runSync([ADB_PATH, "shell", "screencap", "-p", "/sdcard/cdp-screencap.png"]);
          if (cap.exitCode === 0) {
            const pull = runSync([ADB_PATH, "pull", "/sdcard/cdp-screencap.png", tmpPath]);
            if (pull.exitCode === 0 && await fileExists(tmpPath)) {
              const { readFile: rf } = await import("node:fs/promises");
              const buf = await rf(tmpPath);
              log("info", `CDP: ADB screencap captured ${buf.length} bytes`);
              return { data: buf.toString("base64") };
            }
          }
        } catch {
        }
        return { error: "Screenshot not available (CDP Page.captureScreenshot unsupported on Android, ADB screencap failed)" };
      }
      /** Dispatch a computer tool action via CDP Input domain */
      async dispatchComputerAction(action, params, tabId) {
        if (!this.isAvailable()) return { error: "CDP not available" };
        try {
          const targetId = await this.resolveTarget(tabId);
          if (!targetId) return { error: "No CDP target" };
          let sessionId = this.sessionMap.get(targetId);
          if (!sessionId) {
            const attach = await this.sendCommand("Target.attachToTarget", { targetId, flatten: true });
            sessionId = attach.sessionId;
            this.sessionMap.set(targetId, sessionId);
          }
          switch (action) {
            case "left_click":
            case "right_click":
            case "double_click":
            case "triple_click": {
              const [x, y] = params.coordinate ?? [0, 0];
              const button = action === "right_click" ? "right" : "left";
              const clickCount = action === "triple_click" ? 3 : action === "double_click" ? 2 : 1;
              const mods = this.parseModifiers(params.modifiers);
              await this.sendCommand("Input.dispatchMouseEvent", {
                type: "mousePressed",
                x,
                y,
                button,
                clickCount,
                ...mods
              }, sessionId);
              await this.sendCommand("Input.dispatchMouseEvent", {
                type: "mouseReleased",
                x,
                y,
                button,
                clickCount,
                ...mods
              }, sessionId);
              return { result: `${action} at (${x}, ${y})` };
            }
            case "hover": {
              const [x, y] = params.coordinate ?? [0, 0];
              await this.sendCommand("Input.dispatchMouseEvent", {
                type: "mouseMoved",
                x,
                y
              }, sessionId);
              return { result: `hover at (${x}, ${y})` };
            }
            case "type": {
              const text = params.text ?? "";
              await this.sendCommand("Input.insertText", { text }, sessionId);
              return { result: `Typed ${text.length} characters` };
            }
            case "key": {
              const keys = (params.text ?? "").split(" ");
              const repeat = Math.min(params.repeat ?? 1, 100);
              for (let r = 0; r < repeat; r++) {
                for (const key of keys) {
                  await this.dispatchKey(key, sessionId);
                }
              }
              return { result: `Pressed ${keys.join(", ")}${repeat > 1 ? ` \xD7${repeat}` : ""}` };
            }
            case "scroll": {
              const dir = params.scroll_direction ?? "down";
              const amount = Math.min(params.scroll_amount ?? 3, 10) * 100;
              const deltaX = dir === "left" ? -amount : dir === "right" ? amount : 0;
              const deltaY = dir === "up" ? -amount : dir === "down" ? amount : 0;
              await this.sendCommand("Runtime.evaluate", {
                expression: `window.scrollBy(${deltaX}, ${deltaY})`,
                returnByValue: true
              }, sessionId);
              return { result: `Scrolled ${dir} by ${amount}px` };
            }
            case "left_click_drag": {
              const [sx, sy] = params.start_coordinate ?? [0, 0];
              const [ex, ey] = params.coordinate ?? [0, 0];
              await this.sendCommand("Input.dispatchMouseEvent", {
                type: "mousePressed",
                x: sx,
                y: sy,
                button: "left",
                clickCount: 1
              }, sessionId);
              const steps = 10;
              for (let i = 1; i <= steps; i++) {
                const mx = sx + (ex - sx) * (i / steps);
                const my = sy + (ey - sy) * (i / steps);
                await this.sendCommand("Input.dispatchMouseEvent", {
                  type: "mouseMoved",
                  x: mx,
                  y: my,
                  button: "left"
                }, sessionId);
              }
              await this.sendCommand("Input.dispatchMouseEvent", {
                type: "mouseReleased",
                x: ex,
                y: ey,
                button: "left",
                clickCount: 1
              }, sessionId);
              return { result: `Dragged from (${sx},${sy}) to (${ex},${ey})` };
            }
            default:
              return { error: `Unsupported CDP action: ${action}` };
          }
        } catch (err) {
          return { error: `CDP input failed: ${err.message}` };
        }
      }
      /** Parse modifier string like "ctrl+shift" into CDP modifier flags */
      parseModifiers(mods) {
        if (!mods) return {};
        let flags = 0;
        for (const m of mods.toLowerCase().split("+")) {
          if (m === "alt") flags |= 1;
          else if (m === "ctrl" || m === "control") flags |= 2;
          else if (m === "meta" || m === "cmd" || m === "win" || m === "windows") flags |= 4;
          else if (m === "shift") flags |= 8;
        }
        return flags ? { modifiers: flags } : {};
      }
      /** Dispatch a single key press via CDP Input.dispatchKeyEvent */
      async dispatchKey(key, sessionId) {
        const keyMap = {
          enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
          tab: { key: "Tab", code: "Tab", keyCode: 9 },
          escape: { key: "Escape", code: "Escape", keyCode: 27 },
          backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
          delete: { key: "Delete", code: "Delete", keyCode: 46 },
          arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
          arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
          arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
          arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
          home: { key: "Home", code: "Home", keyCode: 36 },
          end: { key: "End", code: "End", keyCode: 35 },
          pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
          pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
          space: { key: " ", code: "Space", keyCode: 32, text: " " }
        };
        if (key.includes("+")) {
          const parts = key.split("+");
          const mainKey = parts.pop();
          let modifiers = 0;
          for (const p of parts) {
            const m = p.toLowerCase();
            if (m === "ctrl" || m === "control") modifiers |= 2;
            else if (m === "shift") modifiers |= 8;
            else if (m === "alt") modifiers |= 1;
            else if (m === "meta" || m === "cmd") modifiers |= 4;
          }
          const mapped2 = keyMap[mainKey.toLowerCase()] ?? { key: mainKey, code: `Key${mainKey.toUpperCase()}`, keyCode: mainKey.charCodeAt(0) };
          await this.sendCommand("Input.dispatchKeyEvent", {
            type: "keyDown",
            ...mapped2,
            modifiers
          }, sessionId);
          await this.sendCommand("Input.dispatchKeyEvent", {
            type: "keyUp",
            ...mapped2,
            modifiers
          }, sessionId);
          return;
        }
        const mapped = keyMap[key.toLowerCase()];
        if (mapped) {
          await this.sendCommand("Input.dispatchKeyEvent", {
            type: "keyDown",
            ...mapped
          }, sessionId);
          if (mapped.text) {
            await this.sendCommand("Input.dispatchKeyEvent", {
              type: "char",
              text: mapped.text,
              key: mapped.key,
              code: mapped.code
            }, sessionId);
          }
          await this.sendCommand("Input.dispatchKeyEvent", {
            type: "keyUp",
            ...mapped
          }, sessionId);
        } else if (key.length === 1) {
          await this.sendCommand("Input.dispatchKeyEvent", {
            type: "keyDown",
            key,
            code: `Key${key.toUpperCase()}`,
            keyCode: key.toUpperCase().charCodeAt(0)
          }, sessionId);
          await this.sendCommand("Input.dispatchKeyEvent", {
            type: "char",
            text: key,
            key
          }, sessionId);
          await this.sendCommand("Input.dispatchKeyEvent", {
            type: "keyUp",
            key,
            code: `Key${key.toUpperCase()}`,
            keyCode: key.toUpperCase().charCodeAt(0)
          }, sessionId);
        }
      }
      /** Check if CDP is connected and ready */
      isAvailable() {
        return this.state === "connected" && this.ws?.readyState === WebSocket.OPEN;
      }
      /** Get status info for /health endpoint */
      getStatus() {
        return {
          state: this.state,
          edgePid: this.edgePid,
          port: CDP_PORT,
          targets: this.cachedTargets.filter((t) => t.type === "page").length
        };
      }
      /** Re-check Edge PID — reconnect if changed (Edge restarted) */
      async recheckPid() {
        try {
          const pidResult = runSync([ADB_PATH, "shell", "pidof", "com.microsoft.emmx.canary"]);
          const pidStr = pidResult.stdout.toString().trim().split(/\s+/)[0];
          const newPid = parseInt(pidStr, 10);
          if (isNaN(newPid)) {
            if (this.state === "connected") {
              log("info", "CDP: Edge no longer running, disconnecting");
              this.cleanup();
            }
            return;
          }
          if (newPid !== this.edgePid && this.state === "connected") {
            log("info", `CDP: Edge PID changed ${this.edgePid} \u2192 ${newPid}, reconnecting`);
            this.cleanup();
            await this.connect();
          }
        } catch {
        }
      }
      /** Clean up CDP connection and ADB forward */
      cleanup() {
        if (this.pidCheckTimer) {
          clearInterval(this.pidCheckTimer);
          this.pidCheckTimer = null;
        }
        if (this.ws) {
          try {
            this.ws.close();
          } catch {
          }
          this.ws = null;
        }
        this.state = "disconnected";
        this.sessionMap.clear();
        this.tabTargetMap.clear();
        this.networkEnabledSessions.clear();
        this.networkEvents.clear();
        this.pending.forEach((p) => {
          clearTimeout(p.timer);
          p.reject(new Error("CDP cleanup"));
        });
        this.pending.clear();
        runSync([ADB_PATH, "forward", "--remove", `tcp:${CDP_PORT}`]);
        log("info", "CDP: cleaned up");
      }
    };
    cdpManager = new CdpManager();
    crc32Table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      crc32Table[i] = c;
    }
    nativeHost = null;
    stdoutDecoder = new NativeMessageDecoder();
    wsClients = /* @__PURE__ */ new Set();
    server = createBridgeServer({
      hostname: WS_HOST,
      port: WS_PORT,
      async fetch(req, upgrade) {
        const url = new URL(req.url);
        if (url.pathname === "/health") {
          return new Response(
            JSON.stringify({
              status: "ok",
              version: BRIDGE_VERSION,
              nativeHost: nativeHost !== null,
              clients: wsClients.size,
              uptime: process.uptime(),
              cdp: cdpManager.getStatus()
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.pathname === "/shutdown" && req.method === "POST") {
          log("info", "Shutdown requested via HTTP");
          setTimeout(() => shutdown(), 200);
          return new Response(
            JSON.stringify({ status: "shutting_down" }),
            { headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.pathname === "/gif" && req.method === "POST") {
          try {
            const body = await req.json();
            const maxW = body.maxWidth ?? 480;
            const delayMs = body.delay ?? 500;
            log("info", `GIF: encoding ${body.frames.length} frames (maxW=${maxW}, delay=${delayMs}ms)`);
            const decodedFrames = [];
            for (const frame of body.frames) {
              const { width, height, rgba } = decodePNG(frame.data);
              const scaled = scalePixels(rgba, width, height, maxW);
              decodedFrames.push(scaled);
            }
            const gifBytes = encodeGIF(decodedFrames, delayMs);
            const gifB64 = Buffer.from(gifBytes).toString("base64");
            log("info", `GIF: encoded ${Math.round(gifBytes.length / 1024)}KB`);
            return new Response(
              JSON.stringify({ gif: `data:image/gif;base64,${gifB64}`, size: gifBytes.length }),
              { headers: { "Content-Type": "application/json" } }
            );
          } catch (err) {
            log("error", `GIF encode failed: ${err.message}`);
            return new Response(
              JSON.stringify({ error: err.message }),
              { status: 500, headers: { "Content-Type": "application/json" } }
            );
          }
        }
        if (url.pathname === "/crop" && req.method === "POST") {
          try {
            const body = await req.json();
            const { width, height, rgba } = decodePNG(body.image);
            const { x: cx, y: cy, width: cw, height: ch } = body.crop;
            const clampX = Math.max(0, Math.min(cx, width - 1));
            const clampY = Math.max(0, Math.min(cy, height - 1));
            const clampW = Math.min(cw, width - clampX);
            const clampH = Math.min(ch, height - clampY);
            const croppedRGBA = cropPixels(rgba, width, height, clampX, clampY, clampW, clampH);
            const pngBuf = encodePNG(croppedRGBA, clampW, clampH);
            const pngB64 = pngBuf.toString("base64");
            return new Response(
              JSON.stringify({ image: `data:image/png;base64,${pngB64}` }),
              { headers: { "Content-Type": "application/json" } }
            );
          } catch (err) {
            return new Response(
              JSON.stringify({ error: err.message }),
              { status: 500, headers: { "Content-Type": "application/json" } }
            );
          }
        }
        if (url.pathname === "/ext/version") {
          return new Response(
            JSON.stringify({ version: BRIDGE_VERSION, manifest: MANIFEST_PATH }),
            { headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.pathname === "/ext/launch" && req.method === "POST") {
          return new Response(
            JSON.stringify({ ok: true, version: BRIDGE_VERSION, pid: process.pid }),
            { headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.pathname === "/ext/crx") {
          try {
            const extDir = (0, import_path.resolve)(SCRIPT_DIR, "edge-claude-ext");
            const pemPath = (0, import_path.resolve)(SCRIPT_DIR, "edge-claude-ext.pem");
            const outPath = (0, import_path.resolve)(SCRIPT_DIR, `claude-code-bridge-v${BRIDGE_VERSION}.crx`);
            const crxExists = await fileExists(outPath);
            let needsBuild = !crxExists;
            if (crxExists) {
              const { statSync } = await import("node:fs");
              const crxMtime = statSync(outPath).mtimeMs;
              for (const name of ["manifest.json", "background.js", "content.js", "popup.html", "popup.js"]) {
                try {
                  const srcMtime = statSync((0, import_path.resolve)(extDir, name)).mtimeMs;
                  if (srcMtime > crxMtime) {
                    needsBuild = true;
                    break;
                  }
                } catch {
                }
              }
            }
            if (needsBuild) {
              const crx3Paths = ["/data/data/com.termux/files/usr/bin/crx3", "crx3"];
              let built = false;
              for (const crx3Bin of crx3Paths) {
                const result = runSync([crx3Bin, extDir, "-o", outPath, "-p", pemPath]);
                if (result.success) {
                  built = true;
                  break;
                }
              }
              if (!built) throw new Error("crx3 not found \u2014 install via: npm i -g crx3-utils");
            }
            if (!await fileExists(outPath)) throw new Error("CRX file not found after build");
            const crxSize = await getFileSize(outPath);
            const crxStream = await createFileStream(outPath);
            log("info", `Serving CRX v${BRIDGE_VERSION} (${Math.round(crxSize / 1024)}KB, rebuilt=${needsBuild})`);
            return new Response(crxStream, {
              headers: {
                "Content-Type": "application/x-chrome-extension",
                "Content-Disposition": `attachment; filename="claude-code-bridge-v${BRIDGE_VERSION}.crx"`,
                "Content-Length": String(crxSize)
              }
            });
          } catch (err) {
            log("error", `CRX build failed: ${err.message}`);
            return new Response(
              JSON.stringify({ error: err.message }),
              { status: 500, headers: { "Content-Type": "application/json" } }
            );
          }
        }
        if (url.pathname === "/test") {
          return new Response(TEST_PAGE_HTML, {
            headers: { "Content-Type": "text/html; charset=utf-8" }
          });
        }
        if (url.pathname === "/ws" || url.pathname === "/") {
          if (BRIDGE_TOKEN) {
            const token = url.searchParams.get("token") ?? req.headers.get("x-bridge-token") ?? "";
            if (token !== BRIDGE_TOKEN) {
              return new Response("Unauthorized", { status: 401 });
            }
          }
          const success = upgrade({ authenticated: true });
          if (success) return void 0;
          return new Response("WebSocket upgrade failed", { status: 500 });
        }
        return new Response("Not Found", { status: 404 });
      },
      websocket: {
        open(ws) {
          log("info", `WS client connected (total: ${wsClients.size + 1})`);
          wsClients.add(ws);
          if (!nativeHost) {
            spawnNativeHost();
          }
          ws.send(
            JSON.stringify({
              type: "bridge_connected",
              version: BRIDGE_VERSION,
              nativeHost: nativeHost !== null
            })
          );
        },
        message(ws, message) {
          const json = typeof message === "string" ? message : Buffer.from(message).toString("utf-8");
          try {
            const parsed = JSON.parse(json);
            log("debug", `WS message type: ${parsed.type}`);
            if (parsed.type === "tool_response" && parsed.result?.result?.tabs) {
              const tabs = parsed.result.result.tabs;
              log("debug", `CDP: caching ${tabs.length} tab URLs from tabs_context_mcp`);
              for (const tab of tabs) {
                if (tab.id && tab.url) {
                  cdpManager.cacheTabUrl(tab.id, tab.url);
                }
              }
            }
            if (parsed.type === "tool_response" && "method" in parsed) {
              delete parsed.method;
              const fixed = JSON.stringify(parsed);
              log("debug", `Stripped method from tool_response: ${fixed.slice(0, 200)}`);
              if (!sendToNativeHost(fixed)) {
                ws.send(JSON.stringify({ type: "error", error: "Native host not available" }));
              }
              return;
            }
            if (!sendToNativeHost(json)) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  error: "Native host not available"
                })
              );
            }
          } catch (err) {
            log("error", "Invalid JSON from WS client:", err);
            ws.send(
              JSON.stringify({
                type: "error",
                error: "Invalid JSON message"
              })
            );
          }
        },
        close(ws) {
          wsClients.delete(ws);
          log("info", `WS client disconnected (remaining: ${wsClients.size})`);
          if (wsClients.size === 0 && nativeHost) {
            log("info", "No clients remaining, stopping native host in 30s");
            setTimeout(() => {
              if (wsClients.size === 0 && nativeHost) {
                log("info", "Stopping native host (no clients)");
                nativeHost.kill();
                nativeHost = null;
              }
            }, 3e4);
          }
        },
        maxPayloadLength: MAX_MESSAGE_SIZE,
        idleTimeout: 120
        // seconds
      }
    });
    setInterval(() => {
      for (const ws of wsClients) {
        try {
          ws.send(JSON.stringify({ type: "heartbeat", timestamp: Date.now() }));
        } catch {
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    log("info", `Claude Chrome Bridge v${BRIDGE_VERSION} started on ws://${WS_HOST}:${WS_PORT}`);
    log("info", `CLI path: ${CLI_PATH}`);
    log("info", `Auth: ${BRIDGE_TOKEN ? "token required" : "open (localhost only)"}`);
    cdpManager.connect().then((ok) => {
      if (ok) log("info", `CDP: ready (${JSON.stringify(cdpManager.getStatus())})`);
      else log("info", "CDP: not available (ADB/Edge not running \u2014 will use extension fallback)");
    });
    log("info", "Waiting for WebSocket connections...");
    adbNotify("cfc-bridge", `CFC Bridge v${BRIDGE_VERSION}`, `Running on :${WS_PORT} (PID ${process.pid})`);
    TEST_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CFC Bridge Test Page</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,system-ui,sans-serif;padding:20px;min-height:100vh}
  h1{font-size:20px;color:#f0f6fc;margin-bottom:4px}
  .sub{font-size:12px;color:#8b949e;margin-bottom:20px}
  .card{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:14px;margin-bottom:12px}
  .card h2{font-size:14px;color:#58a6ff;margin-bottom:8px}
  label{display:block;font-size:12px;color:#8b949e;margin-bottom:4px}
  input,select,textarea{width:100%;padding:8px 10px;border-radius:6px;border:1px solid #30363d;background:#0d1117;color:#c9d1d9;font-size:13px;margin-bottom:8px;font-family:inherit}
  textarea{min-height:60px;resize:vertical}
  button{padding:8px 16px;border-radius:6px;border:1px solid #30363d;background:#21262d;color:#c9d1d9;font-size:12px;cursor:pointer;margin-right:6px;margin-bottom:6px}
  button:hover{background:#30363d}
  button.primary{background:#238636;border-color:#2ea043;color:#fff}
  .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
  .badge.green{background:#23863633;color:#3fb950}
  .badge.blue{background:#388bfd33;color:#58a6ff}
  .badge.yellow{background:#d2992233;color:#d29922}
  #output{font-family:"SF Mono",monospace;font-size:11px;background:#010409;border:1px solid #21262d;border-radius:6px;padding:10px;max-height:200px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;color:#7ee787}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .grid .card{margin-bottom:0}
  .stat{font-size:24px;font-weight:700;color:#f0f6fc;font-family:monospace}
  .stat-label{font-size:10px;color:#8b949e;text-transform:uppercase}
  a{color:#58a6ff;text-decoration:none}
  a:hover{text-decoration:underline}
</style>
</head>
<body>
<h1>CFC Bridge Test Page</h1>
<p class="sub">Interactive test surface for Claude in Chrome tools &mdash; served from bridge at 127.0.0.1:${WS_PORT}</p>

<div class="grid">
  <div class="card"><div class="stat" id="clock">--:--:--</div><div class="stat-label">Live Clock</div></div>
  <div class="card"><div class="stat" id="counter">0</div><div class="stat-label">Click Counter</div></div>
</div>

<div class="card">
  <h2>Form Elements</h2>
  <label for="name-input">Name</label>
  <input id="name-input" type="text" placeholder="Enter your name..." value="">
  <label for="email-input">Email</label>
  <input id="email-input" type="email" placeholder="user@example.com" value="">
  <label for="color-select">Favorite Color</label>
  <select id="color-select">
    <option value="">Select...</option>
    <option value="red">Red</option>
    <option value="green">Green</option>
    <option value="blue">Blue</option>
    <option value="purple">Purple</option>
  </select>
  <label for="notes-textarea">Notes</label>
  <textarea id="notes-textarea" placeholder="Type notes here..."></textarea>
  <label><input type="checkbox" id="agree-checkbox"> I agree to the terms</label>
</div>

<div class="card">
  <h2>Interactive Elements</h2>
  <button class="primary" id="btn-increment" onclick="increment()">Increment Counter</button>
  <button id="btn-reset" onclick="resetCounter()">Reset</button>
  <button id="btn-timestamp" onclick="addTimestamp()">Add Timestamp</button>
  <button id="btn-toggle" onclick="toggleTheme()">Toggle Theme</button>
  <div style="margin-top:8px">
    <span class="badge green">Connected</span>
    <span class="badge blue">v1.0</span>
    <span class="badge yellow">Test Mode</span>
  </div>
</div>

<div class="card">
  <h2>Output Console</h2>
  <div id="output">Ready for testing...</div>
</div>

<div class="card">
  <h2>Navigation Links</h2>
  <a href="#section-top" id="link-top">Back to top</a> &middot;
  <a href="http://127.0.0.1:${WS_PORT}/health" id="link-health">Bridge Health</a> &middot;
  <a href="http://127.0.0.1:${WS_PORT}/test" id="link-reload">Reload Test Page</a>
</div>

<script>
  let count = 0;
  function increment() { count++; document.getElementById('counter').textContent = count; log('Counter: ' + count); }
  function resetCounter() { count = 0; document.getElementById('counter').textContent = 0; log('Counter reset'); }
  function addTimestamp() { log('Timestamp: ' + new Date().toISOString()); }
  function toggleTheme() {
    const b = document.body;
    const isDark = b.style.background !== 'white';
    b.style.background = isDark ? 'white' : '#0d1117';
    b.style.color = isDark ? '#1a1a1a' : '#c9d1d9';
    log('Theme: ' + (isDark ? 'light' : 'dark'));
  }
  function log(msg) {
    const el = document.getElementById('output');
    el.textContent += '\\n' + msg;
    el.scrollTop = el.scrollHeight;
  }
  setInterval(() => {
    document.getElementById('clock').textContent = new Date().toTimeString().slice(0, 8);
  }, 1000);
  document.getElementById('clock').textContent = new Date().toTimeString().slice(0, 8);
</script>
</body>
</html>`;
  }
});

// src/cli.ts
init_import_meta_shim();
var import_path2 = require("path");
var import_fs = require("fs");
var PKG_VERSION = (() => {
  try {
    const dir = typeof __dirname !== "undefined" ? __dirname : (0, import_path2.dirname)(new URL(import_meta_url).pathname);
    const pkgPath = (0, import_path2.resolve)(dir, "../package.json");
    return JSON.parse((0, import_fs.readFileSync)(pkgPath, "utf-8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
var WS_PORT2 = parseInt(process.env.BRIDGE_PORT ?? "18963", 10);
var WS_HOST2 = "127.0.0.1";
var HEALTH_URL = `http://${WS_HOST2}:${WS_PORT2}/health`;
var SHUTDOWN_URL = `http://${WS_HOST2}:${WS_PORT2}/shutdown`;
async function fetchWithTimeout(url, opts = {}) {
  const { timeout = 3e3, ...fetchOpts } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...fetchOpts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
async function isBridgeAlive() {
  try {
    const res = await fetchWithTimeout(HEALTH_URL, { timeout: 2e3 });
    return res.ok;
  } catch {
    return false;
  }
}
function cmdVersion() {
  console.log(`claude-chrome-android v${PKG_VERSION}`);
}
function cmdHelp() {
  console.log(`
claude-chrome-android v${PKG_VERSION}
CFC Bridge \u2014 connects Claude Code CLI to Chrome/Edge on Android via WebSocket

Usage:
  claude-chrome-android              Start the bridge server
  claude-chrome-android --stop       Stop a running bridge
  claude-chrome-android --setup      Create ~/bin/termux-url-opener + verify deps
  claude-chrome-android --version    Print version
  claude-chrome-android --help       Show this help

Environment variables:
  BRIDGE_PORT       WebSocket port (default: 18963)
  BRIDGE_TOKEN      Optional shared secret for auth
  BRIDGE_LOG_LEVEL  Log level: debug|info|warn|error (default: info)
`.trim());
}
async function cmdStop() {
  console.log("Stopping bridge...");
  try {
    const res = await fetchWithTimeout(SHUTDOWN_URL, { method: "POST", timeout: 3e3 });
    if (res.ok) {
      console.log("Shutdown request accepted");
    }
  } catch {
  }
  await new Promise((r) => setTimeout(r, 800));
  if (await isBridgeAlive()) {
    console.log("Bridge didn't stop gracefully, attempting pkill...");
    const { spawnSync: spawnSync2 } = await import("child_process");
    const result = spawnSync2("pkill", ["-f", "(bun|node).*claude-chrome"], {
      stdio: "ignore"
    });
    await new Promise((r) => setTimeout(r, 500));
    if (await isBridgeAlive()) {
      console.error("Bridge is still running. Kill manually: pkill -f claude-chrome-bridge");
      process.exit(1);
    }
    console.log("Bridge killed via pkill");
  } else {
    console.log("Bridge stopped");
  }
}
async function cmdSetup() {
  console.log(`claude-chrome-android v${PKG_VERSION} \u2014 setup
`);
  const isTermux = (0, import_fs.existsSync)("/data/data/com.termux/files/usr/bin/bash");
  if (!isTermux) {
    console.warn("Warning: This doesn't look like Termux. Setup is designed for Android/Termux.\n");
  }
  console.log(`Runtime: Node.js ${process.version}`);
  const { spawnSync: spawnSync2 } = await import("child_process");
  const bunCheck = spawnSync2("bun", ["--version"], { stdio: "pipe", encoding: "utf-8" });
  if (bunCheck.status === 0) {
    console.log(`Bun: ${bunCheck.stdout.trim()} (will prefer bun for performance)`);
  } else {
    console.log("Bun: not found (will use Node.js)");
  }
  const claudeCheck = spawnSync2("which", ["claude"], { stdio: "pipe", encoding: "utf-8" });
  if (claudeCheck.status === 0) {
    console.log(`Claude CLI: ${claudeCheck.stdout.trim()}`);
  } else {
    console.warn("Warning: Claude Code CLI not found. Install with: npm i -g @anthropic-ai/claude-code");
  }
  const binDir = (0, import_path2.resolve)(process.env.HOME ?? "/data/data/com.termux/files/home", "bin");
  if (!(0, import_fs.existsSync)(binDir)) {
    (0, import_fs.mkdirSync)(binDir, { recursive: true });
    console.log(`
Created ${binDir}/`);
  }
  const urlOpenerPath = (0, import_path2.resolve)(binDir, "termux-url-opener");
  const urlOpenerExists = (0, import_fs.existsSync)(urlOpenerPath);
  const urlOpenerScript = `#!/data/data/com.termux/files/usr/bin/bash
# termux-url-opener \u2014 handles URLs shared to Termux via Android share menu
# Called by TermuxFileReceiverActivity with the shared URL as $1
#
# Generated by: claude-chrome-android --setup v${PKG_VERSION}
# NOTE: TermuxFileReceiverActivity runs this in a terminal session managed by
# TermuxService. When the script exits, the session closes and SIGHUP is sent
# to the process group. We use setsid to escape the process group.

set -euo pipefail

url="\${1:-}"

# Debug log
echo "[$(date +%H:%M:%S)] termux-url-opener: $url" >> "$PREFIX/tmp/url-opener.log"

case "$url" in
  *cfcbridge*/start*)
    # CFC bridge deep-link from the Chrome/Edge extension
    BRIDGE_LOG="$PREFIX/tmp/bridge.log"

    if pgrep -f "(bun|node).*claude-chrome" > /dev/null 2>&1; then
      echo "[$(date +%H:%M:%S)] bridge already running" >> "$PREFIX/tmp/url-opener.log"
      exit 0
    fi

    # Prefer bun (faster startup), fallback to node
    RUNTIME=""
    if [[ -x "$HOME/.bun/bin/bun" ]]; then
      RUNTIME="$HOME/.bun/bin/bun"
    elif command -v bun > /dev/null 2>&1; then
      RUNTIME="$(command -v bun)"
    elif command -v node > /dev/null 2>&1; then
      RUNTIME="$(command -v node)"
    fi

    if [[ -z "$RUNTIME" ]]; then
      echo "[$(date +%H:%M:%S)] ERROR: neither bun nor node found" >> "$PREFIX/tmp/url-opener.log"
      exit 1
    fi

    # Find the bridge script \u2014 check npx cache, repo checkout, or run via npx
    BRIDGE_SCRIPT=""
    # 1. Local repo checkout
    if [[ -f "$HOME/git/termux-tools/claude-chrome-bridge.ts" ]]; then
      BRIDGE_SCRIPT="$HOME/git/termux-tools/claude-chrome-bridge.ts"
    fi
    # 2. npm global install (bunx or npx)
    NPM_GLOBAL="$HOME/.npm/lib/node_modules/claude-chrome-android/dist/cli.js"
    BUN_GLOBAL="$HOME/.bun/install/global/node_modules/claude-chrome-android/dist/cli.js"
    if [[ -z "$BRIDGE_SCRIPT" && -f "$NPM_GLOBAL" ]]; then
      BRIDGE_SCRIPT="$NPM_GLOBAL"
    elif [[ -z "$BRIDGE_SCRIPT" && -f "$BUN_GLOBAL" ]]; then
      BRIDGE_SCRIPT="$BUN_GLOBAL"
    fi

    if [[ -n "$BRIDGE_SCRIPT" ]]; then
      # setsid creates a new session leader \u2014 the child process survives when
      # TermuxService kills this session's process group on script exit
      setsid nohup "$RUNTIME" "$BRIDGE_SCRIPT" > "$BRIDGE_LOG" 2>&1 &
      echo "[$(date +%H:%M:%S)] bridge started PID=$!" >> "$PREFIX/tmp/url-opener.log"
    else
      # Fallback: use npx to download and run on the fly
      setsid nohup npx claude-chrome-android > "$BRIDGE_LOG" 2>&1 &
      echo "[$(date +%H:%M:%S)] bridge started via npx PID=$!" >> "$PREFIX/tmp/url-opener.log"
    fi
    exit 0
    ;;

  *)
    # Default: open URL in browser
    if command -v termux-open-url > /dev/null 2>&1; then
      termux-open-url "$url"
    elif command -v xdg-open > /dev/null 2>&1; then
      xdg-open "$url"
    fi
    ;;
esac
`;
  if (urlOpenerExists) {
    const existing = (0, import_fs.readFileSync)(urlOpenerPath, "utf-8");
    if (existing.includes("cfcbridge")) {
      const backupPath = `${urlOpenerPath}.bak`;
      (0, import_fs.writeFileSync)(backupPath, existing);
      console.log(`
Backed up existing url-opener to ${backupPath}`);
    }
  }
  (0, import_fs.writeFileSync)(urlOpenerPath, urlOpenerScript);
  (0, import_fs.chmodSync)(urlOpenerPath, 493);
  console.log(`${urlOpenerExists ? "Updated" : "Created"} ${urlOpenerPath}`);
  console.log(`
Setup complete!

Next steps:
  1. Install the CRX extension in Chrome/Edge on your phone
  2. Start the bridge:  npx claude-chrome-android
  3. Or use the extension's "Launch Bridge" button (shares to Termux)

The bridge runs on ws://${WS_HOST2}:${WS_PORT2} and connects
Claude Code CLI to your browser via the Chrome extension.
`);
}
async function cmdStart() {
  if (await isBridgeAlive()) {
    console.log(`Bridge is already running on ws://${WS_HOST2}:${WS_PORT2}`);
    console.log("Use --stop to stop it first, or --help for more options.");
    process.exit(0);
  }
  console.log(`Starting CFC Bridge v${PKG_VERSION} on ws://${WS_HOST2}:${WS_PORT2}...`);
  try {
    await Promise.resolve().then(() => (init_claude_chrome_bridge(), claude_chrome_bridge_exports));
  } catch (err) {
    console.error("Failed to start bridge:", err.message);
    console.error("\nIf you installed via npm, the bridge should be bundled in this file.");
    console.error("Try rebuilding: cd bridge && node build.js");
    process.exit(1);
  }
}
var args = process.argv.slice(2);
var command = args[0] ?? "";
switch (command) {
  case "--version":
  case "-v":
    cmdVersion();
    break;
  case "--help":
  case "-h":
    cmdHelp();
    break;
  case "--stop":
    cmdStop();
    break;
  case "--setup":
    cmdSetup();
    break;
  case "":
    cmdStart();
    break;
  default:
    console.error(`Unknown option: ${command}`);
    cmdHelp();
    process.exit(1);
}
