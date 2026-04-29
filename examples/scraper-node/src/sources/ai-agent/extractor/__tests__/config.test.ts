import { resolveExtractorConfig } from '../config'
import type { ResolvedAIAgentConfig } from '../../config'

const PARENT: ResolvedAIAgentConfig = {
    baseUrl: 'http://parent/v1',
    apiKey: 'parent-key',
    model: 'qwen-parent',
    temperature: 0.5,
    maxToolCalls: 100,
    toolTimeoutMs: 60000,
    totalTimeoutMs: 3600000,
    maxToolCallsPerOrg: 5,
    extractor: null,
}

describe('resolveExtractorConfig', () => {
    it('returns null when parent is null', () => {
        expect(resolveExtractorConfig(null, { enabled: true } as any)).toBeNull()
    })

    it('returns null when extractor.enabled is explicitly false', () => {
        expect(resolveExtractorConfig(PARENT, { enabled: false } as any)).toBeNull()
    })

    it('returns null when extractor settings absent', () => {
        expect(resolveExtractorConfig(PARENT, undefined)).toBeNull()
    })

    it('inherits parent model when extractor.model is empty', () => {
        const r = resolveExtractorConfig(PARENT, { enabled: true, model: '' } as any)
        expect(r?.model).toBe('qwen-parent')
    })

    it('inherits parent baseUrl when extractor.baseUrl is empty', () => {
        const r = resolveExtractorConfig(PARENT, { enabled: true, baseUrl: '' } as any)
        expect(r?.baseUrl).toBe('http://parent/v1')
    })

    it('inherits parent apiKey when extractor.apiKey is empty', () => {
        const r = resolveExtractorConfig(PARENT, { enabled: true, apiKey: '' } as any)
        expect(r?.apiKey).toBe('parent-key')
    })

    it('overrides with extractor model when set', () => {
        const r = resolveExtractorConfig(PARENT, { enabled: true, model: 'qwen-small' } as any)
        expect(r?.model).toBe('qwen-small')
    })

    it('applies defaults for temperature, maxToolCallsPerPage, timeoutMs', () => {
        const r = resolveExtractorConfig(PARENT, { enabled: true } as any)
        expect(r?.temperature).toBe(0.1)
        expect(r?.maxToolCallsPerPage).toBe(8)
        expect(r?.timeoutMs).toBe(45000)
    })

    it('respects explicit overrides', () => {
        const r = resolveExtractorConfig(PARENT, {
            enabled: true, temperature: 0.3, maxToolCallsPerPage: 4, timeoutMs: 30000,
        } as any)
        expect(r?.temperature).toBe(0.3)
        expect(r?.maxToolCallsPerPage).toBe(4)
        expect(r?.timeoutMs).toBe(30000)
    })

    it('applies maxRefetches default of 3', () => {
        const r = resolveExtractorConfig(PARENT, { enabled: true } as any)
        expect(r?.maxRefetches).toBe(3)
    })

    it('respects explicit maxRefetches override', () => {
        const r = resolveExtractorConfig(PARENT, { enabled: true, maxRefetches: 5 } as any)
        expect(r?.maxRefetches).toBe(5)
    })
})
