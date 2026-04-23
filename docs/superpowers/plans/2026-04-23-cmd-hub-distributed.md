# cmd-hub Distributed Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite cmd-hub from an in-process monolith into a distributed framework: one `cmd-hub` gateway hosting UI plugins and routing commands over gRPC+mTLS to N `cmd-node` execution processes, with a shared MongoDB (GridFS for files), landing as a framework third parties can use (not a specific app).

**Architecture:** Single gateway, N nodes. Control + execution + file channels over gRPC. Mandatory `compatibility_id + version` on every command. Federation built-ins (`/help`, `/config`, `/sconfig`, `/node`) stay hub-local because they reflect over federation state. Files live only in MongoDB GridFS in v1, behind a pluggable `FileService` abstraction that lets S3 drop in later.

**Tech Stack:** TypeScript, Node 20+, npm workspaces, gRPC (`@grpc/grpc-js` + `ts-proto`), mongoose, MongoDB 7 (replica set), Docker + docker-compose, Jest, mongo-memory-server.

**Spec:** `docs/superpowers/specs/2026-04-23-cmd-hub-distributed-design.md`. Read it before starting; this plan implements that spec.

**Migration shape:** big-bang rewrite. The monolith stops building after Phase 1 work begins in earnest. The golden scraper test captured in Phase 0 is the regression gate — it must pass against the rewritten distributed stack before v1.0.0 tags.

**Conventions used throughout this plan:**
- "Run tests" means `npm test` at the workspace root unless stated otherwise.
- "Commit" means staging only the files listed in the task, then committing. Never `git add -A`.
- Test-first: every code task has its failing test written and shown to fail before the implementation step.
- Every task ends with a commit. One commit per task unless explicitly combined.
- File paths are absolute from the repo root — drop the leading `/home/data/projects/bots/scrap-hub/` prefix when pasting into commands.

---

## Table of contents

- Phase 0 — Capture ground truth and freeze the contract (Tasks 0.1–0.6)
- Phase 1.A — `packages/cmd-hub/` framework + gateway runtime (Tasks 1.1–1.13)
- Phase 1.B — `packages/cmd-node/` node runtime (Tasks 1.14–1.18)
- Phase 2 — Real gRPC transport, mTLS, integration tests, golden test on loopback (Tasks 2.1–2.7)
- Phase 3 — Container everything, docker-compose, scale + kill tests (Tasks 3.1–3.5)
- Phase 4 — Framework polish and tag v1.0.0 (Tasks 4.1–4.5)
- Self-review notes

---

## Phase 0 — Capture ground truth and freeze the contract

The monolith is about to become irrelevant. Lock in what "correct" means before tearing it apart.

### Task 0.1: Add a `FakeSource` the golden test can depend on

**Files:**
- Create: `packages/org-scraper/src/sources/fake/index.ts`
- Create: `packages/org-scraper/src/sources/fake/__tests__/fake.test.ts`
- Modify: `packages/org-scraper/src/sources/index.ts` — register the fake source conditionally

- [ ] **Step 1: Write the failing test** at `packages/org-scraper/src/sources/fake/__tests__/fake.test.ts`

```ts
import { FakeSource } from '../index';
import type { SearchQuery } from '../../types';

describe('FakeSource', () => {
  it('yields a deterministic sequence of 50 orgs with fixed pacing', async () => {
    const source = new FakeSource({ count: 50, delayMs: 0 });
    const progress: number[] = [];
    const out: Array<{ name: string; phone: string | null }> = [];
    const q: SearchQuery = { query: 'coffee', sources: ['fake'], maxResults: 100 };
    for await (const org of source.search(q, (n) => progress.push(n))) {
      out.push({ name: org.name, phone: org.phone });
    }
    expect(out).toHaveLength(50);
    expect(out[0]).toEqual({ name: 'Fake Org 001', phone: '+10000000001' });
    expect(out[49]).toEqual({ name: 'Fake Org 050', phone: '+10000000050' });
    expect(progress).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx jest -w 1 packages/org-scraper/src/sources/fake --no-coverage`
Expected: FAIL with module-not-found on `../index`.

- [ ] **Step 3: Implement `FakeSource`** at `packages/org-scraper/src/sources/fake/index.ts`

