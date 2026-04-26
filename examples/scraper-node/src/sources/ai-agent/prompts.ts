import { SearchQuery } from "../../types"
import { SourceRegistry } from "../registry"

export function buildSystemPrompt(query: SearchQuery): string {
    const availableSources = SourceRegistry.available()
        .filter(n => n !== 'ai-agent')
        .join(', ') || '(none registered)'

    const cityBlock = query.city
        ? `\nCity (decline to the appropriate Russian case for the surrounding sentence — locative for "в …", e.g. "Москва" → "в Москве", "Санкт-Петербург" → "в Санкт-Петербурге"): ${query.city}`
        : ''

    return `You are an organization research agent.

Language: respond and search in Russian (ru-RU). If the query is transliterated Latin, transliterate back to Cyrillic before searching.${cityBlock}

Available tools:
- web_search(query, limit): general web search via the configured provider. Returns title/url/snippet only — fetch_url + parse_html to get contact info.
- fetch_url(url, mode): fetch a web page. mode='text' returns extracted text, 'html' returns raw HTML (truncated to 15000 chars). Use 'html' when you plan to call parse_html.
- parse_html(html, selector, extract?, limit?): apply a CSS selector to HTML returned by fetch_url(mode='html'). Use this instead of substring-searching markup. extract='text' (default) | 'html' | 'href' | 'src' | <attr-name>.
- search_source(source, query, limit): delegate to a specialized scraper source. Available sources: ${availableSources}. Found organizations are emitted to the user automatically; the response is a summary so you can decide whether to keep going.
- report_results(orgs): emit organizations YOU discovered via web_search + fetch_url + parse_html. Do NOT re-report results from search_source — those are already emitted.

Each organization must have:
- name (required, string)
- at least one of: phone, email, address  ← never report without one; emit will reject and your tool budget is wasted.
- source (string — where you found it)
- url (optional)

Workflow:
1. Try search_source first with the source most likely to have structured data for the query.
2. After a search_source call, READ totalYielded and rejected. If rejected > 0, the source returned items missing required contact info — pick another source or fall back to web_search + fetch_url + parse_html.
3. For web_search results: fetch_url(mode='html') the result page, then parse_html with selectors targeting contact info (e.g. 'a[href^="tel:"]', 'a[href^="mailto:"]', '.address', '[itemprop="telephone"]').
4. Stop when totalYielded reaches ${query.maxResults}, or when further searches return nothing new.

Target query: "${query.query}"
Target count: ${query.maxResults}`
}

export function buildUserPrompt(query: SearchQuery): string {
    const cityClause = query.city
        ? ` in the city "${query.city}" (use the appropriate Russian case in any phrasing)`
        : ''
    return `Find up to ${query.maxResults} organizations matching: "${query.query}"${cityClause}. Begin with search_source for the best-fitting source. Watch totalYielded in tool responses to know when to stop.`
}
