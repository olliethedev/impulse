import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareProjectTrust } from "../src/project-trust.ts";
import { parseSettings } from "../src/config.ts";

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "impulse-trust-"))); homes.push(home);
  const root = join(home, "Projects"), cwd = join(root, "new project '$ ` with spaces"), codex = join(home, "codex"), claude = join(home, "claude");
  for (const path of [cwd, codex, claude]) mkdirSync(path, { recursive: true });
  const env = { CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude };
  return { home, root, cwd, env, codex: join(codex, "config.toml"), claude: join(claude, ".claude.json") };
}
function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}
test("trust is opt-in machine configuration, validates roots, and defaults off", () => {
  const f = fixture();
  expect(parseSettings("schema_version=1").trust).toBeUndefined();
  expect(parseSettings(Bun.TOML.stringify({ schema_version: 1, trust: { roots: [f.root, f.root] } })!).trust?.roots).toEqual([f.root]);
  expect(() => parseSettings('schema_version=1\n[trust]\nroots=["relative"]')).toThrow("absolute paths");
  expect(() => parseSettings('schema_version=1\n[trust]\nroots="/tmp"')).toThrow("array");
  expect(() => parseSettings('schema_version=1\n[trust]\nrecursive=true')).toThrow("Unknown field");
});
test("Codex adds exact trust, preserves comments and settings, and is idempotent", async () => {
  const f = fixture(), original = '# Keep this comment\napproval_policy="on-request"\n[projects."/another"]\ntrust_level="trusted"\n';
  writeFileSync(f.codex, original);
  await prepareProjectTrust("codex", f.cwd, [f.root], f.env);
  const saved = readFileSync(f.codex, "utf8"), parsed = Bun.TOML.parse(saved) as any;
  expect(saved.startsWith(original)).toBe(true);
  expect(parsed.projects[f.cwd].trust_level).toBe("trusted");
  expect(parsed.approval_policy).toBe("on-request");
  expect(parsed.projects["/another"].trust_level).toBe("trusted");
  expect(readFileSync(f.codex + ".before-impulse-trust", "utf8")).toBe(original);
  await prepareProjectTrust("codex", f.cwd, [f.root], f.env);
  expect(readFileSync(f.codex, "utf8")).toBe(saved);
  if (process.platform !== "win32") expect(statSync(f.codex).mode & 0o777).toBe(0o600);
});
test("Codex preserves inline tables and existing project metadata", async () => {
  const f = fixture();
  writeFileSync(f.codex, `projects = { ${JSON.stringify(f.cwd)} = { metadata = "preserve" } }\nmodel="fixture"\n`);
  await prepareProjectTrust("codex", f.cwd, [f.root], f.env);
  const parsed = Bun.TOML.parse(readFileSync(f.codex, "utf8")) as any;
  expect(parsed.projects[f.cwd]).toEqual({ metadata: "preserve", trust_level: "trusted" });
  expect(parsed.model).toBe("fixture");
});
test("both harnesses preserve existing refusals and malformed configuration", async () => {
  const f = fixture();
  for (const harness of ["codex", "claude-code"]) {
    const file = harness === "codex" ? f.codex : f.claude;
    const original = harness === "codex" ? Bun.TOML.stringify({ projects: { [f.cwd]: { trust_level: "untrusted" } } })! : JSON.stringify({ projects: { [f.cwd]: { hasTrustDialogAccepted: false } } });
    writeFileSync(file, original);
    await expect(prepareProjectTrust(harness, f.cwd, [f.root], f.env)).rejects.toThrow("Existing trust refusal");
    expect(readFileSync(file, "utf8")).toBe(original);
    writeFileSync(file, "invalid configuration [");
    await expect(prepareProjectTrust(harness, f.cwd, [f.root], f.env)).rejects.toThrow("Cannot parse");
    expect(readFileSync(file, "utf8")).toBe("invalid configuration [");
  }
});
test("disabled trust, custom harnesses, and sibling prefixes do not modify config", async () => {
  const f = fixture(), sibling = join(f.home, "Projects-other"); mkdirSync(sibling);
  await prepareProjectTrust("codex", f.cwd, [], f.env);
  await prepareProjectTrust("custom", f.cwd, [f.root], f.env);
  for (const harness of ["codex", "claude-code"]) await prepareProjectTrust(harness, sibling, [f.root], f.env);
  expect(existsSync(f.codex)).toBe(false); expect(existsSync(f.claude)).toBe(false);
});
test.skipIf(process.platform === "win32")("symlinks cannot escape or replace the approved root", async () => {
  const f = fixture(), outside = join(f.home, "outside"), link = join(f.root, "escape"); mkdirSync(outside); symlinkSync(outside, link);
  await prepareProjectTrust("codex", link, [f.root], f.env);
  expect(existsSync(f.codex)).toBe(false);
  const stale = join(f.home, "stale-root"); symlinkSync(outside, stale);
  await prepareProjectTrust("codex", outside, [stale], f.env);
  expect(existsSync(f.codex)).toBe(false);
});
test("concurrent launches preserve every new project and unrelated Claude settings", async () => {
  const f = fixture(), second = join(f.root, "second"); mkdirSync(second);
  const original = JSON.stringify({ fixtureToken: "not-a-real-secret", projects: { elsewhere: { allowedTools: ["Read"] } } });
  writeFileSync(f.claude, original);
  await Promise.all([f.cwd, second].map(cwd => prepareProjectTrust("claude-code", cwd, [f.root], f.env)));
  const parsed = JSON.parse(readFileSync(f.claude, "utf8"));
  expect(parsed.fixtureToken).toBe("not-a-real-secret");
  expect(parsed.projects.elsewhere).toEqual({ allowedTools: ["Read"] });
  for (const cwd of [f.cwd, second]) expect(parsed.projects[cwd].hasTrustDialogAccepted).toBe(true);
  expect(readFileSync(f.claude + ".before-impulse-trust", "utf8")).toBe(original);
});
test("repository subdirectories and Claude worktrees use the right trust roots", async () => {
  const f = fixture(), child = join(f.cwd, "nested"); mkdirSync(child);
  git(f.cwd, "init", "-q");
  git(f.cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "fixture");
  const worktree = join(f.root, "worktree"); git(f.cwd, "-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", worktree);
  await prepareProjectTrust("codex", child, [f.root], f.env);
  const codex = (Bun.TOML.parse(readFileSync(f.codex, "utf8")) as any).projects;
  expect(codex[child].trust_level).toBe("trusted"); expect(codex[f.cwd].trust_level).toBe("trusted");
  await prepareProjectTrust("claude-code", worktree, [f.root], f.env);
  expect(JSON.parse(readFileSync(f.claude, "utf8")).projects).toEqual({ [f.cwd]: { hasTrustDialogAccepted: true } });
});
test("a repository root outside the approved directory is never newly trusted", async () => {
  const f = fixture(); git(f.home, "init", "-q");
  for (const harness of ["codex", "claude-code"]) await expect(prepareProjectTrust(harness, f.cwd, [f.root], f.env)).rejects.toThrow("outside trust.roots");
  expect(existsSync(f.codex)).toBe(false); expect(existsSync(f.claude)).toBe(false);
});
