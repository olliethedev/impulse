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
test("CLI rename is durable, retryable and separate from definition updates", async () => {
  const home = await setup(), file = join(home, "task.toml"), name = "Bio-Mogging indexing ' \" $()";
  writeFileSync(file, Bun.TOML.stringify({ schema_version: 1, name: "original", cwd: ".", work: { kind: "script", command: [process.execPath, "-e", "process.exit(0)"] }, first_run: { kind: "now" } })!);
  const before = (await invoke(home, ["task", "register", file, "--disabled"])).result.data;
  const args = ["task", "rename", "original", "--name", name, "--request-id", "rename-once"];
  const renamed = await invoke(home, args);
  expect(renamed.code).toBe(0);
  expect(renamed.result.data).toEqual({ ...before, name });
  expect((await invoke(home, args)).result).toEqual(renamed.result);
  expect((await invoke(home, ["task", "rename", "original", "--name", "different", "--request-id", "rename-once"])).result.error.code).toBe("REQUEST_CONFLICT");
  expect((await invoke(home, ["task", "show", "original"])).code).toBe(3);
  const shown = (await invoke(home, ["task", "show", name])).result.data;
  expect(shown.id).toBe(before.id); expect(shown.source_drift).toBe(false);
  expect(readFileSync(file, "utf8")).toContain('name = "original"');
  expect((await invoke(home, ["task", "update", before.id])).result.data.name).toBe(name);
  expect((await invoke(home, ["task", "rename", before.id])).code).toBe(2);
  const otherFile = join(home, "other.toml");
  writeFileSync(otherFile, readFileSync(file, "utf8").replace('name = "original"', 'name = "taken"'));
  await invoke(home, ["task", "register", otherFile, "--disabled"]);
  expect((await invoke(home, ["task", "rename", before.id, "--name", "taken"])).result.error.code).toBe("NAME_CONFLICT");
  expect((await invoke(home, ["task", "show", before.id])).result.data.name).toBe(name);
});

