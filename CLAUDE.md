# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

npm workspaces with 3 packages:

- **`packages/cmd-hub/`** (`@cmd-hub/core`) — SDK framework: UI, command processor, services, dashboard, message lifecycle
- **`packages/org-scraper/`** (`org-scraper`) — Scraper plugin: sources (Google, Yandex, Avito, cheerio-based), exporters (CSV, Google Sheets), dedup
- **`packages/app/`** (`scrap-hub`) — Main app: bootstrap, proxy, registers org-scraper plugin + custom cheerio sources

## Build & Run

```bash
npm install            # Install all packages
npm run build          # Build all
npm run start          # Run the app (packages/app)
npm run test           # Run SDK tests
```

## Key Path Aliases (in app tsconfig)

| Alias | Resolves to |
|-------|-------------|
| `@core/*` | `../cmd-hub/src/*` |
| `@logger` | `../cmd-hub/src/application/logger` |
| `@utils/*` | `../cmd-hub/src/utils/*` |
| `org-scraper/*` | `../org-scraper/src/*` |

## Architecture

### App Bootstrap (`packages/app/src/index.ts`)
1. `initializePlugins()` → registers org-scraper sources/exporters/config
2. `CmdDispatcher` + commands from org-scraper
3. `TelegramUI` with proxy support (SOCKS/HTTPS from env vars)
4. `AppCmdhub` — lifecycle, MongoDB, signals

### Scraper Plugin (`packages/org-scraper/`)
- **Sources**: Google (SerpAPI), Yandex (XML API), Yandex Business, Avito, cheerio-based custom
- **Exporters**: CSV, Google Sheets
- **Service**: `OrgScraperService` with dashboard, progress bars, intercom export button
- **Config**: `scraper` module in ConfigRegistry (MongoDB system scope)

### Custom Cheerio Sources
Registered in `packages/app/src/commands.ts`:
```typescript
orgScraper.registerCheerioSource({
    name: '2gis',
    urlTemplate: 'https://2gis.ru/search/{query}/page/{page}',
    itemSelector: '._1hf7139',
    selectors: { name: '...', phone: '...', address: '...' },
})
```

## Config
- `packages/app/config.json` — bootstrap: bot token, MongoDB URI
- MongoDB `SystemConfig` — scraper API keys via `/config scraper`
- MongoDB `AccountModule` — per-service saved config via `/sconfig`
