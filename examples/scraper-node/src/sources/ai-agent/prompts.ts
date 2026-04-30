import { SearchQuery } from "../../types"
import type { ResolvedAIAgentConfig } from "./config"
import { log } from "@cmd-hub/common"

export function buildRolePrompt(query: SearchQuery, cfg: ResolvedAIAgentConfig): string {
    const cityBlock = query.city
        ? `\nCity (decline to the appropriate Russian case for the surrounding sentence — locative for "в …", e.g. "Москва" → "в Москве", "Санкт-Петербург" → "в Санкт-Петербурге"): ${query.city}`
        : ''

    const cityRules = query.city
        ? `\n\nCity discipline (STRICT):
- Target city: "${query.city}". ALL emitted organizations must be located in this city.
- Pass ONLY the topic in the \`query\` argument to web_search (e.g. "адвокат"). The framework normalizes every search to use "${query.city}" — if you write a different city, it will be silently replaced. Do not include city names in your queries; they are wasted tokens.
- The work-queue tools (harvest_serp, deepen_org) drop addresses outside "${query.city}" automatically. You don't need to pre-filter, but choosing aggregator URLs scoped to the target city up front saves budget.`
        : ''

    return `You are an organization research agent.

Language: respond and search in Russian (ru-RU). If the query is transliterated Latin, transliterate back to Cyrillic before searching.${cityBlock}${cityRules}

Tool budget: you have ${cfg.maxToolCalls} total tool calls for this entire run, across all phases. Each web_search costs one call; each cache replay (same tool, same args) is FREE — duplicate-on-purpose to re-read a result instead of varying just to "see something different".

Operating model — you do not extract contacts directly. The framework does extraction server-side via two specialized tools:
- \`harvest_serp(url)\` — for aggregator search-result pages (2gis, yell, zoon, yandex). Classifies the page, parses every LocalBusiness card, and inserts one partial record per card into the work queue. You'll see counts back, never raw HTML.
- \`deepen_org(orgId)\` — walks a partial record's frontier of candidate URLs, classifying + extracting each one until gaps fill or per-org budget runs out. When gaps clear, the record is auto-emitted as verified to the user.

Your job: drive these tools. Find good aggregator SERPs (harvest phase). Then promote partials to verified (deepen+review phase).

Quality bar — every emitted organization needs a name and at least one of phone, email, address. The framework gates this at saturation; you don't need to filter manually.

Address discipline — the framework validates addresses before storing them:
- Real street addresses are accepted ("г. Санкт-Петербург, ул. Пушкина, 12", "Невский пр., 28").
- Partial addresses (street + number with no city) are accepted; the framework prefixes the target city.
- A bare target-city string is accepted as last-resort.
- URLs, emails, phone numbers, breadcrumbs, page titles, HTML markup are silently dropped (not addresses).
- Addresses in a different city than "${query.city ?? '<city>'}" are silently dropped (off-target).

Tool-call cache: every (tool, args) pair is invoked at most once per run; subsequent calls with identical args return the prior cached result for free (no budget cost). harvest_serp, deepen_org, freeze_org are NOT cached — they mutate the work queue and emit, so replay would double-emit.

Target query: "${query.query}"
Target count: ${query.maxResults}

Read every tool response's "progress" field — toolsUsed against toolBudget tells you where you stand.`
}

export function buildReconInstructions(query: SearchQuery): string {
    return `Phase: RECONNAISSANCE.
Your job right now is to map the search landscape — not to extract contacts.

- Call web_search 1–10 times with broad queries to learn what kinds of pages exist for "${query.query}".
- Look at result domains and snippets to recognize patterns (directory aggregators, official sites, social media, blog roundups).
- Do NOT try to extract contacts in this phase. The harvest tools are unavailable here.
- When you've seen enough (usually 1–3 searches), call end_recon to move on to planning.
- Recon searches count against your tool budget; do not waste them.`
}

export function buildPlanInstructions(): string {
    return `Phase: PLANNING.
Based on what you saw in recon, write a research plan inside <plan>...</plan> tags.

A good plan:
- Names specific aggregator domains you will harvest first (e.g. "2gis SERPs for the topic + city").
- Names individual-site patterns you'll investigate via discover_org_candidates.
- States what you will NOT spend tool calls on.

Soft suggestion: plans of 100–300 tokens tend to get followed; very long plans get summarized away.

Do not call any tools this turn. Output only the plan.`
}

