import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/engine.ts";
import { Store } from "../src/store.ts";
import { paths } from "../src/paths.ts";
import { loadDefinition } from "../src/config.ts";
export function fixture() {
  const home = mkdtempSync(join(tmpdir(), "impulse-test-"));
  let clock = Date.parse("2026-09-04T12:00:00Z");
  const store = new Store(paths(home));
  const engine = new Engine(store, () => clock);
  function definition(extra = "", work = '[work]\nkind="script"\ncommand=["echo", "hello"]') {
    const file = join(home, "task.toml");
    writeFileSync(file, `schema_version=1\nname="fixture"\ncwd="."\n${work}\n[first_run]\nkind="now"\n${extra}\n`);
    return loadDefinition(file);
  }
  const lease = engine.acquire("scheduler", 123, "boot")!;
  const tick = () => engine.tick("scheduler", lease.generation, "boot");
  return { home, engine, store, definition, tick, now: () => clock, advance: (ms: number) => { clock += ms; }, close: () => { store.close(); rmSync(home, { recursive: true, force: true }); } };
}
