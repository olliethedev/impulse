# Local indexing migration

Implementation baseline: `9d5d6da9943e0b7154fabda4d27e885c69f71081`. This records the approved September 5, 2026 installation and migration; application-specific behavior stays with the indexing scripts.

## Agreed behavior

- Install the standalone Impulse executable on this machine's PATH, select Codex and Yakuake, enable desktop login startup, and install the user-scoped Codex skill.
- After completed, verified Impulse code changes, rebuild/reinstall the executable and refresh the skill. The developer decides when replacement is safe; do not gate updates on idle work.
- Replace and remove the old indexing systemd timer, service, and failure-notification unit after preserving a rollback copy. Never have both schedulers submitting against the ledger.
- First run: immediate recovery of the legacy run's unexpected Search Console errors. Preserve the existing cooldown and exhausted local attempt budget. Recovery can inspect and fix automation without new submissions.
- Normal recurrence: 24 hours after successful whole-run completion, including attached Codex work. Expected quota exhaustion is normal daily completion. An already established cooldown is a lower bound, never erased by failure or repair.
- A script failure or three consecutive unexpected request errors requests one Codex assignment through Impulse. Supply the failure, run identity, log/ledger locations, confirmed attempts used, estimated remaining local budget, and cooldown.
- Codex may fix the indexing automation and resume within the same remaining budget. Website code/deployment changes and unresolved problems require human intervention. No recursive automatic repair chain.
- An unresolved repair disables indexing until the user intervenes. Send a persistent critical desktop notification and retain actionable intervention/resume instructions. Notification delivery must not determine work success.

The local limit of 10 request attempts is an application budget, not a verified measurement of Google's remaining quota. Reserve attempts before an external click; ambiguous requests cannot be silently retried as if unused.

## Validation boundaries

Use the existing script CLI boundary with fixture browser/notification executables and copied state; use Impulse's executable CLI for task registration, agent outcomes, pause/resume, and durable scheduling. Public behavior tests must establish that recovery cannot reset quota state, manufacture a successful outcome, or submit during the initial cooldown. Use the baseline above for the implement skill's two-axis final review.

The real recovery run is authorized separately from fixture testing. Observe its actual outcome and notification, and fix Impulse launch/integration defects exposed by that run. Preserve task-owned source and ledger backups locally; do not publish private state or browser data in this OSS repository.