```ts
import type { IScraperSource, SearchQuery, OrgData, ServiceContext } from '../types';

export interface FakeSourceConfig {
  count: number;
  delayMs: number;
}

export class FakeSource implements IScraperSource {
  readonly name = 'fake';
  readonly requiresApiKey = false;
  constructor(private readonly cfg: FakeSourceConfig = { count: 50, delayMs: 0 }) {}

  async *search(
    _query: SearchQuery,
    onProgress: (found: number) => void,
    _ctx?: ServiceContext,
  ): AsyncGenerator<OrgData> {
    for (let i = 1; i <= this.cfg.count; i++) {
      if (this.cfg.delayMs > 0) await new Promise((r) => setTimeout(r, this.cfg.delayMs));
      const n = String(i).padStart(3, '0');
      const org: OrgData = {
        name: `Fake Org ${n}`,
        source: 'fake',
        email: `org${n}@example.test`,
        phone: `+1${String(i).padStart(10, '0')}`,
        address: `${i} Fake Street`,
        url: `https://fake.test/${n}`,
      };
      onProgress(i);
      yield org;
    }
  }
}
```

- [ ] **Step 4: Register it conditionally** in `packages/org-scraper/src/sources/index.ts`

Add near the other `SourceRegistry.register(...)` calls:

```ts
import { FakeSource } from './fake';

if (process.env.CMD_HUB_ENABLE_FAKE_SOURCE === '1') {
  SourceRegistry.register('fake', () => new FakeSource());
}
```

- [ ] **Step 5: Re-run the test — expect pass**

Run: `npx jest -w 1 packages/org-scraper/src/sources/fake --no-coverage`
Expected: PASS.

- [ ] **Step 6: Commit**

Stage only the three files from the Files list, then commit with message `feat(org-scraper): add deterministic FakeSource for golden tests`.

### Task 0.2: Write the golden scraper test against the monolith

**Files:**
- Create: `packages/app/src/__tests__/golden-scraper.test.ts`
- Create: `packages/app/src/__tests__/harness/monolith-harness.ts`
- Create: `packages/app/src/__tests__/harness/capture.ts`
- Create (by running capture): `packages/app/src/__tests__/fixtures/expected-events.json`
- Create (by running capture): `packages/app/src/__tests__/fixtures/expected.csv`

- [ ] **Step 1: Write the harness** at `packages/app/src/__tests__/harness/monolith-harness.ts`

The harness directly instantiates `OrgScraperService`, runs it with `FakeSource`, and collects every emitted event in order with monotonic sequence numbers. Skips Telegram and dashboard; captures the service's raw event emissions.

```ts
import { OrgScraperService } from 'org-scraper/scraper-service/service';
import type { BaseCommandService } from '@core/ui/types/command/service/service';

export interface CapturedEvent {
  seq: number;
  kind: 'message' | 'error' | 'progress' | 'progressStatus' | 'intercom' | 'file' | 'done';
  payload: unknown;
  at: number;
}

export async function runGoldenScraper(): Promise<{
  events: CapturedEvent[];
  csvBytes: Buffer | null;
}> {
  process.env.CMD_HUB_ENABLE_FAKE_SOURCE = '1';

  const svc = new OrgScraperService();
  const userId = 'golden-user';
  const instance = (svc as unknown as { clone: typeof svc.clone }).clone(userId, {
    config: { sources: 'fake', limit: '50', format: 'csv' },
    params: { query: 'coffee', city: '' },
    messages: {},
  }) as BaseCommandService<any>;

  const start = Date.now();
  let seq = 0;
  const events: CapturedEvent[] = [];
  const push = (kind: CapturedEvent['kind'], payload: unknown) =>
    events.push({ seq: ++seq, kind, payload, at: Date.now() - start });

  instance.on('message', (m: string) => push('message', { text: m }));
  instance.on('error', (m: string) => push('error', { text: m }));
  instance.on('progress', (name: string, curr: number, total: number) =>
    push('progress', { name, curr, total }));
  instance.on('progressStatus', (name: string, s: string) =>
    push('progressStatus', { name, status: s }));
  instance.on('intercom', (actions: unknown) => push('intercom', actions));

  let csvBytes: Buffer | null = null;
  instance.on('file', (filePath: string) => {
    const fs = require('fs');
    csvBytes = fs.readFileSync(filePath);
    push('file', { filePath });
  });

  await new Promise<void>((resolve) => {
    instance.on('done', (finalMsg?: string) => {
      push('done', { finalMsg: finalMsg ?? null });
      resolve();
    });
    (async () => {
      await instance.Initialize();
      await instance.run();
    })().catch((err) => {
      push('error', { text: String(err) });
      resolve();
    });
  });

  return { events, csvBytes };
}
```

- [ ] **Step 2: Write the capture script** at `packages/app/src/__tests__/harness/capture.ts`

```ts
import { runGoldenScraper } from './monolith-harness';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const { events, csvBytes } = await runGoldenScraper();
  const fixtureDir = path.resolve(__dirname, '../fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDir, 'expected-events.json'),
    JSON.stringify(events, null, 2),
  );
  if (csvBytes) {
    fs.writeFileSync(path.join(fixtureDir, 'expected.csv'), csvBytes);
  }
  console.log(`captured ${events.length} events, ${csvBytes?.length ?? 0} csv bytes`);
})();
```

- [ ] **Step 3: Run the capture to produce fixtures**

Run: `(cd packages/app && npx ts-node -T src/__tests__/harness/capture.ts)`
Expected: prints `captured N events, M csv bytes`. Both fixture files are created.

- [ ] **Step 4: Write the assertion test** at `packages/app/src/__tests__/golden-scraper.test.ts`

```ts
import * as fs from 'fs';
import * as path from 'path';
import { runGoldenScraper } from './harness/monolith-harness';

