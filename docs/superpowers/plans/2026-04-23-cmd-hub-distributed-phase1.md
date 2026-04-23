# cmd-hub Distributed — Phase 1 — Build both packages from scratch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Preceded by:** Phase 0 in `2026-04-23-cmd-hub-distributed.md`.

**Goal of Phase 1:** Build the `packages/cmd-hub/` framework + gateway runtime and the `packages/cmd-node/` node runtime from scratch. Both compile. Both unit-test green. No gRPC transport yet — that is Phase 2. A `FakeCmdNodeClient` lets the hub's dispatcher tests run without a network layer.

**Exit criteria:** `npm run build` and `npm test` succeed in both new packages. Contract + hub-side unit + node-side unit tests all green. Monolith is not expected to still build.

Phase 1 has two sub-tracks that can proceed in parallel once Task 1.1 (shared types) is done:

- **Phase 1.A** — `packages/cmd-hub/` (Tasks 1.1–1.13)
- **Phase 1.B** — `packages/cmd-node/` (Tasks 1.14–1.18)

---

## Phase 1.A — `packages/cmd-hub/`

Work order: types → storage → FileService → auth seams → registry → pool → aggregator → client abstraction → dispatcher → built-ins → session index → CmdHubApp → CLI.

### Task 1.1: Shared distributed types

**Files:**
- Create: `packages/cmd-hub/src/distributed/types.ts`
- Create: `packages/cmd-hub/src/distributed/types.test.ts`

- [ ] **Step 1: Write the failing test** at `packages/cmd-hub/src/distributed/types.test.ts`

```ts
import { isFileHandle, FileHandle, WriteGrant } from './types';

describe('distributed types', () => {
  it('isFileHandle narrows an opaque value', () => {
    const h: FileHandle = {
      fileId: 'grfs:abc123',
      backend: 'gridfs',
      size: 1234,
      name: 'report.csv',
      mime: 'text/csv',
      permanent: false,
    };
    expect(isFileHandle(h)).toBe(true);
    expect(isFileHandle({ foo: 1 } as unknown)).toBe(false);
  });

  it('WriteGrant carries a prospective FileHandle and an expiry', () => {
    const g: WriteGrant = {
      grantId: 'g1',
      uploadUrl: 'http://hub.test/upload?grant=g1',
      token: 't',
      expiresAt: Date.now() + 60_000,
      prospective: {
        fileId: 'grfs:pending',
        backend: 'gridfs',
        size: 0,
        name: 'x.csv',
        mime: 'text/csv',
        permanent: false,
      },
    };
    expect(isFileHandle(g.prospective)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test — expect failure** (module not yet present).

- [ ] **Step 3: Implement** at `packages/cmd-hub/src/distributed/types.ts`

```ts
export interface FileHandle {
  readonly fileId: string;
  readonly backend: string;
  readonly size: number;
  readonly name: string;
  readonly mime: string;
  readonly permanent: boolean;
}

export function isFileHandle(x: unknown): x is FileHandle {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.fileId === 'string' &&
    typeof o.backend === 'string' &&
    typeof o.size === 'number' &&
    typeof o.name === 'string' &&
    typeof o.mime === 'string' &&
    typeof o.permanent === 'boolean'
  );
}

export interface WriteGrant {
  readonly grantId: string;
  readonly uploadUrl: string;
  readonly token: string;
  readonly expiresAt: number;
  readonly prospective: FileHandle;
}

export type NodeState = 'PENDING' | 'ACTIVE' | 'DISABLED';

export interface NodeRecord {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly state: NodeState;
  readonly certFingerprint: string;
  readonly tokenHash: string;
  readonly createdVia: 'cli' | 'manual';
  readonly registeredAt: number | null;
  readonly lastSeen: number | null;
  readonly manifestSnapshotId: string | null;
}

