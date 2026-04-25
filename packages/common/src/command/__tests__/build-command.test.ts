import 'reflect-metadata'
import { CmdArgument } from '../argument-decorator'
import { CmdService } from '../service-decorator'
import { buildCommandFromDecorator } from '../build-command'

class CfgCls {
    @CmdArgument({ required: true, position: 1, description: 'Query' })
    query!: string
    @CmdArgument({ required: false, description: 'City', defaultValue: '' })
    city?: string
}
class ParCls {}
class MsgCls {
    @CmdArgument({ required: false, standalone: true, description: 'Pause' })
    pause?: void
}

@CmdService({
    name: 'scraper',
    description: 'scrape',
    compatibilityId: 'com.example.scraper',
    version: '1.0.0',
    config: CfgCls, params: ParCls, messages: MsgCls,
})
class FakeService {}

describe('buildCommandFromDecorator', () => {
    it('builds a Command with merged ArgSpecs from config + params + messages', async () => {
        const cmd = await buildCommandFromDecorator(FakeService)
        expect(cmd.name).toBe('scraper')
        expect(cmd.description).toBe('scrape')
        expect(cmd.compatibilityId).toBe('com.example.scraper')
        expect(cmd.version).toBe('1.0.0')
        const argNames = cmd.args.map((a: { name: string }) => a.name)
        expect(argNames).toEqual(expect.arrayContaining(['query', 'city', 'pause']))
        const query = cmd.args.find((a: { name: string }) => a.name === 'query')!
        expect(query.required).toBe(true)
        expect(query.position).toBe(1)
    })

    it('throws on an undecorated service class', async () => {
        class Unadorned {}
        await expect(buildCommandFromDecorator(Unadorned)).rejects.toThrow(/@CmdService/)
    })
})
