# cmd-hub Distributed — Phase 1 continuation (cmd-hub package, Tasks 1.5–1.13)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Continues from `2026-04-23-cmd-hub-distributed-phase1.md`.

### Task 1.5: CmdNodeRegistry — persistence plus lifecycle

**Files:**
- Create: `packages/cmd-hub/src/distributed/registry/cmd-node-registry.ts`
- Create: `packages/cmd-hub/src/distributed/registry/__tests__/cmd-node-registry.test.ts`

- [ ] **Step 1: Test**

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { CmdNodeRegistry } from '../cmd-node-registry';
import { InternalTokenVerifier } from '../../auth/internal-token-verifier';

describe('CmdNodeRegistry', () => {
  let rs: MongoMemoryReplSet;
  beforeAll(async () => {
    rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(rs.getUri('reg-test'));
  }, 60_000);
  afterAll(async () => { await mongoose.disconnect(); await rs.stop(); });

  it('provision + approve + deregister + forget lifecycle', async () => {
    const tokens = new InternalTokenVerifier(4);
    const reg = new CmdNodeRegistry({ tokens });

    const { nodeId, token } = await reg.provision({
      nodeName: 'scraper-a', certFingerprint: 'ffff',
      createdVia: 'cli', autoActivate: false,
    });
    expect((await reg.get(nodeId))!.state).toBe('PENDING');

    await reg.approve(nodeId);
    expect((await reg.get(nodeId))!.state).toBe('ACTIVE');

    await reg.markRegistered(nodeId, {
      presentedToken: token, presentedFingerprint: 'ffff', manifestSnapshotId: 'snap-1',
    });

    await reg.deregister(nodeId);
    expect((await reg.get(nodeId))!.state).toBe('DISABLED');

    await reg.forget(nodeId);
    expect(await reg.get(nodeId)).toBeNull();
  });

  it('markRegistered rejects bad fingerprint or token', async () => {
    const tokens = new InternalTokenVerifier(4);
    const reg = new CmdNodeRegistry({ tokens });
    const { nodeId, token } = await reg.provision({
      nodeName: 'x', certFingerprint: 'aaaa',
      createdVia: 'manual', autoActivate: true,
    });
    await expect(reg.markRegistered(nodeId, {
      presentedToken: token, presentedFingerprint: 'WRONG', manifestSnapshotId: 's',
    })).rejects.toThrow(/fingerprint/);
    await expect(reg.markRegistered(nodeId, {
      presentedToken: 'bad', presentedFingerprint: 'aaaa', manifestSnapshotId: 's',
    })).rejects.toThrow(/token/);
  });
});
```

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement `cmd-node-registry.ts`**

```ts
import { randomBytes, randomUUID } from 'crypto';
import { NodeRecordModel } from '../db/node-record.model';
import type { NodeRecord, NodeState } from '../types';
import type { ITokenVerifier } from '../auth/types';

export interface ProvisionInput {
  nodeName: string;
  certFingerprint: string;
  createdVia: 'cli' | 'manual';
  autoActivate: boolean;
}
export interface ProvisionOutput {
  nodeId: string;
  token: string;
}
export interface MarkRegisteredInput {
  presentedToken: string;
  presentedFingerprint: string;
  manifestSnapshotId: string;
}

export class CmdNodeRegistry {
  constructor(private readonly deps: { tokens: ITokenVerifier }) {}

  async provision(input: ProvisionInput): Promise<ProvisionOutput> {
    const nodeId = randomUUID();
    const token = randomBytes(32).toString('hex');
    const tokenHash = await this.deps.tokens.hash(token);
    const state: NodeState = input.autoActivate ? 'ACTIVE' : 'PENDING';
    await NodeRecordModel.create({
      nodeId, nodeName: input.nodeName, state,
      certFingerprint: input.certFingerprint, tokenHash,
      createdVia: input.createdVia,
      registeredAt: null, lastSeen: null, manifestSnapshotId: null,
    });
    return { nodeId, token };
  }

  async get(nodeId: string): Promise<NodeRecord | null> {
    return NodeRecordModel.findOne({ nodeId }).lean<NodeRecord | null>();
  }

  async list(): Promise<NodeRecord[]> {
    return NodeRecordModel.find({}).lean<NodeRecord[]>();
  }

