# Agent sessions can close after success or run headless

ADR 0001 makes visible terminal sessions central. In practice most scheduled agents finish without anyone watching, and their tabs pile up. Closing tabs by hand risks closing one that is still working, which leaves its run unconfirmed.

A local session mode, set as a host default and per task like harness and terminal, chooses how a session is shown. `keep-open` stays the default and keeps today's behaviour. `close-on-success` keeps the visible tab and closes it once the agent reports success; failures and unconfirmed endings keep their tab for inspection. `headless` starts no terminal and runs the harness in print mode, writing its output to the run log. It is an opt-in exception to ADR 0001 for work nobody needs to watch.

The mode is a local choice rather than part of the shareable definition, because whether someone watches agents is a preference of their machine. Headless adds no permission bypass: prompts that would need an answer are denied, and access is widened in the harness's own settings. `codex exec` ends with the turn and kills background processes, so headless Codex assignments are told to keep long commands in the foreground. Pi and custom harnesses take part through `pi -p` and a custom `headless_command`; a custom harness without one rejects headless.
