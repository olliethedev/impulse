# Impulse design interview

Status: interview complete; implementation authorized and underway. This document records agreed decisions and the earlier open branches. See [the specification](spec.md) for the consolidated target and [implementation evidence](implementation.md) for current validation.

## Stated intent

- Build a CLI for macOS, Windows, and Linux.
- Publish Impulse as open-source software for other people's setups, with configurable harness and terminal choices. Codex and Yakuake are the first local configuration, not universal requirements.
- Register scripts for recurring execution.
- Support recurring agent work directly, such as a daily 9 a.m. website report.
- Support one-off script or agent tasks as well as recurring work.
- Configure the agent harness and terminal ahead of time. The first local setup uses Codex and Yakuake; Claude Code is another intended harness example.
- Allow scripts to launch agents with instructions for any task-specific work. Repairing a script failure is one example; reporting, analysis, and other follow-up work are equally valid.
- Start automatically at user login in the first release; the installation mechanism is undecided.
- Support both a fixed daily time and timing relative to work performed, such as a delay after the last indexing submission.
- Make scheduling durable and friendly to agents, with installable skill documentation. The skill package shape and CLI contract remain undecided.
- Keep generated content owned by scripts and agents. Impulse tracks execution status, outcome summaries, and logs; it has no built-in report management feature.
- Use the existing Biomogging indexing automation as the first migration candidate and a daily Biomogging report using Vercel MCP as a second example.
- Interview and record decisions before implementing.
- Use a devcontainer for reproducible builds and a consistent development environment.

## Agreed decisions

### Execution environment and audience

The first release runs within a logged-in desktop session and starts at login. Schedules persist across restarts. Execution before login and on headless machines is outside the first-release scope. See [the execution scope decision](adr/0001-desktop-session-execution.md).

Impulse is an open-source product for macOS, Windows, and Linux users with different setups. Scheduling must not depend on Codex, Yakuake, or the current machine's particular desktop. Harness and terminal choices are configurable and independent; the initial built-in integrations are listed below.

### Managing login startup

Impulse provides CLI operations to enable, disable, and inspect per-user login startup. The user explicitly enables startup once; Impulse then starts automatically at future logins. Manual setup documentation provides a fallback for other setups.

Platform mechanisms, command names, supported setup detection, and the relationship between startup settings and starting or stopping the current scheduler process remain open. The status operation must make the startup configuration inspectable.

### Scheduling process

One background Impulse scheduler handles all registered tasks for the OS user. It manages due times, catch-up behavior, execution, and agent tracking. The OS launches the scheduler at login when startup is enabled; the CLI submits execution requests to Impulse's scheduling system.

Use the same scheduling implementation across macOS, Windows, and Linux, with platform integrations for startup and terminal launching. See [the scheduler decision](adr/0008-one-background-scheduler-per-user.md). The communication mechanism, database writer ownership, and duplicate-process prevention remain open.

### Starting the scheduler from the CLI

Commands that register, update, or execute work automatically start the user's scheduler if it is stopped, then submit their request. Read-only status, task listing, and history inspection leave it stopped. Starting the scheduler resumes processing due tasks under the agreed catch-up policy.

Starting it for a command does not itself enable login startup, which remains an explicit user choice. Exact start/stop command semantics, database ownership, and restart reconciliation will be proposed in the draft spec for review.

### Distribution

Impulse ships as a standalone executable for each supported operating system, without requiring a separately installed programming-language runtime to run Impulse. Package-manager distribution is an additional option; the initial channels remain to be selected.

Supported OS versions and architectures, signing, and the release process remain open. [The packaging feasibility notes](packaging-notes.md) record the toolchain research supporting standalone distribution. User scripts and agent harnesses retain their own installation requirements.

### Implementation language

Build Impulse in TypeScript using Bun. The user's familiarity with TypeScript is the deciding factor, and Bun's standalone executable support fits the agreed distribution model. See [the language decision](adr/0006-typescript-with-bun.md).

The Bun version, dependencies, and internal architecture remain to be selected. Registered script tasks use their selected executable or interpreter; the implementation language choice applies to Impulse itself.

### Development environment

The project uses a devcontainer for reproducible builds and consistent development environments, as requested by the user. The concrete image, toolchain pins, lockfiles, and CI workflow are proposed in the draft spec. Native desktop integration still needs validation on each supported OS.

### Setup and agent skill installation

