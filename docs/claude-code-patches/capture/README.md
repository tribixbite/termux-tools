# Claude Code prompt-capture toolkit

Tools for reading Claude Code's **live** system prompt and full request body on
Termux, per model, without spending API tokens. Used to produce the
`v2.1.170-*-system-prompt-unpatched.txt` backups in the parent directory.

## Why interception (not `strings`)

The system prompt is **runtime-assembled** (`j0()` in the bundle) and varies by
**model** and **entrypoint**, so it isn't a single literal you can `strings` out.
The faithful method is to intercept the real `POST /v1/messages`: stand up a
localhost server, point the CLI's `ANTHROPIC_BASE_URL` at it, drive one turn, and
read the `system` / `messages` / `tools` it sends. The interceptor returns a `400`
after logging the body, so **nothing reaches Anthropic — zero tokens**, fully offline.

## Tools

### `capture-claude-prompt.py`
```
./capture-claude-prompt.py --model claude-fable-5 --mode interactive \
    --binary ~/.claude/binaries/claude-2.1.170/claude-binary.bak-prepatch \
    --out ./out-fable5
```
Writes into `--out`: `system-prompt.txt` (joined system blocks), `full-context.txt`
(system + appended messages + tool defs), `full-request.json` (raw), and the raw
`req-N.json` captures.

- `--mode print` → **SDK** entrypoint (`"You are a Claude agent, built on … Agent SDK"`),
  leaner, captured reliably via `-p`.
- `--mode interactive` → **CLI** entrypoint (`"You are Claude Code, …"`), the full
  prompt, driven through a PTY. The first request is a `{"content":"quota"}` preflight;
  the tool waits for the real one (`system` > 2000 chars).
- Prompts are **model-dependent** — always pass `--model`. (Fable 5's interactive
  prompt is ~11.7 K chars vs ~7.8 K for Opus 4.8.)

### `extract-string-blocks.py`
```
./extract-string-blocks.py ~/.claude/binaries/claude-2.1.170/claude-binary \
    -w chemistry -w biology --out chem-bio-blocks.txt
```
Dumps the full surrounding printable run around each keyword occurrence (deduped) —
for telling real prompt/UI text apart from embedded-data false positives.

## Termux specifics

- Claude Code 2.1.123+ is a bun-compiled glibc ELF; both tools launch it through
  bun-on-termux's `bun-termux` wrapper (`BUN_BINARY_PATH=<binary>`), like
  `~/.local/bin/claude-next`. See `memory/claude-code-pinning.md`.
- Do **not** name a capture script `pty.py` — `$PREFIX/tmp` lands on `sys.path[0]`
  and would shadow the stdlib `pty` module.

## Privacy

Capture **output** embeds your global/project `CLAUDE.md` and environment (cwd, git).
Keep `full-context.txt` / `full-request.json` **out of any public repo.** Only the
`system-prompt.txt` (Anthropic's prompt) is safe to publish.

## Notes on "Fable 5"

- Model id: **`claude-fable-5`** (display "Claude Fable 5") — the only Fable model in
  2.1.170, and the "5" generation (the model menu has no `opus-5`).
- **`fable5-launch` is NOT a model id** — it's a CLI announcement/banner object
  (`{id:"fable5-launch",tier:"announcement",type:"info",…}`).
- 2.1.170 has client-side **safety routing** for "cybersecurity or biology" topics:
  if a model's safety classifier flags such a message, the CLI shows a notice and
  switches to a fallback model (see `extract-string-blocks.py … -w biology`). There is
  no chemistry equivalent — "chemistry" hits are `StereochemistryElements` symbol-table
  noise.
