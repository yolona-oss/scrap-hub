# cmd-hub Distributed — Phase 1 continuation (cmd-node package, Tasks 1.14–1.18)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Parallel track with `2026-04-23-cmd-hub-distributed-phase1b.md`.

These tasks depend on Task 1.1 (shared types in cmd-hub) and the protobuf contract from Task 0.4. Once those are green, Phase 1.B tasks can run in parallel with Phase 1.A.

### Task 1.14: CmdNodeApp with useCommand / useService

**Files:**
- Create: `packages/cmd-node/src/app/cmd-node-app.ts`
- Create: `packages/cmd-node/src/app/__tests__/cmd-node-app.test.ts`

**Surface:**
```ts
interface CmdNodeAppOptions {
  nodeId: string;
  nodeName: string;
  version: string;
  hubAddress?: string;
  mongoUrl?: string;
}

interface CommandDefinition {
  name: string;
  compatibilityId: string;
  version: string;
  description: string;
  args: unknown[];
  aliases: string[];
  run?: (ctx: unknown) => Promise<void>;
}

interface ServiceDefinition {
  command: CommandDefinition;
  intercomActions: Array<{ id: string; label: string; icon: string }>;
  caps: { supportsPause: boolean; supportsStop: boolean };
  serviceClass: unknown;  // subclass of BaseCommandService
}

class CmdNodeApp {
  constructor(opts: CmdNodeAppOptions);
  useCommand(def: CommandDefinition): this;
  useService(def: ServiceDefinition): this;
  useConfigModule(def: { name: string; scope: string; fields: unknown[] }): this;
  buildManifest(): NodeManifest;
  start(): Promise<void>;   // Phase 1 stub, Phase 2 wires the hub client
  stop(): Promise<void>;
}
```

- [ ] **Step 1: Test**

```ts
import { CmdNodeApp } from '../cmd-node-app';

describe('CmdNodeApp', () => {
  it('refuses to register a command without compatibility_id or version', () => {
    const app = new CmdNodeApp({ nodeId: 'n', nodeName: 'n', version: '1.0.0' });
    expect(() => app.useCommand({ name: 'x', compatibilityId: '', version: '1.0.0' } as any)).toThrow(/compatibility_id/);
    expect(() => app.useCommand({ name: 'x', compatibilityId: 'cid', version: '' } as any)).toThrow(/version/);
  });

  it('buildManifest returns a well-formed manifest', () => {
    const app = new CmdNodeApp({ nodeId: 'n', nodeName: 'n', version: '1.0.0' });
    app.useCommand({
      name: 'scraper', compatibilityId: 'com.ex', version: '1.0.0',
      description: 'scrape', args: [], aliases: [],
    } as any);
    const m = app.buildManifest();
    expect(m.commands).toHaveLength(1);
    expect(m.commands[0].name).toBe('scraper');
    expect(m.nodeId).toBe('n');
  });
});
```

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement.** Validation enforced at `useCommand()` registration time (throw immediately), not just at `buildManifest()`. Use the `hardwareInfo()` and `MetricsCollector` from Task 1.15 when building the manifest.

- [ ] **Step 4: Commit.** Message: `feat(cmd-node): add CmdNodeApp with useCommand/useService/useConfigModule registration`.

### Task 1.15: HardwareInfo + MetricsCollector

**Files:**
- Create: `packages/cmd-node/src/manifest/hardware-info.ts`
- Create: `packages/cmd-node/src/manifest/metrics-collector.ts`
- Create: `packages/cmd-node/src/manifest/__tests__/hardware-info.test.ts`
- Create: `packages/cmd-node/src/manifest/__tests__/metrics-collector.test.ts`

**`hardwareInfo()`:** returns `{ cpuCores: os.cpus().length, totalMemoryBytes: BigInt(os.totalmem()), os: os.platform(), arch: os.arch(), hostname: os.hostname() }`.

