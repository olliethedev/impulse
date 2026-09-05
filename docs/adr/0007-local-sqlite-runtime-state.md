# Store Impulse's runtime state in local SQLite

Use one SQLite database per OS user, accessed through Bun's built-in SQLite support, for registered configuration, next run times, active runs, and history. Transactional updates support consistent scheduling and outcome records, while TOML remains the editable and shareable task definition format. Expose stored state through CLI inspection commands; database schema, durability settings, and process coordination remain separate decisions.
