# last30days skill — setup, keys & upgrade path (Termux / this device)

Plugin: `last30days@last30days-skill` v3.14.0
Skill dir: `~/.claude/plugins/cache/last30days-skill/last30days/3.14.0/skills/last30days`
Engine: `<skill dir>/scripts/last30days.py` (needs Python 3.12+; box has `python3`=3.13)
Config store: `~/.config/last30days/.env` (append-only; NEVER `>`-overwrite — read then `>>`)
Saved research goes to `LAST30DAYS_MEMORY_DIR` (I use `~/git/research/last30days/`)

## Current state (2026-07-14)

`.env` keys: `XAI_API_KEY`, `SETUP_COMPLETE=true`

doctor tiers:
- **ok / active:** reddit, x (backend=xai), youtube (yt-dlp), hackernews,
  polymarket, github, digg, library
- **off (need a key):** tiktok, instagram, threads, pinterest, linkedin
  (all ScrapeCreators); bluesky; perplexity; jobs; truthsocial; xiaohongshu; web

Note on `web -> off`: doctor reports off because there's no dedicated
Brave/Exa/Serper backend key. General web is still covered two ways — the
engine's keyless floor, and (in Claude Code) my own WebSearch with
`LAST30DAYS_NATIVE_SEARCH=1` plus 2-3 supplements per run. Adding `SERPER_API_KEY`
turns doctor `web` green and matters most for headless/cron runs.

## Working invocation on this box

```bash
SKILL_DIR="$HOME/.claude/plugins/cache/last30days-skill/last30days/3.14.0/skills/last30days"
export LAST30DAYS_PYTHON=python3
export LAST30DAYS_NATIVE_SEARCH=1                 # Claude Code has WebSearch
export LAST30DAYS_MEMORY_DIR="$HOME/git/research/last30days"
python3 "$SKILL_DIR/scripts/last30days.py" "<topic>" --emit=compact \
  --save-dir="$LAST30DAYS_MEMORY_DIR" --save-suffix=v3 \
  --plan "$PLAN_FILE" --x-handle=<h> --subreddits=<a,b> ...
```

---

## Where to put API keys (bluesky / serper / scrapecreators / perplexity)

**Precedence (from `env.py` `load_config`):**
1. process environment (`os.environ`) — **highest**
2. trusted `./.claude/last30days.env` (per-project)
3. `~/.config/last30days/.env` (global) — lowest

So both a shell `export` and the `.env` file work; a process-env value wins on
conflict.

**Recommendation: keep every key in `~/.config/last30days/.env`.** The engine
loads that file explicitly on every run regardless of which shell launched it —
it's the guaranteed path and the skill's own store (the xAI key already lives
there). Format, one per line:

```
XAI_API_KEY=xai-...
BSKY_HANDLE=you.bsky.social
BSKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
SERPER_API_KEY=...
SCRAPECREATORS_API_KEY=...
PERPLEXITY_API_KEY=...
INCLUDE_SOURCES=tiktok,instagram,youtube_comments,tiktok_comments,instagram_comments,bluesky
SETUP_COMPLETE=true
```

**Can they go in `~/.bashrc` instead?** Yes for your own interactive runs —
`export KEY=val` in bashrc takes precedence (rule 1). Two caveats:
- Claude Code's Bash tool runs non-interactive subshells that may not source
  `~/.bashrc`, so a key that's *only* in bashrc might be invisible to a run I
  drive. `.env` has no such ambiguity.
- bashrc is more likely to be synced/backed-up/committed than `~/.config`. Keep
  secrets out of anything that reaches git. Don't split keys across both files —
  pick `.env` as the single source of truth to avoid drift.

After adding keys, turn the paid sources on with `INCLUDE_SOURCES=...` (see
above) and verify with:
`python3 "$SKILL_DIR/scripts/last30days.py" doctor`

## What `setup --github` actually does

It runs the **ScrapeCreators GitHub device-auth flow** (not a general setup):
submits a device code, copies the code to your clipboard, opens a browser to
github.com's device page, then polls until you authorize — on success it fetches
and writes `SCRAPECREATORS_API_KEY` into `~/.config/last30days/.env`
automatically. `--github-start` + `--github-poll` are the two halves; `--github`
chains them.

