---
name: impulse
description: Schedule durable local scripts or agent assignments with the Impulse CLI. Use when the user asks to run work later, repeat work on a schedule, change or disable an existing Impulse task, or complete an assignment launched by Impulse.
---

# Impulse

Use `impulse --help` and `impulse doctor --json` to inspect this installation. Respect the user's requested scope and the harness's permissions. A schedule does not grant extra authority.

Before creating work, inspect `impulse task list --json` to avoid duplicates. Keep script definitions next to their scripts. Put project agent definitions in `.impulse/tasks/`; resolve `cwd` relative to the definition. For non-project work, use the `config/tasks` directory shown by `impulse doctor`.

New task folders may trigger workspace trust dialogs. Inspect `impulse config show --json`: an explicitly authorized host setting `[trust] roots = ["/absolute/projects"]` lets built-in Codex and Claude Code launches record exact project trust beneath those roots. This defaults off, preserves existing trust refusals, and does not change tool approval or sandbox settings. Only configure roots the user has authorized; task definitions cannot grant trust. Custom harnesses manage their own trust setup. Removing a root stops future additions; revoke existing trust in the harness configuration explicitly.

Every definition needs explicit first-run timing. Use calendar schedules for a clock time and completion intervals for elapsed time after the entire run, including its agents, succeeds. See [definitions](references/definitions.md) for examples.

Validate and preview a definition before registering it:

```sh
impulse task validate task.toml --json
impulse task preview task.toml --json
impulse task register task.toml --json
```

Registration is idempotent by canonical file path. Editing the file does not apply it: use `impulse task update TASK --json`. Updates replace all upcoming timing and fence old run scheduling callbacks. Read `task show` to inspect applied configuration and drift.

Rename with `impulse task rename TASK --name NAME --json`; do not remove and recreate the task. Renaming preserves the ID, history, timing, enabled state and active contexts, and changes only the local registered name. Update callers using the old name, or use its stable task ID. New terminal tabs include the current task name and a short assignment ID; already-open tabs keep their launch titles.

Within a launched script or agent, Impulse supplies a run context. Use `--context PATH` explicitly if a helper or harness does not inherit `IMPULSE_CONTEXT`. Schedule and outcome acknowledgments are durable only after the command succeeds.

```sh
impulse task next --after 24h --json
impulse task disable --json
impulse agent request --instructions "Investigate the failure and finish the pending work" --json
impulse agent finish --outcome success --summary "Describe the verified result" --json
```

Requests wait by default; `--no-wait` still attaches the agent to the same run. The request uses Impulse's configured harness and terminal. Agent requests are general instructions, not an automatic repair policy. Expected quota waits should set the next time; do not invent an error or retry loop.

Report `success` or `failed` with a truthful summary using `agent finish`. Exiting a terminal does not report an outcome. A completed assignment context cannot schedule or request more work. If a child failed and you completed a fallback, `agent handle ID --reason TEXT` preserves the failure while marking it handled. Otherwise its failure prevents whole-run success.

Use `run show`, `run logs`, and `agent show` to inspect evidence. A full nested-agent limit returns exit 5 immediately: schedule future work or return control rather than waiting while holding every slot. There is no automatic execution cutoff.

All commands support `--json`. Errors have `ok:false` and an error code. Waited work can return `ok:true` with exit 10 (failed), 11 (unconfirmed), or 12 (interrupted/cancelled). Inspect the structured status. Use `--request-id KEY` when retrying a mutation after uncertain delivery; keep the input identical.

Task disabling affects future execution. `run stop RUN` cancels current work; `--force` is a separate explicit escalation. Never kill a shared terminal or harness server. Do not claim uncertain work succeeded or automatically repeat external effects.
