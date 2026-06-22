#!/usr/bin/env bun
/**
 * git-history-recover — recover overwritten / dangling / force-pushed history
 * from any public GitHub repository.
 *
 * A normal clone only returns commits reachable from the live refs. History that
 * was force-pushed away (rebase, `filter-repo`, squash, "clean up history") is
 * orphaned and invisible to `git clone`. This tool reconstructs it from three
 * independent sources, none of which require admin access to the repo:
 *
 *   1. GitHub Events API — retains the full PushEvent timeline (before/head SHAs)
 *      for ~90 days / 300 events. This is the authoritative force-push record.
 *   2. The fork network — forks share GitHub's object store; forks created before
 *      a rewrite still point at the pre-rewrite tips.
 *   3. Direct fetch-by-SHA — GitHub honours `git fetch origin <sha>` for any
 *      object still in the network repository, even if no ref points at it
 *      (recovers commits that were force-pushed away and never forked).
 *
 * Default run = read-only analysis (prints the oldest overwritten commit, the
 * force-push timeline, and any unrecoverable SHAs). Pass --recover to also
 * materialise a browsable repo with a named ref on every recovered tip.
 *
 * Usage:
 *   git-history-recover <owner/repo | github-url> [flags]
 *
 * It can also scan EVERY blob across the whole recovered history (current +
 * overwritten + dangling, and inside zip archives) for committed secrets — keys,
 * tokens, PEM private keys, Solana keypairs (numeric byte arrays AND base58
 * secret keys), and BIP39 mnemonics (checksum-validated). Use this to verify a
 * private repo has no secrets — anywhere in its history — before making it public.
 *
 * Flags:
 *   --recover            Persist a recovery repo with labelled refs/recovered/*.
 *   --dir <path>         Output dir for the recovery repo (default: ./<repo>-recovered).
 *   --keep               In analyze mode, keep the temp working repo instead of deleting it.
 *   --no-forks           Skip fork enumeration/fetch (events + SHA recovery only; faster).
 *   --secrets            Scan all history (incl. overwritten/dangling + zip contents) for secrets.
 *   --show-secrets       Print matched secret values in full instead of masked previews.
 *   --no-archives        With --secrets, do not extract & scan zip archives.
 *   --max-blob <MB>      With --secrets, skip blobs larger than this (default 2).
 *   --fail-on <level>    Exit non-zero (2) if a finding at >= level is found:
 *                        high | medium (default) | low | none.
 *   --token <tok>        GitHub token (else $GH_TOKEN / $GITHUB_TOKEN / `gh auth token`).
 *   --json               Emit machine-readable JSON instead of the human report.
 *   -h, --help           Show help.
 *
 * Requires: git, bun. Optional: gh (token source), unzip (archive scanning),
 * and a sibling bip39-english.txt (mnemonic checksum validation).
 */

import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, realpathSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single push recorded by the GitHub Events API. */
interface PushRecord {
  time: string;
  ref: string;
  before: string;
  head: string;
  commits: string[];
}

/** A force-push (non-fast-forward) row in the rendered timeline. */
interface ForcePush extends PushRecord {
  force: boolean | null; // null = couldn't determine (before object missing)
  beforePresent: boolean;
  headPresent: boolean;
}

interface CommitMeta {
  sha: string;
  epoch: number;
  author: string;
  subject: string;
}

type Confidence = "high" | "medium" | "low";

/** One secret-scan hit. `value` is masked for display unless --show-secrets. */
interface Finding {
  category: string;
  confidence: Confidence;
  blob: string;            // blob object id the secret was found in
  path: string;            // a repo path that blob is/was stored at
  inCurrentTree: boolean;  // false => only exists in overwritten/old history
  archiveEntry?: string;   // entry path inside a zip, when applicable
  line: number;            // 1-based line within the blob/entry
  value: string;           // raw matched text (masked at print time)
}

interface SecretScan {
  scannedBlobs: number;
  skippedBinary: number;
  skippedLarge: number;
  archivesScanned: number;
  findings: Finding[];
}

interface Report {
  repo: string;
  defaultBranch: string;
  defaultTip: string | null;
  createdAt: string;
  forks: number;
  events: { pushCount: number; earliest: string | null; latest: string | null; fullCoverage: boolean };
  forcePushes: ForcePush[];
  commits: { total: number; mainline: number; overwritten: number };
  oldestOverwritten: CommitMeta | null;
  oldestTies: string[];
  roots: string[];
  unrecovered: string[];
  recoveredDir: string | null;
  recoveredRefs: { ref: string; sha: string; subject: string }[];
  secrets: SecretScan | null;
}

const ZERO_SHA = "0000000000000000000000000000000000000000";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const flags = {
    recover: false,
    keep: false,
    noForks: false,
    json: false,
    secrets: false,
    showSecrets: false,
    noArchives: false,
    maxBlobMb: 2,
    failOn: "medium" as "high" | "medium" | "low" | "none",
    dir: "" as string,
    token: "" as string,
    repo: "" as string,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      case "--recover": flags.recover = true; break;
      case "--keep": flags.keep = true; break;
      case "--no-forks": flags.noForks = true; break;
      case "--json": flags.json = true; break;
      case "--secrets": flags.secrets = true; break;
      case "--show-secrets": flags.showSecrets = true; break;
      case "--no-archives": flags.noArchives = true; break;
      case "--max-blob": flags.maxBlobMb = Number(argv[++i]) || 2; break;
      case "--fail-on": {
        const v = argv[++i];
        if (v !== "high" && v !== "medium" && v !== "low" && v !== "none") fail(`--fail-on must be high|medium|low|none`);
        flags.failOn = v;
        break;
      }
      case "--dir": flags.dir = argv[++i] ?? ""; break;
      case "--token": flags.token = argv[++i] ?? ""; break;
      default:
        if (a.startsWith("-")) fail(`unknown flag: ${a}`);
        else if (!flags.repo) flags.repo = a;
        else fail(`unexpected argument: ${a}`);
    }
  }
  if (!flags.repo) { printHelp(); process.exit(1); }
  return flags;
}