const FIXTURE = path.resolve(__dirname, 'fixtures');

describe('golden scraper test', () => {
  it('produces the exact captured event sequence and CSV', async () => {
    const { events, csvBytes } = await runGoldenScraper();
    const expectedEvents = JSON.parse(
      fs.readFileSync(path.join(FIXTURE, 'expected-events.json'), 'utf8'),
    );
    const expectedCsv = fs.readFileSync(path.join(FIXTURE, 'expected.csv'));

    const normalize = (e: any) => ({ seq: e.seq, kind: e.kind, payload: e.payload });
    expect(events.map(normalize)).toEqual(expectedEvents.map(normalize));
    expect(csvBytes).not.toBeNull();
    expect(csvBytes!.equals(expectedCsv)).toBe(true);
  }, 30000);
});
```

- [ ] **Step 5: Run the test — expect pass**

Run: `(cd packages/app && npx jest -w 1 src/__tests__/golden-scraper --no-coverage)`
Expected: PASS.

- [ ] **Step 6: Commit**

Stage everything under `packages/app/src/__tests__/`. Commit message: `test: capture golden scraper fixture from monolith as regression gate`.

### Task 0.3: Scaffold the new packages (empty skeletons) and base tsconfig

**Files:**
- Verify or create: `tsconfig.base.json` (already extended by `packages/app/tsconfig.json`)
- Modify: `package.json` (root) — workspaces already uses `packages/*` and will pick up new ones automatically
- Create: `packages/cmd-node/package.json`
- Create: `packages/cmd-node/tsconfig.json`
- Create: `packages/cmd-node/src/index.ts`
- Create: `packages/create-cmd-node/package.json`
- Create: `packages/create-cmd-node/README.md`

- [ ] **Step 1: Verify `tsconfig.base.json`**

Run: `ls tsconfig.base.json`
If missing, create it with standard Node/TypeScript options (target ES2022, module commonjs, strict, experimentalDecorators, emitDecoratorMetadata). Use `packages/cmd-hub/tsconfig.json` as a reference for the options already assumed.

- [ ] **Step 2: Create `packages/cmd-node/package.json`**

```json
{
  "name": "cmd-node",
  "version": "0.0.1",
  "main": "./build/src/index.js",
  "types": "./build/src/index.d.ts",
  "scripts": {
    "build": "tsc --build --pretty",
    "clean": "rm -rf build",
    "test": "jest --forceExit"
  },
  "license": "ISC",
  "description": "cmd-hub node runtime - host commands and services, connect to a cmd-hub gateway over gRPC",
  "dependencies": {
    "@cmd-hub/core": "*",
    "@grpc/grpc-js": "^1.10.0"
  },
  "devDependencies": {
    "@types/jest": "^30.0.0",
    "@types/node": "^20.0.0",
    "jest": "^30.3.0",
    "ts-jest": "^29.4.9",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 3: Create `packages/cmd-node/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./build",
    "baseUrl": "./",
    "paths": {
      "@core/*": ["../cmd-hub/src/*"]
    }
  },
  "include": ["./src/**/*"],
  "exclude": ["node_modules", "build"]
}
```

- [ ] **Step 4: Create the empty entry** at `packages/cmd-node/src/index.ts`

```ts
export const CMD_NODE_VERSION = '0.0.1';
```

- [ ] **Step 5: Create create-cmd-node placeholder**

`packages/create-cmd-node/package.json`:

```json
{
  "name": "create-cmd-node",
  "version": "0.0.1",
  "private": true,
  "description": "Template for scaffolding a new cmd-node plugin. Populated in Phase 4."
}
```

`packages/create-cmd-node/README.md`:

```md
# create-cmd-node

