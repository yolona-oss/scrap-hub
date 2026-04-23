# cmd-hub Distributed — Phase 4 — Framework polish and tag v1.0.0

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal of Phase 4:** Ship the framework part. Populate `create-cmd-node`. Write READMEs. Document v2 seams. Remove monolith dead code. Tag v1.0.0.

**Exit criteria:** a stranger can clone the repo, copy `create-cmd-node`, point at a running hub, and have a new command show up in `/help`. All CI tiers green. Tagged.

---

### Task 4.1: create-cmd-node template

**Files:**
- Create: `packages/create-cmd-node/template/package.json`
- Create: `packages/create-cmd-node/template/tsconfig.json`
- Create: `packages/create-cmd-node/template/src/index.ts`
- Create: `packages/create-cmd-node/template/Dockerfile`
- Create: `packages/create-cmd-node/template/config/node.json.example`
- Create: `packages/create-cmd-node/bin/create-cmd-node.js`
- Modify: `packages/create-cmd-node/package.json` — add `"bin": { "create-cmd-node": "./bin/create-cmd-node.js" }`
- Rewrite: `packages/create-cmd-node/README.md`
- Create: `packages/create-cmd-node/__tests__/scaffold.test.ts`

**`template/src/index.ts`** — a deliberately trivial `/echo` command so the template proves framework-shape, not scraper-shape:

```ts
import { CmdNodeApp } from 'cmd-node';
import pkg from '../package.json';

async function main() {
  const app = new CmdNodeApp({
    nodeId: process.env.NODE_ID!,
    nodeName: pkg.name,
    version: pkg.version,
    hubAddress: process.env.HUB_ADDRESS!,
  });

  app.useCommand({
    name: 'echo',
    compatibilityId: 'com.example.echo',
    version: pkg.version,
    description: 'echoes the argument back',
    args: [{ name: 'text', required: true, type: 'string', position: 1 }],
    aliases: [],
    run: async ({ args, emit }) => {
      emit({ kind: { $case: 'message', message: { text: String(args.text ?? '') } } });
      emit({ kind: { $case: 'done', done: { finalMessage: 'done' } } });
    },
  });

  await app.start();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**`bin/create-cmd-node.js`** — a tiny script that copies `./template/` to a target dir with the dir name substituted into `package.json` `name`:

```js
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!target) { console.error('usage: create-cmd-node <target-dir>'); process.exit(2); }
const src = path.join(__dirname, '..', 'template');

function copyDir(s, t) {
  fs.mkdirSync(t, { recursive: true });
  for (const entry of fs.readdirSync(s, { withFileTypes: true })) {
    const sp = path.join(s, entry.name);
    const tp = path.join(t, entry.name);
    if (entry.isDirectory()) copyDir(sp, tp);
    else fs.copyFileSync(sp, tp);
  }
}

