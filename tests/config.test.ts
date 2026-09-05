import { expect, test } from "bun:test";
import { loadDefinition, parseSettings } from "../src/config.ts";
import { fixture } from "./helpers.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
test("unknown fields, mixed work variants, and unsupported cron dialects are rejected", () => {
  const f = fixture();
  try {
    expect(() => f.definition("mystery=true")).toThrow("Unknown field");
    expect(() => f.definition("", '[work]\nkind="script"\ncommand=["echo"]\ninstructions="mixed"')).toThrow("Unknown field work.instructions");
    expect(() => f.definition('[schedule]\nkind="calendar"\ncron="@daily"')).toThrow("five numeric");
    expect(() => parseSettings('schema_version=1\n[limits]\nagents=0')).toThrow("positive integer");
    expect(() => parseSettings('schema_version=1\n[harnesses.custom]\ncommand=["wrapper", "prefix-{launch_file}"]')).toThrow("whole-argument");
  } finally { f.close(); }
});
test("instruction-file contents and working directory are resolved from the definition", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.home, "instructions.md"), "Original instructions");
    const loaded = f.definition("", '[work]\nkind="agent"\ninstructions_file="instructions.md"');
    const task = f.engine.register(loaded);
    writeFileSync(join(f.home, "instructions.md"), "Changed instructions");
    expect(f.engine.task(task.id).definition.work).toEqual({ kind: "agent", instructions: "Original instructions" });
    expect(loadDefinition(loaded.path).hash).not.toBe(loaded.hash);
    expect(task.definition.cwd).toBe(f.home);
  } finally { f.close(); }
});
