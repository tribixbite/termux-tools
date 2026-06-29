#!/usr/bin/env bun
/**
 * gh-secret-pipeline — repeatable secret/keypair/deleted-repo audit for a whole
 * GitHub org, user, or single repo, with a persistent scan ledger.
 *
 * One command runs the full pipeline that was previously done by hand:
 *   1. Resolve the target (org | user | owner/repo) and enumerate its repos.
 *   2. Classify each repo: original/small-fork  → FULL history scan (incl. the
 *      dangling/overwritten commits recovered from forks, via git-history-recover);
 *      large upstream fork → DELTA scan (only the commits this owner added on top
 *      of upstream, via the GitHub compare API) to avoid upstream-fixture noise.
 *   3. Secret-scan + extract Solana keypairs from every scanned blob.
 *   4. Discover DELETED/renamed repos via the GH Archive event firehose, then
 *      scan any surviving copy (a fork on GitHub, or the published npm tarball).
 *   5. Record everything to a ledger so re-runs SKIP unchanged repos and show
 *      what is new. Prints a consolidated report + a Solana keypair table.
 *
 * Usage:
 *   gh-secret-pipeline <org | user | owner/repo> [flags]
 * Secrets: full keypair/secret values are ALWAYS appended (NDJSON, append-only)
 * to the dedicated secrets file (default ~/.local/share/gh-secret-pipeline/
 * secrets.ndjson) and are shown unmasked in the report BY DEFAULT.
 *
 * Flags:
 *   --force           rescan repos even if unchanged since last run
 *   --no-deleted      skip deleted-repo discovery (GH Archive)
 *   --mask            mask secrets in the printed report (file still gets full values)
 *   --secrets-file P  override the dedicated secrets file path
 *   --max-blob <MB>   per-blob size cap for scanning (default 3)
 *   --big-fork <MB>   fork size above which to delta-scan instead of full (default 40)
 *   --ledger <path>   ledger file (default ~/.local/share/gh-secret-pipeline/ledger.json)
 *   --json            emit the run result as JSON
 *   -h, --help
 *
 * Requires: bun, git, gh (authenticated). Optional: tar (npm-tarball survivors).
 * Sibling file git-history-recover.ts is the per-repo engine.
 */
import { scanText, deriveKeypairs } from "./git-history-recover.ts";
import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync, rmSync, readdirSync, statSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";

const SELF_DIR = dirname(realpathSync(import.meta.path));
const TOOL = join(SELF_DIR, "git-history-recover.ts");

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = Bun.argv.slice(2);
// showSecrets defaults to ON (display unmasked); --mask turns display off.
// Full secrets are ALWAYS written to the dedicated secrets file regardless.
const flags = { force: false, noDeleted: false, showSecrets: true, json: false, maxBlob: 3, bigFork: 40, ledger: "", secretsFile: "", target: "" };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") { console.log("gh-secret-pipeline <org|user|owner/repo> [--force] [--no-deleted] [--mask] [--max-blob MB] [--big-fork MB] [--ledger PATH] [--secrets-file PATH] [--json]"); process.exit(0); }
  else if (a === "--force") flags.force = true;
  else if (a === "--no-deleted") flags.noDeleted = true;
  else if (a === "--mask") flags.showSecrets = false;
  else if (a === "--show-secrets") flags.showSecrets = true; // accepted (default); kept for back-compat
  else if (a === "--json") flags.json = true;
  else if (a === "--max-blob") flags.maxBlob = Number(argv[++i]) || 3;
  else if (a === "--big-fork") flags.bigFork = Number(argv[++i]) || 40;
  else if (a === "--ledger") flags.ledger = argv[++i] ?? "";
  else if (a === "--secrets-file") flags.secretsFile = argv[++i] ?? "";
  else if (!a.startsWith("-") && !flags.target) flags.target = a;
  else { console.error(`unknown arg: ${a}`); process.exit(1); }
}
if (!flags.target) { console.error("usage: gh-secret-pipeline <org|user|owner/repo> [flags]"); process.exit(1); }

