import { readFileSync } from "node:fs";
import { Engine } from "./engine.ts";
import { Store } from "./store.ts";
import { parseObservation } from "./observation.ts";
import type { Paths } from "./paths.ts";
import type { Context, Observation } from "./types.ts";

export function claudeSettings(command: string[], contextFile: string, session: string) {
  const hook = { type: "command", command: command[0], args: [...command.slice(1), "_claude-hook", contextFile, session], timeout: 10 };
  return { hooks: Object.fromEntries(["SessionStart", "UserPromptSubmit", "Stop", "StopFailure"].map(event => [event, [{ hooks: [hook] }]])) };
}

/** Hooks only report progress. They never return decisions or persist prompts/tool inputs. */
export async function claudeHook(contextFile: string, session: string) {
  let store: Store | undefined;
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of Bun.stdin.stream()) {
      size += chunk.length; if (size > 1024 * 1024) throw new Error("Hook input exceeds limit");
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (input.session_id !== session || input.agent_id) return;
    const event = input.hook_event_name;
    if (!["SessionStart", "UserPromptSubmit", "Stop", "StopFailure"].includes(event)) return;
    const observation: Observation = { session_id: session, state: event === "Stop" ? "idle" : "active" };
    if (event === "StopFailure") {
      observation.state = "failed";
      const clean = (value: unknown, fallback: string, max: number) => typeof value === "string" && value.trim() ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : fallback;
      observation.error = { code: clean(input.error, "unknown", 128), message: clean(input.error_details, "Claude Code turn failed", 4096) };
    }
    const context = JSON.parse(readFileSync(contextFile, "utf8")) as Context & { paths: Paths };
    store = new Store(context.paths);
    const engine = new Engine(store);
    // Hooks have no provider turn ID. Give each submitted turn a local identity for failure deduplication.
    if (event === "UserPromptSubmit") observation.turn_id = crypto.randomUUID();
    else {
      const previous = context.agent_id ? engine.agent(context.agent_id).observation : undefined;
      if (previous?.turn_id) observation.turn_id = previous.turn_id;
    }
    engine.observe(context, parseObservation(observation), "claude-hooks");
  } catch (error) {
    // Late hooks are expected when an agent reports its outcome before the terminal closes.
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "RUN_CLOSED" && code !== "AGENT_CLOSED") console.error("Impulse: Claude observation unavailable; inspect the assignment session.");
  } finally { store?.close(); }
}

/** Older releases retain process-level observation; these hook/exec-form contracts are verified here. */
export function supportsClaudeObservation(version: string): boolean {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)\b/);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major! > 2 || (major === 2 && (minor! > 1 || (minor === 1 && patch! >= 269)));
}
