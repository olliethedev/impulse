import { randomUUID, timingSafeEqual } from "node:crypto";
import { defaultSettings, executionProfile, type LoadedDefinition } from "./config.ts";
import { requireThat } from "./errors.ts";
import { duration, firstDue, nextCalendar, timestamp, zone } from "./schedule.ts";
import { Store } from "./store.ts";
import { activeStatuses, type Agent, type ClockSample, type Context, type Due, type Execution, type HarnessObservation, type Lease, type Observation, type Outcome, type Run, type Settings, type Task } from "./types.ts";

const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const active = (status: string) => activeStatuses.includes(status as Run["status"]);
export interface Ticket { kind: "script" | "agent"; id: string; ticket: string; run_id: string }
export class Engine {
  constructor(public store: Store, public now: () => number = Date.now, private clock: () => ClockSample | undefined = () => undefined) {}
  after(delay: string): Due { return this.relative(this.now() + duration(delay), "explicit"); }
  private relative(at: number, source: Due["source"], anchor?: ClockSample): Due {
    const clock = anchor ?? this.clock();
    return { at, source, ...(clock ? { elapsed: { boot_id: clock.boot_id, at: clock.at + at - this.now() } } : {}) };
  }
  private initial(task: Task): Due {
    const due = firstDue(task.definition, task.registered_at);
    if (task.definition.first_run.kind === "after" && task.registered_clock) due.elapsed = { boot_id: task.registered_clock.boot_id, at: task.registered_clock.at + duration(task.definition.first_run.delay) };
    return due;
  }
  settings(): Settings { return this.store.meta<Settings>("settings") ?? defaultSettings(); }
  task(reference: string): Task {
    const task = this.store.get("tasks", reference) ?? this.store.all("tasks").find(t => t.name === reference && !t.removed);
    requireThat(task, "NOT_FOUND", `Task not found: ${reference}`, 3); return task;
  }
  run(id: string): Run { const run = this.store.get("runs", id); requireThat(run, "NOT_FOUND", `Run not found: ${id}`, 3); return run; }
  agent(id: string): Agent { const agent = this.store.get("agents", id); requireThat(agent, "NOT_FOUND", `Agent not found: ${id}`, 3); return agent; }
  tasks(): Task[] { return this.store.all("tasks").filter(t => !t.removed); }
  runs(task?: string): Run[] { return this.store.all("runs").filter(r => !task || r.task_id === this.task(task).id); }
  agents(run: string): Agent[] { return this.store.all("agents").filter(a => a.run_id === run); }
  events(run: string) { return this.store.all("events").filter(e => e.run_id === run); }
  private event(task: string, run: string | null, type: string, detail: unknown = {}) {
    this.store.put("events", { id: id("event"), task_id: task, run_id: run, type, at: this.now(), detail });
  }
  /** A request key commits together with its result; a crash after commit can be retried safely. */
  receipt<T>(scope: string, key: string | undefined, payload: unknown, operation: () => T): T {
    return this.store.atomic(() => {
      if (!key) return operation();
      const receiptKey = `receipt:${scope}:${key}`, fingerprint = JSON.stringify(payload);
      const old = this.store.meta<{ fingerprint: string; result: T }>(receiptKey);
      if (old) { requireThat(old.fingerprint === fingerprint, "REQUEST_CONFLICT", "Request ID was already used with different input", 4); return old.result; }
      const result = operation();
      this.store.setMeta(receiptKey, { fingerprint, result }); return result;
    });
  }
  register(loaded: LoadedDefinition, options: { name?: string; harness?: string; terminal?: string; disabled?: boolean } = {}): Task {
    return this.store.atomic(() => {
      const old = this.tasks().find(t => t.source === loaded.path); if (old) return old;
      const name = options.name ?? loaded.definition.name;
      requireThat(!this.tasks().some(t => t.name === name), "NAME_CONFLICT", `Task name ${name} is already registered; use --name`, 4);
      if (loaded.definition.first_run.kind === "at") timestamp(loaded.definition.first_run.at, this.now());
      const overrides = { ...(options.harness ? { harness: options.harness } : {}), ...(options.terminal ? { terminal: options.terminal } : {}) };
      const task: Task = { id: id("task"), name, source: loaded.path, source_hash: loaded.hash, definition: loaded.definition, revision: 1, registered_at: this.now(), enabled: !options.disabled, removed: false, overrides, profile: executionProfile(this.settings(), overrides), next: firstDue(loaded.definition, this.now()), last_run: null, hold: false, zone: zone(loaded.definition.schedule), last_calendar_nominal: null };
      const clock = this.clock(); if (clock) task.registered_clock = clock;
      task.next = this.initial(task);
      this.store.put("tasks", task); this.event(task.id, null, "registered"); return task;
    });
  }
  update(reference: string, loaded: LoadedDefinition, changes: { harness?: string | null; terminal?: string | null } = {}): Task {
    return this.store.atomic(() => {
      const task = this.task(reference);
      requireThat(!task.removed, "NOT_FOUND", "Task is unregistered", 3);
      if (loaded.definition.first_run.kind === "at" && (task.definition.first_run.kind !== "at" || loaded.definition.first_run.at !== task.definition.first_run.at)) timestamp(loaded.definition.first_run.at, this.now());
      requireThat(!this.tasks().some(t => t.id !== task.id && t.source === loaded.path), "SOURCE_CONFLICT", "Source is already registered", 4);
      for (const key of ["harness", "terminal"] as const) {
        if (changes[key] === null) delete task.overrides[key];
        else if (changes[key] !== undefined) task.overrides[key] = changes[key];
      }
      task.definition = loaded.definition; task.source = loaded.path; task.source_hash = loaded.hash;
      task.profile = executionProfile(this.settings(), task.overrides); task.revision++;
      this.recompute(task); this.store.put("tasks", task); this.event(task.id, null, "updated", { revision: task.revision }); return task;
    });
  }
  rename(reference: string, name: string, context?: Context): Task {
    return this.store.atomic(() => {
      const task = this.task(reference);
      requireThat(!task.removed, "NOT_FOUND", "Task is unregistered", 3);
      if (context) requireThat(this.context(context).task.id === task.id, "CONTEXT_SCOPE", "A run may only rename its own task", 4);
      requireThat(name.trim().length > 0 && !name.includes("\0"), "INVALID_NAME", "Task name must be a nonempty string without NUL");
      requireThat(!this.store.all("tasks").some(t => t.id !== task.id && (t.id === name || (!t.removed && t.name === name))), "NAME_CONFLICT", `Task name ${name} is already in use; choose another name`, 4);
      if (task.name === name) return task;
      const previous = task.name;
      task.name = name;
      this.store.put("tasks", task);
      this.event(task.id, context?.run_id ?? null, "renamed", { previous_name: previous, name });
      return task;
    });
  }
  applySettings(settings: Settings): Settings {
    return this.store.atomic(() => {
      for (const task of this.tasks()) {
        const profile = executionProfile(settings, task.overrides);
        if (JSON.stringify(profile) !== JSON.stringify(task.profile)) {
          task.profile = profile; task.revision++; this.recompute(task); this.store.put("tasks", task);
          this.event(task.id, null, "profile_updated", { revision: task.revision });
        }
      }
      this.store.setMeta("settings", settings); return settings;
    });
  }
  private recompute(task: Task) {
    const schedule = task.definition.schedule;
    task.zone = zone(schedule);
    if (task.last_run === null) {
      task.next = ["now", "schedule"].includes(task.definition.first_run.kind) ? firstDue(task.definition, this.now()) : this.initial(task);
      return;
    }
    if (schedule?.kind === "calendar") task.next = nextCalendar(schedule, this.now(), task.definition.policy.catch_up);
    else if (schedule?.kind === "completion") {
      const last = this.run(task.last_run);
      task.next = last.status === "succeeded" && last.finished_at !== null ? { at: last.finished_at + duration(schedule.after), source: "completion" } : null;
      if (task.next && last.finished_clock) task.next.elapsed = { boot_id: last.finished_clock.boot_id, at: last.finished_clock.at + duration(schedule.after) };
    } else task.next = null;
  }
  context(value: Context, scheduling = false): { run: Run; task: Task; agent: Agent | null } {
    const run = this.run(value.run_id), task = this.task(run.task_id);
    const agent = value.agent_id ? this.agent(value.agent_id) : null;
    const expected = agent?.context ?? run.context;
    requireThat(value.token.length === expected.token.length && timingSafeEqual(Buffer.from(value.token), Buffer.from(expected.token)) && value.task_id === run.task_id && value.revision === run.revision && (!agent || agent.run_id === run.id), "INVALID_CONTEXT", "Invalid run context", 4);
    requireThat(active(run.status) && !run.cancel, "RUN_CLOSED", "This run no longer accepts work or scheduling changes", 4);
    requireThat(!agent || active(agent.status), "AGENT_CLOSED", "This assignment has already ended", 4);
    if (!agent) requireThat(run.script && active(run.script.status), "RUN_CLOSED", "The requesting script has ended", 4);
    if (scheduling) requireThat(run.revision === task.revision, "CONFIG_CHANGED", `This run uses revision ${run.revision}; revision ${task.revision} is applied`, 4);
    return { run, task, agent };
  }
  next(reference: string | undefined, due: Due, context?: Context): Task {
    return this.store.atomic(() => {
      let task: Task;
      if (context) {
        const current = this.context(context, true); task = current.task;
        requireThat(!reference || this.task(reference).id === task.id, "CONTEXT_SCOPE", "A run may only reschedule its own task", 4);
        current.run.next_mutation = true; this.store.put("runs", current.run);
      } else { requireThat(reference, "MISSING_TASK", "Supply a task outside a run"); task = this.task(reference); }
      requireThat(due.at > this.now(), "INVALID_TIME", "Next time must be in the future");
      task.next = { ...due, source: "explicit" }; this.store.put("tasks", task);
      this.event(task.id, context?.run_id ?? null, "rescheduled", task.next); return task;
    });
  }
  disable(reference?: string, context?: Context): Task {
    return this.store.atomic(() => {
      let task: Task;
      if (context) { task = this.context(context, true).task; requireThat(!reference || this.task(reference).id === task.id, "CONTEXT_SCOPE", "A run may only disable its own task", 4); }
      else { requireThat(reference, "MISSING_TASK", "Supply a task outside a run"); task = this.task(reference); }
      task.enabled = false; this.store.put("tasks", task); this.event(task.id, context?.run_id ?? null, "disabled"); return task;
    });
  }
  enable(reference: string, at?: number): Task {
    return this.store.atomic(() => {
      const task = this.task(reference); requireThat(!task.removed, "NOT_FOUND", "Task is unregistered", 3);
      if (at !== undefined) task.next = { at, source: "explicit" };
      else if (task.definition.schedule?.kind === "calendar") task.next = nextCalendar(task.definition.schedule, this.now(), task.definition.policy.catch_up);
      else requireThat(task.next && task.next.at > this.now(), "TIMING_REQUIRED", "Use --now or --at to enable a task without a future time", 4);
      task.enabled = true; task.hold = false; this.store.put("tasks", task); this.event(task.id, null, "enabled"); return task;
    });
  }
  remove(reference: string): Task {
    return this.store.atomic(() => {
      const task = this.task(reference); requireThat(!this.runs(task.id).some(r => active(r.status)), "TASK_ACTIVE", "Stop or resolve active work before removing this task", 4);
      task.removed = true; task.enabled = false; task.next = null; this.store.put("tasks", task); this.event(task.id, null, "removed"); return task;
    });
  }
  manual(reference: string, reset = false): Run {
    return this.store.atomic(() => {
      const task = this.task(reference); requireThat(!task.removed, "NOT_FOUND", "Task is unregistered", 3);
      requireThat(!this.runs(task.id).some(r => active(r.status)), "TASK_ACTIVE", "This task already has active work", 4);
      if (reset) { task.next = null; this.store.put("tasks", task); }
      return this.admit(task, "manual", 0);
    });
  }
  private execution(): Execution { return { status: "queued", ticket: id("ticket"), runner_nonce: null, pid: null, boot_id: null, heartbeat: null, launch_at: null, exit_code: null, ended_at: null, error: null }; }
  private admit(task: Task, trigger: string, attempt: number): Run {
    const runId = id("run");
    const run: Run = { id: runId, task_id: task.id, revision: task.revision, definition: task.definition, profile: task.profile, status: "queued", created_at: this.now(), finished_at: null, trigger, script: task.definition.work.kind === "script" ? this.execution() : null, context: { run_id: runId, task_id: task.id, revision: task.revision, token: randomUUID() }, cancel: false, force: false, root_agent: null, retry_attempt: attempt, next_mutation: false };
    if (task.definition.work.kind === "agent") { const agent = this.createAgent(run, task.definition.work.instructions, null); run.root_agent = agent.id; }
    this.store.put("runs", run); task.last_run = run.id; this.store.put("tasks", task); this.event(task.id, run.id, "admitted", { trigger, revision: run.revision }); return run;
  }
  private createAgent(run: Run, instructions: string, parent: string | null): Agent {
    const agentId = id("agent");
    const agent: Agent = { ...this.execution(), id: agentId, run_id: run.id, parent_id: parent, instructions, created_at: this.now(), context: { run_id: run.id, task_id: run.task_id, revision: run.revision, agent_id: agentId, token: randomUUID() }, summary: null, handled: null, outcome: null };
    this.store.put("agents", agent); return agent;
  }
  capacity(): { used: number; limit: number } { return { used: this.store.all("agents").filter(a => ["launching", "running", "stopping", "uncertain"].includes(a.status)).length, limit: this.settings().limits.agents }; }
  request(context: Context, instructions: string): Agent {
    return this.store.atomic(() => {
      const { run, agent: parent } = this.context(context);
      requireThat(instructions.trim().length > 0, "INVALID_INSTRUCTIONS", "Instructions cannot be empty");
      if (parent) { const cap = this.capacity(); requireThat(cap.used < cap.limit, "CAPACITY_FULL", "All agent slots are occupied; schedule future work or try later", 5); }
      const agent = this.createAgent(run, instructions, parent?.id ?? null);
      if (parent) { agent.status = "launching"; this.store.put("agents", agent); }
      this.event(run.task_id, run.id, "agent_requested", { agent_id: agent.id, parent_id: agent.parent_id }); return agent;
    });
  }
  finish(context: Context, outcome: "succeeded" | "failed", summary: string): Agent {
    return this.store.atomic(() => {
      requireThat(context.agent_id, "AGENT_CONTEXT_REQUIRED", "Only the current agent may report its outcome", 4);
      const previous = this.agent(context.agent_id);
      requireThat(context.token === previous.context.token, "INVALID_CONTEXT", "Invalid assignment context", 4);
      if (previous.outcome) {
        requireThat(previous.outcome === outcome && previous.summary === summary, "OUTCOME_CONFLICT", "This agent already reported a different outcome", 4); return previous;
      }
      const { run, agent } = this.context(context);
      requireThat(agent && ["running", "launching"].includes(agent.status), "AGENT_CLOSED", "Assignment cannot report an outcome in its current state", 4);
      requireThat(summary.trim().length > 0, "SUMMARY_REQUIRED", "Outcome summary cannot be empty");
      agent.outcome = outcome; agent.status = outcome; agent.summary = summary; agent.ended_at = this.now();
      this.store.put("agents", agent); this.event(run.task_id, run.id, "agent_outcome", { agent_id: agent.id, outcome, summary }); this.settle(run.id); return agent;
    });
  }
  handle(context: Context, agentId: string, reason: string): Agent {
    return this.store.atomic(() => {
      const { run, agent: parent } = this.context(context), child = this.agent(agentId);
      requireThat(child.run_id === run.id && child.parent_id === (parent?.id ?? null) && child.id !== run.root_agent, "NOT_DIRECT_CHILD", "Only the requester may handle this child's failure", 4);
      requireThat(child.status === "failed", "NOT_FAILED", "Only a failed child can be handled", 4);
      requireThat(reason.trim(), "REASON_REQUIRED", "Handling a failure requires a reason");
      child.handled = { reason, at: this.now() }; this.store.put("agents", child); this.event(run.task_id, run.id, "failure_handled", { agent_id: child.id, reason }); return child;
    });
  }
  resolve(agentId: string, outcome: "succeeded" | "failed", reason: string): Agent {
    return this.store.atomic(() => {
      const agent = this.agent(agentId), run = this.run(agent.run_id);
      requireThat(agent.status === "unconfirmed" && !run.cancel, "NOT_RESOLVABLE", "Only ended, unconfirmed work may be resolved", 4);
      requireThat(reason.trim(), "REASON_REQUIRED", "Resolution requires a reason");
      agent.status = outcome; agent.outcome = outcome; agent.summary = reason; agent.ended_at = this.now(); this.store.put("agents", agent);
      this.event(run.task_id, run.id, "operator_resolution", { agent_id: agent.id, outcome, reason });
      run.status = "running"; run.finished_at = null; this.store.put("runs", run); this.settle(run.id); return agent;
    });
  }
  stop(runId: string, force = false): Run {
    return this.store.atomic(() => {
      const run = this.run(runId); if (!active(run.status)) return run;
      run.cancel = true; run.force ||= force; run.status = "stopping";
      for (const agent of this.agents(run.id)) {
        if (!active(agent.status)) continue;
        if (agent.status === "queued" || (agent.status === "launching" && agent.launch_at === null)) { agent.status = "cancelled"; agent.ended_at = this.now(); }
        else agent.status = "stopping";
        this.store.put("agents", agent);
      }
      if (run.script && active(run.script.status)) {
        if (run.script.status === "queued") { run.script.status = "cancelled"; run.script.ended_at = this.now(); }
        else run.script.status = "stopping";
      }
      this.store.put("runs", run); this.event(run.task_id, run.id, "cancellation_requested", { force }); this.settle(run.id); return this.run(run.id);
    });
  }
  confirmEnded(runId: string, reason: string, isAlive: (pid: number) => boolean): Run {
    return this.store.atomic(() => {
      const run = this.run(runId), components = [...this.agents(run.id), ...(run.script ? [run.script] : [])].filter(c => active(c.status));
      requireThat(components.length > 0 && components.every(c => ["uncertain", "stopping"].includes(c.status)), "NOT_UNCERTAIN", "Only uncertain or stopping execution can be confirmed ended", 4);
      requireThat(components.every(c => !c.pid || !isAlive(c.pid)), "RUNNER_ALIVE", "A runner is still alive; close its assignment session before confirming external termination", 4);
      requireThat(reason.trim(), "REASON_REQUIRED", "State how you verified all owned execution has ended");
      for (const component of components) {
        component.status = run.cancel ? "cancelled" : "id" in component ? "unconfirmed" : "interrupted";
        component.ended_at = this.now();
        if ("id" in component) this.store.put("agents", component as Agent); else run.script = component;
      }
      this.store.put("runs", run); this.event(run.task_id, run.id, "operator_confirmed_ended", { reason }); this.settle(run.id); return this.run(run.id);
    });
  }
  private settle(runId: string) {
    const run = this.run(runId), agents = this.agents(runId), components = [...agents, ...(run.script ? [run.script] : [])];
    if (components.some(c => active(c.status))) {
      run.status = run.cancel ? "stopping" : components.some(c => c.status === "uncertain") ? "uncertain" : "running";
      this.store.put("runs", run); return;
    }
    const unhandled = agents.filter(a => !a.handled);
    let outcome: Outcome;
    if (run.cancel) outcome = "cancelled";
    else if (run.script?.status === "failed" || unhandled.some(a => a.status === "failed")) outcome = "failed";
    else if (components.some(c => c.status === "interrupted")) outcome = "interrupted";
    else if (components.some(c => c.status === "unconfirmed")) outcome = "unconfirmed";
    else outcome = "succeeded";
    if (run.finished_at !== null && run.status === outcome) return;
    run.status = outcome; run.finished_at = this.now(); this.store.put("runs", run);
    const clock = this.clock(); if (clock) { run.finished_clock = clock; this.store.put("runs", run); }
    const task = this.task(run.task_id), schedule = task.definition.schedule;
    if (task.last_run === run.id) {
      if (outcome === "succeeded" && schedule?.kind === "completion" && task.next?.source !== "explicit") task.next = this.relative(run.finished_at + duration(schedule.after), "completion");
      if (outcome === "interrupted") {
        task.hold = task.definition.policy.hold_after_interruption;
        const retry = task.definition.policy.interruption_retry;
        if (retry.enabled && run.retry_attempt < retry.max_attempts && task.next?.source !== "explicit") {
          task.next = this.relative(this.now() + duration(retry.delay), "retry"); task.hold = false;
        }
      }
      this.store.put("tasks", task);
    }
    this.event(task.id, run.id, "run_finished", { outcome });
    const prefs = run.definition.notifications;
    if ((outcome === "succeeded" && prefs.on_success) || (["failed", "unconfirmed"].includes(outcome) && prefs.on_failure) || (outcome === "interrupted" && prefs.on_interruption)) {
      this.store.put("notifications", { id: id("notification"), task_id: task.id, task_name: task.name, run_id: run.id, outcome, summary: agents.map(a => a.summary).filter(Boolean).join("\n") || `Task ${task.name} ${outcome}`, at: this.now(), status: "pending", error: null });
    }
  }
  acquire(owner: string, pid: number, bootId: string, isAlive: (pid: number) => boolean = () => true): Lease | null {
    return this.store.atomic(() => {
      const old = this.store.meta<Lease>("lease");
      if (old && old.enabled && old.until > this.now() && old.owner !== owner && old.boot_id === bootId && isAlive(old.pid)) return null;
      const lease: Lease = { owner, pid, boot_id: bootId, generation: (old?.generation ?? 0) + 1, until: this.now() + 10000, enabled: true, tick: old?.tick ?? this.now() - 6000 };
      this.store.setMeta("lease", lease); return lease;
    });
  }
  lease(): Lease | null { return this.store.meta<Lease>("lease"); }
  stopDaemon() { return this.store.atomic(() => { const lease = this.lease(); if (lease) { lease.enabled = false; lease.until = 0; this.store.setMeta("lease", lease); } return lease; }); }
  tick(owner: string, generation: number, bootId: string): Ticket[] {
    return this.store.atomic(() => {
      const lease = this.lease();
      requireThat(lease?.enabled && lease.owner === owner && lease.generation === generation, "LEASE_LOST", "Scheduler no longer owns dispatch", 4);
      const gap = this.now() - lease.tick; lease.tick = this.now(); lease.until = this.now() + 10000; this.store.setMeta("lease", lease);
      const clock = this.clock();
      for (const task of this.tasks()) {
        if (task.next?.elapsed && clock) {
          if (task.next.elapsed.boot_id === clock.boot_id) {
            const at = this.now() + task.next.elapsed.at - clock.at;
            if (Math.abs(at - task.next.at) > 1000) task.next.at = at;
          } else delete task.next.elapsed;
          this.store.put("tasks", task);
        }
        const schedule = task.definition.schedule;
        if (schedule?.kind === "calendar" && task.zone !== zone(schedule)) {
          task.zone = zone(schedule);
          if (task.next?.source === "calendar") task.next = nextCalendar(schedule, this.now(), task.definition.policy.catch_up);
          this.store.put("tasks", task);
        }
        if (!task.enabled || task.hold || !task.next || task.next.at > this.now()) continue;
        const due = task.next;
        if (due.source === "calendar" && due.nominal && task.last_calendar_nominal && due.nominal <= task.last_calendar_nominal) {
          task.next = schedule?.kind === "calendar" ? nextCalendar(schedule, this.now(), task.definition.policy.catch_up) : null; this.store.put("tasks", task); continue;
        }
        const busy = this.runs(task.id).some(r => active(r.status));
        if (busy) {
          if (due.source === "calendar" && task.definition.policy.overlap === "skip") {
            task.next = schedule?.kind === "calendar" ? nextCalendar(schedule, this.now(), task.definition.policy.catch_up) : null;
            this.store.put("tasks", task); this.event(task.id, task.last_run, "overlap_skipped", due);
          }
          continue;
        }
        const missed = gap > 5000 && due.at < this.now() - 1000;
        if (missed && task.definition.policy.catch_up === "skip") {
          task.next = schedule?.kind === "calendar" ? nextCalendar(schedule, this.now(), "skip") : null;
          this.store.put("tasks", task); this.event(task.id, null, "catch_up_skipped", due); continue;
        }
        const attempt = due.source === "retry" && task.last_run ? this.run(task.last_run).retry_attempt + 1 : 0;
        task.next = schedule?.kind === "calendar" ? nextCalendar(schedule, this.now(), task.definition.policy.catch_up) : null;
        if (due.nominal) task.last_calendar_nominal = due.nominal;
        this.admit(task, due.source, attempt);
      }
      const tickets: Ticket[] = [];
      for (const run of this.runs()) {
        if (run.cancel || !run.script || run.script.status !== "queued") continue;
        run.script.status = "launching"; run.script.launch_at = this.now(); run.script.boot_id = bootId; run.status = "running";
        this.store.put("runs", run); tickets.push({ kind: "script", id: run.id, run_id: run.id, ticket: run.script.ticket });
      }
      let capacity = this.capacity();
      for (const agent of this.store.all("agents")) {
        if (this.run(agent.run_id).cancel) continue;
        if (agent.status === "queued" && capacity.used < capacity.limit) { agent.status = "launching"; capacity.used++; }
        if (agent.status === "launching" && agent.launch_at === null) {
          agent.launch_at = this.now(); agent.boot_id = bootId; this.store.put("agents", agent);
          tickets.push({ kind: "agent", id: agent.id, run_id: agent.run_id, ticket: agent.ticket });
        }
      }
      return tickets;
    });
  }
  claim(ticket: Ticket, nonce: string, pid: number, bootId: string): Run {
    return this.store.atomic(() => {
      const run = this.run(ticket.run_id), execution = ticket.kind === "agent" ? this.agent(ticket.id) : run.script;
      requireThat(execution && !run.cancel && execution.ticket === ticket.ticket && execution.status === "launching" && execution.runner_nonce === null, "TICKET_CLOSED", "Launch ticket was already claimed or cancelled", 4);
      execution.runner_nonce = nonce; execution.pid = pid; execution.boot_id = bootId; execution.heartbeat = this.now(); execution.status = "running";
      if (ticket.kind === "agent") this.store.put("agents", execution as Agent); else run.script = execution;
      run.status = "running"; this.store.put("runs", run); this.event(run.task_id, run.id, "runner_claimed", { kind: ticket.kind, id: ticket.id }); return run;
    });
  }
  heartbeat(ticket: Ticket, nonce: string): { cancel: boolean; force: boolean; done: boolean } {
    return this.store.atomic(() => {
      const run = this.run(ticket.run_id), execution = ticket.kind === "agent" ? this.agent(ticket.id) : run.script;
      requireThat(execution?.runner_nonce === nonce, "RUNNER_CHANGED", "Runner identity mismatch", 4);
      execution.heartbeat = this.now();
      if (ticket.kind === "agent") this.store.put("agents", execution as Agent); else { run.script = execution; this.store.put("runs", run); }
      return { cancel: run.cancel, force: run.force, done: !active(execution.status) };
    });
  }
  observe(context: Context, observation: Observation, source: HarnessObservation["source"] = "wrapper"): Agent {
    return this.store.atomic(() => {
      const { run, task, agent } = this.context(context);
      requireThat(agent, "AGENT_CONTEXT_REQUIRED", "Harness observations require an agent context", 4);
      const previous = agent.observation;
      const lastFailure = agent.last_harness_failure;
      const { at: _at, ...before } = previous ?? {};
      const next = { ...observation, source };
      agent.observation = { ...next, at: this.now() };
      if (observation.state === "failed") agent.last_harness_failure = agent.observation;
      this.store.put("agents", agent);
      if (JSON.stringify(before) !== JSON.stringify(next)) {
        const failed = observation.state === "failed";
        this.event(task.id, run.id, failed ? "harness_failure" : "harness_observed", { agent_id: agent.id, observation: agent.observation });
        const newFailure = failed && (!lastFailure || lastFailure.session_id !== observation.session_id || lastFailure.turn_id !== observation.turn_id || lastFailure.error?.code !== observation.error?.code || lastFailure.error?.message !== observation.error?.message);
        if (newFailure && run.definition.notifications.on_failure) {
          this.store.put("notifications", { id: id("notification"), task_id: task.id, task_name: task.name, run_id: run.id,
            outcome: "unconfirmed", summary: `Harness reported a failure for ${task.name}. Execution remains tracked; inspect with impulse run diagnose ${run.id}.`,
            at: this.now(), status: "pending", error: null });
        }
      }
      return agent;
    });
  }
  diagnose(runId: string, currentBoot: string, isAlive: (pid: number) => boolean) {
    const run = this.run(runId), task = this.task(run.task_id);
    const issues: { code: string; component?: string; message: string }[] = [];
    const executions = [...this.agents(runId).map(agent => ({ id: agent.id, kind: "agent", execution: agent })),
      ...(run.script ? [{ id: run.id, kind: "script", execution: run.script }] : [])];
    const components = executions.map(({ id, kind, execution: e }) => {
      const runnerAlive = e.pid === null || e.boot_id === null ? null : e.boot_id !== currentBoot ? false : isAlive(e.pid);
      if (active(e.status) && runnerAlive === false) issues.push({ code: "RUNNER_MISSING", component: id, message: "The recorded runner is absent. Check its harness, tools and external work before confirming termination." });
      if (e.observation?.state === "failed" && e.status !== "succeeded") issues.push({ code: "HARNESS_FAILURE", component: id, message: e.observation.error?.message ?? "The harness reported a failed turn." });
      if (e.observation?.state === "unavailable" && e.last_harness_failure) issues.push({ code: "LAST_HARNESS_FAILURE", component: id, message: "A prior harness failure was recorded, but current progress cannot be observed. Inspect the retained failure and session." });
      if (kind === "agent" && (!e.observation || e.observation.state === "unavailable")) issues.push({ code: "OBSERVATION_UNAVAILABLE", component: id, message: e.observation?.note ?? "This launch has no structured harness observation. Inspect the assignment session and its owned work." });
      if (e.status === "uncertain" || e.status === "stopping") issues.push({ code: "EXECUTION_UNCERTAIN", component: id, message: "Replacement remains blocked until owned and external execution is known to have ended." });
      if (e.status === "unconfirmed") issues.push({ code: "OUTCOME_MISSING", component: id, message: "Execution ended without an explicit assignment outcome. Inspect outputs before resolving it." });
      return { id, kind, status: e.status, pid: e.pid, boot_id: e.boot_id, runner_alive: runnerAlive,
        heartbeat: e.heartbeat, heartbeat_age_ms: e.heartbeat === null ? null : Math.max(0, this.now() - e.heartbeat),
        observation: e.observation ?? null, observation_age_ms: e.observation ? Math.max(0, this.now() - e.observation.at) : null,
        last_harness_failure: e.last_harness_failure ?? null,
        error: e.error, exit_code: e.exit_code, ended_at: e.ended_at,
        ...(kind === "agent" ? { outcome: (e as Agent).outcome, summary: (e as Agent).summary } : {}) };
    });
    const activeRuns = this.runs(task.id).filter(r => active(r.status)).map(r => r.id);
    const recovery: { command: string[]; when: string }[] = [];
    if (active(run.status)) recovery.push({ command: ["impulse", "run", "stop", run.id], when: "If abandoning this run, request scoped cancellation; verify tools and external work have stopped." });
    if (components.some(c => ["uncertain", "stopping"].includes(c.status))) recovery.push({ command: ["impulse", "run", "confirm-ended", run.id, "--reason", "<verified evidence>"], when: "Only after every runner and all owned/external work have ended. A missing PID or failed turn alone is insufficient." });
    for (const c of components.filter(c => c.kind === "agent" && c.status === "unconfirmed")) recovery.push({ command: ["impulse", "agent", "resolve", c.id, "--outcome", "failed", "--reason", "<verified outcome>"], when: "Record failed for incomplete work; choose success only when all required results are verified." });
    return { run_id: run.id, task_id: task.id, task_name: task.name, status: run.status, harness: run.profile.harness,
      checked_at: this.now(), replacement_blocked: activeRuns.length > 0, components, issues, recovery,
      schedule: { enabled: task.enabled, hold: task.hold, next: task.next, active_runs: activeRuns },
      note: "Read-only diagnosis. Observations may be stale; idle and zero observed tools do not prove external work ended. Existing schedules are unchanged." };
  }
  ended(ticket: Ticket, nonce: string, exitCode: number | null, error: string | null = null, external = false) {
    return this.store.atomic(() => {
      const run = this.run(ticket.run_id), execution = ticket.kind === "agent" ? this.agent(ticket.id) : run.script;
      requireThat(execution?.runner_nonce === nonce, "RUNNER_CHANGED", "Runner identity mismatch", 4);
      if (!active(execution.status)) return;
      error ??= execution.observation?.state === "failed" ? execution.observation.error?.message ?? "Harness reported a failed turn" : null;
      execution.exit_code = exitCode; execution.error = error;
      if (external) {
        if (execution.status !== "uncertain") this.executionUncertain(run, ticket.id);
        execution.status = "uncertain";
      }
      else { execution.status = run.cancel ? "cancelled" : ticket.kind === "script" ? exitCode === 0 && !error ? "succeeded" : "failed" : error ? "failed" : "unconfirmed"; execution.ended_at = this.now(); }
      if (ticket.kind === "agent") this.store.put("agents", execution as Agent); else { run.script = execution; this.store.put("runs", run); }
      this.event(run.task_id, run.id, "execution_ended", { id: ticket.id, status: execution.status, exit_code: exitCode, error }); this.settle(run.id);
    });
  }
  launchFailed(ticket: Ticket, error: string) {
    return this.store.atomic(() => {
      const run = this.run(ticket.run_id), execution = ticket.kind === "agent" ? this.agent(ticket.id) : run.script;
      if (!execution || execution.runner_nonce || execution.status !== "launching") return;
      execution.status = "failed"; execution.error = error; execution.ended_at = this.now();
      if (ticket.kind === "agent") this.store.put("agents", execution as Agent); else { run.script = execution; this.store.put("runs", run); }
      this.event(run.task_id, run.id, "launch_failed", { id: ticket.id, error }); this.settle(run.id);
    });
  }
  private executionUncertain(run: Run, component: string) {
    this.event(run.task_id, run.id, "execution_uncertain", { component });
    if (run.definition.notifications.on_interruption) {
      const task = this.task(run.task_id);
      this.store.put("notifications", { id: id("notification"), task_id: task.id, task_name: task.name, run_id: run.id, outcome: "unconfirmed", summary: `Execution liveness is uncertain. Automatic replacement is held; inspect with impulse run diagnose ${run.id} before resolving it.`, at: this.now(), status: "pending", error: null });
    }
  }
  reconcile(bootId: string, alive: (pid: number) => boolean) {
    this.store.atomic(() => {
      for (const run of this.runs().filter(r => active(r.status))) {
        const components = [...this.agents(run.id), ...(run.script ? [run.script] : [])];
        const rebooted = components.some(c => active(c.status) && c.boot_id && c.boot_id !== bootId);
        for (const component of components) {
          if (!active(component.status)) continue;
          const previousStatus = component.status;
          if (rebooted) { component.status = run.cancel ? "cancelled" : "interrupted"; component.ended_at = this.now(); }
          else if (component.status === "queued" || component.launch_at === null) continue;
          else if ((component.pid && !alive(component.pid) && this.now() - (component.heartbeat ?? component.launch_at) > 15000) || (!component.pid && this.now() - component.launch_at > 30000)) component.status = "uncertain";
          if (component.status === "uncertain" && previousStatus !== "uncertain")
            this.executionUncertain(run, "id" in component ? (component as Agent).id : run.id);
          if ("id" in component) this.store.put("agents", component as Agent); else run.script = component;
        }
        this.store.put("runs", run); this.settle(run.id);
      }
    });
  }
}
