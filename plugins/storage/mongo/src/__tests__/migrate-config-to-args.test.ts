import 'reflect-metadata'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { migrateConfigToArgs } from '../migrations/0001-config-to-args'
import { AccountModuleModel } from '../models/account/account-module.model'
import { AccountSessionModel } from '../models/account/account-session.model'

describe('migrateConfigToArgs', () => {
    let mongo: MongoMemoryServer

    beforeAll(async () => {
        mongo = await MongoMemoryServer.create()
        await mongoose.connect(mongo.getUri())
    })

    afterAll(async () => {
        await mongoose.disconnect()
        await mongo.stop()
    })

    beforeEach(async () => {
        await AccountModuleModel.deleteMany({})
        await AccountSessionModel.deleteMany({})
    })

    it('renames AccountModule data.config to data.args and unsets data.config', async () => {
        const m = await AccountModuleModel.create({
            name: 'svc',
            account_id: new mongoose.Types.ObjectId(),
            data: { config: { query: 'q1', limit: '10' } },
        })

        const result = await migrateConfigToArgs()
        expect(result.moduleCount).toBe(1)

        const reloaded = await AccountModuleModel.findById(m._id).lean()
        expect((reloaded!.data as any).args).toEqual({ query: 'q1', limit: '10' })
        expect((reloaded!.data as any).config).toBeUndefined()
    })

    it('renames AccountSession data.config to args AND data.runtimeState to state', async () => {
        const s = await AccountSessionModel.create({
            name: 'sess',
            expirity: 86_400_000,
            data: { config: { y: '2' }, runtimeState: { results: [] } },
        })

        const result = await migrateConfigToArgs()
        expect(result.sessionCount).toBe(1)

        const reloaded = await AccountSessionModel.findById(s._id).lean()
        expect((reloaded!.data as any).args).toEqual({ y: '2' })
        expect((reloaded!.data as any).state).toEqual({ results: [] })
        expect((reloaded!.data as any).config).toBeUndefined()
        expect((reloaded!.data as any).runtimeState).toBeUndefined()
    })

    it('is idempotent — second run is a no-op', async () => {
        await AccountModuleModel.create({
            name: 'svc',
            account_id: new mongoose.Types.ObjectId(),
            data: { args: { x: '1' } },
        })

        await migrateConfigToArgs()
        const second = await migrateConfigToArgs()
        expect(second.moduleCount).toBe(0)
        expect(second.sessionCount).toBe(0)

        const docs = await AccountModuleModel.find({}).lean()
        expect((docs[0].data as any).args).toEqual({ x: '1' })
        expect((docs[0].data as any).config).toBeUndefined()
    })

    it('leaves docs without legacy fields untouched', async () => {
        await AccountModuleModel.create({
            name: 'svc',
            account_id: new mongoose.Types.ObjectId(),
            data: { args: { existing: 'value' } },
        })

        const result = await migrateConfigToArgs()
        expect(result.moduleCount).toBe(0)

        const reloaded = await AccountModuleModel.findOne({ name: 'svc' }).lean()
        expect((reloaded!.data as any).args).toEqual({ existing: 'value' })
    })
})
