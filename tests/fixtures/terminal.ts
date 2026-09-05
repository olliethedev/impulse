import { readFileSync } from "node:fs";
const descriptor = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const child = Bun.spawn(descriptor.runner.command, { cwd: descriptor.runner.cwd, stdout: "inherit", stderr: "inherit", stdin: "ignore" });
process.exitCode = await child.exited;
