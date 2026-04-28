/**
 * Active UI selection.
 *
 * Edit the re-export below to swap which UI the app boots:
 *
 *   ./telegram   — Telegraf-backed bot (production default)
 *   ./cli        — readline REPL for local debugging
 *   ./web        — Express + socket.io browser UI
 *
 * Each module exports a `uiFactory: () => IUI<...>` that the bootstrap
 * in `../index.ts` plugs into `app.useUI(...)`.
 */
export { uiFactory } from './telegram'
