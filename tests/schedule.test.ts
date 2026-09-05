import { expect, test } from "bun:test";
import { nextCalendar, duration, timestamp } from "../src/schedule.ts";
const calendar = (cron: string) => ({ kind: "calendar" as const, cron, timezone: "America/New_York" });
test("the spring gap catches up at the first valid minute, or skips by policy", () => {
  const at = Date.parse("2026-03-08T05:00:00Z");
  expect(new Date(nextCalendar(calendar("30 2 * * *"), at).at).toISOString()).toBe("2026-03-08T07:00:00.000Z");
  expect(new Date(nextCalendar(calendar("30 2 * * *"), at, "skip").at).toISOString()).toBe("2026-03-09T06:30:00.000Z");
});
test("the autumn fold uses only the first occurrence, including restart between folds", () => {
  expect(new Date(nextCalendar(calendar("30 1 * * *"), Date.parse("2026-11-01T04:00:00Z")).at).toISOString()).toBe("2026-11-01T05:30:00.000Z");
  expect(new Date(nextCalendar(calendar("30 1 * * *"), Date.parse("2026-11-01T05:40:00Z")).at).toISOString()).toBe("2026-11-02T06:30:00.000Z");
});
test("duration and timestamp inputs require explicit valid timing", () => {
  expect(duration("24h")).toBe(86400000);
  expect(() => duration("0h")).toThrow(); expect(() => duration("1month")).toThrow();
  expect(() => timestamp("2026-09-04T09:00:00")).toThrow();
});