const LEDGER = flags.ledger || join(homedir(), ".local/share/gh-secret-pipeline", "ledger.json");
// Append-only record of every secret/keypair ever found (full values).
const SECRETS_FILE = flags.secretsFile || join(homedir(), ".local/share/gh-secret-pipeline", "secrets.ndjson");
const TMPROOT = process.env.TMPDIR || tmpdir();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const log = (m: string) => { if (!flags.json) console.error(`• ${m}`); };

/** Run a command, capture stdout. */
function run(cmd: string[], opts: { input?: Buffer; cwd?: string; timeout?: number } = {}): { ok: boolean; out: string } {
  // Strip BUN_BINARY_PATH so spawned `bun` children aren't re-execed as the
  // host binary (Claude Code) when this runs inside a CC session on Termux.
  // GIT_TERMINAL_PROMPT=0 + a timeout backstop prevent any indefinite hang.
  const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: "0" }; delete env.BUN_BINARY_PATH;
  const p = Bun.spawnSync(cmd, { stdin: opts.input, cwd: opts.cwd, stdout: "pipe", stderr: "pipe", env, timeout: opts.timeout ?? 1_800_000 });
  return { ok: p.exitCode === 0, out: p.stdout.toString() };
}
/** `gh api` returning parsed JSON, or null on any error. */
function ghJson(path: string): any {
  const r = run(["gh", "api", path]);
  if (!r.ok) return null;
  try { return JSON.parse(r.out); } catch { return null; }
}
/** `gh api --paginate` of an array endpoint. */
function ghList(path: string): any[] {
  const r = run(["gh", "api", "--paginate", path]);
  if (!r.ok) return [];
  // --paginate concatenates JSON arrays as separate top-level values; normalize.
  try { return JSON.parse(r.out); } catch { try { return JSON.parse(r.out.replace(/]\s*\[/g, ",")); } catch { return []; } }
}
/** GET JSON over HTTP, null on any failure (30s timeout). */
async function fetchJson(url: string): Promise<any> {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(30_000) }); if (!r.ok) return null; return await r.json(); } catch { return null; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * Query the GH Archive public ClickHouse mirror (event firehose). Retries (the
 * public endpoint is occasionally flaky) and reports ok=false on failure so the
 * caller can distinguish "GH Archive unavailable" from "truly no deleted repos"
 * (treating a failed query as "clean" would be a dangerous false negative).
 */
async function chQuery(sql: string): Promise<{ ok: boolean; rows: any[] }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch("https://play.clickhouse.com/?user=play&default_format=JSONEachRow", { method: "POST", body: sql, signal: AbortSignal.timeout(45_000) });
      if (!r.ok) { await sleep(1500); continue; }
      return { ok: true, rows: (await r.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
    } catch { await sleep(1500); }
  }
  return { ok: false, rows: [] };
}
const VENDORED = /(^|\/)(node_modules|dist|build|out|\.yarn|vendor|\.next|coverage|lib|__fixtures__)\//i;
const isBin = (b: Buffer) => { for (let i = 0; i < Math.min(b.length, 4000); i++) if (b[i] === 0) return true; return false; };
const mask = (v: string) => { const t = v.trim(); const w = t.split(/\s+/); if (w.length >= 6) return `${w[0]} … ${w[w.length - 1]} (${w.length} words)`; return t.length <= 12 ? t.slice(0, 2) + "***" : `${t.slice(0, 4)}…******…${t.slice(-4)}`; };

interface RepoResult {
  repo: string; mode: "full" | "delta" | "npm"; commits?: number; overwritten?: number;
  scanned: boolean; reason?: string; realFindings: number; vendoredFindings: number;
  keypairs: { pubkey: string; secret: string; valid: boolean; len: number; sources: string[] }[];
  findings: { category: string; confidence: string; path: string; line: number; value: string; inCurrentTree: boolean }[]; // non-vendored, full values
  headKey?: string; status: "clean" | "findings" | "error";
}

