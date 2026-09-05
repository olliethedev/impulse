#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Engine } from "./engine.ts";
import { Store } from "./store.ts";
import { paths, type Paths } from "./paths.ts";
import { loadDefinition, parseSettings } from "./config.ts";
import { ImpulseError, message, requireThat } from "./errors.ts";
import { duration, firstDue, nextCalendar, timestamp } from "./schedule.ts";
import { alive, bootId, elapsedClock, selfCommand } from "./platform.ts";
import { daemon, explicitPaths, runner, startDaemon, supervise } from "./runtime.ts";
import { startup, startupStatus } from "./startup.ts";
import { installSkill, skillDirectory, uninstallSkill } from "./skill.ts";
import { deliverPending, prune, retryNotification } from "./maintenance.ts";
import { activeStatuses, type Context } from "./types.ts";

const help = `Impulse 0.1.0 — durable local scheduling for scripts and agents

Usage: impulse <group> <command> [arguments] [options]

  setup --harness NAME --terminal NAME [--startup enable] [--skill NAME]
  config show | apply FILE
  daemon start | stop | status
  startup enable | disable | status
  doctor
  task validate FILE | preview FILE [--at TIME]
  task register FILE [--name NAME] [--harness NAME] [--terminal NAME] [--disabled]
  task update TASK [--file FILE] [--harness NAME] [--terminal NAME]
                   [--clear-harness] [--clear-terminal]
  task list | show TASK | remove TASK
  task next [TASK] --at TIME | --after DURATION
  task disable [TASK] | enable TASK [--now | --at TIME]
  task run TASK [--reset-next]
  run list [--task TASK] | show RUN | wait RUN | logs RUN [--follow]
  run stop RUN [--force]                 (does not disable future runs)
  run confirm-ended RUN --reason TEXT   (operator verification of uncertain work)
  agent request --instructions TEXT | --instructions-file FILE [--no-wait]
  agent show ID | wait ID
  agent finish --outcome success|failed --summary TEXT
  agent handle ID --reason TEXT
  agent resolve ID --outcome success|failed --reason TEXT
  notification list | retry ID
  history prune [--task TASK] [--apply]
  skill install [--harness NAME] [--scope user|project] [--dir PATH]
  skill uninstall --dir PATH

Global: --json, --context PATH, --request-id KEY, --help, --version
Use --current with run show/logs inside a run. Mutations never require prompts.
Durations: positive integer s/m/h/d. Times: RFC 3339 with UTC offset.
All work uses your harness's existing authentication and permissions.
`;
const booleanOptions = ["json", "help", "version", "disabled", "now", "reset-next", "no-wait", "force", "follow", "current", "apply", "clear-harness", "clear-terminal", "non-interactive"];
const stringOptions = ["context", "request-id", "harness", "terminal", "name", "file", "at", "after", "task", "instructions", "instructions-file", "outcome", "summary", "reason", "startup", "skill", "scope", "dir"];
const parsed = () => parseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true, options: Object.fromEntries([...booleanOptions.map(name => [name, { type: "boolean" as const }]), ...stringOptions.map(name => [name, { type: "string" as const }])]) });
function publicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["token", "runner_nonce", "ticket", "elapsed", "registered_clock", "finished_clock"].includes(key)).map(([key, value]) => [key, typeof value === "number" && ["at", "registered_at", "created_at", "finished_at", "ended_at", "launch_at", "heartbeat", "until", "tick"].includes(key) ? new Date(value).toISOString() : publicValue(value)]));
  return value;
}
function waitCode(status: string) { return status === "failed" ? 10 : status === "unconfirmed" ? 11 : ["interrupted", "cancelled"].includes(status) ? 12 : 0; }
async function waitFor(engine: Engine, kind: "run" | "agent", id: string) {
  while (true) {
    const result = kind === "run" ? engine.run(id) : engine.agent(id);
    if (!activeStatuses.includes(result.status)) { process.exitCode = waitCode(result.status); return result; }
    await Bun.sleep(250);
  }
}
export async function main() {
  if (process.argv[2] === "_runner") { await runner(process.argv[3]!); return; }
  if (["_daemon", "_supervise"].includes(process.argv[2]!)) {
    const p = explicitPaths(process.argv[3]!, process.argv[4]!);
    if (process.argv[2] === "_daemon") await daemon(p); else await supervise(p); return;
  }
  let json = process.argv.includes("--json"), store: Store | undefined;
  try {
    const args = parsed(), positionals = args.positionals;
    const values = args.values as Record<string, string | boolean | undefined>; json = values.json === true;
    const [group, command, arg] = positionals;
    if (values.version) { console.log(json ? JSON.stringify({ schema_version: 1, ok: true, data: { version: "0.1.0" } }) : "0.1.0"); return; }
    if (values.help || !group) { if (json) console.log(JSON.stringify({ schema_version: 1, ok: true, data: { help } })); else console.log(help); return; }
    const option = (name: string) => typeof values[name] === "string" ? values[name] as string : undefined;
    const required = (name: string): string => { const v = option(name); requireThat(v !== undefined && v.trim(), "MISSING_OPTION", `--${name} is required`); return v; };
    const needArg = (): string => { requireThat(arg !== undefined && arg.trim(), "MISSING_ARGUMENT", `${group} ${command} requires an argument`); return arg; };
    const allow = (...flags: string[]) => {
      for (const key of Object.keys(values)) requireThat(["json", "context", "request-id", "help", "version", ...flags].includes(key), "INVALID_OPTION", `--${key} is not valid for ${group} ${command ?? ""}`);
    };
    requireThat(positionals.length <= 3, "INVALID_ARGUMENT", "Unexpected extra positional arguments");
    const contextFile = option("context") ?? process.env.IMPULSE_CONTEXT;
    let context: Context | undefined, p = paths();
    if (contextFile) {
      const loaded = JSON.parse(readFileSync(resolve(contextFile), "utf8")) as Context & { paths?: Paths };
      requireThat(typeof loaded.token === "string" && typeof loaded.run_id === "string", "INVALID_CONTEXT", "Invalid context file", 4);
      context = loaded; if (loaded.paths) p = loaded.paths;
    }
    store = new Store(p); const engine = new Engine(store, Date.now, elapsedClock);
    const mutate = <T>(fn: () => T, input?: unknown): T => engine.receipt(`${context?.agent_id ?? context?.run_id ?? "operator"}:${group}:${command ?? ""}`, option("request-id"), { positionals, values: Object.fromEntries(Object.entries(values).filter(([k]) => !["request-id", "json"].includes(k))), input }, fn);
    const currentRun = () => { if (values.current) { requireThat(context, "CONTEXT_REQUIRED", "--current requires a run context", 4); return context.run_id; } return needArg(); };
    const requireContext = () => { requireThat(context, "CONTEXT_REQUIRED", "This command requires an Impulse run context", 4); return context; };
    const outcome = () => { const value = required("outcome"); requireThat(["success", "failed"].includes(value), "INVALID_OUTCOME", "Outcome must be success or failed"); return value === "success" ? "succeeded" as const : "failed" as const; };
    let result: unknown;
    if (group === "setup") {
      allow("harness", "terminal", "startup", "skill", "non-interactive");
      requireThat(!command, "INVALID_ARGUMENT", "Setup accepts options only");
      if (option("startup")) requireThat(required("startup") === "enable", "INVALID_OPTION", "Setup --startup accepts enable");
      const skillDir = option("skill") ? skillDirectory(required("skill"), "user") : undefined;
      const settings = engine.settings();
      if (option("harness")) settings.defaults.harness = required("harness");
      if (option("terminal")) settings.defaults.terminal = required("terminal");
      const validated = parseSettings(Bun.TOML.stringify(settings)!);
      result = mutate(() => engine.applySettings(validated), validated);
      writeFileSync(join(p.config, "settings.toml"), Bun.TOML.stringify(validated)!, { mode: 0o600 });
      if (option("startup")) { startup(p, true); await startDaemon(engine); }
      if (skillDir) installSkill(skillDir);
    } else if (group === "config") {
      allow();
      if (command === "show") result = engine.settings();
      else if (command === "apply") { const settings = parseSettings(readFileSync(needArg(), "utf8")); result = mutate(() => engine.applySettings(settings), settings); writeFileSync(join(p.config, "settings.toml"), Bun.TOML.stringify(settings)!, { mode: 0o600 }); }
      else throw new ImpulseError("UNKNOWN_COMMAND", "Use config show or config apply FILE");
    } else if (group === "daemon") {
      allow();
      if (command === "start") result = await startDaemon(engine);
      else if (command === "stop") result = mutate(() => engine.stopDaemon()) ?? { enabled: false };
      else if (command === "status") { const lease = engine.lease(); result = { ...lease, running: !!lease?.enabled && lease.until > Date.now() && lease.boot_id === bootId() && alive(lease.pid) }; }
      else throw new ImpulseError("UNKNOWN_COMMAND", "Use daemon start, stop, or status");
    } else if (group === "startup") {
      allow(); requireThat(["enable", "disable", "status"].includes(command!), "UNKNOWN_COMMAND", "Use startup enable, disable, or status");
      result = command === "status" ? startupStatus(p) : startup(p, command === "enable");
      if (command === "enable") await startDaemon(engine);
    } else if (group === "doctor") {
      allow(); requireThat(!command, "INVALID_ARGUMENT", "doctor accepts no subcommand");
      const settings = engine.settings(), harness = settings.defaults.harness, terminal = settings.defaults.terminal;
      const harnessCommand = settings.harnesses[harness]?.command[0] ?? (harness === "claude-code" ? "claude" : harness);
      const terminalCommand = settings.terminals[terminal]?.command[0] ?? ({ "terminal-app": "osascript", "windows-terminal": "wt.exe", yakuake: Bun.which("qdbus6") ? "qdbus6" : "qdbus" }[terminal] ?? terminal);
      result = { version: "0.1.0", platform: process.platform, architecture: process.arch, paths: p, executable: selfCommand(), harness: { name: harness, executable: Bun.which(harnessCommand!) }, terminal: { name: terminal, executable: Bun.which(terminalCommand!) }, capacity: engine.capacity(), daemon: engine.lease(), settings_source: join(p.config, "settings.toml"), settings_note: "Settings in SQLite are applied; edit settings.toml then run config apply to change them." };
    } else if (group === "task") {
      if (command === "validate" || command === "preview") {
        allow(...(command === "preview" ? ["at"] : []));
        const loaded = loadDefinition(needArg()), at = option("at") ? timestamp(required("at")) : Date.now();
        const due = firstDue(loaded.definition, at), occurrences = [due];
        if (command === "preview" && loaded.definition.schedule?.kind === "calendar") for (let i = 0; i < 4; i++) occurrences.push(nextCalendar(loaded.definition.schedule, occurrences.at(-1)!.at, loaded.definition.policy.catch_up));
        result = { valid: true, ...loaded, ...(command === "preview" ? { occurrences } : {}) };
      } else if (command === "register") {
        allow("name", "harness", "terminal", "disabled");
        const loaded = loadDefinition(needArg());
        result = mutate(() => engine.register(loaded, { ...(option("name") ? { name: required("name") } : {}), ...(option("harness") ? { harness: required("harness") } : {}), ...(option("terminal") ? { terminal: required("terminal") } : {}), disabled: !!values.disabled }), loaded.hash); await startDaemon(engine);
      } else if (command === "update") {
        allow("file", "harness", "terminal", "clear-harness", "clear-terminal");
        requireThat(!(values["clear-harness"] && option("harness")) && !(values["clear-terminal"] && option("terminal")), "INVALID_OPTION", "Cannot set and clear the same override");
        const task = engine.task(needArg()), loaded = loadDefinition(option("file") ?? task.source);
        result = mutate(() => engine.update(task.id, loaded, { ...(values["clear-harness"] ? { harness: null } : option("harness") ? { harness: required("harness") } : {}), ...(values["clear-terminal"] ? { terminal: null } : option("terminal") ? { terminal: required("terminal") } : {}) }), loaded.hash); await startDaemon(engine);
      } else if (command === "list") { allow(); result = engine.tasks(); }
      else if (command === "show") {
        allow(); const task = engine.task(needArg()); let drift: boolean | string;
        try { drift = loadDefinition(task.source).hash !== task.source_hash; } catch (error) { drift = message(error); }
        result = { ...task, source_drift: drift, latest_run: task.last_run ? engine.run(task.last_run) : null };
      } else if (command === "next") {
        allow("at", "after"); requireThat(!!option("at") !== !!option("after"), "INVALID_OPTION", "Supply exactly one of --at and --after");
        result = mutate(() => engine.next(arg, option("at") ? { at: timestamp(required("at"), Date.now()), source: "explicit" } : engine.after(required("after")), context));
      } else if (command === "disable") { allow(); result = mutate(() => engine.disable(arg, context)); }
      else if (command === "enable") {
        allow("now", "at"); requireThat(!(values.now && option("at")), "INVALID_OPTION", "Use only --now or --at");
        result = mutate(() => engine.enable(needArg(), values.now ? Date.now() : option("at") ? timestamp(required("at"), Date.now()) : undefined));
      } else if (command === "run") { allow("reset-next"); result = mutate(() => engine.manual(needArg(), !!values["reset-next"])); await startDaemon(engine); }
      else if (command === "remove") { allow(); result = mutate(() => engine.remove(needArg())); }
      else throw new ImpulseError("UNKNOWN_COMMAND", "Unknown task command; use --help");
    } else if (group === "run") {
      if (command === "list") { allow("task"); result = engine.runs(option("task")); }
      else if (command === "show") { allow("current"); const id = currentRun(); result = { ...engine.run(id), agents: engine.agents(id), events: engine.events(id) }; }
      else if (command === "wait") { allow(); result = await waitFor(engine, "run", needArg()); }
      else if (command === "stop") { allow("force"); result = mutate(() => engine.stop(needArg(), !!values.force)); }
      else if (command === "confirm-ended") { allow("reason"); requireThat(!context, "OPERATOR_REQUIRED", "Confirmation is an operator command; unset the run context", 4); result = mutate(() => engine.confirmEnded(needArg(), required("reason"), alive)); }
      else if (command === "logs") {
        allow("current", "follow"); const id = currentRun(); engine.run(id); const file = join(p.logs, `${id}.log`);
        if (!values.follow) result = { run_id: id, log: existsSync(file) ? readFileSync(file, "utf8") : "", events: engine.events(id) };
        else {
          let offset = 0;
          do {
            const text = existsSync(file) ? readFileSync(file, "utf8") : "";
            if (text.length > offset) { const chunk = text.slice(offset); if (json) console.log(JSON.stringify({ schema_version: 1, ok: true, data: { run_id: id, log: chunk } })); else process.stdout.write(chunk); offset = text.length; }
            if (!activeStatuses.includes(engine.run(id).status)) break;
            await Bun.sleep(250);
          } while (true);
          return;
        }
      } else throw new ImpulseError("UNKNOWN_COMMAND", "Unknown run command; use --help");
    } else if (group === "agent") {
      if (command === "request") {
        allow("instructions", "instructions-file", "no-wait");
        requireThat(!!option("instructions") !== !!option("instructions-file"), "INVALID_OPTION", "Supply exactly one instructions source");
        const instructions = option("instructions") ?? readFileSync(required("instructions-file"), "utf8");
        const agent = mutate(() => engine.request(requireContext(), instructions), instructions);
        result = values["no-wait"] ? agent : await waitFor(engine, "agent", agent.id);
      } else if (command === "show") { allow(); result = engine.agent(needArg()); }
      else if (command === "wait") { allow(); result = await waitFor(engine, "agent", needArg()); }
      else if (command === "finish") { allow("outcome", "summary"); result = mutate(() => engine.finish(requireContext(), outcome(), required("summary"))); }
      else if (command === "handle") { allow("reason"); result = mutate(() => engine.handle(requireContext(), needArg(), required("reason"))); }
      else if (command === "resolve") { allow("outcome", "reason"); requireThat(!context, "OPERATOR_REQUIRED", "Resolution is an operator command; unset the run context", 4); result = mutate(() => engine.resolve(needArg(), outcome(), required("reason"))); }
      else throw new ImpulseError("UNKNOWN_COMMAND", "Unknown agent command; use --help");
    } else if (group === "notification") {
      allow(); if (command === "list") result = store.all("notifications");
      else if (command === "retry") { mutate(() => retryNotification(engine, needArg())); await deliverPending(engine); result = store.get("notifications", needArg()); }
      else throw new ImpulseError("UNKNOWN_COMMAND", "Use notification list or retry ID");
    } else if (group === "history") { allow("task", "apply"); requireThat(command === "prune", "UNKNOWN_COMMAND", "Use history prune"); result = mutate(() => prune(engine, option("task"), !!values.apply)); }
    else if (group === "skill") {
      allow("dir", "harness", "scope");
      if (command === "install") result = installSkill(option("dir") ?? skillDirectory(option("harness") ?? engine.settings().defaults.harness, option("scope") ?? "user"));
      else if (command === "uninstall") result = uninstallSkill(required("dir"));
      else throw new ImpulseError("UNKNOWN_COMMAND", "Use skill install or uninstall");
    } else throw new ImpulseError("UNKNOWN_COMMAND", "Unknown command; use impulse --help");
    const data = publicValue(result);
    console.log(json ? JSON.stringify({ schema_version: 1, ok: true, data }) : JSON.stringify(data, null, 2));
  } catch (error) {
    const invalid = error instanceof Error && "code" in error && typeof error.code === "string" && error.code.startsWith("ERR_PARSE_ARGS");
    const expected = error instanceof ImpulseError ? error : new ImpulseError(invalid ? "INVALID_ARGUMENT" : "INTERNAL_ERROR", message(error), invalid ? 2 : 1);
    process.exitCode = expected.exitCode;
    const result = { schema_version: 1, ok: false, error: { code: expected.code, message: expected.message, retryable: expected.retryable } };
    if (json) console.log(JSON.stringify(result)); else console.error(`${expected.code}: ${expected.message}`);
  } finally { store?.close(); }
}
// This is the executable entrypoint. Compiled Windows builds do not reliably set import.meta.main.
await main();
