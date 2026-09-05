import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { detach, powershell, powershellQuote, runCommand, shellQuote } from "./platform.ts";
import { ImpulseError } from "./errors.ts";
import type { ExecutionProfile } from "./types.ts";

export interface LaunchDescriptor {
  schema_version: 1;
  ticket: import("./engine.ts").Ticket;
  paths: import("./paths.ts").Paths;
  runner: { command: string[]; cwd: string };
  instructions?: string;
  context_file: string;
  profile: ExecutionProfile;
  keep_open: boolean;
}
export function substitute(command: string[], file: string): string[] { return command.map(arg => arg === "{launch_file}" ? file : arg); }
export async function launchTerminal(descriptor: LaunchDescriptor, file: string) {
  const profile = descriptor.profile;
  if (profile.terminal_profile) { await detach(substitute(profile.terminal_profile.command, file)); return; }
  const command = descriptor.runner.command;
  const title = `Impulse ${descriptor.ticket.id.slice(0, 18)}`;
  switch (profile.terminal) {
    case "konsole":
      if (process.platform !== "linux") throw new ImpulseError("UNSUPPORTED_TERMINAL", "Konsole requires Linux", 6);
      await detach(["konsole", "--separate", "--hold", "--workdir", descriptor.runner.cwd, "-p", `tabtitle=${title}`, "-e", ...command]); return;
    case "yakuake": {
      if (process.platform !== "linux") throw new ImpulseError("UNSUPPORTED_TERMINAL", "Yakuake requires Linux", 6);
      const qdbus = Bun.which("qdbus6") ?? Bun.which("qdbus") ?? "qdbus6";
      const base = [qdbus, "org.kde.yakuake"];
      let flatpak = false;
      try {
        const pid = runCommand([qdbus, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.GetConnectionUnixProcessID", "org.kde.yakuake"]);
        flatpak = existsSync(`/proc/${pid}/root/.flatpak-info`);
        if (flatpak) {
          const info = readFileSync(`/proc/${pid}/root/.flatpak-info`, "utf8");
          if (!info.includes("org.kde.yakuake")) throw new Error("Unexpected Flatpak owner");
        }
      } catch (error) { throw new ImpulseError("TERMINAL_UNAVAILABLE", `Start Yakuake in your desktop session first: ${String(error)}`, 6); }
      const session = runCommand([...base, "/yakuake/sessions", "org.kde.yakuake.addSession"]);
      const terminals = runCommand([...base, "/yakuake/sessions", "org.kde.yakuake.terminalIdsForSessionId", session]);
      const terminal = terminals.split(",")[0]!.trim();
      if (!/^\d+$/.test(session) || !/^\d+$/.test(terminal)) throw new Error("Yakuake returned an invalid session identity");
      runCommand([...base, "/yakuake/tabs", "org.kde.yakuake.setTabTitle", session, title]);
      const hostCommand = flatpak ? ["flatpak-spawn", "--host", "--watch-bus", ...command] : command;
      runCommand([...base, "/yakuake/sessions", "org.kde.yakuake.runCommandInTerminal", terminal, hostCommand.map(shellQuote).join(" ")]); return;
    }
    case "terminal-app": {
      if (process.platform !== "darwin") throw new ImpulseError("UNSUPPORTED_TERMINAL", "Terminal.app requires macOS", 6);
      const shell = command.map(shellQuote).join(" ");
      // argv is data to AppleScript, never interpolated into AppleScript source.
      runCommand(["osascript", "-e", 'on run argv\ntell application "Terminal"\ndo script (item 1 of argv)\nend tell\nend run', shell]); return;
    }
    case "windows-terminal": {
      if (process.platform !== "win32") throw new ImpulseError("UNSUPPORTED_TERMINAL", "Windows Terminal requires Windows", 6);
      const script = `& ${command.map(powershellQuote).join(" ")}`;
      await detach(["wt.exe", "-w", "new", "new-tab", "--title", title, "--startingDirectory", descriptor.runner.cwd, ...powershell(script)]); return;
    }
    default: throw new ImpulseError("UNKNOWN_TERMINAL", `Unknown terminal ${profile.terminal}`, 6);
  }
}
export function assignmentInstructions(instructions: string, contextFile: string, executable: string[]): string {
  return `${instructions}\n\nImpulse assignment instructions:\nThis work belongs to a durable local run. Use the Impulse CLI for nested agent requests and scheduling changes. The context file is ${JSON.stringify(contextFile)}. Pass --context with this path if your harness does not inherit IMPULSE_CONTEXT.\nCLI argument prefix: ${JSON.stringify(executable)}.\nWhen your assigned work is complete, execute agent finish --outcome success --summary <your summary>, or agent finish --outcome failed --summary <reason>, with this context. Report only work you actually completed. An exit from the terminal is not an outcome. The terminal remains available after the report.\nDo not use the completed assignment context for further work. User and harness permissions still apply.\n`;
}
