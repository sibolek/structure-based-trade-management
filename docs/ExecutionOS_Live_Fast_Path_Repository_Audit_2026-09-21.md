# ExecutionOS live fast path — repository audit

**Date:** 2026-09-21  
**Status:** Evidence, proposed sequencing and working-branch progress; no fast-path implementation acceptance  
**Audit base:** `e49f30f2f7dccc1c544002a0806eab40fd46bb54`  
**Working branch:** `codex/live-fast-path-p0-contract`

## 1. Decision

Continue from current `main`, preserving the deferred provider snapshot. Build the live workflow in small reviewed slices under the [draft contract](ExecutionOS_Live_Fast_Path_Contract_v0.1_DRAFT.md). The September 21 NVDA exercise reached a local preview; the conversation records no import or ARM. It demonstrated a workflow delay, not a completed live lifecycle test. Current broker or browser state was not rechecked for this audit.

The chart showed approximately 13:12 MDT; the preview was visible around 13:25. This roughly 13-minute interval includes analysis, contract construction, validation, packaging and a browser handoff failure. It is an observed incident, not a measured model-latency benchmark. The proposed 30-second target remains unproven.

## 2. Repository and outstanding work

Remote refs were checked directly with `git ls-remote` on September 21. GitHub issue/PR state was read through the connected GitHub API; the local `gh` command is unavailable.

| Item | Verified state | Disposition |
|---|---|---|
| Local and remote `main` | `e49f30f`, September 17 merge of PR #21 | Base for the new branch |
| New design branch | Created from `main` in the existing provider worktree | Documentation/design work only in this pass |
| Deferred provider branch | Local and remote `593f4dd`; 20 commits behind `main`, one unique ahead | Preserve; selectively port reviewed functionality later |
| Preservation commit | 80 files, 7,027 insertions, 625 deletions; overlaps already-reconstructed integrity/import work | Do not cherry-pick wholesale |
| Nested `fix/manual-sod-canonicalizer` worktree | `1f5ff2f`; seven commits absent by ancestry, but its complete tracked tree equals squash merge `6d08038` | Code is already merged through PR #20; no pending code integration from this branch |
| Other local branches | `git branch --no-merged main` lists only the provider and canonicalizer branches | Older worktrees are retained; a full dirty-file audit of each is outside this pass |
| Open PRs | None returned by the repository-scoped open-PR query | No pending PR merge identified |
| Open issues | #16 and #17 | Keep open; see below |

