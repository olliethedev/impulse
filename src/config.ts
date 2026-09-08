import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";
import { ImpulseError, message, requireThat } from "./errors.ts";
import { duration, timestamp, validateCron, localZone } from "./schedule.ts";
import type { Definition, ExecutionProfile, Profile, Settings } from "./types.ts";

type Table = Record<string, unknown>;
function table(value: unknown, allowed: string[], label: string): Table {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_CONFIG", `${label} must be a table`);
  const result = value as Table;
  for (const key of Object.keys(result)) requireThat(allowed.includes(key), "INVALID_CONFIG", `Unknown field ${label}.${key}`);
  return result;
}
function str(value: unknown, label: string): string {
  requireThat(typeof value === "string" && value.trim().length > 0 && !value.includes("\0"), "INVALID_CONFIG", `${label} must be a nonempty string without NUL`);
  return value;
}
function bool(value: unknown, fallback: boolean, label: string): boolean {
  requireThat(value === undefined || typeof value === "boolean", "INVALID_CONFIG", `${label} must be boolean`);
  return value === undefined ? fallback : value;
}
function choice<T extends string>(value: unknown, options: readonly T[], label: string): T {
  requireThat(typeof value === "string" && options.includes(value as T), "INVALID_CONFIG", `${label} must be ${options.join(" or ")}`);
  return value as T;
}
function integer(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  requireThat(typeof value === "number" && Number.isSafeInteger(value) && value > 0, "INVALID_CONFIG", `${label} must be a positive integer`);
  return value;
}
function command(value: unknown, label: string): string[] {
  requireThat(Array.isArray(value) && value.length > 0, "INVALID_CONFIG", `${label} must be a nonempty argument array`);
  return value.map((v, i) => {
    requireThat(typeof v === "string" && !v.includes("\0") && (i !== 0 || v.length > 0), "INVALID_CONFIG", `${label}[${i}] must be a string without NUL`);
    return v;
  });
}
function retention(value: unknown, defaults: { history?: string; logs?: string } = {}) {
  const t = table(value ?? {}, ["history", "logs"], "retention");
  const result = { ...defaults };
  for (const key of ["history", "logs"] as const) {
    if (t[key] !== undefined) {
      const v = str(t[key], `retention.${key}`);
      if (v !== "forever") duration(v);
      result[key] = v;
    }
  }
  return result;
}

