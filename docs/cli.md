# `cmd-hub` CLI reference

Operator-level command-line tool for managing a cmd-hub federation: CA setup, node provisioning, registry inspection. The CLI does **not** start the hub — that's app code (`examples/telegram-ui-app`).

## Invocation

The bin lives at `packages/cli/build/src/index.js` and is exposed as `cmd-hub` via `@cmd-hub/cli`'s `bin` field. Three equivalent forms:

```bash
# 1. via npx — resolves through the workspace symlink
npx cmd-hub <subcommand>

# 2. explicit npm exec
npm exec --workspace=@cmd-hub/cli -- cmd-hub <subcommand>

# 3. direct node invocation (no npm exec roundtrip)
node packages/cli/build/src/index.js <subcommand>
```

The package must be built first:

```bash
npm run build --workspace=@cmd-hub/cli
```

All three forms accept the same arguments. Examples in this doc use form 1.

## Storage backend

Every `node-*` subcommand needs to talk to a backing store. The CLI itself never imports a specific driver — pick one with `--storage <pkg>` (or set `CMDHUB_STORAGE`) and pass driver-specific config with `--storage-config <json>` or `--storage-config-file <path>`.

```bash
# Mongo, inline config:
npx cmd-hub node-list \
  --storage @cmd-hub/storage-mongo \
  --storage-config '{"url":"mongodb://127.0.0.1:27017/cmdhub"}'

# Same, via env + a config file:
export CMDHUB_STORAGE=@cmd-hub/storage-mongo
npx cmd-hub node-list --storage-config-file ./storage.json
```

The driver package must be installed in the same `node_modules` tree as `@cmd-hub/cli`. The CLI loads it via dynamic `import()`; failure surfaces as a clear "install it (npm i …)" error.

## Global options

```
--help        show help for any subcommand
--version     0.1.0
```

## Subcommands

### `ca-init`

Generate a self-signed CA. **Run once per deployment.** The CA is the trust anchor for hub↔node mTLS. Both the hub and every node verify peers against this CA.

```
cmd-hub ca-init --key <path> --cert <path> [--cn <name>] [--force]
```

| Flag | Required | Description |
|---|---|---|
| `--key` | yes | Output path for the CA private key (PEM) |
| `--cert` | yes | Output path for the CA certificate (PEM) |
| `--cn` | no | Common Name embedded in the cert. Default: `cmd-hub-ca` |
| `--force` | no | Overwrite existing files. Default: refuse to overwrite |

Outputs nothing on disk besides the two files; logs the paths it wrote.

**Security**: the CA private key signs every node cert — keep it offline once provisioning is done. The cert is public.

### `node-add <name>`

Provision a new node: signs a leaf cert under the CA, persists a `NodeRecord` row in MongoDB with a bcrypt-hashed token, and writes the node's credentials to disk.

```
cmd-hub node-add <name> \
  --storage <pkg> --storage-config <json> \
  --ca-key <path> --ca-cert <path> \
  --out-dir <dir> \
  [--auto-activate]
```

| Flag | Required | Description |
|---|---|---|
| `<name>` | yes (positional) | Human-readable node name. Embedded in the cert CN. |
| `--storage` | yes | Storage driver package name (or `CMDHUB_STORAGE`). E.g. `@cmd-hub/storage-mongo`. |
| `--storage-config` | yes (or `--storage-config-file`) | Driver-specific config as inline JSON. |
| `--storage-config-file` | yes (or `--storage-config`) | Driver-specific config from a JSON file. |
| `--ca-key` | yes | CA private key path (from `ca-init`) |
| `--ca-cert` | yes | CA certificate path (from `ca-init`) |
| `--out-dir` | yes | Directory to write `node.{key,crt,token,id}`. Created if missing. |
| `--auto-activate` | no | Mark the node `ACTIVE` immediately. Default: leaves it `PENDING` |

Writes four files:

| File | Mode | Contents |
|---|---|---|
| `node.id` | 0644 | The generated node UUID |
| `node.crt` | 0644 | Leaf certificate signed by the CA |
| `node.key` | 0600 | Leaf private key |
| `node.token` | 0600 | Raw 32-byte hex token (the **only** copy — Mongo holds the bcrypt hash) |

Prints to stdout:

```json
{
  "nodeId": "2a7f7a01-0a66-4bf5-a742-e503efca522e",
  "fingerprint": "dd10cd727ca9ecd5bd0bcbdfefed785a24bdcea84f6fde398805a23f72d0e208"
}
```

The `nodeId` matches `node.id`; the `fingerprint` is the SHA-256 of `node.crt` and matches what the hub stores in the `NodeRecord` for mTLS pinning.

If you forget `--auto-activate`, the node will register in `PENDING` state — call `node-approve` before it can serve commands.

### `node-list`

Dump the registry.

```
cmd-hub node-list --storage <pkg> --storage-config <json>
```

Output (one row per node):

```
2a7f7a01-...  ACTIVE    scraper-node-1
b1f3c5d2-...  PENDING   experimental-node
```

States:

| State | Meaning |
|---|---|
| `PENDING` | Provisioned but not approved — hub rejects its Register calls |
| `ACTIVE` | Approved — Register accepted, commands routable to it |
| `DISABLED` | Soft-removed — Register rejected, registry row preserved |

### `node-approve <nodeId>`

Move a `PENDING` node to `ACTIVE`.

```
cmd-hub node-approve <nodeId> --storage <pkg> --storage-config <json>
```

Idempotent for already-active nodes; errors if `nodeId` doesn't exist.

### `node-remove <nodeId>`

Hard-delete a node from the registry. The node's `node.token` becomes useless immediately; its cert remains valid until the CA reissues, but the hub will reject the missing-record token check before it ever validates the cert.

