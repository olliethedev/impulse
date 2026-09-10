import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTerminal, terminalTitle, windowsTerminalArgument, type LaunchDescriptor } from "../src/adapters.ts";
import { paths } from "../src/paths.ts";

const ticket = { kind: "agent" as const, id: "agent_12345678-abcd", run_id: "run_fixture", ticket: "fixture-ticket" };

test("terminal titles retain task names, distinguish agents and bound control-filled or long names", () => {
  expect(terminalTitle({ ticket, task_name: "Bio-Mogging indexing" })).toBe("Impulse: Bio-Mogging indexing [12345678]");
  expect(terminalTitle({ ticket, task_name: "Bio\nMogging\x07\x1b" })).toBe("Impulse: Bio Mogging [12345678]");
  expect(terminalTitle({ ticket })).toBe("Impulse: agent [12345678]");
  expect(terminalTitle({ ticket, task_name: "\n\t" })).toBe("Impulse: agent [12345678]");
  const long = terminalTitle({ ticket, task_name: "🌱".repeat(100) });
  expect(long).toEndWith("… [12345678]"); expect(Array.from(long).length).toBeLessThanOrEqual(100);
  expect(terminalTitle({ ticket: { ...ticket, id: "agent_87654321-other" }, task_name: "Bio-Mogging indexing" })).toEndWith("[87654321]");
});

test("Windows Terminal arguments survive its command separator parser as literal data", () => {
  // Microsoft's AppCommandlineArgs splits /^;|[^\\];/ inside each argv element;
  // Commandline::AddArg then removes one backslash immediately before each ';'.
  for (const value of ["label;calc.exe;tail", ";;", "one\\;two", "three\\\\;four", "C:\\work;area\\", "literal ' \" $()"]) {
    const escaped = windowsTerminalArgument(value);
    expect(escaped).not.toMatch(/^;|[^\\];/);
    expect(escaped.replaceAll("\\;", ";")).toBe(value);
  }
});

test.skipIf(process.platform !== "linux")("Konsole task titles cannot add profile properties", async () => {
  const home = mkdtempSync(join(tmpdir(), "impulse-konsole-title-")), log = join(home, "argv.json");
  const previousPath = process.env.PATH, previousLog = process.env.IMPULSE_TEST_TITLE_LOG;
  writeFileSync(join(home, "konsole"), `#!${process.execPath}\nimport { writeFileSync } from "node:fs"; writeFileSync(process.env.IMPULSE_TEST_TITLE_LOG, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
  process.env.PATH = `${home}:${previousPath}`; process.env.IMPULSE_TEST_TITLE_LOG = log;
  try {
    const descriptor: LaunchDescriptor = { schema_version: 1, ticket, task_name: "label;Command=unwanted", paths: paths(home),
      runner: { command: ["/usr/bin/impulse", "_runner", "/tmp/owned-launch.json"], cwd: home }, context_file: join(home, "context.json"), profile: { harness: "codex", terminal: "konsole" }, keep_open: true };
    await launchTerminal(descriptor, join(home, "launch.json"));
    for (let i = 0; i < 100 && !existsSync(log); i++) await Bun.sleep(10);
    const args: string[] = JSON.parse(readFileSync(log, "utf8"));
    expect(args[args.indexOf("-p") + 1]).toBe("tabtitle=Impulse: label；Command=unwanted [12345678]");
    expect(args.slice(args.indexOf("-e") + 1)).toEqual(descriptor.runner.command);
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousLog === undefined) delete process.env.IMPULSE_TEST_TITLE_LOG; else process.env.IMPULSE_TEST_TITLE_LOG = previousLog;
    rmSync(home, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "linux")("Yakuake sets the owned tab's task title as data without changing the runner command", async () => {
  const home = mkdtempSync(join(tmpdir(), "impulse-title-")), log = join(home, "calls.jsonl");
  const previousPath = process.env.PATH, previousLog = process.env.IMPULSE_TEST_TITLE_LOG;
  writeFileSync(join(home, "qdbus6"), `#!${process.execPath}
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.IMPULSE_TEST_TITLE_LOG, JSON.stringify(args) + "\\n");
if (args.includes("org.freedesktop.DBus.GetConnectionUnixProcessID")) console.log("1");
else if (args.includes("org.kde.yakuake.addSession")) console.log("23");
else if (args.includes("org.kde.yakuake.terminalIdsForSessionId")) console.log("42");
`, { mode: 0o755 });
  process.env.PATH = `${home}:${previousPath}`; process.env.IMPULSE_TEST_TITLE_LOG = log;
  try {
    const descriptor: LaunchDescriptor = { schema_version: 1, ticket, task_name: "Bio ' \" $(touch unwanted) `literal`", paths: paths(home),
      runner: { command: ["/usr/bin/impulse", "_runner", "/tmp/owned-launch.json"], cwd: home }, context_file: join(home, "context.json"), profile: { harness: "codex", terminal: "yakuake" }, keep_open: true };
    await launchTerminal(descriptor, join(home, "launch.json"));
    const calls: string[][] = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(calls.find(args => args.includes("org.kde.yakuake.setTabTitle"))).toEqual([
      "org.kde.yakuake", "/yakuake/tabs", "org.kde.yakuake.setTabTitle", "23", "Impulse: Bio ' \" $(touch unwanted) `literal` [12345678]",
    ]);
    const invocation = calls.find(args => args.includes("org.kde.yakuake.runCommandInTerminal"))!;
    expect(invocation.at(-2)).toBe("42");
    expect(invocation.at(-1)).toBe("'/usr/bin/impulse' '_runner' '/tmp/owned-launch.json'");
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousLog === undefined) delete process.env.IMPULSE_TEST_TITLE_LOG; else process.env.IMPULSE_TEST_TITLE_LOG = previousLog;
    rmSync(home, { recursive: true, force: true });
  }
});