export interface SessionContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly command: string;
  readonly nodeId: string;
  readonly startedAt: number;
  readonly uiHandle: unknown;
}
```

- [ ] **Step 4: Run the test — expect pass. Commit.**

Stage: `packages/cmd-hub/src/distributed/types.ts`, `packages/cmd-hub/src/distributed/types.test.ts`.
Message: `feat(cmd-hub): add distributed core types (FileHandle, WriteGrant, NodeRecord, SessionContext)`.

### Task 1.2: NodeRecord and FileMetadata mongoose models

**Files:**
- Create: `packages/cmd-hub/src/distributed/db/node-record.model.ts`
- Create: `packages/cmd-hub/src/distributed/db/file-metadata.model.ts`
- Create: `packages/cmd-hub/src/distributed/db/__tests__/node-record.model.test.ts`

- [ ] **Step 1: Install `mongodb-memory-server`** as a dev dep.

Run: `(cd packages/cmd-hub && npm install --save-dev mongodb-memory-server@10)`

- [ ] **Step 2: Write the failing test** at `packages/cmd-hub/src/distributed/db/__tests__/node-record.model.test.ts`

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { NodeRecordModel } from '../node-record.model';

describe('NodeRecordModel', () => {
  let rs: MongoMemoryReplSet;

  beforeAll(async () => {
    rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(rs.getUri('cmdhub-test'));
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await rs.stop();
  });

  it('persists a node record and enforces unique nodeId', async () => {
    await NodeRecordModel.create({
      nodeId: 'n1', nodeName: 'one', state: 'PENDING',
      certFingerprint: 'abc', tokenHash: 'hash', createdVia: 'cli',
      registeredAt: null, lastSeen: null, manifestSnapshotId: null,
    });
    await expect(NodeRecordModel.create({
      nodeId: 'n1', nodeName: 'dup', state: 'PENDING',
      certFingerprint: 'xyz', tokenHash: 'hash2', createdVia: 'cli',
      registeredAt: null, lastSeen: null, manifestSnapshotId: null,
    })).rejects.toThrow(/duplicate key/);
  });
});
```

- [ ] **Step 3: Run — expect failure.**

- [ ] **Step 4: Implement `node-record.model.ts`**

```ts
import mongoose, { Schema } from 'mongoose';
import type { NodeRecord } from '../types';

const schema = new Schema<NodeRecord>(
  {
    nodeId:              { type: String, required: true, unique: true, index: true },
    nodeName:            { type: String, required: true },
    state:               { type: String, enum: ['PENDING', 'ACTIVE', 'DISABLED'], required: true },
    certFingerprint:     { type: String, required: true },
    tokenHash:           { type: String, required: true },
    createdVia:          { type: String, enum: ['cli', 'manual'], required: true },
    registeredAt:        { type: Number, default: null },
    lastSeen:            { type: Number, default: null },
    manifestSnapshotId:  { type: String, default: null },
  },
  { collection: 'cmdhub_nodes', timestamps: false },
);

export const NodeRecordModel = mongoose.model<NodeRecord>('CmdHubNodeRecord', schema);
```

- [ ] **Step 5: Implement `file-metadata.model.ts`**

```ts
import mongoose, { Schema } from 'mongoose';

export interface FileMetadataDoc {
  gridFsId: mongoose.Types.ObjectId;
  sessionId: string | null;
  nodeId: string | null;
  permanent: boolean;
  expiresAt: Date | null;
  name: string;
  mime: string;
  size: number;
}

const schema = new Schema<FileMetadataDoc>(
  {
    gridFsId:  { type: Schema.Types.ObjectId, required: true, unique: true, index: true },
    sessionId: { type: String, default: null, index: true },
    nodeId:    { type: String, default: null, index: true },
    permanent: { type: Boolean, required: true },
    expiresAt: { type: Date,    default: null, index: { expireAfterSeconds: 0 } },
    name:      { type: String,  required: true },
    mime:      { type: String,  required: true },
    size:      { type: Number,  required: true },
  },
  { collection: 'cmdhub_file_metadata' },
);

export const FileMetadataModel = mongoose.model<FileMetadataDoc>('CmdHubFileMetadata', schema);
```

- [ ] **Step 6: Run test — expect pass. Commit.**

Message: `feat(cmd-hub): add NodeRecord and FileMetadata mongoose models`.

### Task 1.3: FileService with GridFSBackend

**Files:**
- Create: `packages/cmd-hub/src/distributed/files/types.ts`
- Create: `packages/cmd-hub/src/distributed/files/file-service.ts`
- Create: `packages/cmd-hub/src/distributed/files/gridfs-backend.ts`
- Create: `packages/cmd-hub/src/distributed/files/__tests__/gridfs-backend.test.ts`

- [ ] **Step 1: Write interface** `types.ts`

```ts
import type { FileHandle, WriteGrant } from '../types';

export interface WriteGrantInput {
  sessionId: string | null;
  nodeId: string | null;
  name: string;
  mime: string;
  ttlSeconds: number;
  permanent: boolean;
  maxBytes: number;
}

export interface FileServiceBackend {
  readonly name: string;
  issueWriteGrant(req: WriteGrantInput): Promise<WriteGrant>;
  completeWrite(grantId: string, actualBytes: number): Promise<FileHandle>;
  read(handle: FileHandle): AsyncIterable<Buffer>;
  stat(handle: FileHandle): Promise<FileHandle>;
  delete(handle: FileHandle): Promise<void>;
}

export interface IFileService extends Omit<FileServiceBackend, 'name'> {}
```

