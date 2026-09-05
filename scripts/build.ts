import { mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
const target = process.argv[2];
const outfile = process.argv[3] ?? `dist/impulse${process.platform === "win32" ? ".exe" : ""}`;
const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  compile: target ? { target: target as Bun.Build.CompileTarget, outfile } : { outfile },
  minify: true,
  define: { IMPULSE_COMPILED: "true" },
});
if (!result.success) throw new AggregateError(result.logs, "Build failed");
