# cmd-hub Distributed Architecture — Design Spec

**Date:** 2026-04-23
**Status:** Proposed
**Author:** brainstorm session with xewiy

## Context

Today, cmd-hub is an in-process monolith. The `@cmd-hub/core` package implements UI hosting, command dispatch, service execution, dashboards, and message lifecycle — all in one Node.js process alongside the plugins it loads (`org-scraper`) and the application bootstrap (`app`). A command typed by a user travels entirely inside one address space: the UI plugin hands it to `CmdDispatcher`, the dispatcher instantiates a `BaseCommandService`, and the service's `EventEmitter` drives the `ServiceDashboard` back to the UI plugin.

This spec redesigns cmd-hub as a distributed framework with a single **gateway process** and **multiple execution nodes** that register over the network. The rewrite is motivated by three goals:

1. **Horizontally scale command execution** without scaling the UI host.
2. **Hotplug new nodes** with new commands/services at runtime, without restarting the gateway.
3. **Ship cmd-hub as a framework** — i.e. make it easy for third parties to build their own UI plugins and their own nodes — rather than as a specific application. The current `packages/org-scraper/` and `packages/app/` become reference implementations under `examples/`.

The intended outcome is a framework where a plugin author can, in about ten lines of code and a Dockerfile, publish a new node that joins a running gateway and becomes immediately invokable through any UI plugin the gateway hosts.

Out of scope (deferred to v2): multi-gateway / gateway HA, metric-aware routing (hook only), S3 or cloud file backends (hook only), external PKI, client-side-encrypted user secrets, non-Telegram UI plugins.

---

## Architecture

### Tiers

```
┌─────────────────────────────────────────────────────────────────┐
│                         cmd-hub (gateway)                        │
│                                                                  │
│   ┌──────────┐  ┌──────────┐  ┌────────────────┐  ┌───────────┐ │
│   │ UI plugin│  │ UI plugin│  │ CmdDispatcher  │  │FileService│ │
│   │(Telegram)│  │  (web…)  │──│                │──│           │ │
│   └──────────┘  └──────────┘  └────┬─────┬─────┘  └─────┬─────┘ │
│                                    │     │              │       │
│                       ┌────────────┘     └──────────┐   │       │
│                       ▼                             ▼   │       │
│               ┌───────────────┐            ┌─────────────┐      │
│               │  Built-ins    │            │ Node router │      │
│               │ /help /config │            │ + CmdNode   │      │
│               │ /sconfig /node│            │  Registry   │      │
│               └───────────────┘            └──────┬──────┘      │
│                                                   │             │
│                                         ┌─────────┴─────────┐   │
│                                         │ gRPC server (mTLS)│   │
│                                         └─────────┬─────────┘   │
└───────────────────────────────────────────────────┼─────────────┘
                                                    │
                                      ┌─────────────┼──────────────┐
                                      │             │              │
                                      ▼             ▼              ▼
                               ┌─────────────┐ ┌─────────────┐ ┌───────────┐
                               │ scraper-node│ │ other-node  │ │ MongoDB   │
                               │             │ │             │ │(+ GridFS) │
                               └─────────────┘ └─────────────┘ └───────────┘
```

Two kinds of process:

- **cmd-hub (gateway).** Single process. Hosts UI plugins, serves built-in commands locally, routes every other command to a node over gRPC, owns the node registry and the `FileService` facade over storage.
- **cmd-node.** N processes, any machine mix. Each node authenticates, publishes a manifest, and exposes commands and services. Any number can join and leave while the gateway runs.

One shared **MongoDB** (replica set so transactions work) holds user accounts, session state, config, and file bytes (via GridFS in v1).

### Naming

The framework is named `cmd-hub` and so is its main package (`packages/cmd-hub/`). The two tiers are:

- **cmd-hub** — the gateway tier.
- **cmd-node** — the execution tier.

Names are deliberately drawn from the framework's own vocabulary rather than generic distributed-systems terms. We avoid "worker", "executor", "service node" — the last one conflicts with the existing `BaseCommandService` vocabulary.

### Package layout

