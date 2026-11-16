import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { alive, shellQuote } from "../src/platform.ts";

test.skipIf(process.platform === "win32")("session modes run agents headless or close their session after success", async () => {
  const home = mkdtempSync(join(tmpdir(), "impulse-session ' $-")), bin = join(home, "bin"), cli = [process.execPath, resolve("src/cli.ts")];
  const env = { ...process.env, IMPULSE_HOME: home, IMPULSE_CONTEXT: "", CODEX_HOME: join(home, "codex-home"), CLAUDE_CONFIG_DIR: join(home, "claude-home"), PI_CODING_AGENT_DIR: join(home, "pi-home"), PATH: `${bin}:${process.env.PATH}` };
  async function invoke(args: string[]) {
    const child = Bun.spawn([...cli, ...args, "--json"], { cwd: home, env, stdout: "pipe", stderr: "pipe" });
    const output = await new Response(child.stdout).text(), error = await new Response(child.stderr).text();
    if (!output.trim()) throw new Error(error);
    return { code: await child.exited, ...JSON.parse(output) };
  }
  async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, label: string): Promise<T> {
    for (let i = 0; i < 150; i++) { const value = await read(); if (done(value)) return value; await Bun.sleep(100); }
    throw new Error(`${label} timed out`);
  }
  const ended = (name: string, previous?: string) => until(async () => (await invoke(["task", "show", name])).data, task => task.last_run !== previous && !!task.latest_run?.finished_at, name).then(task => task.latest_run);
  const launches = (name: string): string[][] => readFileSync(join(home, name, "launches.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  try {
    mkdirSync(bin);
    // Every fake harness records its argv and prints a line, then acts on its task's instructions:
    // "finish" reports success, "linger" reports success or failure and keeps running, "exit" just exits.
    const fixture = join(home, "harness.ts");
    writeFileSync(fixture, `import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [kind, ...args] = process.argv.slice(2);
if (args.includes("--version")) { console.log("2.1.269 (fixture)"); process.exit(0); }
if (args.includes("--help")) { console.log("--permission-prompts <target>"); process.exit(0); }
appendFileSync("launches.jsonl", JSON.stringify(args) + "\\n");
const context = JSON.parse(readFileSync(process.env.IMPULSE_CONTEXT!, "utf8"));
const instructions = readFileSync(join(context.paths.launches, context.agent_id + ".instructions.md"), "utf8");
writeFileSync("instructions.md", instructions);
console.log("HEADLESS OUTPUT from " + kind);
const finish = async (outcome: string) => {
  const child = Bun.spawn([...${JSON.stringify(cli)}, "agent", "finish", "--outcome", outcome, "--summary", "fixture " + outcome, "--json"], { stdout: "ignore", stderr: "inherit" });
  if (await child.exited !== 0) process.exit(1);
};
if (instructions.startsWith("finish")) await finish("success");
if (instructions.startsWith("linger")) {
  writeFileSync("pid", String(process.pid));
  await finish(instructions.startsWith("linger-fail") ? "failed" : "success");
  while (!existsSync("release")) await Bun.sleep(50);
}
`);
    for (const harness of ["claude", "codex", "pi", "custom"]) writeFileSync(join(bin, harness), `#!/bin/sh\nexec ${[process.execPath, fixture, harness].map(shellQuote).join(" ")} "$@"\n`, { mode: 0o700 });
    const terminalLog = join(home, "terminal-launches");
    const terminal = join(home, "terminal.ts");
    writeFileSync(terminal, `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(terminalLog)}, "launch\\n");\nawait import(${JSON.stringify(resolve("tests/fixtures/terminal.ts"))});\n`);
    const custom = [join(bin, "custom"), "{launch_file}"];
    const settings = join(home, "settings.toml");
    writeFileSync(settings, Bun.TOML.stringify({ schema_version: 1, defaults: { harness: "claude-code", terminal: "fixture", session: "headless" }, notifications: { desktop: false },
      terminals: { fixture: { command: [process.execPath, terminal, "{launch_file}"] } },
      harnesses: { custom: { command: custom, headless_command: custom }, tabonly: { command: custom } } })!);
    expect((await invoke(["config", "apply", settings])).code).toBe(0);
    const register = async (name: string, harness: string, instructions: string, extra: string[] = []) => {
      const cwd = join(home, name); mkdirSync(cwd);
      writeFileSync(join(cwd, "task.toml"), Bun.TOML.stringify({ schema_version: 1, name, cwd: ".", work: { kind: "agent", instructions }, first_run: { kind: "now" } })!);
      return invoke(["task", "register", join(cwd, "task.toml"), "--harness", harness, ...extra]);
    };

    // A custom harness without a headless command cannot take the headless default.
    expect((await register("tabonly", "tabonly", "finish")).error.code).toBe("INVALID_PROFILE");

    // Headless: print mode for every harness, output in the run log, no terminal.
    for (const [name, harness] of [["claude", "claude-code"], ["codex", "codex"], ["pi", "pi"], ["custom", "custom"]] as const) {
      expect((await register(name, harness, "finish")).code).toBe(0);
      const run = await ended(name);
      expect(run.status).toBe("succeeded");
      expect((await invoke(["run", "logs", run.id])).data.log).toContain(`HEADLESS OUTPUT from ${name}`);
      const args = launches(name)[0]!, instructions = readFileSync(join(home, name, "instructions.md"), "utf8");
      expect(instructions).toContain("Session mode headless");
      expect(instructions.includes("Run long commands in the foreground")).toBe(name === "codex");
      expect(args.join(" ")).not.toMatch(/dangerously|bypass/);
      if (name === "claude") expect(args.slice(0, 3)).toEqual(["-p", "--permission-prompts", "none"]);
      if (name === "codex") expect(args.slice(0, 3)).toEqual(["exec", "--cd", join(home, name)]);
      if (name === "pi") expect(args[0]).toBe("-p");
    }
    expect(existsSync(terminalLog)).toBe(false);

    // close-on-success: the harness is stopped once it reports success; a failure leaves it running.
    expect((await register("close", "claude-code", "linger", ["--session", "close-on-success"])).code).toBe(0);
    const closed = await ended("close");
    expect(closed.status).toBe("succeeded");
    expect(readFileSync(join(home, "close", "instructions.md"), "utf8")).toContain("Session mode close-on-success");
    expect(launches("close")[0]![0]).toBe("--settings");
    const pid = Number(readFileSync(join(home, "close", "pid"), "utf8"));
    await until(async () => alive(pid), running => !running, "close-on-success stop");
    expect(readFileSync(terminalLog, "utf8").trim().split("\n")).toHaveLength(1);

    expect((await register("failing", "claude-code", "linger-fail", ["--session", "close-on-success"])).code).toBe(0);
    const failing = await until(async () => (await invoke(["task", "show", "failing"])).data.latest_run, run => !!run, "failing run");
    await until(async () => (await invoke(["run", "show", failing.id])).data.agents[0].status, status => status === "failed", "failed outcome");
    await Bun.sleep(1500);
    expect(alive(Number(readFileSync(join(home, "failing", "pid"), "utf8")))).toBe(true);
    writeFileSync(join(home, "failing", "release"), "");
    await ended("failing");

    // Overrides: update clears back to the default, and resume can choose a mode for one run.
    expect((await invoke(["task", "update", "close", "--clear-session"])).data.profile.session).toBe("headless");
    expect((await invoke(["task", "update", "close", "--session", "keep-open"])).data.profile.session).toBeUndefined();
    expect((await invoke(["task", "update", "close", "--session", "headless", "--clear-session"])).error.code).toBe("INVALID_OPTION");
    expect((await register("resumer", "claude-code", "exit")).code).toBe(0);
    const unconfirmed = await ended("resumer");
    expect(unconfirmed.status).toBe("unconfirmed");
    const resumed = await invoke(["run", "resume", unconfirmed.id, "--session", "close-on-success"]);
    expect(resumed.data.profile.session).toBe("close-on-success");
    await ended("resumer", unconfirmed.id);
    const [first, second] = launches("resumer");
    expect(first!.slice(0, 1)).toEqual(["-p"]);
    expect(second).not.toContain("-p");
    expect(second![second!.indexOf("--resume") + 1]).toBe(first![first!.indexOf("--session-id") + 1]);
  } finally {
    await invoke(["daemon", "stop"]); await Bun.sleep(700);
    rmSync(home, { recursive: true, force: true });
  }
}, 90000);
