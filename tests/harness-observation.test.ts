import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { shellQuote } from "../src/platform.ts";

test.skipIf(process.platform === "win32")("built-in and custom harness failures remain observable while their frontends stay open", async () => {
  const home = mkdtempSync(join(tmpdir(), "impulse ' $-")), bin = join(home, "bin"); mkdirSync(bin);
  const cli = [process.execPath, resolve("src/cli.ts")], fixture = resolve("tests/fixtures/observed-harness.ts");
  const env = { ...process.env, IMPULSE_HOME: home, IMPULSE_CONTEXT: "", CODEX_HOME: join(home, "codex"), CLAUDE_CONFIG_DIR: join(home, "claude"), PATH: `${bin}:${process.env.PATH}` };
  async function invoke(args: string[]) {
    const process = Bun.spawn([...cli, ...args, "--json"], { env, stdout: "pipe", stderr: "pipe" });
    const output = await new Response(process.stdout).text(), error = await new Response(process.stderr).text();
    if (!output.trim()) throw new Error(error);
    return { code: await process.exited, ...JSON.parse(output) };
  }
  for (const harness of ["codex", "claude"]) writeFileSync(join(bin, harness), `#!/bin/sh\nexec ${[process.execPath, fixture, harness].map(shellQuote).join(" ")} "$@"\n`, { mode: 0o700 });
  const settings = join(home, "settings.toml");
  writeFileSync(settings, Bun.TOML.stringify({ schema_version: 1, defaults: { harness: "codex", terminal: "fixture" }, notifications: { desktop: false },
    terminals: { fixture: { command: [process.execPath, resolve("tests/fixtures/terminal.ts"), "{launch_file}"] } },
    harnesses: { process: { command: [process.execPath, fixture, "custom", "{launch_file}"], lifecycle: "process" }, external: { command: [process.execPath, fixture, "custom", "{launch_file}"], lifecycle: "external" } } })!);
  const runs: string[] = [];
  try {
    const applied = await invoke(["config", "apply", settings]);
    if (applied.code !== 0) throw new Error(JSON.stringify(applied));
    for (const harness of ["codex", "claude-code", "process", "external"]) {
      const cwd = join(home, harness); mkdirSync(cwd);
      const definition = join(cwd, "task.toml");
      writeFileSync(definition, Bun.TOML.stringify({ schema_version: 1, name: harness, cwd: ".", work: { kind: "agent", instructions: "Observe fixture" }, first_run: { kind: "now" } })!);
      expect((await invoke(["task", "register", definition, "--harness", harness])).code).toBe(0);
      let task: any;
      for (let i = 0; i < 150; i++) {
        task = (await invoke(["task", "show", harness])).data;
        if (task.last_run) {
          const report = (await invoke(["run", "diagnose", task.last_run])).data;
          if (report.issues.some((issue: any) => issue.code === "HARNESS_FAILURE")) break;
        }
        await Bun.sleep(100);
      }
      const id = task.last_run; runs.push(id);
      const before = (await invoke(["run", "show", id])).data;
      const diagnosis = await invoke(["run", "diagnose", id]);
      expect(diagnosis.code).toBe(0);
      expect(diagnosis.data).toMatchObject({ status: "running", replacement_blocked: true, schedule: { enabled: true, hold: false, next: { source: "explicit" } } });
      expect(diagnosis.data.components[0]).toMatchObject({ runner_alive: true, outcome: null, observation: { state: "failed", error: { message: "Fixture model is at capacity" } } });
      const source = harness === "codex" ? "codex-app-server" : harness === "claude-code" ? "claude-hooks" : "wrapper";
      expect(diagnosis.data.components[0].observation.source).toBe(source);
      expect(JSON.stringify(diagnosis)).not.toContain("PRIVATE PROMPT");
      expect(JSON.stringify(diagnosis)).not.toContain('"token"');
      expect((await invoke(["run", "show", id])).data.events).toEqual(before.events);
      const next = diagnosis.data.schedule.next;
      writeFileSync(join(cwd, "exit"), "done");
      let after: any;
      for (let i = 0; i < 100; i++) {
        after = (await invoke(["run", "show", id])).data;
        if (["failed", "uncertain"].includes(after.status)) break;
        await Bun.sleep(100);
      }
      expect(after.status).toBe(harness === "external" ? "uncertain" : "failed");
      expect((await invoke(["task", "show", harness])).data.next).toEqual(next);
      if (harness === "external") {
        expect((await invoke(["agent", "resolve", after.root_agent, "--outcome", "failed", "--reason", "Cannot resolve live uncertainty"])).code).toBe(4);
        expect((await invoke(["run", "confirm-ended", id, "--reason", "Fixture exited and has no external work"])).code).toBe(0);
        expect((await invoke(["agent", "resolve", after.root_agent, "--outcome", "failed", "--reason", "Verified incomplete fixture"])).code).toBe(0);
      }
    }
  } finally {
    for (const run of runs) await invoke(["run", "stop", run, "--force"]);
    await invoke(["daemon", "stop"]); await Bun.sleep(700); rmSync(home, { recursive: true, force: true });
  }
}, 60000);
