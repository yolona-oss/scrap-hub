# cmd-hub

**A distributed command-framework for bots.** One gateway hosts UI plugins; N execution nodes connect over gRPC + mTLS and expose commands to every UI. Hotplug new commands at runtime by standing up a new node — no gateway restart.

## Hello, world in 10 lines

Provision a node with the hub operator, then:

```bash
npx create-cmd-node my-node
cd my-node
npm install
npm run build

export NODE_ID=...           # from `cmd-hub node-add <name> --auto-activate`
export NODE_TOKEN=...
export HUB_ADDRESS=localhost:50051
node build/src/index.js
```

Your new `/echo` command is now live in every UI plugin the hub hosts.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    cmd-hub (gateway)                         │
│                                                              │
│   UI plugin ──▶  CmdDispatcher  ──▶  built-ins             │
│   (Telegram,                │                                │
│    web, CLI,                └──▶  node router               │
│    …)                               │                        │
│                                     │   gRPC + mTLS          │
│                                     ▼                        │
│                         ┌──────────────────────┐             │
│                         │  CmdNodeRegistry +   │             │
│                         │  ManifestAggregator  │             │
│                         └──────────┬───────────┘             │
└────────────────────────────────────┼─────────────────────────┘
                                     │
                     ┌───────────────┼───────────────┐
                     ▼               ▼               ▼
               ┌───────────┐   ┌───────────┐   ┌────────────┐
               │ scraper-  │   │ other-    │   │ MongoDB    │
               │ node      │   │ node      │   │ (+ GridFS) │
               └───────────┘   └───────────┘   └────────────┘
```

Two tiers: a **cmd-hub** process hosting UI plugins, and N **cmd-node** processes running commands. Every command declares `{name, compatibility_id, version}` in its manifest; the hub forms routing pools from compatible declarations and round-robins across peers.

See [`CLAUDE.md`](CLAUDE.md) and [`docs/roadmap.md`](docs/roadmap.md) for repo layout and v2 commitments.

## Repository layout

```
packages/
  common/      Shared primitives: Application, Phase, capabilities, decorators.
  core/        Hub-side: CmdHubApp, dispatcher, command processor, built-ins, CLI.
  transport/   gRPC bindings, ManifestAggregator, CommandPool, FileService.
  node/        Node-side: CmdNodeApp, HubClient, InvokeServer.

plugins/
  storage/mongo/   MongoDB middleware: connection, repos, GridFS file backend.
  ui/telegram/     Telegram UI plugin (Telegraf, proxy support).
  ui/cli/          CLI UI plugin.
  ui/web/          Web UI plugin.

examples/
  telegram-ui-app/  Deployable: cmd-hub gateway + Telegram UI plugin.
  scraper-node/     Deployable: the org-scraper running as a cmd-node.

docs/
  deploy/README.md  First-run sequence for docker-compose, scale/kill checks.
  roadmap.md        v2 commitments (external PKI, CSFLE, S3, metric-aware routing).
```

## Getting started (operator)

See [`docs/deploy/README.md`](docs/deploy/README.md) for the full first-run sequence. Short version:

```bash
# Copy the .env templates and fill in your Telegram bot token.
cp examples/telegram-ui-app/config/hub.env.example examples/telegram-ui-app/config/hub.env
cp examples/scraper-node/config/node.env.example   examples/scraper-node/config/node.env

# Build + bring up mongo + hub, provision a node, then bring everything up.
docker compose build
docker compose up -d mongo cmd-hub
docker compose exec cmd-hub \
  node packages/core/build/src/cli/cmd-hub-cli.js node-add scraper-1 --auto-activate
# Paste nodeId/token into scraper-node config, then:
docker compose up -d
```

## Getting started (plugin author)

See [`packages/cmd-node/README.md`](packages/cmd-node/README.md) for the plugin author API. Short version: `npx create-cmd-node`, implement your `InvokeExecutor`, run.

## Getting started (UI plugin author)

See [`packages/core/README.md`](packages/core/README.md) for the framework API. Implement `IHubUIPlugin`, call `dispatcher.handle(...)` on incoming commands, render events back to your users.

## Running the tests

```bash
# per-package tests (fast)
npm test --workspace=@cmd-hub/core
npm test --workspace=cmd-node

# end-to-end against a docker-compose stack (slow; requires the stack up)
npm run test:e2e
```

## Status

**v1.0.0** — framework is functionally complete, with 150+ tests covering the
full gRPC + Mongo + FileService stack plus a golden scraper regression. The
reference compose stack uses `createInsecure()` gRPC; flip to mTLS before
exposing the gateway port beyond a private network.

v2 commitments tracked in [`docs/roadmap.md`](docs/roadmap.md): external PKI,
client-side encryption for user secrets, S3 file backend, metric-aware
routing, rate-limiting on `/upload`, multi-gateway HA.

## License

ISC (see individual `package.json` files).