  async approve(nodeId: string): Promise<void> {
    const res = await NodeRecordModel.updateOne(
      { nodeId, state: 'PENDING' },
      { $set: { state: 'ACTIVE' } },
    );
    if (res.modifiedCount === 0) throw new Error(`cannot approve node ${nodeId} (not PENDING)`);
  }

  async deregister(nodeId: string): Promise<void> {
    await NodeRecordModel.updateOne({ nodeId }, { $set: { state: 'DISABLED' } });
  }

  async forget(nodeId: string): Promise<void> {
    await NodeRecordModel.deleteOne({ nodeId });
  }

  async markRegistered(nodeId: string, input: MarkRegisteredInput): Promise<NodeRecord> {
    const rec = await NodeRecordModel.findOne({ nodeId });
    if (!rec) throw new Error(`unknown node: ${nodeId}`);
    if (rec.state === 'DISABLED') throw new Error(`node ${nodeId} is DISABLED`);
    if (rec.certFingerprint !== input.presentedFingerprint)
      throw new Error(`certificate fingerprint mismatch for node ${nodeId}`);
    const ok = await this.deps.tokens.verify(input.presentedToken, rec.tokenHash);
    if (!ok) throw new Error(`invalid token for node ${nodeId}`);
    rec.registeredAt = Date.now();
    rec.lastSeen = Date.now();
    rec.manifestSnapshotId = input.manifestSnapshotId;
    await rec.save();
    return rec.toObject() as unknown as NodeRecord;
  }

  async touchLastSeen(nodeId: string): Promise<void> {
    await NodeRecordModel.updateOne({ nodeId }, { $set: { lastSeen: Date.now() } });
  }
}
```

- [ ] **Step 4: Run — expect pass. Commit.**

Message: `feat(cmd-hub): add CmdNodeRegistry with provision/approve/deregister/forget lifecycle`.

### Task 1.6: CommandPool — membership, round-robin, user override

**Files:**
- Create: `packages/cmd-hub/src/distributed/pool/command-pool.ts`
- Create: `packages/cmd-hub/src/distributed/pool/__tests__/command-pool.test.ts`

**Test points:** compatible second join succeeds; different `compatibilityId` rejected; incompatible major rejected; missing `compatibilityId` or `version` rejected; round-robin picks A, B, C, A; user override picks by nodeId; `removeNode` cleans pools.

- [ ] **Step 1: Test**

```ts
import { CommandPool } from '../command-pool';

const cmd = (n: string, cid: string, v: string) => ({
  name: n, compatibilityId: cid, version: v, description: '', args: [], aliases: [],
});

