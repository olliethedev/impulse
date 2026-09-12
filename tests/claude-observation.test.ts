import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixture } from "./helpers.ts";
import { claudeSettings } from "../src/claude-observation.ts";

test("Claude hooks are scoped, silent and cannot alter an explicit outcome", async () => {
  const f = fixture(), session = "session-id", file = join(f.home, "context ' $.json");
  try {
    f.engine.register(f.definition('', '[work]\nkind="agent"\ninstructions="fixture"'));
    const ticket = f.tick()[0]!, run = f.engine.claim(ticket, "runner", 42, "boot"), agent = f.engine.agent(run.root_agent!);
    writeFileSync(file, JSON.stringify({ ...agent.context, paths: f.store.paths }));
    const settings = claudeSettings([process.execPath, resolve("src/cli.ts")], file, session);
    const hook = settings.hooks.StopFailure![0]!.hooks[0]!;
    async function fire(input: unknown) {
      const child = Bun.spawn([hook.command!, ...hook.args], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      child.stdin.write(JSON.stringify(input)); child.stdin.end();
      expect(await new Response(child.stdout).text()).toBe("");
      expect(await child.exited).toBe(0);
    }
    await fire({ session_id: "unrelated", hook_event_name: "StopFailure", error: "overloaded" });
    await fire({ session_id: session, agent_id: "child", hook_event_name: "StopFailure", error: "overloaded" });
    expect(f.engine.agent(agent.id).observation).toBeUndefined();
    await fire({ session_id: session, hook_event_name: "UserPromptSubmit", prompt: "private prompt" });
    await fire({ session_id: session, hook_event_name: "StopFailure", error: "authentication_failed", error_details: "Please authenticate", last_assistant_message: "unused private text" });
    expect(f.engine.agent(agent.id).observation).toMatchObject({ source: "claude-hooks", state: "failed", session_id: session, error: { code: "authentication_failed", message: "Please authenticate" } });
    expect(f.engine.agent(agent.id).observation?.turn_id).toBeString();
    await fire({ session_id: session, hook_event_name: "StopFailure", error: "overloaded", last_assistant_message: "private conversation without error details" });
    expect(f.engine.agent(agent.id).observation?.error?.message).toBe("Claude Code turn failed");
    expect(JSON.stringify(f.engine.events(run.id))).not.toContain("private");
    f.engine.finish(agent.context, "succeeded", "Recovered and verified");
    await fire({ session_id: session, hook_event_name: "StopFailure", error: "late_error" });
    expect(f.engine.run(run.id).status).toBe("succeeded");
  } finally { f.close(); }
});
