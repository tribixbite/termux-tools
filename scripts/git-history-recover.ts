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
 * Flags:
 *   --recover            Persist a recovery repo with labelled refs/recovered/*.
 *   --dir <path>         Output dir for the recovery repo (default: ./<repo>-recovered).
 *   --keep               In analyze mode, keep the temp working repo instead of deleting it.
 *   --no-forks           Skip fork enumeration/fetch (events + SHA recovery only; faster).
 *   --token <tok>        GitHub token (else $GH_TOKEN / $GITHUB_TOKEN / `gh auth token`).
 *   --json               Emit machine-readable JSON instead of the human report.
 *   -h, --help           Show help.
 *
 * Requires: git, bun. Optional: gh (used only as a token source if no token env).
 */

import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  console.log(`git-history-recover <owner/repo | github-url> [--recover] [--dir PATH]
  [--keep] [--no-forks] [--token TOK] [--json]

Recovers overwritten/force-pushed/dangling commits from a public GitHub repo.
Default = analysis only; --recover also writes a labelled recovery repo.`);
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
  };

  // Temp analyze repo is removed by the process-exit handler (covers errors too).

  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report, allMeta);
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
// Human report
// ---------------------------------------------------------------------------

function printReport(r: Report, meta: Map<string, CommitMeta>) {
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
  console.log("");
}

function short(s: string | null): string { return s ? s.slice(0, 10) : "—"; }

main().catch((e) => fail(e?.message ?? String(e)));
