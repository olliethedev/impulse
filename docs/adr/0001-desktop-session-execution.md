# Run within the user's desktop session in the first release

Impulse starts at user login and executes within that desktop session, because visible agent sessions in the user's configured terminal are central to the initial use cases. This scopes out execution before login and on headless machines for the first release, while retaining macOS, Windows, and Linux as target platforms and keeping harness and terminal choices configurable for other users' setups. Schedule persistence is required; missed-run behavior and the startup installation mechanism are separate decisions.
