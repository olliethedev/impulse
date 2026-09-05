# Indexing migration review

Impulse baseline: `9d5d6da`. Migration changes: `be92727`, `a0554c9`, and `c99e8ea`. Application source lives in a separate local-only repository; no private indexing state is published here.

## Standards

Two documented breaches were found: failed reservation persistence still allowed request clicks, and failed CLI replacement could leave dispatch stopped. Both were corrected. Counter and ledger writes must flush and succeed before a click; a failed ledger write retains the reserved attempt. Installation prepares and validates the replacement first, then restores dispatch if the atomic swap fails. The independent follow-up found no new material Standards regressions or worthwhile heuristic findings.

## Spec

Two defects were found: unchecked pre-click writes violated the reservation contract, and an uncertain repair could disable indexing without notifying because whole-run completion remained held. Both were corrected. External-harness uncertainty now creates a durable alert immediately without releasing capacity; repeated observations do not duplicate it. The local desktop adapter includes inspection instructions even before the intervention file is written. The independent follow-up found no regressions within its bounded review.

Standards: two findings resolved, none outstanding. Spec: two findings resolved, none outstanding.

## Security

Safeguard reviewed `origin/main..c99e8ea`, including the Linux installer, execution-uncertainty notifications, CI, and tests. Verdict: clean, no exploitable security vulnerabilities found. Review was static and read-only. No dependency manifest or lockfile changed.

## Validation

The pinned Bun 1.4.1 devcontainer passed typechecking, 24 tests with one Windows-only skip, and standalone binary smoke checks. Linux installer fixtures verified that copy failure leaves dispatch running and atomic replacement failure restores it. Local indexing fixtures cover consecutive errors, ambiguous clicks, failed reservations, five compiled-CLI recovery/coordinator flows, persistent notification arguments, and the existing ledger/audit/queue checks. The real Codex agent additionally reproduced and corrected an API audit that falsely returned success after authentication errors, retaining its CSV diagnostics and a regression test.

The authorized desktop run opened Codex in Yakuake, read the installed Impulse skill, diagnosed the task, fixed the local audit, and reported an explicit failed outcome because authentication and browser request errors remained unresolved. Impulse disabled future execution and delivered a critical persistent notification through KDE (desktop notification ID 148). No indexing requests were submitted; ledger, ten consumed attempts, and the original cooldown matched their pre-migration backup hashes. The terminal remains open for inspection.

[Native CI run 33995048096](https://github.com/olliethedev/impulse/actions/runs/33995048096) passed at `c99e8ea` on Linux x64/arm64, macOS Intel/Apple Silicon, Windows x64, and the devcontainer. Both independent reviewers also checked the final local API-audit fix and found no unresolved issues.
