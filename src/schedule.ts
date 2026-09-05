import { CronExpressionParser } from "cron-parser";
import { requireThat } from "./errors.ts";
import type { Definition, Due, Schedule } from "./types.ts";

export function duration(value: string): number {
  const match = /^([1-9]\d*)(s|m|h|d)$/.exec(value);
  requireThat(match, "INVALID_DURATION", `Expected a positive duration such as 30m or 24h; got ${value}`);
  const n = Number(match[1]) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]!]!);
  requireThat(Number.isSafeInteger(n), "INVALID_DURATION", "Duration is too large");
  return n;
}
export function timestamp(value: string, now?: number): number {
  requireThat(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value), "INVALID_TIME", "Use an RFC 3339 timestamp with seconds and UTC offset");
  const n = Date.parse(value);
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  requireThat(days !== undefined && day >= 1 && day <= days, "INVALID_TIME", "Timestamp contains an invalid calendar date");
  requireThat(Number.isFinite(n) && (now === undefined || n > now), "INVALID_TIME", "Timestamp must be valid and in the future");
  return n;
}
export function localZone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
export function zone(schedule: Schedule | undefined): string {
  return schedule?.kind === "calendar" && schedule.timezone !== "local" ? schedule.timezone : localZone();
}
const formatters = new Map<string, Intl.DateTimeFormat>();
function wallTime(at: number, tz: string): number {
  let formatter = formatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(tz, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(at).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!);
}
export function nominal(at: number, tz: string): string { return new Date(wallTime(at, tz)).toISOString().slice(0, 16); }

export function validateCron(cron: string, tz: string) {
  requireThat(cron.trim().split(/\s+/).length === 5 && /^[\d*,/\s-]+$/.test(cron), "INVALID_CRON", "Use five numeric cron fields (wildcards, lists, ranges, and steps)");
  new Intl.DateTimeFormat("en", { timeZone: tz });
  CronExpressionParser.parse(cron, { tz });
}

/** Cron supplies candidate dates; Impulse owns first-valid-gap and first-fold policy. */
export function nextCalendar(schedule: Extract<Schedule, { kind: "calendar" }>, after: number, catchUp: "once" | "skip" = "once"): Due {
  const tz = zone(schedule);
  const expression = CronExpressionParser.parse(schedule.cron, { currentDate: after, tz });
  const wallExpression = CronExpressionParser.parse(schedule.cron, { tz: "UTC" });
  for (let attempt = 0; attempt < 400; attempt++) {
    const candidate = expression.next().getTime();
    const wall = wallTime(candidate, tz);
    // A fold may be 30, 60, 120 minutes, or historically longer. Only the first occurrence is eligible.
    let repeated = false;
    for (const delta of [30, 60, 90, 120, 180]) {
      if (wallTime(candidate - delta * 60000, tz) === wall) { repeated = true; break; }
    }
    if (repeated) continue;
    // Locate a forward transition on the candidate's local day, then match skipped nominal minutes.
    const start = candidate - 6 * 3600000;
    let previous = wallTime(start, tz);
    for (let at = start + 60000; at <= candidate; at += 60000) {
      const current = wallTime(at, tz);
      if (current - previous > 60000) {
        let missed = false;
        for (let w = previous + 60000; w < current; w += 60000) {
          if (wallExpression.includesDate(new Date(w))) { missed = true; break; }
        }
        if (missed && at > after && catchUp === "once") return { at, source: "calendar", nominal: nominal(at, tz) };
      }
      previous = current;
    }
    // cron-parser shifts nonexistent nominal times; skip that synthetic candidate.
    if (!wallExpression.includesDate(new Date(wall))) continue;
    return { at: candidate, source: "calendar", nominal: nominal(candidate, tz) };
  }
  throw new Error("Could not find an eligible calendar occurrence");
}
export function firstDue(definition: Definition, registeredAt: number): Due {
  const first = definition.first_run;
  switch (first.kind) {
    case "now": return { at: registeredAt, source: "first" };
    case "at": return { at: timestamp(first.at), source: "first" };
    case "after": return { at: registeredAt + duration(first.delay), source: "first" };
    case "schedule": {
      requireThat(definition.schedule?.kind === "calendar", "INVALID_CONFIG", "first_run schedule requires calendar recurrence");
      return nextCalendar(definition.schedule, registeredAt, definition.policy.catch_up);
    }
  }
}
