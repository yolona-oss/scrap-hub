import 'reflect-metadata'
import { CmdService, getCmdServiceMeta } from '../service-decorator'

class FakeConfigData {}
class FakeParamsData {}
class FakeMessagesData {}

describe('CmdService', () => {
    it('stores the decorator metadata on the class', () => {
        @CmdService({
            name: 'scraper',
            description: 'scrape things',
            compatibilityId: 'com.example.scraper',
            version: '1.0.0',
            config: FakeConfigData,
            params: FakeParamsData,
            messages: FakeMessagesData,
        })
        class FakeService {}

        const meta = getCmdServiceMeta(FakeService)
        expect(meta).toEqual({
            name: 'scraper',
            description: 'scrape things',
            compatibilityId: 'com.example.scraper',
            version: '1.0.0',
            config: FakeConfigData,
            params: FakeParamsData,
            messages: FakeMessagesData,
        })
    })

    it('getCmdServiceMeta returns null for undecorated classes', () => {
        class UndecoratedClass {}
        expect(getCmdServiceMeta(UndecoratedClass)).toBeNull()
    })

    it('throws at registration time if required fields are missing', () => {
        expect(() =>
            CmdService({
                name: '',
                description: 'x',
                compatibilityId: 'x',
                version: '1.0.0',
                config: FakeConfigData,
                params: FakeParamsData,
                messages: FakeMessagesData,
            } as any)(class {}),
        ).toThrow(/name/)
    })

    it('rejects non-semver version strings', () => {
        expect(() =>
            CmdService({
                name: 'scraper',
                description: 'x',
                compatibilityId: 'x',
                version: 'not-a-version',
                config: FakeConfigData,
                params: FakeParamsData,
                messages: FakeMessagesData,
            })(class {}),
        ).toThrow(/version/)
    })
})
