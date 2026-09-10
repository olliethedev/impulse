import { afterEach, expect, test } from "bun:test";
import { fixture } from "./helpers.ts";
import { defaultSettings } from "../src/config.ts";
import { Engine } from "../src/engine.ts";
import { Store } from "../src/store.ts";
import { paths } from "../src/paths.ts";
const fixtures: ReturnType<typeof fixture>[] = [];
function setup() { const f = fixture(); fixtures.push(f); return f; }
afterEach(() => { for (const f of fixtures.splice(0)) f.close(); });

test("renaming preserves identity, timing, disabled state, history and active callbacks", () => {
  const f = setup(), loaded = f.definition('[schedule]\nkind="completion"\nafter="24h"');
  const task = f.engine.register(loaded);
  const ticket = f.tick()[0]!, run = f.engine.claim(ticket, "runner", 42, "boot");
  f.engine.next(task.id, f.engine.after("2h"), run.context);
  f.engine.disable(task.id, run.context);
  const before = f.engine.task(task.id);
  const history = f.engine.runs(task.id);
  const renamed = f.engine.rename("fixture", "Bio-Mogging indexing");
  expect(renamed).toEqual({ ...before, name: "Bio-Mogging indexing" });
  expect(f.engine.runs(renamed.name)).toEqual(history);
  expect(() => f.engine.task("fixture")).toThrow("Task not found");
  expect(f.engine.register(loaded).name).toBe(renamed.name);
  f.engine.next(undefined, f.engine.after("3h"), run.context);
  f.engine.ended(ticket, "runner", 0);
  const reopened = new Store(paths(f.home));
  try {
    const engine = new Engine(reopened, f.now);
    expect(engine.task(renamed.name).id).toBe(task.id);
    expect(engine.task(task.id).next?.at).toBe(f.now() + 3 * 3600000);
    expect(engine.run(run.id).status).toBe("succeeded");
  } finally { reopened.close(); }
});

test("rename rejects conflicting names, invalid names, removed tasks and another run's task", () => {
  const f = setup(), loaded = f.definition(), task = f.engine.register(loaded);
  const other = f.engine.register({ ...loaded, path: loaded.path + ".other", definition: { ...loaded.definition, name: "other" } });
  const retired = f.engine.register({ ...loaded, path: loaded.path + ".retired", definition: { ...loaded.definition, name: "retired" } }, { disabled: true });
  f.engine.remove(retired.id);
  for (const name of ["", "   ", "invalid\0name", other.name, other.id, retired.id]) {
    expect(() => f.engine.rename(task.id, name)).toThrow();
    expect(f.engine.task(task.id)).toEqual(task);
  }
  const ticket = f.tick().find(t => t.run_id === f.engine.task(task.id).last_run)!;
  const run = f.engine.claim(ticket, "runner", 42, "boot");
  expect(() => f.engine.rename(other.id, "wrong task", run.context)).toThrow("only rename its own task");
  expect(f.engine.rename(task.id, "own task", run.context).name).toBe("own task");
  f.engine.ended(ticket, "runner", 0);
  f.engine.remove(task.id);
  expect(() => f.engine.rename(task.id, "retired")).toThrow("unregistered");
});

test("a confirmed next time survives script failure and reopening the database", () => {
  const f = setup(), task = f.engine.register(f.definition('[schedule]\nkind="completion"\nafter="24h"'));
  const ticket = f.tick()[0]!, run = f.engine.claim(ticket, "runner", 42, "boot");
  f.advance(13 * 60000);
  const due = f.now() + 86400000;
  f.engine.next(undefined, { at: due, source: "explicit" }, run.context);
  f.engine.ended(ticket, "runner", 7);
  const reopened = new Store(paths(f.home));
  try { const engine = new Engine(reopened, f.now); expect(engine.task(task.id).next?.at).toBe(due); expect(engine.run(run.id).status).toBe("failed"); }
  finally { reopened.close(); }
});

