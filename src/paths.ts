import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
export interface Paths { config: string; state: string; db: string; logs: string; contexts: string; launches: string }
export function paths(home = process.env.IMPULSE_HOME): Paths {
  let config: string, state: string;
  if (home) { config = join(resolve(home), "config"); state = join(resolve(home), "state"); }
  else if (process.platform === "win32") {
    config = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Impulse");
    state = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Impulse");
  } else if (process.platform === "darwin") {
    const root = join(homedir(), "Library", "Application Support", "Impulse");
    config = join(root, "config"); state = join(root, "state");
  } else {
    config = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "impulse");
    state = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "impulse");
  }
  return { config, state, db: join(state, "state.sqlite"), logs: join(state, "logs"), contexts: join(state, "contexts"), launches: join(state, "launches") };
}
export function ensurePaths(p: Paths) {
  for (const dir of [p.config, p.state, p.logs, p.contexts, p.launches]) mkdirSync(dir, { recursive: true, mode: 0o700 });
}