**On this headless Termux box you don't want it.** The clipboard-copy and
browser-open steps assume a desktop; there's no desktop browser here. Since
you're pasting keys by hand anyway, just add `SCRAPECREATORS_API_KEY=...` to
`.env` directly — same result, no flow. (Also: if your GitHub is already linked
to a ScrapeCreators account, the flow returns "Authorized but failed to fetch
API key" and you'd copy the key from scrapecreators.com regardless.)

---

## Go CLIs: digg / arxiv / techmeme — FIXED (were blocked)

**Status: built and installed** to `~/.local/bin/{digg-pp-cli,arxiv-pp-cli,techmeme-pp-cli}`.
Digg now shows `ok` in doctor.

**The blocker:** auto-setup runs `bunx @mvanhorn/printing-press-library install
<name> --cli-only`, which `go install`s modules whose `go.mod` declares
`go 1.26.5`. Termux's pacman only has **Go 1.26.3**, and Google publishes **no
android/arm64 Go toolchain** to auto-download, so `go` aborts with
`download go1.26.5 for android/arm64: toolchain not available`. (`npx` also fails
here with rc=127 `printing-press-library: not found` — use `bunx`.)

**The fix (reproducible):** `scripts/build-printing-press-clis.sh` clones the
monorepo, lowers each `go 1.26.5` directive to `1.26.3` (none of these CLIs use
1.26.5-only features — verified: all three compile and run), pins
`GOTOOLCHAIN=local` so `go` never tries to fetch a toolchain, and builds native
android/arm64 binaries. Pure-Go deps (modernc sqlite, quic-go), so no CGO/NDK.

```bash
bash scripts/build-printing-press-clis.sh            # all three
bash scripts/build-printing-press-clis.sh digg       # just one
```

Re-run after Termux ships Go >= 1.26.5 (then the sed patch becomes a no-op), or
to refresh the CLIs. This down-patch is the general recipe for ANY Go tool that
fails on Termux solely because of a `go >=` directive newer than the packaged
toolchain — distinct from the faccessat2/SIGSYS class in `~/.claude/CLAUDE.md`
(that's a runtime seccomp issue fixed with `proot -0`; this is a build-time
version gate).

---

## Upgrade paths still open

1. **ScrapeCreators key** — biggest unlock: TikTok + Instagram (+ Threads,
   Pinterest) posts AND top comments, YouTube/TikTok/IG comment mining, and a
   Reddit rate-limit backup. 10k free calls. Add `SCRAPECREATORS_API_KEY` +
   `INCLUDE_SOURCES=tiktok,instagram,...`.
2. **Serper** (`SERPER_API_KEY`) — makes doctor `web` green; best for cron.
3. **Bluesky** (`BSKY_HANDLE` + `BSKY_APP_PASSWORD`) — free extra social lane;
   add `bluesky` to `INCLUDE_SOURCES`.
4. **Perplexity** (`PERPLEXITY_API_KEY`) — grounded synthesis; per-run
   `--search perplexity` or `INCLUDE_SOURCES=perplexity`.
5. **Local notes** — `--corpus <dir>` folds your own files in, offline.

---

## Why the ThinkNode M3 was missed, and how to not miss the next one

The Elecrow **ThinkNode M3** (nRF52840 + LR1110, GNSS, 770mAh magnetic charge,
IP66, temp/humidity/accelerometer, ~$39.90, early 2026) is a textbook slim card
tracker — as on-topic as the WisMesh Tag — yet neither the first WebSearch pass
nor the last30days run surfaced it. Root causes:

- **Seed bias in pre-research.** My WebSearches were seeded with devices I
  already knew (T1000-E, Heltec T1, WisMesh, T-Echo, Wio). I never ran a
  vendor-enumeration sweep ("all card-sized Meshtastic trackers 2026",
  "Elecrow ThinkNode lineup"), so a newer/less-covered SKU fell through. It only
  appeared as a side effect of chasing the ThinkNode **M9** firmware PR.
- **Query plan named products, not the category.** The last30days plan listed
  specific model names; it never told the engine to look for "Elecrow / ThinkNode".
  Reddit/X matching keys off those strings, so M3 threads (fewer to begin with)
  scored low or were filtered by the relevance floor.
- **Shallow Reddit depth.** Default depth pulled ~17 Reddit items. M3 chatter is
  thin this window; `--deep` (50-70 Reddit) plus more subreddits would raise the
  odds of catching a low-volume device.
- **No category-peer expansion for Meshtastic hardware.** The skill's
  Step 0.55 category table (Section 2a) has no "meshtastic/LoRa hardware" entry,
  so it never auto-adds vendor/hobby subs.

**Changes to make (for how I run this, and worth upstreaming):**
1. **Enumerate before researching.** For any "devices like X" question, first run
   a vendor sweep (Seeed, RAK, Heltec, LilyGO, Elecrow, Waveshare, B&Q/muzi
   resellers) and a "complete list / roundup 2026" query, THEN research the union
   — don't seed only from memory.
2. **Name vendors + product families in the query plan**, not just model names:
   add subqueries for "Elecrow ThinkNode", "Seeed SenseCAP/Wio", "RAK WisMesh",
   "LilyGO T-Echo/T-Deck".
3. **Use `--deep` for niche-hardware topics** so low-volume devices clear the
   relevance floor.
4. **Widen subreddits:** r/meshtastic (dedicated) + r/MeshCore, r/LoRa,
   r/amateurradio, r/AR15 (tacticalgear crossover), r/foldingphone — and add a
   "meshtastic hardware" category-peer group to Step 0.55.
5. **Add a completeness check:** after synthesis, ask "which vendors in this
   category did NOT appear?" and do one more targeted pass. M3 would have been
   caught by "did Elecrow ship anything card-sized?"

These are captured here so a future run (or a maintainer patching the skill's
Step 0.55 category table) can apply them.
