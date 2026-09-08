import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.skipIf(process.platform === "win32")("built-in runners set project trust before either harness starts", async () => {
  const home = mkdtempSync(join(tmpdir(), "impulse-launch-trust-")), bin = join(home, "bin"), projects = join(home, "Projects");
  const cli = [process.execPath, resolve("src/cli.ts")];
  const env = { ...process.env, IMPULSE_HOME: home, IMPULSE_CONTEXT: "", CODEX_HOME: join(home, "codex"), CLAUDE_CONFIG_DIR: join(home, "claude"), PATH: bin + ":" + process.env.PATH };
  async function invoke(args: string[]) {
    const child = Bun.spawn([...cli, ...args, "--json"], { env, stdout: "pipe", stderr: "pipe" });
    const output = await new Response(child.stdout).text();
    const error = await new Response(child.stderr).text();
    if (await child.exited !== 0) throw new Error(output + error);
    return JSON.parse(output).data;
  }
  try {
    mkdirSync(bin); mkdirSync(projects);
    const fixture = join(home, "harness.ts");
    writeFileSync(fixture, `
import { readFileSync, writeFileSync } from "node:fs";
if (process.argv.includes("--help")) { console.log("fixture harness"); process.exit(0); }
const harness = process.argv[2];
const config = harness === "codex" ? Bun.TOML.parse(readFileSync(process.env.CODEX_HOME + "/config.toml", "utf8")) : JSON.parse(readFileSync(process.env.CLAUDE_CONFIG_DIR + "/.claude.json", "utf8"));
const entry = config.projects?.[process.cwd()];
if (harness === "codex" ? entry?.trust_level !== "trusted" : entry?.hasTrustDialogAccepted !== true) throw new Error("Harness started without project trust");
writeFileSync("sample.json", JSON.stringify({ harness, run_id: process.env.IMPULSE_RUN_ID, trusted: true }));
const finish = Bun.spawn([...${JSON.stringify(cli)}, "agent", "finish", "--outcome", "success", "--summary", "Fixture observed project trust before execution", "--json"], { stdout: "inherit", stderr: "inherit" });
process.exitCode = await finish.exited;
`);
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    for (const harness of ["codex", "claude"]) writeFileSync(join(bin, harness), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} ${harness} "$@"\n`, { mode: 0o700 });
    const settings = join(home, "settings.toml");
    writeFileSync(settings, Bun.TOML.stringify({ schema_version: 1, defaults: { harness: "codex", terminal: "fixture" }, trust: { roots: [projects] }, notifications: { desktop: false }, terminals: { fixture: { command: [process.execPath, resolve("tests/fixtures/terminal.ts"), "{launch_file}"] } } })!);
    await invoke(["config", "apply", settings]);
    for (const harness of ["codex", "claude-code"]) {
      const cwd = join(projects, harness); mkdirSync(cwd);
      const file = join(cwd, "task.toml");
      writeFileSync(file, Bun.TOML.stringify({ schema_version: 1, name: harness, cwd: ".", work: { kind: "agent", instructions: "fixture assignment" }, first_run: { kind: "now" } })!);
      await invoke(["task", "register", file, "--harness", harness]);
      let task;
      for (let i = 0; i < 100; i++) {
        task = await invoke(["task", "show", harness]);
        if (task.latest_run?.finished_at) break;
        await Bun.sleep(100);
      }
      expect(task.latest_run.status).toBe("succeeded");
      expect(task.next).toBe(null);
      expect(JSON.parse(readFileSync(join(cwd, "sample.json"), "utf8"))).toEqual({ harness: harness === "codex" ? "codex" : "claude", run_id: task.latest_run.id, trusted: true });
    }
  } finally { await invoke(["daemon", "stop"]); await Bun.sleep(700); rmSync(home, { recursive: true, force: true }); }
}, 30000);
