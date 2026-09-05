# Task definitions

Unknown fields are errors. Command arrays do not expand shell syntax. Select a shell explicitly when required.

```toml
schema_version = 1
name = "indexing"
cwd = "."
[work]
kind = "script"
command = ["bash", "./index.sh"]
[first_run]
kind = "after"
delay = "1h"
[schedule]
kind = "completion"
after = "24h"
```

The script can call `impulse task next --after 24h` after its final successful submission. That request survives a later failure. A configuration update replaces it. The script may also disable its own future runs.

```toml
schema_version = 1
name = "website-check"
cwd = "../.."
[work]
kind = "agent"
instructions = "Inspect the website using the tools already configured in this harness. Record your findings in the project and report your outcome to Impulse."
[first_run]
kind = "schedule"
[schedule]
kind = "calendar"
cron = "0 9 * * *"
timezone = "local"
```

Omit `[schedule]` for one-off work. First-run kinds are `now`, `at` with an offset-bearing RFC 3339 `at`, `after` with `delay`, or `schedule` for calendar work. Durations are positive integers with `s`, `m`, `h`, or `d`; a day is 24 elapsed hours.

Optional `[policy]`: `catch_up = "once"` or `"skip"`, `overlap = "skip"` or `"queue_one"`, `hold_after_interruption = false`. Optional `[policy.interruption_retry]`: `enabled = false`, `max_attempts = 1`, `delay = "5m"`. Failure does not retry automatically.

Optional `[retention]`: `history = "forever"`, `logs = "30d"`. Optional `[notifications]`: `on_success = false`, `on_failure = true`, `on_interruption = true`. Impulse manages execution history and logs; outputs produced by the task remain the task's responsibility.
