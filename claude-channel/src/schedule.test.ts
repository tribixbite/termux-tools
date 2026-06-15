import { test, expect } from "bun:test";
import { makeCtx } from "./ctx";
import { cronLine, CRON_MARKER } from "./schedule";

test("cronLine hourly and daily forms carry the marker + ccx update", () => {
  const c = makeCtx({ HOME: "/h" } as NodeJS.ProcessEnv);
  const hourly = cronLine(c, 6);
  expect(hourly).toContain("ccx update");
  expect(hourly).toContain(CRON_MARKER);
  expect(hourly.startsWith("0 */6 * * *")).toBe(true);
  const daily = cronLine(c, 48);
  expect(daily.startsWith("0 3 */2 * *")).toBe(true);
});
