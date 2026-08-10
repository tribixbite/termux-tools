#!/data/data/com.termux/files/usr/bin/node
// threads-dl — download videos (and image fallback) from public threads.com /
// threads.net posts. yt-dlp and gallery-dl have NO Threads extractor; Threads
// also serves anonymous browser/API clients a JS login wall with no media.
//
// How it works: Meta server-renders the full post (with CDN media URLs in an
// embedded JSON blob) for link-preview crawlers. We fetch with a Googlebot UA
// to bypass the login wall, pull the video URL(s) out of the JSON, and stream
// them to disk. CDN URLs are short-lived (`oe=` epoch), so we always re-fetch.
//
// Usage:
//   threads-dl <url> [-o DIR] [--json] [-q] [-h]
//     <url>      a threads.com/threads.net post or /share/<code>/ link
//     -o, --out  output directory (default: ~/storage/shared/Download, else CWD)
//     --json     print the resolved media URLs as JSON and exit (no download)
//     -q         quiet (only print saved file paths)
//     -h/--help  this help
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CRAWLER_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ---- arg parsing -----------------------------------------------------------
const argv = process.argv.slice(2);
const opt = { out: null, json: false, quiet: false };
let url = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") { help(); process.exit(0); }
  else if (a === "--json") opt.json = true;
  else if (a === "-q" || a === "--quiet") opt.quiet = true;
  else if (a === "-o" || a === "--out") opt.out = argv[++i];
  else if (a.startsWith("-")) die(`unknown option: ${a}`);
  else if (!url) url = a;
  else die(`unexpected argument: ${a}`);
}
if (!url) { help(); process.exit(url ? 0 : 2); }

function help() {
  console.log(
    "threads-dl <url> [-o DIR] [--json] [-q]\n" +
      "  Download video(s) from a public Threads post.\n" +
      "  -o/--out DIR   output directory (default ~/storage/shared/Download)\n" +
      "  --json         print resolved media URLs and exit\n" +
      "  -q/--quiet     only print saved file paths",
  );
}
function die(msg) { console.error(`threads-dl: ${msg}`); process.exit(2); }
function log(...a) { if (!opt.quiet) console.error(...a); }

const unesc = (s) =>
  s.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
const uniq = (arr) => [...new Set(arr)];

// ---- fetch the server-rendered post HTML (crawler UA de-walls it) ----------
async function fetchPage(u) {
  const res = await fetch(u, {
    headers: { "user-agent": CRAWLER_UA, "accept-language": "en-US,en;q=0.9" },
    redirect: "follow",
  });
  return { status: res.status, html: await res.text(), finalUrl: res.url };
}

// Pull the canonical @user/post/<id> permalink from a page (for /share/ links).
function canonicalFrom(html) {
  const m =
    html.match(/property="og:url"\s+content="([^"]+)"/) ||
    html.match(/"permalink":"(https:[^"]+?\/post\/[^"]+?)"/) ||
    html.match(/(https:\\?\/\\?\/www\.threads\.(?:com|net)\/@[^"\\]+?\/post\/[A-Za-z0-9_-]+)/);
  return m ? unesc(m[1]).split("?")[0] : null;
}

// Extract video URLs (HD preferred) and an image fallback from post JSON.
function extractMedia(html) {
  const grabAll = (re) => uniq([...html.matchAll(re)].map((m) => unesc(m[1])));
  const hd = uniq([
    ...grabAll(/"playable_url_quality_hd":"(https:[^"]+?)"/g),
    ...grabAll(/"browser_native_hd_url":"(https:[^"]+?)"/g),
  ]);
  const sd = uniq([
    ...grabAll(/"playable_url":"(https:[^"]+?)"/g),
    ...grabAll(/"browser_native_sd_url":"(https:[^"]+?)"/g),
  ]);
  let videos = hd.length ? hd : sd;
  if (!videos.length) videos = grabAll(/"url":"(https:\\?\/\\?\/[^"]+?\.mp4[^"]*?)"/g);
  const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/);
  const image = ogImage ? unesc(ogImage[1]) : null;
  return { videos: uniq(videos), image };
}

// ---- resolve the post & its media ------------------------------------------
let page = await fetchPage(url);
if (page.status !== 200) die(`page returned HTTP ${page.status}`);

let media = extractMedia(page.html);
// /share/<code>/ (or any link without media) → follow canonical once.
if (!media.videos.length) {
  const canon = canonicalFrom(page.html);
  if (canon && canon !== url.split("?")[0]) {
    log(`resolving canonical: ${canon}`);
    page = await fetchPage(canon);
    if (page.status === 200) { url = canon; media = extractMedia(page.html); }
  }
}

if (!media.videos.length && !media.image) {
  die(
    "no media found. Post may be private/login-only, deleted, or the page " +
      "layout changed. (Anonymous Threads pages are login-walled; this tool " +
      "relies on the crawler-rendered version still exposing media.)",
  );
}

if (opt.json) {
  console.log(JSON.stringify({ url, ...media }, null, 2));
  process.exit(0);
}

// ---- derive a base filename from @handle + post id -------------------------
// Prefer the canonical permalink in the page — a /share/<code>/ input URL has
// no @handle or /post/<id>, but the crawler-rendered HTML always carries it.
const permalink = canonicalFrom(page.html) || url;
const idm = permalink.match(/\/post\/([A-Za-z0-9_-]+)/) || url.match(/\/post\/([A-Za-z0-9_-]+)/);
// Handle: from an @user in the permalink/input, else from og:title "(@handle)".
const um =
  permalink.match(/@([A-Za-z0-9_.]+)/) ||
  url.match(/@([A-Za-z0-9_.]+)/) ||
  // og:title is "Display Name (@handle) on Threads" but the @ is often the
  // HTML entity &#064; / &#64; / &commat; — accept any of those.
  page.html.match(
    /property="og:title"\s+content="[^"]*\((?:@|&#0*64;|&commat;)([A-Za-z0-9_.]+)\)/,
  );
const base = `${um ? um[1] : "threads"} - ${idm ? idm[1] : "post"}`;

// ---- pick output dir --------------------------------------------------------
let outDir = opt.out;
if (!outDir) {
  const shared = join(homedir(), "storage", "shared", "Download");
  outDir = existsSync(shared) ? shared : process.cwd();
}
mkdirSync(outDir, { recursive: true });

// ---- download ---------------------------------------------------------------
async function download(u, dest) {
  const res = await fetch(u, {
    headers: { "user-agent": BROWSER_UA, referer: "https://www.threads.com/" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

const targets =
  media.videos.length
    ? media.videos.map((u, i) => ({
        u,
        dest: join(outDir, media.videos.length > 1 ? `${base} [${i + 1}].mp4` : `${base}.mp4`),
      }))
    : [{ u: media.image, dest: join(outDir, `${base}.jpg`) }];

let failures = 0;
for (const { u, dest } of targets) {
  try {
    log(`↓ ${dest.split("/").pop()}`);
    await download(u, dest);
    console.log(dest);
  } catch (e) {
    failures++;
    console.error(`threads-dl: failed ${dest}: ${e.message}`);
  }
}
process.exit(failures ? 1 : 0);
