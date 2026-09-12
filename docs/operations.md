# Operations and adapters

## Local configuration

`impulse doctor --json` shows the selected profiles, executable locations, and state/config directories. Linux follows XDG config/state directories; macOS uses `~/Library/Application Support/Impulse`; Windows uses roaming config under `%APPDATA%` and local state under `%LOCALAPPDATA%`. `IMPULSE_HOME` isolates both roots beneath an explicit directory.

`setup --harness codex --terminal yakuake --non-interactive` writes applied settings and an editable `settings.toml`. To change settings, edit that file and run `config apply FILE`. SQLite retains the applied snapshot, so partially editing TOML never changes running behavior. `config show` is authoritative if a file write failed after application. Task-local `--harness` and `--terminal` overrides are stored separately from shareable definitions.

```toml
schema_version = 1
[defaults]
harness = "codex"
terminal = "konsole"
[limits]
agents = 10
[retention]
history = "forever"
logs = "30d"
[notifications]
desktop = true
```

Definitions for non-project agent work can live under the configuration directory's `tasks/` folder. Create this folder as needed. Project definitions normally live in `.impulse/tasks/`; script definitions normally sit next to the script.

Commands select an executable and arguments without an implicit shell. For Windows batch files, select `cmd.exe` explicitly and put the shell source in one final argument: `command = ["cmd.exe", "/d", "/c", '"C:\path with spaces\job.cmd" "argument value"']`. Impulse preserves that source for cmd's parser. PowerShell scripts can use an ordinary `powershell.exe -NoProfile -File` argument array.

## Project trust for unattended starts

Codex and Claude Code can stop at a workspace trust dialog the first time an agent starts in a new project. Tool approval and sandbox settings are separate. To authorize automatic project trust for a directory tree, add this to the **host's Impulse settings**, then run `impulse config apply FILE --json`:

```toml
[trust]
roots = ["/absolute/path/to/Projects"]
```

This is opt-in and defaults to no roots. Paths must be existing absolute directories; application stores their canonical paths. Built-in agent runners check the current host setting after claiming their ticket and before starting the harness. Scripts and custom harness profiles do not use this step. The setting also applies to existing tasks on their next launch without changing their schedules.

For a task inside an approved root, Impulse adds exact trust entries using [Codex's `projects.<path>.trust_level`](https://learn.chatgpt.com/docs/config-file/config-reference) or [Claude Code's `projects["<path>"].hasTrustDialogAccepted`](https://code.claude.com/docs/en/permissions#project-allow-rules-and-workspace-trust). Codex gets its working directory and repository root; Claude gets its repository root, its main checkout for a worktree, or the working directory outside Git. All directories receiving trust must remain within approved roots. Symlinks cannot expand that scope. Outside the roots, the harness follows its normal trust flow.

Configuration targets are `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`) and `$CLAUDE_CONFIG_DIR/.claude.json` (default `~/.claude.json`). The original configuration gets a private `.before-impulse-trust` backup before the first change. Updates preserve other settings, use an atomic replacement, serialize Impulse writers, and abort if they detect another writer changed the file. Ordinary new Codex entries preserve comments; existing inline or incomplete project tables may require TOML reserialization. Existing explicit trust values other than trusted, including Claude's `false`, require a manual decision and are never overwritten automatically. Parse errors and lock conflicts stop setup with an actionable error.

Removing a root prevents future automatic additions; it does not revoke trust already stored in the harness. Revoke individual entries in the harness configuration explicitly. Do not restore an old whole-file backup over newer unrelated settings. This feature grants workspace trust only: authentication, tool permissions, MCP approvals, managed policies, and any other onboarding remain controlled by the harness.

## Custom harnesses and terminals

Profiles are local settings. Impulse never interpolates prompts into shell source. The `{launch_file}` placeholder must occupy an entire argument after the executable.

```toml
schema_version = 1
[defaults]
harness = "my-agent"
terminal = "my-terminal"
[harnesses.my-agent]
command = ["/path/to/agent-wrapper", "{launch_file}"]
lifecycle = "process"
[terminals.my-terminal]
command = ["/path/to/terminal-wrapper", "{launch_file}"]
```