test("configuration updates replace pending overrides and fence old scheduling callbacks", () => {
  const f = setup(), task = f.engine.register(f.definition('[schedule]\nkind="completion"\nafter="24h"'));
  const ticket = f.tick()[0]!, run = f.engine.claim(ticket, "runner", 42, "boot");
  f.engine.next(undefined, { at: f.now() + 86400000, source: "explicit" }, run.context);
  f.engine.update(task.id, f.definition('[schedule]\nkind="completion"\nafter="2h"'));
  expect(f.engine.task(task.id).next).toBeNull();
  expect(() => f.engine.disable(undefined, run.context)).toThrow("revision 2");
  f.advance(60000); f.engine.ended(ticket, "runner", 0);
  expect(f.engine.task(task.id).next?.at).toBe(f.now() + 7200000);
});

test("completion waits for all agent work, handles child failure, and releases a finished parent's slot", () => {
  const f = setup(), task = f.engine.register(f.definition('[schedule]\nkind="completion"\nafter="24h"'));
  const scriptTicket = f.tick()[0]!, run = f.engine.claim(scriptTicket, "script", 42, "boot");
  const parent = f.engine.request(run.context, "Investigate");
  const parentTicket = f.tick()[0]!; f.engine.claim(parentTicket, "parent", 43, "boot");
  const child = f.engine.request(parent.context, "Investigate another angle");
  const childTicket = f.tick()[0]!; f.engine.claim(childTicket, "child", 44, "boot");
  f.engine.finish(child.context, "failed", "Unavailable");
  f.engine.handle(parent.context, child.id, "Verified using a local fallback");
  f.engine.finish(parent.context, "succeeded", "Finished");
  expect(f.engine.capacity().used).toBe(0);
  expect(f.engine.run(run.id).status).toBe("running");
  f.advance(13 * 60000); f.engine.ended(scriptTicket, "script", 0);
  expect(f.engine.run(run.id).status).toBe("succeeded");
  expect(f.engine.task(task.id).next?.at).toBe(f.now() + 86400000);
  expect(f.engine.agent(child.id).status).toBe("failed");
});

test("nested requests fail immediately at capacity while independent requests queue", () => {
  const f = setup(), settings = defaultSettings(); settings.limits.agents = 1; f.engine.applySettings(settings);
  f.engine.register(f.definition()); const ticket = f.tick()[0]!, run = f.engine.claim(ticket, "script", 42, "boot");
  const agent = f.engine.request(run.context, "First"); f.engine.claim(f.tick()[0]!, "agent", 43, "boot");
  expect(() => f.engine.request(agent.context, "Nested")).toThrow("All agent slots");
  const second = f.engine.request(run.context, "Independent"); expect(f.tick()).toEqual([]);
  f.engine.finish(agent.context, "succeeded", "Done"); expect(f.tick()[0]?.id).toBe(second.id);
});

test("duplicate tickets and competing schedulers cannot execute work twice", () => {
  const f = setup(); f.engine.register(f.definition());
  expect(f.engine.acquire("other", 999, "boot")).toBeNull();
  const ticket = f.tick()[0]!; f.engine.claim(ticket, "first", 42, "boot");
  expect(() => f.engine.claim(ticket, "second", 43, "boot")).toThrow("already claimed");
  f.advance(11000); const newLease = f.engine.acquire("other", 999, "boot")!;
  expect(() => f.tick()).toThrow("no longer owns");
  expect(f.engine.tick("other", newLease.generation, "boot")).toEqual([]);
});

test("reboot records interruption without silently retrying and cancellation rejects new work", () => {
  const f = setup(), task = f.engine.register(f.definition('[schedule]\nkind="completion"\nafter="24h"'));
  const ticket = f.tick()[0]!, run = f.engine.claim(ticket, "script", 42, "boot");
  f.engine.reconcile("another-boot", () => true);
  expect(f.engine.run(run.id).status).toBe("interrupted"); expect(f.engine.task(task.id).next).toBeNull();
  const manual = f.engine.manual(task.id); f.engine.stop(manual.id);
  expect(f.engine.run(manual.id).status).toBe("cancelled");
  expect(() => f.engine.request(manual.context, "Late")).toThrow("no longer accepts");
});

