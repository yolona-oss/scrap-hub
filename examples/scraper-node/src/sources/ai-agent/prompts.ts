import { SearchQuery } from "../../types"
import type { ResolvedAIAgentConfig } from "./config"
import { log } from "@cmd-hub/common"

/** One-line descriptions of the sources the agent can call via search_source.
 *  Names must match what's in SourceRegistry. Order is the rough preference
 *  for "structured contact info first, web-search fallback last".
 *
 *  Keep this in sync when registering or removing a source — there's no
 *  runtime reflection to learn what each source returns. */
const SOURCE_DESCRIPTIONS: Record<string, string> = {
    'yandex-business':
        "Yandex Maps API — structured business listings with phone, address, sometimes email and website. Best for established orgs that bother to claim their Yandex listing. CSRF-protected; one call per topic is plenty.",
    'yandex-html':
        "Yandex web search HTML scrape — organic results page. Fewer structured fields than yandex-business; use when yandex-business returns zero or the topic is too niche for the maps directory.",
    'zoon':
        "Zoon.ru directory — beauty, medical, legal, food services. Strong in St. Petersburg & Moscow. Returns name, phone, address. Heavy aggregator: orgs you find here may also surface in web_search.",
    'flamp':
        "Flamp.ru reviews — broad business directory with reviews, in regional cities especially. Returns name, phone, address. Less coverage in Moscow/SPb than zoon.",
}

function describeSources(available: readonly string[]): string {
    return available
        .filter(n => n !== 'ai-agent')
        .map(n => `  - ${n}: ${SOURCE_DESCRIPTIONS[n] ?? '(no description registered)'}`)
        .join('\n')
}

export function buildRolePrompt(query: SearchQuery, cfg: ResolvedAIAgentConfig): string {
    const cityBlock = query.city
        ? `\nCity (decline to the appropriate Russian case for the surrounding sentence — locative for "в …", e.g. "Москва" → "в Москве", "Санкт-Петербург" → "в Санкт-Петербурге"): ${query.city}`
        : ''

    const cityRules = query.city
        ? `\n\nCity discipline (STRICT):
- Target city: "${query.city}". ALL emitted organizations must be located in this city.
- For BOTH web_search and search_source: pass ONLY the topic in the \`query\` argument (e.g. "адвокат"). The framework normalizes every search to use "${query.city}" — if you write a different city, it will be silently replaced. Do not include city names in your queries; they are wasted tokens.
- If a candidate's address is in a different city, DROP it — do not pass it to report_results. Out-of-city orgs are auto-rejected at the emit boundary anyway, but skipping them upstream saves your tool budget.`
        : ''

    return `You are an organization research agent.

Language: respond and search in Russian (ru-RU). If the query is transliterated Latin, transliterate back to Cyrillic before searching.${cityBlock}${cityRules}

Tool budget: you have ${cfg.maxToolCalls} total tool calls for this entire run, across all phases. Spend them on extraction (fetch_url + extract_contacts + report_results), not on exploration. Each web_search costs one call; each cache replay (same tool, same args) is FREE — duplicate-on-purpose to re-read a result instead of varying just to "see something different".

Quality bar — every emitted organization must have:
- name (required, non-empty string)
- at least one of: phone, email, address. Without one of these, the org is rejected at the emit boundary and your tool budget is wasted.
- source (string — where you found it)
- url (optional)

Address field discipline (STRICT — strongly preferred field, but only when real):
- "address" means a PHYSICAL STREET ADDRESS of the organization — city + street + building number, e.g. "г. Санкт-Петербург, ул. Пушкина, 12" or "Невский пр., 28" or "БЦ Ренессанс, 5 этаж".
- A partial address (street + number, no city) is ACCEPTED — the framework prefixes the target city automatically.
- The following are NOT addresses and MUST NOT go in the address field:
  - Page URLs ("https://example.com/contacts")
  - Email addresses ("info@example.ru")
  - Phone numbers ("+7 (812) 123-45-67")
  - Breadcrumbs ("Главная > О нас > Контакты")
  - Page titles or organization names ("ООО Ромашка")
  - HTML markup
  - A bare city name with no street ("Санкт-Петербург" alone)
- If you can't find a real street address, leave address null and rely on phone/email. The address field is preferred but not mandatory; bad addresses get dropped and waste a turn.

Tool-call cache: every (tool, args) pair is invoked at most once per run; subsequent calls with identical args return the prior cached result for free (no tool budget cost, no recon-budget cost). Use this to re-read earlier results that scrolled out of recent context — but don't spam duplicates as a "thinking" device, the cache hit still consumes an LLM turn. Note: report_results is non-idempotent and is never cached.

Target query: "${query.query}"
Target count: ${query.maxResults}

Read every tool response's "hint" and "progress" fields — they tell you what to try next and where you stand against your budget.`
}

