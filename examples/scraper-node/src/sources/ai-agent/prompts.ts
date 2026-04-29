import { SearchQuery } from "../../types"

export function buildRolePrompt(query: SearchQuery): string {
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

Quality bar — every emitted organization must have:
- name (required, non-empty string)
- at least one of: phone, email, address. Without one of these, the org is rejected at the emit boundary and your tool budget is wasted.
- source (string — where you found it)
- url (optional)

Global rule: do not repeat the same tool call with identical arguments. Each (tool, args) pair is invoked once per run; duplicates return an error and waste a turn.

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

export function buildExecuteInstructions(query: SearchQuery): string {
    return `Phase: EXECUTION.
Follow the plan pinned above. Use the tools to discover and report organizations.

Workflow heuristics:
- Standard chain: web_search → fetch_url(mode='html') → extract_contacts(html) → report_results.
- Use search_source as a fallback when web evidence is thin or aggregators dominate.
- Read each tool response's "hint" field — it tells you what to try next based on what just happened.
- Read each tool response's "progress" field — when yielded reaches ${query.maxResults}, stop emitting tool calls.

Call revise_plan(reason) if the current plan stops working — for example, the chosen sources keep returning rejects, or the topic landscape turned out different than expected. Note: revise_plan is unavailable for the first 2 execute turns after a (re)plan; give the plan a chance.`
}

export function buildPlanPin(planText: string): { role: 'system', content: string } {
    return {
        role: 'system',
        content: `Active research plan:\n${planText}\n\nFollow this plan. Call revise_plan() if it stops working.`,
    }
}

export function buildUserPrompt(query: SearchQuery): string {
    const cityClause = query.city
        ? ` in the city "${query.city}" (use the appropriate Russian case in any phrasing)`
        : ''
    return `Find up to ${query.maxResults} organizations matching: "${query.query}"${cityClause}. Begin with reconnaissance: a few broad web_search calls to understand the landscape, then end_recon and write your research plan.`
}
