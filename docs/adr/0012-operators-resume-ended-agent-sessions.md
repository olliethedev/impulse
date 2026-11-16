# Operators resume ended agent sessions in a new run

An agent session can end before its agent reports an outcome, for example when its terminal closes while it waits on background work. Starting the task again repeats work the session already did. `run resume RUN` lets an operator continue that session instead.

A resume admits a new run of the same task. Its root agent records the ended run, agent and harness session it continues, and the runner relaunches Claude Code with `--resume` or Codex with `codex resume`, using a new context and instructions file. The ended run is not reopened: run outcomes stay final, and the old context keeps rejecting reports. Resuming requires a session recorded by the Claude hooks or the private Codex app-server, an unchanged task revision so the same harness reopens it, and no active run for the task.

Resuming stays an operator command. Observations still never start replacement work, as ADR 0011 records. The resumed agent is told its previous session ended without an outcome and must check what it already completed, because Impulse cannot know which external effects happened.
