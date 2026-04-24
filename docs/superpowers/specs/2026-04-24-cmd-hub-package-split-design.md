# cmd-hub Package Split and Runtime Integration — Design Spec

**Date:** 2026-04-24
**Status:** Proposed
**Author:** brainstorm session with xewiy
**Supersedes:** the package-layout, middleware, and bootstrap sections of `2026-04-23-cmd-hub-distributed-design.md`.
**Carries forward unchanged from 2026-04-23:** transport (gRPC+mTLS), authentication (mTLS + pre-shared token, internal CA v1, external PKI v2), file storage (FileService with GridFS backend v1, S3 v2), command identity (mandatory `compatibility_id + version`, peer-equality, round-robin routing with user override), hotplug semantics (manifest immutable per connection, node-failure surfaces error, no auto-retry), big-bang migration strategy.

## Context

The 2026-04-23 design produced a working distributed layer (all primitives land; 150 tests passing; golden scraper regression passes end-to-end over gRPC). It accomplished the transport + federation work correctly.

It also failed — twice — to integrate with the existing `cmd-hub` framework. Phase 1 built a parallel `packages/cmd-hub/src/distributed/` subtree that duplicated the dispatcher, built-ins, and orchestration, and ignored most of the framework's existing value: the `CmdDispatcher` chain-of-responsibility handlers, `@CmdArgument`-driven argument parsing, `CommandBuilder` multi-step UX, `ServiceDashboard` live progress rendering, `Application`/`AppCmdhub` lifecycle with `LockManager`, `MessageLifecycleManager` crash-recovery, and the `IUIPlugin` interceptor contract. Phase 3 wrote a stripped-down `TelegramHubUI` instead of using the real `TelegramUI`, and compensated for missing features with inline hacks.

This spec's purpose is to restructure the codebase so **existing framework code becomes the primary execution path**, not a codebase bypassed by a parallel distributed layer. The distributed primitives themselves (protobuf contracts, registry, pool, FileService, gRPC server+client, mTLS, upload endpoint) are retained intact and repositioned into a dedicated transport package.

The restructuring produces seven packages, each with a clear responsibility boundary, following NestJS's scoped-package convention (`@cmd-hub/*`). The hub and node halves are split so a node deployer doesn't install UI-framework code and vice versa.

After this spec is implemented, the existing framework features work across distributed boundaries without parallel reimplementation: a command defined on a node and registered via `app.useCommand(ServiceClass)` exposes itself to the hub's text dispatcher, and users type `/scraper query=coffee` into Telegram with the full `CommandBuilder`, `ServiceDashboard`, and intercom-button UX — over gRPC.

Out of scope for this spec (carried forward unchanged from 2026-04-23): multi-gateway HA, metric-aware routing, S3 file backend, external PKI, client-side encryption for Mongo-stored secrets.

---

## Package Layout

Seven packages. Package `name` in `package.json` is scoped as `@cmd-hub/<role>`. Filesystem directory stays hyphenated (`packages/cmd-hub-<role>/`) for npm workspace compatibility.

| Filesystem path | Package `name` | Role |
|---|---|---|
| `packages/cmd-hub-common/` | `@cmd-hub/common` | Authoring primitives + `Application` base. No repo dependencies. |
| `packages/cmd-hub-transport/` | `@cmd-hub/transport` | Distributed primitives: federation, protobuf, FileService, gRPC. |
| `packages/cmd-hub-core/` | `@cmd-hub/core` | **Hub-only** runtime: `CmdHubApp`, `CmdDispatcher`, handler chain, dashboards, built-ins, middlewares. |
| `packages/cmd-hub-node/` | `@cmd-hub/node` | **Node-only** runtime: `CmdNodeApp`, `HubClient`, `InvokeServer`, event adapter. |
| `packages/cmd-hub-ui-telegram/` | `@cmd-hub/ui-telegram` | Telegram UI implementation. |
| `packages/cmd-hub-ui-cli/` | `@cmd-hub/ui-cli` | CLI UI implementation. |
| `packages/cmd-hub-ui-web/` | `@cmd-hub/ui-web` | Web UI implementation. |

### Dependency graph

```
@cmd-hub/common              (no repo deps)
@cmd-hub/transport           → @cmd-hub/common
@cmd-hub/core                → @cmd-hub/common, @cmd-hub/transport
@cmd-hub/node                → @cmd-hub/common, @cmd-hub/transport
@cmd-hub/ui-telegram         → @cmd-hub/common, @cmd-hub/core
@cmd-hub/ui-cli              → @cmd-hub/common, @cmd-hub/core
@cmd-hub/ui-web              → @cmd-hub/common, @cmd-hub/core
```

`@cmd-hub/core` and `@cmd-hub/node` are **siblings**: neither depends on the other. A hub deployer installs `@cmd-hub/core` + one or more `@cmd-hub/ui-*`. A node deployer installs `@cmd-hub/node` + `@cmd-hub/transport` (transitively via `@cmd-hub/node`). Neither pulls in the other's code.

### Package contents

**`@cmd-hub/common`** — everything both tiers need:
- `@CmdArgument` decorator, `CommandArgumentHolder`, `CmdArgumentProxy`, argument metadata machinery
- `@CmdService` class decorator (new, see § Command Registration)
- `BaseCommandService`, `CmdServiceData`, `GlobalServiceConfig`, `GlobalServiceParam`, `GlobalServiceMessages`
- `BaseUI` class, `IUI<Ctx>` interface, `IUIPlugin` interceptor interface, `BaseUIContext`
- `Application` base class + middleware machinery (see § Application and Middleware)
- `LockManager` utility (not installed by default)
- `UiUnicodeSymbols`, `TableDesigner`, `escapeHtml`, `MessageType`, keyboard helpers

