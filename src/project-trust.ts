import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ImpulseError } from "./errors.ts";

type Table = Record<string, unknown>;
function object(value: unknown): Table {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a configuration table");
  return value as Table;
}
function within(root: string, path: string) {
  const part = relative(root, path);
  if (part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`))) return true;
  if (process.platform !== "win32") return false;
  // Git expands Windows 8.3 names (RUNNER~1 -> runneradmin), while Bun's
  // realpath can retain them. Compare ancestor identities without widening scope.
  const identity = statSync(root, { bigint: true });
  for (let current = path; ; current = dirname(current)) {
    const candidate = statSync(current, { bigint: true });
    if (identity.ino !== 0n && candidate.dev === identity.dev && candidate.ino === identity.ino) return true;
    if (dirname(current) === current) return false;
  }
}
function read(path: string): string | null {
  try { return readFileSync(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
function git(cwd: string, args: string[]): string | null {
  const result = Bun.spawnSync(["git", "-C", cwd, "rev-parse", ...args], { stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}
function projectDirectories(cwd: string, harness: string): string[] {
  // Inspect only local Git metadata; no hooks, config helpers, or project code run.
  const root = git(cwd, ["--show-toplevel"]);
  if (!root) return [cwd];
  const repository = realpathSync(root);
  if (harness === "codex") return [...new Set([cwd, repository])];
  const common = git(cwd, ["--path-format=absolute", "--git-common-dir"]);
  // Claude keys worktrees on the main checkout; Git lists that checkout first.
  if (!common) throw new Error("Cannot locate the repository common directory");
  const worktrees = Bun.spawnSync(["git", "--git-dir", common, "worktree", "list", "--porcelain", "-z"], { stdout: "pipe", stderr: "pipe" });
  const first = worktrees.stdout.toString().split("\0")[0];
  if (worktrees.exitCode !== 0 || !first?.startsWith("worktree ")) throw new Error("Cannot locate the main checkout for Claude Code trust");
  return [realpathSync(first.slice("worktree ".length))];
}

/** Host-owned opt-in, used only by built-in agent adapters after claiming a ticket. */
export async function prepareProjectTrust(harness: string, cwd: string, roots: string[], env: NodeJS.ProcessEnv = process.env) {
  if (!roots.length || !["codex", "claude-code"].includes(harness)) return;
  const directory = realpathSync(cwd);
  // Settings store canonical roots. A subsequently replaced root symlink must not widen scope.
  const allowed = roots.filter(root => { try { return realpathSync(root) === root; } catch { return false; } });
  if (!allowed.some(root => within(root, directory))) return;
  const projects = projectDirectories(directory, harness);
  if (projects.some(project => !allowed.some(root => within(root, project)))) {
    throw new ImpulseError("PROJECT_TRUST", `The repository trust root is outside trust.roots; trust it manually or explicitly update Impulse settings. Resolved projects: ${JSON.stringify(projects)}; allowed roots: ${JSON.stringify(allowed)}`);
  }
  const home = homedir();
  const configured = harness === "codex"
    ? join(env.CODEX_HOME || join(home, ".codex"), "config.toml")
    : env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, ".claude.json") : join(home, ".claude.json");
  mkdirSync(dirname(configured), { recursive: true, mode: 0o700 });
  const file = existsSync(configured) ? realpathSync(configured) : join(realpathSync(dirname(configured)), basename(configured));
  const lock = `${file}.impulse-trust.lock`;
  let acquired = false;
  for (let i = 0; i < 100; i++) {
    try { mkdirSync(lock, { mode: 0o700 }); acquired = true; break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; await Bun.sleep(50); }
  }
  if (!acquired) throw new ImpulseError("PROJECT_TRUST", `Trust update is locked: ${lock}. Check for a live Impulse runner before removing a stale lock`);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const original = read(file);
    let config: Table;
    try { config = object(harness === "codex" ? Bun.TOML.parse(original ?? "") : JSON.parse(original ?? "{}")); }
    catch { throw new ImpulseError("PROJECT_TRUST", `Cannot parse ${file}; fix the harness configuration before running this task`); }
    const entries = object(config.projects ?? {});
    const missing: string[] = [];
    const field = harness === "codex" ? "trust_level" : "hasTrustDialogAccepted";
    const trusted = harness === "codex" ? "trusted" : true;
    for (const project of projects) {
      const entry = object(entries[project] ?? {});
      if (entry[field] === trusted) continue;
      if (entry[field] !== undefined) throw new ImpulseError("PROJECT_TRUST", `Existing trust refusal for ${project} in ${file}; review and change it explicitly before running this task`);
      entries[project] = { ...entry, [field]: trusted }; missing.push(project);
    }
    if (!missing.length) return;
    config.projects = entries;
    let updated: string;
    if (harness === "codex") {
      // Preserve comments/formatting when adding ordinary new tables. Fall back to a
      // verified full serialization for inline tables or existing incomplete entries.
      updated = (original ?? "") + missing.map(project => `\n[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n`).join("");
      try { if (!isDeepStrictEqual(Bun.TOML.parse(updated), config)) throw new Error("Needs full serialization"); }
      catch { updated = Bun.TOML.stringify(config)!; }
      if (!isDeepStrictEqual(Bun.TOML.parse(updated), config)) throw new ImpulseError("PROJECT_TRUST", `Cannot preserve ${file} while adding project trust; update it manually`);
    } else updated = JSON.stringify(config, null, 2) + "\n";
    if (original !== null) {
      try { const backup = openSync(`${file}.before-impulse-trust`, "wx", 0o600); try { writeFileSync(backup, original); } finally { closeSync(backup); } }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    writeFileSync(temporary, updated, { flag: "wx", mode: 0o600 });
    if (read(file) !== original) throw new ImpulseError("PROJECT_TRUST", `Configuration changed during trust setup: ${file}; retry the task after the other writer finishes`);
    renameSync(temporary, file);
    return { file, projects: missing };
  } finally { rmSync(temporary, { force: true }); rmSync(lock, { recursive: true }); }
}
