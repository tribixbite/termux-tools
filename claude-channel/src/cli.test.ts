import { test, expect } from "bun:test";
import { parseArgs } from "./cli";

test("parseArgs: update defaults to latest channel", () => {
  expect(parseArgs(["update"])).toEqual({ command: "update", channel: "latest", json: false, yes: false });
});
test("parseArgs: update --channel stable --pin", () => {
  const p = parseArgs(["update", "--channel", "stable", "--pin", "2.1.175"]);
  expect(p).toMatchObject({ command: "update", channel: "stable", pin: "2.1.175" });
});
test("parseArgs: rollback --to", () => {
  expect(parseArgs(["rollback", "--to", "2.1.170"])).toMatchObject({ command: "rollback", to: "2.1.170" });
});
test("parseArgs: prune --keep, schedule --every, global --json", () => {
  expect(parseArgs(["prune", "--keep", "3"])).toMatchObject({ command: "prune", keep: 3 });
  expect(parseArgs(["schedule", "--every", "12"])).toMatchObject({ command: "schedule", everyHours: 12 });
  expect(parseArgs(["status", "--json"])).toMatchObject({ command: "status", json: true });
});
test("parseArgs: unknown command throws", () => {
  expect(() => parseArgs(["frobnicate"])).toThrow(/unknown command/);
});