export interface LoadedDefinition { path: string; hash: string; definition: Definition }
export function loadDefinition(file: string): LoadedDefinition {
  try {
    const path = realpathSync(file);
    const raw = readFileSync(path, "utf8");
    const value = table(Bun.TOML.parse(raw), ["schema_version", "name", "cwd", "work", "first_run", "schedule", "policy", "notifications", "retention"], "task");
    requireThat(value.schema_version === 1, "INVALID_CONFIG", "schema_version must be 1");
    const work = table(value.work, ["kind", "command", "instructions", "instructions_file"], "work");
    const kind = choice(work.kind, ["script", "agent"], "work.kind");
    let resolvedWork: Definition["work"];
    if (kind === "script") {
      table(work, ["kind", "command"], "work");
      resolvedWork = { kind, command: command(work.command, "work.command") };
    } else {
      table(work, ["kind", "instructions", "instructions_file"], "work");
      requireThat((work.instructions !== undefined) !== (work.instructions_file !== undefined), "INVALID_CONFIG", "Agent work needs exactly one of instructions and instructions_file");
      const instructions = work.instructions_file === undefined ? str(work.instructions, "work.instructions") : readFileSync(resolve(dirname(path), str(work.instructions_file, "work.instructions_file")), "utf8");
      resolvedWork = { kind, instructions: str(instructions, "agent instructions") };
    }
    const first = table(value.first_run, ["kind", "at", "delay"], "first_run");
    const firstKind = choice(first.kind, ["now", "at", "after", "schedule"], "first_run.kind");
    table(first, firstKind === "at" ? ["kind", "at"] : firstKind === "after" ? ["kind", "delay"] : ["kind"], "first_run");
    let firstRun: Definition["first_run"];
    if (firstKind === "at") { const at = str(first.at, "first_run.at"); timestamp(at); firstRun = { kind: firstKind, at }; }
    else if (firstKind === "after") { const delay = str(first.delay, "first_run.delay"); duration(delay); firstRun = { kind: firstKind, delay }; }
    else firstRun = { kind: firstKind };
    let schedule: Definition["schedule"];
    if (value.schedule !== undefined) {
      const s = table(value.schedule, ["kind", "cron", "timezone", "after"], "schedule");
      if (s.kind === "calendar") {
        table(s, ["kind", "cron", "timezone"], "schedule");
        const cron = str(s.cron, "schedule.cron"), timezone = str(s.timezone ?? "local", "schedule.timezone");
        validateCron(cron, timezone === "local" ? localZone() : timezone);
        schedule = { kind: "calendar", cron, timezone };
      } else {
        requireThat(s.kind === "completion", "INVALID_CONFIG", "schedule.kind must be calendar or completion");
        table(s, ["kind", "after"], "schedule");
        const after = str(s.after, "schedule.after"); duration(after); schedule = { kind: "completion", after };
      }
    }
    requireThat(firstKind !== "schedule" || schedule?.kind === "calendar", "INVALID_CONFIG", "first_run schedule requires a calendar schedule");
    const policy = table(value.policy ?? {}, ["catch_up", "overlap", "hold_after_interruption", "interruption_retry"], "policy");
    const retry = table(policy.interruption_retry ?? {}, ["enabled", "max_attempts", "delay"], "policy.interruption_retry");
    const retryDelay = str(retry.delay ?? "5m", "interruption_retry.delay"); duration(retryDelay);
    const notifications = table(value.notifications ?? {}, ["on_success", "on_failure", "on_interruption"], "notifications");
    const cwd = resolve(dirname(path), str(value.cwd, "cwd"));
    requireThat(statSync(cwd).isDirectory(), "INVALID_CONFIG", `Working directory does not exist: ${cwd}`);
    const definition: Definition = {
      schema_version: 1, name: str(value.name, "name"), cwd, work: resolvedWork, first_run: firstRun,
      ...(schedule ? { schedule } : {}),
      policy: { catch_up: choice(policy.catch_up ?? "once", ["once", "skip"], "policy.catch_up"), overlap: choice(policy.overlap ?? "skip", ["skip", "queue_one"], "policy.overlap"), hold_after_interruption: bool(policy.hold_after_interruption, false, "policy.hold_after_interruption"), interruption_retry: { enabled: bool(retry.enabled, false, "interruption_retry.enabled"), max_attempts: integer(retry.max_attempts, 1, "interruption_retry.max_attempts"), delay: retryDelay } },
      retention: retention(value.retention),
      notifications: { on_success: bool(notifications.on_success, false, "notifications.on_success"), on_failure: bool(notifications.on_failure, true, "notifications.on_failure"), on_interruption: bool(notifications.on_interruption, true, "notifications.on_interruption") },
    };
    return { path, definition, hash: createHash("sha256").update(raw).update(JSON.stringify(resolvedWork)).digest("hex") };
  } catch (error) {
    if (error instanceof ImpulseError) throw error;
    throw new ImpulseError("INVALID_CONFIG", `${file}: ${message(error)}`);
  }
}
export function defaultSettings(): Settings {
  return { schema_version: 1, defaults: { harness: "codex", terminal: process.platform === "win32" ? "windows-terminal" : process.platform === "darwin" ? "terminal-app" : "konsole" }, limits: { agents: 10 }, retention: { history: "forever", logs: "30d" }, notifications: { desktop: true }, harnesses: {}, terminals: {} };
}
export function parseSettings(raw: string): Settings {
  try {
    const v = table(Bun.TOML.parse(raw), ["schema_version", "defaults", "limits", "retention", "notifications", "harnesses", "terminals", "trust"], "settings");
    requireThat(v.schema_version === 1, "INVALID_CONFIG", "schema_version must be 1");
    const defaults = defaultSettings();
    const d = table(v.defaults ?? {}, ["harness", "terminal"], "defaults"), l = table(v.limits ?? {}, ["agents"], "limits"), n = table(v.notifications ?? {}, ["desktop", "command"], "notifications");
    function profiles(value: unknown, label: string): Record<string, Profile> {
      const values = value ?? {};
      requireThat(values !== null && typeof values === "object" && !Array.isArray(values), "INVALID_CONFIG", `${label} must be a table`);
      const result: Record<string, Profile> = {};
      for (const [name, value] of Object.entries(values)) {
        requireThat(!["__proto__", "prototype", "constructor"].includes(name), "INVALID_CONFIG", "Invalid profile name");
        const p = table(value, ["command", "lifecycle"], `${label}.${name}`);
        const cmd = command(p.command, `${label}.${name}.command`);
        requireThat(cmd.slice(1).includes("{launch_file}") && cmd.filter(x => x.includes("{launch_file}")).every(x => x === "{launch_file}"), "INVALID_CONFIG", "Custom commands require a whole-argument {launch_file} placeholder after the executable");
        result[name] = { command: cmd, lifecycle: choice(p.lifecycle ?? "process", ["process", "external"], `${label}.${name}.lifecycle`) };
      }
      return result;
    }
    const result: Settings = { schema_version: 1, defaults: { harness: str(d.harness ?? defaults.defaults.harness, "defaults.harness"), terminal: str(d.terminal ?? defaults.defaults.terminal, "defaults.terminal") }, limits: { agents: integer(l.agents, 10, "limits.agents") }, retention: retention(v.retention, defaults.retention) as Settings["retention"], notifications: { desktop: bool(n.desktop, true, "notifications.desktop"), ...(n.command === undefined ? {} : { command: command(n.command, "notifications.command") }) }, harnesses: profiles(v.harnesses, "harnesses"), terminals: profiles(v.terminals, "terminals") };
    if (v.trust !== undefined) {
      const trust = table(v.trust, ["roots"], "trust");
      requireThat(Array.isArray(trust.roots), "INVALID_CONFIG", "trust.roots must be an array of absolute directory paths");
      result.trust = { roots: [...new Set(trust.roots.map((value, i) => {
        const path = str(value, `trust.roots[${i}]`);
        requireThat(isAbsolute(path), "INVALID_CONFIG", "trust.roots must use absolute paths (no ~ expansion)");
        requireThat(statSync(path).isDirectory(), "INVALID_CONFIG", `Trust root is not a directory: ${path}`);
        return realpathSync(path);
      }))] };
    }
    executionProfile(result, {});
    return result;
  } catch (error) {
    if (error instanceof ImpulseError) throw error;
    throw new ImpulseError("INVALID_CONFIG", message(error));
  }
}
export function executionProfile(settings: Settings, overrides: { harness?: string; terminal?: string }): ExecutionProfile {
  const harness = overrides.harness ?? settings.defaults.harness, terminal = overrides.terminal ?? settings.defaults.terminal;
  requireThat(["codex", "claude-code"].includes(harness) || Object.hasOwn(settings.harnesses, harness), "INVALID_PROFILE", `Unknown harness: ${harness}`);
  requireThat(["konsole", "yakuake", "terminal-app", "windows-terminal"].includes(terminal) || Object.hasOwn(settings.terminals, terminal), "INVALID_PROFILE", `Unknown terminal: ${terminal}`);
  return { harness, terminal, ...(settings.harnesses[harness] ? { harness_profile: settings.harnesses[harness] } : {}), ...(settings.terminals[terminal] ? { terminal_profile: settings.terminals[terminal] } : {}) };
}
