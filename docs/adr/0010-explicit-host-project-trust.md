# Opt in to project trust through host settings

New scheduled agent tasks can wait indefinitely at workspace trust dialogs even when command permissions already allow the assignment. Parent-folder trust does not reliably cover fresh repositories across Codex and Claude Code versions.

An optional host-owned `trust.roots` list authorizes built-in runners to record exact project trust immediately before launching the harness. Shareable task definitions cannot set it. Apply canonical containment checks to both the task directory and the harness's repository/worktree trust root. Existing trust refusals require an explicit decision. Keep tool permissions, sandbox settings, authentication, and managed policy under the harness's control.

Use the documented trust fields in each harness's local configuration, preserve unrelated values, back up the original file, serialize Impulse writes, and replace files atomically. Removing a root stops future additions; already persisted trust requires explicit revocation. This supports interactive terminal sessions and private Codex backends without switching to headless execution or changing cancellation semantics.
