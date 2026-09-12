import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const home = mkdtempSync(join(tmpdir(), "impulse-binary-"));
const binary = resolve(`dist/impulse${process.platform === "win32" ? ".exe" : ""}`);
async function cli(args: string[]) {
  const child = Bun.spawn([binary, ...args, "--json"], { env: { ...process.env, IMPULSE_HOME: home, IMPULSE_CONTEXT: "" }, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(child.stdout).text(), error = await new Response(child.stderr).text();
  const code = await child.exited;
  if (code !== 0 || !text.trim()) throw new Error(`${args.join(" ")} (exit ${code}): ${text || "<no JSON output>"} ${error}`);
  return JSON.parse(text).data;
}
try {
  const version = await cli(["--version"]);
  if (version.version !== "0.1.0") throw new Error("Compiled entrypoint did not report its version");
  const diagnostic = await cli(["doctor"]);
  if (diagnostic.executable.length !== 1 || diagnostic.executable[0] !== binary) throw new Error(`Compiled runner command is incorrect: ${JSON.stringify(diagnostic.executable)}`);
  const skill = join(home, "installed-skill");
  await cli(["skill", "install", "--dir", skill]);
  if (!readFileSync(join(skill, "SKILL.md"), "utf8").includes("name: impulse") || !existsSync(join(skill, "references", "definitions.md"))) throw new Error("Bundled skill is incomplete");
  await cli(["skill", "install", "--dir", skill]);
  await cli(["skill", "uninstall", "--dir", skill]);
  if (existsSync(skill)) throw new Error("Skill uninstall did not remove the owned installation");
  const file = join(home, "smoke.toml");
  const command = process.platform === "win32" ? ["cmd.exe", "/d", "/c", "echo compiled-smoke"] : ["/bin/echo", "compiled-smoke"];
  writeFileSync(file, Bun.TOML.stringify({ schema_version: 1, name: "smoke", cwd: ".", work: { kind: "script", command }, first_run: { kind: "now" } })!);
  await cli(["task", "register", file]);
  let task;
  for (let i = 0; i < 100; i++) { task = await cli(["task", "show", "smoke"]); if (task.latest_run?.finished_at) break; await Bun.sleep(100); }
  const logs = await cli(["run", "logs", task.latest_run.id]);
  if (task.latest_run?.status !== "succeeded") throw new Error(`Compiled execution failed: ${JSON.stringify(task)}\n${logs.log}`);
  if (!logs.log.includes("compiled-smoke")) throw new Error("Compiled script output missing");
  const renamed = await cli(["task", "rename", "smoke", "--name", "smoke-renamed", "--request-id", "smoke-rename"]);
  const repeated = await cli(["task", "rename", "smoke", "--name", "smoke-renamed", "--request-id", "smoke-rename"]);
  const shown = await cli(["task", "show", "smoke-renamed"]);
  if (renamed.id !== task.id || repeated.id !== task.id || shown.last_run !== task.last_run || shown.revision !== task.revision) throw new Error("Compiled rename did not preserve identity/history");
  const settings = join(home, "settings.toml");
  writeFileSync(settings, Bun.TOML.stringify({ schema_version: 1, defaults: { harness: "fixture", terminal: "fixture" }, notifications: { desktop: false },
    harnesses: { fixture: { command: [process.execPath, resolve("tests/fixtures/observed-harness.ts"), "custom", "{launch_file}"], lifecycle: "process" } },
    terminals: { fixture: { command: [process.execPath, resolve("tests/fixtures/terminal.ts"), "{launch_file}"] } } })!);
  await cli(["config", "apply", settings]);
  const observedFile = join(home, "observed-smoke.toml");
  writeFileSync(observedFile, Bun.TOML.stringify({ schema_version: 1, name: "observed-smoke", cwd: ".", work: { kind: "agent", instructions: "Observe compiled fixture" }, first_run: { kind: "now" } })!);
  await cli(["task", "register", observedFile]);
  let evidence;
  for (let i = 0; i < 100; i++) {
    task = await cli(["task", "show", "observed-smoke"]);
    if (task.last_run) evidence = await cli(["run", "diagnose", task.last_run]);
    if (evidence?.issues.some((issue: { code: string }) => issue.code === "HARNESS_FAILURE")) break;
    await Bun.sleep(100);
  }
  if (evidence?.status !== "running" || !evidence.replacement_blocked || evidence.components[0]?.observation?.error?.code !== "overloaded") throw new Error(`Compiled observation/diagnosis failed: ${JSON.stringify(evidence)}`);
  writeFileSync(join(home, "exit"), "done");
  for (let i = 0; i < 100; i++) { task = await cli(["task", "show", "observed-smoke"]); if (task.latest_run?.finished_at) break; await Bun.sleep(100); }
  if (task.latest_run?.status !== "failed" || JSON.stringify(task.next) !== JSON.stringify(evidence.schedule.next)) throw new Error(`Compiled observed exit changed execution or scheduling: ${JSON.stringify(task)}`);
  console.log("Compiled binary: entrypoint, bundled skill, registration, rename, SQLite, daemon, script runner, logs, harness observation, and diagnosis passed.");
} finally { writeFileSync(join(home, "exit"), "done"); await cli(["daemon", "stop"]); await Bun.sleep(1000); rmSync(home, { recursive: true, force: true }); }
