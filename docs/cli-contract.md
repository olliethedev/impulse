# Proposed CLI and task definition contract

Contract supporting [the v1 spec](spec.md). The initial CLI implements the command surface below; see [implementation evidence and limitations](implementation.md) and `impulse --help` for the current executable. Release validation remains distinct from the design contract.

## Shared conventions

- Every command supports `--json`. Ordinary JSON mode writes one result to stdout and diagnostics to stderr. Follow operations use newline-delimited JSON events, documented as streaming output.
- All mutations run without prompts. Setup takes explicit options; required input missing from a command produces an error.
- Timestamps in structured output use RFC 3339 with a UTC offset. Relative durations accept positive integer `s`, `m`, `h`, or `d` units; `1d` is 24 elapsed hours. Calendar months are not durations.
- IDs are stable opaque strings, separate from user-facing task names. Examples use readable placeholders such as `run_123` and `agent_456`; they do not specify the ID-generation algorithm.
- Durable task, config, run, and agent mutations accept `--request-id KEY` for idempotent retry. Repeating the same key and payload returns the original accepted result; a different payload with that key is a conflict. The key is scoped to the caller/operation and retained with the mutation record. Startup and skill management are repeatable OS/filesystem operations; they do not retain request-key receipts.
- Read-only commands do not start the scheduler. Operator commands that register, update, or execute work start it if needed. Run-scoped callbacks can commit state through the shared local command layer without restarting deliberately stopped dispatch. Stopping an already stopped scheduler is an idempotent no-op.

## Commands

| Command | Meaning |
| --- | --- |
| `setup [--harness NAME] [--terminal NAME] [--startup enable] [--skill HARNESS] --non-interactive` | Apply supplied choices, optionally configure startup and install the skill. Omitted choices remain unchanged. |
| `config show` / `config apply FILE` | Inspect or validate/apply machine settings, including profiles, defaults, capacity, notification commands, and retention. |
| `startup enable` / `disable` / `status` | Manage only Impulse's per-user login entry. Enabling also starts the scheduler now; disabling the entry does not stop the current scheduler. |
| `daemon start` / `stop` / `status` | Manage dispatch. Stop preserves ongoing runners; run cancellation is separate. |
| `skill install --harness HARNESS --scope user\|project` | Install the bundled skill into a selected, supported environment. `--dir PATH` supports an explicit other destination. |
| `skill uninstall --dir PATH` | Remove only a verified Impulse-owned installation. Modified files require an explicit replacement/removal choice. |
| `doctor` | Inspect selected executable paths, platform, settings, state access, and scheduler health. Does not launch an agent. |
| `task validate FILE` | Validate a definition and references without registration or execution. |
| `task preview FILE [--at TIMESTAMP]` | Show resolved working directory, schedule, and prospective first occurrences without activating anything. |
| `task register FILE [--name NAME] [--harness NAME] [--terminal NAME] [--disabled]` | Register a source definition and local execution overrides. Return identity, revision, effective choices, and next time. |
| `task update TASK [--file FILE] [--harness NAME] [--terminal NAME]` | Apply the source file or explicitly relink it, retaining identity/history and replacing upcoming configuration/timing. |
| `task rename TASK --name NAME` | Change only the registered name. Preserve task ID, history, source/applied definition, revision, enabled/held state, next time and active contexts. Reject a conflicting or empty name. |
| `task list` / `task show TASK` | Inspect applied state, source path, source drift, latest run, and why the next execution is due, queued, disabled, or awaiting intervention. |
| `task next [TASK] --at TIME` / `--after DURATION` | Replace the next scheduled execution. Omit TASK only within a valid run context. |
| `task disable [TASK]` | Disable future automatic execution without stopping current work. |
| `task enable TASK [--now\|--at TIME]` | Re-enable; use explicit timing when a non-calendar task lacks an eligible saved future time. |
| `task run TASK [--reset-next]` | Request one manual run and return its run ID. Reject if the task already has an active run. Preserve explicit future timing unless reset. |
| `task remove TASK` | Unregister a task with no active run. Preserve historical records and the source file. |
| `run list [--task TASK]` / `run show RUN\|--current` | Inspect execution and its script/agent tree, outcomes, scheduling instructions, and event history. |
| `run wait RUN` | Wait for a terminal execution state. Interrupting the waiting CLI does not cancel the run. |
| `run logs RUN\|--current [--follow]` | Read Impulse-owned logs. `--follow --json` streams events. |
| `run stop RUN [--force]` | Commit cancellation intent and request termination of all owned work. Return the current stopping/cancelled state; `run wait` can wait for actual termination. |
| `run confirm-ended RUN --reason TEXT` | An operator confirms that uncertain/stopping execution and its external work have ended. Requires dead runners; records interruption or unconfirmed work, never success. |
| `agent request --instructions TEXT\|--instructions-file FILE [--no-wait]` | Request an agent within the current run. Wait for its reported outcome by default. |
| `agent show ID` / `agent wait ID` | Inspect or wait for a previously requested agent. |
| `agent finish --outcome success\|failed --summary TEXT` | The current agent submits its own explicit outcome. |
| `agent handle ID --reason TEXT` | A requester marks its failed direct child's failure as handled. The failure remains in history. |
| `agent resolve ID --outcome success\|failed --reason TEXT` | An operator resolves an ended, unconfirmed assignment with an auditable assertion. This cannot make still-live or cancelled work successful. |
| `notification list` / `notification retry ID` | Inspect delivery outcomes or explicitly redeliver a notification. |
| `history prune [--task TASK] [--apply]` | Preview eligible cleanup by default; `--apply` deletes only selected eligible Impulse-owned records/logs. Automatic retention uses the same eligibility rules. |

