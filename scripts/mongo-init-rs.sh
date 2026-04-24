#!/bin/sh
# One-shot helper to initiate the mongo replica set required for transactions
# and GridFS. Idempotent: no-op if the replica set is already configured.
set -e

mongosh --host mongo --eval '
  try {
    rs.status();
    print("replica set already initialized");
  } catch (e) {
    rs.initiate({_id: "rs0", members: [{_id: 0, host: "mongo:27017"}]});
    print("replica set initialized");
  }
'
