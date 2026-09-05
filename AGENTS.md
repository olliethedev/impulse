# Working on Impulse

Read `CONTRIBUTING.md`, `CONTEXT.md`, and the relevant ADRs before implementation. Use the devcontainer and locked Bun version. Keep tests isolated from real scheduler state, harness credentials, and indexing submissions.

If `.impulse-install.json` exists, this checkout manages an installed development CLI. After completed, verified code changes, run `bash scripts/install-local.sh` on the desktop host to rebuild/reinstall the executable and refresh the selected skill. The developer decides when replacement is safe; do not add an idle-work gate or ask again for routine reinstalls. Preserve task state and existing startup choices.

## Agent skills

GitHub Issues are the tracker; external PRs are not automatically a triage surface. See `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.

This is a single-context repository; see `docs/agents/domain.md`. The installable product skill is `skills/impulse/SKILL.md`; keep it aligned with the executable CLI.