- [ ] **Step 2: Write the failing test** `gridfs-backend.test.ts`

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { GridFSBackend } from '../gridfs-backend';

describe('GridFSBackend', () => {
  let rs: MongoMemoryReplSet;
  let backend: GridFSBackend;

  beforeAll(async () => {
    rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(rs.getUri('gfs-test'));
    backend = new GridFSBackend({
      conn: mongoose.connection,
      hubPublicBaseUrl: 'http://hub.test',
    });
  }, 60_000);

  afterAll(async () => { await mongoose.disconnect(); await rs.stop(); });

  it('issues a grant, accepts bytes, returns a FileHandle, and reads back', async () => {
    const grant = await backend.issueWriteGrant({
      sessionId: 's1', nodeId: 'n1', name: 'r.csv',
      mime: 'text/csv', ttlSeconds: 3600, permanent: false, maxBytes: 1_000_000,
    });
    expect(grant.uploadUrl).toContain('http://hub.test');

    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db!);
    const stream = bucket.openUploadStreamWithId(
      new mongoose.Types.ObjectId(grant.prospective.fileId),
      'r.csv',
    );
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', () => resolve());
      stream.on('error', reject);
      stream.end(Buffer.from('name,phone\nA,1\n'));
    });
    const handle = await backend.completeWrite(grant.grantId, 15);
    expect(handle.size).toBe(15);
    expect(handle.backend).toBe('gridfs');

    const chunks: Buffer[] = [];
    for await (const c of backend.read(handle)) chunks.push(c);
    expect(Buffer.concat(chunks).toString()).toBe('name,phone\nA,1\n');
  });
});
```

- [ ] **Step 3: Run — expect failure.**

- [ ] **Step 4: Implement `gridfs-backend.ts`**

```ts
import mongoose from 'mongoose';
import { randomBytes } from 'crypto';
import type { FileServiceBackend, WriteGrantInput } from './types';
import type { FileHandle, WriteGrant } from '../types';
import { FileMetadataModel } from '../db/file-metadata.model';

const DEFAULT_TTL_SEC = 24 * 60 * 60;
const GRANT_TTL_MS = 60_000;

interface PendingGrant {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: number;
  readonly input: WriteGrantInput;
  readonly gridFsId: mongoose.Types.ObjectId;
}

export interface GridFSBackendOptions {
  conn: mongoose.Connection;
  hubPublicBaseUrl: string;
}

export class GridFSBackend implements FileServiceBackend {
  readonly name = 'gridfs';
  private readonly bucket: mongoose.mongo.GridFSBucket;
  private readonly grants = new Map<string, PendingGrant>();

  constructor(private readonly opts: GridFSBackendOptions) {
    this.bucket = new mongoose.mongo.GridFSBucket(opts.conn.db!);
  }

  async issueWriteGrant(input: WriteGrantInput): Promise<WriteGrant> {
    const grantId = randomBytes(16).toString('hex');
    const token = randomBytes(32).toString('hex');
    const gridFsId = new mongoose.Types.ObjectId();
    const expiresAt = Date.now() + GRANT_TTL_MS;

    this.grants.set(grantId, { id: grantId, token, expiresAt, input, gridFsId });

    const prospective: FileHandle = {
      fileId: gridFsId.toHexString(),
      backend: 'gridfs',
      size: 0,
      name: input.name,
      mime: input.mime,
      permanent: input.permanent,
    };
    return {
      grantId,
      uploadUrl: `${this.opts.hubPublicBaseUrl}/upload?grant=${grantId}`,
      token,
      expiresAt,
      prospective,
    };
  }

