#!/data/data/com.termux/files/usr/bin/node
// threads-dl — download videos (and image fallback) from public threads.com /
// threads.net posts. yt-dlp and gallery-dl have NO Threads extractor; Threads
// also serves anonymous browser/API clients a JS login wall with no media.
//
// How it works: Meta server-renders the full post — CDN media URLs and all —
// into the page's embedded JSON for link-preview crawlers. We fetch with a
// Googlebot UA to bypass the login wall, parse the `application/json` blobs,
// and pick the post whose shortcode (`code`) matches the URL.
//
// Selecting by shortcode is essential: a post page embeds MANY posts (thread
// items, replies, recommendations). Taking "the first video on the page"
// silently downloads an unrelated stranger's clip.
//
// Usage:
//   threads-dl <url> [-o DIR] [--json] [-q] [-h]
//     <url>      a threads.com/threads.net post or /share/<code>/ link
//     -o, --out  output directory (default: ~/storage/shared/Download, else CWD)
//     --json     print the resolved media metadata as JSON and exit
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
const FETCH_TIMEOUT_MS = 45_000;

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
if (!url) { help(); process.exit(2); }

function help() {
  console.log(
    "threads-dl <url> [-o DIR] [--json] [-q]\n" +
      "  Download video(s) from a public Threads post.\n" +
      "  -o/--out DIR   output directory (default ~/storage/shared/Download)\n" +
      "  --json         print resolved media metadata and exit\n" +
      "  -q/--quiet     only print saved file paths",
  );
}
function die(msg) { console.error(`threads-dl: ${msg}`); process.exit(2); }
function log(...a) { if (!opt.quiet) console.error(...a); }

// ---- fetch -----------------------------------------------------------------
async function fetchWithTimeout(u, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(u, { headers, redirect: "follow", signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPage(u) {
  const res = await fetchWithTimeout(u, {
    "user-agent": CRAWLER_UA,
    "accept-language": "en-US,en;q=0.9",
  });
  return { status: res.status, html: await res.text() };
}

// ---- embedded-JSON parsing --------------------------------------------------
const MEDIA_KEYS = ["video_versions", "video_dash_manifest", "image_versions2", "carousel_media"];

/** Recursively gather every media-bearing post object out of parsed JSON. */
function collectPosts(obj, out) {
  if (Array.isArray(obj)) {
    for (const v of obj) collectPosts(v, out);
  } else if (obj && typeof obj === "object") {
    if (obj.code && MEDIA_KEYS.some((k) => k in obj)) out.push(obj);
    for (const v of Object.values(obj)) collectPosts(v, out);
  }
}

function extractPosts(html) {
  const posts = [];
  const re = /<script type="application\/json"[^>]*>(.*?)<\/script>/gs;
  for (const m of html.matchAll(re)) {
    try {
      collectPosts(JSON.parse(m[1]), posts);
    } catch {
      // Pages carry unrelated JSON blobs; a parse failure in one is normal.
    }
  }
  return posts;
}

/** Decode the CDN URL's base64 `efg` param — the only source of duration. */
function efgInfo(u) {
  try {
    const efg = new URL(u).searchParams.get("efg");
    return efg ? JSON.parse(Buffer.from(efg, "base64url").toString("utf8")) : {};
  } catch {
    return {};
  }
}

/** Deduped progressive mp4 URLs for one media object (post or carousel item). */
function videosOf(media) {
  const seen = new Set();
  const out = [];
  for (const v of media?.video_versions || []) {
    const u = v?.url;
    if (typeof u !== "string") continue;
    const path = u.split("?")[0];
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(u);
  }
  return out;
}

function bestImage(media) {
  const candidates = media?.image_versions2?.candidates || [];
  let best = null;
  for (const c of candidates) {
    if (typeof c?.url !== "string") continue;
    if (!best || (c.width || 0) * (c.height || 0) > (best.width || 0) * (best.height || 0)) best = c;
  }
  return best?.url || null;
}

// ---- resolve the post -------------------------------------------------------
const page = await fetchPage(url);
if (page.status !== 200) die(`page returned HTTP ${page.status}`);

// Target shortcode: canonical URLs carry it; /share/ and /t/ links reveal it
// only through the canonical og:url on the rendered page.
const ogUrl = page.html.match(/property="og:url"\s+content="([^"]+)"/)?.[1] || "";
const targetCode =
  url.match(/\/post\/([\w-]+)/)?.[1] ||
  url.match(/\/t\/([\w-]+)/)?.[1] ||
  ogUrl.match(/\/post\/([\w-]+)/)?.[1] ||
  null;

const posts = extractPosts(page.html);
let post;
if (targetCode) {
  post = posts.find((p) => p.code === targetCode);
  if (!post) {
    // Never fall back here: the page is full of unrelated recommended posts,
    // and picking one silently yields the wrong video.
    die(
      `post "${targetCode}" was not found in the page data. It may be deleted, ` +
        "private, login-gated, or Threads changed its layout.",
    );
  }
} else {
  post = posts.find((p) => videosOf(p).length || p.video_dash_manifest);
  if (!post) die("no video post found on this page.");
  log("warning: could not determine which post this link points to; using the " +
      "first video on the page. Pass the canonical @user/post/<id> URL to be sure.");
}

// Carousel posts hold their media in child objects.
const carousel = Array.isArray(post.carousel_media) ? post.carousel_media : null;
const mediaItems = carousel?.length ? carousel : [post];
const videos = mediaItems.flatMap(videosOf);
const image = bestImage(mediaItems[0]) || bestImage(post);

if (!videos.length && !image) {
  die("no media found in this post (text-only posts are not supported).");
}

const code = post.code || targetCode || "post";
const handle = post.user?.username || url.match(/@([A-Za-z0-9_.]+)/)?.[1] || "threads";
const duration = efgInfo(videos[0] || "").duration_s ?? null;

if (opt.json) {
  console.log(JSON.stringify({
    url, code, uploader: handle, duration,
    width: post.original_width ?? null, height: post.original_height ?? null,
    caption: post.caption?.text ?? null,
    videos, image,
  }, null, 2));
  process.exit(0);
}

// ---- output dir -------------------------------------------------------------
let outDir = opt.out;
if (!outDir) {
  const shared = join(homedir(), "storage", "shared", "Download");
  outDir = existsSync(shared) ? shared : process.cwd();
}
mkdirSync(outDir, { recursive: true });

// ---- download ---------------------------------------------------------------
async function download(u, dest) {
  const res = await fetchWithTimeout(u, {
    "user-agent": BROWSER_UA,
    referer: "https://www.threads.com/",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

const base = `${handle} - ${code}`;
const targets = videos.length
  ? videos.map((u, i) => ({
      u,
      dest: join(outDir, videos.length > 1 ? `${base} [${i + 1}].mp4` : `${base}.mp4`),
    }))
  : [{ u: image, dest: join(outDir, `${base}.jpg`) }];

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