After installing Impulse, a setup command configures the user's harness and terminal and optionally enables login startup and installs the agent skill into selected environments. Each operation is also available independently and noninteractively.

The repository includes an independently installable skill package with a `SKILL.md` entrypoint for other setups. The skill documents durable task registration, updates, scheduling changes, agent requests, outcome tracking, and inspection through the same CLI. Command names, install targets, release channels, and package contents are specified as proposals in the consolidated spec; no skill has been installed during this interview.

### Harness and terminal extensions

Impulse provides built-in integrations for selected common setups and lets users configure additional harnesses or terminals through launch commands or wrapper scripts without changing Impulse's code. Harness and terminal choices remain independent. Custom harness integrations use the same explicit agent outcome-reporting contract.

The first release includes Codex and Claude Code harness integrations, Terminal.app on macOS, Windows Terminal on Windows, and Konsole plus Yakuake on Linux. Users of other setups can configure launch commands or wrapper scripts. This is the agreed release scope, not a claim that these integrations have been implemented or tested; see [integration notes](integration-notes.md).

The launch interface, process tracking, supported versions and platform combinations, and configuration representation remain open. This decision does not require a plugin SDK.

### Harness configuration ownership

Authentication, MCP connections, and agent permissions remain under the harness's own configuration and controls. Impulse supplies the task's instructions, working directory, configured launch options, and outcome-reporting context.

For example, the website report uses Vercel MCP configured in the selected harness. Impulse does not introduce a separate MCP or authentication configuration system. Integrations must use the selected harness's supported configuration mechanisms; launching a harness does not by itself establish which settings it inherits. Reusable launch profiles and the representation of launch-option overrides remain open.

### Execution defaults and task overrides

The user configures default harness and terminal choices. Each registered task can independently override either choice or both. These selections stay in local configuration, allowing shared task definitions to use each person's own setup.

For example, most tasks can use Codex and Yakuake while a particular task selects another harness, another terminal, or both. Naming and reusable profiles remain open.

### Task registry and working directories

Impulse maintains one task registry per OS user. Listing and managing registered tasks is available from any directory, and each task specifies its own working directory. This lets the indexing automation and website report run in different project folders while appearing in the same task list.

Task naming and identity remain open. CLI command names and the database schema are not yet fixed.

### Runtime storage

Use one local SQLite database per OS user for the task registry and live state: registered configuration, next run times, active-run records, and history. Editable task definitions remain in their agreed TOML locations. CLI inspection commands expose the stored state for debugging.

Use Bun's built-in SQLite support. See [the storage decision](adr/0007-local-sqlite-runtime-state.md). Database paths, schema, durability settings, coordination between CLI and scheduler, and backup behavior remain open. This database stores Impulse's state; scripts own their application-specific data, such as the indexing ledger.

### History and log retention

By default, retain run history and outcome summaries until explicitly deleted. Prune Impulse-owned detailed execution logs 30 days after the run ends. Make retention configurable globally and per task, including indefinite log retention.

Preserve all data for active runs. This policy applies to Impulse-owned records and logs; scripts and harnesses own their application data and output files. Exact cleanup commands, storage accounting, and retention settings will be proposed in the draft spec for review.

### CLI output and interaction

CLI commands produce readable text by default and support `--json` for structured output. Every operation is available without interactive prompts. Structured results provide consistent identifiers, outcomes, and predictable exit codes through the same commands used by people, scripts, and agents.

Guided setup is an optional convenience. The installable agent skill documents noninteractive commands and JSON results. Exact commands, result schemas, error formats, streaming output, and the skill package remain open.

### Run records and notifications

Save execution status and outcome summaries with each run, with history and execution logs accessible through the CLI. Use desktop notifications for unhandled failures and interruptions by default. Success notifications are configurable per task.

Users can configure a notification command or script for destinations such as email, Slack, or another service. This allows different notification setups without changing Impulse's core. Notification payloads, configuration, and delivery error handling will be proposed in the draft spec for review.

The user removed built-in report management from scope. Scripts and agents own any output files they produce; Impulse does not register, store, retain, or deliver generated reports as a product feature. The website-report examples describe possible agent instructions. Explicit success/failure outcome reporting with a summary remains part of execution tracking.

### Shareable task definitions

Projects can include task definition files in version control. A definition describes the task's work and scheduling choices, including script or agent instructions; each user explicitly registers it in their own task registry and uses their local harness and terminal configuration. Machine-specific settings and run history remain local.