```
cmd-hub node-remove <nodeId> --storage <pkg> --storage-config <json>
```

No confirmation prompt — wrap in your own scripts if you need one.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Any failure — error printed to stderr, prefixed with `cmd-hub cli: fatal:` |

## Notes

- The CLI requires the chosen storage backend to be reachable for any `node-*` subcommand. `ca-init` is filesystem-only.
- The token is shown **once** at provisioning and never retrievable afterward. If a node loses its token, run `node-remove` then `node-add` again.
- `InternalTokenVerifier` uses `bcryptjs` with 10 rounds; provisioning is therefore O(100ms) per call, which is fine for human-driven CLI use.

## Security notes

A condensed security summary for the CLI itself. Full deployment-side analysis lives in [`node-deployment.md`](./node-deployment.md#security-model).

### What's secure

- 🟢 **Tokens are bcrypt-hashed at rest.** `node-add` stores `bcrypt(token, 10)` in `node_records`; the raw token never persists in Mongo. A Mongo backup leak doesn't reveal tokens.
- 🟢 **CA-signed certs use `node-forge` with sane defaults** (RSA-2048, SHA-256 signatures, 1y validity). Fingerprints are SHA-256 over the canonical DER form, so the same cert always hashes to the same value.
- 🟢 **`node.token` and `node.key` written with `0o600`** on the local filesystem. Other users on the same host can't read them (subject to filesystem ACL semantics).
- 🟢 **Token visibility is one-shot.** `node-add` prints `nodeId` + `fingerprint` to stdout but **not** the token — you have to read `node.token` from disk. Reduces accidental exposure via shell history / CI logs.
- 🟢 **Idempotency-safe operations.** `node-approve` is a no-op for already-`ACTIVE` rows; `node-remove` errors on missing rows instead of silently succeeding.

### ⚠️ Vulnerabilities and weak spots

#### 🔴 1. CA private key is unencrypted PEM

`ca-init` writes `.local/ca.key` as a plain unencrypted PEM. **No passphrase, no HSM hook, no key-derivation step.** Anyone with read access on this file mints nodes the hub will trust forever.

**Mitigation:** move the file offline once provisioning is done. The hub itself only needs `ca.crt`; only `node-add` and (re-)issuance need `ca.key`.

#### 🔴 2. No CRL / no token revocation list

`node-remove` deletes the row, but:
- There's no notion of a globally rotated token version (you can't say "every token issued before yesterday is now invalid").
- A leaked `node.token` is valid until the row is removed — there's no expiry, no mandatory rotation, no per-token TTL.
- The CLI has no `node-disable` command, only `node-remove`. If you want to keep the audit trail of who was once provisioned, you have to script your own state transition into Mongo.

#### 🔴 3. The `cmd-hub` binary needs the CA private key on the same machine

`node-add` reads `--ca-key` directly. If you run the CLI on a CI runner or operator workstation, the key has to live there at least transiently. There's no separation between "this machine can sign certs" and "this machine can talk to Mongo."

**Mitigation:** run `node-add` on an air-gapped machine, transfer the resulting `node.{key,crt,token,id}` directory securely to where the node will run.

#### 🟡 4. No replay protection on the token check

The hub's `InternalTokenVerifier.verify()` is a constant-time bcrypt compare — fine for the on-disk hash. But the CLI doesn't issue any per-session nonce or expiry, so the token works equally well from any IP, any time, until the row is removed. This is a deliberate v1 simplification — the design doc notes mTLS is intended to take over the "are you really this node" question.

#### 🟡 5. `--auto-activate` skips the human approval gate

If you wire `node-add --auto-activate` into automation, you've just removed the only out-of-band approval step in the lifecycle. A compromised CI pipeline can mint and auto-activate rogue nodes that the hub will accept commands from.

**Mitigation:** run `node-add` without `--auto-activate` from automation, and have a human run `node-approve` after verifying the request out-of-band.

#### 🟡 6. `node.token` is printed to stdout via the file path

`node-add` doesn't print the token, but it does print `out-dir`, and the natural follow-up `cat .local/nodes/X/node.token` is the documented way to get it. That `cat` lands in shell history, in CI logs, in screen recordings. Same risk surface as the file itself, but easier to leak by accident.

**Mitigation:** read tokens with `xclip < .local/nodes/X/node.token` (no echo) or pipe directly into the `config.json` you're editing.

#### 🟡 7. No rate-limiting on the registry calls

If a Mongo-write capability leaks, an attacker can run `node-add` in a loop and DoS the deployment by polluting the registry with thousands of bogus rows. There's no per-IP limit, no per-CA limit.

**Mitigation:** Mongo-side auth + a dedicated provisioning user with restricted IP allowlist.

#### 🟡 8. `--storage-config` JSON frequently contains credentials

Operators often paste connection URLs (`mongodb://user:pass@host/db`, `postgres://...`) inline into `--storage-config '{"url":"..."}'`. That argument ends up in `~/.bash_history` and in `ps`-visible argv on the CLI host.

**Mitigation:** put the JSON in a file with `0o600` permissions and use `--storage-config-file ./storage.json`. Better still, run the CLI on the same host as the backing store and use a loopback / trusted-network URL without auth.

### Summary

The CLI itself is small — most of its security depends on:

1. **Where you keep `ca.key`** (treat as root-of-trust)
2. **Where you keep each `node.token`** (treat as a per-node password, no rotation by default)
3. **Whether the deployed hub has TLS enabled** (the CLI hands you cert material, but using it is your job — see `node-deployment.md`)

If those three are handled, the CLI's bcrypt-at-rest + CA-signed-cert design is reasonable for a v1 federation. If any of them are sloppy, no amount of CLI hardening will save you.
