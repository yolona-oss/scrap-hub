# AI-Agent PR5 — Delete Legacy Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the legacy `yandex-business` and `cheerio-web` source adapters, the `search_source` tool, the `SOURCE_DESCRIPTIONS` prompt fragment, and the now-orphaned `wrapAsOrgData` helper. Keep `fake` (it's an env-gated test source). Keep `SourceRegistry` (the type seam survives for future structured adapters per the spec). Simplify `SearchQuery.sources` from a multi-value selector to an immutable `['ai-agent']`. Net effect: the agent's universe of sources collapses to itself; `search_source` no longer exists in any phase.

**Architecture:** Pure deletion + reference removal. No new code. Safety hinges on test coverage: any caller of the deleted symbols becomes a tsc error, which guides the cleanup. We delete in dependency order — first the consumers (tools, prompts, registrations), then the implementations themselves.

**Tech Stack:** TypeScript, Node 20, Jest 30. No new dependencies; deletion only.

**Spec reference:** `docs/superpowers/specs/2026-04-29-ai-agent-overhaul-design.md` PR5 — "After PR1-4 are stable... Delete `examples/scraper-node/src/sources/{google,yandex,avito,cheerio}/`. Delete `delegate-source.ts`. Delete `search_source` from prompts. Simplify `SourceRegistry`."

---

## Scope Audit

The spec's PR5 description was speculative about which legacy adapters existed. The actual filesystem audit shows:

**Files that exist (and what to do with them):**

| Path | Status | Action |
|---|---|---|
| `src/sources/yandex-business.ts` | Legacy aggregator adapter | **Delete** |
| `src/sources/cheerio-web.ts` | Generic cheerio source | **Delete** |
| `src/sources/cheerio-extract.ts` | Helper for cheerio-web | **Delete** |
| `src/sources/extract.ts` | (TBD — audit during execution) | **Check usage; delete if orphaned** |
| `src/sources/fake/index.ts` | Test source (env-gated) | **Keep** — useful for tests |
| `src/sources/ai-agent/` | Whole directory | **Keep** |
| `src/sources/registry.ts` | `SourceRegistry` class | **Keep** (type seam) |
| `src/sources/types.ts` | Shared types + `wrapAsOrgData` | **Modify** — remove `wrapAsOrgData`, `LegacyOrgRecord` |
| `src/sources/index.ts` | Source registration | **Modify** — drop yandex/cheerio registrations |
| `src/sources/ai-agent/tools/delegate-source.ts` | The `search_source` tool | **Delete** |
| `src/sources/ai-agent/tools/__tests__/delegate-source.test.ts` | Tool's tests | **Delete** |
| `src/sources/ai-agent/prompts.ts` | Has `SOURCE_DESCRIPTIONS` + execute-phase mentions | **Modify** — remove `SOURCE_DESCRIPTIONS`, references |
| `src/sources/ai-agent/tools/index.ts` | `buildTools` registers `makeDelegateSourceTool` | **Modify** — remove |
| `src/scraper-service/args-tree.ts` | `ScraperArgs.sources` field | **Modify** — make immutable `['ai-agent']` or delete entirely |
| `src/types.ts` | `SearchQuery.sources` field | **Modify** — `string[]` → keep but document as `['ai-agent']` |
| `src/sources/__tests__/yandex-business.test.ts` | Yandex tests | **Delete** |
| `src/sources/__tests__/wrap-as-org-data.test.ts` | `wrapAsOrgData` tests | **Delete** |
| `src/scraper-service/scraper.ts` | Run loop | **Verify** — should still work; no changes expected |

**Critical invariants to preserve:**