These files provide a readable, version-controlled way for people and agents to create and update task definitions. Path resolution rules and the representation of local configuration overrides remain open.

### Task definition format

Task definitions use TOML. Comments support configuration notes, and multiline strings can hold agent instructions. Impulse validates definitions and gives clear errors for invalid settings.

The illustrative indexing example used a command argument list and a completion interval of 24 hours; its field names were not finalized. Schema fields, schema versioning details, external prompt files, and machine-readable CLI input/output remain open.

### Definition locations

A script task's editable definition is colocated with its script, making the work and its configuration easy to find, modify, and debug. The user's term "action" refers here to the existing task concept, which also covers directly scheduled agent work.

Direct agent task definitions live in the project's `.impulse/tasks/` directory when they are project-related, or in an Impulse per-user tasks directory when they have no project. For example, the Biomogging report definition belongs in the website repository. Tasks from all of these locations appear in the same user-wide registry. File names and platform-specific per-user paths remain open.

Colocation concerns the editable definition. The previously agreed explicit update operation activates definition changes, while the user registry retains task identity and run history. Machine-specific harness and terminal selections remain local as agreed. Live scheduling state is stored in the user's SQLite database.

### Applying definition updates

Editing a task definition file does not automatically update the registered task. An explicit update command validates and applies the new definition, preserving the task's identity and history. An active run keeps the configuration it started with; future runs use the applied update. Agents use the same update command as people.

The newly applied configuration governs all upcoming runs, including the next run even if a script previously set its time. Applying an update replaces that pending timing with timing determined by the updated definition; it does not require a separate rescheduling operation. For example, a script's request to run tomorrow at 9:13 does not retain precedence over a subsequently applied schedule change.

This applies to task configuration, not snapshots of referenced script source or project files. See [the definition update decision](adr/0004-explicit-definition-updates.md). Command syntax, computing the new due time for each schedule type, updates before the first execution, and disabled-state handling remain open.

### Scheduling requests from older configuration

After a definition update, reject reschedule or disable requests from a run that started under the replaced configuration. Return a clear configuration-changed error so the caller can see that its scheduling instruction was not applied. The run can still finish and report its outcome.

For example, a user applies a daily 10 a.m. schedule while an older run is active. That older run cannot subsequently replace the new schedule with a request to run in 24 hours. This preserves the user's update while allowing already-started work to finish. Exact revision tracking and response formats remain open.

### General agent requests

Scripts and agents request agents through the Impulse CLI. Impulse resolves the task's independent harness and terminal overrides, falls back to the user's defaults where no override is set, and launches the agent with the supplied instructions and run context. Requests are not limited to failures: a script might gather data and ask for a report, identify something needing investigation, or ask an agent to perform a subsequent step. Directly scheduled agent work is also part of the stated scope.

Repairing the indexing script and finishing its remaining submissions is an example of this general capability. It does not imply that Impulse needs a special repair-agent mode or should automatically launch agents on unhandled failures. Unhandled failures follow the notification policy below.

The task must support waiting for requested agent work when its next run depends on that work finishing. A calendar schedule can keep its fixed recurrence while agent work is tracked; fixed timing alone does not require launching the agent independently. Whether a separate independent-launch option is needed remains open, along with multiple requests and script-to-agent result handling.

### Waiting for requested agents

An agent request waits for the agent's reported outcome by default, allowing the script to use the result and continue. An explicit option lets the requesting command return immediately so the script can do other work. In either case, Impulse keeps the requested agent as part of the tracked run.

For example, a script can gather metrics, request an agent analysis, and use the outcome to decide its next step. Returning immediately does not detach the agent from the run. The result format, how to wait later for an outstanding request, multiple-agent behavior, interruption handling, and script exit semantics remain open.

### Agent capacity

Limit concurrently executing agent requests across tasks for one OS user, with a configurable default of **10 agents**. Additional independent agent requests queue until capacity is available. If several tasks become due at 9 a.m., requests exceeding the limit show as queued. Nested requests follow the immediate capacity-error policy below.

Count active assigned agent work, and release its slot when that work finishes even if its terminal stays open. During cancellation, work that is still running retains its capacity slot until it actually ends. The existing per-task overlap policy also applies. Queue ordering, changes to the limit while work is active, and scripts versus agent capacity remain open.

### Nested agent requests

An agent launched by Impulse can request another agent through Impulse in the first release, including through a script it invokes. The child request belongs to the same tracked run and uses the existing agent request and explicit outcome-reporting contracts. Required child work must be resolved before the overall run can succeed.

