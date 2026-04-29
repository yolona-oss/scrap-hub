# Full node deployment walkthrough

End-to-end procedure to bring up a federated cmd-hub stack: one hub gateway plus N execution nodes, talking gRPC over the same MongoDB. Each node identifies itself with a CA-signed cert and a bcrypt-hashed token.

This guide is the operational counterpart to [`cli.md`](./cli.md) (CLI reference) and [`../examples/README.md`](../examples/README.md) (run-mode overview).

## Topology

```
              ┌────────────────────────────┐
   user ───►  │ cmd-hub  (ui-app)          │
              │   :50051  gRPC server      │
              │   :8081   GridFS upload    │
              └─────────────┬──────────────┘
                            │ gRPC (Register, Heartbeat, Invoke)
                            ▼
              ┌────────────────────────────┐
              │ cmd-node (scraper-node)    │
              │   :50061  gRPC server      │
              └─────────────┬──────────────┘
                            │
                            ▼
              ┌────────────────────────────┐
              │ MongoDB (shared, host)     │
              └────────────────────────────┘
```

Both processes connect to the **same MongoDB database**. This is essential, not incidental: the hub writes `manager` / `account` records when users authenticate; the node reads those same records via `MongoServiceStore` when servicing commands ("manager not found for userId=…" errors mean the node is pointed at a different DB than the hub). The shared DB also holds `node_records` (federation registry), system/user `config_*` blobs, and `cmd_alias` / `pending_delete` housekeeping. The example configs use `mongodb://127.0.0.1:27017/cmd-hub` for both.

## Prerequisites

- Node 20+
- MongoDB 7+ on `127.0.0.1:27017` (no auth, default port)
- Ollama on `127.0.0.1:11434` with `qwen2.5:7b` pulled — only if you want the AI-agent scraper source
- A Telegram bot token

## Step 1 — install + build

```bash
npm install
npm run build
```

This builds every workspace package, including the `cmd-hub` CLI binary at `packages/cli/build/src/index.js`.

## Step 2 — generate the CA

The CA is the trust anchor for hub↔node mTLS. Run once per deployment.

```bash
mkdir -p .local
npx cmd-hub ca-init \
  --key  .local/ca.key \
  --cert .local/ca.crt
```

Outputs `.local/ca.{key,crt}`. The `.local/` directory is gitignored.

**Treat `.local/ca.key` like a root password.** Anyone with this file can mint nodes that the hub will trust. Move it offline once provisioning is finished, or — at minimum — make sure it's outside any container image and any backup that touches the network.

## Step 3 — provision a node

For every node you intend to run, allocate a name and call `node-add`. The Mongo URL in `--storage-config` must match the **hub**'s storage config (the hub's `node_records` collection is what the hub queries on Register).

The CLI selects its storage backend by package name. Set `CMDHUB_STORAGE` once (as below) so subsequent commands don't need to repeat `--storage`. To use a different backend, point at its package: `--storage @cmd-hub/storage-postgres`, etc. — the CLI itself never references a specific driver.

```bash
export CMDHUB_STORAGE=@cmd-hub/storage-mongo
npx cmd-hub node-add scraper-node-1 \
  --storage-config '{"url":"mongodb://127.0.0.1:27017/cmd-hub"}' \
  --ca-key  .local/ca.key \
  --ca-cert .local/ca.crt \
  --out-dir .local/nodes/scraper-node-1 \
  --auto-activate
```

This writes:

```
.local/nodes/scraper-node-1/
├── node.id        # the UUID that goes into config.hub.nodeId
├── node.crt       # leaf cert; its SHA-256 is config.hub.certFingerprint
├── node.key       # leaf private key (mTLS only)
└── node.token     # raw token; goes into config.hub.token
```

…and prints the `nodeId` + `fingerprint` to stdout.

The token is **shown once** — Mongo keeps only the bcrypt hash. If you lose it, run `node-remove` then `node-add` again.

## Step 4 — wire the credentials into `config.json`

### Hub config

`examples/ui-app/config.json` already references `mongodb://127.0.0.1:27017/cmd-hub`. When the active UI is Telegram, the only Telegram-specific edits you need are `botToken`, `botName`, `primaryAdminId`, `adminUserIds`. No node-specific fields go on the hub side; the registry row written by `node-add` is what the hub reads.

If your network blocks `api.telegram.org`, set `proxy.socks` (or `proxy.https`):

```json
"proxy": { "socks": "socks5://127.0.0.1:20170", "https": null }
```

### Node config

`examples/scraper-node/config.json` — paste the four values from `node-add` into the `hub` slice:

```json
"hub": {
    "address": "127.0.0.1:50051",
    "token": "<contents of .local/nodes/scraper-node-1/node.token>",
    "nodeId": "<contents of .local/nodes/scraper-node-1/node.id>",
    "nodeName": "scraper-node-1",
    "version": "1.0.0",
    "certFingerprint": "<sha256 of .local/nodes/scraper-node-1/node.crt>",
    "heartbeatIntervalMs": 5000
}
```

