import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { alive, processGroupsEnded, processStartTicks } from "../src/platform.ts";

test.skipIf(process.platform !== "linux")("unreadable processes outside owned sessions do not block recovery", async () => {
  const children: ReturnType<typeof Bun.spawn>[] = [];
  async function spawn(protectedProcess: boolean) {
    const protect = 'import {dlopen} from "bun:ffi"; const c=dlopen("libc.so.6",{prctl:{args:["i32","u64","u64","u64","u64"],returns:"i32"}}); if(c.symbols.prctl(4,0,0,0,0)!==0)process.exit(1);';
    const child = Bun.spawn([process.execPath, "-e", `${protectedProcess ? protect : ""} console.log("ready");setInterval(()=>{},1000);`], { stdout: "pipe", stderr: "pipe" });
    children.push(child);
    const reader = child.stdout.getReader();
    try { expect(Buffer.from((await reader.read()).value!).toString().trim()).toBe("ready"); }
    finally { reader.releaseLock(); }
    return child;
  }
  try {
    const older = await spawn(true); await Bun.sleep(30);
    const scope = await spawn(false), start = processStartTicks(scope.pid)!;
    expect(processStartTicks(older.pid)!).toBeLessThan(start);
    const context = { run_id: "fixture-run", agent_id: "fixture-agent", start_ticks: start };
    expect(processGroupsEnded([2147483647], context)).toBe(true);
    // A browser sandbox or ssh-agent started elsewhere during the run must not hold it open forever.
    await spawn(true);
    expect(processGroupsEnded([2147483647], context)).toBe(true);
  } finally {
    for (const child of children) { child.kill("SIGKILL"); await child.exited; }
  }
});

test.skipIf(process.platform !== "linux")("an unreadable process left in an owned session retains uncertainty", async () => {
  // The leader starts its own session, leaves a non-dumpable child in a new process group, then exits.
  const libc = 'import {dlopen} from "bun:ffi"; const c=dlopen("libc.so.6",{prctl:{args:["i32","u64","u64","u64","u64"],returns:"i32"},setpgid:{args:["i32","i32"],returns:"i32"}});';
  const orphan = `${libc} if(c.symbols.setpgid(0,0)!==0||c.symbols.prctl(4,0,0,0,0)!==0)process.exit(1); console.log(process.pid);setInterval(()=>{},1000);`;
  const leader = `const {spawn}=require("node:child_process"); const c=spawn(process.execPath,["-e",${JSON.stringify(orphan)}],{stdio:["ignore","pipe","inherit"]}); c.stdout.once("data",d=>{process.stdout.write(d);process.exit(0);});`;
  const start = processStartTicks(process.pid)!;
  const session = spawn(process.execPath, ["-e", leader], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
  const orphanPid = Number(await new Promise<string>(resolve => session.stdout!.once("data", data => resolve(String(data)))));
  try {
    await new Promise(resolve => session.once("exit", resolve));
    const context = { run_id: "fixture-run", agent_id: "fixture-agent", start_ticks: start };
    expect(processGroupsEnded([session.pid!], context)).toBe(false);
    process.kill(orphanPid, "SIGKILL");
    while (alive(orphanPid)) await Bun.sleep(20);
    expect(processGroupsEnded([session.pid!], context)).toBe(true);
  } finally {
    try { process.kill(orphanPid, "SIGKILL"); } catch { /* already gone */ }
  }
});
