import { readFileSync } from "node:fs";
const descriptor = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const cli: string[] = descriptor.runner.command.slice(0, -2);
async function command(args: string[]) {
  const child = Bun.spawn([...cli, ...args, "--context", descriptor.context_file, "--json"], { stdout: "pipe", stderr: "pipe" });
  const result = JSON.parse(await new Response(child.stdout).text());
  if (await child.exited !== 0) throw new Error(JSON.stringify(result));
  return result;
}
if (descriptor.instructions.startsWith("fixture:child")) await command(["agent", "request", "--instructions", "fixture:leaf"]);
await command(["agent", "finish", "--outcome", "success", "--summary", "Fixture completed with quotes ' \" and $() intact"]);
