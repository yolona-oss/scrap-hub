import mongoose, { Schema } from 'mongoose'
import type { NodeRecord } from '@cmd-hub/common'

const schema = new Schema<NodeRecord>(
    {
        nodeId:             { type: String, required: true, unique: true, index: true },
        nodeName:           { type: String, required: true },
        state:              { type: String, enum: ['PENDING', 'ACTIVE', 'DISABLED'], required: true },
        certFingerprint:    { type: String, required: true },
        tokenHash:          { type: String, required: true },
        createdVia:         { type: String, enum: ['cli', 'manual'], required: true },
        registeredAt:       { type: Number, default: null },
        lastSeen:           { type: Number, default: null },
        manifestSnapshotId: { type: String, default: null },
    },
    { collection: 'cmdhub_nodes', timestamps: false },
)

export const NodeRecordModel = mongoose.model<NodeRecord>('CmdHubNodeRecord', schema)