  async completeWrite(grantId: string, actualBytes: number): Promise<FileHandle> {
    const grant = this.grants.get(grantId);
    if (!grant) throw new Error(`no such grant: ${grantId}`);
    if (grant.expiresAt < Date.now()) {
      this.grants.delete(grantId);
      throw new Error(`grant expired: ${grantId}`);
    }

    const ttl = grant.input.permanent
      ? null
      : new Date(Date.now() + (grant.input.ttlSeconds || DEFAULT_TTL_SEC) * 1000);

    await FileMetadataModel.create({
      gridFsId: grant.gridFsId,
      sessionId: grant.input.sessionId ?? null,
      nodeId: grant.input.nodeId ?? null,
      permanent: grant.input.permanent,
      expiresAt: ttl,
      name: grant.input.name,
      mime: grant.input.mime,
      size: actualBytes,
    });

    this.grants.delete(grantId);
    return {
      fileId: grant.gridFsId.toHexString(),
      backend: 'gridfs',
      size: actualBytes,
      name: grant.input.name,
      mime: grant.input.mime,
      permanent: grant.input.permanent,
    };
  }

  async *read(handle: FileHandle): AsyncIterable<Buffer> {
    const id = new mongoose.Types.ObjectId(handle.fileId);
    const stream = this.bucket.openDownloadStream(id);
    for await (const chunk of stream) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    }
  }

  async stat(handle: FileHandle): Promise<FileHandle> {
    const meta = await FileMetadataModel.findOne({
      gridFsId: new mongoose.Types.ObjectId(handle.fileId),
    }).lean();
    if (!meta) throw new Error(`unknown file: ${handle.fileId}`);
    return {
      fileId: handle.fileId,
      backend: 'gridfs',
      size: meta.size,
      name: meta.name,
      mime: meta.mime,
      permanent: meta.permanent,
    };
  }

  async delete(handle: FileHandle): Promise<void> {
    const id = new mongoose.Types.ObjectId(handle.fileId);
    await this.bucket.delete(id).catch(() => undefined);
    await FileMetadataModel.deleteOne({ gridFsId: id });
  }
}
```

- [ ] **Step 5: Implement `file-service.ts`**

```ts
import type { FileServiceBackend, IFileService, WriteGrantInput } from './types';
import type { FileHandle, WriteGrant } from '../types';

export class FileService implements IFileService {
  constructor(private readonly backend: FileServiceBackend) {}
  issueWriteGrant(r: WriteGrantInput): Promise<WriteGrant> { return this.backend.issueWriteGrant(r); }
  completeWrite(g: string, n: number): Promise<FileHandle> { return this.backend.completeWrite(g, n); }
  read(h: FileHandle): AsyncIterable<Buffer> { return this.backend.read(h); }
  stat(h: FileHandle): Promise<FileHandle> { return this.backend.stat(h); }
  delete(h: FileHandle): Promise<void> { return this.backend.delete(h); }
}
```

- [ ] **Step 6: Run test — expect pass. Commit.**

Message: `feat(cmd-hub): add FileService abstraction and GridFSBackend (v1)`.

### Task 1.4: Auth seams — ICertVerifier, ITokenVerifier, internal implementations

**Files:**
- Create: `packages/cmd-hub/src/distributed/auth/types.ts`
- Create: `packages/cmd-hub/src/distributed/auth/internal-cert-verifier.ts`
- Create: `packages/cmd-hub/src/distributed/auth/internal-token-verifier.ts`
- Create: `packages/cmd-hub/src/distributed/auth/__tests__/internal-cert-verifier.test.ts`
- Create: `packages/cmd-hub/src/distributed/auth/__tests__/internal-token-verifier.test.ts`

- [ ] **Step 1: Install deps**

Run: `(cd packages/cmd-hub && npm install node-forge bcryptjs && npm install --save-dev @types/node-forge @types/bcryptjs)`

- [ ] **Step 2: Write `types.ts`**

```ts
export interface CertVerificationInput {
  nodeId: string;
  clientCertPem: string;
}
export interface ICertVerifier {
  verify(input: CertVerificationInput, expectedFingerprint: string): Promise<boolean>;
  fingerprint(certPem: string): string;
}

export interface ITokenVerifier {
  hash(token: string): Promise<string>;
  verify(token: string, expectedHash: string): Promise<boolean>;
}
```

- [ ] **Step 3: Implement `internal-cert-verifier.ts`**

```ts
import { X509Certificate } from 'crypto';
import type { ICertVerifier, CertVerificationInput } from './types';

export class InternalCertVerifier implements ICertVerifier {
  fingerprint(certPem: string): string {
    const x = new X509Certificate(certPem);
    return x.fingerprint256.replace(/:/g, '').toLowerCase();
  }