- `ai-agent` continues to work end-to-end (its own tests still pass).
- `fake` source still registers when `CMD_HUB_ENABLE_FAKE_SOURCE=1` is set.
- `SourceRegistry.available()` returns at most `['ai-agent']` (and `'fake'` in test mode).
- Build is clean throughout (we delete bottom-up).
- Tests pass at every commit (we don't leave broken intermediate states).

---

## Decisions Locked Before Implementation

- **`fake` source stays.** It's gated by env var and serves a development purpose. Spec said "delete fake adapter" but the audit shows it's not really a legacy source — it's a test fixture.
- **`SourceRegistry` stays.** Per spec §6 PR5: "preserve the type seam for future structured adapters." The class is generic; with only `ai-agent` registered, it's a tiny passthrough.
- **`SearchQuery.sources` field stays as `string[]`** — but in practice will only ever contain `['ai-agent']`. Removing the field entirely would cascade through too many callers. Future cleanup if needed.
- **`ScraperArgs.sources` arg becomes optional with default `'ai-agent'`** and `choices: ['ai-agent']`. Or removed entirely — TBD during execution; depends on whether the builder UI needs the field. **Decision: keep the arg with `choices: ['ai-agent']` so the builder UI shows it but the user can't change it.** Less risky than removing.
- **`wrapAsOrgData` and `LegacyOrgRecord` are deleted.** No callers remain after `yandex-business` and `cheerio-web` go. The `fake` source uses it today (per Task 6 of PR4a) — Task 3 here updates `fake` to inline the conversion.
- **`delegate-source.ts` and its tests are deleted.** The `search_source` tool is gone.
- **`SOURCE_DESCRIPTIONS` and references are deleted from prompts.** Since the LLM has no source to delegate to, mentioning sources in the prompt is misleading.
- **No new tests.** This is pure deletion; the value is what's removed, not added.
- **Worktree:** `.worktrees/ai-agent-pr5`, branch `feature/ai-agent-pr5`. Already created; baseline 341/341 scraper-node tests + build clean.

---

## Task 1: Audit `src/sources/extract.ts` usage

**Files:**
- Read-only: `examples/scraper-node/src/sources/extract.ts`

The plan needs to know whether to delete this file. The audit happens before any edits.

- [ ] **Step 1: Find the file's exports and consumers**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr5
grep -rn "from ['\"].*extract['\"]\|from ['\"].*sources/extract" examples/scraper-node/src --include='*.ts' | head -10
```

- [ ] **Step 2: Read the file**

```bash
cat examples/scraper-node/src/sources/extract.ts | head -40
```

- [ ] **Step 3: Categorize**

Three possible outcomes:
- **Used by ai-agent or registry** → keep, reference in subsequent tasks if it imports from deleted files.
- **Used only by yandex-business / cheerio-web** → delete in Task 4 alongside those.
- **Used by `fake` or other surviving code** → keep.

- [ ] **Step 4: Record the decision in this file**

(Add a one-line note to this plan in the task's commit message.)

- [ ] **Step 5: No commit needed for the audit** — outcome guides Task 4.

---

## Task 2: Delete `delegate-source.ts` and remove `search_source` from buildTools + prompts

**Files:**
- Delete: `examples/scraper-node/src/sources/ai-agent/tools/delegate-source.ts`
- Delete: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/delegate-source.test.ts`
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/index.ts`
- Modify: `examples/scraper-node/src/sources/ai-agent/prompts.ts`

The `search_source` tool is the LLM's path to the registry. Deleting it severs the LLM's access to legacy adapters before we delete the adapters themselves — this is the safe order.

- [ ] **Step 1: Remove the import + factory call from buildTools**

In `examples/scraper-node/src/sources/ai-agent/tools/index.ts`:

Remove this import:
```typescript
import { makeDelegateSourceTool } from "./delegate-source"
```

Remove this line from the execute-phase tools array:
```typescript
        await makeDelegateSourceTool(query, queue, state),
```

- [ ] **Step 2: Remove `SOURCE_DESCRIPTIONS` and references from prompts.ts**

Open `examples/scraper-node/src/sources/ai-agent/prompts.ts`:

```bash
grep -n "SOURCE_DESCRIPTIONS\|search_source\|delegate" examples/scraper-node/src/sources/ai-agent/prompts.ts
```

Remove:
- The `SOURCE_DESCRIPTIONS` constant declaration (likely lines ~11-20).
- Any `${SOURCE_DESCRIPTIONS}` interpolation in execute-phase or recon-phase prompt builders.
- Any sentence referring to `search_source` as a tool option.
- Any sentence referring to delegating to "another source" or "configured sources."

Read the surrounding sentences carefully — some may need rewriting (e.g. "use search_source for aggregators" → just delete the sentence, since web_search remains).

- [ ] **Step 3: Delete the files**

```bash
rm examples/scraper-node/src/sources/ai-agent/tools/delegate-source.ts
rm examples/scraper-node/src/sources/ai-agent/tools/__tests__/delegate-source.test.ts
```

- [ ] **Step 4: Verify build + tests**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr5/examples/scraper-node
npx tsc --noEmit -p tsconfig.json
npx jest src/sources/ai-agent
```

Expected: tsc clean, ai-agent tests pass.

If any test imports from the deleted files (likely the loop tests reference the tool name as a string), fix them inline:
- Tests asserting `tools.length === 7` → update to `=== 6`.
- Tests asserting tool name `'search_source'` is in the list → remove that assertion.
- Tests asserting prompt content includes "search_source" or "SOURCE_DESCRIPTIONS" → update.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ai-agent): remove search_source tool + SOURCE_DESCRIPTIONS prompt"
```

---

## Task 3: Update `fake` source to not depend on `wrapAsOrgData`

**Files:**
- Modify: `examples/scraper-node/src/sources/fake/index.ts`

Currently `fake` calls `wrapAsOrgData()` (per PR4a Task 6). We're about to delete that helper. Inline the conversion.

- [ ] **Step 1: Read fake/index.ts to find the wrap calls**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr5
grep -n "wrapAsOrgData\|LegacyOrgRecord" examples/scraper-node/src/sources/fake/index.ts
```

