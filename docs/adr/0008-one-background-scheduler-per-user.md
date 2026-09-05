# Use one background scheduler per OS user

Run one Impulse scheduler per OS user to manage due times, catch-up behavior, task execution, and agent tracking through a shared implementation across operating systems. Native OS integration launches that scheduler at login, while platform-specific terminal integrations open agent sessions. This gives dynamic rescheduling and run tracking a common owner; process communication and database writer ownership remain separate decisions.
