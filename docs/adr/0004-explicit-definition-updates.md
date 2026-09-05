# Apply task definition changes explicitly

Registered tasks retain their applied configuration until an explicit update command validates and applies a changed definition, preserving task identity and history. The updated definition governs every upcoming run and replaces pending timing even when a script set it, making the latest applied configuration authoritative for future execution. An already-active run keeps its starting configuration, but referenced script source and other project files are not snapshotted by this decision.
