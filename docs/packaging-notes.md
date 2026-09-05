# Initial packaging feasibility

Checked on 2026-09-04 while discussing distribution. Standalone executable distribution is agreed, and TypeScript with Bun has been selected because the user is more familiar with TypeScript. See [the language decision](adr/0006-typescript-with-bun.md).

- The Go compiler supports targets including Linux, macOS, and Windows, with supported OS and architecture combinations documented by the project. [Go installation and target documentation](https://go.dev/doc/install/source#environment).
- Go builds runnable executables and includes an external-process API in its standard library. [Go build tutorial](https://go.dev/doc/tutorial/compile-install), [Go os/exec documentation](https://pkg.go.dev/os/exec).
- Bun can bundle a TypeScript or JavaScript entry point into a standalone executable that includes its runtime. Its documentation lists cross-compilation targets for Linux, macOS, and Windows, so standalone distribution does not by itself require choosing Go over TypeScript. [Bun standalone executable documentation](https://bun.sh/docs/bundler/executables).

These are toolchain capabilities, not validation of Impulse or its eventual dependencies. Platform versions, architectures, native dependencies, signing, and actual launch behavior need to be covered by the implementation and release plan. Packaging Impulse does not package arbitrary user scripts or agent harnesses with it.