**`@cmd-hub/transport`** — distributed primitives (mostly unchanged from 2026-04-23):
- Protobuf contracts + generated TypeScript bindings
- `CmdNodeRegistry`, `CommandPool`, `ManifestAggregator`
- `FileService`, `GridFSBackend` (opaque `FileHandle`)
- Auth seams (`ICertVerifier`, `ITokenVerifier`) + internal implementations
- `MetricStore`
- gRPC server (`CmdHubServiceServer`), gRPC client (`GrpcCmdNodeClient`, `InMemoryChannelResolver`)
- mTLS helpers (`hubServerCredentialsFromPaths`, `mTlsFingerprintResolver`)
- `/upload` endpoint factory
- `FileHandle`, `WriteGrant`, `NodeRecord`, `NodeState`, `SessionContext` types
- `ca.ts` helpers (CA creation + node cert signing)

**`@cmd-hub/core`** — hub-only runtime:
- `CmdHubApp extends Application` with `.useUI()` + `.use()`
- `CmdDispatcher` (existing; unchanged in behavior, import path moves)
- Handler chain: `AliasHandler`, `BuilderHandler`, `SequenceHandler`, `AbstractCmdHandler`
- `CommandBuilder`, `MsgBonder`
- `RemoteCmdInvoker` (**replaces** `CommandInvoker`) — see § Dispatch
- `ServiceDashboard` (**refactored to event-sink interface**) — see § Dashboard
- `MessageLifecycleManager`
- Built-in commands: `/help`, `/config`, `/sconfig`, `/node`, `/service-ctrl`, existing `built-in-cmd/*` — `/help` and `/config` modified to read from aggregated manifest
- Hub-side middlewares: `MongoMiddleware`, `ProxyMiddleware`, `GrpcServerMiddleware`, `UploadEndpointMiddleware`, `CmdNodeClientMiddleware`, `AppLockMiddleware`
- `cmd-hub` CLI (start, ca-init, node-add, node-rotate-token, node-list, node-remove)

**`@cmd-hub/node`** — node-only runtime:
- `CmdNodeApp extends Application` with `.useCommand()`, `.useCommands()`, `.useService()`, `.use()`
- `HubClientMiddleware` (calls `Register`, maintains Heartbeat)
- `InvokeServerMiddleware` (hosts `CmdNodeService`)
- `EventAdapter` (wraps `BaseCommandService` emissions into `InvokeServer` protobuf)
- `IntercomDispatch` (routes `InvokeClient.Intercom` → `service.receiveMsg`)
- `HardwareInfo`, `MetricsCollector`
- `cmd-node` CLI (start with config validation)

**`@cmd-hub/ui-telegram`, `@cmd-hub/ui-cli`, `@cmd-hub/ui-web`** — concrete UI implementations that extend `BaseUI`. Unchanged in behavior; moved out of `@cmd-hub/core` so apps only install the UI they use.

### Placement decisions worth calling out

- **`Application` lives in `@cmd-hub/common`**, not `@cmd-hub/core`. Both hub and node extend one `Application` base. Mongo connect, `ConfigRegistry` migration, and app-locking are opt-in middlewares, not baked-in lifecycle steps.
- **`BaseCommandService` lives in `@cmd-hub/common`** so nodes can extend it without pulling in `@cmd-hub/core`.
- **Handler chain + `CmdDispatcher` live in `@cmd-hub/core`**, not `@cmd-hub/common`. Nodes don't parse text messages or resolve aliases; they receive structured `InvokeStart` messages over gRPC. The dispatcher is hub-specific.
- **LockManager** moves from `cmd-hub` to `@cmd-hub/common` but is **not installed automatically**. Deployments opt in via `app.use(new AppLockMiddleware({ lockFile }))`. Kubernetes deployments that enforce single-instance via pod identity don't need file-based locking.

---

## Application and Middleware

One `Application` base class, hybrid middleware interface, phase-based installation ordering.

### `Application` base class

Lives in `@cmd-hub/common`. Owns:
- The `use()` machinery (middleware registry).
- Signal handling (`SIGINT`/`SIGTERM` → `terminate()`).
- Uncaught-exception interceptor (`setErrorInterceptor(fn)`).
- `Initialize()` → builds the manifest (on node side) or the built-in registry (on hub side), then runs all middlewares' `install(app)` grouped by phase.
- `run()` → subclass hook. Hub calls `ui.run()`; node resolves once heartbeat is established.
- `terminate()` → reverse-order middleware `uninstall(app)`, then subclass cleanup.

```ts
export abstract class Application {
    use(middleware: AppMiddleware | IAppMiddleware): this
    Initialize(): Promise<void>
    abstract run(): Promise<void>
    terminate(): Promise<void>
    readonly phase: Phase // current installation phase during Initialize
}
```

### Middleware interface (hybrid)

```ts
export type AppMiddleware =
    | IAppMiddleware
    | ((app: Application) => Promise<() => Promise<void> | void> | Promise<void> | void)

export interface IAppMiddleware {
    readonly name?: string
    readonly phase: Phase   // which phase this runs in
    install(app: Application): Promise<void> | void
    uninstall?(app: Application): Promise<void> | void
}
```

`app.use(...)` normalizes function-form middleware into `IAppMiddleware` internally. A function middleware can return a teardown closure; the framework wraps that closure as the `uninstall` handler.

### Installation phases

Enum in `@cmd-hub/common`:

```ts
export enum Phase {
    Infrastructure = 10,   // env, proxy, app-lock, logger
    Storage        = 20,   // mongoose connect, config migration
    Transport      = 30,   // gRPC server, /upload endpoint, cmd-node client resolver
    Services       = 40,   // manifest publish, HubClient Register + Heartbeat
    UI             = 50,   // UI plugins start last
}
```