The JSON descriptor has `schema_version`, `runner.command` (argument array), `runner.cwd`, `instructions`, `context_file`, and execution profiles. A terminal wrapper must create a fresh session and start `runner.command` in `runner.cwd`. A harness wrapper receives instructions as data and must remain alive until the assigned execution ends. It inherits `IMPULSE_CONTEXT`, `IMPULSE_RUN_ID`, `IMPULSE_TASK_ID`, and `IMPULSE_AGENT_ID`. Helpers may pass `--context PATH` explicitly.

`lifecycle = "process"` asserts that ending the wrapper ends its assigned work. Use `external` for a shared/background harness whose work may continue after its frontend exits. Impulse then holds uncertain execution instead of releasing capacity or claiming cancellation. Custom wrappers are trusted local programs, not a sandbox; they must honor their declared lifecycle.

Built-in Codex on POSIX systems with `--remote` support gets a private app-server socket and backend process. This keeps it separate from the user's shared daemon. Older Codex versions use their ordinary CLI; versions advertising shared execution without an isolated transport are treated as external. On Windows, shared-daemon Codex currently requires a custom wrapper with scoped lifecycle controls for fully observable cancellation. No built-in adapter changes harness approval or sandbox settings.

Yakuake uses D-Bus to create a fresh session. If its bus owner is a Flatpak, the runner is invoked with `flatpak-spawn --host --watch-bus`. This requires the Flatpak to allow host spawning and to expose the configured paths. It never reuses an existing terminal session. Konsole, Terminal.app, and Windows Terminal have separate launch adapters. Terminal apps may request their normal OS automation permissions.

## Timing, failures, and recovery

Start with `impulse run diagnose RUN --json`. Diagnosis shows each component's
recorded runner identity, current PID/boot check, heartbeat and observation ages,
latest harness progress, retained prior failure, reported outcome, and conditional
recovery commands. It also shows the task's actual enabled/held state, next time,
and all active runs blocking replacement. Diagnosis does not start dispatch,
change state, or probe arbitrary transcript directories. Historical launches may
have no observation evidence; the tool reports that limitation explicitly.

The Codex adapter observes only the private Unix app-server it launched, with
read-only session/turn queries approximately every five seconds. Paginated turn
reads fall back to the older `thread/read` interface. Session discovery must match
the exact assignment prompt. A missing or incompatible protocol is reported as
unavailable, without affecting the harness. On Windows and older/shared Codex
launch paths, the existing process/external lifecycle remains the available
evidence. Observation stops after an explicit assignment outcome.

Claude Code 2.1.269 and later receives an Impulse-owned, session-only settings file
with `SessionStart`, `UserPromptSubmit`, `Stop`, and `StopFailure` command hooks.
Hooks use an argument array, verify the expected session, and return no decisions.
No user settings file is edited. Existing hooks merge according to Claude's
settings rules; managed restrictions and disabled hooks remain respected. Older
versions continue through process-level observation. If hooks do not fire,
diagnosis reports missing evidence rather than assuming progress.

Harness errors generate an actionable notification when failure notifications
are enabled, while the run remains tracked. Notifications contain no raw error
text; detailed errors stay in private run evidence. A failed turn may still have
running tools. Idle sessions and zero observed tools do not prove external work
has ended. Current observation can become unavailable without losing the last
recorded failure. Observations never trigger automatic retries, change models,
or override explicit task timing.

Custom harnesses may optionally report the same progress contract:

```json
{
  "state": "failed",
  "session_id": "wrapper-session-id",
  "turn_id": "turn-id",
  "error": { "code": "overloaded", "message": "Provider rejected the turn" }
}
```

```sh
impulse agent observe --file observation.json --json
```

The file is limited to 16 KiB. States are `active`, `idle`, `failed`, and
`unavailable`. Only `failed` requires/allows `error` (`code`, `message`). Optional
fields are `session_id`, `turn_id`, `note`, and nonnegative `active_tools`; omit
the tool count when unknown. Unknown fields are rejected. Do not put credentials,
prompts, tool arguments or outputs in observations. The current agent context is
required; closed/cancelled assignments reject updates. Reporting an observation
never substitutes for `agent finish`. Both custom `process` and `external`
lifecycles retain their existing termination rules.

`task next --after 24h` commits a new time at the moment of the request. Its future execution survives the current run failing. A subsequent task/config profile update replaces upcoming timing and rejects scheduling callbacks from older revisions. `disable` persists across updates; changing the next time does not implicitly enable a disabled task.

A script's zero exit code and successful agent outcomes are all needed for whole-run success, except failures explicitly handled by their requester. Report an agent outcome with `agent finish --outcome success|failed --summary TEXT`. Reporting ends the assignment; the terminal can remain open. Closing an agent terminal without reporting yields unconfirmed work only when its lifecycle establishes that execution ended.