```
packages/
  cmd-hub/             the main framework package AND the gateway runtime.
                       Shared types, BaseCommandService, ConfigRegistry, UI
                       interfaces, message-lifecycle, protobuf bindings,
                       FileService + GridFSBackend, auth seams, built-ins,
                       CmdNodeRegistry, CommandPool, gRPC server, CLI.
                       Plugin authors depend on this.

  cmd-node/            node runtime. gRPC client, manifest builder,
                       metrics collector, event adapter over
                       BaseCommandService, receiveMsg dispatch, CLI.

  create-cmd-node/     scaffolding template for plugin authors.

examples/
  scraper-node/        the current org-scraper, repackaged as a cmd-node.
  telegram-ui-app/     the current app + Telegram UI plugin, repackaged.
```

The examples directory signals that `scraper-node` and `telegram-ui-app` are reference implementations, not the product.

### Why single gateway

Multi-gateway (active-active load balancing or active-passive failover) was considered and rejected for v1. It adds a shared-event-bus dependency (Redis / NATS / Mongo change-streams) to let an in-flight command started on gateway A keep sending updates to its UI session when events arrive via gateway B, or it adds session affinity that depends on UI-plugin specifics. Neither is worth the cost for the target deployments. Only the execution tier scales horizontally in v1.

---

## Transport

### gRPC + Protocol Buffers

All gateway-to-node communication is gRPC over TLS with mutual authentication. The `.proto` files live in `packages/cmd-hub/src/grpc/` and are the canonical contract between the tiers.

**Why gRPC:** bidirectional streams are the primitive (matching the current `BaseCommandService` event model 1:1), the `.proto` file is literally the manifest, reconnect/flow-control/framing are solved, and the transport works identically over VPN and public internet.

### Three channels

1. **Control (unary RPC):** `Register`, `Heartbeat` (bidi stream used as control), `GetManifest`, `ConfigReload`, `CreateWriteGrant`. These are short request/response calls used for setup, metrics, and file-upload capability issuance.

2. **Execution (bidi stream):** one stream per active command invocation. Lifecycle:
   - Gateway opens the stream, sends `InvokeStart { sessionId, userId, commandName, args, serviceDataBlob }`. `serviceDataBlob` is the serialized `CmdServiceData` shape (`{ config, params, messages, sessionData, sessionId }`) encoded as protobuf `bytes` — nodes re-hydrate it into the structure `BaseCommandService.Initialize()` expects today.
   - Node instantiates the command/service, emits `InvokeServer { message | error | progress | progressStatus | intercom | file | done }` as the command runs.
   - Gateway can send `InvokeClient { intercom | cancel }` back up the stream at any point (pause/resume/stop, intercom-button clicks).
   - Node emits `done`; both sides close.

3. **File upload (HTTP/2 client-streaming):** capability-grant upload flow. Node asks the gateway for a `WriteGrant`, uploads bytes to the URL the grant names, receives a `FileHandle`, embeds the handle in a subsequent `file` event on the execution stream.

### Event-to-protobuf mapping

Current `BaseCommandService` events are preserved 1:1 in `InvokeServer`:

| Today's event        | `InvokeServer` variant |
|----------------------|-----------------------|
| `message`            | `StreamMessage`       |
| `error`              | `StreamError`         |
| `progress`           | `Progress`            |
| `progressStatus`     | `ProgressStatus`      |
| `intercom`           | `IntercomUpdate`      |
| `file`               | `FileEmitted`         |
| `done`               | `Done`                |

`receiveMsg(id, args)` — the reverse channel used for pause/resume/stop/intercom-button — maps to `InvokeClient.Intercom`.

---

## Node manifest

When a node connects, it publishes a manifest that is the source of truth for what the federation can do:

```protobuf
message NodeManifest {
  string node_id                   = 1;
  string node_name                 = 2;
  string version                   = 3;
  repeated Command      commands   = 4;
  repeated Service      services   = 5;
  repeated ConfigModule configs    = 6;
  HardwareInfo  hardware           = 7;
  MetricsSchema metrics            = 8;
}
```

Manifests are **immutable for the lifetime of a connection**. To change the manifest (add a command, change a config schema), the node process must restart. There is no `ManifestUpdate` RPC. This simplifies the gateway's aggregated-manifest index and makes hotplug semantics tractable.

### Command identity — mandatory compatibility_id + version

