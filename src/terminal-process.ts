import type { ProcessHandle } from "./platform.ts";
export interface ExecutionExit { code: number | null; error: string | null }
export interface TerminalProcess { process: ProcessHandle; exited: Promise<ExecutionExit>; close(): void }
/** A private PTY supplies a controlling terminal and an owned process group at the same time. */
export function terminalProcess(command: string[], cwd: string, env: NodeJS.ProcessEnv, output: (data: Uint8Array) => void = data => { process.stdout.write(data); }): TerminalProcess {
  const terminal = new Bun.Terminal({ cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24, data: (_, bytes) => output(bytes) });
  let child: Bun.Subprocess;
  try { child = Bun.spawn(command, { cwd, env, terminal }); }
  catch (error) { terminal.close(); throw error; }
  const input = (bytes: Buffer) => { if (!terminal.closed) terminal.write(bytes); };
  const resize = () => { if (!terminal.closed) terminal.resize(process.stdout.columns ?? 80, process.stdout.rows ?? 24); };
  const raw = process.stdin.isRaw;
  if (process.stdin.isTTY) { process.stdin.setRawMode(true); process.stdin.on("data", input); process.stdin.resume(); }
  process.stdout.on("resize", resize);
  return { process: child, exited: child.exited.then(code => ({ code, error: child.signalCode ? `Exited from ${child.signalCode}` : null })), close() {
    process.stdout.off("resize", resize);
    if (process.stdin.isTTY) { process.stdin.off("data", input); process.stdin.setRawMode(!!raw); process.stdin.pause(); }
    terminal.close();
  } };
}