copyDir(src, target);
const pkgPath = path.join(target, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.name = path.basename(path.resolve(target));
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
console.log(`Created cmd-node scaffold at ${target}`);
```

**Test:** run `node packages/create-cmd-node/bin/create-cmd-node.js /tmp/my-node-<randomId>`, verify files are created, verify `package.json` name matches the target dir basename.

**README:** `packages/create-cmd-node/README.md`:

```md
# create-cmd-node

Scaffold a new cmd-node.

## Quick start

    npx create-cmd-node my-node
    cd my-node
    npm install
    npm run build

    export NODE_ID=... NODE_TOKEN=... HUB_ADDRESS=...
    node build/src/index.js

Then, in your running cmd-hub's UI, `/help` will list `echo`.

## Provisioning the node

Get the credential triple from the hub operator:

    cmd-hub node-add my-node

Paste the resulting `nodeId`, `token`, and PEM files into your environment.
```

Commit. Message: `feat(create-cmd-node): add scaffolding template with /echo sample command`.

### Task 4.2: READMEs

**Files:**
- Rewrite: `README.md` (top-level)
- Rewrite: `packages/cmd-hub/README.md`
- Rewrite: `packages/cmd-node/README.md`

**Top-level README** — starts with "Hello, world in 10 lines". Structure:
1. One-paragraph what-it-is.
2. The 10-line `create-cmd-node` walkthrough.
3. Architecture diagram (copy from the design spec's Section 1).
4. Pointer to `docs/deploy/README.md` for operators.
5. Pointer to `packages/cmd-hub/README.md` and `packages/cmd-node/README.md` for framework users.
6. Pointer to the design spec.

**`packages/cmd-hub/README.md`** — framework API surface. Document:
- `CmdHubApp` constructor options.
- `useUI(impl)` — the `IUI` contract.
- Auth seams — `ICertVerifier`, `ITokenVerifier`, `ISecretStore`.
- `FileService` — pluggable backends (explain the `FileServiceBackend` interface; note that v1 ships only `GridFSBackend`).
- Built-ins table — each built-in's usage and admin requirements.
- The `cmd-hub` CLI — every subcommand.

**`packages/cmd-node/README.md`** — plugin-author API surface. Document:
- `CmdNodeApp` constructor options.
- `useCommand(def)` — the `CommandDefinition` type. Emphasize that `compatibilityId` and `version` are mandatory.
- `useService(def)` — how to wrap a `BaseCommandService` subclass.
- `useConfigModule(def)` — how to publish config schemas.
- The `cmd-node` CLI.
- The `node.json` config file layout.

Three separate commits, one per README. Messages: `docs: top-level README with hello-world quickstart`, `docs(cmd-hub): framework API reference`, `docs(cmd-node): plugin author API reference`.

### Task 4.3: v2 roadmap doc

**Files:**
- Create: `docs/roadmap.md`

Content: summarize the v2 commitments from the spec:
- External PKI via `ICertVerifier` replacements.
- Pluggable `ITokenVerifier` backends.
- HSM/TPM-backed node tokens via `ITokenStore`.
- MongoDB CSFLE for `SystemConfig` and `AccountModule` secrets.
- Signed audit log.
- S3 / cloud-storage `FileService` backend.
- Metric-aware routing (replacing the constant-score stub).
- Multi-gateway support (deferred; requires a shared event bus or session-affinity design).
- Out-of-process UI plugins (web UI as a separate container talking gRPC).

For each item, link to the relevant spec section so readers can find the seam.

Commit. Message: `docs: v2 roadmap with v1 seam references`.

### Task 4.4: Remove the monolith

**Files:**
- Remove monolith-era code paths now that `examples/telegram-ui-app/` and `examples/scraper-node/` cover the reference implementations:
  - Delete `packages/cmd-hub/src/ui/impls/telegram/` if it was fully duplicated into `examples/telegram-ui-app/` (otherwise leave it as a framework-shipped UI plugin — confirm by checking whether any `examples/` file imports from `@cmd-hub/core/ui/impls/telegram/`; if yes, the code stays where it is and this step is a no-op).
  - Delete the old `packages/cmd-hub/src/ui/command-processor/invoker.ts` — replaced by `HubDispatcher`.
  - Delete `packages/cmd-hub/src/ui/command-processor/built-in-cmd/` — replaced by `packages/cmd-hub/src/distributed/builtins/`.
  - Delete `MONOLITH_FREEZE.md` — no longer needed; the monolith is gone.
- Modify: root `package.json` — remove the `build:sdk` / `build:scraper` / `build:app` legacy scripts, replace with workspace-wide equivalents.
- Modify: any lingering `tsconfig.json` path aliases that pointed into removed code.
- Run: `npm install`, `npm run build --workspaces`, `npm test --workspaces`. All must pass green.

Commit. Message: `chore: remove monolith-era code paths superseded by the distributed rewrite`.

### Task 4.5: Tag v1.0.0

**Files:**
- Modify: `packages/cmd-hub/package.json` — version to `1.0.0`
- Modify: `packages/cmd-node/package.json` — version to `1.0.0`
- Modify: `packages/create-cmd-node/package.json` — version to `1.0.0`
- Modify: `examples/telegram-ui-app/package.json` — version to `1.0.0`
- Modify: `examples/scraper-node/package.json` — version to `1.0.0`

Commit: `chore: bump all packages to 1.0.0 for distributed framework release`.

Then:

```
git tag v1.0.0
git push origin rewrite/distributed
git push origin v1.0.0
```

Open a PR from `rewrite/distributed` to `main`. Review should look specifically at: (1) the golden test is green; (2) `docker compose up` works on a fresh clone; (3) no lingering imports from the old `packages/app/` or `packages/org-scraper/` paths. Merge once green.

---

*Phase 4 complete. v1.0.0 tagged. Rewrite merged to main.*

## Self-review notes (against the spec)

**Spec coverage check:**

- Tiers, single-gateway, package layout → Task 0.3, 3.1, 3.2.
- gRPC transport, three channels, event mapping → Task 0.4, 1.16, 2.1, 2.2, 2.3.
- Manifest + mandatory compatibility_id + version → Task 1.6, 1.7, 1.14.
- Authentication (mTLS + token) + hotplug policies → Task 1.4, 1.5, 2.4.
- Future auth extensions (seam interfaces) → Task 1.4 defines the interfaces; Task 4.3 documents the roadmap.
- MongoDB with transactions → models in Task 1.2; `CmdNodeRegistry` uses them; integration test in Task 2.6 covers contention.
- `FileService` + GridFS + `FileHandle` opacity → Task 1.3, 2.5.
- Dispatch + execution lifecycle → Task 1.9, 1.11, 2.3, 2.6.
- Failure modes → Task 1.9 test covers "no pool" / "node override miss"; Task 2.6 covers disconnect.
- UI plugins via `useUI()` → Task 1.12, 3.1.
- Deployment (docker-compose, CLIs) → Task 1.13, 1.18, 3.1, 3.2, 3.3.
- Metrics v1 (collect + display) → `MetricsSchema` in manifest (Task 0.4), `MetricsCollector` (Task 1.15), Heartbeat carries samples (Task 2.1), display in `/node show` (Task 1.10.a — the full implementation in Task 1.10.a includes "cmds=..." but does not yet include metrics rendering. **FOLLOW-UP:** before Phase 2 completes, extend `/node show` output to include last 5 metric samples per gauge. Add a sub-step in Task 1.10.a during execution if not already there.).
- Testing strategy → Task 0.1–0.2 (golden), Task 0.4 (contract), unit tests throughout Phase 1, integration in Task 2.6, golden on distributed stack in Task 2.7, golden on container stack in Task 3.4.
- Migration big-bang + golden gate → the plan shape itself (phases, freeze, golden as the regression gate).
- Verification eight steps → Task 2.7 (golden loopback), Task 3.3 (docker compose up), Task 3.4 (golden container), Task 3.5 (scale + kill manual).

**Placeholder scan:**

- No `TBD`/`TODO`/`implement later`/`similar to N` in any task.
- Some later tasks (1.7 ManifestAggregator, 1.10.b–e, 1.11, 1.12) have their implementation **summarized** by surface-and-invariants rather than fully code-expanded. This is a density tradeoff: every summary contains (a) the exact file paths, (b) the exact surface, (c) the specific test points, (d) implementation notes that specify the algorithm or invariants. An engineer who has already executed Tasks 1.1–1.6 and 1.10.a in full will recognize the pattern. If a fresh engineer executing the plan wants more, they can expand these during execution.

**Type-consistency check:**

- `InvokeServer.seq` — `uint64` in `.proto`, `bigint` in ts-proto defaults. Test files consistently use `1n`, `2n`, ... literals and coerce with `Number(e.seq)` when comparing numerically.
- `FileHandle.fileId` — `string` everywhere (Task 1.1, Task 1.3, `.proto` Task 0.4).
- `CmdNodeApp.useCommand` (singular) is consistent across Tasks 1.14, 4.1.
- `CmdHubApp.useUI` is consistent across Tasks 1.12, 3.1.
- `HubDispatcher` is consistently named. The monolith's `CmdDispatcher` is the class being replaced and is mentioned only in that context.

**Scope check:**

- One plan, one spec, tightly interlocking phases. Not splittable.

**Follow-up items surfaced during review (to add to Task 1.10.a during execution):**

- Extend `/node show` output to include the last 5 metric samples per gauge when a manifest is attached. The data comes from the Heartbeat stream handler (Task 2.1) writing samples into a hub-side time-series collection; `/node show` reads the most recent N.
- **`ConfigRegistry` migration path:** Task 1.14 (`CmdNodeApp`) exposes `useConfigModule(def)` which mirrors the monolith's `ConfigRegistry.register()`. The manifest builder reads from the list of registered config modules. When migrating existing code (`org-scraper`'s `register()` in Task 3.2), the `ConfigRegistry.register({ name: 'scraper', ... })` call is replaced with `app.useConfigModule({ name: 'scraper', ... })`. Document this transformation in `packages/cmd-node/README.md` (Task 4.2).
