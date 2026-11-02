import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Engine } from "../src/engine.ts";
import { Store } from "../src/store.ts";
import { paths } from "../src/paths.ts";
import { alive, bootId, processGroupsEnded } from "../src/platform.ts";

const cases = process.platform === "linux" ? [{ detached: false, crash: true }, { detached: true, crash: true }, { detached: true, crash: false }] : [{ detached: false, crash: true }];
for (const { detached, crash } of cases) {
test.skipIf(process.platform === "win32")(`${crash ? "a killed runner" : "a normal harness exit"} releases capacity only after its ${detached ? "detached" : "grouped"} tool ends`, async () => {
  const home = mkdtempSync(join(tmpdir(), "impulse-runner-recovery-")), cwd = join(home, "work"); mkdirSync(cwd);
  const cli = [process.execPath, resolve("src/cli.ts")];
  const env = { ...process.env, IMPULSE_HOME: home, IMPULSE_CONTEXT: "" };
  async function invoke(args: string[]) {
    const child = Bun.spawn([...cli, ...args, "--json"], { env, stdout: "pipe", stderr: "pipe" });
    const output = await new Response(child.stdout).text(), error = await new Response(child.stderr).text();
    if (await child.exited !== 0) throw new Error(output + error);
    return JSON.parse(output).data;
  }
  const exitFile = join(cwd, "exit-harness");
  const marker = join(cwd, "tool-pid"), harness = join(cwd, "harness.ts"), file = join(cwd, "task.toml"), settings = join(home, "settings.toml");
  const tool = `import {writeFileSync} from "node:fs"; process.on("SIGHUP",()=>{}); writeFileSync(${JSON.stringify(marker)},String(process.pid)); setInterval(()=>{},1000);`;
  writeFileSync(harness, `import {spawn} from "node:child_process"; import {existsSync} from "node:fs"; spawn(process.execPath,["-e",${JSON.stringify(tool)}],{detached:${detached},stdio:"ignore"}); setInterval(()=>{if(existsSync(${JSON.stringify(exitFile)}))process.exit(0)},20);`);
  writeFileSync(settings, Bun.TOML.stringify({ schema_version: 1, defaults: { harness: "fixture", terminal: "fixture" }, notifications: { desktop: false },
    harnesses: { fixture: { command: [process.execPath, harness, "{launch_file}"], lifecycle: "process" } },
    terminals: { fixture: { command: [process.execPath, resolve("tests/fixtures/terminal.ts"), "{launch_file}"] } } })!);
  let runner = 0, toolPid = 0;
  try {
    await invoke(["config", "apply", settings]);
    writeFileSync(file, Bun.TOML.stringify({ schema_version: 1, name: "recovery", cwd, work: { kind: "agent", instructions: "fixture" }, first_run: { kind: "now" } })!);
    await invoke(["task", "register", file, "--harness", "fixture"]);
    let task: any, agent: any;
    for (let i = 0; i < 100; i++) {
      task = await invoke(["task", "show", "recovery"]);
      if (task.last_run) {
        agent = (await invoke(["run", "show", task.last_run])).agents[0];
        runner = agent?.pid ?? 0;
      }
      if (existsSync(marker)) toolPid = Number(readFileSync(marker, "utf8"));
      if (toolPid && agent?.process_groups?.length) break;
      await Bun.sleep(50);
    }
    expect(agent.process_groups).toHaveLength(1);
    runner = agent.pid; toolPid = Number(readFileSync(marker, "utf8"));
    await invoke(["daemon", "stop"]); await Bun.sleep(700);
    if (crash) process.kill(runner, "SIGKILL"); else writeFileSync(exitFile, "done");
    for (let i = 0; i < 50 && alive(crash ? runner : agent.process_groups[0]); i++) await Bun.sleep(20);
    expect(alive(runner)).toBe(!crash); expect(alive(toolPid)).toBe(true);
    const store = new Store(paths(home)), engine = new Engine(store, () => Date.now() + 20000);
    try {
      engine.reconcile(bootId(), alive, processGroupsEnded);
      expect(engine.run(task.last_run).status).toBe(crash ? "uncertain" : "running");
      const report = (await invoke(["doctor"])).capacity;
      expect(report).toMatchObject({ used: 1, executing: crash ? 0 : 1, uncertain: crash ? [{ task_name: "recovery", agent_id: agent.id, recovery: "owned-process-groups" }] : [] });
      process.kill(toolPid, "SIGKILL");
      for (let i = 0; i < 50 && alive(toolPid); i++) await Bun.sleep(20);
      for (let i = 0; i < 100; i++) {
        engine.reconcile(bootId(), alive, processGroupsEnded);
        if (engine.run(task.last_run).status === "unconfirmed") break;
        await Bun.sleep(20);
      }
      expect(engine.run(task.last_run).status).toBe("unconfirmed");
      expect(engine.capacity().used).toBe(0);
      expect((await invoke(["doctor"])).capacity).toMatchObject({ used: 0, executing: 0, uncertain: [] });
    } finally { store.close(); }
  } finally {
    for (const pid of [runner, toolPid]) if (pid && alive(pid)) process.kill(pid, "SIGKILL");
    await invoke(["daemon", "stop"]); await Bun.sleep(700); rmSync(home, { recursive: true, force: true });
  }
}, 20000);
}
