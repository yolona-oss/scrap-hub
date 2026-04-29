import { log } from "@cmd-hub/common"

/**
 * Normalize a search query string so the city always reflects the user's
 * `--city` choice — even if the AI agent (or any other caller) included a
 * different city in its query argument. Used by every source that composes
 * a "topic + city" search string.
 *
 * Rule: strip any known-city token (in any Russian declension) from the
 * raw query, then append the target city in nominative form. With no
 * target city, returns the raw query unchanged.
 */

/** Top ~50 Russian cities — the ones the agent is most likely to write
 *  by mistake. Names are stored in nominative form, lowercased; matching
 *  is stem-based to absorb declensions ("Москва" → "Москве", "Москвы").
 *  Multi-word cities ("Санкт-Петербург", "Нижний Новгород") get the
 *  internal space normalized to a single space at compare time. */
export const KNOWN_RUSSIAN_CITIES: readonly string[] = [
    'Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань',
    'Нижний Новгород', 'Челябинск', 'Самара', 'Омск', 'Уфа',
    'Ростов-на-Дону', 'Краснодар', 'Воронеж', 'Пермь', 'Волгоград',
    'Красноярск', 'Саратов', 'Тюмень', 'Тольятти', 'Ижевск',
    'Барнаул', 'Ульяновск', 'Иркутск', 'Хабаровск', 'Ярославль',
    'Владивосток', 'Махачкала', 'Томск', 'Оренбург', 'Кемерово',
    'Новокузнецк', 'Рязань', 'Астрахань', 'Пенза', 'Липецк',
    'Тула', 'Киров', 'Чебоксары', 'Калининград', 'Брянск',
    'Курск', 'Иваново', 'Магнитогорск', 'Тверь', 'Ставрополь',
    'Сочи', 'Севастополь', 'Симферополь', 'Белгород', 'Сургут',
] as const

/** Lowercased stem of `city` for substring comparison. Matches the same
 *  rule used by the emit-side filter (see emit.ts cityStem): trim 2
 *  trailing chars on names >4 chars long to absorb Russian case endings.
 *  Short names (≤4 chars) stay literal — trimming "Уфа" → "уф" would
 *  match too many unrelated words. */
function cityStem(city: string): string {
    const lower = city.toLowerCase().trim()
    if (lower.length <= 4) return lower
    return lower.slice(0, -2)
}

const KNOWN_STEMS: readonly string[] = KNOWN_RUSSIAN_CITIES.map(cityStem)

/** Strip any known-city stem from `raw` (case-insensitive). Returns the
 *  remaining text with collapsed whitespace. Multi-word cities ("Нижний
 *  Новгород") are tried first so the longer match wins over a shorter
 *  prefix-only match.
 *
 *  Implementation note: JS regex `\b` is ASCII-only and doesn't fire
 *  between Cyrillic letters and word boundaries — using it here would
 *  match nothing. We use lookahead/lookbehind for "non-Cyrillic-letter
 *  or start/end" instead. */
function stripKnownCities(raw: string): string {
    let work = raw
    // Sort stems by length descending so longer multi-word matches consume
    // their territory before single-word prefixes can claim it.
    const stems = [...KNOWN_STEMS].sort((a, b) => b.length - a.length)
    for (const stem of stems) {
        if (!stem) continue
        // Escape any regex metacharacters in the stem (cities have hyphens,
        // e.g. "санкт-петербур").
        const escaped = stem.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
        // Match the stem at a Cyrillic-word boundary: preceded by start-of-
        // string or a non-Cyrillic-letter, followed by any Cyrillic suffix
        // (the declension), then by a non-Cyrillic-letter or end-of-string.
        // The `i` flag handles capitalization.
        const re = new RegExp(
            `(^|[^а-яёА-ЯЁ])${escaped}[а-яё]*(?=$|[^а-яёА-ЯЁ])`,
            'gi',
        )
        // Replace match with the captured leading delimiter (so we don't eat
        // a separator the surrounding text needs) plus a single space.
        work = work.replace(re, '$1 ')
    }
    return work.replace(/\s+/g, ' ').trim()
}

/**
 * Compose the final search string a source should send. With no target
 * city, returns `rawQuery` trimmed. With a target city set, scrubs any
 * known-city tokens from `rawQuery` and appends `targetCity` in nominative
 * form, separated by a single space.
 *
 * Examples (target city = "Санкт-Петербург"):
 *   normalizeSearchQuery("адвокат")              → "адвокат Санкт-Петербург"
 *   normalizeSearchQuery("адвокат Москва")       → "адвокат Санкт-Петербург"
 *   normalizeSearchQuery("адвокат в Москве")     → "адвокат в Санкт-Петербург"
 *   normalizeSearchQuery("адвокат Санкт-Петербурге") → "адвокат Санкт-Петербург"
 */
export function normalizeSearchQuery(rawQuery: string, targetCity?: string): string {
    const raw = (rawQuery ?? '').trim()
    if (!targetCity || !targetCity.trim()) {
        log.trace(`city-query.normalize: passthrough (no targetCity) raw="${raw.slice(0, 100)}"`)
        return raw
    }
    const scrubbed = stripKnownCities(raw)
    const city = targetCity.trim()
    const out = scrubbed ? `${scrubbed} ${city}` : city
    if (raw !== out) {
        log.debug(`city-query.normalize: rewrote "${raw.slice(0, 100)}" → "${out.slice(0, 100)}" (target="${city}")`)
    } else {
        log.trace(`city-query.normalize: no change (already canonical): "${raw.slice(0, 100)}"`)
    }
    return out
}
