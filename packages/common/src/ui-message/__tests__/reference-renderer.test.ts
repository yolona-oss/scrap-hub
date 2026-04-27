import { renderToText, UiMessage, UiRenderContext } from '../index'

const baseCtx: UiRenderContext = {
    ui: 'cli',
    depth: 0,
    render: (child: UiMessage) => renderToText(child, baseCtx),
}

describe('renderToText', () => {
    it('text kind passes through verbatim', () => {
        expect(renderToText({ kind: 'text', text: 'hello' } as UiMessage, baseCtx)).toBe('hello')
    })

    it('markdown kind strips formatting', () => {
        const out = renderToText(
            { kind: 'markdown', md: '# Title\n\n**bold** and *italic* and `code` and [link](https://example)' } as UiMessage,
            baseCtx,
        )
        expect(out).toContain('Title')
        expect(out).toContain('bold')
        expect(out).toContain('italic')
        expect(out).toContain('code')
        expect(out).toContain('link (https://example)')
        expect(out).not.toContain('**')
        expect(out).not.toContain('`')
    })

    it('code kind passes through verbatim', () => {
        expect(renderToText({ kind: 'code', code: 'a = 1' } as UiMessage, baseCtx)).toBe('a = 1')
    })

    it('list kind renders bullets and recurses into children', () => {
        const out = renderToText(
            { kind: 'list', items: [
                { kind: 'text', text: 'a' } as UiMessage,
                { kind: 'text', text: 'b' } as UiMessage,
            ] } as UiMessage,
            baseCtx,
        )
        expect(out).toBe('• a\n• b')
    })

    it('kv kind aligns key:value pairs by line', () => {
        const out = renderToText(
            { kind: 'kv', pairs: [
                { key: 'name', value: 'Acme' },
                { key: 'phone', value: '+123' },
            ] } as UiMessage,
            baseCtx,
        )
        expect(out).toBe('name: Acme\nphone: +123')
    })

    it('link kind renders text with parenthesized url', () => {
        const out = renderToText(
            { kind: 'link', text: 'home', url: 'https://example/' } as UiMessage,
            baseCtx,
        )
        expect(out).toBe('home (https://example/)')
    })

    it('unknown kind falls back to JSON-tagged form', () => {
        const out = renderToText(
            { kind: 'mystery', extra: 1 } as unknown as UiMessage,
            baseCtx,
        )
        expect(out).toMatch(/^\[mystery\]/)
        expect(out).toContain('"extra":1')
    })
})
