# cmd-hub examples

Two reference deployables that together exercise the full distributed stack:

- **`telegram-ui-app/`** — a `cmd-hub` gateway running the Telegram UI plugin.
- **`scraper-node/`** — a `cmd-node` running the org-scraper (Google / Yandex / Avito / cheerio sources, Google Sheets export, AI agent).

The Telegram UI dispatches a `/scraper` invocation over gRPC to the scraper-node, the node streams progress + results back into the Telegram dashboard, and the user can press the dashboard's **Export** button to push results to Google Sheets.

## Prerequisites (host-side)

- Node 20+
- MongoDB running on `127.0.0.1:27017` (no auth, default port)
- Ollama running on `127.0.0.1:11434` with `qwen2.5:7b` pulled (the AI-agent default)

## Run modes

### 1. No-docker (default; dev iteration)

```bash
npm install
npm run build
npm run start:hub      # starts cmd-hub + Telegram UI on 50051 + 8081
npm run start:node     # in another terminal — starts scraper-node on 50061
```

Configs: `examples/telegram-ui-app/config.json`, `examples/scraper-node/config.json`.
Both use `127.0.0.1` to reach Mongo + Ollama.

### 2. Docker

```bash
npm run start:docker   # builds both images, brings up the stack
npm run stop:docker
```

Compose mounts `examples/*/config.docker.json` over `/config/config.json` inside each container. Those configs use `host.docker.internal` so containers reach the host's Mongo + Ollama. The compose file injects `extra_hosts: ["host.docker.internal:host-gateway"]` so the name resolves on Linux.

## Configs

All configs are gitignored to keep tokens out of git. Both layouts are namespaced — each middleware/UI contributes its own slice:

| Slice | Owner | Purpose |
|---|---|---|
| `appLock` | `AppLockMiddleware` | PID lock-file path |
| `proxy` | `ProxyMiddleware` | Optional SOCKS/HTTPS proxy for outbound traffic |
| `storage` | `MongoStorageMiddleware` | Mongo connection URL |
| `gridfs` | `GridFsStorageMiddleware` | File-upload HTTP endpoint |
| `grpc` | `GrpcServerMiddleware` | Hub-side gRPC server bind address |
| `telegram` | `TelegramUI` | bot token / name / admin user IDs |
| `invokeServer` | `InvokeServerMiddleware` | Node-side gRPC server bind |
| `hub` | `HubClientMiddleware` | Address + identity the node uses to register with the hub |
| `scraper` | `OrgScraperService` | API keys + the AI agent (Ollama) defaults |

## AI agent

The scraper's AI agent uses the OpenAI SDK pointed at any OpenAI-compatible endpoint. The default config targets Ollama (`http://127.0.0.1:11434/v1`, model `qwen2.5:7b`). Swap `model` to any tool-calling-capable model you've pulled.

## Federation requirements (Phase C)

`TelegramUI.federationRequires.essential = [CAP_StorageConnection, CAP_ServiceStore]`. A node missing either won't be routed scraper traffic from the Telegram UI. The scraper-node example publishes both via `MongoStorageMiddleware`, so it's eligible.
