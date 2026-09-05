# Harness and terminal integration notes

Read-only discovery on 2026-09-04 to inform the first-release integration list. No agent sessions were launched, no terminal sessions were created or changed, and no end-to-end launch or completion flow has been tested.

## Local evidence

- `codex` and `claude` are available in `/home/deck/.local/bin/`. Their help output supports supplying an initial prompt to an interactive session. Codex also advertises `--cd` for selecting the working root. These are installed interfaces, not a promise that every installed version supports identical flags.
- `/usr/bin/konsole --help` advertises `--workdir`, `--hold`, and `-e` for selecting a directory, retaining an ended session, and executing a command.
- Yakuake is absent from the host PATH. Its login entry at `/home/deck/.config/autostart/org.kde.yakuake.desktop` launches the user Flatpak application `org.kde.yakuake`.
- Read-only introspection with `qdbus6 org.kde.yakuake /yakuake/sessions` succeeds. The running application advertises methods for creating sessions, listing terminal IDs, and running a command in a specified terminal. No mutating methods were called. Host command access and the environment inside this Flatpak terminal still require verification.

## Official references

- [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli): the previous CLI reference redirects here. Consult alongside the installed CLI's help when implementing an adapter.
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference): reference for the Claude Code harness integration.
- [Windows Terminal command-line arguments](https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments): reference for the Windows terminal integration.

The Apple Terminal automation documentation could not be retrieved during this check. The Terminal.app integration requires follow-up verification on macOS. Windows support likewise needs testing on Windows; this Linux inspection does not validate either platform.

## Agreed release scope

The user confirmed Codex and Claude Code; Terminal.app on macOS, Windows Terminal on Windows, and Konsole plus Yakuake on Linux. The existing custom-command and wrapper extension decision remains applicable to other setups. Agreement on scope does not establish tested compatibility.

Implementation must verify prompt delivery, working directory and environment, explicit outcome reporting, retained terminal behavior, and process tracking for each supported integration. The local Flatpak installation is a concrete compatibility case to include. Exact launch arguments, supported versions, and platform combinations are not yet specified.
