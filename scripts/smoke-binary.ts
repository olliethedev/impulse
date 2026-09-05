import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  const file = join(home, "smoke.toml");
  const command = process.platform === "win32" ? ["cmd.exe", "/d", "/c", "echo compiled-smoke"] : ["/bin/echo", "compiled-smoke"];
  writeFileSync(file, Bun.TOML.stringify({ schema_version: 1, name: "smoke", cwd: ".", work: { kind: "script", command }, first_run: { kind: "now" } })!);
  await cli(["task", "register", file]);
  let task;
  for (let i = 0; i < 100; i++) { task = await cli(["task", "show", "smoke"]); if (task.latest_run?.finished_at) break; await Bun.sleep(100); }
  if (task.latest_run?.status !== "succeeded") throw new Error(`Compiled execution failed: ${JSON.stringify(task)}`);
  const logs = await cli(["run", "logs", task.latest_run.id]);
  if (!logs.log.includes("compiled-smoke")) throw new Error("Compiled script output missing");
  console.log("Compiled binary: registration, SQLite, daemon, script runner, and logs passed.");
} finally { await cli(["daemon", "stop"]); await Bun.sleep(1000); rmSync(home, { recursive: true, force: true }); }