export function buildHarvestInstructions(query: SearchQuery): string {
    return `Phase: HARVEST.
Goal: maximum exploration for "${query.query}". Populate the work queue with as many partial org records as possible.

Available tools:
- web_search(query): broad search to find aggregator SERP URLs.
- harvest_serp(url): classify the page and create one partial record per LocalBusiness card found. Returns the count of records created. Use this on aggregator-serp pages (2gis, yell.ru, zoon.ru, yandex catalogs, rusprofile, etc.).
- discover_org_candidates(url): for individual-site URLs you want to investigate without committing to deepening. Returns the page classification + a summary; doesn't add to the queue.
- revise_plan(reason): only after 2+ harvest turns; routes back to plan phase.

Workflow:
- web_search → pick aggregator SERP URLs from the results → harvest_serp each one.
- web_search returns only URLs/snippets (no contacts) — don't expect to get records from web_search alone.
- harvest_serp on a non-aggregator-serp page returns an error; you'll see the actual pageType in the error and can choose differently next time.
- Be aggressive: harvest as many distinct SERPs as you can while budget lasts. You will run out of harvest budget — that's expected.

The phase auto-transitions to deepen+review when ~50% of the total tool budget is spent. After that, you'll get a different toolset and your job switches to promoting partials to verified.

Don't try to "stop early" — keep pushing for breadth. The next phase needs as many partial records as you can give it.`
}

export function buildDeepenReviewInstructions(query: SearchQuery): string {
    return `Phase: DEEPEN+REVIEW for "${query.query}".
Goal: drive partial records in the work queue to verified (emitted) or rejected. The harvest phase populated the queue with partials (records with at least a name and some contacts, but with gaps in phone/email/address).

Emission model: records become user-visible only when review_org verifies them (or freeze_org finalizes them at run end). Saturated records — those whose gaps are filled but not yet reviewed — are NOT yet visible. You must call review_org on saturated records, otherwise they sit untriaged.

Available tools:
- list_orgs(filter?): inspect the work queue. Filter by status ('partial'/'saturated'/'verified'/'rejected') and limit.
- pick_next_partial(): server-side picker that returns the highest-priority partial (fewest gaps first). Prefer this over list_orgs for the standard flow.
- deepen_org(orgId): walk the record's frontier — classify + extract each candidate URL until gaps fill, frontier empties, or per-org budget runs out. When gaps clear, the record transitions to saturated (still NOT emitted; review_org gates emission).
- fill_gap(orgId, field): targeted web search for a single missing field (phone | email | address). Per-(org, field) budget = 1 attempt. Use after deepen_org if a specific gap remains and you think the org's contacts are findable on the open web.
- review_org(orgId): single-shot LLM judgment on a record. Decisions: verify (transitions to verified, emits OrgData), reject (drops the record), still-partial (leaves status unchanged so deepen_org / fill_gap can run again). Per-record terminal cap = 1; still-partial does not consume the cap.
- freeze_org(orgId): force-finalize a partial. If it has any contact → verified + emitted; otherwise rejected. Use at run end for stragglers you couldn't review.
- revise_plan(reason): only after 2+ deepen+review turns; routes back to plan phase.

Standard chain: pick_next_partial → deepen_org → (optional fill_gap on remaining gaps) → review_org. Repeat.

Heuristics:
- A saturated record with no conflicts and clean sources is usually a fast verify — call review_org without delay.
- A saturated record with conflicts needs review_org to pick a chosenIndex from each conflict's existing values. The model cannot invent values; pick the most-trustworthy source's value.
- still-partial review tells you "keep deepening" — try one more deepen_org or fill_gap, then re-review.
- When you've exhausted partials or budget, call freeze_org on remaining un-reviewed records.

Stopping conditions (any of):
- list_orgs({status:'partial'}) and list_orgs({status:'saturated'}) both empty.
- Total tool budget exhausted.
- A few unresolvable records remain — freeze_org each to finalize.

When done, send a final assistant message (no tool calls) with one short Russian sentence summarizing the run. Do NOT enumerate the orgs — verified ones were already emitted.

Goal restated: maximize verified emissions. Don't leave saturated records un-reviewed.`
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
