# Scripts own application-specific waits

Scripts calculate service-specific timing and can request their task's next run time; Impulse persists and enforces that time across restarts. Keeping quota and other application rules in scripts lets the same scheduler support unrelated services without incorporating each service's behavior. Rescheduling can follow successful work or an expected wait, and neither by itself triggers a failure-recovery agent; the reporting interface and fallback schedule are separate decisions.