`node.key` and `node.crt` aren't inlined — the framework reads them from disk only when mTLS is enabled. For the **current insecure dev setup** they're unused (see Security model below).

## Step 5 — run

Two terminals, in either order — the node retries Register if the hub isn't ready yet:

```bash
# terminal 1
npm run start:hub

# terminal 2
npm run start:node
```

Watch the hub log for `Register accepted` and the node log for `heartbeat tick`.

## Step 6 — adding more nodes

Repeat steps 3–5 for each additional node. Use a distinct `<name>` and `--out-dir` per node. Each node needs its own copy of the example or its own per-node config file.

If you forgot `--auto-activate`:

```bash
npx cmd-hub node-list   --storage-config '{"url":"mongodb://127.0.0.1:27017/cmd-hub"}'
npx cmd-hub node-approve <nodeId> --storage-config '{"url":"mongodb://127.0.0.1:27017/cmd-hub"}'
```

## Tearing a node down

```bash
npx cmd-hub node-remove <nodeId> --storage-config '{"url":"mongodb://127.0.0.1:27017/cmd-hub"}'
```

Hard delete — the node's token is invalidated immediately. Stop the node process; don't reuse its `.local/nodes/<name>/` directory.

---

# Security model

This section catalogs **what protects the deployment, what doesn't, and what's outright broken**. Read it before exposing the hub or any node to a non-trusted network.

## What the design provides (in principle)

- **Node identity = (cert + token) tuple.** Token authenticates *who* the node is; cert pins the channel. Both must match the registry row.
- **mTLS channel pinning.** When enabled, the node's TLS leaf cert is fingerprinted on Register; subsequent Heartbeat/Invoke calls cross-check the fingerprint. Stolen token alone doesn't get you in if the hub trusts the CA.
- **Bcrypt token storage.** The raw token never lands in Mongo — only `bcrypt(token, 10)`. Mongo dump leak ≠ token leak.
- **Node lifecycle states.** `PENDING → ACTIVE → DISABLED`. A `PENDING` node is provisioned but inert; gives operators a manual approve gate.
- **`federationRequires`.** UIs declare which capabilities a target node must publish; the aggregator filters per-UI eligibility, so a misconfigured node can't be routed traffic it can't serve.

## ⚠️ What the **default example bootstrap** actually does

The current `examples/ui-app/src/index.ts` and `examples/scraper-node/src/index.ts` are configured for **local development**. They turn off most of the protections above. Don't ship them as-is.

### 🔴 1. gRPC is plaintext

```ts
.use(new GrpcServerMiddleware({ insecure: true }))   // hub
.use(new InvokeServerMiddleware())                   // node — also insecure by default
```

`grpc.ServerCredentials.createInsecure()` is used on both sides. **No TLS, no mTLS.** Anyone on the network path can:

