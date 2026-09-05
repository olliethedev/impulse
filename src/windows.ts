import supervisor from "./windows-supervisor.ps1" with { type: "text" };
import { privateJson, powershell, powershellQuote } from "./platform.ts";
import { win32 } from "node:path";
import { requireThat } from "./errors.ts";

/** Windows CommandLineToArgvW/C runtime quoting: preserve quotes and trailing backslashes. */
export function windowsArgument(value: string): string {
  if (value && !/[\s"]/.test(value)) return value;
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}
function commandLine(command: string[]): string {
  if (/^cmd(?:\.exe)?$/i.test(win32.basename(command[0]!))) {
    const flag = command.findIndex(arg => /^\/[ck]$/i.test(arg));
    if (flag > 0) {
      requireThat(command.length === flag + 2, "INVALID_COMMAND", "cmd.exe /c or /k requires one final command string; quote paths and arguments using cmd syntax inside that string");
      // cmd has its own parser: /s strips this outer pair, leaving the caller's shell source intact.
      return `${command.slice(0, flag).map(windowsArgument).join(" ")} /s ${command[flag]} "${command[flag + 1]}"`;
    }
  }
  return command.map(windowsArgument).join(" ");
}
export function windowsCommand(command: string[], cwd: string, file: string, controlFile: string, outcomeFile: string): string[] {
  privateJson(file, { command_line: commandLine(command), cwd, control_file: controlFile, outcome_file: outcomeFile });
  return powershell(`$descriptorFile = ${powershellQuote(file)}\n${supervisor}`);
}
