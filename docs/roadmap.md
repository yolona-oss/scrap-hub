# cmd-hub v2 roadmap

These are commitments from the v1 design that must land in v2. v1 deliberately ships with seams in place so each of these is an additive change — no breaking API revisions on the plugin-author surface.

## Authentication hardening

**External PKI via `ICertVerifier`.** v1 generates its own CA and signs node certs with `node-forge`. A compromised hub operator can forge any node. v2 accepts node certs signed by an external CA (Vault PKI engine, step-ca, AWS Private CA, corporate intermediate). Seam: drop in an alternative `ICertVerifier` implementation via `CmdHubServiceDeps.resolveFingerprint`. No changes to the registry or service-impl code.

- Spec: `docs/superpowers/specs/2026-04-23-cmd-hub-distributed-design.md` → "Future auth extensions"
- Code: `packages/cmd-hub/src/distributed/auth/types.ts`

**Pluggable `ITokenVerifier`.** v1 uses bcrypt against an in-Mongo allowlist. v2 supports external auth backends (OIDC, Vault, HSM-backed tokens). Seam: the registry consumes `ITokenVerifier` through dependency injection; swap implementation at app composition time.

**HSM/TPM-backed node tokens.** Node-side credential storage should support hardware-backed keystores so a stolen filesystem snapshot doesn't compromise the token. v2 adds a `ITokenStore` seam on the node side mirroring the hub's `ITokenVerifier`.

**Signed audit log** of every `/config`, `/sconfig`, `/node` mutation. v1 logs to stderr. v2 persists a tamper-evident log to Mongo or an append-only store.

## Storage

**S3-compatible file backend.** v1 ships `GridFSBackend` only. `FileServiceBackend` is already defined as an interface; v2 adds `S3Backend` that uses presigned PUT URLs so nodes upload directly to S3 without round-tripping through the hub. `FileHandle` is deliberately opaque — plugins see the same type regardless of backend.

- Seam: `packages/cmd-hub/src/distributed/files/types.ts::FileServiceBackend`
- Code: `packages/cmd-hub/src/distributed/files/gridfs-backend.ts`

**Client-side encryption for user secrets.** `SystemConfig` and `AccountModule` documents contain API keys (SerpAPI, Google Sheets credentials, …) in plaintext today. v2 uses MongoDB CSFLE so the hub never sees secret plaintext, gated by an `ISecretStore` seam.

## Routing + capacity

**Metric-aware routing.** v1 round-robins across pool peers. Nodes already publish metrics (CPU, RAM, event-loop lag) via the Heartbeat stream and the hub stores them in `MetricStore`. v2 adds a `NodeScorer` that consumes recent samples and biases `CommandPool.pick()` toward under-loaded peers.

- Code: `packages/cmd-hub/src/distributed/pool/command-pool.ts`
- Code: `packages/cmd-hub/src/distributed/metrics/metric-store.ts`

**Rate-limiting on `/upload`.** A valid but malicious node could open many parallel uploads and exhaust gateway memory. v2 adds `express-rate-limit` + per-node connection caps.

**Multi-gateway HA.** v1 is single-gateway by design (see spec § 2.2). v2 adds shared session affinity (Redis / Mongo change-streams) so multiple gateways can serve one bot without the "events stream to gateway A but user is pinned to gateway B" problem. Dispatcher gains a `SessionAffinity` seam.

## UI plugins

**`SessionIndex` wiring into the dispatcher.** v1's `HubDispatcher.handle` discards the `InvocationHandle` internally, which means `/service-ctrl pause|resume|stop` works only when a separate code path owns the handle (like the direct `CmdNodeServiceClient.invoke()` used in the golden test). v2 exposes `dispatcher.handleWithSession(...)` that persists the handle in `SessionIndex` so intercom routing works end-to-end through the dispatcher.

- Code: `packages/cmd-hub/src/distributed/dispatcher/hub-dispatcher.ts`

**Rich dashboard renderer.** v1's example Telegram UI (`examples/telegram-ui-app/src/telegram-hub-ui.ts`) streams events as flat text. v2 reuses the `ServiceDashboard` still present in `packages/cmd-hub/src/ui/command-processor/dashboard/` to render progress bars, intercom buttons, and in-place message edits.

## Developer ergonomics

**Publish `@cmd-hub/core`, `cmd-node`, `create-cmd-node` to npm.** v1 depends on workspace-local installs. v2 registers versions + publishes so `npx create-cmd-node` works outside the monorepo.

**Per-package unit test coverage report.** v1 has 150+ tests but no coverage gating. v2 wires `istanbul` + a threshold check into CI.

## Documentation

**Tutorial: "writing your first cmd-node"** walking through every step from `npx create-cmd-node` to production deployment. v1 has the scaffolder and API references; v2 closes the loop with a narrative walkthrough.
