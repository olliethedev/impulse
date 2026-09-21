import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reapBackends } from "../src/maintenance.ts";
import { alive, bootId } from "../src/platform.ts";
import { fixture } from "./helpers.ts";

/** A detached stand-in for a private Codex backend, carrying the socket in its own arguments. */
function backend(socket: string) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", `unix://${socket}`], { detached: true, stdio: "ignore" });
  child.unref();
  return child;
}
async function settled(pid: number, want: boolean) {
  for (let i = 0; i < 100 && alive(pid) !== want; i++) await Bun.sleep(50);
  return alive(pid);
}
function record(home: string, id: string, value: unknown) {
  const file = join(fixtureLaunches(home), `${id}.backend.json`);
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  return file;
}
const fixtureLaunches = (home: string) => join(home, "state", "launches");

test("stops a backend whose runner died before its own teardown", async () => {
  const f = fixture();
  const socket = join(fixtureLaunches(f.home), "abcd1234.sock");
  writeFileSync(socket, "");
  const child = backend(socket);
  expect(await settled(child.pid!, true)).toBe(true);
  // An exited runner leaves no other reference to this pid.
  const file = record(f.home, "agent_orphan", { pid: child.pid, runner: 2147483646, boot_id: bootId(), socket });

  const result = reapBackends(f.engine);

  expect(result.reaped).toEqual([{ id: "agent_orphan", pid: child.pid!, running: true }]);
  expect(await settled(child.pid!, false)).toBe(false);
  expect(existsSync(file)).toBe(false);
  expect(existsSync(socket)).toBe(false);
  f.close();
});

test("leaves a backend alone while its runner still owns teardown", async () => {
  const f = fixture();
  const socket = join(fixtureLaunches(f.home), "beef5678.sock");
  writeFileSync(socket, "");
  const child = backend(socket);
  expect(await settled(child.pid!, true)).toBe(true);
  const file = record(f.home, "agent_live", { pid: child.pid, runner: process.pid, boot_id: bootId(), socket });

  expect(reapBackends(f.engine).reaped).toEqual([]);

  expect(alive(child.pid!)).toBe(true);
  expect(existsSync(file)).toBe(true);
  expect(existsSync(socket)).toBe(true);
  child.kill("SIGKILL"); f.close();
});

test("clears a record from an earlier boot without signalling a reused pid", async () => {
  const f = fixture();
  const socket = join(fixtureLaunches(f.home), "cafe9012.sock");
  writeFileSync(socket, "");
  const child = backend(socket);
  expect(await settled(child.pid!, true)).toBe(true);
  const file = record(f.home, "agent_rebooted", { pid: child.pid, runner: 2147483646, boot_id: "a-previous-boot", socket });

  expect(reapBackends(f.engine).reaped).toEqual([{ id: "agent_rebooted", pid: child.pid!, running: false }]);

  expect(alive(child.pid!)).toBe(true);
  expect(existsSync(file)).toBe(false);
  child.kill("SIGKILL"); f.close();
});

test("reports without changing anything when not applying", async () => {
  const f = fixture();
  const socket = join(fixtureLaunches(f.home), "dead3456.sock");
  writeFileSync(socket, "");
  const child = backend(socket);
  expect(await settled(child.pid!, true)).toBe(true);
  const file = record(f.home, "agent_report", { pid: child.pid, runner: 2147483646, boot_id: bootId(), socket });

  expect(reapBackends(f.engine, false)).toEqual({ applied: false, reaped: [{ id: "agent_report", pid: child.pid!, running: true }] });

  expect(alive(child.pid!)).toBe(true);
  expect(existsSync(file)).toBe(true);
  child.kill("SIGKILL"); f.close();
});
