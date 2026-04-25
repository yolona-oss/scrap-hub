# cmd-hub documentation

Operator-facing documentation for the cmd-hub federation framework.

## Quick links

- **[CLI reference](./cli.md)** — every `cmd-hub` subcommand (`ca-init`, `node-add`, `node-list`, `node-approve`, `node-remove`) with security notes.
- **[Node deployment walkthrough](./node-deployment.md)** — full end-to-end procedure: build → CA → provision → wire config → run, plus a security model and vulnerability checklist.
- **[Examples README](../examples/README.md)** — local-dev vs Docker run modes, config-slice ownership table.
- **[Roadmap](./roadmap.md)** — items deferred past v1 (multi-gateway, S3 file backend, external PKI, etc.).
- **[Design specs and plans](./superpowers/)** — architecture decisions and implementation plans, organized by phase.

## Reading order for a new operator

1. [`../examples/README.md`](../examples/README.md) — get the mental model and run the local stack
2. [`cli.md`](./cli.md) — learn the operator surface
3. [`node-deployment.md`](./node-deployment.md) — production-ready provisioning + security walkthrough

## Reading order for a new contributor

1. [`../CLAUDE.md`](../CLAUDE.md) — repo layout, build, and run commands
2. [`./superpowers/specs/`](./superpowers/specs/) — design decisions
3. [`./superpowers/plans/`](./superpowers/plans/) — phase plans referenced by individual PRs
