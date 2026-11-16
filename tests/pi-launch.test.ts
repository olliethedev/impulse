import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { shellQuote } from "../src/platform.ts";

test.skipIf(process.platform === "win32")("Pi launches preserve instructions, require explicit outcomes and support scoped cancellation", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "impulse-pi ' $-"))), bin = join(home, "bin"), cli = [process.execPath, resolve("src/cli.ts")];
  const env = { ...process.env, IMPULSE_HOME: home, IMPULSE_CONTEXT: "", PI_CODING_AGENT_DIR: join(home, "pi-agent"), PATH: `${bin}:${process.env.PATH}` };
  async function invoke(args: string[], cwd = home) {
    const child = Bun.spawn([...cli, ...args, "--json"], { cwd, env, stdout: "pipe", stderr: "pipe" });
    const output = await new Response(child.stdout).text(), error = await new Response(child.stderr).text();
    if (!output.trim()) throw new Error(error);
    return { code: await child.exited, ...JSON.parse(output) };
  }
  try {
    mkdirSync(bin);
    const fixture = join(home, "pi-fixture.ts");
    writeFileSync(fixture, `import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const context = JSON.parse(readFileSync(process.env.IMPULSE_CONTEXT!, "utf8"));
const instructionsFile = join(context.paths.launches, context.agent_id + ".instructions.md");
const instructions = readFileSync(instructionsFile, "utf8");
writeFileSync("sample.json", JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), instructionsFile, instructions, run: process.env.IMPULSE_RUN_ID, agent: process.env.IMPULSE_AGENT_ID }));
if (instructions.startsWith("finish")) {
  const child = Bun.spawn(${JSON.stringify([...cli, "agent", "finish", "--outcome", "success", "--summary", "Pi fixture completed", "--json"])}, { stdout: "ignore", stderr: "inherit" });
  process.exit(await child.exited);
}
if (instructions.startsWith("wait")) setInterval(() => {}, 1000);
`);
    writeFileSync(join(bin, "pi"), `#!/bin/sh\nexec ${[process.execPath, fixture].map(shellQuote).join(" ")} "$@"\n`, { mode: 0o700 });
    const settings = join(home, "settings.toml");
    writeFileSync(settings, Bun.TOML.stringify({ schema_version: 1, defaults: { harness: "pi", terminal: "fixture" }, notifications: { desktop: false }, terminals: { fixture: { command: [process.execPath, resolve("tests/fixtures/terminal.ts"), "{launch_file}"] } } })!);
    expect((await invoke(["config", "apply", settings])).code).toBe(0);
    expect((await invoke(["doctor"])).data.harness).toEqual({ name: "pi", executable: join(bin, "pi") });
    for (const scope of ["user", "project"]) {
      const installed = await invoke(["skill", "install", "--harness", "pi", "--scope", scope]);
      expect(installed.code).toBe(0);
      expect(installed.data.directory).toBe(scope === "user" ? join(home, "pi-agent", "skills", "impulse") : join(home, ".pi", "skills", "impulse"));
    }
    for (const mode of ["finish", "exit", "wait"]) {
      const cwd = join(home, mode); mkdirSync(cwd);
      const file = join(cwd, "task.toml"), instructions = `${mode}\nLiteral ' \" $(do-not-execute) \`data\``;
      writeFileSync(file, Bun.TOML.stringify({ schema_version: 1, name: mode, cwd: ".", work: { kind: "agent", instructions }, first_run: { kind: "now" } })!);
      expect((await invoke(["task", "register", file, "--harness", "pi"])).code).toBe(0);
      let task: any;
      for (let i = 0; i < 100; i++) {
        task = (await invoke(["task", "show", mode])).data;
        if (mode === "wait" ? task.latest_run?.agents?.length && task.latest_run.agents[0].pid : task.latest_run?.finished_at) break;
        if (mode === "wait") { try { readFileSync(join(cwd, "sample.json")); break; } catch {} }
        await Bun.sleep(100);
      }
      const sample = JSON.parse(readFileSync(join(cwd, "sample.json"), "utf8"));
      expect(sample.instructions).toStartWith(instructions);
      expect(sample.cwd).toBe(cwd); expect(sample.run).toBe(task.last_run);
      expect(sample.args).toEqual([`Read the assignment instructions in ${JSON.stringify(sample.instructionsFile)}. Follow them to complete this Impulse assignment and report its explicit outcome using the supplied CLI context.`]);
      if (mode === "wait") {
        const diagnosis = (await invoke(["run", "diagnose", task.last_run])).data;
        expect(diagnosis.components[0].observation).toMatchObject({ state: "unavailable" });
        expect((await invoke(["run", "stop", task.last_run])).code).toBe(0);
        expect((await invoke(["run", "wait", task.last_run])).code).toBe(12);
      } else expect(task.latest_run.status).toBe(mode === "finish" ? "succeeded" : "unconfirmed");
    }
  } finally {
    await invoke(["daemon", "stop"]); await Bun.sleep(700);
    rmSync(home, { recursive: true, force: true });
  }
}, 30000);