Template package for scaffolding a new cmd-node. Populated in Phase 4 of the
distributed rewrite.
```

- [ ] **Step 6: Install and verify**

Run: `npm install`
Expected: no errors; `node_modules/cmd-node` and `node_modules/create-cmd-node` symlinked into the root.

- [ ] **Step 7: Commit**

Stage the new package directories, `package-lock.json`, and `tsconfig.base.json` if created. Commit message: `chore: scaffold cmd-node and create-cmd-node workspace packages`.

### Task 0.4: Add gRPC toolchain and write the `.proto` files

**Files:**
- Modify: `packages/cmd-hub/package.json` (add `@grpc/grpc-js`, `ts-proto`, `grpc-tools`)
- Create: `packages/cmd-hub/src/grpc/protos/cmd_node.proto`
- Create: `packages/cmd-hub/src/grpc/protos/file_service.proto`
- Create: `packages/cmd-hub/scripts/gen-proto.sh`
- Create: `packages/cmd-hub/src/grpc/generated/.gitkeep`
- Create: `packages/cmd-hub/src/grpc/__tests__/contract.test.ts`

- [ ] **Step 1: Add deps**

In `packages/cmd-hub/`, run: `npm install @grpc/grpc-js` and `npm install --save-dev ts-proto grpc-tools`.
Expected: installs succeed.

- [ ] **Step 2: Write `cmd_node.proto`** at `packages/cmd-hub/src/grpc/protos/cmd_node.proto`

The `.proto` splits the surface into two gRPC services: `CmdHubService` (hub is the server, node is the client — for `Register`, `Heartbeat`, `CreateWriteGrant`) and `CmdNodeService` (node is the server, hub is the client — for `Invoke`, `ConfigReload`). This split matters because command invocation is initiated by the hub; only registration/heartbeat/file-grant is initiated by the node.

```proto
syntax = "proto3";
package cmdhub.v1;

service CmdHubService {
  rpc Register(RegisterRequest) returns (RegisterResponse);
  rpc Heartbeat(stream HeartbeatClient) returns (stream HeartbeatServer);
  rpc CreateWriteGrant(WriteGrantRequest) returns (WriteGrant);
}

service CmdNodeService {
  rpc Invoke(stream InvokeClient) returns (stream InvokeServer);
  rpc ConfigReload(ConfigReloadRequest) returns (ConfigReloadResponse);
  rpc GetManifest(GetManifestRequest) returns (NodeManifest);
}

enum NodeState { PENDING = 0; ACTIVE = 1; DISABLED = 2; }

message RegisterRequest {
  string node_id = 1;
  string token   = 2;
  NodeManifest manifest = 3;
}
message RegisterResponse {
  string session_token    = 1;
  uint32 poll_interval_ms = 2;
  NodeState assigned_state = 3;
}

message NodeManifest {
  string node_id = 1;
  string node_name = 2;
  string version = 3;
  repeated Command     commands = 4;
  repeated Service     services = 5;
  repeated ConfigModule configs = 6;
  HardwareInfo  hardware = 7;
  MetricsSchema metrics  = 8;
}

message Command {
  string name             = 1;
  string compatibility_id = 2;
  string version          = 3;
  string description      = 4;
  repeated ArgSpec args   = 5;
  repeated string aliases = 6;
}
message ArgSpec {
  string name = 1;
  uint32 position = 2;
  bool   required = 3;
  string type = 4;
  string description = 5;
  repeated string enum_values = 6;
  string default_value = 7;
}
message Service {
  Command command = 1;
  repeated IntercomAction intercom_actions = 2;
  ServiceCapabilities caps = 3;
}
message IntercomAction { string id = 1; string label = 2; string icon = 3; }
message ServiceCapabilities { bool supports_pause = 1; bool supports_stop = 2; }

message ConfigModule {
  string name = 1;
  string scope = 2;
  repeated FieldSpec fields = 3;
}
message FieldSpec {
  string name = 1;
  string type = 2;
  bool sensitive = 3;
  string description = 4;
  string default_value = 5;
}

