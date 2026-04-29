import type { ExtractorInput } from './types'

const CLEANED_TEXT_MAX_CHARS = 8000

export function buildExtractorSystemPrompt(): string {
    return [
        'You are a focused web-page contact extractor. The deterministic extractor failed to find structured contacts on a page that looks substantive. Your job is to read the pre-extracted page material and return phone numbers, emails, and addresses that are actually present.',
        '',
        'Tools available:',
        '- `read_blocks(selector)` — fetch additional pre-extracted DOM blocks by selector keyword (e.g. "footer", "contact", "header", "*" for all).',
        '- `read_json_blob(name)` — fetch parsed JSON blobs (`name`: "next-data" for `__NEXT_DATA__`, "json-ld" for all JSON-LD entries).',
        '- `report_extraction(...)` — TERMINAL. Submit your final extracted contacts.',
        '- `report_incomplete(reason, hints?)` — TERMINAL. Hand back diagnostics when extraction is impossible.',
        '',
        'Rules:',
        '1. You must always end with a terminal tool call (`report_extraction` or `report_incomplete`). The loop forces termination on budget exhaustion.',
        '2. Do not invent values. Only return phone numbers, emails, and addresses you actually saw in the provided material.',
        '3. Phone numbers should be in international format (+7XXXXXXXXXX). Reassemble fragments split across spans/elements when you are confident they form one number.',
        '4. Be conservative on `confidence`: 0.9+ for explicit structured data (microdata, JSON-LD), 0.7 for clearly-formatted footer/contacts blocks, 0.5 or below for ambiguous text.',
        '5. Use `notes` to flag anything unusual (e.g. "phone split across spans, reassembled" or "address inferred from city + street name").',
    ].join('\n')
}

export function buildExtractorUserPrompt(input: ExtractorInput): string {
    const truncated = input.cleanedText.length > CLEANED_TEXT_MAX_CHARS
    const text = truncated
        ? input.cleanedText.slice(0, CLEANED_TEXT_MAX_CHARS) + '...[truncated]'
        : input.cleanedText

    const blockSummary = input.candidateBlocks.length
        ? input.candidateBlocks.map(b => `- selector="${b.selector}" tels=${b.tels?.length ?? 0} mails=${b.mails?.length ?? 0}`).join('\n')
        : '(no candidate blocks pre-extracted)'

    const jsonLdCount = input.jsonLdBlobs.length
    const hasNextData = input.nextDataBlob !== undefined

    const partialSummary = [
        input.partialResult.phones.length ? `phones=${input.partialResult.phones.length}` : null,
        input.partialResult.emails.length ? `emails=${input.partialResult.emails.length}` : null,
        input.partialResult.addresses.length ? `addresses=${input.partialResult.addresses.length}` : null,
        input.partialResult.candidateName ? `name="${input.partialResult.candidateName.slice(0, 60)}"` : null,
    ].filter(Boolean).join(', ') || '(empty)'

    return [
        `URL: ${input.url}`,
        `Page type: ${input.pageType}`,
        `Goals: ${input.knownGoals.join(', ')}`,
        `Deterministic partial result: ${partialSummary}`,
        '',
        `Candidate blocks (${input.candidateBlocks.length}):`,
        blockSummary,
        '',
        `JSON-LD blobs available: ${jsonLdCount} (call read_json_blob({"name":"json-ld"}) to inspect)`,
        `__NEXT_DATA__ blob available: ${hasNextData} (call read_json_blob({"name":"next-data"}) to inspect)`,
        '',
        '--- BEGIN cleaned page text ---',
        text,
        '--- END cleaned page text ---',
        '',
        'Extract any contacts you can find. Always finish with report_extraction or report_incomplete.',
    ].join('\n')
}