**`MetricsCollector`:** samples memory RSS and event-loop lag every N seconds (default 15). Exposes `snapshot(): MetricSample[]`. Use `process.memoryUsage().rss` and a simple monotonic-time lag measurement (`setImmediate` vs setTimeout reference).

Test → implement → commit. Message: `feat(cmd-node): add HardwareInfo and MetricsCollector utilities`.

### Task 1.16: Event adapter — BaseCommandService events to InvokeServer

**Files:**
- Create: `packages/cmd-node/src/runtime/event-adapter.ts`
- Create: `packages/cmd-node/src/runtime/__tests__/event-adapter.test.ts`

**Test:**

```ts
import { EventEmitter } from 'events';
import { adaptService } from '../event-adapter';
import type { InvokeServer } from '@core/grpc/generated/cmd_node';

describe('event adapter', () => {
  it('forwards every event type to InvokeServer with monotonic seq', () => {
    const svc = new EventEmitter() as any;
    const out: InvokeServer[] = [];
    const stop = adaptService(svc, (m) => out.push(m));
    svc.emit('message', 'hello');
    svc.emit('progress', 'src', 1, 10);
    svc.emit('progressStatus', 'src', 'active');
    svc.emit('intercom', [{ id: 'x', label: 'X', icon: '' }]);
    svc.emit('error', 'bad');
    svc.emit('done', 'final');
    stop();
    expect(out.map((e) => e.kind?.$case)).toEqual(
      ['message', 'progress', 'progress_status', 'intercom', 'error', 'done'],
    );
    expect(out.map((e) => Number(e.seq))).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
```

**Implementation:** function `adaptService(svc, writer)` attaches one listener per event kind, increments a counter, builds the matching protobuf oneof, and calls `writer(msg)`. Returns a `stop()` function that removes all listeners.

Test → implement → commit. Message: `feat(cmd-node): add event adapter from BaseCommandService to InvokeServer`.

### Task 1.17: Intercom dispatch (InvokeClient.Intercom to receiveMsg)

**Files:**
- Create: `packages/cmd-node/src/runtime/intercom-dispatch.ts`
- Create: `packages/cmd-node/src/runtime/__tests__/intercom-dispatch.test.ts`

**Test:** given a mock service with a spied `receiveMsg(id, args)`, feeding an `InvokeClient.Intercom` through `dispatchIntercom(svc, msg)` calls `receiveMsg('export', ['arg1'])` exactly once.

**Implementation:** a tiny function that unpacks the oneof and calls `svc.receiveMsg(actionId, args)`.

Test → implement → commit. Message: `feat(cmd-node): add intercom dispatch wrapper`.

### Task 1.18: cmd-node CLI

**Files:**
- Create: `packages/cmd-node/src/cli/cmd-node-cli.ts`
- Create: `packages/cmd-node/src/cli/__tests__/start.test.ts`
- Modify: `packages/cmd-node/package.json` — add `"bin": { "cmd-node": "./build/src/cli/cmd-node-cli.js" }`

**Subcommands:**
- `cmd-node start --config=./node.json` — reads config: `{ hubAddress, nodeId, token, certPath, keyPath, hubCaCertPath, mongoUrl }`. In Phase 1, validates all fields present and files readable, logs "config ok, gRPC client not attached in Phase 1", exits 0. Phase 2 makes this subcommand connect to the hub.
- `cmd-node version` — prints the package version.

**Test points:** valid config → exit 0; missing `nodeId` → exit non-zero with clear error; missing cert file → exit non-zero with "cert not found".

**Implementation:** use `commander` and `zod` (add as dep) for config validation.

Test → implement → commit. Message: `feat(cmd-node): add cmd-node CLI with config validation (pre-gRPC)`.

---

*Phase 1 (both .A and .B) complete once Tasks 1.1–1.18 land. Verify:*

- [ ] `npm test --workspace=@cmd-hub/core` green
- [ ] `npm test --workspace=cmd-node` green
- [ ] `npm run build` green in both packages

*Phase 2 continues in `2026-04-23-cmd-hub-distributed-phase2.md`.*
