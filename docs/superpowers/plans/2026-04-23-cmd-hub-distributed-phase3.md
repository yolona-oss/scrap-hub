# cmd-hub Distributed — Phase 3 — Containerize everything

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal of Phase 3:** Move `packages/org-scraper/` and `packages/app/` to `examples/`. Write Dockerfiles for hub and scraper-node. Write `docker-compose.yaml`. Verify the whole stack works end-to-end via a live Telegram bot and via the automated golden test against the containerized deployment.

**Exit criteria:** `docker-compose up` brings up three containers (mongo, cmd-hub, scraper-node). `/scraper` works end-to-end in a real Telegram chat. Golden scraper test passes against the containerized stack.

---

### Task 3.1: Move `packages/app/` to `examples/telegram-ui-app/`

**Files:**
- Move via `git mv`: `packages/app/` → `examples/telegram-ui-app/`
- Modify: root `package.json` — add `examples/*` to the workspaces array
- Modify: `examples/telegram-ui-app/tsconfig.json` — update relative paths (`../../tsconfig.base.json`, `../../packages/cmd-hub/...`)
- Rewrite: `examples/telegram-ui-app/src/index.ts` — the new bootstrap around `CmdHubApp.useUI(TelegramUI)`
- Create: `examples/telegram-ui-app/Dockerfile`
- Create: `examples/telegram-ui-app/config/hub.json.example`

- [ ] **Step 1: Move files**

```
git mv packages/app examples/telegram-ui-app
```

- [ ] **Step 2: Update workspace paths.** In root `package.json`:

```json
{
  "workspaces": ["packages/*", "examples/*"]
}
```

Run `npm install`. Verify `node_modules/scrap-hub` resolves to the new location.

- [ ] **Step 3: Rewrite the bootstrap** at `examples/telegram-ui-app/src/index.ts`:

```ts
import { CmdHubApp } from '@cmd-hub/core';
import { TelegramUI } from '@cmd-hub/core/ui/impls/telegram/telegram-ui';
import { loadConfig } from './config';

async function main() {
  const cfg = loadConfig();
  const app = new CmdHubApp({
    mongoUrl: cfg.mongo.url,
    hubPublicBaseUrl: cfg.hub.publicBaseUrl,
    autoRegister: cfg.hub.autoRegister,
  });
  app.useUI(new TelegramUI(cfg.bot.token));
  await app.start();

  process.on('SIGINT',  async () => { await app.stop(); process.exit(0); });
  process.on('SIGTERM', async () => { await app.stop(); process.exit(0); });
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Write the Dockerfile** at `examples/telegram-ui-app/Dockerfile`:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/cmd-hub ./packages/cmd-hub
COPY packages/cmd-node ./packages/cmd-node
COPY examples/telegram-ui-app ./examples/telegram-ui-app
RUN npm ci --include=dev
RUN npm run build --workspace=@cmd-hub/core
RUN npm run build --workspace=scrap-hub

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
EXPOSE 50051
CMD ["node", "examples/telegram-ui-app/build/src/index.js"]
```

- [ ] **Step 5: Write `config/hub.json.example`:**

```json
{
  "mongo": { "url": "mongodb://mongo:27017/cmdhub?replicaSet=rs0" },
  "hub": {
    "publicBaseUrl": "http://cmd-hub:50051",
    "autoRegister": false,
    "grpcPort": 50051,
    "certFiles": {
      "ca": "/certs/ca.crt",
      "cert": "/certs/hub.crt",
      "key":  "/certs/hub.key"
    }
  },
  "bot": { "token": "REPLACE_WITH_TELEGRAM_BOT_TOKEN" }
}
```

- [ ] **Step 6: Smoke build**

Run: `(cd examples/telegram-ui-app && npm run build)`. Expected: clean compile.

- [ ] **Step 7: Commit.** Message: `chore: move packages/app to examples/telegram-ui-app and rewrite bootstrap around CmdHubApp`.

### Task 3.2: Move `packages/org-scraper/` to `examples/scraper-node/`

**Files:**
- Move via `git mv`: `packages/org-scraper/` → `examples/scraper-node/`
- Modify: `examples/scraper-node/tsconfig.json` — update relative paths
- Modify: `examples/scraper-node/package.json` — rename to `scraper-node`, add `cmd-node` dep
- Create: `examples/scraper-node/src/index.ts` — bootstrap around `CmdNodeApp.useCommand`/`useService`
- Create: `examples/scraper-node/Dockerfile`
- Create: `examples/scraper-node/config/node.json.example`

