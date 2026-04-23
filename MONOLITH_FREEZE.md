# Monolith feature freeze

As of 2026-04-23 the current monolithic cmd-hub (`packages/cmd-hub/`, `packages/org-scraper/`, `packages/app/`) is feature-frozen pending the distributed rewrite.

Do not add new features, refactor, or fix non-blocking bugs in these packages. Production bugs discovered during the rewrite are accepted as known and will be fixed only in the rewrite work.

- Tracking spec: `docs/superpowers/specs/2026-04-23-cmd-hub-distributed-design.md`
- Tracking plan: `docs/superpowers/plans/2026-04-23-cmd-hub-distributed.md` (+ phase1.md, phase1b.md, phase1c.md, phase2.md, phase3.md, phase4.md)

New code for the rewrite lives under:
- `packages/cmd-hub/src/grpc/` (protobuf contracts + generated bindings)
- `packages/cmd-hub/src/distributed/` (upcoming: framework + gateway runtime)
- `packages/cmd-node/` (upcoming: node runtime)
- `packages/create-cmd-node/` (upcoming: plugin-author template)
