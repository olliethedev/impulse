import { requireThat } from "./errors.ts";
import { readFileSync, statSync } from "node:fs";
import type { Observation } from "./types.ts";

export function loadObservation(file: string): Observation {
  const stat = statSync(file);
  requireThat(stat.isFile() && stat.size <= 16384, "INVALID_OBSERVATION", "Observation must be a regular JSON file of at most 16 KiB");
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch { requireThat(false, "INVALID_OBSERVATION", "Observation file must contain valid JSON"); }
  return parseObservation(value);
}

/** Deliberately excludes prompts, tool arguments, outputs and arbitrary transcript fields. */
export function parseObservation(value: unknown): Observation {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_OBSERVATION", "Observation must be a JSON object");
  const v = value as Record<string, unknown>;
  requireThat(Object.keys(v).every(k => ["state", "session_id", "turn_id", "active_tools", "error", "note"].includes(k)), "INVALID_OBSERVATION", "Unknown observation field");
  requireThat(["active", "idle", "failed", "unavailable"].includes(v.state as string), "INVALID_OBSERVATION", "state must be active, idle, failed or unavailable");
  const result: Observation = { state: v.state as Observation["state"] };
  for (const key of ["session_id", "turn_id", "note"] as const) if (v[key] !== undefined) result[key] = text(v[key], key, key === "note" ? 1024 : 256);
  if (v.active_tools !== undefined) {
    requireThat(Number.isSafeInteger(v.active_tools) && (v.active_tools as number) >= 0, "INVALID_OBSERVATION", "active_tools must be a nonnegative integer; omit it when unknown");
    result.active_tools = v.active_tools as number;
  }
  if (v.error !== undefined) {
    requireThat(v.error !== null && typeof v.error === "object" && !Array.isArray(v.error), "INVALID_OBSERVATION", "error must contain code and message");
    const e = v.error as Record<string, unknown>;
    requireThat(Object.keys(e).every(k => ["code", "message"].includes(k)), "INVALID_OBSERVATION", "Unknown error field");
    result.error = { code: text(e.code, "error.code", 128), message: text(e.message, "error.message", 4096) };
  }
  requireThat((result.state === "failed") === (result.error !== undefined), "INVALID_OBSERVATION", "Only failed observations require an error");
  return result;
}
function text(value: unknown, name: string, max: number): string {
  requireThat(typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "INVALID_OBSERVATION", `${name} must be nonempty text of at most ${max} characters without control characters`);
  return value;
}