- Read every Register/Heartbeat/Invoke payload (manifests, command args, results).
- Inject their own commands into the stream once they observe a single token (it's transmitted in the metadata header in cleartext).

**Fix:** drop `{ insecure: true }`, populate `config.grpc.tls.{caCertPath,serverCertPath,serverKeyPath}` and `config.invokeServer.tls.*`, and call `cmd-hub` to issue mTLS material for the hub itself. The framework supports this — the example just doesn't use it.

### 🔴 2. The cert fingerprint comes from a self-reported header

In insecure mode, the hub trusts the `x-cmdhub-node-fingerprint` HTTP/2 metadata header the node sets:

```ts
md.set('x-cmdhub-node-fingerprint', this.opts.certFingerprint)
```

The node tells the hub what its fingerprint is. **There is no cryptographic binding between this string and the actual TLS session** in insecure mode. Any client that knows a valid `(nodeId, token, fingerprint)` triple can register as that node. That triple lives in `config.json` on disk and in stdout output from `node-add`.

`mTlsFingerprintResolver()` *does* extract the real peer cert from the gRPC session — but it's only installed when `insecure: false`. In dev mode the resolver is the metadata-header reader.

### 🟡 3. Tokens cross the wire as cleartext

Token authentication relies on bcrypt **at rest** but the token itself flows over the gRPC channel as a metadata header on every Register call. Without TLS (point 1), a network-adjacent attacker scrapes the token from the first registration and can impersonate the node forever (until rotated).

**Fix:** TLS. The bcrypt protects only against a Mongo-dump leak; it does nothing for in-flight exposure.

### 🟡 4. No revocation list — `node.token` is forever-valid

Once issued, a `node.token` is valid until the row is deleted (`node-remove`) or its state flipped (no `DISABLED` flag in the CLI today). There's no expiry, no rotation hook, no incident-response "rotate every node's token" path. If a node host is compromised, you `node-remove` then `node-add` and update config — there's no way to issue a global token-version bump.

### 🟡 5. `node.token` written world-readable in some contexts

`node-add` writes `node.token` with `mode: 0o600`. Good. But:

- If `--out-dir` is on a network filesystem with looser perms, the mode is advisory.
- The token is also printed to stdout via the JSON line and visible in shell history if you piped it anywhere.
- Inside Docker, the file mode interacts with the container's UID; if the container is rebuilt with a different UID, the token could become unreadable to the node process *or* world-readable to the host.

**Fix:** treat `node.token` like a private key. Don't email it, don't paste it into chat, don't commit it.

### 🟡 6. CA private key has no protection

`ca-init` writes `.local/ca.key` as a plain unencrypted PEM. Anyone with read access mints nodes the hub will trust. There's no passphrase, no HSM integration, no "sign one node and move offline" tooling.

**Fix:** after provisioning the nodes you need, move `.local/ca.key` to offline storage. The hub itself never reads `ca.key` — only the `ca.crt`. Provisioning new nodes can be done on a separate machine that holds the key.

### 🟡 7. MongoDB has no auth in the example

`config.storage.url = "mongodb://127.0.0.1:27017/..."`. Anyone with access to the host can read every `node_records` row (cleartext nodeId + bcrypt(token) + cert fingerprint), every `system_config` blob (which holds API keys, bot tokens, anything saved via `/sargs`), and every `manager` row (Telegram user IDs).

**Fix:** Mongo auth + IP-bind to loopback or a private subnet. The framework doesn't help here; it's pure operational config.

### 🟡 8. Bot token, admin ID, SerpAPI key etc. live in `config.json` on disk

`config.json` is gitignored, but it's still a plaintext file with bot tokens, admin user IDs, scraper API keys, and Google Sheets credentials. Disk encryption is the only barrier. The framework doesn't read from a secrets manager (Vault, AWS Secrets Manager, etc.).

**Fix:** Mount the file from a tmpfs/secret driver in production, or wrap `CmdHubApp` to read from your secrets backend instead of `configPath`.

### 🟢 9. What's actually fine

- **Bcrypt at rest** — token leak via Mongo backup doesn't reveal raw tokens. 10 rounds is reasonable for a registry the size of a typical deployment.
- **`InternalCertVerifier`** correctly fingerprints peer certs over a stable canonicalized DER form when mTLS is on.
- **`NodeRecord` lifecycle** is enforced in code: `PENDING` rejects Register, `DISABLED` rejects Register, only `ACTIVE` accepts.
- **`federationRequires` filtering** is enforced at Register time, not at command-dispatch time — a misconfigured node never gets into the routable pool, full stop.

## Vulnerability checklist for production rollout

Before exposing this stack to anything other than `localhost`:

- [ ] Switch off `GrpcServerMiddleware({ insecure: true })` and provision real TLS certs for the hub
- [ ] Switch off `InvokeServerMiddleware`'s default insecure mode and configure mTLS on the node-side server
- [ ] Confirm `mTlsFingerprintResolver` is being used (not the metadata-header default)
- [ ] Mongo: enable auth, IP-bind, TLS on the wire if it's remote
- [ ] CA private key: moved offline, or behind an HSM
- [ ] Define a token-rotation procedure (currently: `node-remove` + `node-add` + redeploy)
- [ ] Audit `config.json` for plaintext secrets; replace with a secrets-manager fetch if applicable
- [ ] Set `appLock.lockFile` to a path the process owner can write but other users can't read (PID file leaks aren't critical but aren't free either)
- [ ] Decide what `--auto-activate` policy you want — auto-approving on `node-add` skips the manual review gate
- [ ] Run `npx cmd-hub node-list` periodically and reconcile against your inventory; orphan rows accumulate over time
- [ ] Rotate the CA every N years and reissue all node certs (no automation for this today)

## Threat model snapshot

| Attacker | Capability today (insecure mode) | Capability with mTLS + Mongo auth |
|---|---|---|
| Network-adjacent passive | Read all gRPC traffic, harvest tokens | Sees only TLS handshakes |
| Network-adjacent active | Impersonate any node, inject commands | Blocked at handshake (no client cert) |
| Mongo read access | All system config, all manager IDs, bcrypt(token)s | Same |
| Disk read on hub | Bot token, all configs, CA cert (not key) | Same |
| Disk read on node | `node.token`, `node.key`, scraper API keys | Same |
| `.local/ca.key` leaked | Issue arbitrary nodes the hub will trust | Same — CA key is the trust root regardless of TLS |

The takeaway: **mTLS closes the network attacker. Nothing closes a host-disk attacker except encrypted storage and good ops hygiene.** The framework gives you the seams; it doesn't pre-configure them.
