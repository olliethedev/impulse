# Harness observations are separate from execution and outcomes

An interactive harness can report a terminal API failure while its frontend and
tool commands remain alive. A runner heartbeat proves only that the runner can
report. Waiting for frontend exit alone hides model failures; treating a failed
turn as termination can duplicate external effects.

Record structured harness observations alongside execution state. The shared
command layer validates and stores observations, raises a failure notification,
retains the last failure, and supplies read-only diagnosis. Observation never
settles an assignment, releases capacity, changes its schedule, changes models,
or starts replacement work. Explicit outcomes remain authoritative. After an
owned process lifecycle establishes termination, its latest failed observation
can explain a failed execution; an external lifecycle still retains uncertainty.

Codex observation reads only the assignment's private app-server, using its exact
initial prompt to bind the session. It polls read-only session/turn methods and
does not resume, subscribe, submit input, or answer approvals. Missing protocol
capabilities become unavailable evidence. Claude Code uses session-scoped hooks
and an expected session ID; hook output never contains decisions. Existing
settings and permissions remain in effect. Custom wrappers may use the same
validated `agent observe` callback. Legacy launches remain supported through
their declared lifecycle, with missing structured evidence stated explicitly.

Store only bounded session/turn identifiers, progress state, observed tool count
when available, and error details. Do not copy conversations, tool arguments or
outputs into scheduler state. Observed tool counts are incomplete evidence about
external work. A connection loss does not erase the last recorded failure.

The initial change includes failure detection and diagnosis. Automatic retries
are outside this change, as requested by the owner. Recovery continues through
scoped cancellation and the existing operator assertions after investigation.

Protocol references: [Codex app-server](https://developers.openai.com/codex/app-server/)
and [Claude Code hooks](https://code.claude.com/docs/en/hooks). The adapter tests
cover supported protocols, missing capability, and retained execution. Actual
provider failures are simulated; the tests do not use account credentials.
