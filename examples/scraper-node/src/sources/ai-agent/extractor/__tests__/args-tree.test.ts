import { ScraperArgs, type AIAgentConfig } from '../../../../scraper-service/args-tree'

describe('AIAgentSettings.extractor', () => {
    it('AIAgentConfig type includes optional extractor field', () => {
        const cfg: AIAgentConfig = {
            model: 'qwen2.5:7b',
            baseUrl: 'http://localhost:11434/v1',
            extractor: {
                enabled: true,
                model: 'qwen2.5:3b',
                baseUrl: 'http://localhost:11434/v1',
                temperature: 0.1,
                maxToolCallsPerPage: 8,
                timeoutMs: 45000,
            },
        }
        expect(cfg.extractor?.enabled).toBe(true)
    })

    it('ScraperArgs.aiAgent.extractor is optional', () => {
        const args: ScraperArgs = new ScraperArgs()
        expect(args.aiAgent).toBeUndefined()
    })
})
