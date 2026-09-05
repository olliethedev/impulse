import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const binary = `impulse${process.platform === "win32" ? ".exe" : ""}`;
const name = `impulse-0.1.0-${process.platform}-${process.arch}.tar.gz`;
mkdirSync("dist/packages", { recursive: true });
const child = Bun.spawn(["tar", "-czf", `dist/packages/${name}`, "-C", "dist", binary, "-C", "..", "LICENSE", "README.md", "skills/impulse"], { stdout: "inherit", stderr: "inherit" });
if (await child.exited !== 0) throw new Error("Archive creation failed");
const digest = createHash("sha256").update(readFileSync(`dist/packages/${name}`)).digest("hex");
writeFileSync(`dist/packages/${name}.sha256`, `${digest}  ${name}\n`);