test("CLI launches nested agents using custom profiles and preserves instructions as data", async () => {
  const home = await setup(), file = join(home, "task.toml");
  writeFileSync(file, Bun.TOML.stringify({ schema_version: 1, name: "nested", cwd: ".", work: { kind: "agent", instructions: "fixture:child\n' \" $(do-not-execute) `literal`" }, first_run: { kind: "now" }, schedule: { kind: "completion", after: "24h" } })!);
  const registration = await invoke(home, ["task", "register", file, "--disabled"]); expect(registration.code).toBe(0);
  expect((await invoke(home, ["task", "rename", "nested", "--name", "nested-title-demo"])).code).toBe(0);
  await invoke(home, ["task", "enable", "nested-title-demo", "--now"]);
  let task;
  for (let i = 0; i < 100; i++) { task = (await invoke(home, ["task", "show", "nested-title-demo"])).result.data; if (task.latest_run?.finished_at) break; await Bun.sleep(100); }
  expect(task.latest_run.status).toBe("succeeded");
  const run = await invoke(home, ["run", "show", task.latest_run.id]);
  expect(run.result.data.agents).toHaveLength(2);
  expect(run.result.data.agents[0].instructions).toContain("$(do-not-execute)");
  const launchDirectory = (await invoke(home, ["doctor"])).result.data.paths.launches;
  for (const agent of run.result.data.agents) {
    expect(JSON.parse(readFileSync(join(launchDirectory, `${agent.id}.json`), "utf8")).task_name).toBe("nested-title-demo");
  }
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
  if (task.latest_run.status !== "failed") console.error(JSON.stringify(task.latest_run), (await invoke(home, ["run", "logs", task.latest_run.id])).result.data.log);
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

test("invalid setup choices do not apply otherwise valid configuration changes", async () => {
  const home = await setup();
  expect((await invoke(home, ["setup", "--harness", "claude-code", "--startup", "invalid"])).code).toBe(2);
  expect((await invoke(home, ["config", "show"])).result.data.defaults.harness).toBe("fixture");
});

test.skipIf(process.platform !== "win32")("Windows batch scripts preserve quoted paths and shell arguments", async () => {
  const home = await setup(), script = join(home, "script with spaces.cmd"), file = join(home, "task.toml");
  writeFileSync(script, '@echo off\r\necho %1\r\n');
  writeFileSync(file, Bun.TOML.stringify({ schema_version: 1, name: "batch", cwd: ".", work: { kind: "script", command: ["cmd.exe", "/d", "/c", `"${script}" "literal & argument"`] }, first_run: { kind: "now" } })!);
  await invoke(home, ["task", "register", file]);
  let task;
  for (let i = 0; i < 100; i++) { task = (await invoke(home, ["task", "show", "batch"])).result.data; if (task.latest_run?.finished_at) break; await Bun.sleep(100); }
  const log = (await invoke(home, ["run", "logs", task.latest_run.id])).result.data.log;
  if (task.latest_run.status !== "succeeded") console.error(log);
  expect(task.latest_run.status).toBe("succeeded"); expect(log).toContain('"literal & argument"');
}, 20000);

test("an interrupted notification attempt becomes inspectable and can be explicitly retried", async () => {
  const home = await setup(), settingsFile = join(home, "settings.toml"), marker = join(home, "notifier.pid"), file = join(home, "task.toml");
  const settings = Bun.TOML.parse(readFileSync(settingsFile, "utf8")) as { notifications: { desktop: boolean; command?: string[] } };
  settings.notifications.command = [process.execPath, "-e", `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(marker)},String(process.pid)); await Bun.sleep(10000);`];
  writeFileSync(settingsFile, Bun.TOML.stringify(settings)!); await invoke(home, ["config", "apply", settingsFile]);
  writeFileSync(file, Bun.TOML.stringify({ schema_version: 1, name: "notify", cwd: ".", work: { kind: "script", command: [process.execPath, "-e", "process.exit(7)"] }, first_run: { kind: "now" } })!);
  await invoke(home, ["task", "register", file]);
  let notifier = 0;
  for (let i = 0; i < 150; i++) { try { notifier = Number(readFileSync(marker, "utf8")); if (notifier) break; } catch {} await Bun.sleep(100); }
  expect(notifier).toBeGreaterThan(0);
  const lease = (await invoke(home, ["daemon", "status"])).result.data;
  process.kill(lease.pid, "SIGKILL"); process.kill(notifier, "SIGKILL");
  await invoke(home, ["daemon", "start"]);
  let notification;
  for (let i = 0; i < 50; i++) { notification = (await invoke(home, ["notification", "list"])).result.data[0]; if (notification.status === "failed") break; await Bun.sleep(100); }
  expect(notification.status).toBe("failed"); expect(notification.error).toContain("may already have reached");
  settings.notifications.command = [process.execPath, "-e", "process.exit(0)"];
  writeFileSync(settingsFile, Bun.TOML.stringify(settings)!); await invoke(home, ["config", "apply", settingsFile]);
  expect((await invoke(home, ["notification", "retry", notification.id])).result.data.status).toBe("delivered");
}, 30000);

test.skipIf(process.platform === "win32")("graceful cancellation retains capacity until a resistant descendant is explicitly forced", async () => {
  const home = await setup(), harness = join(home, "resistant.ts"), file = join(home, "task.toml"), marker = join(home, "child-alive");
  const source = `import {writeFileSync} from "node:fs"; process.on("SIGTERM",()=>{}); process.on("SIGHUP",()=>{}); writeFileSync(${JSON.stringify(marker)},"ready"); setInterval(()=>writeFileSync(${JSON.stringify(marker)},String(Date.now())),50);`;
  writeFileSync(harness, `Bun.spawn([process.execPath,"-e",${JSON.stringify(source)}],{stdout:"ignore",stderr:"ignore"}); setInterval(()=>{},1000);`);
  const settingsFile = join(home, "settings.toml");
  const settings = Bun.TOML.parse(readFileSync(settingsFile, "utf8")) as { harnesses: { fixture: { command: string[] } } };
  settings.harnesses.fixture.command = [process.execPath, harness, "{launch_file}"];
  writeFileSync(settingsFile, Bun.TOML.stringify(settings)!); await invoke(home, ["config", "apply", settingsFile]);
  writeFileSync(file, Bun.TOML.stringify({ schema_version: 1, name: "resistant", cwd: ".", work: { kind: "agent", instructions: "fixture" }, first_run: { kind: "now" } })!);
  await invoke(home, ["task", "register", file]);
  let runId = "";
  try {
    for (let i = 0; i < 100; i++) { const task = (await invoke(home, ["task", "show", "resistant"])).result.data; runId = task.latest_run?.id ?? ""; try { if (readFileSync(marker, "utf8")) break; } catch {} await Bun.sleep(100); }
    await invoke(home, ["run", "stop", runId]); await Bun.sleep(800);
    expect((await invoke(home, ["run", "show", runId])).result.data.status).toBe("stopping");
    expect((await invoke(home, ["doctor"])).result.data.capacity.used).toBe(1);
  } finally { if (runId) await invoke(home, ["run", "stop", runId, "--force"]); }
  expect((await invoke(home, ["run", "wait", runId])).result.data.status).toBe("cancelled");
}, 20000);
