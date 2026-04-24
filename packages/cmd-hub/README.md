# @cmd-hub/core

The **cmd-hub** framework + gateway runtime. This package:

- Defines the shared types every tier uses (`FileHandle`, `WriteGrant`, `NodeRecord`, `SessionContext`).
- Provides the gateway-side primitives: `CmdNodeRegistry`, `ManifestAggregator`, `CommandPool`, `HubDispatcher`, `SessionIndex`, `FileService` + `GridFSBackend`.
- Implements the hub's gRPC `CmdHubService` (Register, Heartbeat, CreateWriteGrant) and the `/upload` HTTP endpoint.
- Ships all five federation built-ins (`/help`, `/config`, `/sconfig`, `/node`, `/service-ctrl`).
- Provides the auth seams (`ICertVerifier`, `ITokenVerifier`) with internal implementations (bcrypt tokens, X.509 fingerprints) and the CLI for CA init + node provisioning.

Plugin authors that write a cmd-node depend on [`cmd-node`](../cmd-node) instead. UI plugin authors depend on this package.

## UI plugin author API

A UI plugin implements `IHubUIPlugin`:

```ts
import type { HubDispatcher, SessionIndex, IHubUIPlugin, InvokeServer } from '@cmd-hub/core'

class MyUI implements IHubUIPlugin {
    async start(ctx: { dispatcher: HubDispatcher; sessions: SessionIndex }) {
        // Set up your transport (HTTP, websocket, CLI REPL, whatever).
        // On each incoming command, call:
        const result = await ctx.dispatcher.handle({
            command: 'scraper',
            args: { query: 'coffee', city: 'Berlin' },
            userId: '12345',
            uiHandle: /* anything opaque; your UI plugin gets it back */ null,
            onEvent: (e: InvokeServer) => {
                if (e.message !== undefined)   this.reply(e.message.text)
                if (e.progress !== undefined)  this.updateProgress(e.progress)
                if (e.done !== undefined)      this.finalize(e.done.finalMessage)
            },
        })
        // result.markup.text is the terminal status summary.
    }

    async stop() { /* teardown */ }
}
```

See [`examples/telegram-ui-app`](../../examples/telegram-ui-app) for a complete UI plugin (Telegraf-backed).

## Gateway orchestration

A full gateway composes its primitives explicitly:

```ts
import {
    CmdNodeRegistry, ManifestAggregator, SessionIndex, MetricStore,
    FileService, GridFSBackend,
    HubDispatcher, GrpcCmdNodeClient, InMemoryChannelResolver,
    CmdNodeServiceClient,
    makeNodeBuiltIn, makeHelpBuiltIn, makeConfigBuiltIn,
    makeSConfigBuiltIn, makeServiceCtrlBuiltIn,
    MongoSystemConfigStore, MongoAccountModuleStore,
    InternalTokenVerifier,
    startHubGrpcServer, makeUploadEndpoint,
} from '@cmd-hub/core'

// mongoose.connect + connection management is the app's responsibility.
// See examples/telegram-ui-app/src/index.ts for the canonical composition.
```

## Authentication

The hub ships with internal implementations of the two auth seams:

- `InternalCertVerifier` — SHA-256 fingerprint match against the allowlist. Swap in an implementation of `ICertVerifier` that checks against an external PKI (Vault, step-ca, AWS Private CA) — see [`docs/roadmap.md`](../../docs/roadmap.md).
- `InternalTokenVerifier` — bcrypt against the allowlist.

For mTLS, pass `grpc.ServerCredentials.createSsl(...)` to `startHubGrpcServer`; the helpers in `hubServerCredentialsFromPaths` read PEM files and build the right credential object. Set `resolveFingerprint: mTlsFingerprintResolver()` so the service impl reads the peer cert from the live TLS session instead of a metadata header.

## File storage

`FileService` wraps a `FileServiceBackend`. v1 ships `GridFSBackend` only; swap in an S3 backend later without changing node or UI code (see roadmap). The `/upload` endpoint validates a capability-grant token (constant-time comparison, CWE-117-safe log line) and pipes bytes into the backend.

## CLI

`@cmd-hub/core` installs a `cmd-hub` CLI binary:

```
cmd-hub ca-init                       Generate the gateway's self-signed CA.
cmd-hub node-add <name>               Provision a new node + sign its client cert.
cmd-hub node-rotate-token <nodeId>    Rotate a node's token.
cmd-hub node-list                     List the allowlist.
cmd-hub node-remove <nodeId>          Remove a node from the allowlist.
```

Needs `HUB_CA_KEY`, `HUB_CA_CERT`, `MONGO_URL` env vars set.

## Tests

Per-package:

```bash
npm test --workspace=@cmd-hub/core
```

125+ tests covering types, registry, pool, dispatcher, built-ins, FileService, gRPC server integration, mTLS integration, upload endpoint, golden scraper regression, end-to-end loopback.

## License

ISC.