`Initialize()` sorts all registered middlewares by phase (ties broken by registration order) and calls `install()` in order. `terminate()` calls `uninstall()` in reverse order (highest phase first).

### Canonical middlewares shipped with the framework

Every middleware reads its runtime inputs from `app.config` during `install(app)`. **Middleware constructors are parameterless in the common case** — all config flows through the composable config schema described in § Configuration. No middleware reads `process.env`.

**Shared middlewares** (usable on either tier; live in `@cmd-hub/common`):
- `AppLockMiddleware` — Infrastructure. Contributes `appLock: { lockFile }`.
- `ProxyMiddleware` — Infrastructure. Contributes `proxy: { socks?, https? }`. Exposes chosen agent on `app.context.httpAgent`.
- `MongoMiddleware` — Storage. Contributes `mongo: { url, migrateConfigRegistry? }`. On the hub, `migrateConfigRegistry: true` triggers `ConfigRegistry.migrateToMongoDB()`.

**Hub-only middlewares** (live in `@cmd-hub/core`):
- `GrpcServerMiddleware` — Transport. Contributes `grpc: { bindAddress, publicBaseUrl }` and `tls: { caCertPath, serverCertPath, serverKeyPath }`. Starts `CmdHubService` gRPC server with mTLS credentials built from the TLS slice.
- `UploadEndpointMiddleware` — Transport. Contributes `upload: { bindAddress }`. Mounts `/upload` Express endpoint.
- `CmdNodeClientMiddleware` — Transport. No config contribution. Wires `RemoteCmdInvoker` to dial nodes registered with `GrpcServerMiddleware`.

