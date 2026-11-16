import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { shellQuote } from "../src/platform.ts";

test.skipIf(process.platform === "win32")("run resume continues an ended Claude Code session in a new run", async () => {
  const home = mkdtempSync(join(tmpdir(), "impulse-resume ' $-")), bin = join(home, "bin"), cli = [process.execPath, resolve("src/cli.ts")];
  const env = { ...process.env, IMPULSE_HOME: home, IMPULSE_CONTEXT: "", CLAUDE_CONFIG_DIR: join(home, "claude"), PATH: `${bin}:${process.env.PATH}` };
  async function invoke(args: string[]) {
    const child = Bun.spawn([...cli, ...args, "--json"], { cwd: home, env, stdout: "pipe", stderr: "pipe" });
    const output = await new Response(child.stdout).text(), error = await new Response(child.stderr).text();
    if (!output.trim()) throw new Error(error);
    return { code: await child.exited, ...JSON.parse(output) };
  }
  async function ended(name: string, previous?: string) {
    for (let i = 0; i < 150; i++) {
      const task = (await invoke(["task", "show", name])).data;
      if (task.last_run !== previous && task.latest_run?.finished_at) return task.latest_run;
      await Bun.sleep(100);
    }
    throw new Error(`${name} did not end`);
  }
  try {
    mkdirSync(bin);
    // The first launch exits without an outcome; a resumed launch reports success.
    const fixture = join(home, "claude-fixture.ts");
    writeFileSync(fixture, `import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("2.1.269 (fixture)"); process.exit(0); }
appendFileSync("launches.jsonl", JSON.stringify(args) + "\\n");
const flag = args.includes("--resume") ? "--resume" : "--session-id", session = args[args.indexOf(flag) + 1];
const hook = JSON.parse(readFileSync(args[args.indexOf("--settings") + 1]!, "utf8")).hooks.SessionStart[0].hooks[0];
const hookProcess = Bun.spawn([hook.command, ...hook.args], { stdin: "pipe", stdout: "ignore", stderr: "inherit" });
hookProcess.stdin.write(JSON.stringify({ session_id: session, hook_event_name: "SessionStart" })); hookProcess.stdin.end();
await hookProcess.exited;
if (flag === "--resume") {
  const child = Bun.spawn(${JSON.stringify([...cli, "agent", "finish", "--outcome", "success", "--summary", "Resumed fixture completed", "--json"])}, { stdout: "ignore", stderr: "inherit" });
  process.exit(await child.exited);
}
`);
    writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec ${[process.execPath, fixture].map(shellQuote).join(" ")} "$@"\n`, { mode: 0o700 });
    const quiet = join(home, "quiet.ts"); writeFileSync(quiet, "");
    const settings = join(home, "settings.toml");
    writeFileSync(settings, Bun.TOML.stringify({ schema_version: 1, defaults: { harness: "claude-code", terminal: "fixture" }, notifications: { desktop: false },
      terminals: { fixture: { command: [process.execPath, resolve("tests/fixtures/terminal.ts"), "{launch_file}"] } },
      harnesses: { quiet: { command: [process.execPath, quiet, "{launch_file}"], lifecycle: "process" } } })!);
    expect((await invoke(["config", "apply", settings])).code).toBe(0);
    for (const [name, harness] of [["claude", "claude-code"], ["custom", "quiet"]]) {
      const cwd = join(home, name!); mkdirSync(cwd);
      writeFileSync(join(cwd, "task.toml"), Bun.TOML.stringify({ schema_version: 1, name, cwd: ".", work: { kind: "agent", instructions: "Resume fixture" }, first_run: { kind: "now" } })!);
      expect((await invoke(["task", "register", join(cwd, "task.toml"), "--harness", harness!])).code).toBe(0);
    }

    const first = await ended("claude");
    expect(first.status).toBe("unconfirmed");
    const recovery = (await invoke(["run", "diagnose", first.id])).data.recovery.map((r: any) => r.command);
    expect(recovery).toContainEqual(["impulse", "run", "resume", first.id]);

    const resumed = await invoke(["run", "resume", first.id]);
    expect(resumed.code).toBe(0);
    expect(resumed.data.trigger).toBe("resume");
    const second = await ended("claude", first.id);
    expect(second.status).toBe("succeeded");

    const [launch, relaunch] = readFileSync(join(home, "claude", "launches.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    const session = launch[launch.indexOf("--session-id") + 1];
    expect(relaunch).toContain("--resume");
    expect(relaunch[relaunch.indexOf("--resume") + 1]).toBe(session);
    expect(relaunch).not.toContain("--session-id");
    expect(relaunch.at(-1)).toContain("Impulse resumed this session as a new run");
    const shown = (await invoke(["run", "show", second.id])).data;
    expect(shown.agents[0].resumes).toEqual({ run_id: first.id, agent_id: first.root_agent, session_id: session });
    expect(shown.events.map((e: any) => e.type)).toContain("resumed");
    expect((await invoke(["run", "show", first.id])).data.status).toBe("unconfirmed");

    expect((await invoke(["run", "resume", second.id])).error.code).toBe("NOT_RESUMABLE");
    const custom = await ended("custom");
    expect(custom.status).toBe("unconfirmed");
    expect((await invoke(["run", "resume", custom.id])).error.code).toBe("SESSION_UNKNOWN");
  } finally {
    await invoke(["daemon", "stop"]); await Bun.sleep(700);
    rmSync(home, { recursive: true, force: true });
  }
}, 60000);