describe('CommandPool', () => {
  it('accepts a compatible second registration', () => {
    const p = new CommandPool();
    expect(p.join('A', cmd('scraper', 'com.ex.s', '1.0.0')).ok).toBe(true);
    expect(p.join('B', cmd('scraper', 'com.ex.s', '1.2.3')).ok).toBe(true);
    expect(p.members('scraper').map((m) => m.nodeId).sort()).toEqual(['A', 'B']);
  });

  it('rejects same name with different compatibility_id', () => {
    const p = new CommandPool();
    p.join('A', cmd('scraper', 'com.ex.s', '1.0.0'));
    const r = p.join('B', cmd('scraper', 'com.other', '1.0.0'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/compatibility_id/);
  });

  it('rejects same name + same cid but incompatible major', () => {
    const p = new CommandPool();
    p.join('A', cmd('scraper', 'com.ex.s', '1.0.0'));
    const r = p.join('B', cmd('scraper', 'com.ex.s', '2.0.0'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/major/);
  });

  it('rejects missing compatibility_id or version', () => {
    const p = new CommandPool();
    expect(p.join('A', cmd('x', '', '1.0.0')).ok).toBe(false);
    expect(p.join('A', cmd('x', 'com.ex', '')).ok).toBe(false);
  });

  it('round-robins across healthy peers', () => {
    const p = new CommandPool();
    p.join('A', cmd('s', 'cid', '1.0.0'));
    p.join('B', cmd('s', 'cid', '1.0.0'));
    p.join('C', cmd('s', 'cid', '1.0.0'));
    const picks = [p.pick('s'), p.pick('s'), p.pick('s'), p.pick('s')];
    expect(picks.map((x) => x!.nodeId)).toEqual(['A', 'B', 'C', 'A']);
  });

  it('user override picks a specific node if it is a peer', () => {
    const p = new CommandPool();
    p.join('A', cmd('s', 'cid', '1.0.0'));
    p.join('B', cmd('s', 'cid', '1.0.0'));
    expect(p.pick('s', { nodeId: 'B' })!.nodeId).toBe('B');
    expect(p.pick('s', { nodeId: 'Z' })).toBeNull();
  });

  it('removeNode cleans a node out of every pool', () => {
    const p = new CommandPool();
    p.join('A', cmd('s', 'cid', '1.0.0'));
    p.join('B', cmd('s', 'cid', '1.0.0'));
    p.removeNode('A');
    expect(p.members('s').map((m) => m.nodeId)).toEqual(['B']);
  });
});
```

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement `command-pool.ts`**

```ts
export interface PoolCommand {
  name: string; compatibilityId: string; version: string;
  description: string; args: unknown[]; aliases: string[];
}
export interface PoolMember { nodeId: string; version: string; command: PoolCommand; }
export type PoolJoinResult = { ok: true } | { ok: false; reason: string };

interface PoolEntry {
  compatibilityId: string; major: number;
  members: PoolMember[]; rrIndex: number;
}

function majorOf(version: string): number | null {
  const m = version.match(/^(\d+)\./);
  return m ? Number(m[1]) : null;
}

export class CommandPool {
  private readonly pools = new Map<string, PoolEntry>();

  join(nodeId: string, cmd: PoolCommand): PoolJoinResult {
    if (!cmd.name) return { ok: false, reason: 'missing command name' };
    if (!cmd.compatibilityId) return { ok: false, reason: 'missing compatibility_id' };
    if (!cmd.version) return { ok: false, reason: 'missing version' };
    const major = majorOf(cmd.version);
    if (major === null) return { ok: false, reason: `invalid semver version: ${cmd.version}` };
    const existing = this.pools.get(cmd.name);
    if (!existing) {
      this.pools.set(cmd.name, {
        compatibilityId: cmd.compatibilityId, major,
        members: [{ nodeId, version: cmd.version, command: cmd }], rrIndex: 0,
      });
      return { ok: true };
    }
    if (existing.compatibilityId !== cmd.compatibilityId) {
      return {
        ok: false,
        reason: `compatibility_id mismatch: pool has "${existing.compatibilityId}", ` +
                `this node declares "${cmd.compatibilityId}"`,
      };
    }
    if (existing.major !== major) {
      return {
        ok: false,
        reason: `incompatible major version: pool is ${existing.major}.x, this node is ${major}.x`,
      };
    }
    existing.members.push({ nodeId, version: cmd.version, command: cmd });
    return { ok: true };
  }

  removeNode(nodeId: string): void {
    for (const [name, entry] of this.pools) {
      entry.members = entry.members.filter((m) => m.nodeId !== nodeId);
      if (entry.members.length === 0) this.pools.delete(name);
    }
  }

  members(name: string): PoolMember[] { return this.pools.get(name)?.members ?? []; }
  names(): string[] { return [...this.pools.keys()]; }

  pick(name: string, opts?: { nodeId?: string }): PoolMember | null {
    const entry = this.pools.get(name);
    if (!entry || entry.members.length === 0) return null;
    if (opts?.nodeId) return entry.members.find((m) => m.nodeId === opts.nodeId) ?? null;
    const pick = entry.members[entry.rrIndex % entry.members.length];
    entry.rrIndex = (entry.rrIndex + 1) % entry.members.length;
    return pick;
  }
}
```

- [ ] **Step 4: Run — expect pass. Commit.** Message: `feat(cmd-hub): add CommandPool with mandatory compatibility_id/version and round-robin`.

### Task 1.7: ManifestAggregator

**Files:**
- Create: `packages/cmd-hub/src/distributed/pool/manifest-aggregator.ts`
- Create: `packages/cmd-hub/src/distributed/pool/__tests__/manifest-aggregator.test.ts`

**Test points:**
- `attach` of a compatible manifest joins its commands into the pool and records it.
- `attach` of an incompatible manifest is rejected wholesale; the partially-joined state is rolled back.
- `detach(nodeId)` removes all contributions from a node.
- `configModuleOwners(moduleName)` returns the nodeIds that declared that config module.

**Implementation notes:**
- Hold a `Map<nodeId, AggregatedManifest>` and a `Map<moduleName, Set<nodeId>>`.
- On attach: iterate commands, call `pool.join(nodeId, cmd)` for each. If any join fails, call `pool.removeNode(nodeId)` to undo partial joins and return the rejection. Otherwise store the manifest and update the config-owner index.
- On detach: `pool.removeNode(nodeId)`, delete from manifest map, prune empty config-owner sets.

Follow the same test → implement → commit pattern. Commit message: `feat(cmd-hub): add ManifestAggregator with atomic attach/detach and config-module index`.

### Task 1.8: ICmdNodeClient interface + FakeCmdNodeClient

**Files:**
- Create: `packages/cmd-hub/src/distributed/client/cmd-node-client.ts`
- Create: `packages/cmd-hub/src/distributed/client/fake-cmd-node-client.ts`

No dedicated test file — used by the dispatcher test in Task 1.9.

- [ ] **Step 1: Write the interface** `cmd-node-client.ts`

```ts
import type { InvokeClient, InvokeServer } from '../../grpc/generated/cmd_node';

export interface InvocationHandle {
  readonly sessionId: string;
  send(msg: InvokeClient): Promise<void>;
  events(): AsyncIterable<InvokeServer>;
  cancel(reason: string): Promise<void>;
}

export interface ICmdNodeClient {
  invoke(
    nodeId: string,
    start: Extract<InvokeClient['kind'], { $case: 'start' }>['start'],
  ): Promise<InvocationHandle>;
}
```

- [ ] **Step 2: Write the fake** `fake-cmd-node-client.ts`

```ts
import { EventEmitter } from 'events';
import type { ICmdNodeClient, InvocationHandle } from './cmd-node-client';
import type { InvokeClient, InvokeServer } from '../../grpc/generated/cmd_node';

export type FakeHandler = (
  nodeId: string,
  start: Extract<InvokeClient['kind'], { $case: 'start' }>['start'],
  emit: (msg: InvokeServer) => void,
) => Promise<void>;

export class FakeCmdNodeClient implements ICmdNodeClient {
  constructor(private readonly handler: FakeHandler) {}

  async invoke(nodeId: string, start: any): Promise<InvocationHandle> {
    const bus = new EventEmitter();
    const queue: InvokeServer[] = [];
    let closed = false;

    const emit = (msg: InvokeServer) => { queue.push(msg); bus.emit('event'); };

    (async () => {
      try { await this.handler(nodeId, start, emit); }
      finally { closed = true; bus.emit('event'); }
    })();

    return {
      sessionId: start.sessionId,
      async send(_: InvokeClient) { /* fakes ignore reverse messages */ },
      async cancel(_: string) { closed = true; bus.emit('event'); },
      async *events() {
        while (true) {
          while (queue.length > 0) yield queue.shift()!;
          if (closed) return;
          await new Promise<void>((resolve) => bus.once('event', () => resolve()));
        }
      },
    };
  }
}
```

- [ ] **Step 3: Commit.** Message: `feat(cmd-hub): add ICmdNodeClient interface and FakeCmdNodeClient for unit tests`.

### Task 1.9: HubDispatcher

**Files:**
- Create: `packages/cmd-hub/src/distributed/dispatcher/hub-dispatcher.ts`
- Create: `packages/cmd-hub/src/distributed/dispatcher/__tests__/hub-dispatcher.test.ts`

**Test points:**
- Built-in takes precedence over any pool command of the same name.
- Pool-only command is routed to the chosen node; events flow back through the `onEvent` callback.
- No pool member for the command returns a `success: false` result with a `no nodes available` message.
- `nodeOverride` forces a specific node; unknown nodeId returns a descriptive failure.

**Implementation skeleton:**

```ts
import { randomUUID } from 'crypto';
import type { InvokeServer } from '../../grpc/generated/cmd_node';
import type { ICmdNodeClient } from '../client/cmd-node-client';
import type { ManifestAggregator } from '../pool/manifest-aggregator';

export interface HandleInput {
  command: string;
  args: Record<string, string>;
  userId: string;
  uiHandle: unknown;
  nodeOverride?: string;
  onEvent?: (e: InvokeServer) => void;
}
export interface HandleResult {
  success: boolean;
  markup: { text: string };
  messageType?: 'system' | 'builder' | 'dashboard' | 'result';
}
export type BuiltInHandler = (input: HandleInput) => Promise<HandleResult>;

export class HubDispatcher {
  private readonly builtIns = new Map<string, BuiltInHandler>();
  constructor(private readonly deps: { aggregator: ManifestAggregator; client: ICmdNodeClient }) {}

  registerBuiltIn(name: string, handler: BuiltInHandler): void {
    if (this.builtIns.has(name)) throw new Error(`built-in already registered: ${name}`);
    this.builtIns.set(name, handler);
  }

  async handle(input: HandleInput): Promise<HandleResult> {
    const bi = this.builtIns.get(input.command);
    if (bi) return bi(input);

    const pool = this.deps.aggregator.getPool();
    const pick = pool.pick(input.command, input.nodeOverride ? { nodeId: input.nodeOverride } : undefined);
    if (!pick) {
      const reason = input.nodeOverride
        ? `node "${input.nodeOverride}" is not a peer for /${input.command}`
        : `no nodes available for /${input.command}`;
      return { success: false, markup: { text: reason }, messageType: 'system' };
    }

    const start = {
      sessionId: randomUUID(),
      userId: input.userId,
      commandName: input.command,
      args: input.args,
      serviceDataBlob: new Uint8Array(),
    };
    const handle = await this.deps.client.invoke(pick.nodeId, start);

    let finalText = '';
    for await (const e of handle.events()) {
      input.onEvent?.(e);
      if (e.kind?.$case === 'done') finalText = e.kind.done.finalMessage ?? '';
    }
    return { success: true, markup: { text: finalText }, messageType: 'dashboard' };
  }
}
```

Test → implement → commit. Message: `feat(cmd-hub): add HubDispatcher routing built-ins locally and commands to pool members`.

### Task 1.10: Built-ins

Five sub-tasks. Each follows the same shape: create `packages/cmd-hub/src/distributed/builtins/<name>.ts`, write its test, implement, commit.

- **Task 1.10.a: `/node`** — subcommands `list | show | approve | deregister | forget`. Fully expanded below.
- **Task 1.10.b: `/help`** — union of built-in names + `ManifestAggregator.listCommandNames()`, with peer nodeIds listed per pool command. Commit message: `feat(cmd-hub): add /help built-in generated from live federation state`.
- **Task 1.10.c: `/config`** — usage `/config <module> [key] [value]`. Deps: `ManifestAggregator`, an `ISystemConfigStore`, and a `configReload(nodeId, moduleName)` callback. The callback MUST be invoked once per node returned by `aggregator.configModuleOwners(moduleName)` on a successful write. Commit: `feat(cmd-hub): add /config built-in with ConfigReload fan-out`.
- **Task 1.10.d: `/sconfig`** — like `/config` but scoped to per-user `AccountModule` documents. No fan-out. Commit: `feat(cmd-hub): add /sconfig built-in for per-user module config`.
- **Task 1.10.e: `/service-ctrl`** — usage `/service-ctrl pause|resume|stop|terminate <sessionId>`. Deps: `SessionIndex` (Task 1.11). Each subcommand calls `handle.send(...)` with the right `Intercom` action or `handle.cancel()`. Commit: `feat(cmd-hub): add /service-ctrl built-in for pause/resume/stop/terminate`.

#### Task 1.10.a fully expanded — `/node` built-in

**Files:**
- Create: `packages/cmd-hub/src/distributed/builtins/node.ts`
- Create: `packages/cmd-hub/src/distributed/builtins/__tests__/node.test.ts`

- [ ] **Step 1: Test**

```ts
import { makeNodeBuiltIn, NodeBuiltInDeps } from '../node';
import { CmdNodeRegistry } from '../../registry/cmd-node-registry';
import { ManifestAggregator } from '../../pool/manifest-aggregator';
import { InternalTokenVerifier } from '../../auth/internal-token-verifier';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';

describe('/node built-in', () => {
  let rs: MongoMemoryReplSet;
  let deps: NodeBuiltInDeps;

  beforeAll(async () => {
    rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(rs.getUri('node-builtin'));
    deps = {
      registry: new CmdNodeRegistry({ tokens: new InternalTokenVerifier(4) }),
      aggregator: new ManifestAggregator(),
    };
  }, 60_000);
  afterAll(async () => { await mongoose.disconnect(); await rs.stop(); });

  it('list shows every registered node', async () => {
    const { nodeId } = await deps.registry.provision({
      nodeName: 'a', certFingerprint: 'x', createdVia: 'cli', autoActivate: true,
    });
    const h = makeNodeBuiltIn(deps);
    const r = await h({ command: 'node', args: { sub: 'list' }, userId: 'u', uiHandle: null });
    expect(r.success).toBe(true);
    expect(r.markup.text).toContain(nodeId);
    expect(r.markup.text).toContain('ACTIVE');
  });

  it('approve transitions PENDING to ACTIVE', async () => {
    const { nodeId } = await deps.registry.provision({
      nodeName: 'b', certFingerprint: 'y', createdVia: 'manual', autoActivate: false,
    });
    const h = makeNodeBuiltIn(deps);
    const r = await h({ command: 'node', args: { sub: 'approve', id: nodeId }, userId: 'u', uiHandle: null });
    expect(r.success).toBe(true);
    expect((await deps.registry.get(nodeId))!.state).toBe('ACTIVE');
  });
});
```

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement `node.ts`**

```ts
import type { BuiltInHandler } from '../dispatcher/hub-dispatcher';
import type { CmdNodeRegistry } from '../registry/cmd-node-registry';
import type { ManifestAggregator } from '../pool/manifest-aggregator';

export interface NodeBuiltInDeps {
  registry: CmdNodeRegistry;
  aggregator: ManifestAggregator;
}

export function makeNodeBuiltIn(deps: NodeBuiltInDeps): BuiltInHandler {
  return async (input) => {
    const sub = input.args.sub ?? 'list';
    switch (sub) {
      case 'list': {
        const rows = await deps.registry.list();
        const text = rows.length === 0
          ? 'no nodes registered'
          : rows.map((r) => `${r.nodeId}\t${r.state}\t${r.nodeName}\tlast-seen=${r.lastSeen ?? 'never'}`).join('\n');
        return { success: true, markup: { text }, messageType: 'system' };
      }
      case 'show': {
        const id = input.args.id;
        if (!id) return { success: false, markup: { text: 'usage: /node show <id>' } };
        const r = await deps.registry.get(id);
        if (!r) return { success: false, markup: { text: `no such node: ${id}` } };
        const man = deps.aggregator.getManifest(id);
        const cmds = man?.commands.map((c) => `${c.name}@${c.version}`).join(', ') ?? '(no active manifest)';
        return { success: true, markup: { text: `${r.nodeId} ${r.state}\nname=${r.nodeName}\ncommands=${cmds}` } };
      }
      case 'approve': {
        const id = input.args.id;
        if (!id) return { success: false, markup: { text: 'usage: /node approve <id>' } };
        await deps.registry.approve(id);
        return { success: true, markup: { text: `approved ${id}` } };
      }
      case 'deregister': {
        const id = input.args.id;
        if (!id) return { success: false, markup: { text: 'usage: /node deregister <id>' } };
        await deps.registry.deregister(id);
        deps.aggregator.detach(id);
        return { success: true, markup: { text: `deregistered ${id}` } };
      }
      case 'forget': {
        const id = input.args.id;
        if (!id) return { success: false, markup: { text: 'usage: /node forget <id>' } };
        await deps.registry.forget(id);
        deps.aggregator.detach(id);
        return { success: true, markup: { text: `forgot ${id}` } };
      }
      default:
        return { success: false, markup: { text: `unknown subcommand: ${sub}` } };
    }
  };
}
```

- [ ] **Step 4: Run — expect pass. Commit.** Message: `feat(cmd-hub): add /node built-in (list|show|approve|deregister|forget)`.

### Task 1.11: SessionIndex

**Files:**
- Create: `packages/cmd-hub/src/distributed/session/session-index.ts`
- Create: `packages/cmd-hub/src/distributed/session/__tests__/session-index.test.ts`

**Surface:**
```ts
class SessionIndex {
  register(ctx: SessionContext, handle: InvocationHandle): void;
  getByUser(userId: string): Array<{ ctx: SessionContext; handle: InvocationHandle }>;
  getBySession(sessionId: string): { ctx: SessionContext; handle: InvocationHandle } | null;
  remove(sessionId: string): void;
  list(): Array<{ ctx: SessionContext; handle: InvocationHandle }>;
}
```

Internal state: `bySession: Map<sessionId, entry>` plus `byUser: Map<userId, Set<sessionId>>`. All in-memory; `SessionContext` is separately persisted to Mongo by the dispatcher for audit.

Test → implement → commit. Message: `feat(cmd-hub): add SessionIndex for live invocation tracking`.

### Task 1.12: CmdHubApp orchestrator

**Files:**
- Create: `packages/cmd-hub/src/distributed/app/cmd-hub-app.ts`
- Create: `packages/cmd-hub/src/distributed/app/__tests__/cmd-hub-app.test.ts`

**Surface:** `new CmdHubApp({ mongoUrl, hubPublicBaseUrl, autoRegister }).useUI(impl).start()`. Exposes `.registry`, `.aggregator`, `.sessions`, and (after `start()`) `.dispatcherInstance`, `.fileServiceInstance`.

**Test points:**
- Composing UIs and starting calls each UI's `start()` exactly once.
- Stopping calls each UI's `stop()` exactly once.
- Repeated start() / stop() are idempotent.

**Implementation:** wires Mongo connection, registry, aggregator, file service, dispatcher, session index, all five built-ins with their specific deps. The gRPC client is a stub in Phase 1 that throws "gRPC client not attached" — replaced by the real implementation in Phase 2.

Follow test → implement → commit. Message: `feat(cmd-hub): add CmdHubApp orchestrator with useUI() imperative registration`.

### Task 1.13: cmd-hub CLI

**Files:**
- Create: `packages/cmd-hub/src/cli/cmd-hub-cli.ts`
- Create: `packages/cmd-hub/src/cli/ca.ts` — helpers for generating CA and signing node certs with `node-forge`
- Create: `packages/cmd-hub/src/cli/__tests__/node-add.test.ts`
- Modify: `packages/cmd-hub/package.json` — add `"bin": { "cmd-hub": "./build/src/cli/cmd-hub-cli.js" }`

**Subcommands:**
- `cmd-hub start` — wires `CmdHubApp` from env vars. Phase 1 may log "gRPC not attached" and exit if no client is wired; Phase 2 gives this subcommand full behavior.
- `cmd-hub ca-init` — generates CA private key and certificate into the paths named by `HUB_CA_KEY` and `HUB_CA_CERT` env vars.
- `cmd-hub node-add <name> [--auto-activate]` — provisions a node via `CmdNodeRegistry.provision()` with a freshly generated node cert signed by the CA. Prints the node config block as JSON on stdout.
- `cmd-hub node-rotate-token <id>` — generates a new token for an existing node, updates the bcrypt hash in the allowlist. Prints the new token.
- `cmd-hub node-list` — prints the result of `CmdNodeRegistry.list()` as a human-readable table.
- `cmd-hub node-remove <id>` — calls `registry.forget()`.

**Test points for `node-add`:**
- Calling `node-add` with a fresh name prints JSON containing `nodeId`, `token`, `cert`, `key`, `hubCaCert`.
- A new row appears in `NodeRecordModel` with `state: 'ACTIVE'` when `--auto-activate` is set, `'PENDING'` otherwise.
- `createdVia: 'cli'` is recorded.

**Implementation notes:**
- Use `commander` for the CLI framework. Install in `packages/cmd-hub/`.
- CA helpers in `ca.ts` use `node-forge`'s cert-signing API. Key size 2048 bits, validity 10 years, SHA-256 signatures.
- Node cert inherits the CA's Subject as its Issuer. Its own Subject CN is the nodeId.
- The JSON printed by `node-add` uses PEM-encoded strings for `cert`, `key`, `hubCaCert`.

Test → implement → commit. Message: `feat(cmd-hub): add cmd-hub CLI (start, ca-init, node-add, node-rotate-token, node-list, node-remove)`.

---

*Phase 1.A complete once Tasks 1.1–1.13 land. Continue with `packages/cmd-node/` in `2026-04-23-cmd-hub-distributed-phase1c.md`.*