  async verify(input: CertVerificationInput, expectedFingerprint: string): Promise<boolean> {
    try {
      return this.fingerprint(input.clientCertPem) === expectedFingerprint.toLowerCase();
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Implement `internal-token-verifier.ts`**

```ts
import bcrypt from 'bcryptjs';
import type { ITokenVerifier } from './types';

export class InternalTokenVerifier implements ITokenVerifier {
  constructor(private readonly rounds = 10) {}
  hash(token: string): Promise<string> { return bcrypt.hash(token, this.rounds); }
  verify(token: string, expectedHash: string): Promise<boolean> {
    return bcrypt.compare(token, expectedHash);
  }
}
```

- [ ] **Step 5: Write both tests**

`internal-cert-verifier.test.ts`:

```ts
import { InternalCertVerifier } from '../internal-cert-verifier';
import * as forge from 'node-forge';

describe('InternalCertVerifier', () => {
  it('computes SHA-256 fingerprint and matches on same cert', async () => {
    const cert = forge.pki.createCertificate();
    const keys = forge.pki.rsa.generateKeyPair(2048);
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 86400_000);
    const attrs = [{ name: 'commonName', value: 'node-1' }];
    cert.setSubject(attrs); cert.setIssuer(attrs);
    cert.sign(keys.privateKey);
    const pem = forge.pki.certificateToPem(cert);

    const v = new InternalCertVerifier();
    const fp = v.fingerprint(pem);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(await v.verify({ nodeId: 'node-1', clientCertPem: pem }, fp)).toBe(true);
  });
});
```

`internal-token-verifier.test.ts`:

```ts
import { InternalTokenVerifier } from '../internal-token-verifier';

describe('InternalTokenVerifier', () => {
  const v = new InternalTokenVerifier(4);
  it('hash and verify round-trips', async () => {
    const h = await v.hash('my-token');
    expect(await v.verify('my-token', h)).toBe(true);
    expect(await v.verify('wrong', h)).toBe(false);
  });
});
```

- [ ] **Step 6: Run both tests — expect pass. Commit.**

Message: `feat(cmd-hub): add InternalCertVerifier and InternalTokenVerifier with seam interfaces`.

### Task 1.5: CmdNodeRegistry — persistence plus lifecycle

Full content in the Phase 1 continuation file — see `2026-04-23-cmd-hub-distributed-phase1b.md`. This file is capped at Task 1.4 to keep it digestible. Continue with the same **test → implement → commit** pattern shown in Tasks 1.1–1.4.

**Surface summary (for advance planning):**
- `CmdNodeRegistry.provision(input)` — creates a node row with `state: 'PENDING' | 'ACTIVE'` depending on `autoActivate`; returns `{ nodeId, token }` (raw token printed once).
- `.get(nodeId) | .list() | .approve(id) | .deregister(id) | .forget(id)` — trivial mongoose calls.
- `.markRegistered(nodeId, { presentedToken, presentedFingerprint, manifestSnapshotId })` — called by the Register RPC handler (Phase 2). Validates fingerprint AND token before marking `registeredAt` and `lastSeen`.
- `.touchLastSeen(nodeId)` — called by the Heartbeat handler.

### Tasks 1.6–1.13

Continued in `2026-04-23-cmd-hub-distributed-phase1b.md`:

- Task 1.6: `CommandPool` — pool membership, round-robin, user override
- Task 1.7: `ManifestAggregator` — atomic attach/detach across a node manifest
- Task 1.8: `ICmdNodeClient` interface and `FakeCmdNodeClient`
- Task 1.9: `HubDispatcher` — built-ins-first dispatch + node routing
- Task 1.10: Built-ins (`/node`, `/help`, `/config`, `/sconfig`, `/service-ctrl`)
- Task 1.11: `SessionIndex`
- Task 1.12: `CmdHubApp` orchestrator with `useUI()`
- Task 1.13: cmd-hub CLI (`start`, `ca-init`, `node-add`, etc.)

### Tasks 1.14–1.18 (`packages/cmd-node/`)

Continued in `2026-04-23-cmd-hub-distributed-phase1c.md`:

- Task 1.14: `CmdNodeApp` with `useCommand` / `useService`
- Task 1.15: HardwareInfo + MetricsCollector
- Task 1.16: Event adapter — `BaseCommandService` events to `InvokeServer`
- Task 1.17: Intercom dispatch
- Task 1.18: cmd-node CLI

---

*Before proceeding to Phase 2, verify:*

- [ ] `npm test --workspace=@cmd-hub/core` green
- [ ] `npm test --workspace=cmd-node` green
- [ ] Contract + unit tests cover everything implemented in Phase 1
- [ ] `npm run build` green in both packages

*Phase 2 continues in `2026-04-23-cmd-hub-distributed-phase2.md`.*
