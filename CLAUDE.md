# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Monorepo Structure

npm workspaces. Framework packages under `packages/`, distributed plugins under `plugins/`, runnable reference apps under `examples/`.

### Framework packages (`packages/`)

| Path | npm name | Role |
|---|---|---|
| `packages/common/` | `@cmd-hub/common` | Shared primitives: `Application`, `Phase`, capability registry, command decorators (`@CmdService`, `@CmdArgument`, `@CmdCommand`), logger, base service, manifest types, utils, types |
| `packages/core/` | `@cmd-hub/core` | Hub-side: `CmdHubApp`, `CmdDispatcher`, command processor, builder/interpreter, dashboard, built-in commands, `RemoteCmdInvoker`, hub CLI |
| `packages/transport/` | `@cmd-hub/transport` | gRPC bindings, `ManifestAggregator`, `CommandPool`, `FileService`, `CmdNodeRegistry`, server impl |
| `packages/node/` | `@cmd-hub/node` | Node-side: `CmdNodeApp`, `HubClientMiddleware`, `InvokeServerMiddleware`, executor |

### Plugins (`plugins/`) — distributed with the framework, opt-in per app

| Path | npm name | Role |
|---|---|---|
| `plugins/storage/mongo/` | `@cmd-hub/storage-mongo` | MongoDB middleware: connection, repos, GridFS file backend |
| `plugins/ui/cli/` | `@cmd-hub/ui-cli` | CLI UI plugin |
| `plugins/ui/telegram/` | `@cmd-hub/ui-telegram` | Telegram UI plugin (Telegraf, proxy support) |
| `plugins/ui/web/` | `@cmd-hub/ui-web` | Web UI plugin |

### Reference apps

| Path | Role |
|---|---|
| `examples/ui-app/` | Hub gateway with a swappable UI plugin (telegram / cli / web). Edit `src/ui/index.ts` to pick. |
| `examples/scraper-node/` | cmd-node: registers `OrgScraperService`, sources (Google/Yandex/Avito/cheerio), exporters (CSV, Google Sheets) |

## Distributed Architecture

One **cmd-hub** gateway hosts UI plugins and dispatches commands. N **cmd-nodes** execute services. They communicate over gRPC (mTLS in v1).

- **Storage**: shared MongoDB + GridFS in v1. v2 pivot: hub-seeded session blob; nodes never see user records (see memory note).
- **Manifest**: each node publishes a `NodeManifest` at register time. Hub aggregates via `ManifestAggregator` and routes by command name (round-robin per command, per UI eligibility).
- **Capabilities**: middlewares publish/consume typed `CapabilityKey<V>` objects. UIs declare `federationRequires.{essential,supported}` for cross-tier validation.
- **Phases**: middleware install order — `Infrastructure(10) → Storage(20) → Transport(30) → BeforeServices(39) → Services(40) → UI(50)`.

## Build & Run

```bash
npm install                       # Install all workspaces
npm run build                     # Build everything (tsc --build per package)
npm run start:hub                 # Start the gateway (examples/ui-app)
npm run start:node                # Start a node (examples/scraper-node)
npm run start:docker              # Compose stack
```

Tests live per-package: `cd packages/<name> && npx jest` (or `cd plugins/ui/<name>` for UI plugins). End-to-end: `npm run test:e2e`.

## Imports

Packages reference each other by their npm names (`@cmd-hub/core`, `@cmd-hub/common`, etc.). **No `paths` aliases** — the old `@core/*`/`@utils/*`/`@logger` shims are gone.

## Hub Bootstrap (`examples/ui-app/src/index.ts`)

The active UI is selected by `src/ui/index.ts`, which re-exports a `uiFactory` from `./telegram`, `./cli`, or `./web`. Swap the import to swap the UI; everything else stays.

```typescript
import { uiFactory } from './ui'

const app = new CmdHubApp({ configPath: './config.json', baseSchema })
app.use(new MongoStorageMiddleware())
app.use(new GrpcServerMiddleware({ insecure: true }))
app.useUI(uiFactory())
await app.Initialize(); await app.run()
```

## Node Bootstrap (`examples/scraper-node/src/index.ts`)

```typescript
const app = new CmdNodeApp({ configPath: './config.json', baseSchema })
app.useCommand(OrgScraperService)
app.use(new MongoStorageMiddleware())
app.use(new InvokeServerMiddleware())
app.use(new HubClientMiddleware())
await app.Initialize(); await app.run()
```

`CmdNodeApp.Initialize()` provides `CAP_NodeExecutor` early; `CAP_NodeManifest` is built once at `Phase.BeforeServices` (after Storage/Transport caps are published) so `publishedCapabilities` is complete before HubClient registers.

## Config

Each app has a `config.json` at its root. Schemas are zod-validated and merged from middleware/UI `ConfigContributor`s. Namespaces are flat (`storage.*`, `hub.*`, `invokeServer.*`, `scraper.*`, etc.).

- `examples/ui-app/config.json` — Telegram bot token, MongoDB URI, gRPC bind, hub-CA paths (only the slice for the active UI is consumed)
- `examples/scraper-node/config.json` — Mongo URI, hub address+token+nodeId+cert fingerprint, scraper API keys

Per-user / per-service runtime config is persisted via `MongoServiceStore` (account modules collection).

## CLI

Hub provisioning: `npx cmd-hub <subcommand>`. See `docs/cli.md` and `docs/node-deployment.md`.

```bash
npx cmd-hub ca-init                       # generate hub CA
npx cmd-hub node-add <name>               # provision a node (issues token + fingerprint)
npx cmd-hub node-list / node-approve / node-remove
```

## Command argument model

Commands declare arguments via `@CmdArgument` properties on a data class. The decorator desugars each property into a node of an `OptionsTree`:

- a property whose `design:type` is a constructable class becomes a **branch**, walked recursively;
- everything else becomes a **leaf** carrying `type` / `required` / `position` / `standalone` / `default` / `options[]` / `validator` / `displayHint`.

The same tree feeds the hub-side builder UI, the wire (`treeToProto` in transport, `protoToTree` on the way back), and node-side `unflattenValue` (which reconstructs the typed nested object from the flat dot-path map). Wire keys are slash-delimited: services use slice prefixes (`config/aiAgent/model`, `params/sessionId`, `messages/...`); one-shots use bare paths.

Static `options: string[]` is the only declarative way to constrain values — runtime resolvers can't ride the wire. Validators run **node-side** after `unflattenValue`; on failure the node emits a `ValidationFailed` envelope and the hub re-prompts only the failed leaf via `CBParser.focusLeaf`.

## Testing notes

- Test mocks for ESM-only deps live under `packages/common/src/__mocks__/` (e.g. `chalk`).
- `jest.config.js` in each package wires `moduleNameMapper` for those mocks.
- 322 unit tests across common (94) + transport (27) + core (94) + node (54) + storage-mongo (19) + scraper-node (34).

## Documentation

- `docs/README.md` — index
- `docs/cli.md` — CLI reference
- `docs/node-deployment.md` — node deployment + security model
- `docs/roadmap.md` — v2 commitments and seam locations