message HardwareInfo {
  uint32 cpu_cores = 1;
  uint64 total_memory_bytes = 2;
  string os = 3;
  string arch = 4;
  string hostname = 5;
}
message MetricsSchema {
  repeated MetricSpec gauges = 1;
  repeated MetricSpec counters = 2;
  repeated MetricSpec histograms = 3;
}
message MetricSpec { string name = 1; string unit = 2; string description = 3; }

message HeartbeatClient {
  uint64 timestamp_ms = 1;
  repeated MetricSample samples = 2;
}
message HeartbeatServer {
  uint64 timestamp_ms = 1;
  ShutdownSignal shutdown = 2;
}
message MetricSample {
  string name = 1;
  double value = 2;
  uint64 at_ms = 3;
}
message ShutdownSignal { string reason = 1; }

message ConfigReloadRequest  { string node_id = 1; string module_name = 2; }
message ConfigReloadResponse { bool acknowledged = 1; }
message GetManifestRequest   { string node_id = 1; }

message InvokeClient {
  oneof kind {
    InvokeStart    start    = 1;
    Intercom       intercom = 2;
    CancelSession  cancel   = 3;
  }
}
message InvokeStart {
  string session_id = 1;
  string user_id = 2;
  string command_name = 3;
  map<string, string> args = 4;
  bytes  service_data_blob = 5;
}
message Intercom { string action_id = 1; repeated string args = 2; }
message CancelSession { string reason = 1; }

message InvokeServer {
  uint64 seq = 1;
  oneof kind {
    StreamMessage  message        = 2;
    StreamError    error          = 3;
    Progress       progress       = 4;
    ProgressStatus progress_status= 5;
    IntercomUpdate intercom       = 6;
    FileEmitted    file           = 7;
    Done           done           = 8;
  }
}
message StreamMessage  { string text = 1; }
message StreamError    { string text = 1; }
message Progress       { string name = 1; uint64 current = 2; uint64 total = 3; }
message ProgressStatus { string name = 1; string status = 2; }
message IntercomUpdate { repeated IntercomAction actions = 1; }
message FileEmitted    { FileHandle handle = 1; }
message Done           { string final_message = 1; }

message FileHandle {
  string file_id = 1;
  string backend = 2;
  uint64 size    = 3;
  string name    = 4;
  string mime    = 5;
  bool   permanent = 6;
}

message WriteGrantRequest {
  string session_id = 1;
  string node_id = 2;
  string name = 3;
  string mime = 4;
  uint32 ttl_seconds = 5;
  bool   permanent = 6;
  uint64 max_bytes = 7;
}
message WriteGrant {
  string grant_id = 1;
  string upload_url = 2;
  string token = 3;
  uint64 expires_at_ms = 4;
  FileHandle prospective_handle = 5;
}
```

- [ ] **Step 3: Write `file_service.proto`** at `packages/cmd-hub/src/grpc/protos/file_service.proto`

```proto
syntax = "proto3";
package cmdhub.v1;
import "cmd_node.proto";

service FileReadService {
  rpc Stat(FileHandleRef) returns (FileStat);
  rpc Read(FileHandleRef) returns (stream FileChunk);
}
message FileHandleRef { FileHandle handle = 1; }
message FileStat { FileHandle handle = 1; uint64 size = 2; }
message FileChunk { bytes data = 1; uint32 offset = 2; }
```

- [ ] **Step 4: Write the code-gen script** at `packages/cmd-hub/scripts/gen-proto.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

OUT_DIR="src/grpc/generated"
PROTO_DIR="src/grpc/protos"

mkdir -p "$OUT_DIR"

PROTOC_PATH="$(npm root)/.bin/grpc_tools_node_protoc"
TS_PROTO_PATH="$(npm root)/.bin/protoc-gen-ts_proto"

