import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ImpulseError } from "./errors.ts";
import { uptime } from "node:os";
import type { ClockSample } from "./types.ts";

export function selfCommand(): string[] {
  return Bun.main.includes("$bunfs") ? [process.execPath] : [process.execPath, Bun.main];
}
export function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
export function powershellQuote(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
export function powershell(script: string): string[] {
  return ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}
export function runCommand(command: string[]): string {
  const result = spawnSync(command[0]!, command.slice(1), { encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (result.error || result.status !== 0) throw new ImpulseError("COMMAND_FAILED", result.error?.message ?? result.stderr.trim() ?? `Command exited ${result.status}`, 6);
  return result.stdout.trim();
}
let cachedBoot: string | undefined;
export function bootId(): string {
  if (cachedBoot) return cachedBoot;
  if (process.platform === "linux") cachedBoot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  else if (process.platform === "darwin") cachedBoot = runCommand(["sysctl", "-n", "kern.bootsessionuuid"]);
  else cachedBoot = runCommand(powershell("(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')"));
  return cachedBoot;
}
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return !["Z", "X"].includes(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0]!);
    }
    if (process.platform === "darwin") return !runCommand(["ps", "-p", String(pid), "-o", "stat="]).startsWith("Z");
    return true;
  } catch { return false; }
}
export function groupAlive(pgid: number): boolean {
  if (process.platform === "linux") {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        if (Number(fields[2]) === pgid && fields[0] !== "Z" && fields[0] !== "X") return true;
      } catch { /* A process may exit while enumerating. */ }
    }
    return false;
  }
  if (process.platform === "darwin") return runCommand(["ps", "-axo", "pgid=,stat="]).split("\n").some(line => { const [group, state] = line.trim().split(/\s+/); return Number(group) === pgid && !state?.startsWith("Z"); });
  return alive(pgid);
}
let darwinElapsed: (() => number) | undefined;
export function elapsedClock(): ClockSample | undefined {
  if (process.platform === "linux") return { boot_id: bootId(), at: Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * 1000 };
  if (process.platform === "win32") return { boot_id: bootId(), at: uptime() * 1000 };
  if (process.platform === "darwin") {
    if (!darwinElapsed) {
      const { dlopen } = require("bun:ffi") as typeof import("bun:ffi");
      const library = dlopen("/usr/lib/libSystem.B.dylib", { clock_gettime_nsec_np: { args: ["i32"], returns: "u64" } });
      // Apple's CLOCK_MONOTONIC_RAW (4) uses mach_continuous_time, including suspend.
      darwinElapsed = () => Number(library.symbols.clock_gettime_nsec_np(4)) / 1000000;
    }
    return { boot_id: bootId(), at: darwinElapsed() };
  }
  return undefined;
}
export function privateJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" }); renameSync(temp, path);
}
export function detach(command: string[], env: NodeJS.ProcessEnv = process.env, log?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), { detached: true, env, stdio: ["ignore", log ?? "ignore", log ?? "ignore"], windowsHide: true });
    child.once("error", reject); child.once("spawn", () => { child.unref(); resolve(child.pid!); });
  });
}
/** Signal only a child whose live process handle is still held by this runner. */
export function stopChild(child: ChildProcess, force: boolean, group: boolean): void {
  if (!child.pid) return;
  if (process.platform !== "win32" && group) { if (!groupAlive(child.pid)) return; }
  else if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    if (force) runCommand(["taskkill.exe", "/PID", String(child.pid), "/T", "/F"]);
    else {
      const script = `Add-Type -TypeDefinition @'\nusing System; using System.Runtime.InteropServices; public class ImpulseConsole { [DllImport("kernel32.dll")] public static extern bool FreeConsole(); [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid); [DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add); [DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint kind, uint group); }\n'@\n[ImpulseConsole]::FreeConsole() | Out-Null; if (![ImpulseConsole]::AttachConsole(${child.pid})) { exit 1 }; [ImpulseConsole]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null; if (![ImpulseConsole]::GenerateConsoleCtrlEvent(1, 0)) { exit 1 }; [ImpulseConsole]::FreeConsole() | Out-Null`;
      runCommand(powershell(script));
    }
  } else {
    try { process.kill(group ? -child.pid : child.pid, force ? "SIGKILL" : "SIGTERM"); }
    catch (error) { if (alive(child.pid)) throw error; }
  }
}
