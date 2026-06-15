import { test, expect, beforeAll, afterAll } from "bun:test";
import http from "node:http";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCtx } from "../ctx";
import { TermuxPlatform } from "./termux";
import { PATCH_TARGETS } from "../patch";

const PAYLOAD = `x${PATCH_TARGETS[0]}y`;
import { createHash } from "node:crypto";
const SHA = createHash("sha256").update(PAYLOAD).digest("hex");

let server: http.Server; let base: string;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = req.url ?? "";
    if (u.endsWith("/2.1.175/manifest.json")) {
      res.setHeader("content-type", "application/json");
      return void res.end(JSON.stringify({ version: "2.1.175", commit: "c", buildDate: "d",
        platforms: { "linux-arm64": { binary: "claude", checksum: SHA, size: PAYLOAD.length } } }));
    }
    if (u.endsWith("/2.1.175/linux-arm64/claude")) return void res.end(PAYLOAD);
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
});
afterAll(() => server.close());

function plat() {
  const ctx = makeCtx({ HOME: mkdtempSync(path.join(tmpdir(), "ccx-tmx-")), PREFIX: "/pfx" } as NodeJS.ProcessEnv, { baseUrl: base });
  return new TermuxPlatform(ctx);
}

test("platformTag and binary paths", () => {
  const p = plat();
  expect(p.platformTag).toBe("linux-arm64");
  expect(p.binaryPath("2.1.175").endsWith("/.claude/binaries/claude-2.1.175/claude-binary")).toBe(true);
});

test("fetchBinary downloads, verifies, patches, returns path", async () => {
  const p = plat();
  const bin = await p.fetchBinary("2.1.175");
  expect(existsSync(bin)).toBe(true);
  expect(existsSync(`${bin}.bak-prepatch`)).toBe(true);
  expect(readFileSync(bin, "latin1")).not.toContain(PATCH_TARGETS[0]);   // patched
  expect(readFileSync(`${bin}.bak-prepatch`, "latin1")).toContain(PATCH_TARGETS[0]); // backup raw
  expect(p.isInstalled("2.1.175")).toBe(true);
});

test("pathPrecedenceOk true when localBin precedes ~/.bun/bin", () => {
  const ctx = makeCtx({ HOME: "/h" } as NodeJS.ProcessEnv);
  const p = new TermuxPlatform(ctx);
  const orig = process.env.PATH;
  process.env.PATH = "/h/.local/bin:/h/.bun/bin:/usr/bin";
  expect(p.pathPrecedenceOk()).toBe(true);
  process.env.PATH = "/h/.bun/bin:/h/.local/bin";
  expect(p.pathPrecedenceOk()).toBe(false);
  process.env.PATH = orig;
});