Task-local harness/terminal overrides can be cleared explicitly using `--clear-harness` and `--clear-terminal` on update. These choices are stored locally, not written into the shared definition.

## Identity and definition application

The registry keys a definition's canonical source path to a generated task ID. A repeated registration of that path returns the existing identity without reapplying changed contents or resetting initial timing. A name collision from a different path is an error with instructions to choose another local name. An explicit update can relink a moved file without losing history.

`task rename` changes local registration metadata, like the name selected with `register --name`; it does not edit the source or its applied definition and does not increment the configuration revision. Name validation, the rename event and any request receipt commit together. The same-name operation is a no-op. Active runs keep working and can still use their contexts for scheduling and outcomes. A context-bearing rename may target only that context's task. Use the stable task ID in integrations that must survive a rename. Existing notification records and open tabs retain their recorded names; new notifications and launches use the current registered name.

New launch descriptors include optional `task_name` metadata for custom terminal/harness adapters. Built-in terminals title new agent tabs `Impulse: TASK NAME [SHORT ASSIGNMENT ID]`, with control characters removed and long names shortened. Descriptors without a task name fall back to the execution kind and short ID. Terminal titles are data and never part of the runner's shell command. Windows Terminal arguments escape its semicolon command separators; Konsole titles display semicolons as `；` because its profile-property parser has no escaping mechanism.

Resolve `cwd` and configuration file references relative to the definition's directory, never the CLI's invocation directory. Resolve the executable and runtime arguments from that working directory/environment according to their normal process semantics. No shell expansion occurs inside command arrays; a script needing shell syntax explicitly selects its shell as the executable.

Read and retain instruction-file contents when registering/updating a definition, since those instructions are configuration. Do not snapshot executable scripts or project source. The registered task continues using its applied configuration even when its editable source changes; a missing executable at execution is a visible launch failure.

Successful updates increment the applied revision and replace future scheduling state atomically. The first claimed execution and each current assignment retain a configuration snapshot. Update and admission share a transaction boundary: work already admitted belongs to the old run; queued future task occurrences use the new configuration. Queued child requests already belonging to an active run retain that run's snapshot.

Changing effective machine profiles/defaults also creates a new effective revision for affected future work. Existing assignments finish with their snapshot. The runtime rejects run-scoped scheduling mutations when that snapshot is no longer current.

## TOML schema version 1

```toml
schema_version = 1
name = "daily-website-check"
cwd = "../.."

[work]
kind = "agent"
instructions = "Inspect this project's website using the configured harness tools."

[first_run]
kind = "schedule"

[schedule]
kind = "calendar"
cron = "0 9 * * *"
timezone = "local"

[policy]
catch_up = "once"
overlap = "skip"
hold_after_interruption = false

[notifications]
on_success = false
```