Admit a nested request only when agent capacity is available. When the limit is full, return a clear capacity error immediately without queuing the request; the requesting agent can handle the result. The limit remains strict, and independent requests retain their queue behavior.

This avoids a deadlock where every slot is occupied by a parent waiting for a child that cannot start. It can reject a nested request during temporary saturation even if unrelated work would soon finish. See [the nested capacity decision](adr/0009-nested-requests-fail-when-capacity-is-full.md). No slot-sharing scheme or automatic suspension of a harness has been agreed. Delegation performed internally by a harness is a separate concern from an agent launched through Impulse.

### Agent execution duration

Agent work has no automatic time cutoff. It continues until an outcome is reported, execution ends or is interrupted, or the user stops it. Elapsed time should be visible so users can inspect long-running work and intervene manually.

No optional automatic timeout feature has been agreed. Manual stopping follows the cancellation policy below; any attention notifications remain open.

### Cancelling a run

Stopping a run cancels its script and every still-active agent belonging to it, including nested agents. Cancel queued requests belonging to the run and prevent that run from starting more work. Preserve terminal sessions and history for review.

Cancellation leaves the task enabled for future automatic runs; disabling is a separate operation. A normal stop requests a clean shutdown so work has an opportunity to perform cleanup. A separate explicit force option terminates unresponsive work; Impulse does not automatically escalate to force after a time limit.

Work that has not stopped remains visibly stopping and retains its agent capacity slot until it actually ends. Exact command syntax, platform and harness mechanisms, evidence of termination, handling uncertain process state, and future timing after cancellation remain to be specified.

### Agent outcome reporting

Agents explicitly report success or failure with a summary through a small Impulse CLI operation. Their launch instructions explain how to report the outcome. This lets Impulse record the agent's completion without requiring its terminal session to close. Completion of the whole run still depends on the script and any other agent work belonging to it.

If an agent exits without reporting an outcome, its work is unconfirmed; Impulse does not assume success. See [the outcome reporting decision](adr/0003-explicit-agent-outcomes.md). Exact command syntax, report validation, process tracking, and resolution of an unconfirmed outcome remain open.

### Completed agent terminals

Keep the agent's terminal session open after its assigned work finishes so the user can review it. A reported outcome still completes that agent request and releases its capacity slot; an open terminal does not keep the assigned work active.

The user explicitly chose to keep it open. Automatic closing, session reuse, focus behavior, and how further conversation relates to a completed request remain separate decisions. Preserving the terminal does not by itself guarantee that every harness supports continuing the same conversation.

### Handled agent failures

A script can recover from a requested agent's failure and explicitly tell Impulse that it handled that failure. The overall run can then succeed if the script completes successfully and every other required agent request has succeeded or had its failure handled. Preserve both the original agent failure and the explicit handling record in history.

For example, an agent fails to produce an analysis, the script completes an acceptable fallback, records the failure as handled, and exits successfully. A zero script exit status alone does not erase an unhandled agent failure. The reporting command and validation details remain open; handling unconfirmed or interrupted work is a separate decision.

### Unhandled failures

When a script exits with an unhandled error or an agent reports failure that the script does not handle, Impulse records the failure and notifies the user. It does not automatically retry the work or launch another agent by default. Scripts can explicitly request agent work and handle its result themselves.

Calendar tasks continue at their next scheduled occurrence. A task scheduled relative to successful completion waits for intervention if it has neither a successful completion to anchor its next interval nor an explicit next run time. An explicit reschedule or disable instruction remains effective even after failure, as already agreed.

Notifications use the agreed desktop and custom-delivery model. Delivery details, configurable retry or failure-handler options, and the command for explicitly declaring an agent failure handled remain to be specified. The existing distinction between a reported failure and unconfirmed agent work is unchanged.

### Missed schedules

By default, a task runs once when Impulse becomes available again, combining missed occurrences into one catch-up run. A task can instead choose to skip missed occurrences. The first release does not replay every missed occurrence.

For example, returning after three days away produces one current website report, or one indexing execution that resumes the script's queue. This policy concerns scheduled work that did not start. Retrying work that already started follows the interruption policy below.

### Interrupted runs

If the computer restarts partway through a run, Impulse records the interruption and notifies the user by default. Automatic retry of interrupted work is opt-in per task. A script that can safely resume from its own saved progress can enable this behavior; interruption does not establish which external actions completed.

