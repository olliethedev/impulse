# Impulse v1 — review draft

Status: implementation is underway following approval to build. The accepted behavior below comes from [the interview record](design.md); the additional defaults guided the initial implementation. See [validation evidence](implementation.md) for what has been built and checked. This remains the v1 target, not a claim that all release checks have passed.

Impulse is a local CLI that durably schedules scripts and agent work. Scripts and agents can request more agent work, change their next execution time, and disable future execution. People choose their own harness and terminal; the first local integration is Codex in Yakuake.

The development environment uses a devcontainer, as requested. Application code will be TypeScript with Bun, distributed as standalone executables for macOS, Windows, and Linux.

## Accepted behavior

| Area | Required behavior |
| --- | --- |
| Operating environment | One scheduler and registry per OS user, working in a logged-in desktop session. Login startup is opt-in. |
| CLI startup | Commands that register, update, or run work start the scheduler if needed. Read-only commands leave it stopped. Starting the scheduler processes due work. |
| Work | Script tasks and direct agent tasks; recurring and one-off scheduling. Agent instructions can describe any work. |
| First execution | Required configuration: immediately, at a timestamp, after a registration-relative delay, or at the next calendar occurrence. |
| Recurrence | Calendar times stay tied to the clock. Completion intervals start after successful completion of the whole run, including required agents. |
| Availability | Catch up once by default; optionally skip. Do not replay a backlog of every missed occurrence. |
| Time zones | Current computer time zone by default, with a named-zone override. Skipped DST times catch up at the first valid time unless skipping; repeated local times run once at their first occurrence. |
| Overlap | One active run per task by default; skip and record overlapping calendar occurrences. Make overlap behavior configurable. |
| Scheduling changes | A confirmed next-run request replaces the next execution and survives failure or interruption. Scripts can disable future execution while finishing current work. |
| Definition updates | Explicit apply operation; edits alone do not activate. An update governs all upcoming runs, replacing pending script-selected timing. Active work keeps its starting configuration, and subsequent reschedule/disable requests from that older configuration are rejected. |
| Agent requests | Use the Impulse CLI to resolve harness/terminal choices. Wait by default; an explicit non-waiting request stays attached to the same run. |
| Nested agents | Supported. At full capacity a nested request immediately returns a capacity error; independent requests queue. |
| Agent capacity | Configurable global limit, default 10. Count assigned agent work, not open terminals. Release a slot when the assignment finishes. |
| Agent duration | No automatic cutoff. Show elapsed time and allow manual stopping. |
| Outcomes | Explicit success/failure and summary through the CLI. An agent exiting without an outcome is unconfirmed. An explicitly handled agent failure can allow the overall run to succeed. |
| Failures | Record and notify by default; no automatic retry or repair agent for unhandled failures. Calendar tasks continue at their next occurrence. Completion tasks need a successful anchor or explicit next time. |
| Interruption | Record and notify. Retrying interrupted work is opt-in per task; a calendar task can optionally hold future runs until resolved. |
| Cancellation | Stop the script and all owned agents, including nested work; cancel queued requests and prevent more work in that run. Keep terminals/history and leave the task enabled. Ask for clean termination first; force is explicit, with no timed escalation. Work still stopping keeps its slot. |
| Configuration | Shareable TOML beside scripts; project agent tasks in `.impulse/tasks/`; non-project tasks in a per-user directory. Applied configuration and live state go in local SQLite. |
| Harness settings | Harnesses own auth, MCP, and permission settings. Independent harness/terminal overrides per task fall back to user defaults. |
| Integrations | Codex and Claude Code; Terminal.app, Windows Terminal, Konsole, and Yakuake. Custom launch commands/wrappers support other setups. |
| Visibility | Human output and `--json` on every command; all operations also available noninteractively. Status, outcome summaries, and owned logs are inspectable. |
| Notifications | Desktop failure/interruption notifications by default, configurable success notifications, and optional user notification commands. |
| Retention | History/summaries indefinitely; detailed logs 30 days after a run ends by default. Global and per-task controls; protect active-run data. |
| Setup and skill | A setup command selects harness/terminal and optionally enables login startup and installs the skill. Independent noninteractive operations and a standalone repository `SKILL.md` package are also required. |

Built-in report management is excluded. Any report, analysis file, or other deliverable belongs to the script or agent producing it. Impulse records the assignment's outcome and summary. Headless/before-login execution is outside v1; arbitrary user scripts still need their own interpreters and platform dependencies.