PR [#20](https://github.com/sibolek/structure-based-trade-management/pull/20) merged the manual SOD report-alias correction. PR [#21](https://github.com/sibolek/structure-based-trade-management/pull/21) merged terminal History note/timestamp/source display. Both are included in `e49f30f`.

Outstanding issues:

- [#16 — History identification](https://github.com/sibolek/structure-based-trade-management/issues/16): partly addressed. The header shows contract version and PR #21 exposes `terminalOutcome.occurredAt`, but full candidate identity and reliable terminal time across all lifecycle sources still need coverage.
- [#17 — PASS reason](https://github.com/sibolek/structure-based-trade-management/issues/17): remains relevant. `HistoryCard` reads `terminalOutcome`; it does not fall back to the preserved permission PASS reason in `currentPermissionOutcome`.

Untracked items preserved:

- Current worktree: `.tmp/executionos-preview/NVDA-live-preview.json`, `test-results/`, and the registered nested worktree. The NVDA file is an expired test artifact, not a fresh proposal.
- Nested worktree: `node`, `structure-based-trade-management@0.1.0`, and `test-results/`.
- Main worktree: `.executionos-v24-integrity-recovery-HAgpgX/`.

These are not all disposable scratch files. In particular, a registered worktree and integrity-recovery material require a separate retention/cleanup decision. Nothing was deleted, reset, rebased, merged or pushed during this audit. No GitHub issue was closed or edited.

## 3. Correction to provider acceptance history

“No credentialed provider test ever passed” is incorrect. The preserved branch contains `docs/ExecutionOS_V2.4_Gate_V_Order_Correction_Report_2026-09-13.md`, which records a real Responses request using `gpt-5.6-sol`, authorized image input, web search and local validation, ending in `NO_CANDIDATES`.

- Recorded run: `ba33d656-fc87-4857-94c0-91af5d64164c`.
- Recorded claim to completion: `20:46:05.489Z` → `20:46:38.356Z`, approximately 32.9 seconds.
- Candidate count: zero. Live candidate publication and nonempty candidate-state fencing were not exercised.
- The September 14 web-search provenance correction explicitly records no subsequent Gate V run.

This audit read the committed reports using `git show`; it did not independently inspect the runtime receipt, rerun a paid provider call, or certify the later preservation snapshot. Accurate current status: **historical zero-candidate Gate V pass recorded; current integration, candidate-producing live acceptance, latency qualification and release acceptance pending**.

The frozen September 12 design and dated closeouts retain their historical meaning. Living status documents should carry this qualification rather than rewriting those records.

## 4. Verified findings and limits

| Priority | Finding | Evidence / implication |
|---|---|---|
| P0 for fast-path qualification | Audit-base quote freshness accepts future timestamps and an invalid local clock | Reproduced below on `e49f30f`; corrected on this working branch with a shared two-second skew policy and regression coverage |
| P0 | Upload time is not source-data time | `sod-chart-store.mjs` exposes `ingestedAt`, with no authoritative pane/data capture timestamp |
| P0 | Preview is local parsing | `ManualCandidateImport.jsx` calls `prepareManualCandidateImport`; no server preflight or market freshness proof is obtained |
| P0 | Expiration and admission are separate observations | `pretrade-candidate-api.mjs` admits, then reconciles validity. UI labels ACCEPTED as “Imported”; this does not mean currently actionable |
| P0 | Discretionary structure is operator evidence | Current manual trigger/DSS workflow does not machine-prove a higher low or failed breakdown |
| P0 | Live mode has no qualified end-to-end budget | Provider preservation code defaults to 600,000 ms; the feeder's existing SLO starts at a stable local candidate file |
| P1 | No explicit preview discard | Clearing/editing JSON or reloading resets local state; uncertain or completed imports require separate handling |
| P1 | Timeframe contract needs enforcement | DSS identity assembly hardcodes decision `5m` / entry `2m`; initial pilot should enforce that supported pair |
| P1 | Browser handoff and tab-local drafts confuse the operator | The September 21 preview first appeared in a different browser; define one visible run/preview identity |
| P1 | Documentation state trails code | Living headers still describe September 15 as the latest code checkpoint despite September 16–17 runtime changes |

Deterministic, network-free probes against the audit base:

```text
freshness(20000, { nowMs: 10000, maxAgeMs: 1000 })
  -> ageMs: 0, isStale: false
freshness(9500, { nowMs: NaN, maxAgeMs: 1000 })
  -> ageMs: NaN, isStale: false
```

The first defect lasts until local time catches up and the allowed age is exceeded; “indefinitely” would overstate the evidence. The normalized Schwab quote retains `realtime`, but the generic freshness helper alone does not enforce it.

### Working-branch freshness correction

The first implementation slice traces and corrects the shared helper plus the expected-entry, DSS, account-risk and both final ARM freshness boundaries:

- invalid local clocks fail closed;
- future source timestamps are accepted only within a fixed two-second clock-skew allowance and otherwise fail closed;
- bid/ask freshness prefers `quoteTime`, so a newer trade timestamp cannot mask stale bid/ask data;
- production PRETRADE live DSS/risk evaluation requires a valid local quote-receipt timestamp, source/receipt clock consistency and an explicit real-time entitlement flag;
- the same policy is rechecked immediately before both current ARM authorization paths;
- compatibility exports preserve existing `market-data-provider.mjs` imports.

The active live DSS/risk path retains the existing five-second quote threshold; the proposed three-second fast-path pilot limit is not active. No chart or candidate timestamp is rejected by this slice. This remains a cross-cutting prerequisite, not fast-path acceptance. Monotonic/backward-clock detection, chart/pane capture age and server preview/admission remain outstanding.

Existing validity/ARM checks remain relevant safety controls. These findings do not establish that a broker order or ARM bypass occurred.

## 5. Porting and delivery sequence

1. **Contract and evidence:** review the draft, proposed pilot limits and amendments to the full SOD scope. Retain the four Production V1 pillars and the Performance Intelligence requirement.
2. **Freshness foundation:** fix invalid/future clocks; enforce quote time, receipt time and real-time entitlement; define completed-bar continuity and source capture evidence. Prove the defects with focused regression tests.
3. **Preview and admission:** implement readable preview/discard, non-mutating server preflight, exact proposal binding, deadline and race-safe admission/reconciliation. Preserve canonical candidate identity, supersession and separate ARM.
4. **Analysis integration:** port only the required bounded transport, strict parsing, durable run/recovery and diagnostics; add the approved compact intraday profile inside the existing provider/orchestrator. Avoid duplicating functionality already on `main`.
5. **Qualification:** deterministic fault tests, provider qualification and timed shadow trials; then one import-only trial and the separately authorized lifecycle trial.

The compact profile is a proposed extension: the current full SOD provider requires a 19-section report and research. Its requirements cannot simply be removed in the name of latency. This must be resolved explicitly in the draft contract before implementation.

## 6. Documentation and verification

This branch updates living README, guide, status and index records with the current base, preview-discard procedure, live-test limitation and evidence correction. This audit and the draft contract provide the September 21 sequencing update to the September 12 roadmap; its product-scope decisions remain intact.

The guide PDF is generated by `.github/workflows/render-user-guide-pdf.yml` after a guide change reaches `main`. It is not regenerated or published by this documentation branch; the Markdown source is authoritative while the branch is under review.

Fresh checks in the audit/design pass:

- `tests/market-data-provider.test.mjs`, `tests/manual-candidate-import.test.mjs`, `tests/pretrade-history-terminal-details.test.mjs`: **24/24 passed** against the unchanged runtime base.
- The two separate probes above expose missing clock validation despite that existing test pass.
- Six-document review package: 27 local links resolve, code fences/final newlines checked, and `git diff --check` passed. Existing untracked artifacts were preserved.
- A bounded independent Astra/high review found six contract gaps, incorporated in the draft: path-dependent price invalidation, trusted profile/research selection, immutable preview refresh revisions, admission/receipt crash recovery, pane/bar timestamp distinctions and a usable review lifetime separate from generation latency.

Fresh verification after the clock-freshness implementation:

- focused freshness/DSS/risk/ARM set: **94/94 passed**;
- complete DSS suite: **94/94 passed**;
- complete risk-sizing suite: **177/177 passed**;
- PRETRADE ARM service suite: **9/9 passed**;
- complete repository test suite: **1,135/1,135 passed**;
- production build: **passed**;
- `git diff --check`: **passed**.

These checks are not live-provider certification, fast-path implementation acceptance or release evidence. The branch changes are not committed, pushed or merged. Preview/admission implementation, publication and rollout remain subsequent work.
