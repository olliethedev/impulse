# Impulse

Impulse schedules scripts and agent work using the user's configured agent harness and terminal.

## Language

**Task**:
Registered work together with its scheduling and execution choices. A task can run a script or directly request agent work.
_Avoid_: Action, run

**One-off task**:
A task scheduled for a single initial execution with no default recurrence. Its definition and execution history remain available afterward.
_Avoid_: Recurring task, deleted task

**Task registry**:
The collection of tasks registered for one OS user, accessible from any directory. Registered tasks can use different working directories.
_Avoid_: Project, task history

**Scheduler**:
The coordinator of due tasks and their runs for one OS user. It applies scheduling policies and tracks requested agent work.
_Avoid_: Agent harness, individual task

**Task definition**:
A shareable description of a task's work and scheduling choices that a user can register on their machine. Machine-specific execution settings and run history remain local to that user.
_Avoid_: Task registry, run history

**Run**:
One execution of a task, including agent work that belongs to that execution. A task can have many runs over time.
_Avoid_: Task, terminal session

**Run context**:
The association of executing work with its task, run, and, when applicable, agent assignment. It identifies whose work is being controlled or reported on.
_Avoid_: Working directory, task definition, terminal session

**Agent harness**:
The application through which an agent performs work, such as Codex or Claude Code. The user configures which harness Impulse uses.
_Avoid_: Model, terminal

**Terminal**:
The application in which Impulse opens an agent's working session, such as Yakuake. The terminal is configured separately from the agent harness.
_Avoid_: Agent harness

**Agent request**:
A request for Impulse to launch an agent with instructions for work to perform, using the task's configured harness and terminal. The requester waits for the agent's outcome by default or can choose to continue immediately; the agent remains part of the tracked run in either case.
_Avoid_: Repair request, failure handler

**Nested agent request**:
An agent request made by an agent already working on a run, including through a script it invokes. The requested agent belongs to the same run.
_Avoid_: Separate scheduled task, harness-internal subagent

**Agent outcome**:
An agent's explicit report of success or failure with a summary of its work. Reporting an outcome does not require closing the terminal session.
_Avoid_: Terminal exit status

**Handled agent failure**:
An agent failure that its requesting script or agent explicitly acknowledges as recovered from, allowing the overall run to succeed once all required work is resolved successfully. The original agent failure remains in history.
_Avoid_: Successful agent outcome, ignored failure

**Agent capacity**:
The maximum number of agent requests allowed to execute concurrently for one OS user, configurable with a default of 10; completed work releases its slot even if its terminal remains open. Independent requests wait for capacity, while nested requests are rejected immediately when capacity is full.
_Avoid_: Open terminal count, per-task overlap policy

**Unconfirmed**:
Agent work that ended without an explicit outcome report. Impulse does not assume that unconfirmed work succeeded.
_Avoid_: Successful, failed

**Interrupted run**:
A run whose execution was cut short, for example by the computer restarting. Automatic retry of interrupted work is opt-in per task; the default is to record the interruption and notify the user.
_Avoid_: Missed occurrence, successful run

**Catch-up policy**:
A task's choice of what happens to scheduled occurrences missed while Impulse is unavailable or because a daylight-saving clock change skips their local time: perform one catch-up run or skip those occurrences. The default is one catch-up run.
_Avoid_: Retry policy

**Catch-up run**:
A single execution that satisfies the task's missed scheduled occurrences together when execution becomes possible. It does not replay each missed occurrence individually.
_Avoid_: Retry, backlog replay

**Overlap policy**:
A task's choice of what happens when another occurrence becomes due while its previous execution is still active. By default, Impulse allows one active execution per task and skips and records overlapping calendar occurrences.
_Avoid_: Catch-up policy

**Default schedule**:
A recurring task's timing rule, used after successful execution when the script gives no scheduling instruction. Examples include a fixed daily time or an interval after successful completion; a script can override the next run or disable future automatic runs.
_Avoid_: Next run time

**First run timing**:
A task's required choice of when its initial execution becomes due: immediately, at a timestamp, after a delay from registration, or at its next calendar occurrence. This is separate from the schedule for subsequent executions.
_Avoid_: Recurrence, retry

**Calendar schedule**:
A recurrence tied to clock times in the computer's current local time zone by default, or an explicitly selected time zone. The recurrence does not shift when a previous execution takes longer to finish.
_Avoid_: Every 24 hours

**Completion interval**:
An elapsed duration from successful completion of a task's work until its next run. When agent work is required to finish the task, that work must finish before the interval starts.
_Avoid_: Calendar schedule, interval from start

**Next run time**:
The time a task is scheduled to execute next, subject to Impulse being available. A script can request this time, including after successful work, and Impulse remembers it across restarts.
_Avoid_: Quota reset time

**Rescheduling**:
Updating a task's next run time; a confirmed change persists even if the run later fails or is interrupted. A script can request a delay measured from the moment of its request or specify a timestamp.
_Avoid_: Failure recovery

**Disable**:
Turn off a task's future automatic runs while preserving the task and its history for later re-enabling. A script can disable its own task and let its current execution finish.
_Avoid_: Reschedule, delete, cancel the current execution

**Cancellation**:
Stopping a run's script and all agent work belonging to it, including nested agents and queued requests, while preserving its history. Cancellation leaves the task enabled for future automatic runs.
_Avoid_: Disable, delete, successful completion

**Retention policy**:
The user's choices for how long Impulse keeps run history, outcome summaries, and execution logs, with defaults that individual tasks can override. Active-run data is preserved.
_Avoid_: Execution time limit, application data lifecycle

**Deferral**:
A script-requested postponement for an expected application-specific condition, such as a quota cooldown. A deferral does not by itself represent a failure or call for a repair agent; successful work can also request rescheduling without being a deferral.
_Avoid_: Failure, error