"$PROTOC_PATH" \
  --plugin=protoc-gen-ts_proto="$TS_PROTO_PATH" \
  --ts_proto_out="$OUT_DIR" \
  --ts_proto_opt=esModuleInterop=true,outputServices=grpc-js,useOptionals=messages \
  --proto_path="$PROTO_DIR" \
  "$PROTO_DIR"/*.proto

echo "Generated TypeScript bindings in $OUT_DIR"
```

Make it executable: `chmod +x packages/cmd-hub/scripts/gen-proto.sh`.

- [ ] **Step 5: Generate and verify compile**

Run: `bash packages/cmd-hub/scripts/gen-proto.sh`
Expected: creates `packages/cmd-hub/src/grpc/generated/cmd_node.ts` and `file_service.ts` with no errors.

Then: `(cd packages/cmd-hub && npx tsc --noEmit)`
Expected: clean compile. Adjust `include` in tsconfig if the generated folder isn't picked up.

- [ ] **Step 6: Write the contract round-trip test** at `packages/cmd-hub/src/grpc/__tests__/contract.test.ts`

```ts
import { NodeManifest, InvokeServer } from '../generated/cmd_node';

describe('protobuf round-trip', () => {
  it('encodes and decodes a minimal NodeManifest', () => {
    const m: NodeManifest = {
      nodeId: 'n1',
      nodeName: 'node-one',
      version: '1.0.0',
      commands: [{
        name: 'scraper',
        compatibilityId: 'com.example.scraper',
        version: '1.0.0',
        description: 'scrapes',
        args: [],
        aliases: [],
      }],
      services: [],
      configs: [],
      hardware: {
        cpuCores: 4,
        totalMemoryBytes: 8_000_000_000n as any,
        os: 'linux', arch: 'x64', hostname: 'h',
      },
      metrics: { gauges: [], counters: [], histograms: [] },
    } as unknown as NodeManifest;
    const bytes = NodeManifest.encode(m).finish();
    const back = NodeManifest.decode(bytes);
    expect(back.commands).toHaveLength(1);
    expect(back.commands[0].name).toBe('scraper');
    expect(back.commands[0].compatibilityId).toBe('com.example.scraper');
  });

  it('round-trips an InvokeServer oneof', () => {
    const msg: InvokeServer = {
      seq: 7n as any,
      kind: { $case: 'message', message: { text: 'hi' } },
    } as unknown as InvokeServer;
    const bytes = InvokeServer.encode(msg).finish();
    const back = InvokeServer.decode(bytes);
    expect(back.kind?.$case).toBe('message');
  });
});
```

- [ ] **Step 7: Run — expect pass**

Run: `(cd packages/cmd-hub && npx jest -w 1 src/grpc/__tests__/contract)`
Expected: PASS. If ts-proto emits slightly different type shapes, adjust the test imports to match.

- [ ] **Step 8: Commit**

Stage: `packages/cmd-hub/src/grpc/`, `packages/cmd-hub/scripts/`, `packages/cmd-hub/package.json`, `packages/cmd-hub/package-lock.json`, `packages/cmd-hub/tsconfig.json` (if the `include` was modified).
Commit message: `feat(cmd-hub): add gRPC proto contracts and ts-proto codegen`.

### Task 0.5: Freeze the monolith

**Files:**
- Create: `MONOLITH_FREEZE.md` at repo root

- [ ] **Step 1: Write it**

```md
# Monolith feature freeze

As of 2026-04-23 the current monolithic cmd-hub (packages/cmd-hub/, packages/org-scraper/, packages/app/) is feature-frozen pending the distributed rewrite.

Do not add new features, refactor, or fix non-blocking bugs in these packages. Production bugs discovered during the rewrite are accepted as known and will be fixed only in the rewrite branch.

- Active rewrite branch: rewrite/distributed
- Tracking spec: docs/superpowers/specs/2026-04-23-cmd-hub-distributed-design.md
- Tracking plan: docs/superpowers/plans/2026-04-23-cmd-hub-distributed.md
```

- [ ] **Step 2: Commit**

Stage: `MONOLITH_FREEZE.md`. Message: `docs: freeze monolith for distributed rewrite`.

### Task 0.6: Create the rewrite branch

- [ ] **Step 1: Branch and switch**

Run: `git switch -c rewrite/distributed`

All Phase 1+ work happens on this branch. Merge to `main` only after Phase 3 verification passes.

---

*Phase 1 continues in the next file section. See `docs/superpowers/plans/2026-04-23-cmd-hub-distributed-phase1.md` for Phase 1 tasks, `phase2.md` for Phase 2, etc.*

The plan is split across multiple files due to size. The files are numbered by phase and must be executed in order:

- `2026-04-23-cmd-hub-distributed.md` — Phase 0 (this file)
- `2026-04-23-cmd-hub-distributed-phase1.md` — Phase 1 (both cmd-hub and cmd-node packages)
- `2026-04-23-cmd-hub-distributed-phase2.md` — Phase 2 (real gRPC + mTLS + integration)
- `2026-04-23-cmd-hub-distributed-phase3.md` — Phase 3 (containers + docker-compose)
- `2026-04-23-cmd-hub-distributed-phase4.md` — Phase 4 (framework polish + tag)
