# Deploying the distributed cmd-hub

This guide walks through bringing up the reference stack defined by the
root `docker-compose.yaml`: one `mongo` replica set, one `cmd-hub` gateway
hosting the Telegram UI plugin, and one `scraper-node` running the
org-scraper as a cmd-node.

## Prerequisites

- Docker + docker compose (v2)
- A Telegram bot token (from `@BotFather`)
- Network egress for the hub (so Telegraf can reach `api.telegram.org`) —
  if your deployment is behind a proxy, set `ALL_PROXY` or `HTTPS_PROXY`
  in `examples/telegram-ui-app/config/hub.env`.

## First-run sequence

### 1. Prepare env files

    cp examples/telegram-ui-app/config/hub.env.example examples/telegram-ui-app/config/hub.env
    cp examples/scraper-node/config/node.env.example   examples/scraper-node/config/node.env

Fill in `hub.env`: at minimum `TELEGRAM_BOT_TOKEN`, and (optionally) a
list of admin Telegram user IDs in `TELEGRAM_ADMIN_USER_IDS`.

Leave `node.env` with placeholder values for now; step 3 generates real
credentials and prints them for you to paste in.

### 2. Build the images

    docker compose build

### 3. Generate the CA and provision the scraper-node's credentials

Start mongo + the hub in isolation so the CLI subcommands have a Mongo to
write the allowlist to:

    docker compose up -d mongo
    # Wait until healthy, then:
    docker compose up -d cmd-hub

On first boot `cmd-hub` will refuse to start if no CA is provisioned.
Initialize one from inside the container:

    docker compose exec cmd-hub \
      sh -c "HUB_CA_KEY=/tmp/ca.key HUB_CA_CERT=/tmp/ca.crt node packages/cmd-hub/build/src/cli/cmd-hub-cli.js ca-init"

Provision the scraper node:

    docker compose exec cmd-hub \
      node packages/cmd-hub/build/src/cli/cmd-hub-cli.js node-add scraper-1 --auto-activate

The command prints JSON containing `nodeId`, `token`, `cert`, `key`, and
`hubCaCert`. Paste the `nodeId` and `token` into
`examples/scraper-node/config/node.env`:

    NODE_ID=<copied from JSON>
    NODE_TOKEN=<copied from JSON>

> **v1 caveat.** The compose stack in this repo runs the gRPC control
> plane with `createInsecure` credentials — no mTLS. Move to Phase-2 mTLS
> by wiring `hubServerCredentialsFromPaths` / `nodeChannelCredentialsFromPaths`
> and dropping the cert/key files into volumes. Tracked as a v2 roadmap
> item in `docs/superpowers/specs/2026-04-23-cmd-hub-distributed-design.md`.

### 4. Bring up the full stack

    docker compose up -d

Watch the logs:

    docker compose logs -f cmd-hub scraper-node

You should see:

    [telegram-ui-app] gRPC server listening on 0.0.0.0:50051
    [telegram-ui-app] upload endpoint listening on :3000
    [scraper-node] Invoke server listening on 0.0.0.0:50052
    [scraper-node] registered: pollInterval=15000ms state=1
    [telegram-ui-app] node registered: <nodeId> @ scraper-node:50052
    [telegram-ui-app] ready

### 5. Verify end-to-end

In Telegram, send `/help` to the configured bot. You should see at least:

    /config     built-in
    /help       built-in
    /node       built-in
    /sconfig    built-in
    /service-ctrl   built-in
    /scraper    nodes: <nodeId>@1.0.0

Then fire a small scrape:

    /scraper query=coffee city=Berlin limit=10 sources=google format=csv

The bot replies with a stream of status lines. Exports land in MongoDB
GridFS (see the FileHandle emitted on completion).

## Scale and failure verification

Before tagging v1.0.0, run these manual checks:

### Scale up to two scraper nodes

Provision a second node:

    docker compose exec cmd-hub \
      node packages/cmd-hub/build/src/cli/cmd-hub-cli.js node-add scraper-2 --auto-activate

Write its creds into a second env file, say `examples/scraper-node/config/node2.env`,
add a `scraper-node-2` service to `docker-compose.yaml` referencing it,
then:

    docker compose up -d scraper-node-2

Verify both are ACTIVE:

    docker compose exec cmd-hub \
      node packages/cmd-hub/build/src/cli/cmd-hub-cli.js node-list

Fire four `/scraper` invocations from Telegram. Check the two nodes'
logs — round-robin should give each node 2 of the 4 invocations.

### Kill one node mid-invocation

Start a long `/scraper` run in Telegram, then:

    docker compose kill scraper-node

In Telegram you should see an error line along the lines of "node went
offline". The session's partial progress is persisted in MongoDB's
`AccountModule` collection.

Restart the node:

    docker compose up -d scraper-node

`/node list` should show it ACTIVE again with an updated `last-seen`.

## Automated end-to-end test

The `tests/e2e/golden-container.test.ts` suite runs the same golden
scraper regression as Phase 2.7 but against the containerized stack.

    # 1. docker compose up -d
    # 2. wait for cmd-hub "ready" line in logs
    npm run test:e2e

The test exits non-zero on any deviation from the captured fixture.

## Security notes

The compose stack ships with several defense-in-depth defaults:

- `mongo` runs as uid:gid 999:999 with all Linux capabilities dropped.
- All services enable `no-new-privileges` and mount the rootfs read-only
  (app-writable state goes to a named volume or `tmpfs:/tmp`).
- Both app images drop to the unprivileged `node` user (uid 1000).

What's still out of scope for v1:

- TLS between the hub and the Telegram API is handled by Telegraf's defaults.
- **mTLS between the hub and nodes** is wired (see `hubServerCredentialsFromPaths`
  in `@cmd-hub/core`) but this reference compose uses `createInsecure()` for
  ease of first-run. Swap in the TLS credential helpers before exposing the
  gRPC port beyond a private network.
- Rate-limiting on `/upload` and per-user dispatch quotas — v2.
- Client-side encryption of SystemConfig / AccountModule secrets — v2.

See the v2 roadmap in `docs/superpowers/specs/2026-04-23-cmd-hub-distributed-design.md`
for the full list.