// ---------------------------------------------------------------------------
// per-repo: FULL scan via the engine (covers history + fork-dangling commits)
// ---------------------------------------------------------------------------
function fullScan(repo: string): RepoResult {
  // always --show-secrets: harness needs full values for the dedicated secrets file
  const args = [TOOL, repo, "--secrets", "--show-secrets", "--json", "--max-blob", String(flags.maxBlob), "--fail-on", "none"];
  const r = run(["bun", ...args]);
  let j: any; try { j = JSON.parse(r.out); } catch { return { repo, mode: "full", scanned: true, realFindings: 0, vendoredFindings: 0, keypairs: [], findings: [], status: "error", reason: "engine error" }; }
  const s = j.secrets || { findings: [], keypairs: [] };
  const real = (s.findings as any[]).filter((f) => !VENDORED.test(f.path));
  return { repo, mode: "full", commits: j.commits?.total, overwritten: j.commits?.overwritten, scanned: true, realFindings: real.length, vendoredFindings: s.findings.length - real.length, keypairs: s.keypairs || [], findings: real.map((f) => ({ category: f.category, confidence: f.confidence, path: f.archiveEntry ? `${f.path}!${f.archiveEntry}` : f.path, line: f.line, value: f.value, inCurrentTree: f.inCurrentTree })), status: (real.length || (s.keypairs || []).length) ? "findings" : "clean" };
}

// ---------------------------------------------------------------------------
// per-repo: DELTA scan (large upstream fork — only this owner's added files)
// ---------------------------------------------------------------------------
async function deltaScan(owner: string, name: string, parent: string, pbase: string, head: string): Promise<RepoResult> {
  const cmp = ghJson(`repos/${owner}/${name}/compare/${parent.split("/")[0]}:${pbase}...${head}`);
  const res: RepoResult = { repo: `${owner}/${name}`, mode: "delta", scanned: true, realFindings: 0, vendoredFindings: 0, keypairs: [], findings: [], status: "clean", reason: cmp ? `${cmp.ahead_by} ahead` : "compare failed" };
  if (!cmp || !cmp.files) return res;
  const allFindings: any[] = [];
  for (const f of cmp.files.slice(0, 300)) {
    if (f.status === "removed") continue;
    const blob = ghJson(`repos/${owner}/${name}/contents/${encodeURIComponent(f.filename)}?ref=${head}`);
    if (!blob?.content) continue;
    const buf = Buffer.from(blob.content, "base64"); if (isBin(buf) || buf.length > flags.maxBlob * 1e6) continue;
    for (const fd of scanText(buf.toString("utf8"), { blob: f.sha || "-", path: f.filename, inCurrentTree: true })) allFindings.push(fd);
  }
  const real = allFindings.filter((f) => !VENDORED.test(f.path));
  res.realFindings = real.length;
  res.vendoredFindings = allFindings.length - real.length;
  res.keypairs = deriveKeypairs(allFindings);
  res.findings = real.map((f) => ({ category: f.category, confidence: f.confidence, path: f.path, line: f.line, value: f.value, inCurrentTree: f.inCurrentTree }));
  res.status = (res.realFindings || res.keypairs.length) ? "findings" : "clean";
  return res;
}

