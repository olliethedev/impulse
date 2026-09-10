import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Engine, type Ticket } from "./engine.ts";
import { Store } from "./store.ts";
import { paths, type Paths } from "./paths.ts";
import { ImpulseError, message } from "./errors.ts";
import { alive, bootId, detach, elapsedClock, groupAlive, privateJson, selfCommand, stopChild, type ProcessHandle } from "./platform.ts";
import { assignmentInstructions, launchTerminal, substitute, type LaunchDescriptor } from "./adapters.ts";
import { deliverPending, prune } from "./maintenance.ts";
import { windowsCommand } from "./windows.ts";
import { terminalProcess, type TerminalProcess, type ExecutionExit } from "./terminal-process.ts";
import { prepareProjectTrust } from "./project-trust.ts";

export async function startDaemon(engine: Engine) {
  const current = engine.lease();
  if (current?.enabled && current.until > Date.now() && current.boot_id === bootId() && alive(current.pid)) return current;
  const log = openSync(join(engine.store.paths.state, "daemon.log"), "a", 0o600);
  try { await detach([...selfCommand(), "_daemon", engine.store.paths.state, engine.store.paths.config], process.env, log); }
  finally { closeSync(log); }
  for (let i = 0; i < 100; i++) {
    await Bun.sleep(100); const lease = engine.lease();
    if (lease?.enabled && lease.until > Date.now() && lease.boot_id === bootId() && alive(lease.pid)) return lease;
  }
  throw new ImpulseError("DAEMON_UNAVAILABLE", `Scheduler did not start; inspect ${join(engine.store.paths.state, "daemon.log")}`, 6);
}
export function explicitPaths(state: string, config: string): Paths {
  return { state, config, db: join(state, "state.sqlite"), logs: join(state, "logs"), contexts: join(state, "contexts"), launches: join(state, "launches") };
}
export async function daemon(p: Paths) {
  const store = new Store(p), engine = new Engine(store, Date.now, elapsedClock), owner = randomUUID(), boot = bootId();
  const lease = engine.acquire(owner, process.pid, boot, alive); if (!lease) { store.close(); return; }
  let exiting = false;
  let delivery: Promise<void> | undefined, lastPrune = 0;
  process.on("SIGTERM", () => { exiting = true; }); process.on("SIGINT", () => { exiting = true; });
  try {
    while (!exiting) {
      engine.reconcile(boot, alive);
      const tickets = engine.tick(owner, lease.generation, boot);
      for (const ticket of tickets) {
        try { await launch(engine, ticket); }
        catch (error) { engine.launchFailed(ticket, message(error)); }
      }
      if (!delivery) delivery = deliverPending(engine).catch(error => console.error(message(error))).finally(() => { delivery = undefined; });
      if (Date.now() - lastPrune > 3600000) { prune(engine, undefined, true); lastPrune = Date.now(); }
      await Bun.sleep(500);
    }
  } catch (error) {
    if (!(error instanceof ImpulseError && error.code === "LEASE_LOST")) throw error;
  } finally { await delivery; store.close(); }
}
export async function supervise(p: Paths) {
  const store = new Store(p), engine = new Engine(store, Date.now, elapsedClock);
  try {
    await startDaemon(engine);
    while (true) {
      await Bun.sleep(3000);
      const lease = engine.lease();
      if (!lease?.enabled) break;
      if (lease.until < Date.now() || !alive(lease.pid)) await startDaemon(engine);
    }
  } finally { store.close(); }
}
async function launch(engine: Engine, ticket: Ticket) {
  const run = engine.run(ticket.run_id), p = engine.store.paths;
  const agent = ticket.kind === "agent" ? engine.agent(ticket.id) : null;
  const context = agent?.context ?? run.context;
  const contextFile = join(p.contexts, `${ticket.id}.json`);
  privateJson(contextFile, { ...context, paths: p });
  const file = join(p.launches, `${ticket.id}.json`);
  const descriptor: LaunchDescriptor = { schema_version: 1, ticket, task_name: engine.task(run.task_id).name, paths: p, context_file: contextFile, profile: run.profile, runner: { command: [...selfCommand(), "_runner", file], cwd: run.definition.cwd }, keep_open: ticket.kind === "agent", ...(agent ? { instructions: assignmentInstructions(agent.instructions, contextFile, selfCommand()) } : {}) };
  if (agent) {
    descriptor.instructions_file = join(p.launches, `${ticket.id}.instructions.md`);
    writeFileSync(descriptor.instructions_file, descriptor.instructions!, { mode: 0o600 });
  }
  privateJson(file, descriptor);
  if (agent) await launchTerminal(descriptor, file);
  else await detach(descriptor.runner.command);
}
function childExit(child: ChildProcess): Promise<{ code: number | null; error: string | null }> {
  return new Promise(resolve => {
    child.once("error", error => resolve({ code: null, error: message(error) }));
    child.once("close", (code, signal) => resolve({ code, error: signal ? `Exited from ${signal}` : null }));
  });
}
export async function runner(file: string) {
  const descriptor = JSON.parse(readFileSync(file, "utf8")) as LaunchDescriptor;
  const store = new Store(descriptor.paths), engine = new Engine(store, Date.now, elapsedClock), nonce = randomUUID(), ticket = descriptor.ticket;
  let log: number | undefined, child: ProcessHandle | undefined, server: ChildProcess | undefined, terminal: TerminalProcess | undefined;
  let external = false, sentGrace = false, sentForce = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const controlFile = join(descriptor.paths.launches, `${ticket.id}.control.json`);
  const outcomeFile = join(descriptor.paths.launches, `${ticket.id}.process-outcome.json`);
  async function waitForOwnedGroups() {
    if (!external && process.platform !== "win32") while ((child?.pid && groupAlive(child.pid)) || (server?.pid && groupAlive(server.pid))) await Bun.sleep(200);
  }
  try {
    const run = engine.claim(ticket, nonce, process.pid, bootId());
    heartbeat = setInterval(() => {
      try {
        const state = engine.heartbeat(ticket, nonce);
        if (state.cancel && !state.done && (child || server) && (!sentGrace || (state.force && !sentForce))) {
          if (!external) {
            if (process.platform === "win32") privateJson(controlFile, { force: state.force });
            else { if (server) stopChild(server, state.force, true); if (child) stopChild(child, state.force, true); }
          }
          sentGrace = true; sentForce ||= state.force;
        }
      } catch (error) { console.error(`Impulse runner: ${message(error)}`); }
    }, 500);
    const context = ticket.kind === "agent" ? engine.agent(ticket.id).context : run.context;
    const env = { ...process.env, IMPULSE_CONTEXT: descriptor.context_file, IMPULSE_TASK_ID: context.task_id, IMPULSE_RUN_ID: context.run_id, ...(context.agent_id ? { IMPULSE_AGENT_ID: context.agent_id } : {}) };
    delete env.IMPULSE_AGENT_ID; if (context.agent_id) env.IMPULSE_AGENT_ID = context.agent_id;
    const script = ticket.kind === "script";
    if (!script && !descriptor.profile.harness_profile) {
      const trust = await prepareProjectTrust(descriptor.profile.harness, run.definition.cwd, engine.settings().trust?.roots ?? [], env);
      if (trust) console.log(`Impulse trusted ${trust.projects.join(", ")} in ${trust.file}`);
    }
    const initialPrompt = `Read the assignment instructions in ${JSON.stringify(descriptor.instructions_file)}. Follow them to complete this Impulse assignment and report its explicit outcome using the supplied CLI context.`;
    let command: string[];
    if (script) {
      if (run.definition.work.kind !== "script") throw new Error("Script ticket has agent definition");
      command = run.definition.work.command; log = openSync(join(descriptor.paths.logs, `${run.id}.log`), "a", 0o600);
    } else if (descriptor.profile.harness_profile) {
      command = substitute(descriptor.profile.harness_profile.command, file);
      external = descriptor.profile.harness_profile.lifecycle === "external";
    } else if (descriptor.profile.harness === "claude-code") command = ["claude", initialPrompt];
    else {
      const help = Bun.spawnSync(["codex", "--help"], { stdout: "pipe", stderr: "pipe" });
      if (help.exitCode !== 0) throw new Error("Codex is unavailable; run impulse doctor");
      if (process.platform !== "win32" && help.stdout.toString().includes("--remote")) {
        // A private backend keeps cancellation scoped to this assignment, even on shared-daemon Codex versions.
        const socket = join(descriptor.paths.launches, `${randomUUID().slice(0, 8)}.sock`);
        if (Buffer.byteLength(socket) > 100) throw new Error("Impulse state path is too long for a private Codex socket; use a shorter IMPULSE_HOME");
        server = spawn("codex", ["app-server", "--listen", `unix://${socket}`], { cwd: run.definition.cwd, env, detached: true, stdio: ["ignore", "ignore", "inherit"] });
        let serverError: string | undefined;
        server.on("error", error => { serverError = message(error); });
        for (let i = 0; i < 150 && !existsSync(socket) && !serverError && server.exitCode === null; i++) {
          if (engine.heartbeat(ticket, nonce).cancel) throw new Error("Cancelled during backend startup");
          await Bun.sleep(100);
        }
        if (!existsSync(socket)) throw new Error(serverError ?? "Private Codex backend did not start");
        command = ["codex", "--remote", `unix://${socket}`, "--cd", run.definition.cwd, initialPrompt];
      } else {
        command = ["codex", "--cd", run.definition.cwd, initialPrompt];
        external = help.stdout.toString().includes("shared local app-server");
      }
    }
    if (engine.heartbeat(ticket, nonce).cancel) throw new Error("Cancelled before execution started");
    const invocation = process.platform === "win32" && !external ? windowsCommand(command, run.definition.cwd, join(descriptor.paths.launches, `${ticket.id}.process.json`), controlFile, outcomeFile) : command;
    let exit: Promise<ExecutionExit>;
    if (!script && process.platform !== "win32") { terminal = terminalProcess(invocation, run.definition.cwd, env); child = terminal.process; exit = terminal.exited; }
    else {
      const spawned = spawn(invocation[0]!, invocation.slice(1), { cwd: run.definition.cwd, env, detached: process.platform !== "win32", stdio: script ? ["ignore", "pipe", "pipe"] : "inherit", windowsHide: script });
      if (script) { spawned.stdout?.on("data", bytes => writeSync(log!, bytes)); spawned.stderr?.on("data", bytes => writeSync(log!, bytes)); }
      child = spawned; exit = childExit(spawned);
    }
    const result = await exit;
    if (server) { try { stopChild(server, false, true); } catch { /* Reconciliation retains uncertainty below if needed. */ } }
    await waitForOwnedGroups();
    if (process.platform === "win32" && !external) {
      try {
        const proof = JSON.parse(readFileSync(outcomeFile, "utf8").replace(/^\uFEFF/, ""));
        if (typeof proof.exit_code === "number" || typeof proof.launch_error === "string") { result.code = proof.exit_code; result.error = proof.launch_error ?? null; }
        else external = true;
      } catch { external = true; }
    }
    engine.ended(ticket, nonce, result.code, result.error, external);
  } catch (error) {
    console.error(`Impulse runner: ${message(error)}`);
    let uncertain = external && !!child?.pid;
    try {
      if (!external) { if (server) stopChild(server, false, true); if (child && process.platform !== "win32") stopChild(child, false, true); }
      await waitForOwnedGroups();
    } catch { uncertain = true; }
    try { engine.ended(ticket, nonce, null, message(error), uncertain); } catch { /* A duplicate ticket must not mutate its original runner. */ }
  } finally {
    terminal?.close(); if (heartbeat) clearInterval(heartbeat); if (log !== undefined) closeSync(log); store.close();
  }
  if (descriptor.keep_open && process.stdin.isTTY) {
    console.log("\nImpulse assignment ended. This terminal remains open; press Enter to close the runner.");
    await new Promise<void>(resolve => { process.stdin.resume(); process.stdin.once("data", () => { process.stdin.pause(); resolve(); }); });
  }
}
