#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

OUT_DIR="src/grpc/generated"
PROTO_DIR="src/grpc/protos"

mkdir -p "$OUT_DIR"

# npm hoists binaries to the monorepo root; fall back to the per-package bin
# path if the root hoist is absent.
if [ -x "../../node_modules/.bin/grpc_tools_node_protoc" ]; then
    PROTOC_PATH="$(cd ../.. && pwd)/node_modules/.bin/grpc_tools_node_protoc"
    TS_PROTO_PATH="$(cd ../.. && pwd)/node_modules/.bin/protoc-gen-ts_proto"
else
    PROTOC_PATH="$(pwd)/node_modules/.bin/grpc_tools_node_protoc"
    TS_PROTO_PATH="$(pwd)/node_modules/.bin/protoc-gen-ts_proto"
fi

"$PROTOC_PATH" \
    --plugin=protoc-gen-ts_proto="$TS_PROTO_PATH" \
    --ts_proto_out="$OUT_DIR" \
    --ts_proto_opt=esModuleInterop=true,outputServices=grpc-js,useOptionals=messages \
    --proto_path="$PROTO_DIR" \
    "$PROTO_DIR"/*.proto

echo "Generated TypeScript bindings in $OUT_DIR"