- [ ] **Step 1: Move files and update workspace**

```
git mv packages/org-scraper examples/scraper-node
```

Rename `package.json` name field from `org-scraper` to `scraper-node`. Add `cmd-node` to dependencies.

- [ ] **Step 2: Write the bootstrap** at `examples/scraper-node/src/index.ts`:

```ts
import { CmdNodeApp } from 'cmd-node';
import { OrgScraperService } from './scraper-service/service';
import { SCRAPER_NAME, SCRAPER_DESCRIPTION } from './constants';
import pkg from '../package.json';
import { loadConfig } from './config';

async function main() {
  const cfg = loadConfig();
  const app = new CmdNodeApp({
    nodeId: cfg.node.id,
    nodeName: pkg.name,
    version: pkg.version,
    hubAddress: cfg.hub.address,
    mongoUrl: cfg.mongo.url,
  });

  app.useService({
    command: {
      name: SCRAPER_NAME,
      compatibilityId: 'com.example.scrap-hub.scraper',
      version: pkg.version,
      description: SCRAPER_DESCRIPTION,
      args: [],  // the service's arg schema already lives in service-data.ts
      aliases: [],
    },
    intercomActions: [{ id: 'export', label: 'Export Now', icon: '' }],
    caps: { supportsPause: true, supportsStop: true },
    serviceClass: OrgScraperService,
  });

  await app.start();
  process.on('SIGINT',  async () => { await app.stop(); process.exit(0); });
  process.on('SIGTERM', async () => { await app.stop(); process.exit(0); });
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Write the Dockerfile** (analogous to Task 3.1's, but copying `examples/scraper-node` and using `node examples/scraper-node/build/src/index.js` as the entrypoint).

- [ ] **Step 4: Write `config/node.json.example`:**

```json
{
  "node": {
    "id": "REPLACE_WITH_NODE_ID",
    "token": "REPLACE_WITH_NODE_TOKEN",
    "certPath": "/certs/node.crt",
    "keyPath":  "/certs/node.key"
  },
  "hub": {
    "address": "cmd-hub:50051",
    "caCertPath": "/certs/ca.crt"
  },
  "mongo": { "url": "mongodb://mongo:27017/cmdhub?replicaSet=rs0" }
}
```

- [ ] **Step 5: Commit.** Message: `chore: move packages/org-scraper to examples/scraper-node and rewrite bootstrap around CmdNodeApp`.

### Task 3.3: docker-compose + mongo replica-set helper

**Files:**
- Create: `docker-compose.yaml` at repo root
- Create: `scripts/mongo-init-rs.sh`
- Create: `docs/deploy/README.md`

- [ ] **Step 1: `docker-compose.yaml`:**

```yaml
services:
  mongo:
    image: mongo:7
    command: ["--replSet", "rs0", "--bind_ip_all"]
    volumes:
      - mongo_data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping')"]
      interval: 5s
      timeout: 3s
      retries: 20

  mongo-init:
    image: mongo:7
    depends_on:
      mongo:
        condition: service_healthy
    entrypoint: ["/bin/sh", "/scripts/mongo-init-rs.sh"]
    volumes:
      - ./scripts:/scripts:ro
    restart: "no"

  cmd-hub:
    build:
      context: .
      dockerfile: examples/telegram-ui-app/Dockerfile
    depends_on:
      mongo-init:
        condition: service_completed_successfully
    environment:
      - MONGO_URL=mongodb://mongo:27017/cmdhub?replicaSet=rs0
      - HUB_PUBLIC_BASE_URL=http://cmd-hub:50051
      - HUB_CA_CERT=/certs/ca.crt
      - HUB_SERVER_CERT=/certs/hub.crt
      - HUB_SERVER_KEY=/certs/hub.key
      - AUTH_AUTO_REGISTER=false
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
    ports:
      - "50051:50051"
    volumes:
      - hub_certs:/certs

  scraper-node:
    build:
      context: .
      dockerfile: examples/scraper-node/Dockerfile
    depends_on:
      - cmd-hub
    environment:
      - HUB_ADDRESS=cmd-hub:50051
      - MONGO_URL=mongodb://mongo:27017/cmdhub?replicaSet=rs0
      - NODE_ID=${SCRAPER_NODE_ID}
      - NODE_TOKEN=${SCRAPER_NODE_TOKEN}
      - NODE_CERT=/certs/node.crt
      - NODE_KEY=/certs/node.key
      - HUB_CA_CERT=/certs/ca.crt
    volumes:
      - scraper_certs:/certs

