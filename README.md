# Impulse

Durable local scheduling for scripts and agent assignments. Register a task once, give it a schedule, and let it use your chosen agent harness and terminal when it needs agent work.

Impulse is an early implementation for logged-in desktop sessions on Linux, macOS, and Windows. It uses TypeScript, Bun, and local SQLite. See [validation status](docs/implementation.md) for the evidence behind platform support and remaining release checks.

## Build and install

Open the repository in its devcontainer, then run:

```sh
bun install --frozen-lockfile
bun run check
```

The container pins its base image and Bun 1.4.1. A native checkout with that same Bun version can use the same commands. `dist/impulse` (`dist/impulse.exe` on Windows) is standalone; Bun is not required on the user's machine. Copy it to a stable location on your PATH before enabling startup. On Linux or macOS:

```sh
mkdir -p ~/.local/bin
cp dist/impulse ~/.local/bin/impulse
impulse setup --harness codex --terminal yakuake --non-interactive
impulse doctor
```

Built-in harnesses: `codex`, `claude-code`. Built-in terminals: `yakuake`, `konsole`, `terminal-app`, `windows-terminal`. Custom profiles support other setups through ordinary executable argument arrays. Impulse uses the harness's existing login, tools, MCP configuration, and permissions. Before scheduling unattended work in a new project, open your harness there once and complete its login and project-trust setup; an interactive first-use prompt otherwise waits in the task's terminal.

## Schedule a script

Keep `task.toml` beside the script:

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

```sh
impulse task validate task.toml
impulse task preview task.toml
impulse task register task.toml
impulse task list
```

Registration starts the scheduler. Initial timing is always explicit: `now`, `at`, `after`, or the next calendar occurrence. Omit `[schedule]` for one-off work. A completion interval starts after the whole run succeeds, including any agents it requested.

Scripts can change their next run, disable future runs, or request agent work:

```sh
impulse task next --after 24h
impulse task disable
impulse agent request --instructions-file investigate.md --json
```

A confirmed schedule change survives a later failure. Agent requests use the configured harness and terminal and wait by default; `--no-wait` still tracks the agent in the same run. There is no automatic repair agent or failure retry.

## Schedule an agent directly

Put a definition in `.impulse/tasks/website-check.toml`:

```toml
schema_version = 1
name = "website-check"
cwd = "../.."
[work]
kind = "agent"
instructions = "Inspect the website with your configured tools and record the findings in the project."
[first_run]
kind = "schedule"
[schedule]
kind = "calendar"
cron = "0 9 * * *"
timezone = "local"
```

Calendar schedules retain their clock time. Five numeric cron fields support lists, ranges, steps, and wildcards. Use an IANA timezone to pin a zone. Missed occurrences coalesce to one run by default, and runs of the same task do not overlap.

Agents explicitly finish their assignment with a success or failure summary. Finishing releases their capacity slot and keeps the terminal available. The default global limit is 10 agents, configurable in settings. There is no automatic execution cutoff.

## Inspect and change work

```sh
impulse task show indexing
impulse task update indexing
impulse task run indexing
impulse run list
impulse run show RUN_ID
impulse run logs RUN_ID
impulse run stop RUN_ID
```

Editing a task file does not silently apply it. `task update` replaces all upcoming configuration and timing; an older active run can finish but cannot issue new scheduling changes. `task disable` affects future runs; `run stop` requests cancellation of current work. Force is a separate `--force` choice.

State belongs to the current OS user. `IMPULSE_HOME=/path/to/isolated-home` creates a separate installation for experiments. History and summaries are retained indefinitely by default, logs for 30 days; active and unresolved work is protected. Task output files belong to the task.

## Startup and agent skills

```sh
impulse startup enable
impulse startup status
impulse skill install --harness codex --scope user
```

Startup is opt-in and runs at desktop login. Disabling startup leaves current dispatch running; `daemon stop` stops dispatch while existing runners continue. See [operations](docs/operations.md) for setup, custom adapters, recovery, and removal.

Every command supports `--json`, and mutations are noninteractive. Agents can install the repository's [Impulse skill](skills/impulse/SKILL.md), which teaches task definitions, scheduling, outcomes, and error handling. Run `impulse --help` for the command list.

Contributions are welcome under the [MIT license](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) and the [design specification](docs/spec.md).