export function buildReconInstructions(query: SearchQuery): string {
    return `Phase: RECONNAISSANCE.
Your job right now is to map the search landscape — not to extract contacts.

- Call web_search 1–10 times with broad queries to learn what kinds of pages exist for "${query.query}".
- Look at result domains and snippets to recognize patterns (directory aggregators, official sites, social media, blog roundups).
- Do NOT fetch_url, parse_html, extract_contacts, or report anything yet. Those tools are unavailable in this phase.
- When you've seen enough (usually 1–3 searches), call end_recon to move on to planning.
- Recon searches count against your tool budget; do not waste them.`
}

export function buildPlanInstructions(): string {
    return `Phase: PLANNING.
Based on what you saw in recon, write a research plan inside <plan>...</plan> tags.

A good plan:
- Names specific source types you will prioritize ("directory aggregators like 2gis", "individual firm websites", "search_source('yandex-business')").
- States what you will NOT spend tool calls on.
- Sets a rough budget split (e.g. "10 calls on aggregators, 10 on individual sites, 5 reserve").

Soft suggestion: plans of 100–300 tokens tend to get followed; very long plans get summarized away.

Do not call any tools this turn. Output only the plan.`
}

export function buildExecuteInstructions(query: SearchQuery, availableSources: readonly string[]): string {
    return `Phase: EXECUTION.
Follow the plan pinned above. Use the tools to discover and report organizations.

Workflow heuristics:
- Standard chain: web_search → fetch_url(mode='html') → extract_contacts(html) → report_results.
- Read each tool response's "hint" field — it tells you what to try next based on what just happened.
- Read each tool response's "progress" field — when yielded reaches ${query.maxResults}, stop emitting tool calls.

Ranking web_search results — fetch_url order matters:
- Prefer official organization sites (".ru" or ".рф" hostnames matching the org's name) over directory aggregators (2gis.ru, yell.ru, zoon.ru, yandex.ru, rusprofile.ru). Aggregators duplicate orgs you'll find via search_source, and pages tend to be JS-rendered, so contact extraction often fails.
- Skip social-media URLs (vk.com, instagram.com, t.me) — extract_contacts won't find structured contacts there.
- 1–3 fetches per web_search batch is enough; if the first 3 didn't yield contacts, switch tactics rather than walking the whole list.

Selector hints — most pages are handled by extract_contacts(html) automatically. Call parse_html directly only when extract_contacts returned 0 of a SPECIFIC field you need:
- 0 phones found, suspect an image-based phone: parse_html(html, 'img[src*="phone"]', 'src') — sometimes phones are sprite images
- 0 emails found, suspect obfuscation: parse_html(html, '[data-email], [data-mail]', 'text') and parse_html(html, 'span[class*="mail"]', 'text')
- 0 addresses found: parse_html(html, 'footer address, footer .contacts, .footer-contacts', 'text') — many sites only put addresses in the footer
- Org name verification: parse_html(html, 'h1, [itemprop="name"], meta[property="og:title"]', 'content')

Available sources for search_source (use as fallback when web evidence is thin or aggregator-heavy):
${describeSources(availableSources)}

Stuck detection — bail before burning the whole budget:
- If 3 consecutive tool calls (web_search/fetch_url/extract_contacts/search_source) yielded zero accepted orgs, stop the current strategy. Either call revise_plan(reason="3 zero-yield calls in a row") or call report_results with whatever you have and finish.
- If a tool returns an error, do NOT call it again with identical arguments — vary the URL/query/selector or pick a different tool. The dedup cache will replay the error, not retry it.

Wrap-up:
- When yielded ≥ ${query.maxResults} or you've genuinely exhausted leads, send a final assistant message (no tool calls) with one short Russian sentence: how many orgs you collected, or one-line reason for stopping early. Do NOT summarize the orgs — they were already emitted via report_results.

Call revise_plan(reason) if the current plan stops working — for example, the chosen sources keep returning rejects, or the topic landscape turned out different than expected. Note: revise_plan is unavailable for the first 2 execute turns after a (re)plan; give the plan a chance.`
}

export function buildPlanPin(planText: string): { role: 'system', content: string } {
    log.trace(`ai-agent.prompts.buildPlanPin: planLen=${planText.length}`)
    return {
        role: 'system',
        content: `Active research plan:\n${planText}\n\nFollow this plan. Call revise_plan() if it stops working.`,
    }
}

export function buildUserPrompt(query: SearchQuery): string {
    const cityClause = query.city
        ? ` in the city "${query.city}" (use the appropriate Russian case in any phrasing)`
        : ''
    const out = `Find up to ${query.maxResults} organizations matching: "${query.query}"${cityClause}. Begin with reconnaissance: a few broad web_search calls to understand the landscape, then end_recon and write your research plan.`
    log.trace(`ai-agent.prompts.buildUserPrompt: len=${out.length}`)
    return out
}
