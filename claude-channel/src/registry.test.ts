import { test, expect, beforeAll, afterAll } from "bun:test";
import http from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCtx } from "./ctx";
import { resolveChannelVersion, fetchManifest, downloadBinary } from "./registry";

const HELLO_SHA = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (url.endsWith("/latest")) return void res.end("2.1.175\n");
    if (url.endsWith("/stable")) return void res.end("2.1.153\n");
    if (url.endsWith("/2.1.175/manifest.json")) {
      res.setHeader("content-type", "application/json");
      return void res.end(JSON.stringify({
        version: "2.1.175", commit: "abc", buildDate: "x",
        platforms: { "linux-arm64": { binary: "claude", checksum: HELLO_SHA, size: 5 } },
      }));
    }
    if (url.endsWith("/2.1.175/linux-arm64/claude")) return void res.end("hello");
    res.statusCode = 404; res.end("nope");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as import("node:net").AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => server.close());

function ctx() {
  return makeCtx({ HOME: mkdtempSync(path.join(tmpdir(), "ccx-reg-")) } as NodeJS.ProcessEnv, { baseUrl: base });
}

test("resolveChannelVersion returns the channel version", async () => {
  expect(await resolveChannelVersion(ctx(), "latest")).toBe("2.1.175");
  expect(await resolveChannelVersion(ctx(), "stable")).toBe("2.1.153");
});

test("resolveChannelVersion rejects non-version bodies", async () => {
  const bad = makeCtx({ HOME: "/h" } as NodeJS.ProcessEnv, {
    baseUrl: base,
    fetchImpl: (async () => new Response("<html>error</html>")) as unknown as typeof fetch,
  });
  await expect(resolveChannelVersion(bad, "latest")).rejects.toThrow(/non-version/);
});

test("fetchManifest parses platforms", async () => {
  const m = await fetchManifest(ctx(), "2.1.175");
  expect(m.platforms["linux-arm64"].checksum).toBe(HELLO_SHA);
});

test("downloadBinary verifies sha256", async () => {
  const c = ctx();
  const dest = path.join(c.home, "claude-binary");
  await downloadBinary(c, "2.1.175", "linux-arm64", dest, HELLO_SHA);
  expect(readFileSync(dest, "utf8")).toBe("hello");
  await expect(downloadBinary(c, "2.1.175", "linux-arm64", dest, "00".repeat(32)))
    .rejects.toThrow(/sha256 mismatch/);
});

test("downloadBinary removes the file on sha256 mismatch", async () => {
  const c = ctx();
  const dest = path.join(c.home, "claude-binary");
  await expect(downloadBinary(c, "2.1.175", "linux-arm64", dest, "00".repeat(32)))
    .rejects.toThrow(/sha256 mismatch/);
  const { existsSync } = await import("node:fs");
  expect(existsSync(dest)).toBe(false);
});
