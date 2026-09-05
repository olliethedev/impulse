# Implementation and validation

Implementation began after approval of the design interview and the TypeScript/Bun devcontainer requirement. The public behavior boundaries for validation are definition loading and preview, durable task/run/agent commands, scheduler admission with a controlled clock, and the executable CLI with fixture scripts and harnesses. Tests use temporary state directories; they never submit indexing requests or import desktop credentials.

The initial documentation commit is the review baseline for this new repository. See `spec.md` for requirements, `cli-contract.md` for command semantics, and `runtime-design.md` for recovery constraints. Native desktop claims require native evidence; a successful Linux container build is insufficient.
