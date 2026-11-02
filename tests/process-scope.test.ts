import { expect, test } from "bun:test";
import { processGroupsEnded, processStartTicks } from "../src/platform.ts";

test.skipIf(process.platform !== "linux")("unreadable older processes do not block recovery, but unreadable new processes retain uncertainty", async () => {
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
    await spawn(true);
    expect(processGroupsEnded([2147483647], context)).toBe(false);
  } finally {
    for (const child of children) { child.kill("SIGKILL"); await child.exited; }
  }
});
