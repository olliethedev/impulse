import { afterEach, expect, test } from "bun:test";
import { Engine } from "../src/engine.ts";
import { Store } from "../src/store.ts";
import { defaultSettings } from "../src/config.ts";
import { fixture } from "./helpers.ts";

const fixtures: ReturnType<typeof fixture>[] = [];
function setup() {
  const f = fixture(); fixtures.push(f);
  const task = f.engine.register(f.definition("", '[work]\nkind="agent"\ninstructions="Check"'));
  const ticket = f.tick()[0]!, run = f.engine.claim(ticket, "runner", 42, "boot");
  return { ...f, task, ticket, run, agent: f.engine.agent(ticket.id) };
}
afterEach(() => { for (const f of fixtures.splice(0)) f.close(); });

test("a vanished runner releases capacity after all its owned execution ends, including after restart", () => {
  const f = setup();
  f.engine.trackProcessGroups(f.ticket, "runner", [100, 101]);
  f.engine.next(undefined, f.engine.after("24h"), f.agent.context);
  const next = f.engine.task(f.task.id).next;
  f.engine.observe(f.agent.context, { state: "failed", error: { code: "rate_limit", message: "Try later" } });
  f.advance(20000);
  const store = new Store(f.store.paths);
  try {
    const engine = new Engine(store, f.now);
    engine.reconcile("boot", () => false, groups => groups.every(g => ![101].includes(g)));
    expect(engine.capacity().used).toBe(1);
    expect(engine.run(f.run.id).status).toBe("uncertain");
    engine.reconcile("boot", () => false, () => true);
    expect(engine.capacity().used).toBe(0);
    expect(engine.run(f.run.id).status).toBe("unconfirmed");
    expect(engine.agent(f.agent.id)).toMatchObject({ outcome: null, observation: { state: "failed" }, ended_at: f.now() });
    expect(engine.task(f.task.id).next).toEqual(next);
    expect(engine.events(f.run.id).filter(e => e.type === "owned_execution_ended")).toHaveLength(1);
    engine.reconcile("boot", () => false, () => true);
    expect(engine.events(f.run.id).filter(e => e.type === "owned_execution_ended")).toHaveLength(1);
  } finally { store.close(); }
});

test("live runners and fresh heartbeats retain their slots even when no owned group is observed", () => {
  const f = setup(); f.engine.trackProcessGroups(f.ticket, "runner", [100]);
  f.engine.reconcile("boot", () => false, () => true);
  expect(f.engine.capacity().used).toBe(1);
  f.advance(20000); f.engine.reconcile("boot", () => true, () => true);
  expect(f.engine.capacity().used).toBe(1);
  expect(f.engine.run(f.run.id).status).toBe("running");
});

test("legacy and interrupted launches without complete ownership retain uncertainty", () => {
  const f = setup(); f.advance(20000);
  f.engine.reconcile("boot", () => false, () => true);
  expect(f.engine.capacity().used).toBe(1);
  expect(f.engine.run(f.run.id).status).toBe("uncertain");
  expect(f.engine.capacityReport()).toMatchObject({ executing: 0, uncertain: [{ task_name: "fixture", recovery: "operator-verification" }] });
});

test("reconciliation without a process-group probe retains uncertainty", () => {
  const f = setup(); f.engine.trackProcessGroups(f.ticket, "runner", [100]);
  f.advance(20000); f.engine.reconcile("boot", () => false);
  expect(f.engine.capacity().used).toBe(1);
  expect(f.engine.capacityReport()).toMatchObject({ used: 1, executing: 0, uncertain: [{ agent_id: f.agent.id, run_id: f.run.id, recovery: "owned-process-groups" }] });
});

test("verified cancellation frees the slot without reporting success or repeating work", () => {
  const f = setup(); f.engine.trackProcessGroups(f.ticket, "runner", [100]);
  f.engine.stop(f.run.id); f.advance(20000);
  f.engine.reconcile("boot", () => false, () => true);
  expect(f.engine.capacity().used).toBe(0);
  expect(f.engine.run(f.run.id).status).toBe("cancelled");
  expect(f.engine.agent(f.agent.id).outcome).toBeNull();
});

test("a recovered parent's slot is freed while surviving children retain their slots", () => {
  const f = setup();
  const settings = defaultSettings(); settings.limits.agents = 2; f.engine.applySettings(settings);
  f.engine.trackProcessGroups(f.ticket, "runner", [100]);
  const child = f.engine.request(f.agent.context, "Child"), ticket = f.tick()[0]!;
  f.engine.claim(ticket, "child", 43, "boot"); f.engine.trackProcessGroups(ticket, "child", [101]);
  f.advance(20000); f.engine.reconcile("boot", pid => pid === 43, groups => groups.every(g => g !== 101));
  expect(f.engine.capacity().used).toBe(1);
  expect(f.engine.agent(f.agent.id).status).toBe("unconfirmed");
  expect(f.engine.agent(child.id).status).toBe("running");
  expect(f.engine.run(f.run.id).status).toBe("running");
  f.engine.finish(child.context, "succeeded", "Done");
  expect(f.engine.run(f.run.id).status).toBe("unconfirmed");
});

test("process ownership rejects stale runners, invalid groups, and replacement of a complete group set", () => {
  const f = setup();
  expect(() => f.engine.trackProcessGroups(f.ticket, "other", [100])).toThrow("Runner identity");
  for (const groups of [[], [0], [-1], [NaN]]) expect(() => f.engine.trackProcessGroups(f.ticket, "runner", groups)).toThrow("positive PIDs");
  f.engine.trackProcessGroups(f.ticket, "runner", [100]);
  expect(() => f.engine.trackProcessGroups(f.ticket, "runner", [101])).toThrow("already recorded");
  f.advance(20000); f.engine.reconcile("boot", () => false, groups => groups.includes(101));
  expect(f.engine.capacity().used).toBe(1);
});


test("an external lifecycle never reuses earlier local termination evidence", () => {
  const f = setup(); f.engine.trackProcessGroups(f.ticket, "runner", [100]);
  f.engine.ended(f.ticket, "runner", 0, null, true);
  f.advance(20000); f.engine.reconcile("boot", () => false, () => true);
  expect(f.engine.capacity().used).toBe(1);
  expect(f.engine.run(f.run.id).status).toBe("uncertain");
});
