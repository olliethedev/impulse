import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, userInfo } from "node:os";
import { requireThat } from "./errors.ts";
import { powershell, powershellQuote, runCommand, selfCommand } from "./platform.ts";
import type { Paths } from "./paths.ts";

const marker = "Managed by Impulse CLI";
const xml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
function location(p: Paths): string {
  if (process.platform === "linux") return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "autostart", "impulse.desktop");
  if (process.platform === "darwin") return join(homedir(), "Library", "LaunchAgents", "dev.impulse.scheduler.plist");
  return join(p.config, "startup.xml");
}
export function startupStatus(p: Paths) {
  const file = location(p), exists = existsSync(file);
  let installed = exists;
  if (process.platform === "win32") {
    try { installed = runCommand(["schtasks.exe", "/Query", "/TN", "Impulse", "/XML"]).includes(marker); } catch { installed = false; }
  }
  return { installed, path: file, owned: exists && readFileSync(file, "utf8").includes(marker) };
}
export function startup(p: Paths, enable: boolean) {
  const file = location(p), current = startupStatus(p);
  requireThat(!existsSync(file) || current.owned, "STARTUP_CONFLICT", `Refusing to replace an unowned startup file: ${file}`, 4);
  if (process.platform === "win32") {
    let existing: string | undefined;
    try { existing = runCommand(["schtasks.exe", "/Query", "/TN", "Impulse", "/XML"]); } catch { /* Missing task. */ }
    requireThat(!existing || existing.includes(marker), "STARTUP_CONFLICT", "A Windows task named Impulse already exists and is not owned by this CLI", 4);
  }
  if (!enable) {
    if (process.platform === "darwin" && current.installed) {
      try { runCommand(["launchctl", "bootout", `gui/${userInfo().uid}`, file]); } catch { /* May not have loaded in this login. */ }
    }
    if (process.platform === "win32" && current.installed) runCommand(["schtasks.exe", "/Delete", "/TN", "Impulse", "/F"]);
    if (existsSync(file)) rmSync(file); return startupStatus(p);
  }
  const command = [...selfCommand(), "_supervise", p.state, p.config];
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  let content: string;
  if (process.platform === "linux") {
    const arg = (value: string) => `"${value.replaceAll("%", "%%").replace(/[\\"`$]/g, c => `\\${c}`)}"`;
    content = `[Desktop Entry]\nType=Application\nName=Impulse\nComment=${marker}\nExec=${command.map(arg).join(" ")}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
  } else if (process.platform === "darwin") {
    content = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>dev.impulse.scheduler</string><key>Comment</key><string>${marker}</string><key>ProgramArguments</key><array>${command.map(v => `<string>${xml(v)}</string>`).join("")}</array><key>RunAtLoad</key><true/><key>ProcessType</key><string>Interactive</string><key>StandardOutPath</key><string>${xml(join(p.state, "startup.log"))}</string><key>StandardErrorPath</key><string>${xml(join(p.state, "startup.log"))}</string></dict></plist>\n`;
  } else {
    const args = powershell(`& ${command.map(powershellQuote).join(" ")}`);
    const user = runCommand(["whoami.exe"]);
    content = `<?xml version="1.0" encoding="UTF-16"?><Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><Description>${marker}</Description></RegistrationInfo><Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml(user)}</UserId></LogonTrigger></Triggers><Principals><Principal id="Author"><UserId>${xml(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Enabled>true</Enabled></Settings><Actions Context="Author"><Exec><Command>${xml(args[0]!)}</Command><Arguments>${xml(args.slice(1).join(" "))}</Arguments></Exec></Actions></Task>`;
  }
  writeFileSync(file, content, { mode: 0o600 });
  if (process.platform === "win32") {
    const temp = `${file}.utf16`; writeFileSync(temp, `\ufeff${content}`, "utf16le");
    try { runCommand(["schtasks.exe", "/Create", "/TN", "Impulse", "/XML", temp, "/F"]); } finally { rmSync(temp); }
  }
  return startupStatus(p);
}
