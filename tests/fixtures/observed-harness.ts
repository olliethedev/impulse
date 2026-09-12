import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const kind = process.argv[2]!;
const cli: string[] = kind === "custom" ? JSON.parse(readFileSync(process.argv[3]!, "utf8")).runner.command.slice(0, -2)
  : [process.execPath, new URL("../../src/cli.ts", import.meta.url).pathname];
const cwd = process.cwd(), exitFile = join(cwd, "exit"), promptFile = join(cwd, "prompt");
async function command(args: string[], input?: unknown) {
  const process = Bun.spawn([...cli, ...args], { stdin: input === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
  if (input !== undefined && process.stdin) { process.stdin.write(JSON.stringify(input)); process.stdin.end(); }
  const output = await new Response(process.stdout).text(), error = await new Response(process.stderr).text();
  if (await process.exited !== 0) throw new Error(output + error);
  return output;
}
if (process.argv.includes("--help")) { console.log("--remote"); process.exit(0); }
if (process.argv.includes("--version")) { console.log("2.1.269 (fixture)"); process.exit(0); }
if (kind === "codex" && process.argv.includes("app-server")) {
  const socket = process.argv[process.argv.indexOf("--listen") + 1]!.replace("unix://", "");
  Bun.serve({ unix: socket, fetch(req, server) { if (server.upgrade(req)) return; return new Response("Upgrade", { status: 400 }); }, websocket: { message(ws, bytes) {
    const request = JSON.parse(String(bytes)); if (request.id === undefined) return;
    let result: unknown = {};
    switch (request.method) {
      case "thread/loaded/list": result = { data: existsSync(promptFile) ? ["fixture-session"] : [], nextCursor: null }; break;
      case "thread/read": result = { thread: { id: "fixture-session", preview: readFileSync(promptFile, "utf8"), parentThreadId: null, status: { type: "idle" } } }; break;
      case "thread/turns/list": result = { data: [{ id: "fixture-turn", status: "failed", itemsView: request.params.itemsView, items: [], error: { codexErrorInfo: "serverOverloaded", message: "Fixture model is at capacity" } }] }; break;
    }
    ws.send(JSON.stringify({ id: request.id, result }));
  } } });
} else {
  await command(["task", "next", "--after", "24h", "--json"]);
  if (kind === "codex") writeFileSync(promptFile, process.argv.at(-1)!);
  else if (kind === "claude") {
    const settings = JSON.parse(readFileSync(process.argv[process.argv.indexOf("--settings") + 1]!, "utf8"));
    if (Object.keys(settings).join() !== "hooks") throw new Error("Launch settings changed more than hooks");
    const session = process.argv[process.argv.indexOf("--session-id") + 1]!;
    const hook = settings.hooks.StopFailure[0].hooks[0];
    const hookProcess = Bun.spawn([hook.command, ...hook.args], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    hookProcess.stdin.write(JSON.stringify({ session_id: session, hook_event_name: "StopFailure", error: "overloaded", error_details: "Fixture model is at capacity", prompt: "PRIVATE PROMPT MUST NOT BE SAVED" })); hookProcess.stdin.end();
    if (await hookProcess.exited !== 0 || (await new Response(hookProcess.stdout).text()).trim()) throw new Error("Observation hook changed the response");
  } else {
    const file = join(cwd, "observation.json");
    writeFileSync(file, JSON.stringify({ state: "failed", session_id: "wrapper-session", error: { code: "overloaded", message: "Fixture model is at capacity" } }));
    await command(["agent", "observe", "--file", file, "--json"]);
  }
  while (!existsSync(exitFile)) await Bun.sleep(50);
}