| Field | Rules |
| --- | --- |
| `schema_version` | Required integer, initially 1. Unknown versions and unknown fields are validation errors. |
| `name` | Required nonempty default registration name. `register --name` supplies a local alternative. |
| `cwd` | Required directory path, relative to the definition or absolute. Absolute paths reduce portability. |
| `work.kind` | `script` or `agent`. Exactly one work type. |
| Script work | Required nonempty `work.command` string array. No `instructions` fields. |
| Agent work | Exactly one of `work.instructions` and `work.instructions_file`, both nonempty strings. No `command` field. |
| `first_run.kind` | Required: `now`, `at`, `after`, or `schedule`. |
| First-run payload | `at` requires an offset-bearing RFC 3339 string `at`; `after` requires `delay`; `schedule` requires a calendar recurrence. Reject unrelated variant fields. |
| `schedule` | Omit for a one-off task; otherwise choose `calendar` or `completion`. |
| Calendar | `cron` has five numeric fields, supporting wildcards, lists, ranges, and steps. If both day-of-month and day-of-week are restricted, either may match. No seconds, random fields, or nonstandard macros in v1. `timezone` defaults to `local` or uses an IANA name. |
| Completion | Positive `after` duration; no calendar/timezone fields. |
| `policy.catch_up` | `once` (default) or `skip`. |
| `policy.overlap` | `skip` (default) or proposed `queue_one`. Both prevent simultaneous runs of the task. |
| `policy.hold_after_interruption` | Boolean, default false. |
| `policy.interruption_retry` | Optional table: `enabled` (false), `max_attempts` (1), `delay` (`5m`). Retry attempt count is durable per interrupted occurrence chain. |
| `retention` | Optional task overrides: `history` and `logs`, each `forever` or a positive duration. Defaults come from user settings; built-in defaults are history forever and logs 30 days. Summaries follow history. |
| `notifications` | Optional `on_success`, `on_failure`, and `on_interruption` booleans. Defaults: false, true, true. Delivery destinations remain local settings. |

`first_run.kind = "after"` persists its resolved due time at registration. On an update before initial execution, its anchor remains the original registration time. A fresh absolute timestamp must not already be past when accepted; the preview shows the actual computed time.

Disabling is runtime state rather than an `enabled` default in a shared definition. Registration can explicitly start disabled. Definition updates preserve that state; `task enable` changes it. One-off completion means no automatic next execution, rather than deletion or an implicit disabled flag.

## Run context and authority

The runner supplies `IMPULSE_TASK_ID`, `IMPULSE_RUN_ID`, and, for agents, `IMPULSE_AGENT_ID`, plus a private context-file location. Scripts need no SDK. Run-scoped commands infer their target from that context and return identifiers in every result.

The context identifies the requester's role, parent, and starting revision. Reschedule/disable operations target the current task, and fail with `CONFIG_CHANGED` after an applicable update. Cancelled or terminal run contexts receive `RUN_CLOSED`. A context-bearing request cannot silently mutate a different task by providing its name. Independent task registration remains available to agents through the ordinary user CLI.

Outcome submission is scoped to the current agent. A requester can handle only a failed direct child; handling a failure requires a reason and does not rewrite that child's original outcome. A child created by an agent remains nested when the agent launches it through a helper script.

These controls protect execution bookkeeping and accidental cross-run updates. Impulse runs as the local user; it does not claim to sandbox arbitrary trusted scripts against other files or credentials that user can access. Harness permissions remain the execution authority.

## Results and exit codes

An accepted scheduling instruction returns the updated task. Relevant fields are shown here; other task fields are omitted:

```json
{
  "schema_version": 1,
  "ok": true,
  "data": {
    "id": "task_123",
    "revision": 4,
    "next": {
      "at": "2026-09-05T13:13:00.000Z",
      "source": "explicit"
    }
  }
}
```

Example rejected instruction from an older run:

```json
{
  "schema_version": 1,
  "ok": false,
  "error": {
    "code": "CONFIG_CHANGED",
    "message": "This run uses revision 4; revision 5 is applied",
    "retryable": false
  }
}
```

