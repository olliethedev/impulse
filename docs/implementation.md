# Implementation and validation

Implementation began after approval of the design interview and the TypeScript/Bun devcontainer requirement. The public behavior boundaries for validation are definition loading and preview, durable task/run/agent commands, scheduler admission with a controlled clock, and the executable CLI with fixture scripts and harnesses. Tests use temporary state directories; they never submit indexing requests or import desktop credentials.

The initial documentation commit is the review baseline for this new repository. See `spec.md` for requirements, `cli-contract.md` for command semantics, and `runtime-design.md` for recovery constraints. Native desktop claims require native evidence; a successful Linux container build is insufficient.

## Current evidence

- Digest-pinned devcontainer built successfully using Podman; non-root installation and frozen lockfile installation pass with Bun 1.4.1.
- Typechecking passes. Behavior tests cover persistence after failure, configuration revision fencing, whole-run completion, nested capacity, duplicate tickets/leases, reboot interruption, idempotent receipts, and explicit/unconfirmed outcomes.
- Executable CLI fixtures pass script callbacks, nested custom harness/terminal launches with special characters, and cancellation after stopping dispatch.
- The Linux x64 standalone executable builds and validates definitions without a host Bun installation.
- Native CI is configured for Linux x64/arm64, macOS Intel/Apple Silicon, and Windows x64, including compiled executable smoke tests and checksummed archives. Results will be recorded after it runs.

## Release limitations under review

This is 0.1.0 development work, not a validated v1 release. Interactive terminal/login/notification checks on macOS and Windows remain separate from hosted CI. Shared-daemon Codex on Windows needs an observable custom wrapper; POSIX Codex uses a private backend where supported. macOS manual clock changes currently use persisted wall deadlines rather than an independent clock that includes suspend. Ambiguous liveness remains held for investigation; it is never silently retried. No live indexing migration has occurred.

Package-manager publication, signing/notarization, and a public release are not part of committing the implementation. The repository's visibility remains unchanged.
