# cmd-node

The **cmd-node** runtime. This is the package a plugin author depends on to run commands against a live `cmd-hub` gateway.

> **Quickest start:** `npx create-cmd-node my-node` — see [`create-cmd-node`](../create-cmd-node/README.md) for a scaffolded `/echo` example.

## What it gives you

- `CmdNodeApp` — imperatively register commands, services, and config modules; build a protobuf `NodeManifest`.
- `HubClient` — call `CmdHubService.Register` on the hub and maintain the bidi Heartbeat stream (pushes metric samples).
- `startNodeGrpcServer` + `makeInvokeServerImpl` — implements `CmdNodeService.Invoke` on the node side so the hub can dial in and stream events back.
- `adaptService` — wire a `BaseCommandService`-shaped EventEmitter into the gRPC writer (converts monolith emit calls into `InvokeServer` messages).
- `dispatchIntercom` — route reverse-channel `InvokeClient.Intercom` messages to your service's `receiveMsg`.
- `MetricsCollector` + `hardwareInfo` — minimum-viable metrics surface.

## Minimum-viable node

```ts
import * as grpc from '@grpc/grpc-js'
import { CmdNodeApp, MetricsCollector } from 'cmd-node'
import { HubClient } from 'cmd-node/build/src/runtime/hub-client'
import {
    startNodeGrpcServer, makeInvokeServerImpl, type InvokeExecutor,
} from 'cmd-node/build/src/runtime/invoke-server'

const echoExecutor: InvokeExecutor = async (start, writer) => {
    return {
        receiver: { async receiveMsg() { /* pause/stop/export go here */ } },
        stopAdapter: () => undefined,
        done: (async () => {
            writer({ seq: 1, message: { text: `echo: ${start.args.text}` } })
            writer({ seq: 2, done: { finalMessage: 'ok' } })
        })(),
    }
}

async function main() {
    const app = new CmdNodeApp({
        nodeId: process.env.NODE_ID!,
        nodeName: 'my-node',
        version: '1.0.0',
    })
    app.useCommand({
        name: 'echo',
        compatibilityId: 'com.example.echo',
        version: '1.0.0',
        description: 'echo the text arg',
        args: [
            { name: 'text', position: 1, required: true, type: 'string',
              description: 'text', enumValues: [], defaultValue: '' },
        ],
        aliases: [],
    })

    const nodeServer = await startNodeGrpcServer({
        bindAddress: '0.0.0.0:50052',
        credentials: grpc.ServerCredentials.createInsecure(),
        impl: makeInvokeServerImpl({ executor: echoExecutor }),
    })

    const hub = new HubClient({
        hubAddress: process.env.HUB_ADDRESS!,
        nodeId: process.env.NODE_ID!,
        token: process.env.NODE_TOKEN!,
        listenAddress: nodeServer.boundAddress,
        certFingerprint: process.env.NODE_CERT_FINGERPRINT ?? '',
        credentials: grpc.credentials.createInsecure(),
    })
    await hub.register(app.buildManifest())
    const metrics = new MetricsCollector()
    metrics.start()
    hub.startHeartbeat(metrics)
    await app.start()
}
main()
```

That's it. The hub's `/help` now lists `/echo`, and any UI plugin can route it to your node.

## Command identity

Every command you register **must** declare:

- `name` — user-facing slash command (`scraper`, `echo`, …).
- `compatibilityId` — plugin-author-declared grouping key. Commands with the same `compatibilityId` and a compatible major version form a **routing pool** the hub round-robins across. Mismatches are rejected at Register time.
- `version` — semver. Major-version mismatches within the same `compatibilityId` are rejected.

See the design spec's "Command identity" section for the full rules.

## Intercom / reverse channel

If your service supports pause / resume / stop / custom actions, implement `receiveMsg` on the receiver you return from the executor:

```ts
const receiver = {
    async receiveMsg(actionId: string, args: string[]) {
        if (actionId === 'pause')  this.paused = true
        if (actionId === 'resume') this.paused = false
        if (actionId === 'stop')   this.cancelSignal.cancel()
    },
}
```

The hub delivers user-triggered intercom actions as `InvokeClient.Intercom` messages which the runtime unpacks into `receiveMsg` calls for you.

## File emissions

When your service produces a file, upload it via the hub's `CreateWriteGrant` RPC, then emit the handle on the Invoke stream:

```ts
const grant = await cmdHubStub.createWriteGrant({
    sessionId: start.sessionId, nodeId: appConfig.nodeId,
    name: 'report.csv', mime: 'text/csv',
    ttlSeconds: 3600, permanent: false, maxBytes: bytes.length,
})
await fetch(grant.uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${grant.token}` },
    body: new Uint8Array(bytes),
})
writer({ seq: 3, file: { handle: grant.prospectiveHandle } })
```

Plugins never see the storage backend — the hub swaps GridFS for S3 in v2 without any plugin code change.

## Tests

```bash
npm test --workspace=cmd-node
```

## License

ISC.
