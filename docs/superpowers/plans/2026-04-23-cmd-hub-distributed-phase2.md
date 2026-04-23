# cmd-hub Distributed — Phase 2 — Real gRPC, mTLS, integration, golden test

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal of Phase 2:** Replace the `FakeCmdNodeClient` with a real gRPC client. Stand up an mTLS-authenticated gRPC server on the hub and an `Invoke` server on the node. Integration tests use loopback gRPC + `mongo-memory-server`. The golden scraper test from Phase 0 must pass against the distributed stack.

**Exit criteria:** integration tests green. Golden scraper test green against real gRPC on loopback. Hub + node behavior matches the monolith for the scraper.

---

### Task 2.1: CmdHubServiceImpl — server-side of Register, Heartbeat, CreateWriteGrant

**Files:**
- Create: `packages/cmd-hub/src/distributed/grpc-server/cmd-hub-service-impl.ts`
- Create: `packages/cmd-hub/src/distributed/grpc-server/server.ts` — wraps `grpc.Server` with TLS credentials wiring
- Create: `packages/cmd-hub/src/distributed/grpc-server/__tests__/cmd-hub-service.test.ts`

**Surface:** implement the generated `CmdHubServiceServer` interface with methods:
- `register(call)` — verify token and cert fingerprint via `CmdNodeRegistry.markRegistered()`, then call `ManifestAggregator.attach()`. Return `{ sessionToken, pollIntervalMs: 15000, assignedState }`.
- `heartbeat(call)` — bidi stream; on each incoming message call `registry.touchLastSeen(nodeId)` and record metric samples (store in a hub-side time-series collection).
- `createWriteGrant(call)` — forward to `FileService.issueWriteGrant()`.

**Tests (loopback, no mTLS yet — plain `grpc.ServerCredentials.createInsecure()` on a unix socket):**
- A valid Register call with matching token and fingerprint adds the node to the aggregator.
- A Register with mismatched fingerprint returns a gRPC error with code `UNAUTHENTICATED`.
- A Register with incompatible manifest returns a gRPC error with the rejection diff in the message.
- A Heartbeat updates `lastSeen`.
- A `CreateWriteGrant` returns a valid grant with a non-empty `uploadUrl`.

Test → implement → commit. Message: `feat(cmd-hub): add gRPC CmdHubService (Register, Heartbeat, CreateWriteGrant)`.

### Task 2.2: Node gRPC client (calls Register + Heartbeat) and Invoke server

**Files:**
- Create: `packages/cmd-node/src/runtime/hub-client.ts` — calls `CmdHubService.Register` and maintains the Heartbeat stream
- Create: `packages/cmd-node/src/runtime/invoke-server.ts` — implements `CmdNodeService.Invoke` bidi stream server-side
- Create: `packages/cmd-node/src/runtime/__tests__/hub-client.test.ts`
- Create: `packages/cmd-node/src/runtime/__tests__/invoke-server.test.ts`

**`hub-client.ts` surface:**
```ts
class HubClient {
  constructor(opts: { hubAddress, nodeId, token, certPath, keyPath, caCertPath });
  register(manifest: NodeManifest): Promise<RegisterResponse>;
  startHeartbeat(collector: MetricsCollector): void;
  stopHeartbeat(): void;
}
```

**`invoke-server.ts` surface:** implements `CmdNodeService` with `invoke(call)` method. On each `InvokeStart`:
1. Look up the command in the node's local registry.
2. Instantiate the service (same clone pattern as `BaseCommandService.clone` in the monolith).
3. Wire `adaptService(svc, (m) => call.write(m))` to push events onto the stream.
4. Listen for `InvokeClient.Intercom` messages and `dispatchIntercom(svc, msg)`.
5. On service `done` event, the adapter emits `Done` and the call closes.

**Tests:**
- `HubClient.register(manifest)` — stands up a fake hub gRPC server, asserts the request carries the expected manifest.
- `invoke-server.ts` — spins up a fake hub that opens an Invoke stream and asserts the events that flow back for a trivial registered command.