volumes:
  mongo_data:
  hub_certs:
  scraper_certs:
```

- [ ] **Step 2: `scripts/mongo-init-rs.sh`:**

```bash
#!/bin/sh
set -e
mongosh --host mongo --eval '
  try {
    rs.status();
    print("replica set already initialized");
  } catch (e) {
    rs.initiate({_id: "rs0", members: [{_id: 0, host: "mongo:27017"}]});
    print("replica set initialized");
  }
'
```

Make executable: `chmod +x scripts/mongo-init-rs.sh`.

- [ ] **Step 3: Write the deploy README** at `docs/deploy/README.md`:

Document the first-run sequence step by step:
1. `docker compose build`
2. Generate the CA and a node credential triple inside the `cmd-hub` container:
   ```
   docker compose run --rm cmd-hub cmd-hub ca-init
   docker compose run --rm cmd-hub cmd-hub node-add scraper-1 --auto-activate
   ```
   Capture the printed JSON; paste `nodeId`, `token`, `cert`, `key` into the `scraper-node` volume and a `.env` file.
3. `docker compose up -d`
4. Check `docker compose logs cmd-hub` for "listening on :50051".
5. Verify node is ACTIVE:
   ```
   docker compose run --rm cmd-hub cmd-hub node-list
   ```
6. In a Telegram chat with the configured bot, send `/help` — should list `scraper`.
7. Run a full scrape end-to-end: `/scraper query="coffee shops" city="Berlin" sources=google limit=10 format=csv`.

- [ ] **Step 4: Smoke test manually.** This is not CI-automated. Document the result in the deploy README if anything required manual adjustment.
- [ ] **Step 5: Commit.** Message: `chore: add docker-compose with mongo replica-set, cmd-hub, and scraper-node`.

### Task 3.4: Golden test against the containerized stack

**Files:**
- Create: `tests/e2e/golden-container.test.ts`
- Create: `jest.config.e2e.js`
- Create: `tests/e2e/README.md` — how to run

**Setup:**
- Test requires `docker compose up -d` to have been run first. It's a manual pre-condition, not an `execSpawn` from the test.
- Test connects to the hub's gRPC port (`localhost:50051`) using a test client that impersonates a UI plugin: dispatches `/scraper ...`, captures events, reads the resulting file via the hub's `FileService`.
- Assertions identical to Phase 2's `golden-scraper.test.ts` — same fixture comparison.

**`jest.config.e2e.js`:** Node environment, 90-second default timeout, no unit-test `testMatch` overlap.

**README:** documents `npm run test:e2e` convention and the required `TELEGRAM_BOT_TOKEN` stub (not actually used since the test bypasses Telegram; but the hub container needs it present to boot).

Commit. Message: `test: add e2e golden test against the containerized stack`.

### Task 3.5: Scale and kill verification — documented manual steps

**Files:**
- Modify: `docs/deploy/README.md` — add a "Scale & failure verification" section

Document these as manual verification steps required before tagging v1.0.0:

1. **Scale up:** `docker compose up -d --scale scraper-node=2`. Provision a second node's credentials first; inject them via a second env-var set or a second named volume.
2. Run `cmd-hub node-list` — expect both nodes ACTIVE.
3. Invoke `/scraper` four times in succession. Verify from `docker compose logs scraper-node-1` and `scraper-node-2` that invocations round-robin.
4. Run `/scraper` and, mid-invocation, kill one scraper-node: `docker compose kill scraper-node-1`.
5. Verify the UI shows a stream error and the session state in Mongo (`cmdhub.session_contexts`) transitions to `FAILED`.
6. Restart the killed node: `docker compose up -d scraper-node-1`. Verify it reappears in `cmd-hub node-list` as ACTIVE.

Commit. Message: `docs(deploy): add scale and failure verification checklist`.

---

*Phase 3 complete once all five tasks pass. Verify:*

- [ ] `docker compose up -d` works end-to-end
- [ ] Live `/scraper` produces a CSV in the configured Telegram chat
- [ ] `tests/e2e/golden-container.test.ts` passes
- [ ] Scale and kill manual verification documented and executed successfully

*Phase 4 continues in `2026-04-23-cmd-hub-distributed-phase4.md`.*
