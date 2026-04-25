import 'reflect-metadata'
import { CmdArgument } from '../argument-decorator'
import { CommandArgumentHolder } from '../argument-holder'

class DataCls {
    @CmdArgument({ required: true, position: 1, description: 'Query' })
    query!: string

    @CmdArgument({ required: false, description: 'City' })
    city?: string

    @CmdArgument({ required: false, description: 'Limit', defaultValue: '100' })
    limit?: string
}

describe('CommandArgumentHolder.fromMap', () => {
    it('populates fields from a flat string map', () => {
        const instance = CommandArgumentHolder.fromMap(DataCls, { query: 'coffee', city: 'Berlin' })
        expect(instance.query).toBe('coffee')
        expect(instance.city).toBe('Berlin')
    })

    it('applies defaults for missing non-required fields', () => {
        const instance = CommandArgumentHolder.fromMap(DataCls, { query: 'coffee' })
        expect(instance.query).toBe('coffee')
        expect(instance.limit).toBe('100')
    })

    it('throws when a required field is missing', () => {
        expect(() => CommandArgumentHolder.fromMap(DataCls, { city: 'Berlin' })).toThrow(/query/)
    })
})
