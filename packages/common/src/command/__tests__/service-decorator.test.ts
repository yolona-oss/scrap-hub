import 'reflect-metadata'
import { CmdService, getCmdServiceMeta } from '../service-decorator'
import { CmdArg } from '../arg-decorator'

class FakeArgsData {}
class FakeIntercomData {
    @CmdArg({ required: false, description: 'test' })
    echo?: string
}
class FakeNestedInner {
    @CmdArg({ required: false, description: 'inner leaf' })
    leaf?: string
}
class FakeNestedIntercom {
    @CmdArg({ childClass: FakeNestedInner, description: 'nested branch' })
    nested?: FakeNestedInner
}

describe('CmdService', () => {
    it('stores the decorator metadata on the class', () => {
        @CmdService({
            name: 'scraper',
            description: 'scrape things',
            compatibilityId: 'com.example.scraper',
            version: '1.0.0',
            args: FakeArgsData,
            intercom: FakeIntercomData,
        })
        class FakeService {}

        const meta = getCmdServiceMeta(FakeService)
        expect(meta).toEqual({
            name: 'scraper',
            description: 'scrape things',
            compatibilityId: 'com.example.scraper',
            version: '1.0.0',
            args: FakeArgsData,
            intercom: FakeIntercomData,
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
                args: FakeArgsData,
                intercom: FakeIntercomData,
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
                args: FakeArgsData,
                intercom: FakeIntercomData,
            })(class {}),
        ).toThrow(/version/)
    })

    it('rejects an intercom class with nested branches', () => {
        expect(() =>
            CmdService({
                name: 'scraper',
                description: 'x',
                compatibilityId: 'x',
                version: '1.0.0',
                args: FakeArgsData,
                intercom: FakeNestedIntercom,
            })(class {}),
        ).toThrow(/nested branch/)
    })
})
