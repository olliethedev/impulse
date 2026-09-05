import supervisor from "./windows-supervisor.ps1" with { type: "text" };
import { privateJson, powershell, powershellQuote } from "./platform.ts";

/** Windows CommandLineToArgvW/C runtime quoting: preserve quotes and trailing backslashes. */
export function windowsArgument(value: string): string {
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}
export function windowsCommand(command: string[], cwd: string, file: string, controlFile: string, outcomeFile: string): string[] {
  privateJson(file, { command_line: command.map(windowsArgument).join(" "), cwd, control_file: controlFile, outcome_file: outcomeFile });
  return powershell(`$descriptorFile = ${powershellQuote(file)}\n${supervisor}`);
}