## Proposed defaults to review

These close the remaining interview branches. They are recommendations, not previously accepted decisions.

| ID | Proposal | Practical consequence |
| --- | --- | --- |
| P1 | Five-field calendar expressions, elapsed completion intervals, and one-off tasks. | `0 9 * * *` means daily at 9 a.m.; `*/15 * * * *` supports clock-aligned 15-minute work. No seconds field in v1. |
| P2 | A stable generated local task ID plus a unique user-chosen name; registering the same canonical file is idempotent. | An agent retrying registration cannot accidentally create duplicate schedules. Applying changed contents still requires update. |
| P3 | FIFO admission for independent agent requests; no separate global script limit in v1. | Scripts retain per-task overlap controls. Lowering the agent limit lets current assignments finish and blocks further admission until below the new limit. |
| P4 | Overlap options `skip` and `queue_one`, both with one active run per task. | `queue_one` collapses overlapping occurrences into one pending run. A script-selected future execution that becomes due while its own run is active stays pending until that run ends. |
| P5 | Explicit disable state survives definition updates; re-enable does not replay deliberately skipped calendar occurrences. | Re-enable uses the next calendar occurrence. For non-calendar tasks whose saved due time expired while disabled, require an explicit `--now` or `--at` choice. |
| P6 | Recompute upcoming timing on every applied update. | Calendar uses the new rule; completion uses the latest successful run's finish time, or awaits the active run. A failed latest run with no valid anchor needs manual execution or explicit rescheduling. Details are below. |
| P7 | Within the current configuration, later confirmed reschedules replace earlier ones; rescheduling does not re-enable a disabled task. | Disabling wins until explicitly re-enabled. Old-configuration requests and requests from cancelled/finished run contexts cannot change scheduling. |
| P8 | Retry interrupted work at most once by default when the per-task retry option is enabled, after five minutes and any confirmed cooldown. | The attempt count persists across restarts. Do not retry unconfirmed work or an execution that might still be alive automatically. Higher retry counts/delays are explicit configuration. |
| P9 | Scheduler restarts reconnect to surviving runners; stopping the scheduler stops dispatch, not the tasks already running. | Per-run runners retain outcomes until the scheduler acknowledges them. A separate run stop cancels work. Uncertain process state holds the affected task and capacity until reconciled. |
| P10 | Every child assignment remains tracked; a parent may explicitly handle a failed child. | Extend the script recovery contract to parent agents. A parent outcome cannot complete the whole run while children remain unresolved. |
| P11 | Fresh terminal session for each agent request, labelled with task/request identity, with no requested focus-stealing where supported. | Completed sessions stay open and are not reused automatically. The desktop may still control activation. |
| P12 | Notification delivery is separate from work success, with durable event records and manual redelivery after a delivery failure. | A broken notification command does not rerun indexing or reclassify successful work. |
| P13 | GitHub release archives with checksums and a package-manager path; propose an npm launcher package first. | The launcher selects the appropriate standalone binary. Direct binary users need no Node/Bun installation. Exact package naming and publishing remain release work. |
| P14 | Use the MIT license for the new project. | The implementation includes the repository's [MIT license](../LICENSE). |

The [CLI and TOML contract](cli-contract.md) and [runtime design](runtime-design.md) contain the proposed details behind these choices, including new flags, persistence rules, and platform validation work.

## Configuration and everyday use

The proposed onboarding command is:

```sh
impulse setup --harness codex --terminal yakuake --startup enable --skill codex --non-interactive
```

Omitting startup or skill options leaves those settings unchanged. Initial setup uses explicit options; an interactive guided flow remains a possible convenience. Custom harness/terminal profiles belong in local settings; portable task definitions contain the work and scheduling rules.

Example definitions:

- [Indexing task](examples/indexing.toml): a script beside its definition, with a completion interval and an explicit initial timestamp.
- [Daily website task](examples/website-check.toml): agent instructions at 9 a.m., with a project working directory.
- [One-off task](examples/one-off.toml): one agent assignment after a delay, with no recurrence.

These remain illustrative design samples; replace the sample initial timestamp before registration. The later local indexing wrapper and its approved recovery behavior are recorded in [indexing-migration.md](indexing-migration.md).

