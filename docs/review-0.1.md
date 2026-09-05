# Initial implementation review

Baseline: `c567f77` (requirements and design). Initial implementation: `61a377e`. Two independent code-review axes examined `git diff c567f77...61a377e`.

## Standards

Two documented breaches and one heuristic finding were identified:

1. Cancellation could finish after the immediate process exited while an owned descendant kept working. A container fixture demonstrated a cancelled run with a child still writing. This violated the documented requirement to treat uncertain liveness conservatively.
2. An invalid `setup --startup` choice was validated after otherwise valid settings were committed. This violated the requirement to include validation in the mutation boundary.
3. Possible duplicated lifecycle branching in the command layer: script and agent execution share selection/persistence patterns. This is a maintenance heuristic, separate from the correctness findings.

## Spec

Three implementation defects were identified:

1. Owned process-tree cancellation did not establish descendant termination before releasing capacity.
2. A notification persisted as `delivering` could remain unretryable after its scheduler died; no delivery owner was recorded or reconciled.
3. Updating an unexecuted task with first-run `schedule` or `now` reused registration time. Only registration-relative `after` should keep that anchor, and newly applied past absolute times should be rejected.

## Corrections and evidence

POSIX runners now retain an owned process group and wait for its non-zombie members to end, including when the initial process has already exited. Graceful stop preserves stopping state/capacity for a resistant descendant; explicit force remains usable. Windows uses a suspended child assigned to a Job Object before execution, with descendant accounting and a private termination control file. Native Windows evidence is required for that adapter.

Setup validates its supplied choices first. Notifications record ownership; abandoned delivery attempts become inspectable failures with an explicit duplicate-delivery caveat before manual retry. First-run updates now use update time for `now`/`schedule`, preserve the registration anchor for `after`, and validate changed absolute times.

Regression tests cover the reproduced cancellation, setup, notification recovery, and first-run update defects. A separate native fixture verified the Flatpak Yakuake host-shell launch path. The lifecycle duplication heuristic remains a candidate for future module refinement; it does not override the behavioral contracts.
