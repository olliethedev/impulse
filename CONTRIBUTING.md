# Contributing

Use the devcontainer for the pinned development environment. It does not mount host credentials, the desktop bus, or the user's Impulse state. Native integration tests use isolated state and fixture harnesses.

Run `bun install --frozen-lockfile`, `bun run typecheck`, the relevant test file with `bun test tests/NAME.test.ts`, and `bun run check` before completing a change. `bun scripts/smoke-binary.ts` exercises the compiled executable. Native CI uses the same Bun version and lockfile; desktop behavior still needs interactive checks.

Keep domain behavior behind the command layer. SQLite transactions must encompass validation, mutation, event records, and request receipts. The scheduler admits work; runners claim tickets before performing external effects. Never infer success from a missing heartbeat or a closed agent terminal. Treat uncertain liveness conservatively.

Pass commands as argument arrays. Prompts and context are data. Any unavoidable shell boundary must quote only the runner invocation using that shell's rules. Cancellation must target owned execution, never a shared terminal application or shared harness server. Do not introduce an automatic agent timeout.

Tests should exercise public behavior: loading definitions, durable commands, scheduler admission, and executable workflows. Use temporary state and controlled clocks. Avoid assertions against private SQL rows or implementation-specific helper calls. Keep platform-sensitive code in adapters/platform modules.

Keep CLI help, examples, and the installable skill consistent. Unknown fields and conflicting options should produce actionable errors. The glossary is in `CONTEXT.md`; architectural decisions are in `docs/adr/`.

For toolchain updates, select an explicit Bun version and matching types, update both image digests after verifying their manifests, regenerate `bun.lock`, rebuild the devcontainer, and run the native matrix. Pin CI actions by commit. Reproducible tooling does not itself establish bit-for-bit artifact reproducibility.