// ---------------------------------------------------------------------------
// npm tarball scan (for deleted-repo survivors published to npm)
// ---------------------------------------------------------------------------
async function npmScan(pkg: string): Promise<RepoResult | null> {
  const meta = await fetchJson(`https://registry.npmjs.org/${pkg}`);
  const ver = meta?.["dist-tags"]?.latest; const url = ver && meta?.versions?.[ver]?.dist?.tarball;
  if (!url) return null;
  const dir = `${TMPROOT}/ghsp-npm-${pkg.replace(/[^a-z0-9]/gi, "_")}`;
  try {
    mkdirSync(dir, { recursive: true });
    const tgz = join(dir, "p.tgz");
    writeFileSync(tgz, Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer()));
    run(["tar", "xzf", tgz, "-C", dir]);
    const walk = (d: string): string[] => { const o: string[] = []; for (const e of readdirSync(d)) { const p = join(d, e); const s = statSync(p); s.isDirectory() ? o.push(...walk(p)) : o.push(p); } return o; };
    const all: any[] = [];
    for (const fp of walk(dir)) { if (fp.endsWith("p.tgz")) continue; const b = readFileSync(fp); if (isBin(b) || b.length > flags.maxBlob * 1e6) continue; for (const fd of scanText(b.toString("utf8"), { blob: "-", path: fp.slice(dir.length + 1), inCurrentTree: true })) all.push(fd); }
    const real = all.filter((f) => !VENDORED.test(f.path));
    const kps = deriveKeypairs(all);
    return { repo: `npm:${pkg}@${ver}`, mode: "npm", scanned: true, realFindings: real.length, vendoredFindings: all.length - real.length, keypairs: kps, findings: real.map((f) => ({ category: f.category, confidence: f.confidence, path: f.path, line: f.line, value: f.value, inCurrentTree: f.inCurrentTree })), status: (real.length || kps.length) ? "findings" : "clean" };
  } catch { return null; } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Append every keypair + non-vendored secret found this run to the dedicated
 *  NDJSON file (full values, append-only audit trail across all runs). */