Every `Command` in a manifest declares all three fields or the entire manifest is rejected at `Register` time:

```protobuf
message Command {
  string name             = 1;   // user-facing slash command
  string compatibility_id = 2;   // REQUIRED — plugin author grouping key
  string version          = 3;   // REQUIRED — semver
  string description      = 4;
  repeated ArgSpec args   = 5;
  repeated string aliases = 6;
}
```

TypeScript types make all three non-optional. `create-cmd-node` templates derive `compatibility_id` and `version` from `package.json`.

A command from a new manifest joins an existing **routing pool** iff all of:
1. `name` matches exactly.
2. `compatibility_id` matches exactly.
3. `version` is in the same major as the pool.

The gateway rejects a whole manifest with a human-readable diff if:
- Any of the three fields is missing.
- Same `name` appears with different `compatibility_id` (peers must share name).
- Same `name` + `compatibility_id` with incompatible major (would fragment the pool).
- Arg-signature drift within an otherwise-compatible pool is **trusted**: the plugin author declared peers via `compatibility_id`; we don't re-check arg shapes.

Within a pool, v1 routing is plain round-robin. Users may optionally override routing per-invocation (`/scraper --node=<nodeId> ...`). Metric-aware scoring is a future extension; the scoring hook is present but the default score is constant.

---

## Authentication

### Node authentication — mTLS + pre-shared token

Every node authenticates to the gateway with all three of:

1. A client certificate signed by the gateway's CA (or, in v2, an external CA — see *Future Auth Extensions*).
2. A pre-shared token, bcrypt-hashed in the gateway's allowlist.
3. A stable `nodeId` that must match the certificate fingerprint in the allowlist.

Credentials are provisioned two ways, both supported:

- **`cmd-hub node-add <name>`** — gateway CLI generates `(nodeId, token, cert, key)` and prints them for the operator to paste into the node's config.
- **Manual** — operator generates with openssl / uuidgen / their own tooling, inserts the allowlist entry directly.

### Hotplug policy

`auth.autoRegister: true | false` in gateway config:

- `true` — a node presenting valid credentials becomes `ACTIVE` immediately and its commands become routable.
- `false` — the same node appears as `PENDING` until an admin runs `/node approve <id>`.

Deregistration via `/node deregister <id>` transitions to `DISABLED`: in-flight sessions terminate cleanly, new invocations fail fast (no silent re-route).

### User authentication

