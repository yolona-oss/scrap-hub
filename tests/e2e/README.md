# E2E tests against a containerized cmd-hub stack

These tests require `docker compose up -d` to have been run first (see
`docs/deploy/README.md` for the first-run sequence). They connect to the
running hub and verify end-to-end behavior against the real gRPC + Mongo
+ FileService stack.

## Run

    # from the repo root, after `docker compose up -d`
    npm run test:e2e

## Environment

- `HUB_GRPC_ADDRESS` — default `localhost:50051`. The address of the hub's
  gRPC server exposed by docker-compose.
- `HUB_UPLOAD_BASE_URL` — default `http://localhost:3000`. Where the hub's
  `/upload` endpoint lives.
- `HUB_NODE_ID` and `HUB_NODE_TOKEN` — credentials for a test node that
  the test spawns in-process. Typically generated once via
  `cmd-hub node-add e2e-probe --auto-activate`.

## What the golden test verifies

`golden-container.test.ts` runs the same regression gate as the Phase 2.7
loopback test — identical assertion values (`packages/cmd-hub/src/distributed/__tests__/fixtures/`) —
but end-to-end through the containerized hub + a real gRPC node
instantiated in the test process:

1. Registers a test node against the live hub.
2. Hosts a `CmdNodeService.Invoke` server that runs the fixture harness.
3. Triggers the invocation via the hub's gRPC dispatch path.
4. Captures the streamed events and reads the CSV back via `/upload` +
   `FileService.read`.
5. Asserts byte-identical match with `expected-events.json` and
   `expected.csv`.