| Exit | Meaning |
| --- | --- |
| 0 | Operation succeeded; for a wait operation, the work succeeded. |
| 2 | Invalid input or configuration. |
| 3 | Task, run, request, or source not found. |
| 4 | State conflict, such as `CONFIG_CHANGED`, `RUN_CLOSED`, or `TASK_ACTIVE`. |
| 5 | Capacity unavailable for a nested request. No child was admitted. |
| 6 | Scheduler/launcher/environment unavailable. |
| 10 | A waited-for assignment or run reported failure. |
| 11 | A waited-for assignment or run ended unconfirmed. |
| 12 | A waited-for assignment or run was interrupted or cancelled; the structured status distinguishes these. |
| 1 | Unexpected internal error. |

An inspection of failed work is still a successful read with exit 0. A waiting request that receives a failed outcome returns exit 10 but includes the agent ID, outcome, and summary in `data`; `ok` remains true because the request was processed. A rejected launch uses `ok: false` and no admitted child ID. Preserve raw script exit codes separately from the CLI's exit-code vocabulary.

## Agent lifecycle examples

```sh
# The current script/agent asks for a child and waits.
impulse agent request --instructions-file ./followup.md --json

# Or request it without waiting and use the returned ID later.
impulse agent request --instructions-file ./followup.md --no-wait --json
impulse agent wait agent_456 --json

# The child completes its own assignment.
impulse agent finish --outcome failed --summary "Could not complete the requested analysis." --json

# Its requester completes a fallback and acknowledges that child's failure.
impulse agent handle agent_456 --reason "Completed the fallback analysis locally." --json
```

The first valid outcome closes that assignment. Repeating the identical outcome is idempotent; a different later outcome is rejected. An assignment that has finished cannot launch more children or mutate scheduling using its old context. Further conversation in its retained terminal is outside that completed assignment.

A parent can finish its own assignment while children continue, but the run remains active until all required work is resolved. The parent's slot can be released while unresolved descendants retain their own slots. An unhandled child failure prevents overall success even if the script exits zero or its parent reports success. Script failure is not repaired merely by a child's success; the script must handle its own error and finish successfully.

Once all work has ended, an unconfirmed child makes the run unconfirmed unless a stronger explicit terminal condition such as cancellation or failure applies. All component outcomes remain visible. Manual resolution is recorded as a separate operator assertion; if it establishes the current run's successful completion, use the resolution time as its new completion anchor. Resolving an older historical run never rewinds a newer schedule.

## Setup, profiles, and skill packaging

Proposed built-in harness names: `codex`, `claude-code`. Terminal names: `terminal-app`, `windows-terminal`, `konsole`, `yakuake`.

Local settings have schema version 1 with tables for `defaults`, `limits`, `retention`, `notifications`, `harnesses`, `terminals`, and optional `trust`. The `trust.roots` array opts into exact project trust for built-in agent launches under approved absolute directories; it defaults off and cannot be set in task definitions. See [project trust](operations.md#project-trust-for-unattended-starts). Custom harness and terminal entries use an executable/argument array with a whole-argument `{launch_file}` placeholder. That JSON file carries the resolved instructions or runner invocation and working directory; it is not evaluated as shell source. A terminal wrapper must start the specified Impulse runner, and a harness wrapper must keep the real assignment observable until its outcome or termination. See [the adapter boundary](runtime-design.md).

The planned `skills/impulse/SKILL.md` uses the standard skill entrypoint with name/description frontmatter, concise workflow instructions, and supporting references only for the command and schema details that are needed. Installation targets selected harnesses or an explicit directory; do not install into every detected environment. Record ownership/version and do not overwrite user modifications silently.

The skill should teach agents to inspect existing tasks before registering, select first-run timing explicitly, validate definitions, apply updates, interpret JSON/exit codes, distinguish quota waits from errors, and report outcomes. Scheduling future work remains available to an agent even when nested immediate-launch capacity is full. The skill does not grant permissions beyond the user's task or the harness's controls.

The repository skill and bundled version must match the released CLI contract. The installable skill now lives at `skills/impulse/SKILL.md` and is embedded in the standalone binary.