The UI-plugin side is unchanged. `ctx.manager.isAdmin` gates `/config`, `/sconfig`, `/node`. UI plugins authenticate their own users (e.g. the Telegram UI's existing auth flow). The gateway trusts the `ctx` from the UI plugin because the UI plugin runs in the gateway's process.

### Future auth extensions (v2, must be implemented)

v1 ships with the gateway generating its own CA and holding the signing key. This means a compromised gateway operator can forge any node. The following are planned v2 extensions that must not be blocked by v1 design choices:

- **External PKI** via an `ICertVerifier` plug-point. Replace the internal CA with a Vault PKI engine, step-ca, or AWS Private CA.
- **Pluggable `ITokenVerifier`** — backends for external auth services, not just the bcrypt allowlist.
- **HSM/TPM-backed tokens** on nodes.
- **Client-side encryption** of SystemConfig and AccountModule secrets via MongoDB CSFLE, behind an `ISecretStore` facade.

All v1 code goes through these interfaces even though v1 only ships the "internal" implementation of each. Interfaces live in `packages/cmd-hub/` alongside the types.

---

## State and storage

### MongoDB

A single MongoDB replica set (one node is fine; the replica-set init is only needed so transactions work). Every tier connects to it:

- Gateway reads/writes `Account`, `AccountModule`, `SystemConfig`, `UserConfig`, node allowlist, file metadata (GridFS `fs.files`).
- Nodes read/write `Account`, `AccountModule`, session data (they call `BaseCommandService.Initialize()` unchanged, which already talks to Mongo).

Any write path that spans multiple documents or races with another node is wrapped in a MongoDB transaction. Examples: creating an `AccountModule` + a session in one step; `/config` changes that update `SystemConfig` and then fan out `ConfigReload` RPCs to nodes that own the affected module.

### Files — the `FileService` abstraction

Files never live on the gateway's disk or on a node's disk. They live in a pluggable storage backend behind a `FileService` interface:

```ts
interface FileService {
  issueWriteGrant(req: {
    sessionId, nodeId, name, mime, ttl, maxBytes
  }): Promise<WriteGrant>;              // capability + upload URL

  completeWrite(grantId, actualBytes): Promise<FileHandle>;

  read(fileId): AsyncIterable<Buffer>;
  stat(fileId): Promise<FileMeta>;
  delete(fileId): Promise<void>;
}
```

v1 ships only `GridFSBackend`: files are stored in MongoDB GridFS with a TTL index on `expiresAt`. Upload flow:

1. Node calls `CreateWriteGrant` (gRPC unary).
2. Gateway issues `{ grantId, uploadUrl, token, expiresAt }`. For GridFS, `uploadUrl` points at the gateway's own `/upload?grant=...` endpoint.
3. Node PUTs bytes there. Gateway streams them into GridFS.
4. Gateway returns a `FileHandle`. Node embeds it in the next `FileEmitted` event.

Every file carries a TTL policy: `1h ... 7d` for ephemeral exports; `permanent` for system-preserved files.

**Hard constraints frozen in v1 so v2 migration is cheap:**

- `FileHandle` is the only wire type plugins see. Never expose raw GridFS ObjectId.
- Nodes never talk to the storage backend directly. Only through `FileService`.
- Every file has `{ ttl, permanent }` policy metadata.

v2 drops in an `S3Backend` where `uploadUrl` is an S3 presigned PUT URL; nodes upload directly to S3, bypassing the gateway; `FileHandle` opacity means no plugin code needs to change.

### Trust model for file uploads

Nodes never hold MongoDB credentials for files. The gateway is the only component with write access to GridFS. Node-to-GridFS writes go through the gateway's `/upload` endpoint (for GridFS backend) or through a capability-signed S3 URL (for S3 backend in v2). This keeps MongoDB credentials off nodes and makes the gateway the single place to enforce per-session tagging, size limits, and auth.

---

## Dispatch and execution

### Command dispatch

When a command arrives from a UI plugin, `CmdDispatcher` looks it up in this order:

1. **Local built-ins map.** `/help`, `/config`, `/sconfig`, `/node`, `/service-ctrl`. Built-ins always win on name collision.
2. **Aggregated manifest index.** If the command is declared in some `CommandPool`, route to a pool member.

Built-ins run locally on the gateway because they operate on federation state: `/help` needs the union of every node's manifest; `/config` needs the union of every node's `ConfigRegistry` schemas; `/node` operates on the registry itself. Putting them on a bundled "system node" was considered and rejected: a node only sees its own manifest, so it can't serve `/help`.

Built-ins do not violate the "gateway has no business logic" principle — they are federation reflection and federation control, which are intrinsic gateway responsibilities.

### Execution lifecycle

```
UI plugin receives /scraper ...
  │
  ▼
CmdDispatcher.handleCommand()
  │
  ├─ is it a built-in? → run locally. Done.
  └─ is it in aggregated manifest?
        │
        ▼
     Node router picks a pool member (round-robin, or
     explicit user override via --node=<id>).
        │
        ▼
     Gateway creates SessionContext { sessionId, userId, command,
        nodeId, startedAt, uiHandle } in MongoDB.
        │
        ▼
     Gateway opens Invoke stream, sends InvokeStart.
        │
        ▼
     Node instantiates a fresh command/service instance (the
     same `exe.clone(userId, {config, params, messages})`
     pattern used in the monolith today), runs Initialize()
     against shared MongoDB, runs the command. Its emit()
     calls push events onto the gRPC stream.
        │
        ▼
     Gateway routes each InvokeServer message into the
     ServiceDashboard for this session. Dashboard renders
     debounced edits to the UI exactly as today.
        │
        ▼
     User clicks an intercom button → UI plugin calls
     dispatcher.dashboardCallback(sessionId, actionId) →
     gateway sends InvokeClient.Intercom back up the stream →
     node's receiveMsg(actionId, args) fires.
        │
        ▼
     Node emits Done → gateway closes stream, clears
     SessionContext, dashboard renders final snapshot.
```

### What's reused, what changes

| Current code                               | After the rewrite                                    |
|--------------------------------------------|------------------------------------------------------|
| `BaseCommandService`                       | Reused unchanged. Runs on the node.                  |
| `ConfigRegistry`                           | Dual-loaded: each node loads its own modules at boot and publishes schemas in its manifest. Gateway aggregates. Reads/writes hit shared Mongo. |
| `ServiceDashboard`                         | Reused unchanged. On the gateway. Consumes events from the stream instead of a local emitter. |
| `MessageLifecycle`                         | Reused unchanged. Gateway.                            |
| `CmdDispatcher`                            | Split: registry/builder/sequence stay on gateway; the in-process invoker is replaced by the node router. |
| `CommandInvoker.invokeService()`           | Replaced by the Invoke RPC flow.                      |
| `active_services: Map<userId, Service[]>`  | Becomes `active_sessions: Map<userId, SessionContext[]>` on the gateway. |
| `receiveMsg`                               | Reused unchanged. Now arrives via stream.            |
| `emit('file', filePath)`                   | Replaced with `FileService.issueWriteGrant()` → upload → `FileEmitted { FileHandle }`. |

### Failure modes (v1 policy)

- **Node disconnects mid-invoke:** session is marked failed, `StreamError` surfaced into the dashboard ("node went offline"), partial state already persisted by the service's snapshot loop is kept. No auto-retry on another node.
- **No pool available for a command:** fail fast, dashboard shows "no nodes available for `<command>`".
- **Pool member rejects an invocation:** fail fast for that session; no silent re-route. (v2 may add retry policy.)
- **Duplicate command with incompatible manifest:** node's `Register` is rejected with the diff; node logs and stays disconnected until its manifest is fixed.

---

## UI plugins

UI plugins are registered imperatively by the application. The framework does **not** auto-discover them and does **not** read a plugin list from config:

```ts
import { CmdHubApp } from 'cmd-hub';
import { TelegramUI } from '@example/telegram-ui-plugin';

const app = new CmdHubApp({ mongoUrl: ..., grpc: { port: 50051, ... } });
app.useUI(new TelegramUI(botToken));
await app.start();
```

Multiple `useUI()` calls are supported. The gateway dispatches commands arriving from any registered UI and each UI gets its own session scope. `IUI` is the existing `BaseUI` interface — we don't invent a new plugin descriptor.

UI plugins run in-process with the gateway in v1. They benefit from direct access to `CmdDispatcher` and `ServiceDashboard`, and they're not independently scalable anyway (a given UI plugin serves one bot token, one web site, one CLI instance). Out-of-process UIs (e.g. a web frontend with many browsers) are a v2 extension; the clean path is a web container that speaks to the gateway over the existing gRPC API.

---

## Deployment

### Reference docker-compose

```yaml
services:
  mongo:
    image: mongo:7
    command: ["--replSet", "rs0", "--bind_ip_all"]
    volumes: [mongo_data:/data/db]
    # replica-set init handled by a one-shot helper container

  cmd-hub:
    build:
      context: .
      dockerfile: examples/telegram-ui-app/Dockerfile
    environment:
      - MONGO_URL=mongodb://mongo:27017/cmdhub?replicaSet=rs0
      - HUB_CA_CERT=/certs/ca.crt
      - HUB_SERVER_CERT=/certs/hub.crt
      - HUB_SERVER_KEY=/certs/hub.key
      - AUTH_AUTO_REGISTER=false
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
    ports: ["50051:50051"]
    volumes: [hub_certs:/certs]

  scraper-node:
    build:
      context: .
      dockerfile: examples/scraper-node/Dockerfile
    environment:
      - HUB_ADDRESS=cmd-hub:50051
      - MONGO_URL=mongodb://mongo:27017/cmdhub?replicaSet=rs0
      - NODE_ID=${SCRAPER_NODE_ID}
      - NODE_TOKEN=${SCRAPER_NODE_TOKEN}
      - NODE_CERT=/certs/node.crt
      - NODE_KEY=/certs/node.key
      - HUB_CA_CERT=/certs/ca.crt
    volumes: [scraper_certs:/certs]
```

### The `cmd-hub` CLI

```
cmd-hub start                      start the gateway
cmd-hub ca-init                    generate hub CA (first deploy)
cmd-hub ca-export-cert             print CA cert for nodes to trust
cmd-hub node-add <name>            generate nodeId/token/cert triple; print
cmd-hub node-rotate-token <id>     rotate a node's token
cmd-hub node-list                  list registered nodes
cmd-hub node-remove <id>           permanently deregister a node
cmd-hub version
```

### The `cmd-node` CLI

```
cmd-node start                     start the node (reads node.json)
cmd-node version
```

### Built-in admin commands on the gateway

```
/node list                         show all nodes with state, last-seen, count
/node show <id>                    show manifest, current metrics, hardware
/node approve <id>                 PENDING → ACTIVE
/node deregister <id>              ACTIVE → DISABLED
/node forget <id>                  remove from allowlist
/node reload <id>                  send ConfigReload to node
```

All `/node` subcommands require `ctx.manager.isAdmin`.

---

## Metrics (v1 scope)

Nodes expose metrics at two grains:

- **Hardware info** at `Register` time: CPU cores, total memory, OS, arch, hostname. Immutable for the session.
- **Gauges/counters/histograms** schema in the manifest; values sampled and sent over the Heartbeat stream. Default sampling interval: 15s.

Gateway stores recent samples in MongoDB and displays them via `/node show <id>`.

**In v1 the gateway does not use metrics for routing decisions.** The router is round-robin. A `scoreNode(metrics)` hook exists in the code with a constant default, ready for a v2 replacement without refactoring the router.

---

## Testing strategy

Five test surfaces, three CI tiers.

### Surfaces

1. **Contract tests** for protobuf encode/decode round-trips and validation. `packages/cmd-hub/src/grpc/__tests__/contract.test.ts`. Fast.

2. **Hub-side unit tests** for `CmdNodeRegistry`, `CommandPool` (including round-robin and user-override), `FileService` + `GridFSBackend` (mocked), default `ICertVerifier` / `ITokenVerifier` impls.

3. **Node-side unit tests** for manifest validation (mandatory fields), event adapter (every `BaseCommandService` event type round-trips into the right `InvokeServer` variant), `receiveMsg` dispatch.

4. **Integration tests** over loopback gRPC with `mongo-memory-server` (single-node replica set). Covers: registration, invocation, streaming events, intercom reverse channel, file emit via grant, GridFS readback, disconnect mid-invoke, hotplug during active session, duplicate-manifest rejection, round-robin distribution, contention between two nodes on the same `AccountModule`.

5. **Golden scraper test** — the regression gate. A deterministic `FakeSource` yields 50 known `OrgData` records with fixed pacing; the test asserts the exact sequence of emitted events, the exact CSV content (read via `FileService` from GridFS), and the final `done` text. Assertions are captured once from the current monolith in Phase 0 and run against the rewritten distributed stack. Same assertions both sides.

### CI tiers

- **Fast** (every commit, <30s): contract + unit.
- **Medium** (every PR, <3 min): integration with mongo-memory-server.
- **Slow** (every PR, parallel, <2 min): golden scraper.

### Deliberately not tested in v1

External PKI flows, Mongo partition behavior, real Telegram API, `docker-compose up` (manual smoke at milestones), load/benchmarks.

---

## Migration: big-bang rewrite

The monolith is **not** kept runnable during the rewrite. The golden scraper test is the regression boundary across the jump.

### Phase 0 — Capture ground truth, freeze the protobuf

1. Write the golden scraper test against the current monolith. Assertion values are captured from the monolith's actual run and hard-coded as canonical expected values.
2. Freeze `.proto` files in `packages/cmd-hub/src/grpc/`. Generate TS bindings, commit.
3. Freeze the names, layout, and decisions from this spec.
4. Feature-freeze the monolith.

### Phase 1 — Build both packages from scratch in parallel

**`packages/cmd-hub/`:** `CmdHubApp` with `useUI()`, split `CmdDispatcher`, `CmdNodeRegistry`, `CommandPool`, `FileService` + `GridFSBackend`, auth-seam defaults, rewritten built-ins, gateway CLI. Reuse `BaseCommandService`, `ServiceDashboard`, `MessageLifecycle`, `ConfigRegistry`, MongoDB models from the monolith by copying them in (logic unchanged, location may move).

**`packages/cmd-node/`:** `CmdNodeApp` with `useCommands()` / `useServices()`, manifest builder with mandatory-field validation, event adapter over `BaseCommandService`, `receiveMsg` dispatch, `MetricsCollector`, node CLI.

Exit: both compile, unit tests green, contract tests green.

### Phase 2 — Real gRPC, integration tests, golden test

1. gRPC server in cmd-hub, gRPC client in cmd-node.
2. mTLS fixtures for integration tests; `cmd-hub ca-init` / `node-add` for real deployments.
3. Integration tests green, including the duplicate-manifest, hotplug, and two-node contention cases.
4. Run the golden scraper test on the loopback-gRPC stack. Must match the Phase 0 assertions exactly.

### Phase 3 — Container everything

1. `examples/telegram-ui-app/` bootstrap, `Dockerfile`, config.
2. `examples/scraper-node/` bootstrap, `Dockerfile`, config.
3. `docker-compose.yaml` with mongo, cmd-hub, scraper-node.
4. Move `packages/org-scraper/` → `examples/scraper-node/`, `packages/app/` → `examples/telegram-ui-app/`. Update npm workspaces.
5. `docker-compose up`; `/scraper` works in live Telegram; golden test green against the containerized stack.

### Phase 4 — Framework polish and tag

1. `packages/create-cmd-node/` template with a trivial `/echo` sample command.
2. READMEs at every package; top-level "hello world in 10 lines".
3. `docs/roadmap.md` listing v2 seams.
4. Remove dead monolith source. Tag v1.0.0.

### Risks specific to the big-bang approach

- **Dashboard event-ordering regression.** gRPC preserves order per stream; we additionally assert monotonic sequence numbers in the event adapter and the golden test fails loudly on text-content drift.
- **Mongo transaction semantics under concurrent node writes.** One integration test intentionally contends two simulated nodes on the same `AccountModule` to surface issues before production.
- **Scope drift / monolith drift.** The rewrite branch is protected. Monolith bugs discovered during the rewrite are accepted as known and fixed only in the rewrite.

---

## Future Auth Extensions (v2 commitments)

These are not optional long-term. v1 must not block them.

- External PKI via `ICertVerifier`.
- Pluggable `ITokenVerifier` (external auth services).
- HSM/TPM-backed `ITokenStore` on nodes.
- MongoDB CSFLE behind `ISecretStore` for `SystemConfig` and `AccountModule` secrets.
- Signed audit log of `/config`, `/sconfig`, `/node` mutations.

v1 code routes cert checks, token checks, and secret reads/writes through these interfaces even though v1 only ships the internal implementations.

---

## Out of scope for v1

- Multi-gateway load balancing or HA.
- Metric-aware routing (scoring hook exists, default constant).
- S3 / cloud-object-store backends (FileService interface exists, only GridFS implemented).
- External PKI and stronger auth (v2).
- Mongo client-side encryption (v2).
- Non-Telegram UI plugins (framework supports them; examples don't ship them).

---

## Verification

End-to-end verification runs against the containerized stack after Phase 3:

1. `docker-compose up -d` brings up mongo, cmd-hub, and at least one scraper-node.
2. `cmd-hub node-list` from the gateway container shows the scraper-node as `ACTIVE` (with `AUTH_AUTO_REGISTER=true`) or `PENDING` (then `ACTIVE` after `/node approve`).
3. From a real Telegram chat, `/help` lists `scraper`.
4. `/scraper query="coffee shops" city="Berlin"` starts; dashboard renders progress; intercom "Export Now" triggers a file that appears as a CSV in Telegram.
5. Scale scraper-node to 2 replicas (`docker-compose up --scale scraper-node=2`). New `/scraper` invocations round-robin across the two; `/node list` shows both; `/node show <id>` shows distinct metrics and hardware info per node.
6. Kill one scraper-node mid-invocation. The gateway surfaces a stream error into the dashboard; partial snapshot is preserved.
7. The automated golden scraper test is run against the containerized stack (not just the loopback stack from Phase 2) and passes with the same assertions captured in Phase 0.
8. Contract + unit + integration test suites pass in CI.

All eight steps pass before tagging v1.0.0.
