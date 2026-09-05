# Implementation and validation

Implementation began after approval of the design interview and the TypeScript/Bun devcontainer requirement. The public behavior boundaries for validation are definition loading and preview, durable task/run/agent commands, scheduler admission with a controlled clock, and the executable CLI with fixture scripts and harnesses. Tests use temporary state directories; they never submit indexing requests or import desktop credentials.

The initial documentation commit is the review baseline for this new repository. See `spec.md` for requirements, `cli-contract.md` for command semantics, and `runtime-design.md` for recovery constraints. Native desktop claims require native evidence; a successful Linux container build is insufficient.

## Current evidence

- Digest-pinned devcontainer built successfully using Podman; non-root installation and frozen lockfile installation pass with Bun 1.4.1.
- Typechecking passes. Behavior tests cover persistence after failure, configuration revision fencing, whole-run completion, nested capacity, duplicate tickets/leases, reboot interruption, idempotent receipts, elapsed-clock adjustments, and explicit/unconfirmed outcomes.
- Executable CLI fixtures pass script callbacks, nested custom harness/terminal launches with special characters, and cancellation after stopping dispatch.
- The Linux x64 standalone executable builds and validates definitions without a host Bun installation.
- A native Flatpak Yakuake fixture launched the compiled CLI, opened its controlling terminal, verified interactive input, reported an explicit agent outcome, and wrote expected evidence. It used a local fixture harness, not a model or indexing submission. The test session was removed afterward.
- The installed Codex 0.153.2 started a private app-server Unix socket with isolated configuration; no model work was initiated. Interactive model execution/cancellation remains a separate check.
- Independent standards/spec review found cancellation, setup validation, notification recovery, first-run update, controlling-terminal, and backend-startup cleanup defects; the fixes and regression evidence are recorded in `review-0.1.md`.
- [Native CI run 33940612808](https://github.com/olliethedev/impulse/actions/runs/33940612808) passed for implementation commit `057a398`: the pinned devcontainer, Linux x64/arm64, macOS Intel/Apple Silicon, and Windows x64. Every native job typechecks, runs the behavior suite, builds a standalone executable, exercises its entrypoint/skill installation/script scheduling/logs, and uploads a checksummed archive.
- The suite has 24 cases: POSIX runs 23 and skips the Windows-specific batch case; Windows runs 22 and skips the two POSIX terminal/process-group cases. The Windows case verifies a batch file path with spaces and a quoted ampersand argument. No hosted job invokes a real model.
- The uploaded Linux x64 archive was downloaded, its SHA-256 checksum verified, its packaged files inspected, and its extracted executable run on the host without Bun installed.

## Release limitations under review

This is 0.1.0 development work, not a validated v1 release. Interactive terminal/login/notification checks on macOS and Windows remain separate from hosted CI. Shared-daemon Codex on Windows needs an observable custom wrapper; POSIX Codex uses a private backend where supported. The macOS elapsed-clock adapter uses Bun's experimental FFI for one scalar libSystem call; source and compiled execution pass on both native macOS architectures, while real suspend/resume remains a desktop check. Ambiguous liveness remains held for investigation; it is never silently retried. No live indexing migration has occurred.

Package-manager publication, signing/notarization, and a public release are not part of committing the implementation. The repository's visibility remains unchanged.
