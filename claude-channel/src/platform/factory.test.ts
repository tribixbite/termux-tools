import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCtx } from "../ctx";
import { detectPlatform } from "./factory";
import { NotImplementedError } from "./platform";

test("detectPlatform throws NotImplementedError when not Termux", () => {
  const ctx = makeCtx({ HOME: mkdtempSync(path.join(tmpdir(), "ccx-fac-")), PREFIX: "/no-such" } as NodeJS.ProcessEnv);
  expect(() => detectPlatform(ctx)).toThrow(NotImplementedError);
});
