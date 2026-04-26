import * as cheerio from "cheerio"

/** Extraction modes the scraper recognizes. `text` (default) returns inner
 *  text, `html` returns inner HTML, `href`/`src` return those attrs, any
 *  other value is treated as an attribute name. */
export type ExtractMode = 'text' | 'html' | 'href' | 'src' | string

/** Pull a single value from the first match of `selector` within `$el`.
 *  Returns null when the selector doesn't match. */
export function extractFromElement(
    $el: cheerio.Cheerio<any>,
    selector: string,
    mode: ExtractMode = 'text',
): string | null {
    const found = $el.find(selector)
    if (found.length === 0) return null
    return readNode(found, mode)
}

/** Pull the value off an already-resolved cheerio node. Used by parse_html
 *  where the selector is applied at the document level. */
export function readNode(
    node: cheerio.Cheerio<any>,
    mode: ExtractMode = 'text',
): string | null {
    switch (mode) {
        case 'text': {
            const text = node.text().replace(/\s+/g, ' ').trim()
            return text || null
        }
        case 'html': {
            const html = node.html() ?? ''
            return html || null
        }
        case 'href':
            return node.attr('href') ?? null
        case 'src':
            return node.attr('src') ?? null
        default:
            return node.attr(mode) ?? null
    }
}
