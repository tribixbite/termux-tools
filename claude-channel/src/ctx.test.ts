import { test, expect } from "bun:test";
import path from "node:path";
import { makeCtx, RELEASE_BASE_URL } from "./ctx";

test("makeCtx derives paths from HOME and PREFIX", () => {
  const ctx = makeCtx({ HOME: "/h", PREFIX: "/p" } as NodeJS.ProcessEnv);
  expect(ctx.home).toBe("/h");
  expect(ctx.binariesDir).toBe(path.join("/h", ".claude", "binaries"));
  expect(ctx.localBin).toBe(path.join("/h", ".local", "bin"));
  expect(ctx.bunTermux).toBe(path.join("/h", ".bun", "bin", "bun-termux"));
  expect(ctx.baseUrl).toBe(RELEASE_BASE_URL);
});

test("makeCtx honors overrides and CLAUDE_CHANNEL_BASE_URL", () => {
  const ctx = makeCtx({ HOME: "/h", CLAUDE_CHANNEL_BASE_URL: "http://x" } as NodeJS.ProcessEnv);
  expect(ctx.baseUrl).toBe("http://x");
  const ctx2 = makeCtx({ HOME: "/h" } as NodeJS.ProcessEnv, { baseUrl: "http://y" });
  expect(ctx2.baseUrl).toBe("http://y");
});