```sh
impulse task validate ./impulse.toml --json
impulse task register ./impulse.toml --name indexing --json
impulse task show indexing --json
impulse task update indexing --json
impulse task next indexing --after 24h --json
impulse task disable indexing --json
```

Registration and update output include the applied task identity, revision, effective profile, and next time. Use `daemon status` to inspect dispatch after registration. A validation/preview operation performs no registration or execution.

## Indexing migration walkthrough

The inspected automation currently uses a persistent systemd timer every 15 minutes and a script-owned timestamp gate. The script owns browser isolation, its CSV ledger, request-attempt state, preflight checks, quota recognition, and cleanup. Exit 75 inside its queue is an expected quota pause; the outer wrapper currently translates that to success.

The migration preserves these application responsibilities. Impulse replaces the periodic timer and owns the persisted execution schedule. The ported script sends an explicit scheduling request at the point it establishes a new gate, so a later cleanup failure cannot discard the scheduling instruction:

```sh
# Inside the running task; its task/run context is supplied by Impulse.
impulse task next --at "$next_attempt" --json

# Or, if the application rule is 24 hours from this event:
impulse task next --after 24h --json
```

The quoted variable is data supplied by the script, not a shell fragment generated by Impulse. Choose an explicit timestamp when the relevant application event occurred before this command. Relative delays start when Impulse accepts the request.

On an unexpected failure, the script can request agent work with its own instructions:

```sh
impulse agent request --instructions-file ./indexing-followup.md --json
```

The requesting command waits for the reported agent outcome. A successful agent repair can finish the remaining work, then the script exits successfully. If the agent finishes at 9:13 and the task has no explicit next-time instruction, a 24-hour completion interval is due at 9:13 the next day. If there is a confirmed explicit next time, that time controls instead. Expected quota waits do not themselves request repair.

The agent receives instructions for inspecting the relevant run and providing its outcome:

```sh
impulse run show --current --json
impulse run logs --current --json
impulse agent finish --outcome success --summary "Completed the requested follow-up." --json
```

If a child agent fails and its requester completes a fallback, the requester records the recovery using the child ID and a reason before completing successfully. If work is exhausted and the application should stop scheduling itself, the script calls `impulse task disable` in its run context. Whether an empty indexing queue should disable or keep discovering new pages remains an application decision.

Migration sequence for implementation:

1. Port and test against fixtures first. Keep the live timer and scripts unchanged during development.
2. Preserve the ledger, request-window state, and existing future gate. The gate also acts as the request-window identity in the current wrapper, so removing it requires a deliberate migration of that relationship.
3. Validate the definition and choose its initial time from the application's current state. Do not treat this sample's time as a real quota reset.
4. At cutover, ensure no old execution is active, disable the old timer, register the real definition, and inspect the persisted next time. Never run both schedulers against the same ledger concurrently.
5. Verify the first controlled run and scheduling instruction. Rollback disables the Impulse task before restoring the old timer.

This document neither changes the live automation nor authorizes submissions to Google. The current script's gate is not verified Google quota guidance.

## Daily agent walkthrough

Place the website task definition in the project's `.impulse/tasks/` directory and register it once. Its `cwd = "../.."` resolves relative to that definition, so the agent starts in the website project. The user's selected harness supplies its existing Vercel MCP connection and permission settings.

At 9 a.m. the scheduler admits the assignment when capacity permits, opens the configured terminal, and supplies the instructions and run context. The agent performs the website check and explicitly completes the assignment. Any files it chooses to create remain project/task-owned. The terminal stays open; tomorrow's calendar occurrence remains at 9 a.m. regardless of when today's assignment finished.

If all 10 independent slots are occupied, this request queues. If the running agent itself asks for another agent while the limit is full, that nested request returns a capacity error so the caller can choose its next step.

## Remaining timing rules proposed for review

