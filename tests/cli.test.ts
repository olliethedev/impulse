import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const homes: string[] = [];
const cli = [process.execPath, resolve("src/cli.ts")];
async function invoke(home: string, args: string[]) {
  const child = Bun.spawn([...cli, ...args, "--json"], { env: { ...process.env, IMPULSE_HOME: home, IMPULSE_CONTEXT: "" }, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(child.stdout).text(), error = await new Response(child.stderr).text(), code = await child.exited;
  if (!text.trim()) throw new Error(`CLI returned no JSON (${code}): ${error}`);
  return { code, result: JSON.parse(text) };
}
async function setup() {
  const home = mkdtempSync(join(tmpdir(), "impulse cli ' $-")); homes.push(home);
  const settings = join(home, "settings.toml");
  writeFileSync(settings, Bun.TOML.stringify({ schema_version: 1, defaults: { harness: "fixture", terminal: "fixture" }, notifications: { desktop: false }, harnesses: { fixture: { command: [process.execPath, resolve("tests/fixtures/harness.ts"), "{launch_file}"] } }, terminals: { fixture: { command: [process.execPath, resolve("tests/fixtures/terminal.ts"), "{launch_file}"] } } })!);
  expect((await invoke(home, ["config", "apply", settings])).code).toBe(0); return home;
}
afterEach(async () => {
  for (const home of homes.splice(0)) {
    await invoke(home, ["daemon", "stop"]); await Bun.sleep(700); rmSync(home, { recursive: true, force: true });
  }
});
test("CLI launches nested agents using custom profiles and preserves instructions as data", async () => {
  const home = await setup(), file = join(home, "task.toml");
  writeFileSync(file, Bun.TOML.stringify({ schema_version: 1, name: "nested", cwd: ".", work: { kind: "agent", instructions: "fixture:child\n' \" $(do-not-execute) `literal`" }, first_run: { kind: "now" }, schedule: { kind: "completion", after: "24h" } })!);
  const registration = await invoke(home, ["task", "register", file]); expect(registration.code).toBe(0);
  let task;
  for (let i = 0; i < 100; i++) { task = (await invoke(home, ["task", "show", "nested"])).result.data; if (task.latest_run?.finished_at) break; await Bun.sleep(100); }
  expect(task.latest_run.status).toBe("succeeded");
  const run = await invoke(home, ["run", "show", task.latest_run.id]);
  expect(run.result.data.agents).toHaveLength(2);
  expect(run.result.data.agents[0].instructions).toContain("$(do-not-execute)");
  expect(JSON.stringify(run.result)).not.toContain('"token"');
  expect(Date.parse(task.next.at) - Date.parse(task.latest_run.finished_at)).toBe(86400000);
}, 20000);

test("a script callback survives failure through the executable command path", async () => {
  const home = await setup(), script = join(home, "script.ts"), file = join(home, "task.toml");
  writeFileSync(script, `const c=Bun.spawn(${JSON.stringify([...cli, "task", "next", "--after", "24h", "--json"])},{stdout:"inherit",stderr:"inherit"}); if(await c.exited!==0)process.exit(99); console.log("callback committed"); process.exit(7);`);
  writeFileSync(file, Bun.TOML.stringify({ schema_version: 1, name: "callback", cwd: ".", work: { kind: "script", command: [process.execPath, script] }, first_run: { kind: "now" } })!);
  await invoke(home, ["task", "register", file]);
  let task;
  for (let i = 0; i < 100; i++) { task = (await invoke(home, ["task", "show", "callback"])).result.data; if (task.latest_run?.finished_at) break; await Bun.sleep(100); }
  expect(task.latest_run.status).toBe("failed"); expect(task.latest_run.script.exit_code).toBe(7); expect(task.next.source).toBe("explicit");
  const waited = await invoke(home, ["run", "wait", task.latest_run.id]); expect(waited.code).toBe(10); expect(waited.result.ok).toBe(true);
  expect((await invoke(home, ["run", "logs", task.latest_run.id])).result.data.log).toContain("callback committed");
}, 20000);

test("stopping dispatch preserves the runner and explicit run cancellation terminates it", async () => {
  const home = await setup(), script = join(home, "script.ts"), file = join(home, "task.toml");
  writeFileSync(script, 'console.log("started"); setInterval(() => {}, 1000);');
  writeFileSync(file, Bun.TOML.stringify({ schema_version: 1, name: "long", cwd: ".", work: { kind: "script", command: [process.execPath, script] }, first_run: { kind: "now" } })!);
  await invoke(home, ["task", "register", file]);
  let task;
  for (let i = 0; i < 100; i++) { task = (await invoke(home, ["task", "show", "long"])).result.data; if (task.latest_run?.script?.pid) break; await Bun.sleep(100); }
  const runId = task.latest_run.id;
  await invoke(home, ["daemon", "stop"]); await Bun.sleep(700);
  expect((await invoke(home, ["run", "show", runId])).result.data.status).toBe("running");
  await invoke(home, ["run", "stop", runId, "--force"]);
  const waited = await invoke(home, ["run", "wait", runId]); expect(waited.code).toBe(12); expect(waited.result.data.status).toBe("cancelled");
  expect((await invoke(home, ["task", "show", "long"])).result.data.enabled).toBe(true);
}, 20000);