**Node-only middlewares** (live in `@cmd-hub/node`):
- `InvokeServerMiddleware` — Transport. Contributes `invokeServer: { bindAddress }` and (merging with the hub's server-cert slice if in the same process) `tls: { caCertPath, clientCertPath?, clientKeyPath? }`.
- `HubClientMiddleware` — Services. Contributes `hub: { address }` and `node: { id, name, version, token, listenBindAddress, certFingerprint? }`. Builds the manifest, calls `Register`, maintains Heartbeat.

### Configuration

Configuration is a first-class feature of `Application`. There is **no `.env` support anywhere in the framework**. `process.env` is not a supported configuration source; any use of it in framework, middleware, or example code is a review-gate failure.

**Configuration comes from a single JSON file** (typical paths: `./config.json`, `/etc/cmd-hub/config.json`).

**Schema is composable.** The application carries a small *base schema* that the user writes for their app-specific fields. Every middleware, UI plugin, and service that needs configuration **contributes its own schema slice** under a named namespace. The framework merges all contributor schemas with the base at `Initialize()` time, loads the config file, and validates the full union against the merged schema. `app.config` is the validated typed result.

```ts
export abstract class Application<Cfg = unknown> {
    readonly config: Cfg

    constructor(opts: {
        configPath: string                  // path to config.json
        baseSchema: z.ZodObject<any>        // user's root schema; contributors are merged in
    })
}

export interface ConfigContributor {
    /** Top-level key under which this contributor's fields nest. Must be unique unless
     *  multiple contributors declare disjoint keys under the same namespace. */
    readonly namespace: string
    /** Schema slice. Zod by default; the framework's merge logic accepts any ZodType. */
    readonly schema: z.ZodType<unknown>
}
```

Middlewares, UI plugins, and service classes implement `ConfigContributor` (services expose it as static fields so the framework reads it without instantiating the class). The framework walks all registered contributors at `Initialize()` start and extends the base schema with their slices.

### Contributor sources

Four places where contributors are discovered during `Initialize()`:

1. **Middlewares** registered via `.use(...)` — each `IAppMiddleware` may also implement `ConfigContributor`. Function-form middlewares can return a contributor by declaring `{ namespace, schema, install }`.
2. **UI plugins** registered via `.useUI(...)` — `BaseUI` subclasses may implement `ConfigContributor`.
3. **Service classes** registered via `.useCommand(ServiceClass)` — static fields `configNamespace` and `configSchema` declare their slice. Dynamic (per-instance) config stays inside the `@CmdService` config-data class; `configSchema` is for *static* configuration the service needs at runtime (API keys, request timeouts, etc.).
4. **Framework subclass** (`CmdHubApp`, `CmdNodeApp`) — may ship its own built-in contributors (e.g. `app-lock` if lock-file support is mandatory for that subclass).

### Merge semantics

At `Initialize()` start:

1. Start with `baseSchema` (what the user passed in — typically `z.object({ deployment: z.object({...}) })` or similar).
2. For each registered contributor, extend the root schema with `{ [namespace]: contributor.schema }`.
3. If two contributors claim the same top-level namespace with overlapping field keys, the merge throws a clear error at boot. If they claim the same namespace with *disjoint* field keys, the framework merges their schema slices field-by-field (`.merge()` in zod). This covers cases like `tls.*` being split between a server-cert-providing middleware and a client-cert-providing middleware in the same process.
4. Read `configPath`, `JSON.parse`, validate against the merged schema.
5. Freeze the result on `app.config` (typed as the full union).

### Failure modes

All throw from `Initialize()` before any middleware `install()` runs:
- `configPath` does not exist → `ENOENT`-class error with file path.
- File contents are not valid JSON → parse error, wrapped.
- Schema merge conflict (two contributors claim overlapping fields in the same namespace) → explicit error listing the conflicting contributors.
- Validation fails → zod's issue list surfaces directly, naming the offending path.

### Test path

Tests that want to skip file I/O pass an `inlineConfig` instead:

```ts
new CmdHubApp({
    configPath: '',               // ignored when inlineConfig is set
    baseSchema: MyAppConfigSchema,
    inlineConfig: { ... },        // pre-built, validates against the merged schema
})
```

Production code always uses `configPath`. When `inlineConfig` is set, the framework still runs the merged schema through zod to catch test-time schema drift.

### Example: how the pieces contribute

**Middleware contributing `mongo.*`:**

```ts
export class MongoMiddleware implements IAppMiddleware, ConfigContributor {
    readonly namespace = 'mongo'
    readonly schema = z.object({
        url: z.string().url(),
        migrateConfigRegistry: z.boolean().default(false),
    })
    readonly phase = Phase.Storage

    async install(app: Application<any>) {
        await mongoose.connect(app.config.mongo.url)
    }
}
```

**UI plugin contributing `telegram.*`:**

```ts
export class TelegramUI extends BaseUI implements ConfigContributor {
    readonly namespace = 'telegram'
    readonly schema = z.object({
        botToken: z.string().min(1),
        adminUserIds: z.array(z.coerce.number()).default([]),
    })

    protected async onAppAttach(app: Application<any>) {
        this.token = app.config.telegram.botToken
    }
}
```

**Service contributing `scraper.*` (static fields on the class):**

```ts
@CmdService({ /* ... */ })
export class OrgScraperService extends BaseCommandService<...> {
    static readonly configNamespace = 'scraper'
    static readonly configSchema = z.object({
        serpApiKey:     z.string().default(''),
        yandexXmlUser:  z.string().default(''),
        requestDelayMs: z.number().int().nonnegative().default(1000),
        userAgent:      z.string().default('Mozilla/5.0 ...'),
    })

    protected async runWrapper() {
        const key = this.appConfig.scraper.serpApiKey
        // ...
    }
}
```

**User's root schema** (typically short — just app-specific fields not owned by any plugin):

```ts
const MyAppConfigSchema = z.object({
    deployment: z.object({
        name: z.string().default('default'),
        adminContactEmail: z.string().email().optional(),
    }).default({}),
})
```

Every other section of the config file — `mongo.*`, `telegram.*`, `scraper.*`, `appLock.*`, `grpc.*`, `tls.*`, etc. — is contributed by the middleware/UI/service that owns it. The user never duplicates a plugin's schema; they just install the plugin and the schema grows automatically.

Canonical bootstrap (hub):

```ts
import { CmdHubApp, MongoMiddleware, ProxyMiddleware, AppLockMiddleware,
         GrpcServerMiddleware, UploadEndpointMiddleware, CmdNodeClientMiddleware
       } from '@cmd-hub/core'
import { TelegramUI } from '@cmd-hub/ui-telegram'
import { z } from 'zod'

const MyAppConfigSchema = z.object({
    deployment: z.object({ name: z.string().default('default') }).default({}),
})

const app = new CmdHubApp({
    configPath: process.argv[2] ?? './config.json',
    baseSchema: MyAppConfigSchema,
})
    .use(new AppLockMiddleware())       // contributes "appLock"
    .use(new ProxyMiddleware())         // contributes "proxy"
    .use(new MongoMiddleware())         // contributes "mongo"
    .use(new GrpcServerMiddleware())    // contributes "grpc", "tls"
    .use(new UploadEndpointMiddleware())// contributes "upload"
    .use(new CmdNodeClientMiddleware()) // no config
    .useUI(new TelegramUI())            // contributes "telegram"

await app.Initialize()
await app.run()
```

User's `baseSchema` is short — only their app-level `deployment` fields. Every plugin contributes its own slice; the merged schema is what validates `config.json`. Middleware constructors are parameterless in the common case; all runtime inputs come from `app.config`.

**Reference `config.json` shape** (hub):

```json
{
    "appLock": { "lockFile": "/var/run/cmdhub.lock" },
    "proxy":   { "socks": null, "https": null },
    "mongo":   { "url": "mongodb://mongo:27017/cmdhub?replicaSet=rs0" },
    "grpc":    { "bindAddress": "0.0.0.0:50051",
                 "publicBaseUrl": "http://cmd-hub:3000" },
    "upload":  { "bindAddress": "0.0.0.0:3000" },
    "tls":     { "caCertPath": "/certs/ca.crt",
                 "serverCertPath": "/certs/hub.crt",
                 "serverKeyPath":  "/certs/hub.key" },
    "telegram": { "botToken": "REDACTED" }
}
```

**Reference `config.json` shape** (node):

```json
{
    "node":   { "id": "...", "name": "scraper-1", "version": "1.0.0",
                "token": "REDACTED",
                "listenBindAddress": "0.0.0.0:50052",
                "certFingerprint": "..." },
    "hub":    { "address": "cmd-hub:50051" },
    "mongo":  { "url": "mongodb://mongo:27017/cmdhub?replicaSet=rs0" },
    "tls":    { "caCertPath": "/certs/ca.crt",
                "clientCertPath": "/certs/node.crt",
                "clientKeyPath":  "/certs/node.key" },
    "proxy":  { "socks": null, "https": null }
}
```

**Secrets handling.** Secrets (Telegram bot token, node tokens, TLS keys) live in the config file. Operators manage the file through their platform's secret-management: Docker secrets bind-mount into `/run/secrets/config.json`; Kubernetes mounts a `Secret` as a file. `config.json` must be readable only by the app's uid/gid (`0600`/`0400`). The framework does not log config contents.

### Config Access Patterns

Config must be reachable from most call sites in the framework — middlewares, built-in commands, services, dashboards, UI implementations, utility helpers that need runtime config. The framework exposes it through **three explicit channels**, one per execution context. There is no global `getConfig()`; every read site has a named channel that makes the dependency visible.

**1. `app.config` — direct on the `Application` reference.** Any code holding an `Application<Cfg>` (or its subclass) reads `app.config`. This covers:
- Middlewares: receive `app` in `install(app)`.
- Subclasses of `Application`: `this.config`.
- Hub-side primitives (`RemoteCmdInvoker`, built-in command factories, dashboard factories) — these are constructed by `CmdHubApp` during `Initialize()` and receive the `app` reference at construction time. `CmdDispatcher` gains a setter `setApp(app)` used by `CmdHubApp` for the same purpose.

**2. `ctx.appConfig` — on `BaseUIContext`.** Every command handler and every dispatch-chain consumer receives a `ctx: BaseUIContext`. The framework populates `ctx.appConfig: Cfg` when the context is created (early in the dispatch chain). This covers:
- Built-in command functions (`/help`, `/config`, `/sconfig`, `/node`, `/service-ctrl`).
- Custom function-typed commands registered against `CmdDispatcher` on the hub.
- Handler-chain hooks (alias/builder/sequence handlers) that need config for their decisions.

**3. `this.appConfig` — on `BaseCommandService` and `BaseUI`.** Both base classes expose a protected accessor populated by the framework at instantiation/attach time.
- `BaseCommandService.appConfig`: set by the node runtime when constructing a service to handle an `InvokeStart`.
- `BaseUI.appConfig`: set by `Application` when `.useUI(ui)` fires during `Phase.UI`.

### Interaction with `ConfigRegistry`

The monolith's `ConfigRegistry` is **not** replaced by `app.config`. It continues to serve its two runtime-mutable scopes:
- **System config** (shared, admin-editable via `/config`) — e.g. API keys that rotate without redeployment.
- **User config** (per-user overrides, editable via `/sconfig`).

The split:
- **`app.config`** — bootstrap-static values the deployer writes into `config.json`. Immutable per process. Mongo URL, bind addresses, TLS paths, bot tokens, hub address, node identity.
- **`ConfigRegistry`** — runtime-mutable values. Still stored in MongoDB, still edited via built-ins, still merged with bootstrap defaults at read time.

A service typically uses both: `this.appConfig.mongo.url` for static infrastructure, and `await ConfigRegistry.getSystem('scraper')` for rotatable API keys.

**Bootstrap migration during `MongoMiddleware.install()`** (when `migrateConfigRegistry: true` is set on the hub): modules registered with `ConfigRegistry.register({ scope: 'system', defaults: {...} })` at module-load time get their defaults seeded into MongoDB's `SystemConfig` collection. This is the monolith's existing `ConfigRegistry.migrateToMongoDB()` flow, preserved.

### No global state

No `getConfig()`, no static `Application.current`, no module-level cache. Every config read lives on one of the three explicit channels above. Tests inject configs by constructing an `Application` instance with the `inlineConfig` option (see § Test path above), then pass the `app` reference (or a ctx derived from it) to the code under test. Pure utility helpers (logger, crypto helpers, format functions) never read config — they receive what they need as arguments.

### Manifest lifecycle

Built **once** at the start of `Initialize()`, after all `.use()` / `.useCommand()` / `.useCommands()` / `.useService()` calls have completed. Immutable per run. Changing the manifest requires restarting the process.

On the node side, `HubClientMiddleware.install()` (Services phase) reads the pre-built manifest and sends it in `RegisterRequest`. If the node needs to change its manifest (new command added), restart.

---

## Command Registration

One class-level decorator plus argument-class decorators. The token handed to `useCommand(ClassToken)` is the service class.

### `@CmdService` decorator

New class-level decorator in `@cmd-hub/common`. Only valid on subclasses of `BaseCommandService`. Registration rejects the class if its data classes lack `@CmdArgument` metadata.

```ts
@CmdService({
    name: 'scraper',
    description: 'Search and collect organization data',
    compatibilityId: 'com.example.scraper',
    version: '1.0.0',
    config:   ScraperConfigData,
    params:   ScraperParamsData,
    messages: ScraperMessagesData,
})
export class OrgScraperService extends BaseCommandService<ScraperServiceDataType> {
    async receiveMsg(msg: string, args: string[]) { /* pause, resume, stop, export */ }
    protected async runWrapper() { /* actual work */ }
}
```

Four identity fields (`name`, `description`, `compatibilityId`, `version`) plus three data-class tokens. The framework reads them via `Reflect.metadata` at registration time.

### Data-class decoration requirements

All three field classes must be decorated via `@CmdArgument`. Framework rejects the service registration otherwise.

- `config` class extends `GlobalServiceConfig`. Fields are user-supplied command arguments (query, city, limit, etc.).
- `params` class extends `GlobalServiceParam`. Framework-scoped parameters (session id, etc.).
- `messages` class extends `GlobalServiceMessages`. Intercom action definitions (pause, resume, stop, export).

Each field uses `@CmdArgument({ required, position, description, pairOptions?, standalone?, defaultValue? })` exactly as in the existing framework.

### `useCommand` / `useCommands` / `useService`

Three node-side calls, all equivalent in behavior, differing only in shape:

```ts
app.useCommand(OrgScraperService)
app.useCommands([OrgScraperService, SomeOtherService])
// `useService` is an alias for `useCommand` kept for readability
app.useService(OrgScraperService)
```

All three append to a shared `Map<commandName, ServiceClass>` on the app. The manifest is built from this map at `Initialize()` time.

### Argument marshaling

Reuses `CommandArgumentHolder` unchanged (moved to `@cmd-hub/common`). A new static method handles the gRPC path:

```ts
CommandArgumentHolder.fromMap(DataClass, args: Record<string, string>): Instance
```

At `InvokeStart` time, the node runtime calls this for each of `config`/`params`/`messages`, then instantiates the service with the resulting triple. The text-input path (hub side, for built-ins only, since remote-routed commands never reach a text parser on the hub) continues to use the existing tokenized-input method.

### Manifest generation

`buildCommandFromDecorator(ServiceClass): ProtoCommand` in `@cmd-hub/common`:

1. Reads `@CmdService` metadata for `name`, `description`, `compatibilityId`, `version`.
2. For each of `config`/`params`/`messages` classes, walks its `@CmdArgument`-decorated fields.
3. Produces a flat `ArgSpec[]` — one entry per field, with `position`, `required`, `type`, `description`, `defaultValue`, `enumValues` (from `pairOptions`), `standalone`.
4. Returns the protobuf `Command` message.

The manifest is a list of these, one per registered service.

---

## Dispatch

`CommandInvoker` is replaced wholesale by `RemoteCmdInvoker`. The hub runs no services locally.

### Hub-side command kinds (post-rewrite)

Only two:

1. **Built-in functions** — `/help`, `/config`, `/sconfig`, `/node`, `/service-ctrl`. Registered in the local `CmdDispatcher.registry` as function-typed. Execute on the hub. Handler chain resolves aliases, applies builder/sequence logic, then invokes directly.

2. **Remote services** — everything else. Registered in the hub's `ManifestAggregator` via `CmdHubService.Register` calls from nodes. Handler chain resolves aliases/builder/sequence against the aggregated manifest, then `RemoteCmdInvoker` opens an `Invoke` gRPC stream to a pool member.

No local `BaseCommandService` execution on the hub. `active_services` is removed.

### `RemoteCmdInvoker`

Replaces `CommandInvoker`. Lives in `@cmd-hub/core`. Constructor takes:
- `ICmdNodeClient` (via `CmdNodeClientMiddleware`'s `resolver`)
- `ManifestAggregator`
- `DashboardFactory` (creates a `ServiceDashboard` bound to a `MessageLifecycleManager` session)

Per-invocation flow:
1. Resolve command name → pool member via `ManifestAggregator.getPool().pick(name, { nodeId? })`. Fail fast with `"no nodes available for /<name>"` if empty.
2. Generate a fresh `sessionId`.
3. Create a `ServiceDashboard` for this session (attaches to the UI).
4. Open an `Invoke` gRPC bidi stream via the `ICmdNodeClient`. Send `InvokeStart` with the user's args (flat `Record<string, string>` built from the text parse, since the hub still parses text — just dispatches remotely).
5. For each `InvokeServer` event arriving: translate into a `DashboardEvent` (see § Dashboard) and call `dashboard.onEvent(event)`.
6. Forward dashboard-initiated intercom clicks as `InvokeClient.Intercom` messages back up the stream (`dashboard.sendIntercom(actionId, args)` writes to the stream).
7. On node disconnect mid-invoke: emit `{ kind: 'error', text: 'node went offline' }` into the dashboard, close the session.
8. On `done`: finalize the dashboard, close the stream.

No local service instantiation. `ServiceDashboard` is **never** bound to a local EventEmitter.

### `CmdDispatcher` changes

The `CmdDispatcher.done()` initialization stays. The handler chain (`AliasHandler` → `BuilderHandler` → `SequenceHandler`) stays. The invocation step at the end changes:

- Today: `CommandInvoker.invokeService(cmdName, args, ctx, ui)` looks up a local service-or-function and runs it.
- After: if the resolved command is a built-in function → run locally. Otherwise → delegate to `RemoteCmdInvoker`.

The aggregated manifest is the second lookup source after the local built-in registry. `CmdDispatcher.toUICommands()` (for Telegram bot-commands list) returns the union of built-ins and remote commands — so `/help` and the Telegram command-list show everything.

### Manifest-from-node → hub routing table

When a node Registers, the hub's `CmdHubServiceImpl.register` calls `aggregator.attach(manifest)`. The manifest's `Command` list populates the `CommandPool`. When a text message `/foo bar=baz` arrives at the hub, the handler chain asks the dispatcher "is `/foo` local?" (no for non-built-ins) and then "is `/foo` in the aggregated manifest?" (yes → `RemoteCmdInvoker`).

---

## Dashboard (Event Sink)

`ServiceDashboard` becomes a pure event sink with no reference to a local service instance.

### New interface

```ts
export type DashboardEvent =
    | { kind: 'message';        text: string }
    | { kind: 'error';          text: string }
    | { kind: 'progress';       name: string; current: number; total: number }
    | { kind: 'progressStatus'; name: string; status: 'active' | 'done' | 'failed' | 'skipped' }
    | { kind: 'intercom';       actions: IntercomAction[] }
    | { kind: 'file';           handle: FileHandle }
    | { kind: 'done';           finalMessage: string }

export class ServiceDashboard {
    constructor(ui: IUI, userId: string, sessionId: string, options?: DashboardOptions)
    onEvent(event: DashboardEvent): void
    sendIntercom(actionId: string, args: string[]): Promise<void>   // invoker supplies callback
    attach(): Promise<void>                                          // sends initial dashboard message
    detach(): Promise<void>                                          // removes buttons, keeps snapshot
}
```

The constructor no longer takes a `service` instance. The `sendIntercom` method is configured with a callback by the `RemoteCmdInvoker` that opened the dashboard — the callback writes an `InvokeClient.Intercom` to the open gRPC stream.

### Removed methods

- `bindService(service)` — no services on the hub.
- `unbindService()` — same reason.

### Internals preserved

Debounced rendering (500ms `RENDER_DEBOUNCE_MS`). Channel toggles (message / error / log / progress / ctrl). Progress bar aggregation (parent progress over child sources). Intercom-button rendering with per-action callback ids. Telegram-message editing via `ui.editMessage()`. The existing rendering logic is unchanged — only the input interface flips from EventEmitter to `onEvent`.

---

## UI Implementations

The three UI implementations move out of `@cmd-hub/core` into dedicated packages. Each extends `BaseUI` (in `@cmd-hub/common`) and depends on `@cmd-hub/core` for `CmdDispatcher` / `CommandBuilder` / `MsgBonder` types.

Example Telegram bootstrap — see the "Canonical bootstrap (hub)" snippet in § Configuration. User writes only their app-level fields in `baseSchema`; every plugin contributes its own slice.

### `IUIPlugin` interceptor contract

Unchanged. UI plugins continue to expose `onBeforeSendMessage`, `onAfterSendMessage`, `onBeforeEditMessage`, `onBeforeDeleteMessage`, `onBeforeCommand`, `onAfterCommand`, `onInit`, `onTerminate`. `BaseUI.use(plugin)` still works. These hooks fire at the UI layer; they don't cross the gRPC boundary.

---

## Node Runtime

`CmdNodeApp extends Application`. Registers services via `.useCommand(ServiceClass)`. Uses middlewares for transport + heartbeat.

### Bootstrap shape

```ts
import { CmdNodeApp, MongoMiddleware, ProxyMiddleware,
         InvokeServerMiddleware, HubClientMiddleware } from '@cmd-hub/node'
import { OrgScraperService } from './scraper/service'
import { z } from 'zod'

const NodeAppSchema = z.object({
    deployment: z.object({ name: z.string().default('default') }).default({}),
})

const app = new CmdNodeApp({
        configPath: process.argv[2] ?? './config.json',
        baseSchema: NodeAppSchema,
    })
    .use(new ProxyMiddleware())        // contributes "proxy"
    .use(new MongoMiddleware())        // contributes "mongo"
    .use(new InvokeServerMiddleware()) // contributes "invokeServer", "tls"
    .use(new HubClientMiddleware())    // contributes "hub", "node", "tls"
    .useCommand(OrgScraperService)     // contributes "scraper"

await app.Initialize()
await app.run()
```

All configuration flows through `app.config`. No middleware reads `process.env`. Contributors declare their slices; the framework merges them with `NodeAppSchema` at `Initialize()` start and validates the resulting union against `config.json`.

### Run loop

Event-driven with heartbeat. `run()` resolves once `HubClientMiddleware` has successfully Registered and the Heartbeat bidi stream is open. The gRPC server + heartbeat timer keep the event loop alive. `terminate()` reverses middleware installation, tearing down heartbeat first, then the gRPC server, then middlewares in reverse order.

### InvokeStart handling

The Invoke server's request handler, on receiving an `InvokeStart`:

1. Looks up the service class in the node's `Map<name, ServiceClass>`.
2. Calls `CommandArgumentHolder.fromMap(configClass, start.args)` for each of config/params/messages → three populated data-class instances.
3. Constructs `new ServiceClass(start.userId, { config, params, messages })`.
4. Attaches an `EventAdapter` that forwards the service's `BaseCommandService` event emissions as `InvokeServer` messages on the gRPC stream.
5. Calls `service.Initialize()` then `service.run()` (existing `BaseCommandService` lifecycle).
6. Routes incoming `InvokeClient.Intercom` messages to `service.receiveMsg(actionId, args)`.
7. On `service.emit('done', msg)`, writes a final `InvokeServer{done}` and closes the stream.

### Hotplug semantics (carried forward)

- Manifest is immutable per connection; node must restart to change its manifest.
- Node failure mid-invoke causes the hub to surface a `StreamError` into the dashboard; no auto-retry.
- Round-robin routing within a pool with user `--node=<id>` override (unchanged from 2026-04-23).

---

## Migration Path

Big-bang rewrite within the rewrite. The existing `packages/cmd-hub/src/distributed/` subtree and `examples/telegram-ui-app/src/telegram-hub-ui.ts` are deleted wholesale. Test count drops accordingly (150 → some smaller number) and is rebuilt phase by phase against the new layout.

Five phases, each with its own exit criteria:

### Phase 1 — Create the package skeleton and move authoring primitives

1. Create `packages/cmd-hub-common/`, `packages/cmd-hub-transport/`, `packages/cmd-hub-node/`, `packages/cmd-hub-ui-telegram/`, `packages/cmd-hub-ui-cli/`, `packages/cmd-hub-ui-web/` as empty workspace packages.
2. Move into `@cmd-hub/common`:
   - `@CmdArgument`, `argument-holder.ts`, `arg-proxy.ts`
   - `BaseCommandService`, `CmdServiceData`, `Global*` classes
   - `BaseUI`, `IUI`, `IUIPlugin`, `BaseUIContext`
   - `UiUnicodeSymbols`, `TableDesigner`, `escapeHtml`
3. Add new `@CmdService` decorator to `@cmd-hub/common`.
4. Update imports in `packages/cmd-hub/`. Confirm `npm run build --workspaces` succeeds.

### Phase 2 — Move distributed primitives into `@cmd-hub/transport`

1. Move `packages/cmd-hub/src/distributed/`:
   - grpc (protos + generated)
   - files (FileService, GridFSBackend, upload endpoint)
   - auth
   - registry, pool, metrics
   - grpc-server, client
   - tls.ts, ca.ts helpers
   - `FileHandle`/`WriteGrant`/`NodeRecord` types
   → into `packages/cmd-hub-transport/src/`
2. Delete `packages/cmd-hub/src/distributed/` entirely.
3. Delete `packages/cmd-hub/src/cli/` (rewritten as part of `@cmd-hub/core` later).
4. Update imports. Build green.

### Phase 3 — Add `Application` middleware machinery

1. Move `Application` + `LockManager` from `packages/cmd-hub/src/application/` → `packages/cmd-hub-common/src/application/`.
2. Strip Mongo-connect and `ConfigRegistry.migrateToMongoDB()` from `Application.Initialize()` — these become middlewares.
3. Add `Phase` enum, `IAppMiddleware`, `AppMiddleware` function type, `ConfigContributor` interface.
4. Add `.use()` to `Application` with phase-sorted install/uninstall + config schema merging.
5. Add the file-loading + schema-validation flow at the start of `Application.Initialize()`.
6. Implement `MongoMiddleware`, `ProxyMiddleware`, `AppLockMiddleware` in `@cmd-hub/common` (shared; used by both tiers).
7. Refactor existing `AppCmdhub` to use the new `Application` shape. Temporary: it still registers a UI directly the old way; `.useUI()` comes in Phase 4.

### Phase 4 — Replace `CommandInvoker` with `RemoteCmdInvoker`; rewire `CmdDispatcher`

1. Delete `CommandInvoker` from `packages/cmd-hub/src/ui/command-processor/invoker.ts`.
2. Add `RemoteCmdInvoker` that takes `ICmdNodeClient` + `ManifestAggregator` + dashboard factory.
3. Modify `CmdDispatcher.handleCommand` to delegate to `RemoteCmdInvoker` when the resolved command is not a built-in function.
4. Refactor `ServiceDashboard` to the `onEvent` event-sink interface.
5. Add `GrpcServerMiddleware`, `UploadEndpointMiddleware`, `CmdNodeClientMiddleware` to `@cmd-hub/core`.
6. Rewrite `CmdHubApp` with `.useUI()` + `.use()` on top of the refactored `AppCmdhub`.
7. Modify `/help` to union local built-ins + aggregated manifest commands.
8. Modify `/config` to fan-out `ConfigReload` RPCs via the `ICmdNodeClient`.

### Phase 5 — Build `@cmd-hub/node` runtime

1. Implement `CmdNodeApp extends Application` in `packages/cmd-hub-node/` with `.useCommand()`, `.useCommands()`, `.useService()`.
2. Implement `HubClientMiddleware`, `InvokeServerMiddleware` (node-only, in `@cmd-hub/node`).
3. Port event-adapter + intercom-dispatch from the abandoned `packages/cmd-node/src/runtime/` into `packages/cmd-hub-node/src/runtime/`.
4. Delete the abandoned `packages/cmd-node/` package entirely (filesystem path and npm workspace entry).
5. Move the three UI implementations from `packages/cmd-hub/src/ui/impls/` into their own packages (`@cmd-hub/ui-telegram`, `@cmd-hub/ui-cli`, `@cmd-hub/ui-web`).
6. Rewrite `examples/telegram-ui-app/src/index.ts` to use `CmdHubApp.useUI(new TelegramUI())` with the real Telegram UI (parameterless; reads `botToken` from `app.config.telegram`).
7. Rewrite `examples/scraper-node/src/index.ts` to use `CmdNodeApp.useCommand(OrgScraperService)` after annotating `OrgScraperService` with `@CmdService`.
8. Annotate `OrgScraperService` with `@CmdService({...config: ScraperConfigData, params: ScraperParamsData, messages: ScraperMessagesData})` and add `static readonly configNamespace = 'scraper'` + `configSchema` for the static config slice.
9. Re-run the golden scraper test (still lives in `@cmd-hub/core` tests) through the new stack.

### Golden test as regression gate (unchanged from 2026-04-23)

`golden-harness.ts` + `expected-events.json` + `expected.csv` stay put. After every phase, the golden test must still pass (once the relevant plumbing is present — Phase 1 & 2 are pure moves, Phase 3 adds lifecycle, Phase 4 is where the hub dispatch path rewires, Phase 5 plugs the node in).

---

## Testing Strategy

Same five surfaces as the 2026-04-23 spec:

1. **Contract tests** for protobuf round-trips (`@cmd-hub/transport`).
2. **Hub-side unit tests**: `CmdNodeRegistry`, `CommandPool`, `ManifestAggregator`, `FileService`, auth verifiers, `ServiceDashboard.onEvent` variants.
3. **Node-side unit tests**: `CmdNodeApp.useCommand` validation, manifest build-from-decorator, `CommandArgumentHolder.fromMap`, `EventAdapter`, `IntercomDispatch`.
4. **Integration tests** (loopback gRPC, mongo-memory-server): register, invoke, stream events, intercom reverse channel, file emit via grant, disconnect mid-invoke, two-node round-robin, duplicate-manifest rejection.
5. **Golden scraper test** on the loopback stack, byte-identical to 2026-04-23 fixture.

Target: match or exceed the 150 tests the abandoned 2026-04-23 attempt produced, with coverage proportional to the new package-split surface.

---

## Out of Scope (v2 commitments carried forward)

- Multi-gateway HA (shared event bus, session affinity).
- Metric-aware routing (scoring hook exists; default stays constant).
- S3 / cloud-object-store file backend.
- External PKI (`ICertVerifier` pluggable backends).
- Mongo client-side encryption (CSFLE via `ISecretStore`).
- Rate-limiting on `/upload`.
- `SessionIndex` wiring into dispatcher for end-to-end intercom-through-dispatcher.

See `docs/roadmap.md` (also carried forward).

---

## Verification

End-to-end verification against the reference `docker-compose.yaml` after Phase 5 completes:

1. `docker compose up -d` brings up mongo, cmd-hub, scraper-node.
2. `cmd-hub node-list` from the hub container shows the scraper-node ACTIVE.
3. `/help` in Telegram lists `/scraper` alongside all built-ins.
4. `/scraper query="coffee shops" city="Berlin"` runs end-to-end: dashboard renders with real progress bars, intercom buttons ("Export Now") appear, pause/resume/stop work via inline keyboard clicks, CSV is emitted and reachable via Telegram's file download.
5. Scale scraper-node to 2 replicas. Four `/scraper` invocations round-robin.
6. Kill one node mid-invoke. Dashboard shows stream error. Partial snapshot preserved in Mongo.
7. Golden scraper test passes on the containerized stack via `npm run test:e2e`.
8. All per-package unit + integration tests pass.

All eight steps pass before the rewrite is considered complete.
