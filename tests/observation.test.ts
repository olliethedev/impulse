import { afterEach, expect, test } from "bun:test";
import { fixture } from "./helpers.ts";

const fixtures: ReturnType<typeof fixture>[] = [];
function setup() {
  const f = fixture(); fixtures.push(f);
  const task = f.engine.register(f.definition('', '[work]\nkind="agent"\ninstructions="fixture"'));
  const ticket = f.tick()[0]!, run = f.engine.claim(ticket, "runner", 42, "boot");
  const agent = f.engine.agent(run.root_agent!);
  return { ...f, task, ticket, run, agent };
}
afterEach(() => { for (const f of fixtures.splice(0)) f.close(); });

test("a harness failure is visible while execution and its explicit next time remain protected", () => {
  const f = setup();
  f.engine.next(undefined, f.engine.after("24h"), f.agent.context);
  const next = f.engine.task(f.task.id).next;
  const failure = { state: "failed" as const, session_id: "session-1", turn_id: "turn-1", active_tools: 1,
    error: { code: "server_overloaded", message: "Model is at capacity" } };
  f.engine.observe(f.agent.context, failure);
  f.engine.observe(f.agent.context, failure);
  expect(f.engine.run(f.run.id).status).toBe("running");
  expect(f.engine.capacity().used).toBe(1);
  expect(f.engine.agent(f.agent.id).outcome).toBeNull();
  expect(f.engine.task(f.task.id).next).toEqual(next);
  expect(f.engine.events(f.run.id).filter(e => e.type === "harness_failure")).toHaveLength(1);
  expect(f.store.all("notifications")).toHaveLength(1);
  expect(f.store.all("notifications")[0]!.summary).toContain(`impulse run diagnose ${f.run.id}`);
  expect(f.store.all("notifications")[0]!.summary).not.toContain(failure.error.message);
  const report = f.engine.diagnose(f.run.id, "boot", () => true);
  expect(report.components[0]).toMatchObject({ runner_alive: true, observation: { state: "failed", active_tools: 1 } });
  expect(report.issues.map(i => i.code)).toContain("HARNESS_FAILURE");
  expect(report.replacement_blocked).toBe(true);
  // The process lifecycle, not an observer's failure event, establishes termination.
  f.engine.ended(f.ticket, "runner", 0);
  expect(f.engine.run(f.run.id).status).toBe("failed");
  expect(f.engine.agent(f.agent.id).error).toBe("Model is at capacity");
  expect(f.engine.task(f.task.id).next).toEqual(next);
});

test("observation cannot finish work, override a reported outcome, or release external execution", () => {
  const f = setup();
  f.engine.observe(f.agent.context, { state: "idle", active_tools: 0 });
  expect(f.engine.run(f.run.id).status).toBe("running");
  f.engine.observe(f.agent.context, { state: "failed", error: { code: "overloaded", message: "Try again" } });
  f.engine.ended(f.ticket, "runner", 0, null, true);
  expect(f.engine.run(f.run.id).status).toBe("uncertain");
  expect(f.engine.capacity().used).toBe(1);
  expect(f.engine.diagnose(f.run.id, "different-boot", () => true).components[0]!.runner_alive).toBe(false);
  f.engine.confirmEnded(f.run.id, "Verified external work ended", () => false);
  f.engine.resolve(f.agent.id, "failed", "Incomplete work");
  expect(() => f.engine.observe(f.agent.context, { state: "active" })).toThrow();
  expect(f.engine.agent(f.agent.id).summary).toBe("Incomplete work");
});

test("an explicitly completed assignment survives late harness observations and process errors", () => {
  const f = setup();
  f.engine.finish(f.agent.context, "succeeded", "Verified result");
  expect(() => f.engine.observe(f.agent.context, { state: "failed", error: { code: "late", message: "Late error" } })).toThrow();
  f.engine.ended(f.ticket, "runner", 1, "Late process failure");
  expect(f.engine.run(f.run.id).status).toBe("succeeded");
  expect(f.engine.capacity().used).toBe(0);
});

test("lost observation retains failure evidence and a later turn can recover", () => {
  const f = setup();
  const failure = { state: "failed" as const, session_id: "session", turn_id: "turn", error: { code: "overloaded", message: "Try later" } };
  f.engine.observe(f.agent.context, failure);
  const previous = f.engine.agent(f.agent.id).last_harness_failure!;
  f.advance(5000);
  f.engine.observe(f.agent.context, { state: "unavailable", note: "Connection lost" });
  const report = f.engine.diagnose(f.run.id, "boot", () => true);
  expect(report.components[0]!.last_harness_failure).toEqual(previous);
  expect(report.issues.map(issue => issue.code)).toContain("LAST_HARNESS_FAILURE");
  f.engine.observe(f.agent.context, failure);
  expect(f.engine.capacity().used).toBe(1);
  expect(f.store.all("notifications")).toHaveLength(1);
  f.engine.observe(f.agent.context, { state: "active", session_id: "session", turn_id: "resumed" });
  f.engine.finish(f.agent.context, "succeeded", "Resumed and verified");
  expect(f.engine.diagnose(f.run.id, "boot", () => true).issues.map(issue => issue.code)).not.toContain("HARNESS_FAILURE");
});
