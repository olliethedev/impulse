import skill from "../skills/impulse/SKILL.md" with { type: "text" };
import definitions from "../skills/impulse/references/definitions.md" with { type: "text" };
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { requireThat } from "./errors.ts";
const files = { "SKILL.md": skill, "references/definitions.md": definitions };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function skillDirectory(harness: string, scope: string): string {
  requireThat(["codex", "claude-code"].includes(harness), "UNSUPPORTED_HARNESS", "Supply --dir for a custom harness");
  requireThat(["user", "project"].includes(scope), "INVALID_SCOPE", "Scope must be user or project");
  const base = scope === "project" ? process.cwd() : homedir();
  return join(base, harness === "codex" ? ".agents" : ".claude", "skills", "impulse");
}
function checkOwnership(dir: string) {
  const receipt = join(dir, ".impulse-skill.json");
  requireThat(existsSync(receipt), "SKILL_CONFLICT", `Directory is not an Impulse-owned skill: ${dir}`, 4);
  const saved = JSON.parse(readFileSync(receipt, "utf8")) as { owner: string; files: Record<string, string> };
  requireThat(saved.owner === "impulse", "SKILL_CONFLICT", "Skill ownership marker does not match", 4);
  for (const [name, digest] of Object.entries(saved.files)) {
    requireThat(Object.hasOwn(files, name) && existsSync(join(dir, name)) && hash(readFileSync(join(dir, name), "utf8")) === digest, "SKILL_MODIFIED", "Installed skill has been modified; preserve or remove your edits explicitly before replacing it", 4);
  }
  const expected = new Set([...Object.keys(saved.files), ".impulse-skill.json"]);
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    const full = join(entry.parentPath, entry.name);
    requireThat(expected.has(full.slice(dir.length + 1).replaceAll("\\", "/")), "SKILL_MODIFIED", "Installed skill contains extra files; preserve them before uninstalling", 4);
  }
}
export function installSkill(directory: string) {
  const dir = resolve(directory); if (existsSync(dir)) checkOwnership(dir);
  mkdirSync(join(dir, "references"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  writeFileSync(join(dir, ".impulse-skill.json"), JSON.stringify({ owner: "impulse", version: "0.1.0", files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, hash(text)])) }, null, 2));
  return { directory: dir, installed: true };
}
export function uninstallSkill(directory: string) {
  const dir = resolve(directory); checkOwnership(dir); rmSync(dir, { recursive: true }); return { directory: dir, installed: false };
}
