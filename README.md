# Impulse

Durable local scheduling for scripts and agent assignments. Register a task once, give it a schedule, and let it use your chosen agent harness and terminal when it needs agent work.

Use Impulse to:

- Schedule a script or agent for later, on a calendar, or after the previous run succeeds.
- Let running scripts and agents change their task's next run or disable future runs.
- Request agents from a script or another agent, wait for results, and record outcomes.
- Inspect tasks, follow logs, stop runs, and manage desktop startup through the CLI.

A **task** is registered work and its schedule. A **run** is one execution of that task, including any agents it requests. The task registry belongs to your OS user and is available from any directory.

Impulse is an early implementation for logged-in desktop sessions on Linux, macOS, and Windows. See [validation status](docs/implementation.md) for platform evidence and remaining release checks.

[Commands](#commands) · [Build and install](#build-and-install) · [Schedule your first task](#schedule-your-first-task) · [From scripts and agents](#from-scripts-and-agents) · [Automation essentials](#automation-essentials) · [More documentation](#more-documentation)

## Commands

Every public command is listed below. All support `--json`, and mutations run without prompts. `TASK` means a task name or ID; `RUN`, `AGENT_ID`, and `NOTIFICATION_ID` are IDs returned by Impulse. Brackets mark optional arguments. See the [CLI contract](docs/cli-contract.md#commands) for additional options and `impulse --help` for executable help.

### Task definitions and scheduling

| Command | What it does |
| --- | --- |
| `impulse task validate FILE` | Check a task definition and its references. |
| `impulse task preview FILE` | Show resolved paths and prospective execution times before registration. |
| `impulse task register FILE` | Register a task and start the scheduler. Use `--disabled` to register without enabling automatic runs. |
| `impulse task list` | List registered tasks. |
| `impulse task show TASK` | Inspect applied configuration, next run, source-file changes, and the latest run. |
| `impulse task update TASK` | Apply the edited definition. Use `--file FILE` to relink a moved definition while retaining task identity and history. |
| `impulse task rename TASK --name NAME` | Change the registered name while preserving identity, history, timing, and active runs. |
| `impulse task next [TASK] --after DURATION` | Set the next run relative to this request. Use `--at TIME` instead for a timestamp. Inside a run, omit `TASK` to target its task. |
| `impulse task disable [TASK]` | Disable future automatic runs while current work finishes. Inside a run, omit `TASK` to target its task. |
| `impulse task enable TASK` | Re-enable automatic runs. Use `--now` or `--at TIME` when explicit timing is needed. |
| `impulse task run TASK` | Request a manual run and return its ID. Rejects a task that already has active work; preserves explicit future timing unless `--reset-next` is supplied. |
| `impulse task remove TASK` | Unregister a task with no active run, preserving its source file and history. |

Editing a definition does not apply it: use `task update`. An update replaces upcoming configuration and timing; an older active run can finish but cannot issue new scheduling changes. Registration is idempotent by canonical source path, so registering the same file again does not apply edits or reset timing.

Use `impulse task rename indexing --name biomogging-google-indexing` to rename an existing task without replacing its registration. The new name must be unused. The task ID, source file, applied definition, enabled state, next run, and active run contexts stay unchanged. The registered name is local metadata, like `register --name`; changing the definition's `name` does not rename an existing registration. Update any scripts that look up the old name, or use the stable task ID. Retries can use `--request-id KEY` with the original arguments.

### Runs and logs

| Command | What it does |
| --- | --- |
| `impulse run list [--task TASK]` | List runs, optionally for one task. |
| `impulse run show RUN` | Inspect a run, its agents, outcomes, and events. Use `--current` instead of `RUN` inside a run. |
| `impulse run diagnose RUN` | Explain runner liveness, observed harness failures, missing evidence, recovery commands, and the preserved next schedule. Also accepts `--current`. Read-only. |
| `impulse run wait RUN` | Wait for the run to end; the exit code reflects its outcome. |
| `impulse run logs RUN [--follow]` | Read or follow execution logs. Use `--current` instead of `RUN` inside a run. |
| `impulse run stop RUN [--force]` | Request cancellation of the script and all its agents, including queued and nested requests. Future automatic runs remain enabled. |

`run stop` returns the current stopping/cancelled state; use `run wait` to wait for termination. Inspect a run before choosing `--force`. Stopping the CLI that is waiting for work does not cancel that work.

### Agent work

| Command | What it does | Required context |
| --- | --- | --- |
| `impulse agent request --instructions TEXT` | Request an agent and wait for its outcome. Alternatively use `--instructions-file FILE`; add `--no-wait` to continue immediately. | A script or agent executing in an Impulse run. |
| `impulse agent show AGENT_ID` | Inspect an agent's status and outcome. | None. |
| `impulse agent observe --file FILE` | Record optional structured harness progress or a terminal turn error. This never reports an assignment outcome. | Current agent. |
| `impulse agent wait AGENT_ID` | Wait for an agent's outcome. | None. |
| `impulse agent finish --outcome success\|failed --summary TEXT` | Report the current agent's own outcome and summary. | The executing agent's assignment. |
| `impulse agent handle AGENT_ID --reason TEXT` | Acknowledge recovery from a failed direct child, preserving its original failure in history. | The script or agent that requested that child. |

An agent request belongs to the current run, including with `--no-wait`. To launch independent agent work from outside a run, [register an agent task](#schedule-an-agent-directly).

### Setup, startup, and skills

| Command | What it does |
| --- | --- |
| `impulse setup --harness NAME --terminal NAME` | Apply supplied machine choices. Optional `--startup enable` and `--skill NAME` also configure login startup and install the selected skill. |
| `impulse config show` | Show applied machine settings. |
| `impulse config apply FILE` | Validate and apply a settings file. |
| `impulse doctor` | Inspect executable paths, configuration locations, harness, terminal, and agent capacity. |
| `impulse startup enable` | Enable desktop-login startup and start the scheduler now. |
| `impulse startup disable` | Remove login startup; current dispatch continues. |
| `impulse startup status` | Inspect login startup configuration. |
| `impulse daemon start` | Start scheduling dispatch. |
| `impulse daemon stop` | Stop dispatch while existing runners continue. |
| `impulse daemon status` | Inspect scheduler status. |
| `impulse skill install --harness NAME --scope user\|project` | Install the bundled agent skill. Use `--dir PATH` for an explicit destination. |
| `impulse skill uninstall --dir PATH` | Remove a verified Impulse-owned skill installation. |
| `impulse --help` | Show commands and options. |
| `impulse --version` | Show the executable version. |

### Recovery and housekeeping

| Command | What it does |
| --- | --- |
| `impulse run confirm-ended RUN --reason TEXT` | Record an operator's verification that uncertain execution and its external work have ended. Requires dead runners and never declares success. |
| `impulse agent resolve AGENT_ID --outcome success\|failed --reason TEXT` | Record an operator's outcome assertion for ended, unconfirmed agent work. |
| `impulse notification list` | Inspect notification delivery status. |
| `impulse notification retry NOTIFICATION_ID` | Explicitly redeliver a notification. |
| `impulse history prune [--task TASK]` | Preview eligible history/log cleanup. Add `--apply` to delete eligible records and logs. |

`run confirm-ended` and `agent resolve` are operator commands used outside a run context, after verifying what happened. See [recovery procedures](docs/operations.md#timing-failures-and-recovery).

Start a failure investigation with `impulse run diagnose RUN --json`. Supported Codex launches observe their private app-server; Claude Code 2.1.269+ uses session-scoped observation hooks. Older launches and custom harnesses retain their existing lifecycle behavior, and diagnostics identify unavailable evidence. Custom wrappers can opt into `agent observe`. A failed model turn raises an alert while execution remains tracked: tools and external work may still be running. No automatic retry, model change, or schedule change follows an observation.

## Build and install

Open the repository in its devcontainer, then run:

```sh
bun install --frozen-lockfile
bun run check
```

Impulse uses TypeScript, Bun, and local SQLite. The container pins its base image and Bun 1.4.1. A native checkout with that same Bun version can use the same commands. `dist/impulse` (`dist/impulse.exe` on Windows) is standalone; Bun is not required on the user's machine. Copy it to a stable location on your PATH before enabling startup. On Linux or macOS:

```sh
mkdir -p ~/.local/bin
cp dist/impulse ~/.local/bin/impulse
```

Choose a harness and a terminal available on your machine. For example, on Linux with Codex and Yakuake installed:

```sh
impulse setup --harness codex --terminal yakuake --non-interactive
impulse doctor
```

Built-in harnesses: `codex`, `claude-code`. Built-in terminals: `yakuake`, `konsole`, `terminal-app`, `windows-terminal`. [Custom profiles](docs/operations.md#custom-harnesses-and-terminals) support other setups through executable argument arrays.

Impulse uses the harness's existing login, tools, MCP configuration, and permissions. Before scheduling unattended work in a new project, open your harness there once and complete its login and project-trust setup. An optional host setting, `[trust] roots = ["/absolute/path/to/Projects"]`, authorizes built-in Codex and Claude Code launches to record project trust beneath that directory. See [setup and revocation](docs/operations.md#project-trust-for-unattended-starts).

To start at desktop login and teach your selected agent harness how to use Impulse:

```sh
impulse startup enable
impulse skill install --harness codex --scope user
```

Startup is opt-in. The installed [Impulse skill](skills/impulse/SKILL.md) teaches task definitions, scheduling, outcomes, and error handling.

## Schedule your first task

Every definition needs explicit first-run timing: `now`, `at`, `after`, or `schedule` for the next calendar occurrence. Omit `[schedule]` for one-off work. Paths such as `cwd` resolve relative to the definition's directory.

### Schedule a script

For an existing `index.sh`, keep `task.toml` beside the script:

```toml
schema_version = 1
name = "indexing"
cwd = "."

[work]
kind = "script"
command = ["bash", "./index.sh"]

[first_run]
kind = "after"
delay = "1h"

[schedule]
kind = "completion"
after = "24h"
```

```sh
impulse task validate task.toml
impulse task preview task.toml
impulse task register task.toml
impulse task show indexing
```

Registration starts the scheduler. This task is first due one hour after registration. Its next run is due 24 hours after the whole run succeeds, including any agents it requested. Command arrays do not expand shell syntax; select a shell explicitly when your script needs one.

### Schedule an agent directly

Put a definition in `.impulse/tasks/website-check.toml`:

```toml
schema_version = 1
name = "website-check"
cwd = "../.."

[work]
kind = "agent"
instructions = "Inspect the website with your configured tools and record the findings in the project."

[first_run]
kind = "schedule"

[schedule]
kind = "calendar"
cron = "0 9 * * *"
timezone = "local"
```

```sh
impulse task validate .impulse/tasks/website-check.toml
impulse task preview .impulse/tasks/website-check.toml
impulse task register .impulse/tasks/website-check.toml
```

This task runs daily at 09:00 in the computer's local timezone. Calendar schedules retain their clock time; use an IANA timezone to pin a zone. Five numeric cron fields support lists, ranges, steps, and wildcards. Missed occurrences coalesce to one catch-up run by default, and runs of the same task do not overlap.

The agent must [report its outcome](#report-an-agent-outcome). Reporting releases its capacity slot and lets the terminal remain open. The default global limit is 10 agents, configurable in settings. There is no automatic execution cutoff.

New built-in terminal tabs include the registered task name and a short assignment ID, for example `Impulse: website-check [b925a2b8]`. Long names are shortened and control characters removed from the title. Nested agents use the task's current registered name when launched. A rename affects future tabs; already-open tabs retain their launch title. Custom terminal adapters receive the name as `task_name` in their launch descriptor and can choose their own title.

## From scripts and agents

Scripts and agents use the same `impulse` CLI as you; scripts need no SDK. There are two situations: managing tasks independently, and controlling work already executing in an Impulse run.

### Schedule or update work independently

Any script or agent can inspect existing tasks and register a definition, even when it was not launched by Impulse:

```sh
impulse task list --json
impulse task validate task.toml --json
impulse task preview task.toml --json
impulse task register task.toml --json
```

After editing the definition, apply it with `impulse task update TASK --json`. Outside a run, supply a task name or ID when changing its schedule, for example `impulse task next indexing --after 24h --json`. Register a separate agent task for independent future work; `agent request` needs an existing run.

### Work inside an Impulse run

Impulse supplies a **run context** when it launches a script or agent. This associates the executing work with its task, run, and agent assignment, when applicable. The CLI reads it through `IMPULSE_CONTEXT`; identifiers are also available as `IMPULSE_TASK_ID`, `IMPULSE_RUN_ID`, and, for agents, `IMPULSE_AGENT_ID`. If a helper does not inherit the context, pass its supplied file path with `--context PATH`.

The following recipes run inside that context. `task next` and `task disable` target the current task; supplying another task's name is rejected. `agent finish` is for the current agent only. Scripts report their own success or failure through their exit code.

### Change the next run

```sh
impulse task next --after 24h --json
```

The delay starts when the request is accepted. Use `--at TIME` instead for an explicit timestamp. A confirmed change survives a later run failure or interruption. Scripts own application-specific waits such as quota cooldowns; they can postpone work without treating the wait as an error or requesting an agent.

### Disable future runs

```sh
impulse task disable --json
```

The current execution can finish. Use this when work is exhausted or future execution needs intervention. An operator can later use `impulse task enable TASK --now` to resume immediately. Changing the next run time alone does not re-enable a disabled task.

### Request an agent and wait

```sh
impulse agent request --instructions "Inspect the latest output and record your findings in the project." --json
```

Alternatively, use `--instructions-file ./followup.md`. The request uses the task's configured harness and terminal, waits by default, and returns the agent's ID, outcome, and summary. A script can branch on the [exit code](#automation-essentials). Impulse launches this work only when requested; it does not automatically dispatch a repair agent.

### Request an agent without waiting

```sh
impulse agent request --instructions-file ./followup.md --no-wait --json
# Replace AGENT_ID with data.id from the request's JSON result.
impulse agent show AGENT_ID --json
impulse agent wait AGENT_ID --json
```

`--no-wait` lets the requester continue while the agent remains part of the same run. The whole run stays active until all required work is resolved. A nested request made by an agent, including through its helper script, fails immediately with exit 5 when capacity is full; independent requests wait for capacity.

### Report an agent outcome

After completing its assignment, the agent reports its own result:

```sh
impulse agent finish --outcome success --summary "Reviewed the output and saved findings in review.md." --json
```

If the assignment failed, use `--outcome failed` with a truthful summary. Closing a terminal is not an outcome report; ended work without a report is unconfirmed. Once an assignment finishes, its old context cannot request more agents or change scheduling.

### Handle a failed child after recovery

If the requesting script or agent successfully completes a fallback for a failed direct child, it can acknowledge that recovery:

```sh
impulse agent handle AGENT_ID --reason "Completed the fallback review locally and saved the findings." --json
```

Use the child's returned ID and a reason describing the actual recovery. This preserves the failed outcome in history. An unhandled child failure prevents whole-run success, even if its script exits zero or its parent agent reports success. A child's success also does not erase its requesting script's failure.

### Inspect the current run

```sh
impulse run show --current --json
impulse run logs --current --follow
```

The run view includes agents, outcomes, and events. Following logs does not stop the run when you exit the viewer.

## Automation essentials

All commands accept `--json`. Ordinary commands write one JSON result to stdout with `schema_version`, `ok`, and either `data` or `error`. `run logs --follow --json` streams newline-delimited JSON. Mutations do not prompt for missing input; they return errors.

| Option or value | How to use it |
| --- | --- |
| `--context PATH` | Pass the run context file explicitly when a helper does not inherit `IMPULSE_CONTEXT`. |
| `--request-id KEY` | Retry a durable task, config, run, or agent mutation after uncertain delivery using the same key and identical input. Reusing a key with different input is a conflict. Startup and skill operations do not retain request receipts. |
| `DURATION` | Positive integer with `s`, `m`, `h`, or `d`, such as `30m` or `24h`. A day is 24 elapsed hours. |
| `TIME` | RFC 3339 timestamp with a UTC offset, such as `2027-01-15T09:00:00-05:00`. A newly supplied absolute next-run time must be in the future. |

Check the exit code as well as JSON: a successfully processed wait can return `ok: true` with a failed work outcome in `data`. Read-only inspection of failed work still exits 0.

| Exit code | Meaning |
| --- | --- |
| `0` | Command succeeded; waited-for work succeeded. |
| `1` | Unexpected internal error. |
| `2` | Invalid input or configuration. |
| `3` | Requested task, run, or agent was not found. |
| `4` | State conflict, such as changed configuration, a closed run, or an invalid context for the operation. |
| `5` | Nested agent capacity is full; no child was admitted. |
| `6` | Scheduler, launcher, or environment unavailable. |
| `10` | Waited-for work failed. |
| `11` | Waited-for work ended unconfirmed. |
| `12` | Waited-for work was interrupted or cancelled; inspect its structured status. |

Scheduling acknowledgments are durable only after the command succeeds. An older run's scheduling change can fail with `CONFIG_CHANGED` after an applicable update. See the [context rules](docs/cli-contract.md#run-context-and-authority) and [result contract](docs/cli-contract.md#results-and-exit-codes) for details.

For isolated experiments, set `IMPULSE_HOME=/path/to/isolated-home` outside an existing run context. Read-only commands do not start the scheduler; registering, updating, or manually running a task starts it if needed. History and summaries are retained indefinitely by default, logs for 30 days. Active and unresolved work is protected; project output files belong to the task.

## More documentation

- [CLI and task definition contract](docs/cli-contract.md): additional options, TOML fields, context rules, and structured results.
- [Operations](docs/operations.md): configuration, adapters, project trust, startup, recovery, and cleanup.
- [Agent skill](skills/impulse/SKILL.md) and [definition examples](skills/impulse/references/definitions.md): guidance installed into your selected harness.
- [Domain glossary](CONTEXT.md), [design specification](docs/spec.md), and [validation status](docs/implementation.md).

Contributions are welcome under the [MIT license](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md).