Inspect `run show RUN`, `agent show ID`, and `notification list`. `agent resolve ID --outcome success|failed --reason TEXT` records an operator assertion for ended, unconfirmed work. It cannot resolve still-live or uncertain execution. A scheduler crash does not terminate runners. Ambiguous runner loss holds the task and capacity rather than duplicating work; a reboot positively establishes interruption. After independently verifying that all owned/external work has ended and closing its runner, `run confirm-ended RUN --reason TEXT` records your assertion and moves uncertain work to interrupted/unconfirmed (or cancelled) status. It never declares success. Opt-in interruption retry is bounded by its configured attempt count and preserves an explicit next time.

`run stop RUN` commits cancellation intent, rejects new callbacks, cancels queued descendants, and asks owned execution to terminate. It leaves future schedules enabled. If graceful stopping is ineffective, inspect the run before choosing `--force`. There is no automatic escalation or runtime limit. External harness execution remains uncertain until its lifecycle can be established; do not kill shared servers to clear it.

Relative waits use a clock that includes suspend: Linux `/proc/uptime`, Windows boot uptime, and macOS `CLOCK_MONOTONIC_RAW` through a narrow scalar FFI call to libSystem. macOS uses its boot-session UUID rather than a wall-clock-derived boot time. Native validation is tracked separately. Across a reboot, only persisted wall time is available; Impulse does not invent elapsed-time evidence. Explicit absolute times always follow wall time. See the [Linux clock documentation](https://www.man7.org/linux/man-pages/man5/proc_uptime.5.html), [Windows time documentation](https://learn.microsoft.com/en-us/windows/win32/sysinfo/windows-time), and [Apple's implementation](https://github.com/apple-oss-distributions/Libc/blob/main/gen/clock_gettime.c).

Calendar DST gaps catch up at the first valid minute unless skipped by policy; repeated fall-back times run only once. Local-zone changes recalculate future calendar times. Calendar overlap defaults to skipping with an event; `queue_one` retains one pending occurrence. Missed downtime never creates an unbounded backlog.

## Login startup and stopping

Enable startup only after placing the executable at a stable path on the host. `startup enable` writes an Impulse-owned Linux desktop entry, macOS LaunchAgent, or Windows interactive logon task, and starts dispatch now. The Windows task disables execution-time and battery cutoffs. No administrator service is installed.

`startup disable` removes only the owned entry and leaves current dispatch running. `daemon stop` deliberately stops dispatch while runners continue recording callbacks. `daemon start`, registering, updating, or manually running a task starts dispatch again. Read-only inspection does not start it. The login supervisor restarts a failed scheduler while respecting a deliberate stop.

## Notifications and cleanup

Notifications are durable events separate from work outcomes. Failures and interruptions notify by default; successes are opt-in per task. Desktop delivery depends on the OS environment. A local `[notifications].command` array receives a JSON event on stdin and can integrate another service. Delivery failure never changes the work result or recursively requests repair. `notification retry ID` explicitly redelivers.

`history prune` previews cleanup, and `--apply` executes it. Automatic cleanup uses the same eligibility rules. Active/unconfirmed/uncertain work is protected; the latest run remains available as a scheduling anchor. Cleanup only touches Impulse-owned records and paths, never project outputs. Keep state on a local filesystem; copy a consistent SQLite backup when backing up active WAL state.

## Indexing migration

The reference desktop's Google indexing automation is now registered as a local Impulse script task. Its application-specific coordinator, recovery prompt, ledger, and browser profile stay outside the OSS repository. The accepted migration contract and validation boundaries are in [indexing-migration.md](indexing-migration.md).

The coordinator reserves attempts before requesting indexing, treats quota pauses as expected completion, and requests one agent for unexpected failures. Normal recurrence begins 24 hours after the whole run succeeds, including any recovery agent. Unresolved repair disables the task, saves intervention instructions, and requests a persistent critical notification through a local delivery adapter. An uncertain agent produces a durable alert while its execution and capacity remain held for inspection.

For other installations, preserve the existing ledger, cooldown, and request-window identity; validate the wrapper against copied fixtures before switching scheduler ownership. Remove or disable the old startup entry before registering the replacement. Keep a rollback copy locally and never submit indexing requests as part of fixture tests.