Calendar tasks continue at their next normal scheduled occurrence even if a previous run was interrupted and never retried. The interrupted run remains in the history. A per-task option can hold future runs until the interruption is resolved.

A completion interval still requires successful completion to establish its anchor; an interruption does not start that interval. A confirmed explicit next run request survives interruption. Retry limits, resuming an existing agent session versus starting fresh, how to resolve an interval without a successful completion or explicit next run time, and how to reconcile work still alive after only the Impulse process restarts remain open.

### Script-directed next run

Scripts calculate application-specific timing and can tell Impulse when to run their task next. Impulse persists that time across restarts and does not execute the task early. An expected wait does not by itself trigger an agent to investigate a failure.

The user clarified that this also applies after successful work: a script starts at 9:00, finishes at 9:13, and asks to run again in 24 hours from that moment. That requests execution 24 hours after 9:13, subject to availability, rather than 24 hours after its 9:00 start. A relative request must be resolved to a persisted next run time so restarts do not restart the delay. The glossary therefore uses next run time and rescheduling; the earlier not-before wording described only an eligibility constraint and did not fully express the user's intent.

This keeps service-specific rules in the script while Impulse owns durable scheduling. See [the timing ownership decision](adr/0002-scripts-own-application-specific-waits.md). The reporting interface remains open.

### Confirmed scheduling changes survive later failure

Impulse persists a scheduling change when its CLI confirms the request. The change remains in effect if the same run later fails or is interrupted; the run's outcome is recorded separately.

For example, if an indexer requests its next run for 24 hours from now and then fails during cleanup, that failure does not discard the requested time. A later explicit definition update does replace upcoming timing, as described above; durability through failure does not give a script's earlier request permanent precedence. See [the scheduling persistence decision](adr/0005-scheduling-changes-survive-run-failure.md). Interactions with automatic retry and multiple instructions from the same run remain to be specified.

### Default schedule and explicit instructions

A recurring task retains a default schedule. If a script succeeds without a scheduling instruction, Impulse uses that schedule. Supported scheduling intent includes a fixed daily time and a completion-relative interval, such as 24 hours after successful completion.

The user confirmed two timing behaviors:

- A calendar schedule keeps a report at a specific clock time, such as starting daily at 9 a.m. An agent finishing at 9:20 does not move the next daily occurrence to 9:20.
- A completion interval waits for the work to finish, including a requested agent needed to finish it. If indexing and its agent finish at 9:13, a 24-hour completion interval starts at 9:13.

These are choices about when the next run becomes due. Agent completion can be tracked under either schedule. Missed-occurrence handling during travel remains open.

An explicit next run request overrides the next execution time; it does not add an extra execution alongside the default schedule. An explicit disable request stops future automatic runs. Existing scripts can therefore run on a configured schedule without adopting the scheduling interface, while scripts needing more control can reschedule or disable themselves.

The earlier proposal to retain an independent regular occurrence alongside a script-requested execution is not part of the design. Defaults after failures follow the unhandled-failure policy above. The precedence of multiple instructions from the same execution remains undecided.

### First run timing

First run timing is required in the task definition, separate from the recurring schedule. The user explicitly chooses one of:

- Immediately.
- At a specific timestamp.
- After a delay from registration.
- At the next calendar occurrence, for a task with a calendar schedule.

There is no implicit first-run default. A relative delay is resolved to a persisted due time at registration; restarting the scheduler does not restart that delay. Actual execution remains subject to scheduler availability and execution limits. An explicit timestamp or delay can preserve an existing cooldown when importing the indexer.

Exact TOML syntax and validation details, including how to handle a timestamp already in the past, remain open. Re-enabling or updating an existing task is a separate operation from configuring a newly registered task's initial execution.

### One-off tasks

The first release supports one-off script and agent tasks alongside recurring tasks. A one-off task uses its required first run timing without a recurring schedule. It has no default recurrence after execution; its definition and history remain available.

For example, an agent can schedule a single website check for tomorrow afternoon. Interaction with explicit rescheduling and failed one-off work will be proposed in the draft spec for review.

### Time zones

Calendar schedules follow the computer's current local time zone by default. Each task can instead select an explicit named time zone, such as `America/New_York`. A personal daily report therefore follows local 9 a.m. when travelling, while a project can choose a fixed time zone.

A completion interval remains an elapsed duration regardless of time zone. Clock corrections and changes of local time zone remain to be specified.