Test → implement → commit, one task per class. Message (first): `feat(cmd-node): add HubClient for Register + Heartbeat`. Message (second): `feat(cmd-node): add Invoke gRPC server on the node`.

### Task 2.3: Real ICmdNodeClient on the hub — calls Invoke on a connected node

**Files:**
- Create: `packages/cmd-hub/src/distributed/client/grpc-cmd-node-client.ts`
- Create: `packages/cmd-hub/src/distributed/client/__tests__/grpc-cmd-node-client.test.ts`

**Surface:**
```ts
class GrpcCmdNodeClient implements ICmdNodeClient {
  constructor(opts: { getChannelFor: (nodeId: string) => grpc.Channel | undefined });
  invoke(nodeId, start): Promise<InvocationHandle>;
}
```

The hub maintains a `Map<nodeId, grpc.Channel>` — a channel is opened when a node registers (registration call carries the node's listen address; if the node isn't reachable directly, we use the *same* bi-di control connection that the node initiated for heartbeat — in grpc-js, a server can call back only if the connection is reversed at the application layer. Alternative: each node runs a small gRPC server on a well-known port; the hub dials it when the node registers.). The design spec uses the latter: nodes listen on a port carried in their `RegisterRequest`. Extend the `.proto` in Task 0.4 accordingly by adding `string listen_address = 4;` to `RegisterRequest`. Re-generate.

**Tests:**
- Start a fake node gRPC server that implements `CmdNodeService.Invoke` to emit a few events and close.
- Have the `GrpcCmdNodeClient` invoke it; assert events flow.
- Closing the channel mid-stream surfaces as an iterator-completes.

Test → implement → commit. Message: `feat(cmd-hub): add GrpcCmdNodeClient implementing ICmdNodeClient against a running node`.

### Task 2.4: mTLS — real TLS credentials with client-cert verification

**Files:**
- Create: `packages/cmd-hub/src/distributed/grpc-server/tls.ts` — builds `grpc.ServerCredentials.createSsl(caCert, [{ certChain, privateKey }], checkClientCertificate=true)`
- Create: `packages/cmd-node/src/runtime/tls.ts` — builds `grpc.credentials.createSsl(caCert, key, cert)`
- Modify: `CmdHubServiceImpl.register` — read the peer's X.509 cert from the gRPC context (`call.getPeerCertificate()` in grpc-js if available, otherwise pass it through an explicit context accessor wrapper) and pass its fingerprint to `CmdNodeRegistry.markRegistered()`.
- Create: `packages/cmd-hub/src/distributed/grpc-server/__tests__/mtls.test.ts`

**Test:**
- Generate a CA via `ca.ts` from Task 1.13.
- Sign one node cert with the correct fingerprint recorded in the allowlist, and another with a different fingerprint.
- Register with the correct cert — succeeds, node state transitions as expected.
- Register with the wrong cert (fingerprint mismatch) — Register call rejected with `UNAUTHENTICATED`.
- Register with a cert signed by a different CA entirely — TLS handshake fails before Register is even called.

**Implementation note on reading the client cert:** grpc-js surfaces the peer's cert via `call.getPeer()` + `session.getPeerCertificate()` on the underlying http2 session. If the grpc-js version in use doesn't expose this directly, create a small wrapper interceptor that captures the cert from the session and attaches it to the call's metadata. Document the chosen approach in `tls.ts`.

Test → implement → commit. Message: `feat(cmd-hub): enforce mTLS client-cert verification in CmdHubService`.

### Task 2.5: File-upload HTTP endpoint on the hub

**Files:**
- Create: `packages/cmd-hub/src/distributed/files/upload-endpoint.ts` — Express router mountable at `/upload`
- Create: `packages/cmd-hub/src/distributed/files/__tests__/upload-endpoint.test.ts` — uses `supertest`

**Surface:** `makeUploadEndpoint({ fileService, trustedBackend })` returns an Express `Router` with a single route:

- `PUT /upload?grant=<grantId>` (Authorization: Bearer <token>) — streams the request body into the `FileService`'s GridFS backend bucket using the grant's `gridFsId`. On success, calls `fileService.completeWrite(grantId, actualBytes)` and responds `200 {"handle": FileHandle}`.

**Test points:**
- Valid grant + matching token + body within `maxBytes` → 200 response with the returned FileHandle.
- Invalid token → 401.
- Expired grant → 410.
- Body exceeds `maxBytes` → 413.
- Grant not found (wrong id) → 404.

**Implementation note:** the upload is a raw stream pipe, not buffered. Use `req.on('data', ...)` into the GridFS upload stream; count bytes to enforce `maxBytes` and fail mid-stream if exceeded.

Test → implement → commit. Message: `feat(cmd-hub): add /upload HTTP endpoint for capability-grant file writes`.

### Task 2.6: End-to-end integration test on loopback

**Files:**
- Create: `packages/cmd-hub/src/distributed/__tests__/integration/loopback.test.ts`

**Spins up** (inside a single test process):
- `MongoMemoryReplSet` with 1 node.
- A `CmdHubApp` listening on an ephemeral TCP port with a test CA.
- A `CmdNodeApp` running in the same process (separate `await` promise), registering an `EchoCommand` (trivial: emits three messages and done).
- Hub dispatcher is wired with the real `GrpcCmdNodeClient`.

**Asserts:**
- Node registers → aggregator sees it → `/node list` lists it as ACTIVE.
- Dispatcher routes `/echo` to the node → events flow back in order.
- `intercom` message sent from hub to node reaches the service's `receiveMsg`.
- Node disconnect mid-invocation surfaces as `StreamError` in the event stream.
- Two nodes registered with the same command see round-robin distribution over 4 invocations.
- A second node with a conflicting `compatibilityId` has its Register rejected with a clear error.
- Two nodes updating the same `AccountModule` in parallel do not lose writes (uses a MongoDB transaction; one wins, one retries).

Test content is large (≈300 lines). Implement as one test file with clearly-scoped `describe` blocks per scenario.

Test → implement → commit. Message: `test(cmd-hub): loopback integration suite for distributed stack`.

### Task 2.7: Golden scraper test on loopback-gRPC stack

**Files:**
- Create: `packages/cmd-hub/src/distributed/__tests__/integration/golden-scraper.test.ts`
- Reuse: the Phase 0 fixtures `packages/app/src/__tests__/fixtures/expected-events.json` and `expected.csv`

**Spins up** the hub and a cmd-node that registers the org-scraper commands (the scraper code still lives in `packages/org-scraper/` for Phase 2 — the move to `examples/scraper-node/` happens in Phase 3). The `FakeSource` is registered via the same env var the monolith test uses.

**Runs** `/scraper query="coffee" city="" sources=fake limit=50 format=csv` through the hub dispatcher, captures every `InvokeServer` event streamed back, normalizes them to the same `CapturedEvent` shape the monolith harness produced, reads the emitted file's bytes via `FileService.read()`.

**Asserts:**
- Event sequence matches `expected-events.json` (stripping `at` timestamps).
- CSV bytes match `expected.csv` exactly.

**Very likely to fail on first run.** Debug points:
- Event ordering: if the sequence diverges, add trace logs and compare to the monolith's emission order.
- Progress counters: ensure the `Progress.current` and `Progress.total` field types match (ts-proto emits uint64 as bigint by default).
- CSV trailing newline: the monolith may emit with or without a final `\n` depending on library; match whatever the fixture captured.
- Intercom actions: label/icon strings must round-trip byte-identically through protobuf.

This is the regression gate. It must pass before proceeding to Phase 3.

Test → implement (the test file + any framework fixes needed) → commit. Message: `test: golden scraper regression on loopback gRPC stack`.

---

*Phase 2 complete once the golden test is green. Verify:*

- [ ] All integration tests green
- [ ] Golden test green on the distributed stack
- [ ] No regression in Phase 0 or Phase 1 unit tests

*Phase 3 continues in `2026-04-23-cmd-hub-distributed-phase3.md`.*
