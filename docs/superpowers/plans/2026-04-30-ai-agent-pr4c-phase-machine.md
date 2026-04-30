# AI-Agent PR4c — Phase Machine + Bootstrap Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (this plan was inline-executed). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `execute` phase with `harvest → deepen+review`. Each phase exposes a focused tool subset. The agent loop runs harvest until budget allocation hits, then transitions to `deepen+review`. `deepen_org` and `freeze_org` push verified records to `AsyncQueue<OrgData>` immediately. `index.ts` constructs the `WorkQueueContext` (classify + extract) and threads it through.

**Architecture:** New `AgentPhase` adds `'harvest' | 'deepen+review'` (replaces `'execute'`). `loop.ts` gets a phase handler per phase plus transition functions. `tools/index.ts` returns a different toolset per phase (harvest: web_search + harvest_serp + discover_org_candidates; deepen+review: list/pick/deepen/freeze + revise_plan). Hardcoded `MAX_FETCHES_PER_ORG = 10` overrides PR4b's `maxToolCallsPerOrg`. `harvest → deepen+review` transition triggers when `toolCallsUsed >= harvestBudget` (50% of total). `deepen_org` and `freeze_org` get an `emitQueue` constructor param to push saturated/verified `OrgData` records.

**Tech Stack:** TypeScript, Node 20, OpenAI SDK 4.77 (existing), Jest 30.

**Spec reference:** §3.10 (parent agent phase model). Decisions locked in conversation: harvest_serp is harvest-phase-only; harvest pushes "max as possible" exploration; budget split = harvest then deepen with 10 fetches per org; emit on each successful deepen_org (saturated transition) AND each freeze_org('verified').

---

## Scope

**IN:**
- `AgentPhase` adds `'harvest'` and `'deepen+review'`. `'execute'` removed.
- `loop.ts`: phase handlers + transitions for the new phases. `revise_plan` routes back to `plan`.
- `tools/index.ts`: phase-aware toolset; `MAX_FETCHES_PER_ORG = 10` constant binds to `deepen_org`.
- `prompts.ts`: new `buildHarvestInstructions` and `buildDeepenReviewInstructions`. Remove `buildExecuteInstructions`.
- `deepen_org` + `freeze_org` accept `emitQueue: AsyncQueue<OrgData>`; emit on saturated/verified transitions. `OrgRecord → OrgData` converter inline in those tools.
- `index.ts` (source bootstrap): constructs `WorkQueueContext` with `classifyPage` (PR1) + `extract_contacts` runner. Passes `workQueue + workQueueContext + maxToolCallsPerOrg` to `runAgentLoop`.
- Existing loop tests updated for new state machine. Loop-phases test updated to construct WorkQueueContext.

**NOT IN:**
- `fill_gap` / `review_org` (PR4d).
- New args (max-fetches-per-org stays hardcoded in PR4c).
- Run-state collector for JSON exporter envelope (still zero-valued from PR4a).

---

## Tasks (high-level — executed inline)

1. **`AgentPhase` + types**: add `'harvest'` and `'deepen+review'`; remove `'execute'`.
2. **`OrgRecord → OrgData` converter** in `work-queue/`: pure function, no side effects.
3. **`deepen_org` emits**: on `partial → saturated` transition, push the converted OrgData. Constructor takes `emitQueue`.
4. **`freeze_org` emits**: on `verified` transition, push. Constructor takes `emitQueue`.
5. **`tools/index.ts`** phase-aware toolset:
   - `harvest`: `web_search`, `discover_org_candidates`, `harvest_serp`, `revise_plan` (only revise after 2+ harvest turns).
   - `deepen+review`: `list_orgs`, `pick_next_partial`, `deepen_org`, `freeze_org`, `revise_plan`.
   - Hardcoded `MAX_FETCHES_PER_ORG = 10` for `makeDeepenOrgTool` budget arg.
6. **`prompts.ts`**: new `buildHarvestInstructions(query, cfg)` + `buildDeepenReviewInstructions(query, cfg)`. Both emphasize "maximize exploration".
7. **`loop.ts`**: refactor state machine. `recon → plan → harvest → deepen+review` with `revise_plan → plan` from either new phase. Harvest budget split: 50% of `cfg.maxToolCalls`.
8. **`index.ts`** (source): construct `WorkQueueContext`. Build extract_contacts runner that wraps the tool's handler. Pass to `runAgentLoop`.
9. **Update existing loop tests** for the new phase names + WorkQueueContext.
10. **Verification**: build + scraper-node tests + repo-wide.
11. **Push + PR**.

---

## Decisions Locked

- **`MAX_FETCHES_PER_ORG = 10`** hardcoded in `tools/index.ts`. PR4b's `maxToolCallsPerOrg` arg is honored if explicitly set lower than 10 (for safety); otherwise 10 wins. Documented inline.
- **Harvest budget = 50% of `cfg.maxToolCalls`**. Hardcoded ratio. Phase transitions on `toolCallsUsed >= harvestBudget`.
- **No `end_harvest` tool** — auto-transition on budget. Simpler; matches Q4 ("max as possible").
- **`deepen+review` exit** = no partial records remaining OR `maxToolCalls` hit OR `totalTimeoutMs` hit. Last-resort: `freeze_org` all remaining partials.
- **Emit on each successful saturate**: `deepen_org` pushes the converted `OrgData` to `AsyncQueue<OrgData>`. Includes the record's accumulated phones/emails/addresses/sources at the moment of saturation. Uses the deduping `addOrg`-equivalent path through the existing emit module.

  Actually — looking at this more carefully: `AsyncQueue<OrgData>` is the user-facing yield queue. `OrgScraper.addOrg` (in scraper-service/scraper.ts) is the dedup+merge layer that wraps it. Using the existing `emit.ts` pipeline is overkill (it's designed for the LLM's report_results legacy shape). **Decision: deepen_org calls `queue.push(orgData)` directly**, skipping the emit pipeline. The AsyncQueue is consumed by the source's outer loop which feeds `OrgScraper.addOrg` — dedup happens there.

- **`OrgRecord → OrgData` converter** is in `work-queue/types.ts` as a small exported function. Drops `id`, `frontier`, `gaps`, `perOrgToolCallsUsed`, `extractionMethod` carries through.

- **Error-handling for emit failures**: queue.push is sync and non-throwing for AsyncQueue. No special handling needed.

---

## Test impact summary

- `loop-phases.test.ts`, `loop-invariants.test.ts`, `loop-recon-bounds.test.ts`, `loop-revise-plan.test.ts`: all need updates for the new phase names and WorkQueueContext construction.
- New tests for `OrgRecord → OrgData` converter (small, ~3 tests).
- `deepen_org` and `freeze_org` tests: append cases verifying emission to AsyncQueue.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-30-ai-agent-pr4c-phase-machine.md`. Executing inline.