### Skipped and repeated local times

If a daylight-saving clock change skips a scheduled local time, apply the task's catch-up policy. By default, perform one catch-up run at the first valid time afterward; tasks configured to skip missed occurrences skip it. For example, when a clock jumps from 2 a.m. to 3 a.m., a daily 2:30 task catches up at 3 a.m. by default.

If a scheduled local time occurs twice, use its first occurrence and do not create another occurrence just because the clock repeats that time. Availability and overlap policies still apply. These rules concern daylight-saving transitions; travel between time zones and other clock corrections remain separate cases.

### Overlapping calendar occurrences

By default, allow one active execution per task, including agent work belonging to that execution. If another calendar occurrence becomes due while the task is still active, skip that occurrence and record why. The overlap policy is configurable per task; which alternative behaviors ship in the first release remains open.

For example, if yesterday's report agent is still active at today's 9 a.m. occurrence, today's occurrence is skipped under the default policy. This policy concerns a task already running; the agreed catch-up policy for Impulse being unavailable is unchanged. Global concurrency limits, stalled agents, and an explicit script-requested next run time arriving while work is active remain separate decisions.

### Script-directed disabling

Scripts can also disable their task's future automatic runs. A finite queue is an example where this is useful; whether the Biomogging indexer should stop when empty or keep discovering new pages belongs to that script's behavior.

Disabling preserves the task and its history, allows later re-enabling, and lets the current execution finish. It is an explicit scheduling instruction rather than something inferred from a script's success or lack of a next run request. Whether re-enabling should catch up occurrences that passed while deliberately disabled remains undecided.

## Existing indexing automation: observed on 2026-09-04

The source automation is at `/home/deck/Projects/biomogging-indexing`. Its user-level systemd units are in `/home/deck/.config/systemd/user/`.

- `biomogging-indexing.timer` checks every 15 minutes in `America/New_York`, with `Persistent=true`.
- `biomogging-indexing.service` invokes `run-scheduled.sh` and has a desktop notification service for failure.
- `run-scheduled.sh` exits successfully without doing work if `next-attempt-not-before.txt` is still in the future.
- When due, the script launches an isolated headless Chrome profile, refreshes the sitemap queue, performs a best-effort indexing-status preflight, and runs `process-queue.sh`.
- Queue exit status `75` means quota exhaustion. The wrapper treats this as an expected pause and sends a notification; other nonzero queue statuses propagate as failures.
- `process-queue.sh` sets the next eligible time to 24 hours from when it detects its local request-attempt cap or a quota response. The wrapper also ensures a future daily gate after a successful queue run. The current timing is therefore not an exact record of the last successful submission plus 24 hours.
- The inspected failure path sends a desktop notification; it does not launch an agent.

These are observations about the current script, not assertions about Google's quota rules or decisions about Impulse's interface. The live automation has not been modified.

## Open design branches

- Durability: interrupted work, overlapping work, and interactions between catch-up and other scheduling constraints.
- Scheduling: calendar times, intervals, and delays anchored to script-reported events.
- Execution ownership: script-requested agents, tracking completion, and handling interrupted or failed work.
- Script contract: success, failure, expected waiting, and explicit requests for agent work.
- Agent behavior: general instructions, context, permissions, completion evidence, and limits.
- Failure handling details: delivery payloads and errors, optional retries or recovery mechanisms, and the command for declaring an agent failure handled.
- Terminal lifecycle and harness integration across operating systems.
- Configuration scope, portability, and agent-friendly CLI and skill interfaces.
- First release scope and migration of the existing indexing automation.

## Current interview question

The five final interview questions are complete. The next step is one consolidated review of [the draft spec](spec.md), including the proposed details that were not individually decided in the interview.


## Remaining interview plan

The user asked how many questions remain after confirming the stopping policy. Aim for five further focused questions, followed by a consolidated spec review:

1. One-off tasks alongside recurring work — confirmed.
2. Scheduler lifecycle and CLI behavior when the scheduler is stopped — confirmed.
3. Run records and notification delivery — confirmed; built-in report management subsequently removed by the user.
4. History and log retention — confirmed.
5. Installation and the agent skill workflow — confirmed.

The unresolved details listed throughout this document will be resolved through research where factual, or included as explicit proposals in the draft spec for review. They are not implicitly accepted decisions. The final review should walk through the indexing migration and a scheduled website agent task, including configuration, execution, outcome tracking, and recovery, before implementation begins.
