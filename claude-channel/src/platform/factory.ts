import { existsSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "../ctx";
import { type Platform, NotImplementedError } from "./platform";
import { TermuxPlatform } from "./termux";

export function detectPlatform(ctx: Ctx): Platform {
  const isTermux = existsSync(path.join(ctx.prefix, "glibc")) && existsSync(ctx.bunTermux);
  if (isTermux) return new TermuxPlatform(ctx);
  throw new NotImplementedError(
    "claude-channel currently supports Termux only (needs $PREFIX/glibc + bun-on-termux). " +
    "Cross-platform backends are planned behind the Platform interface.",
  );
}