test("registration and command receipts do not reapply or duplicate accepted work", () => {
  const f = setup(), loaded = f.definition(), task = f.engine.register(loaded);
  f.advance(5000); expect(f.engine.register(f.definition()).next?.at).toBe(task.next?.at);
  const first = f.engine.receipt("manual", "key", { task: task.id }, () => f.engine.manual(task.id));
  const repeat = f.engine.receipt("manual", "key", { task: task.id }, () => f.engine.manual(task.id));
  expect(repeat.id).toBe(first.id);
  expect(() => f.engine.receipt("manual", "key", {}, () => null)).toThrow("different input");
});

test("an agent exit without a report is unconfirmed; reporting does not depend on terminal exit", () => {
  const f = setup(); f.engine.register(f.definition("", '[work]\nkind="agent"\ninstructions="Check"'));
  const ticket = f.tick()[0]!, run = f.engine.claim(ticket, "agent", 43, "boot");
  f.engine.ended(ticket, "agent", 0);
  expect(f.engine.run(run.id).status).toBe("unconfirmed");
  f.engine.resolve(ticket.id, "succeeded", "I verified the completed changes");
  expect(f.engine.run(run.id).status).toBe("succeeded");
});

test("updating before the first calendar execution chooses an occurrence after the update", () => {
  const f = setup(), loaded = f.definition('[schedule]\nkind="calendar"\ncron="0 13 * * *"\ntimezone="UTC"');
  loaded.definition.first_run = { kind: "schedule" };
  const task = f.engine.register(loaded); f.advance(2 * 3600000);
  expect(new Date(f.engine.update(task.id, loaded).next!.at).toISOString()).toBe("2026-09-05T13:00:00.000Z");
  loaded.definition.first_run = { kind: "now" };
  expect(f.engine.update(task.id, loaded).next?.at).toBe(f.now());
  loaded.definition.first_run = { kind: "at", at: "2026-09-04T13:00:00Z" };
  expect(() => f.engine.update(task.id, loaded)).toThrow("future");
});

test("elapsed waits preserve their remaining duration across a wall-clock adjustment", () => {
  const f = setup(); let elapsed = 100000;
  const engine = new Engine(f.store, f.now, () => ({ boot_id: "boot", at: elapsed }));
  const task = engine.register(f.definition());
  engine.next(task.id, engine.after("24h"));
  elapsed += 3600000; f.advance(7200000);
  engine.tick("scheduler", engine.lease()!.generation, "boot");
  expect(engine.task(task.id).next!.at - f.now()).toBe(23 * 3600000);
});

test("reboot interrupts queued descendants of an interrupted run instead of launching them", () => {
  const f = setup(); f.engine.register(f.definition());
  const ticket = f.tick()[0]!, run = f.engine.claim(ticket, "script", 42, "boot");
  const child = f.engine.request(run.context, "Pending child");
  f.engine.reconcile("new-boot", () => false);
  expect(f.engine.agent(child.id).status).toBe("interrupted");
  expect(f.engine.run(run.id).status).toBe("interrupted");
});

test("an external harness exit alerts once while its run remains uncertain", () => {
  const f = setup(); f.engine.register(f.definition("", '[work]\nkind="agent"\ninstructions="Check"'));
  const ticket = f.tick()[0]!, run = f.engine.claim(ticket, "agent", 43, "boot");
  f.engine.ended(ticket, "agent", 0, null, true);
  expect(f.engine.run(run.id).status).toBe("uncertain");
  expect(f.engine.run(run.id).finished_at).toBeNull();
  expect(f.engine.capacity().used).toBe(1);
  expect(f.store.all("notifications")).toHaveLength(1);
  expect(f.store.all("notifications")[0]!.outcome).toBe("unconfirmed");
  f.engine.ended(ticket, "agent", 0, null, true);
  f.advance(40000); f.engine.reconcile("boot", () => false);
  expect(f.store.all("notifications")).toHaveLength(1);
});