function printHelp() {
  // The module doc-comment above is the canonical reference; keep this terse.
  console.log(`git-history-recover <owner/repo | github-url> [flags]

  --recover            persist a recovery repo with labelled refs/recovered/*
  --dir PATH           output dir for the recovery repo
  --keep               keep the temp analyze repo instead of deleting it
  --no-forks           skip forks (events + fetch-by-SHA recovery only; faster)
  --secrets            scan ALL history (incl. overwritten/dangling + zips) for secrets
  --show-secrets       print matched secrets in full (default: masked)
  --no-archives        with --secrets, don't extract/scan zip archives
  --max-blob MB        with --secrets, skip blobs larger than MB (default 2)
  --fail-on LEVEL      exit 2 if finding >= high|medium(default)|low|none
  --token TOK          GitHub token (else \$GH_TOKEN/\$GITHUB_TOKEN/gh auth token)
  --json               machine-readable output

Recovers overwritten/force-pushed/dangling commits from a GitHub repo, and
(with --secrets) scans the entire recovered history for committed secrets.`);
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

/** Accepts owner/repo, https://github.com/owner/repo[.git], or git@github.com:owner/repo. */
function parseRepoSlug(input: string): { owner: string; repo: string; slug: string } {
  let s = input.trim();
  s = s.replace(/^git@github\.com:/, "").replace(/^https?:\/\/github\.com\//, "");
  s = s.replace(/\.git$/, "").replace(/\/+$/, "");
  const m = s.match(/^([^/]+)\/([^/]+)/);
  if (!m) fail(`could not parse "${input}" as owner/repo`);
  return { owner: m[1], repo: m[2], slug: `${m[1]}/${m[2]}` };
}

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

let REPO_DIR = "";

/** Temp working dir to remove on exit (analyze mode). null once persisted/cleaned. */
let CLEANUP_DIR: string | null = null;
process.on("exit", () => {
  if (CLEANUP_DIR) try { rmSync(CLEANUP_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
});

/** Run git in REPO_DIR (or opts.cwd). Never throws unless check=true. */
function git(args: string[], opts: { cwd?: string; check?: boolean } = {}) {
  const p = Bun.spawnSync(["git", ...args], {
    cwd: opts.cwd ?? REPO_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = p.stdout.toString().trim();
  const err = p.stderr.toString().trim();
  if (opts.check && p.exitCode !== 0) throw new Error(`git ${args.join(" ")}\n${err}`);
  return { ok: p.exitCode === 0, out, err };
}

/** GitHub token used for git network ops, embedded via x-access-token Basic auth. */
let TOKEN = "";

/**
 * Rewrite a github.com https URL to carry the token as `x-access-token:<tok>@`.
 * This is GitHub's universal HTTPS git auth (works for public AND private repos,
 * and authed fetches maximise fetch-by-SHA recovery). No-op when no token.
 */
function netUrl(u: string): string {
  if (!TOKEN) return u;
  return u.replace(/^https:\/\/github\.com\//, `https://x-access-token:${TOKEN}@github.com/`);
}

function objectExists(sha: string): boolean {
  return git(["cat-file", "-e", `${sha}^{commit}`]).ok;
}

// ---------------------------------------------------------------------------
// GitHub API helpers (direct fetch — no gh dependency at runtime)
// ---------------------------------------------------------------------------

let GH_HEADERS: Record<string, string> = {};

function resolveToken(flagToken: string): string {
  if (flagToken) return flagToken;
  const env = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (env) return env;
  // Fall back to the gh CLI's stored token, if gh is installed and logged in.
  const p = Bun.spawnSync(["gh", "auth", "token"], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode === 0) return p.stdout.toString().trim();
  return "";
}

function nextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

/** GET a single JSON object. */
async function ghOne<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, { headers: GH_HEADERS });
  if (!res.ok) fail(`GitHub API ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** GET a paginated JSON array, following Link rel="next". maxPages bounds events. */
async function ghList(path: string, maxPages = 50): Promise<any[]> {
  const out: any[] = [];
  let url: string | null = `https://api.github.com${path}`;
  let pages = 0;
  while (url && pages < maxPages) {
    const res: Response = await fetch(url, { headers: GH_HEADERS });
    if (!res.ok) {
      // Events/forks can return partial; surface the error but keep what we have.
      console.error(`warn: GitHub API ${res.status} for ${url} (continuing with partial data)`);
      break;
    }
    const data = await res.json();
    if (Array.isArray(data)) out.push(...data);
    url = nextLink(res.headers.get("link"));
    pages++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

async function main() {
  const flags = parseArgs(Bun.argv.slice(2));
  const { owner, repo, slug } = parseRepoSlug(flags.repo);

  TOKEN = resolveToken(flags.token);
  GH_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "git-history-recover",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  };
  if (!TOKEN) console.error("warn: no token (GH_TOKEN/GITHUB_TOKEN/gh) — limited to 60 API req/hr, public repos only.");

  // 1. Repo metadata --------------------------------------------------------
  const meta = await ghOne<any>(`/repos/${slug}`);
  const defaultBranch: string = meta.default_branch;
  const cloneUrl: string = meta.clone_url;
  const createdAt: string = meta.created_at;
  log(flags, `repo ${slug} — default=${defaultBranch}, forks=${meta.forks_count}, created=${createdAt}`);

  // 2. Working repo: persistent (recover) or temp (analyze) -----------------
  const persistent = flags.recover || flags.keep;
  const outDir = flags.dir
    ? flags.dir
    : persistent
      ? join(process.cwd(), `${repo}-recovered`)
      : mkdtempSync(join(process.env.TMPDIR || tmpdir(), `ghr-${repo}-`));
  if (existsSync(outDir) && persistent && !flags.dir) {
    fail(`output dir already exists: ${outDir} (pass --dir to override)`);
  }
  if (!persistent) CLEANUP_DIR = outDir; // remove temp analyze repo on any exit
  REPO_DIR = outDir;

  log(flags, `cloning into ${outDir} ...`);
  const cl = git(["clone", "--quiet", netUrl(cloneUrl), outDir], { cwd: process.cwd() });
  if (!cl.ok) fail(`clone failed: ${cl.err}`);
  git(["config", "gc.auto", "0"]);          // never auto-gc — we hold dangling objects
  git(["config", "gc.pruneExpire", "never"]);
  const defaultTip = git(["rev-parse", "HEAD"]).out || null;

  // 3. Fork network ---------------------------------------------------------
  let forkCount = 0;
  if (!flags.noForks) {
    const forks = await ghList(`/repos/${slug}/forks?per_page=100&sort=oldest`);
    forkCount = forks.length;
    log(flags, `fetching refs from ${forks.length} fork(s) ...`);
    forks.forEach((f: any, i: number) => {
      const ns = `refs/ghr/fork${i}`;
      git(["fetch", "--quiet", netUrl(f.clone_url),
        `+refs/heads/*:${ns}/heads/*`, `+refs/tags/*:${ns}/tags/*`]);
    });
  }

  // 4. Events API push timeline --------------------------------------------
  const rawEvents = await ghList(`/repos/${slug}/events?per_page=100`, 5);
  const pushes: PushRecord[] = rawEvents
    .filter((e: any) => e.type === "PushEvent")
    .map((e: any) => ({
      time: e.created_at,
      ref: e.payload?.ref ?? "",
      before: e.payload?.before ?? "",
      head: e.payload?.head ?? "",
      commits: (e.payload?.commits ?? []).map((c: any) => c.sha),
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
  const earliestEvent = pushes.length ? pushes[0].time : null;
  const latestEvent = pushes.length ? pushes[pushes.length - 1].time : null;
  // Full coverage if the earliest retained push is at/around repo creation.
  const fullCoverage = !!earliestEvent && earliestEvent <= addMinutes(createdAt, 10);

  // 5. Candidate SHAs from every source, recover the missing ones by SHA ----
  const candidates = new Set<string>();
  for (const p of pushes) {
    for (const s of [p.before, p.head, ...p.commits]) {
      if (s && s !== ZERO_SHA) candidates.add(s);
    }
  }
  // Fork tips are already objects-present (fetched above); include for ref-building.
  for (const r of forkRefs()) candidates.add(r.sha);

  const unrecovered: string[] = [];
  for (const sha of candidates) {
    if (objectExists(sha)) continue;
    const f = git(["fetch", "--quiet", netUrl(cloneUrl), sha]);
    if (f.ok && objectExists(sha)) {
      git(["update-ref", `refs/ghr/recovered/${sha}`, sha]); // pin so fetch-ancestors stick
    } else {
      unrecovered.push(sha);
    }
  }

  // 6. Build the complete commit set & classify ----------------------------
  // Pin every candidate that resolves to a commit so rev-list --all sees it.
  for (const sha of candidates) {
    if (objectExists(sha)) git(["update-ref", `refs/ghr/pin/${sha}`, sha]);
  }

  const allMeta = collectCommitMeta();          // sha -> CommitMeta (all reachable refs)
  const mainline = defaultTip ? revListSet(defaultTip) : new Set<string>();
  const overwritten = [...allMeta.keys()].filter((s) => !mainline.has(s));
  const roots = git(["rev-list", "--max-parents=0", "--all"]).out.split("\n").filter(Boolean);

  // Oldest overwritten = earliest author date; tie-break toward the commit the
  // events timeline references first (the genuine original vs a rewritten twin).
  const eventSet = new Set<string>();
  for (const p of pushes) { if (p.before) eventSet.add(p.before); if (p.head) eventSet.add(p.head); }
  let oldest: CommitMeta | null = null;
  let ties: string[] = [];
  if (overwritten.length) {
    const sorted = overwritten
      .map((s) => allMeta.get(s)!)
      .sort((a, b) => a.epoch - b.epoch || tieBreak(a.sha, b.sha, eventSet, pushes));
    oldest = sorted[0];
    ties = sorted.filter((c) => c.epoch === oldest!.epoch).map((c) => c.sha);
  }

  // 7. Force-push timeline rows --------------------------------------------
  const forcePushes: ForcePush[] = pushes.map((p) => {
    const beforePresent = !!p.before && p.before !== ZERO_SHA && objectExists(p.before);
    const headPresent = !!p.head && objectExists(p.head);
    let force: boolean | null = null;
    if (p.before === ZERO_SHA || !p.before) force = false; // branch creation
    else if (beforePresent && headPresent)
      force = !git(["merge-base", "--is-ancestor", p.before, p.head]).ok; // non-ff = rewrite
    return { ...p, force, beforePresent, headPresent };
  });

  // 7b. Secret scan — runs while every recovered object is still reachable via
  //     the scratch pins (step 8 deletes them), so it covers overwritten history.
  let secrets: SecretScan | null = null;
  if (flags.secrets) {
    log(flags, `scanning every blob in full history for secrets ...`);
    secrets = scanSecrets(defaultTip, flags);
    log(flags, `scanned ${secrets.scannedBlobs} blob(s), ${secrets.archivesScanned} archive(s) → ${secrets.findings.length} finding(s)`);
  }

  // 8. Recovery refs: label every overwritten *leaf* (covers all commits) ---
  let recoveredRefs: { ref: string; sha: string; subject: string }[] = [];
  if (persistent) {
    recoveredRefs = buildRecoveredRefs(overwritten, allMeta, defaultTip);
  }
  // Drop scratch namespaces; keep only labelled recovered refs + origin branches.
  for (const r of git(["for-each-ref", "--format=%(refname)", "refs/ghr"]).out.split("\n").filter(Boolean)) {
    git(["update-ref", "-d", r]);
  }
  if (persistent) {
    git(["remote", "set-url", "origin", cloneUrl]); // strip embedded token from .git/config
    git(["repack", "-adk"]);                         // -k keeps unreachable objects in the pack
  }

  // 9. Report ---------------------------------------------------------------
  const report: Report = {
    repo: slug,
    defaultBranch,
    defaultTip,
    createdAt,
    forks: forkCount,
    events: { pushCount: pushes.length, earliest: earliestEvent, latest: latestEvent, fullCoverage },
    forcePushes,
    commits: { total: allMeta.size, mainline: mainline.size, overwritten: overwritten.length },
    oldestOverwritten: oldest,
    oldestTies: ties,
    roots,
    unrecovered,
    recoveredDir: persistent ? outDir : null,
    recoveredRefs,
    secrets,
  };

  // Temp analyze repo is removed by the process-exit handler (covers errors too).

  if (flags.json) console.log(JSON.stringify(report, redactJson(flags.showSecrets), 2));
  else printReport(report, allMeta, flags);

  // Gate: exit 2 when a finding at or above --fail-on is present (clean = 0).
  if (secrets && flags.failOn !== "none") {
    const rank: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };
    const threshold = rank[flags.failOn];
    if (secrets.findings.some((f) => rank[f.confidence] >= threshold)) process.exitCode = 2;
  }
}

/** JSON replacer that masks finding values unless --show-secrets was passed. */
function redactJson(show: boolean) {
  return (key: string, val: unknown) =>
    !show && key === "value" && typeof val === "string" ? maskValue(val) : val;
}

// ---------------------------------------------------------------------------
// Small pure-ish helpers
// ---------------------------------------------------------------------------

function log(flags: { json: boolean }, msg: string) {
  if (!flags.json) console.error(`• ${msg}`);
}

function addMinutes(iso: string, mins: number): string {
  // String-comparable ISO bump without Date.now(); parse fields manually.
  const t = new Date(iso).getTime() + mins * 60_000;
  return new Date(t).toISOString();
}

/** All fork refs we fetched, as {sha}. */
function forkRefs(): { ref: string; sha: string }[] {
  const out = git(["for-each-ref", "--format=%(objectname) %(refname)", "refs/ghr"]);
  return out.out.split("\n").filter(Boolean).map((l) => {
    const [sha, ...rest] = l.split(" ");
    return { sha, ref: rest.join(" ") };
  });
}

/** sha -> CommitMeta for every commit reachable from any current ref. */
function collectCommitMeta(): Map<string, CommitMeta> {
  const m = new Map<string, CommitMeta>();
  const full = git(["log", "--all", "--format=%H%x1f%at%x1f%aN%x1f%s"]).out;
  for (const line of full.split("\n").filter(Boolean)) {
    const [sha, epoch, author, subject] = line.split("\x1f");
    m.set(sha, { sha, epoch: Number(epoch), author, subject });
  }
  return m;
}

function revListSet(tip: string): Set<string> {
  return new Set(git(["rev-list", tip]).out.split("\n").filter(Boolean));
}

/**
 * Deterministic tie-break among commits with identical author dates. The genuine
 * original tends to appear earliest in the push timeline (as a `before`/`head`);
 * a rewritten twin usually never surfaces there. Falls back to SHA order.
 */
function tieBreak(a: string, b: string, eventSet: Set<string>, pushes: PushRecord[]): number {
  const ea = eventSet.has(a), eb = eventSet.has(b);
  if (ea !== eb) return ea ? -1 : 1;
  const idx = (s: string) => {
    for (let i = 0; i < pushes.length; i++) if (pushes[i].before === s || pushes[i].head === s) return i;
    return Infinity;
  };
  const d = idx(a) - idx(b);
  return d !== 0 ? d : a.localeCompare(b);
}

/**
 * Create one ref per overwritten *leaf* commit (a commit that is no other
 * recovered commit's parent). Every overwritten commit is an ancestor of some
 * leaf, so this makes the entire orphaned DAG reachable via `git log --all`.
 */
function buildRecoveredRefs(
  overwritten: string[],
  meta: Map<string, CommitMeta>,
  defaultTip: string | null,
): { ref: string; sha: string; subject: string }[] {
  const over = new Set(overwritten);
  // parents of all reachable commits
  const parentLines = git(["rev-list", "--all", "--parents"]).out.split("\n").filter(Boolean);
  const isParent = new Set<string>();
  for (const line of parentLines) {
    const [, ...parents] = line.split(" ");
    for (const p of parents) isParent.add(p);
  }
  const leaves = overwritten
    .filter((s) => !isParent.has(s) && s !== defaultTip)
    .map((s) => meta.get(s)!)
    .sort((a, b) => a.epoch - b.epoch);

  const refs: { ref: string; sha: string; subject: string }[] = [];
  leaves.forEach((c, i) => {
    const nn = String(i + 1).padStart(2, "0");
    const ref = `refs/recovered/${nn}-${c.sha.slice(0, 7)}`;
    git(["update-ref", ref, c.sha]);
    refs.push({ ref: ref.replace("refs/", ""), sha: c.sha, subject: c.subject });
  });
  void over;
  return refs;
}

// ---------------------------------------------------------------------------
// Secret scanning — runs over EVERY blob in the recovered object store
// (current tree + overwritten/dangling history + inside zip archives).
// ---------------------------------------------------------------------------

/** BIP39 English wordlist, loaded from the sibling data file (empty if absent). */
const BIP39_WORDS: string[] = (() => {
  try {
    const dir = dirname(realpathSync(import.meta.path));
    const words = readFileSync(join(dir, "bip39-english.txt"), "utf8")
      .split(/\r?\n/).map((w) => w.trim()).filter(Boolean);
    return words.length === 2048 ? words : [];
  } catch { return []; }
})();
const BIP39_SET = new Set(BIP39_WORDS);
const BIP39_INDEX = new Map(BIP39_WORDS.map((w, i) => [w, i] as const));

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP = new Map([...B58_ALPHABET].map((c, i) => [c, i] as const));

/** Decode a base58 string to bytes; null if it contains a non-base58 char. */
export function base58Decode(s: string): Uint8Array | null {
  const bytes: number[] = [0];
  for (const ch of s) {
    const v = B58_MAP.get(ch);
    if (v === undefined) return null;
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let k = 0; k < s.length && s[k] === "1"; k++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

/** True if `words` is a checksum-valid BIP39 mnemonic (12/15/18/21/24 words). */
export function bip39Valid(words: string[]): boolean {
  const n = words.length;
  if (![12, 15, 18, 21, 24].includes(n) || BIP39_INDEX.size === 0) return false;
  let bits = "";
  for (const w of words) {
    const idx = BIP39_INDEX.get(w);
    if (idx === undefined) return false;
    bits += idx.toString(2).padStart(11, "0");
  }
  const total = n * 11;
  const csLen = total / 33;          // checksum bits
  const entBits = total - csLen;     // entropy bits (multiple of 8)
  const entBytes = Buffer.alloc(entBits / 8);
  for (let i = 0; i < entBytes.length; i++) entBytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const hashBits = [...createHash("sha256").update(entBytes).digest()]
    .map((b) => b.toString(2).padStart(8, "0")).join("");
  return hashBits.slice(0, csLen) === bits.slice(entBits);
}

interface ReDetector { category: string; confidence: Confidence; re: RegExp; }

/** Provider-prefixed token patterns (high confidence) + a couple of medium ones. */
const RE_DETECTORS: ReDetector[] = [
  { category: "AWS access key id",          confidence: "high",   re: /\bAKIA[0-9A-Z]{16}\b/g },
  { category: "AWS secret access key",      confidence: "medium", re: /\baws_secret_access_key["'\s:=]+[A-Za-z0-9/+]{40}\b/gi },
  { category: "GitHub token",               confidence: "high",   re: /\bgh[pousr]_[A-Za-z0-9]{36}\b/g },
  { category: "GitHub fine-grained PAT",    confidence: "high",   re: /\bgithub_pat_[0-9A-Za-z_]{82}\b/g },
  { category: "Slack token",                confidence: "high",   re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { category: "Stripe live secret key",     confidence: "high",   re: /\b[sr]k_live_[0-9A-Za-z]{16,}\b/g },
  { category: "Google API key",             confidence: "high",   re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { category: "Google OAuth client secret", confidence: "high",   re: /\bGOCSPX-[0-9A-Za-z_\-]{20,}\b/g },
  { category: "Anthropic API key",          confidence: "high",   re: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g },
  { category: "OpenAI / sk- API key",       confidence: "high",   re: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/g },
  { category: "Private key (PEM)",          confidence: "high",   re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g },
  { category: "JSON Web Token",             confidence: "medium", re: /\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/g },
];

/** key-like identifier assigned a quoted value → likely an inline secret. */
const ASSIGN_RE =
  /(?<k>[A-Za-z0-9_]{0,40}(?:secret|token|passwd|password|pwd|api[_-]?key|apikey|access[_-]?key|private[_-]?key|mnemonic|seed[_-]?phrase|client[_-]?secret|key))\s*[:=]{1,2}\s*["'`](?<v>[^"'`\n]{8,200})["'`]/gi;
/** Solana keypair as a JSON byte array: [n,n,...] with 32 or 64 elements 0-255. */
const ARRAY_RE = /\[(?:\s*\d{1,3}\s*,){31,63}\s*\d{1,3}\s*\]/g;
/** Candidate base58 string long enough to be a 64-byte Solana secret key. */
const B58_RE = /\b[1-9A-HJ-NP-Za-km-z]{86,90}\b/g;

/** Obvious non-secret placeholder values (cuts false positives, not real keys). */
function looksPlaceholder(v: string): boolean {
  if (v.length < 8) return true;
  if (/^[A-Z][A-Z0-9_]*$/.test(v)) return true;                                  // ALL_CAPS token e.g. ANTHROPIC_KEY
  if (/^(your|my|the|test|sample|example|placeholder|change[_-]?me|dummy|fake|none|null|undefined|todo|xxx+|x{4,}|\.{3,}|\*{3,})/i.test(v)) return true;
  if (/^[<{[(].*[>}\])]$/.test(v)) return true;                                  // <YOUR_KEY> {{KEY}} [KEY]
  if (/^\$\{?[A-Za-z_]/.test(v)) return true;                                    // ${ENV} / $ENV interpolation
  if (/^(true|false)$/i.test(v)) return true;
  if (/^(https?:|\/|\.\/|~\/|\.\.\/)/.test(v)) return true;                       // URLs / file paths
  return false;
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Scan one text body for every secret category; deduped by (line,value). */
export function scanText(text: string, ctx: { blob: string; path: string; inCurrentTree: boolean; archiveEntry?: string }): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const add = (category: string, confidence: Confidence, value: string, index: number) => {
    const line = lineAt(text, index);
    const key = `${line} ${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ category, confidence, blob: ctx.blob, path: ctx.path, inCurrentTree: ctx.inCurrentTree, archiveEntry: ctx.archiveEntry, line, value });
  };

  for (const d of RE_DETECTORS) {
    d.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = d.re.exec(text))) add(d.category, d.confidence, m[0], m.index);
  }

  ASSIGN_RE.lastIndex = 0;
  let am: RegExpExecArray | null;
  while ((am = ASSIGN_RE.exec(text))) {
    const v = am.groups?.v ?? "";
    if (!looksPlaceholder(v)) add(`secret-like assignment (${(am.groups?.k ?? "").trim()})`, "medium", v, am.index);
  }

  ARRAY_RE.lastIndex = 0;
  let arr: RegExpExecArray | null;
  while ((arr = ARRAY_RE.exec(text))) {
    const nums = arr[0].slice(1, -1).split(",").map((x) => Number(x.trim()));
    if ((nums.length === 64 || nums.length === 32) && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255))
      add(`Solana keypair byte array (${nums.length} bytes)`, "high", arr[0], arr.index);
  }

  B58_RE.lastIndex = 0;
  let b: RegExpExecArray | null;
  while ((b = B58_RE.exec(text))) {
    const dec = base58Decode(b[0]);
    if (dec && dec.length === 64) add("Solana base58 secret key (64 bytes)", "high", b[0], b.index);
  }

  // BIP39: runs of consecutive wordlist words separated only by spaces/commas.
  if (BIP39_SET.size) {
    const tok = /[A-Za-z]+/g;
    let t: RegExpExecArray | null;
    let run: { word: string; index: number }[] = [];
    let prevEnd = -1;
    const flush = () => {
      if (run.length >= 12) {
        let high = false;
        for (const n of [24, 21, 18, 15, 12]) {
          for (let i = 0; i + n <= run.length; i++) {
            const slice = run.slice(i, i + n).map((x) => x.word);
            if (bip39Valid(slice)) { add(`BIP39 mnemonic — checksum-valid (${n} words)`, "high", slice.join(" "), run[i].index); high = true; }
          }
        }
        if (!high) add(`possible BIP39 mnemonic (${run.length} consecutive wordlist words)`, "medium", run.map((x) => x.word).join(" "), run[0].index);
      }
      run = [];
    };
    while ((t = tok.exec(text))) {
      const w = t[0].toLowerCase();
      const adjacent = prevEnd >= 0 && /^[\s,]*$/.test(text.slice(prevEnd, t.index));
      if (BIP39_SET.has(w) && (run.length === 0 || adjacent)) run.push({ word: w, index: t.index });
      else { flush(); if (BIP39_SET.has(w)) run.push({ word: w, index: t.index }); }
      prevEnd = t.index + t[0].length;
    }
    flush();
  }

  return out;
}

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}
function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
}

/** git cat-file --batch-check for many objects in one process → type+size. */
function batchCheck(shas: string[]): Map<string, { type: string; size: number }> {
  const m = new Map<string, { type: string; size: number }>();
  const p = Bun.spawnSync(["git", "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    { cwd: REPO_DIR, stdin: Buffer.from(shas.join("\n") + "\n"), stdout: "pipe", stderr: "pipe" });
  for (const line of p.stdout.toString().split("\n")) {
    const [sha, type, size] = line.split(" ");
    if (sha && type && type !== "missing") m.set(sha, { type, size: Number(size) });
  }
  return m;
}

/** git cat-file --batch for many objects in one process → raw blob bytes. */
function batchContents(shas: string[]): Map<string, Buffer> {
  const map = new Map<string, Buffer>();
  const p = Bun.spawnSync(["git", "cat-file", "--batch"],
    { cwd: REPO_DIR, stdin: Buffer.from(shas.join("\n") + "\n"), stdout: "pipe", stderr: "pipe" });
  const buf = Buffer.from(p.stdout);
  let off = 0;
  while (off < buf.length) {
    const nl = buf.indexOf(0x0a, off);
    if (nl < 0) break;
    const parts = buf.toString("utf8", off, nl).split(" ");
    off = nl + 1;
    if (parts.length < 3 || parts[1] === "missing") continue; // "<sha> missing" has no payload
    const size = Number(parts[2]);
    map.set(parts[0], Buffer.from(buf.subarray(off, off + size)));
    off += size + 1; // payload + trailing LF
  }
  return map;
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const rec = (d: string) => {
    let entries: string[] = [];
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      const p = join(d, e);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) rec(p); else if (st.isFile()) out.push(p);
    }
  };
  rec(root);
  return out;
}

let UNZIP_OK: boolean | null = null;

/** Extract a zip blob to a temp dir and scan every text entry (recurses zips). */
function scanZip(buf: Buffer, ctx: { blob: string; path: string; inCurrentTree: boolean; archiveEntry?: string }, maxBytes: number, depth = 0): Finding[] {
  const findings: Finding[] = [];
  if (depth > 3) return findings;
  if (UNZIP_OK === null) UNZIP_OK = Bun.spawnSync(["sh", "-c", "command -v unzip"]).exitCode === 0;
  if (!UNZIP_OK) return findings;
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "ghr-zip-"));
  try {
    const zipPath = join(dir, "a.zip");
    writeFileSync(zipPath, buf);
    const xdir = join(dir, "x");
    Bun.spawnSync(["unzip", "-qq", "-o", zipPath, "-d", xdir], { stdout: "pipe", stderr: "pipe" });
    for (const file of walkFiles(xdir)) {
      let st; try { st = statSync(file); } catch { continue; }
      if (st.size > maxBytes) continue;
      const fbuf = readFileSync(file);
      const entry = file.slice(xdir.length + 1);
      if (isBinary(fbuf)) {
        if (isZip(fbuf)) findings.push(...scanZip(fbuf, { ...ctx, archiveEntry: ctx.archiveEntry ? `${ctx.archiveEntry}!${entry}` : entry }, maxBytes, depth + 1));
        continue;
      }
      findings.push(...scanText(fbuf.toString("utf8"), { ...ctx, archiveEntry: ctx.archiveEntry ? `${ctx.archiveEntry}!${entry}` : entry }));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return findings;
}

/** Enumerate every blob across all refs, scan each (text + zip), classify location. */
function scanSecrets(defaultTip: string | null, flags: { maxBlobMb: number; noArchives: boolean }): SecretScan {
  const maxBytes = Math.max(1, flags.maxBlobMb) * 1024 * 1024;
  const scan: SecretScan = { scannedBlobs: 0, skippedBinary: 0, skippedLarge: 0, archivesScanned: 0, findings: [] };

  // blob -> representative path (from every object across all refs)
  const pathOf = new Map<string, string>();
  const allShas: string[] = [];
  for (const line of git(["rev-list", "--objects", "--all"]).out.split("\n").filter(Boolean)) {
    const sp = line.indexOf(" ");
    const sha = sp < 0 ? line : line.slice(0, sp);
    if (sp >= 0 && !pathOf.has(sha)) pathOf.set(sha, line.slice(sp + 1));
    allShas.push(sha);
  }
  const meta = batchCheck([...new Set(allShas)]);

  // blobs present in the current default tree (vs history-only)
  const current = new Set<string>();
  if (defaultTip) {
    for (const l of git(["ls-tree", "-r", defaultTip]).out.split("\n").filter(Boolean)) {
      const parts = l.split(/\s+/); // <mode> <type> <sha>\t<path>
      if (parts[1] === "blob") current.add(parts[2]);
    }
  }

  const blobs = [...meta.entries()].filter(([, v]) => v.type === "blob").map(([sha]) => sha);
  const toRead = blobs.filter((s) => meta.get(s)!.size <= maxBytes);
  scan.skippedLarge = blobs.length - toRead.length;

  // batch reads under a cumulative byte budget to bound memory
  const BUDGET = 32 * 1024 * 1024;
  const processBatch = (batch: string[]) => {
    if (!batch.length) return;
    const contents = batchContents(batch);
    for (const sha of batch) {
      const fbuf = contents.get(sha);
      if (!fbuf) continue;
      const path = pathOf.get(sha) ?? "(unknown path)";
      const inCur = current.has(sha);
      if (isBinary(fbuf)) {
        if (!flags.noArchives && isZip(fbuf)) { scan.archivesScanned++; scan.findings.push(...scanZip(fbuf, { blob: sha, path, inCurrentTree: inCur }, maxBytes)); }
        else scan.skippedBinary++;
        continue;
      }
      scan.scannedBlobs++;
      scan.findings.push(...scanText(fbuf.toString("utf8"), { blob: sha, path, inCurrentTree: inCur }));
    }
  };
  let batch: string[] = [], bsize = 0;
  for (const sha of toRead) {
    const sz = meta.get(sha)!.size;
    if (bsize + sz > BUDGET && batch.length) { processBatch(batch); batch = []; bsize = 0; }
    batch.push(sha); bsize += sz;
  }
  processBatch(batch);
  return scan;
}

/** Mask a secret for display: word-phrases by first/last word, else by ends. */
function maskValue(v: string): string {
  const trimmed = v.trim();
  const words = trimmed.split(/\s+/);
  if (words.length >= 6) return `${words[0]} … ${words[words.length - 1]} (${words.length} words)`;
  if (trimmed.length <= 12) return trimmed.slice(0, 2) + "*".repeat(Math.max(0, trimmed.length - 2));
  return `${trimmed.slice(0, 4)}…${"*".repeat(6)}…${trimmed.slice(-4)} (len ${trimmed.length})`;
}

// ---------------------------------------------------------------------------
// Human report
// ---------------------------------------------------------------------------

function printReport(r: Report, meta: Map<string, CommitMeta>, flags: { showSecrets: boolean }) {
  const B = "\x1b[1m", D = "\x1b[2m", G = "\x1b[32m", Y = "\x1b[33m", R = "\x1b[31m", X = "\x1b[0m";
  console.log(`\n${B}══ git-history-recover · ${r.repo} ══${X}`);
  console.log(`default branch : ${r.defaultBranch} @ ${short(r.defaultTip)}`);
  console.log(`created        : ${r.createdAt}`);
  console.log(`forks scanned  : ${r.forks}`);
  console.log(`commits        : ${r.commits.total} total · ${r.commits.mainline} on ${r.defaultBranch} · ${B}${r.commits.overwritten} overwritten${X}`);

  console.log(`\n${B}push timeline${X} ${D}(events API; ${r.events.pushCount} pushes, ${r.events.fullCoverage ? `${G}full coverage${X}` : `${Y}partial — only back to ${r.events.earliest}${X}`}${D})${X}`);
  if (!r.forcePushes.length) console.log("  (no push events retained)");
  for (const p of r.forcePushes) {
    const arrow = p.force === true ? `${R}⇥ FORCE${X}` : p.force === false ? "→" : `${Y}→?${X}`;
    const miss = (!p.beforePresent && p.before && p.before !== ZERO_SHA) || !p.headPresent ? ` ${Y}(some SHA unrecovered)${X}` : "";
    console.log(`  ${p.time}  ${short(p.before)} ${arrow} ${short(p.head)}  ${D}${p.ref.replace("refs/heads/", "")}${X}${miss}`);
  }

  if (r.oldestOverwritten) {
    const c = r.oldestOverwritten;
    console.log(`\n${B}${G}oldest overwritten commit${X}`);
    console.log(`  ${B}${c.sha}${X}`);
    console.log(`  ${new Date(c.epoch * 1000).toISOString()}  ${c.author}  —  ${c.subject}`);
    if (r.oldestTies.length > 1)
      console.log(`  ${D}(co-dated twins: ${r.oldestTies.filter((s) => s !== c.sha).map(short).join(", ")})${X}`);
  } else {
    console.log(`\n${G}no overwritten history detected — clone is complete.${X}`);
  }

  if (r.roots.length > 1) {
    console.log(`\n${B}root commits${X} ${D}(>1 means history was re-rooted/rewritten)${X}`);
    for (const s of r.roots) console.log(`  ${short(s)}  ${meta.get(s)?.subject ?? ""}`);
  }

  if (r.unrecovered.length) {
    console.log(`\n${Y}${B}unrecoverable SHAs${X} ${D}(in events but no longer in GitHub's object store):${X}`);
    for (const s of r.unrecovered) console.log(`  ${R}${s}${X}`);
  }

  if (r.recoveredDir) {
    console.log(`\n${B}recovery repo${X} : ${r.recoveredDir}`);
    console.log(`  browse: ${D}git -C "${r.recoveredDir}" log --all --oneline --graph --date-order${X}`);
    if (r.recoveredRefs.length) {
      console.log(`  ${r.recoveredRefs.length} labelled ref(s):`);
      for (const ref of r.recoveredRefs) console.log(`    ${short(ref.sha)}  ${ref.ref}  ${D}${ref.subject}${X}`);
    }
  } else {
    console.log(`\n${D}(analysis only — re-run with --recover to materialise a repo with these refs)${X}`);
  }

  if (r.secrets) {
    const s = r.secrets;
    const skipNote = `${D}(${s.scannedBlobs} text blob(s) + ${s.archivesScanned} archive(s); skipped ${s.skippedBinary} binary, ${s.skippedLarge} oversized)${X}`;
    if (!s.findings.length) {
      console.log(`\n${B}secret scan${X} ${skipNote} → ${G}${B}clean${X}`);
      console.log(`  ${G}no secrets found in current or overwritten history.${X}`);
    } else {
      console.log(`\n${B}secret scan${X} ${skipNote} → ${R}${B}${s.findings.length} finding(s)${X}`);
      const color: Record<Confidence, string> = { high: R, medium: Y, low: D };
      for (const conf of ["high", "medium", "low"] as Confidence[]) {
        const group = s.findings.filter((f) => f.confidence === conf);
        if (!group.length) continue;
        console.log(`  ${color[conf]}${B}${conf.toUpperCase()}${X} ${color[conf]}(${group.length})${X}`);
        for (const f of group) {
          const where = f.inCurrentTree ? "current tree" : `${Y}history-only${X}`;
          const loc = f.archiveEntry ? `${f.path}!${f.archiveEntry}` : f.path;
          const val = flags.showSecrets ? f.value.replace(/\s+/g, " ").trim() : maskValue(f.value);
          console.log(`    ${f.category}`);
          console.log(`      ${D}${loc}:${f.line} · blob ${short(f.blob)} · [${where}]${X}`);
          console.log(`      ${val}`);
        }
      }
      console.log(`\n  ${Y}Review each above. Rotate/revoke any real secret — a history rewrite does NOT${X}`);
      console.log(`  ${Y}help once it has been pushed (it stays recoverable, exactly as this tool shows).${X}`);
    }
  }
  console.log("");
}

function short(s: string | null): string { return s ? s.slice(0, 10) : "—"; }

// Only run the pipeline when invoked directly; importing (e.g. tests) is a no-op.
if (import.meta.main) main().catch((e) => fail(e?.message ?? String(e)));
