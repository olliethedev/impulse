# Working on Impulse

Read `CONTRIBUTING.md`, `CONTEXT.md`, and the relevant ADRs before implementation. Use the devcontainer and locked Bun version. Keep tests isolated from real scheduler state, harness credentials, and indexing submissions.

## Agent skills

GitHub Issues are the tracker; external PRs are not automatically a triage surface. See `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.

This is a single-context repository; see `docs/agents/domain.md`. The installable product skill is `skills/impulse/SKILL.md`; keep it aligned with the executable CLI.
