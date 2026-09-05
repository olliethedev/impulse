# Agents explicitly report their outcomes

Agents report success or failure and a summary through the Impulse CLI, allowing tracked work to finish while its terminal session stays open. An agent exiting without an outcome report leaves its work unconfirmed rather than implicitly successful. This makes outcome reporting a shared contract across harnesses; command syntax, validation, and interruption handling are separate decisions.