- [ ] **Step 2: Inline the conversion**

Replace each `wrapAsOrgData({...})` call with an inline v2 OrgData literal. Pattern:

Before:
```typescript
yield wrapAsOrgData({ name, phone, email, address, source: 'fake', url })
```

After:
```typescript
yield {
    name,
    phones: phone ? [phone] : [],
    emails: email ? [email] : [],
    addresses: address ? [address] : [],
    sources: url ? [{
        url,
        kind: 'aggregator-detail',
        extractedAt: new Date().toISOString(),
        extractionMethod: 'deterministic' as const,
    }] : [],
    status: 'partial' as const,
    confidence: 1.0,
    extractionMethod: 'deterministic' as const,
}
```

(Adjust `kind` if `fake` is generating org-site-shaped records — read the existing usage to decide. Default `'aggregator-detail'` matches `wrapAsOrgData`'s default.)

Remove the import:
```typescript
import { wrapAsOrgData } from '../types'
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/sources/__tests__
```

Expected: tsc clean. Source tests pass.

- [ ] **Step 4: Commit**

```bash
git add examples/scraper-node/src/sources/fake/index.ts
git commit -m "feat(sources): inline OrgData construction in fake source"
```

---

## Task 4: Delete `yandex-business`, `cheerio-web`, `cheerio-extract`

**Files:**
- Delete: `examples/scraper-node/src/sources/yandex-business.ts`
- Delete: `examples/scraper-node/src/sources/cheerio-web.ts`
- Delete: `examples/scraper-node/src/sources/cheerio-extract.ts` (if Task 1 confirmed it's only used by cheerio-web)
- Delete: `examples/scraper-node/src/sources/__tests__/yandex-business.test.ts`
- Modify: `examples/scraper-node/src/sources/index.ts`
- Modify: any other consumers found by grep

- [ ] **Step 1: Find consumers**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr5
grep -rn "YandexBusinessSource\|CheerioWebSource\|cheerio-web\|cheerio-extract\|yandex-business" examples/scraper-node/src --include='*.ts' | grep -v __tests__
```

Expected consumers:
- `src/sources/index.ts` — registers `YandexBusinessSource` and possibly `CheerioWebSource`.
- Possibly tests.

- [ ] **Step 2: Remove registrations from sources/index.ts**

Open `examples/scraper-node/src/sources/index.ts`. Remove:
- `import { YandexBusinessSource }` line.
- `SourceRegistry.register('yandex-business', ...)` call.
- Any cheerio-web import + register call.

The file should now register only `ai-agent` (always) and `fake` (env-gated).

- [ ] **Step 3: Delete the source files**

```bash
rm examples/scraper-node/src/sources/yandex-business.ts
rm examples/scraper-node/src/sources/cheerio-web.ts
rm examples/scraper-node/src/sources/__tests__/yandex-business.test.ts
```

If Task 1 confirmed `cheerio-extract.ts` is only used by `cheerio-web.ts`:
```bash
rm examples/scraper-node/src/sources/cheerio-extract.ts
```

If Task 1 found `extract.ts` is also orphaned, delete it too.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/sources
```

Expected: tsc clean. The only source tests now are `wrap-as-org-data.test.ts` (deleted in Task 5) and any that survive (e.g. `fake`-related).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sources): delete legacy yandex-business + cheerio adapters"
```

---

## Task 5: Delete `wrapAsOrgData` helper + tests

**Files:**
- Modify: `examples/scraper-node/src/sources/types.ts`
- Delete: `examples/scraper-node/src/sources/__tests__/wrap-as-org-data.test.ts`

After Tasks 3+4, no callers remain.

- [ ] **Step 1: Verify no remaining callers**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr5
grep -rn "wrapAsOrgData\|LegacyOrgRecord" examples/scraper-node/src --include='*.ts'
```

Expected: only `sources/types.ts` (declaration) and the test file.

- [ ] **Step 2: Remove from types.ts**

Open `examples/scraper-node/src/sources/types.ts`. Remove:
- The `LegacyOrgRecord` interface.
- The `WrapAsOrgDataOptions` interface.
- The `wrapAsOrgData` function.
- The `OrgData, OrgSourceKind` import (if no longer needed by surviving exports).

- [ ] **Step 3: Delete the test file**

```bash
rm examples/scraper-node/src/sources/__tests__/wrap-as-org-data.test.ts
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/sources
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sources): delete wrapAsOrgData helper (no remaining callers)"
```

---

## Task 6: Lock `ScraperArgs.sources` to `['ai-agent']`

**Files:**
- Modify: `examples/scraper-node/src/scraper-service/args-tree.ts`

The `sources` arg used to let users pick which adapters to run. With only `ai-agent` left, it's effectively a single-choice arg. Lock the choices.

- [ ] **Step 1: Read the current sources field**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr5
grep -n "sources\?:\|@CmdArg.*sources\|SOURCE_OPTIONS" examples/scraper-node/src/scraper-service/args-tree.ts
```

- [ ] **Step 2: Update the choices and default**

Find the `@CmdArg` block for the `sources` field. Update its `choices` and `default` to:

```typescript
        choices: ['ai-agent'],
        default: 'ai-agent',
```

If `SOURCE_OPTIONS` is a constant, update or inline it. The description should also reflect the single-source reality:

```typescript
        description: 'Sources to scrape (only ai-agent available; legacy adapters removed in PR5)',
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/scraper-service
```

- [ ] **Step 4: Commit**

```bash
git add examples/scraper-node/src/scraper-service/args-tree.ts
git commit -m "feat(scraper): lock sources arg to ['ai-agent'] only"
```

---

## Task 7: Full verification

- [ ] **Step 1: Build whole repo**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr5
npm run build 2>&1 | tail -3
```

- [ ] **Step 2: Run scraper-node tests**

```bash
cd examples/scraper-node && bash scripts/test.sh 2>&1 | tail -8
```

Expected: tests pass. Count will be lower than baseline (341) — the deleted tests (yandex-business, delegate-source, wrap-as-org-data) won't run. Expected drop: ~10-15 tests.

- [ ] **Step 3: Run repo-wide tests**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr5
npm test --workspaces --if-present 2>&1 | grep -E "^(Tests:|Test Suites:|FAIL)"
```

Expected: every workspace green.

---

## Task 8: Push branch + open PR

- [ ] **Step 1: Verify branch state**

```bash
git log --oneline main..HEAD
```

Expected: 5 commits (Tasks 2, 3, 4, 5, 6 — Task 1 was audit-only, no commit; Task 7 is verification).

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feature/ai-agent-pr5
```

- [ ] **Step 3: PR title and body for web UI**

Title:
```
feat(ai-agent): PR5 — delete legacy source adapters
```

Body:
```markdown
## Summary
- Per `docs/superpowers/specs/2026-04-29-ai-agent-overhaul-design.md` PR5: delete legacy aggregator adapters and the `search_source` LLM tool that delegated to them. Reality is smaller than the spec assumed — only `yandex-business` and `cheerio-web` existed as legacy adapters; `google` and `avito` were never there.
- Deleted: `yandex-business.ts`, `cheerio-web.ts`, `cheerio-extract.ts`, `delegate-source.ts` (the `search_source` tool), `wrapAsOrgData` helper.
- Removed `SOURCE_DESCRIPTIONS` and `search_source` references from agent prompts.
- Locked `ScraperArgs.sources` to `['ai-agent']`.
- Kept: `SourceRegistry` (type seam for future structured adapters per spec §6), `fake` source (env-gated test fixture).

## Test plan
- [x] Full ai-agent suite green.
- [x] Repo-wide tests green.
- [x] `npm run build` clean.
- [x] No callers of deleted symbols remain (verified via grep).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Self-Review

**Spec coverage**:

- "Delete `examples/scraper-node/src/sources/{google,yandex,avito,cheerio}/`" → reality: only `yandex-business.ts` + `cheerio-web.ts` + `cheerio-extract.ts` existed. Tasks 4 deletes them.
- "Delete `delegate-source.ts`" → Task 2.
- "Delete `search_source` from prompts" → Task 2.
- "Simplify `SourceRegistry`" — interpreted as "preserve the type seam, no callers register legacy" (per spec §6 PR5). Tasks 4 + 6 achieve this without touching `SourceRegistry` itself.
- "Remove `sources: string[]` from `SearchQuery` and from `args-tree.ts:152`" — interpreted as "lock to `['ai-agent']` choices" rather than full removal, since `SearchQuery.sources` flows through too many callers. Task 6 is the safer interpretation. **Spec deviation flagged.**

**Placeholder scan**: searched for "TBD" — Task 1 has "(TBD — audit during execution)" for `extract.ts`. That's a real audit step, not a placeholder. The audit task is bound to produce a categorization. Acceptable.

**Type consistency**: pure deletion task; no new types introduced. Existing types unchanged.

**Open questions for plan-time**:

- **Q1**: Should `SourceRegistry` itself be deleted? Spec §6 says "preserve the type seam." The class is small but still adds surface area. Decision: keep, per spec literal reading. Future PR could simplify if it never gets used.
- **Q2**: Should `SearchQuery.sources` field be deleted from `types.ts`? It cascades through too many callers (config, scraper, ai-agent index). Decision: leave the field as `string[]`, accept that it'll always contain `['ai-agent']`. Future cleanup if needed.
- **Q3**: Does deleting `delegate-source.ts` break the `loop-phases.test.ts` tool-list assertions? Highly likely. Task 2 includes a test-update step inline; if it's complex, it'll surface during execution.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-30-ai-agent-pr5-delete-legacy-sources.md`.