| Situation | Proposed behavior |
| --- | --- |
| Definition updated before its first execution | Re-evaluate the new first-run choice; a registration-relative delay still uses the original registration time. A newly selected `now` becomes due at update. |
| Calendar definition updated | Discard pending old timing, use the next unconsumed occurrence of the new calendar rule at or after the update. Already-started work finishes under its snapshot. |
| Completion interval updated during active work | Use the new interval when the current whole run succeeds. The old run may report its outcome but cannot issue new scheduling mutations. |
| Completion interval updated after success | Recalculate from that latest run's successful completion. If already due, admit once subject to overlap. A later failed/unconfirmed/interrupted run prevents reusing an older success as a retry anchor. |
| One-off task finishes | Retain its definition and history with no default next execution. An explicit next-time request can schedule another execution; failure has no implicit retry. |
| Run cancelled | No completion-success anchor is created. Calendar recurrence and previously confirmed future scheduling instructions remain, unless changed separately. |
| Explicit time is already past | Validation rejects a newly supplied past absolute time. Existing times that become overdue through downtime follow catch-up; internal retries use their persisted due time. |
| Manual run while a future time exists | Return the new run ID, but preserve a future explicit next-time instruction unless the user resets it. A calendar manual run leaves the calendar rule intact. Manual execution never overlaps an active run in v1. |
| Local zone changes during travel | Recalculate future calendar times in the new local zone. Do not backfill the travel interval or repeat a nominal occurrence already completed on that local date. Explicit named zones stay fixed. |
| Clock moves backwards/forwards | Persist occurrence identity to avoid repeats; coalesce missed calendar occurrences according to catch-up. Relative intervals need elapsed-time reconciliation, including suspend, with behavior validated per platform. |

## Devcontainer and delivery plan

The first implementation slice adds `.devcontainer/devcontainer.json` and its image definition, pins the base image by digest and the Bun/toolchain versions, and commits `bun.lock`. Development and Linux CI use the same environment and frozen dependency installation. Pin image features and CI actions as well; provide a deliberate update procedure. The [Dev Containers prebuild guide](https://containers.dev/guide/prebuild) describes reusing and pinning tool environments, and [Bun documents frozen lockfile installation](https://bun.sh/docs/pm/cli/install).

Build and test without importing a maintainer's harness credentials or host scheduler state. Use an isolated Impulse state directory and fake executables for scheduler tests. Native macOS, Windows, and Linux test jobs use the same Bun version and dependency lock; interactive desktop checks cover actual terminal and login integrations. Container builds alone do not establish native desktop compatibility or bit-for-bit reproducibility; verify reproducibility before making that release claim.

Implement in reviewable slices:

1. Devcontainer, locked toolchain, CLI validation, local registry, and script execution with a fake clock.
2. Durable scheduling, run state, restart reconciliation, updates, and run-scoped control commands.
3. Agent outcome contract and Codex/Yakuake integration, exercised with fake harnesses before real sessions.
4. Remaining built-in harness/terminal integrations, startup, stopping, and the native platform matrix.
5. Notifications, retention, setup, installable skill, release packaging, and the controlled indexing migration.

Linux-first development does not reduce the agreed macOS/Windows release scope. Version and architecture claims depend on actual validation. See [runtime feasibility work](runtime-design.md) for the platform-sensitive interfaces to prove early.

## Acceptance evidence required before v1

| Scenario | Evidence |
| --- | --- |
| Clean development checkout | Devcontainer builds, frozen install succeeds, typecheck/tests/build run without host Bun or undeclared dependencies. |
| Quota timing and recovery | A fixture requests a next time and then fails; the time persists. Required agent work delays completion-interval anchoring. |
| Definition updates | A pending script override is replaced; an old active run's scheduling request receives a conflict while its outcome is still recorded. |
| Availability and clocks | Tests cover reboot, sleep/wake, catch-up/skip, DST gap/fold, zone changes, and clock adjustments. |
| Admission | Duplicate registration is idempotent; two scheduler starts produce one owner; agent limits, nested rejection, and overlap decisions survive restart. |
| Outcomes and stopping | Missing, duplicate, late, and conflicting outcomes are distinguished. Handled failures, nested work, explicit force, and no automatic cutoff behave as specified. |
| Launch boundaries | Paths, prompts, and arguments containing spaces, quotes, newlines, and shell metacharacters survive intact on every claimed platform. |
| Restart recovery | Killing the scheduler alone does not relaunch live work; ambiguous launches stay unresolved until reconciled. Database acknowledgement and execution are tested at crash boundaries. |
| Desktop integrations | Real login startup, terminal retention, outcome callbacks, cancellation, and notifications pass on each supported desktop; include the local Flatpak Yakuake setup. |
| Scope and maintenance | Cleanup never removes active-run data or project-owned files. The installed skill uses the implemented CLI contract. Release assets, checksums, license, and installation are validated. |

Approval of this draft should confirm both the accepted requirements and the proposed defaults. Any changes can be made in this consolidated review; another long interview is not needed.
