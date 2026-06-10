#!/data/data/com.termux/files/usr/bin/python3
"""
capture-claude-prompt.py — dump Claude Code's *live* system prompt + full request
body on Termux, for a chosen model, without spending any API tokens.

Why this exists
---------------
The Claude Code system prompt is not a stored string — it is runtime-assembled
(`j0()` in the bundle) from a header literal plus many dynamic sections, and it
varies by **model** and by **entrypoint**. The only faithful way to read it is to
intercept the actual `POST /v1/messages` request. This tool:

  1. stands up a localhost HTTP server that logs request bodies and returns a 400
     (so nothing ever reaches Anthropic — zero tokens, works offline);
  2. launches the Claude Code binary with `ANTHROPIC_BASE_URL` pointed at it;
  3. drives a single turn and saves the captured request.

Entrypoints differ — pick with --mode:
  print        -> SDK entrypoint ("You are a Claude agent, built on … Agent SDK"),
                  leaner, captured reliably with `-p`.
  interactive  -> CLI entrypoint ("You are Claude Code, …"), the full prompt, driven
                  through a PTY (the TUI needs a terminal).

Termux specifics
----------------
Claude Code 2.1.123+ ships a bun-compiled glibc ELF whose interpreter doesn't exist
on bionic, so we launch it through bun-on-termux's `bun-termux` wrapper exactly like
`~/.local/bin/claude-next` (BUN_BINARY_PATH=<binary>). The captured request contains
your global/project CLAUDE.md and env — treat the OUTPUT as private (do not commit).

Example
-------
  ./capture-claude-prompt.py --model claude-fable-5 --mode interactive \
      --binary ~/.claude/binaries/claude-2.1.170/claude-binary.bak-prepatch \
      --out ./out-fable5
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

PREFIX = os.environ.get("PREFIX", "/data/data/com.termux/files/usr")
HOME = os.path.expanduser("~")
DEFAULT_BINARY = f"{HOME}/.claude/binaries/claude-2.1.170/claude-binary"
DEFAULT_BUN = f"{HOME}/.bun/bin/bun-termux"


class _Captor(BaseHTTPRequestHandler):
    """Logs every POST body to <outdir>/req-N.json, then 400s so the client stops."""

    outdir: Path = Path(".")
    count: int = 0

    def log_message(self, *_args) -> None:  # silence stdlib access log
        pass

    def do_POST(self) -> None:  # noqa: N802 (stdlib naming)
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else b""
        type(self).count += 1
        (self.outdir / f"req-{type(self).count}.json").write_bytes(body)
        self.send_response(400)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"type":"error","error":{"type":"invalid_request_error","message":"capture"}}')

    def do_GET(self) -> None:  # noqa: N802 — some clients probe with GET first
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b"{}")


def _child_env(args: argparse.Namespace) -> dict[str, str]:
    env = dict(os.environ)
    env.update(
        {
            "BUN_BINARY_PATH": args.binary,
            "CLAUDE_CODE_TMPDIR": f"{PREFIX}/tmp",
            "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{args.port}",
            # A dummy key forces the API path; the request is intercepted regardless.
            "ANTHROPIC_API_KEY": "sk-ant-capture-dummy",
            "TERM": "xterm-256color",
            "COLUMNS": "100",
            "LINES": "40",
        }
    )
    return env


def _cli_args(args: argparse.Namespace, interactive: bool) -> list[str]:
    out = [args.bun]
    if args.model:
        out += ["--model", args.model]
    if not interactive:
        out += ["-p", "hi"]
    return out


def _system_len(req: dict) -> int:
    s = req.get("system")
    if isinstance(s, list):
        return sum(len(b.get("text", "")) for b in s)
    return len(s or "")


def capture_print(args: argparse.Namespace) -> None:
    """SDK-entrypoint capture via `-p` (subprocess, reliable)."""
    import subprocess

    with open(os.devnull) as devnull:
        try:
            subprocess.run(
                _cli_args(args, interactive=False),
                env=_child_env(args),
                stdin=devnull,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=args.timeout,
            )
        except subprocess.TimeoutExpired:
            pass


def capture_interactive(args: argparse.Namespace, outdir: Path) -> None:
    """CLI-entrypoint capture by driving the TUI under a pseudo-terminal."""
    import pty
    import select

    def best_system() -> int:
        best = 0
        for f in outdir.glob("req-*.json"):
            try:
                req = json.loads(f.read_text())
                if "You are Claude Code" in json.dumps(req.get("system", "")):
                    best = max(best, _system_len(req))
            except Exception:
                pass
        return best

    pid, fd = pty.fork()
    if pid == 0:  # child: become the CLI
        os.execve(args.bun, _cli_args(args, interactive=True), _child_env(args))
        os._exit(127)  # unreachable

    start, phase = time.time(), 0
    while time.time() - start < args.timeout:
        try:
            ready, _, _ = select.select([fd], [], [], 0.3)
            if ready:
                os.read(fd, 65536)  # drain TUI output
        except OSError:
            break
        elapsed = time.time() - start
        # Dismiss any onboarding/dialog, type a prompt, submit (twice to be safe).
        if phase == 0 and elapsed > 10:
            os.write(fd, b"\r"); time.sleep(0.4); os.write(fd, b"\r"); phase = 1
        elif phase == 1 and elapsed > 14:
            os.write(fd, b"what is 2+2"); time.sleep(0.5); os.write(fd, b"\r"); phase = 2
        elif phase == 2 and elapsed > 22:
            os.write(fd, b"\r"); phase = 3
        if best_system() > 2000:  # full prompt arrived
            time.sleep(1.0)
            break
        time.sleep(0.3)

    for sig in (b"\x03", b"\x04"):  # Ctrl-C then Ctrl-D
        try:
            os.write(fd, sig); time.sleep(0.2)
        except OSError:
            pass
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass


def write_outputs(outdir: Path) -> None:
    """Pick the richest captured request and emit prompt + context + raw JSON."""
    reqs = []
    for f in sorted(outdir.glob("req-*.json")):
        try:
            reqs.append((f, json.loads(f.read_text())))
        except Exception:
            pass
    if not reqs:
        sys.exit("no requests captured — is the binary/bun-termux path correct?")
    best_f, best = max(reqs, key=lambda fr: _system_len(fr[1]))
    blocks = best.get("system", [])
    sys_text = "\n".join(b.get("text", "") for b in blocks) if isinstance(blocks, list) else (blocks or "")

    (outdir / "system-prompt.txt").write_text(sys_text + "\n", encoding="utf-8")
    (outdir / "full-request.json").write_text(json.dumps(best, indent=1, ensure_ascii=False), encoding="utf-8")

    lines: list[str] = [
        f"# model={best.get('model')}  source={best_f.name}  system_chars={len(sys_text)}",
        "# Full request: system blocks + appended messages + tool definitions.",
        "# PRIVATE: contains your CLAUDE.md and environment. Do not commit.",
        "=" * 96,
    ]
    for i, b in enumerate(blocks if isinstance(blocks, list) else []):
        lines += [f"\n##### SYSTEM BLOCK [{i}] (len={len(b.get('text',''))}, cache={b.get('cache_control')}) #####\n", b.get("text", "")]
    for i, m in enumerate(best.get("messages", [])):
        content = m.get("content")
        text = content if isinstance(content, str) else "\n".join(
            x.get("text", json.dumps(x)) for x in content if isinstance(x, dict)
        )
        lines += [f"\n##### MESSAGE [{i}] role={m['role']} (chars={len(text)}) #####\n", text]
    for t in best.get("tools", []):
        lines += [f"\n##### TOOL: {t.get('name')} #####", "description: " + t.get("description", "")]
        if "input_schema" in t:
            lines.append("input_schema: " + json.dumps(t["input_schema"], indent=1))
    (outdir / "full-context.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"captured {len(reqs)} request(s); richest = {best_f.name} (system {len(sys_text)} chars, model {best.get('model')})")
    print(f"wrote: {outdir}/system-prompt.txt, full-context.txt, full-request.json")


def main() -> None:
    ap = argparse.ArgumentParser(description="Capture Claude Code's live system prompt on Termux (no tokens spent).")
    ap.add_argument("--model", default=None, help="model id (e.g. claude-fable-5); default = account default")
    ap.add_argument("--mode", choices=("print", "interactive"), default="interactive",
                    help="print=SDK entrypoint (reliable), interactive=full CLI prompt via PTY (default)")
    ap.add_argument("--binary", default=DEFAULT_BINARY, help=f"claude binary (default {DEFAULT_BINARY})")
    ap.add_argument("--bun", default=DEFAULT_BUN, help=f"bun-on-termux wrapper (default {DEFAULT_BUN})")
    ap.add_argument("--port", type=int, default=8131, help="interceptor port (default 8131)")
    ap.add_argument("--out", default="./prompt-capture-out", help="output directory")
    ap.add_argument("--timeout", type=int, default=80, help="capture timeout seconds (default 80)")
    args = ap.parse_args()

    for label, path in (("binary", args.binary), ("bun wrapper", args.bun)):
        if not os.path.exists(path):
            ap.error(f"{label} not found: {path}")

    outdir = Path(args.out).expanduser()
    outdir.mkdir(parents=True, exist_ok=True)
    _Captor.outdir = outdir
    _Captor.count = 0

    server = HTTPServer(("127.0.0.1", args.port), _Captor)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        if args.mode == "print":
            capture_print(args)
        else:
            capture_interactive(args, outdir)
    finally:
        server.shutdown()
    write_outputs(outdir)


if __name__ == "__main__":
    main()
