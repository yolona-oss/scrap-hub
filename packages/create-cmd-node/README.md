# create-cmd-node

Scaffold a new [cmd-node](../cmd-node) project.

## Usage

```bash
npx create-cmd-node my-node
cd my-node
npm install
npm run build
```

The generated project ships a working `/echo` command, all the boilerplate for registering with the hub + maintaining a heartbeat, and a Dockerfile that drops to an unprivileged user.

## What the scaffold produces

```
my-node/
├── package.json          # dependencies on @cmd-hub/core, cmd-node
├── tsconfig.json
├── src/
│   └── index.ts          # bootstrap + /echo executor — edit this
├── Dockerfile            # multi-stage, non-root
├── .env.example          # NODE_ID / NODE_TOKEN / HUB_ADDRESS
└── .gitignore
```

## What to edit

- **`src/index.ts`** — replace the `echoExecutor` with your own `InvokeExecutor`. Register your command with `app.useCommand({...})` (remember the mandatory `compatibilityId` + `version`). That's it.
- **`package.json`** — version + description + any runtime dependencies your executor needs.

Everything else (registration, heartbeat, manifest build, graceful shutdown) is boilerplate you can leave alone.

## Running against a hub

Provision credentials with the hub operator:

```bash
# On the hub host:
docker compose exec cmd-hub \
    node packages/cmd-hub/build/src/cli/cmd-hub-cli.js \
    node-add my-node --auto-activate
```

Paste the printed `nodeId` and `token` into your `.env`, then:

```bash
source .env
node build/src/index.js
```

Your command is now live in every UI plugin the hub hosts.

## See also

- [`packages/cmd-node`](../cmd-node/README.md) — full plugin-author API reference.
- [`packages/cmd-hub`](../cmd-hub/README.md) — framework + UI-plugin-author API.
- [`docs/deploy/README.md`](../../docs/deploy/README.md) — docker-compose deployment.