function appendSecrets(all: RepoResult[], target: string): number {
  const ts = new Date().toISOString();
  const lines: string[] = [];
  for (const r of all) {
    // Only repos actually scanned this run carry full secret values; skipped
    // (unchanged) repos return a lean ledger entry with no findings/secret.
    if (r.scanned === false) continue;
    for (const k of r.keypairs || []) lines.push(JSON.stringify({ ts, target, repo: r.repo, kind: "keypair", pubkey: k.pubkey, valid: k.valid, len: k.len, secret: k.secret, sources: k.sources }));
    for (const f of r.findings || []) lines.push(JSON.stringify({ ts, target, repo: r.repo, kind: "secret", category: f.category, confidence: f.confidence, path: f.path, line: f.line, current: f.inCurrentTree, value: f.value }));
  }
  const uniq = [...new Set(lines)];
  if (!uniq.length) return 0;
  mkdirSync(dirname(SECRETS_FILE), { recursive: true });
  appendFileSync(SECRETS_FILE, uniq.join("\n") + "\n");
  return uniq.length;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const ledger = (() => { try { return JSON.parse(readFileSync(LEDGER, "utf8")); } catch { return { version: 1, targets: {}, scopes: {}, runs: [] }; } })();
const results: RepoResult[] = [];
const deleted: { name: string; status: string; survivor?: string; candidates?: string[]; result?: RepoResult }[] = [];
let ghArchiveUnavailable = false; // true if the GH Archive query failed (≠ "no deleted repos")

async function scanRepo(meta: any): Promise<RepoResult> {
  const full = meta.full_name as string;
  const headKey = meta.pushed_at as string; // change signal
  const prev = ledger.targets[full];
  if (prev && prev.headKey === headKey && !flags.force) { log(`skip ${full} (unchanged)`); return { ...prev, scanned: false, reason: "unchanged" }; }
  let res: RepoResult;
  if (meta.fork && (meta.size || 0) / 1024 > flags.bigFork) {
    log(`delta-scan ${full} (large fork, ${(meta.size / 1024 | 0)}MB)`);
    const info = ghJson(`repos/${full}`);
    const parent = info?.parent?.full_name;
    if (parent) res = await deltaScan(meta.owner.login, meta.name, parent, info.parent.default_branch, meta.default_branch);
    else res = { repo: full, mode: "delta", scanned: true, realFindings: 0, vendoredFindings: 0, keypairs: [], findings: [], status: "clean", reason: "no parent" };
  } else {
    log(`full-scan ${full} (${(meta.size / 1024 | 0)}MB${meta.fork ? ", small fork" : ""})`);
    res = fullScan(full);
  }
  res.headKey = headKey;
  ledger.targets[full] = { repo: full, mode: res.mode, commits: res.commits, overwritten: res.overwritten, realFindings: res.realFindings, vendoredFindings: res.vendoredFindings, keypairs: res.keypairs.map((k) => ({ pubkey: k.pubkey, valid: k.valid, len: k.len, sources: k.sources })), headKey, status: res.status, lastScanned: new Date().toISOString() };
  return res;
}

// resolve target
const target = flags.target.replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");
let repos: any[] = [];
let owner = "";
if (target.includes("/")) {
  const m = ghJson(`repos/${target}`);
  if (!m) { console.error(`repo not found: ${target}`); process.exit(1); }
  owner = m.owner.login; repos = [m];
} else {
  // org or user
  const acct = ghJson(`users/${target}`);
  if (!acct) { console.error(`account not found: ${target}`); process.exit(1); }
  owner = acct.login;
  const path = acct.type === "Organization" ? `orgs/${owner}/repos?per_page=100&type=public` : `users/${owner}/repos?per_page=100`;
  repos = ghList(path);
  log(`${owner} (${acct.type}) — ${repos.length} repos`);
}

for (const m of repos) results.push(await scanRepo(m));

// deleted-repo discovery (org/user only)
if (!flags.noDeleted && !target.includes("/")) {
  log(`deleted-repo discovery for ${owner} (GH Archive)…`);
  const ch = await chQuery(`SELECT DISTINCT repo_name FROM github_events WHERE repo_name ILIKE '${owner.replace(/'/g, "")}/%'`);
  if (!ch.ok) { ghArchiveUnavailable = true; log(`  GH Archive unavailable — deleted-repo discovery incomplete (retry later)`); }
  const current = new Set(repos.map((r) => r.full_name.toLowerCase()));
  const gone = ch.rows.map((r) => r.repo_name).filter((n: string) => !current.has(n.toLowerCase()));
  for (const name of gone) {
    const info = ghJson(`repos/${name}`);
    if (info && info.full_name.toLowerCase() === name.toLowerCase()) continue; // still exists (private→now public etc.)
    const status = info ? `renamed→${info.full_name}` : "deleted";
    const entry: { name: string; status: string; survivor?: string; candidates?: string[]; result?: RepoResult } = { name, status };
    if (!info) {
      // Look for a surviving fork by exact name. A deleted repo's network is
      // reparented by GitHub, so we can't verify the link cryptographically —
      // bound to SMALL, low-fork repos so a generic name (e.g. "docs") can't
      // pull in a giant unrelated namesake, and label the result unverified.
      const repoName = name.split("/")[1];
      const hits = (ghJson(`search/repositories?q=${encodeURIComponent(repoName)}+in:name+fork:true&per_page=30`)?.items || [])
        .filter((h: any) => h.name.toLowerCase() === repoName.toLowerCase() && (h.size || 0) / 1024 < 80 && (h.forks_count || 0) < 100);
      entry.candidates = hits.slice(0, 5).map((h: any) => h.full_name);
      if (hits.length) { entry.survivor = hits[0].full_name; log(`  deleted ${name} → candidate survivor ${hits[0].full_name} (unverified), scanning`); entry.result = fullScan(hits[0].full_name); }
    }
    deleted.push(entry);
  }
  // npm survivors under @owner scope
  const npm = await fetchJson(`https://registry.npmjs.org/-/v1/search?text=${owner}&size=50`);
  for (const o of npm?.objects || []) {
    const nm = o.package?.name as string;
    if (nm && (nm.toLowerCase().startsWith(`@${owner.toLowerCase()}/`) || nm.toLowerCase() === owner.toLowerCase())) {
      log(`  npm package ${nm} — scanning tarball`);
      const r = await npmScan(nm); if (r) { results.push(r); }
    }
  }
  ledger.scopes[owner] = { lastRun: new Date().toISOString(), deleted: deleted.map((d) => ({ name: d.name, status: d.status, survivor: d.survivor || null })) };
}

// append full secrets to the dedicated file (this run's scanned repos + survivors)
const allForFile = [...results, ...deleted.map((d) => d.result).filter(Boolean) as RepoResult[]];
const wroteSecrets = appendSecrets(allForFile, flags.target);

// persist ledger
mkdirSync(dirname(LEDGER), { recursive: true });
const scannedNow = results.filter((r) => r.scanned).length;
ledger.runs.push({ at: new Date().toISOString(), target: flags.target, repos: results.length, scanned: scannedNow, skipped: results.length - scannedNow, deleted: deleted.length });
writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
if (flags.json) { console.log(JSON.stringify({ owner, results, deleted }, null, 2)); process.exit(0); }
const B = "\x1b[1m", D = "\x1b[2m", G = "\x1b[32m", Y = "\x1b[33m", R = "\x1b[31m", X = "\x1b[0m";
console.log(`\n${B}══ gh-secret-pipeline · ${flags.target} ══${X}`);
console.log(`scanned ${scannedNow}/${results.length} repo(s) this run (${results.length - scannedNow} unchanged/skipped)`);
console.log(`ledger:  ${LEDGER}`);
console.log(`secrets: ${SECRETS_FILE} ${D}(+${wroteSecrets} record(s) appended this run)${X}\n`);
for (const r of results) {
  const c = r.status === "findings" ? R : r.status === "error" ? Y : G;
  const det = r.mode === "full" ? `${r.commits ?? "?"}c/${r.overwritten ?? "?"}ovr` : r.mode === "delta" ? `delta ${r.reason}` : "npm";
  console.log(`${c}●${X} ${r.repo}  ${D}[${r.mode}, ${det}]${X}  ${r.scanned ? "" : D + "(skipped: " + r.reason + ")" + X} real=${r.realFindings} vendored=${r.vendoredFindings} keypairs=${r.keypairs.length}`);
}
if (deleted.length) {
  console.log(`\n${B}deleted/renamed repos${X}`);
  for (const d of deleted) {
    let tail = "";
    if (d.survivor) tail = ` → ${Y}candidate survivor${X} ${d.survivor} (unverified, ${d.result?.status})`;
    else if (d.status === "deleted") tail = ` ${Y}(no small survivor found; likely unrecoverable)${X}`;
    console.log(`  ${d.name} — ${d.status}${tail}`);
    if (d.candidates && d.candidates.length > 1) console.log(`    ${D}other name matches: ${d.candidates.slice(1).join(", ")}${X}`);
  }
} else if (!flags.noDeleted && !target.includes("/")) {
  if (ghArchiveUnavailable) console.log(`\n${Y}deleted-repo discovery: GH Archive unavailable — incomplete (retry)${X}`);
  else console.log(`\n${G}no deleted/renamed repos${X} (GH Archive)`);
}

// consolidated keypair table
const allKp = [...results, ...deleted.map((d) => d.result).filter(Boolean) as RepoResult[]].flatMap((r) => (r.keypairs || []).map((k) => ({ ...k, repo: r.repo })));
console.log(`\n${B}Solana keypairs (${allKp.length})${X}`);
if (!allKp.length) console.log(`  ${G}none found${X}`);
for (const k of allKp as any[]) {
  const tag = k.valid ? (k.len === 64 ? "valid" : "32B-seed") : `${R}MISMATCH${X}`;
  console.log(`  ${B}${k.pubkey}${X} [${tag}] ${D}${k.repo} · ${(k.sources || [])[0] || ""}${X}`);
  console.log(`    ${k.secret ? (flags.showSecrets ? k.secret : mask(k.secret)) : `${D}(secret in ${SECRETS_FILE})${X}`}`);
}
console.log("");
