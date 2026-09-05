import { expect, test } from "bun:test";
import { terminalProcess } from "../src/terminal-process.ts";
test.skipIf(process.platform === "win32")("an interactive harness can open its controlling terminal", async () => {
  let output = "";
  const session = terminalProcess([process.execPath, "-e", 'import {openSync,closeSync} from "node:fs";closeSync(openSync("/dev/tty","r"));console.log("controlling terminal opened")'], process.cwd(), process.env, bytes => { output += Buffer.from(bytes).toString(); });
  try { expect((await session.exited).code).toBe(0); await Bun.sleep(50); expect(output).toContain("controlling terminal opened"); }
  finally { session.close(); }
});
