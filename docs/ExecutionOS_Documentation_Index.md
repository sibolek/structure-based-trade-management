# ExecutionOS Documentation Index

**Status:** Current documentation inventory  
**Date:** 2026-09-01  
**Repository:** `sibolek/structure-based-trade-management`  
**Purpose:** Provide one definitive map of ExecutionOS documentation, authority, implementation acceptance records, release references, research provenance, and historical records.

---

## 1. Authority and precedence

When documents disagree, use this precedence:

1. **Current code and validated broker/runtime behavior** define what the running system actually does.
2. **`USER-GUIDE.md`** is the living operator reference for how to use the current operational system.
3. **Approved design baselines** define locked architectural/design decisions for their scope:
   - `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` for consolidated V2.4 architecture;
   - `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md` for Phase 4 risk sizing.
4. **Phase implementation closeout / acceptance records** establish what a phase actually implemented and what was validated after its design was approved:
   - `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md`;
   - `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md`.
5. **`docs/ExecutionOS_Project_Specification_v1.2_2026-08-26.md`** remains an authoritative dated architecture record for the validated V2.3-era project and Management Governor direction; embedded repository-status fields are historical snapshots.
6. **`docs/ExecutionOS_EOD_Report.md`** is the dedicated operational/technical reference for EOD reconstruction, enrichment, matching, risk/R interpretation, and report limitations.
7. **`research/30-day-management-study/methodology.md`** is authoritative for historical analytics provenance and reconstruction boundaries.
8. **`DOCUMENTATION-STATUS.md`** explains which older records are current versus historical/superseded.
9. Dated work-session and validation reports are evidence snapshots, not evergreen specifications unless explicitly designated as a phase acceptance record.
10. Older specifications, milestone notes, planning reports, PR descriptions, or branch-local README states must not override later authoritative documentation.

Historical approval documents should not be rewritten merely because later implementation succeeded. Their dated statements remain evidence of what had been approved or implemented at that point. Later implementation status belongs in a closeout/acceptance record and this index.

---

## 2. Current authoritative repository documentation

| Document | Repository location | Role | Authority |
|---|---|---|---|
| `USER-GUIDE.md` | Repository root | Living operator guide: setup, session startup, risk sizing, candidate creation, ARMED/LIVE behavior, lifecycle use, persistence, troubleshooting, security, CLI commands, and enriched-EOD workflow | **Current authoritative operator guide** |
| `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` | `docs/` | Consolidated V2.4 pre-trade architecture, source boundary, lifecycle, Phase 3 DSS design, Phase 3→4 handoff, permission/ARM architecture direction | **Authoritative V2.4 design baseline** |
| `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md` | `docs/` | Locked Phase 4 expected-entry, account-risk, instrument conversion, quantity, persistence, freshness, permission-handoff, and ARM-time risk-sizing design | **Authoritative Phase 4 design baseline** |
| `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` | `docs/` | Phase 3 implementation scope, live DSS proof, deterministic gates, UI smoke acceptance, safety boundary, Phase 4 handoff | **Authoritative Phase 3 implementation/acceptance record** |
| `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md` | `docs/` | Phase 4 implementation scope, risk policy, immutable evaluation chain, ARM-time re-evaluation, quantity/provenance freeze, final deterministic gates, deferred work | **Authoritative Phase 4 implementation/acceptance record** |
| `docs/ExecutionOS_EOD_Report.md` | `docs/` | EOD trade reconstruction, History export/enrichment, ownership matching, risk/R formulas, carry-in protection, metrics, output, and validation | **Current authoritative EOD reference** |
| `docs/ExecutionOS_Project_Specification_v1.2_2026-08-26.md` | `docs/` | Architecture, empirical rationale, validated V2.3 design, analytics-preservation closeout, Trade Contract model, Management Governor target architecture, safety model | **Authoritative dated architecture record; embedded repository-status fields are historical** |
| `research/30-day-management-study/methodology.md` | `research/30-day-management-study/` | Technical provenance for duration, stop-management, historical R, MFE/counterfactual work, unresolved sample boundary, anti-curve-fitting policy | **Current authoritative analytics provenance** |
| `DOCUMENTATION-STATUS.md` | Repository root | Distinguishes current authoritative records from historical/superseded records | **Documentation-governance record** |
| `README.md` | Repository root | Operational overview and project entry point | **Current overview; defer to more specific sources above** |

---

## 3. Current implementation and release baseline

### Frozen downstream execution release

The immutable validated execution-release reference remains:

```text
v2.3.0
```

Annotated tag target:

```text
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

The V2.3 tag remains the frozen downstream execution reference. V2.4 is an upstream pre-trade permission extension and must not silently change trusted V2.3 broker-fill ownership or execution-management semantics.

### Current `main`

Current `main` head before Phase 4 merge:

```text
ee5b84bf525f65e40304764a53d680e87286e062
```

Commit title:

```text
Document V2.4 Phase 3 merge status (#13)
```

This is a post-Phase-3 documentation merge. Phase 3 runtime implementation was previously merged through PR #12; PR #13 added post-merge documentation cleanup only.

Current `main` contains:

- frozen/trusted V2.3 downstream execution behavior;
- read-only EOD reporting and preserved analytics tooling;
- V2.4 Phase 1 Candidate Ingestion;
- V2.4 Phase 2 MarketDataProvider;
- approved consolidated V2.4 design baseline v0.4;
- V2.4 Phase 3 DSS / Micro-Volatility Buffer implementation and acceptance documentation.

### Current Phase 4 development branch

The actual Phase 4 implementation branch is:

```text
v24-risk-sizing-phase4
```

It was created from the exact current post-Phase-3 mainline:

```text
ee5b84bf525f65e40304764a53d680e87286e062
```

As of final Phase 4 closeout review, the branch was ahead of `main` with **behind = 0**.

Phase 4 is implementation-complete, accepted, and merge-ready, but it must not be described as present on `main` until its pull request is actually merged.

V3 has not started.

---

## 4. V2.4 phase status

| Phase | Status as of 2026-09-01 | Primary record |
|---|---|---|
| Phase 1 — Candidate Ingestion | **COMPLETE / MERGED** | V2.4 Design Baseline v0.4 + current code |
| Phase 2 — MarketDataProvider | **COMPLETE / MERGED / LIVE-ACCEPTED** | V2.4 Design Baseline v0.4 + current code |
| Phase 3 — DSS / Micro-Volatility Buffer | **IMPLEMENTATION COMPLETE / ACCEPTED / MERGED** | `ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` |
| Phase 4 — Effective-Stop Risk Sizing | **IMPLEMENTATION COMPLETE / ACCEPTED / MERGE-READY; NOT YET MERGED** | Phase 4 approved design baseline + `ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md` |
| Broader context / decision gate | **DEFERRED / LATER V2.4 WORK** | V2.4 design baseline + Phase 4 closeout deferred-work section |
| ARM → existing V2.3 Execution Board handoff | **DEFERRED / LATER V2.4 WORK** | Phase 4 closeout authority boundary |
| Broker-write / order-placement capability | **NOT AUTHORIZED / NOT IMPLEMENTED** | Safety boundaries in V2.3/V2.4 records |

The Phase 3 and Phase 4 closeout records supersede older implementation-status statements inside dated approval/planning artifacts. They do not rewrite or invalidate the approved design history itself.

---

## 5. Phase 3 DSS implementation acceptance

The authoritative Phase 3 acceptance record is:

```text
docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md
```

Accepted Phase 3 scope includes:

- deterministic RTH-only Wilder ATR(14) on 2-minute bars;
- reconstruction from 20 completed RTH sessions plus current RTH session where applicable;
- locked `ATR × 0.30` micro-volatility buffer;
- directionally protective effective-stop rounding;
- immutable DSS evaluation/provenance and exact `dssEvaluationId`;
- persistence, reuse, completed-2m-bar staleness, retry, and freeze semantics;
- live Schwab input assembly and final quote refresh;
- fail-closed market-data/instrument-metadata validation;
- verified pre-variable-MPI Reg NMS Rule 612 equity price-increment fallback with a hard 2026-11-02 cutoff;
- production permission-service integration from persisted candidate identity through exact Phase 4 handoff;
- live read-only NVDA Phase 3 calculation acceptance;
- candidate import → persistence → PRE-TRADE Waiting Candidate Board visual smoke acceptance.

Final Phase 3 acceptance gate:

```text
v24:dss-test       91/91 PASS
analytics:test     123/123 PASS
schwab:state-test  10/10 PASS
production build   PASS
```

A live read-only NVDA diagnostic acceptance used synthetic structural input and produced a valid effective stop from real Schwab market data. The synthetic price was a capability probe only, not a trade recommendation or authorization.

---

## 6. Phase 4 Effective-Stop Risk Sizing implementation acceptance

The authoritative Phase 4 acceptance record is:

```text
docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md
```

The approved Phase 4 design authority is:

```text
docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md
```

Accepted Phase 4 scope includes:

- conservative expected-entry resolution from required bid/ask sides;
- five-second quote freshness and no last/mark fallback;
- exact Schwab execution-account resolution;
- authoritative current `liquidationValue` account equity;
- 15-second account-risk snapshot freshness;
- exact 0.5% planned stop-risk budget;
- downward cent rounding of maximum dollar risk;
- equity and futures risk conversion;
- protective futures risk-tick ceiling;
- downward-only quantity rounding;
- no notional cap at account equity inside Phase 4;
- immutable append-only `RiskEvaluation` records and exact `riskEvaluationId` provenance;
- deterministic input fingerprints;
- status semantics `VALID`, `NO_AFFORDABLE_SIZE`, `BLOCKED`, `ERROR`;
- `NO_AFFORDABLE_SIZE → PASS — STOP_RISK_CONFLICT` permission mapping;
- mandatory fresh Phase 4 evaluation on every ARM attempt;
- selected quantity validation at or below the exact risk maximum;
- exact `{candidateVersion, dssEvaluationId, riskEvaluationId, selectedQuantity}` ARM provenance;
- quote/account freshness rechecks at final authorization;
- atomic freeze into `ARMED` with persistence rollback on failure;
- no broker-order authority.

The governing invariant remains:

> Phase 3 determines the correct stop. Phase 4 determines whether and how large the trade can be against that stop. Phase 4 never changes the stop.

Final Phase 4 acceptance gate:

```text
v24:risk-sizing-test  170/170 PASS
v24:dss-test           91/91 PASS
analytics:test        293/293 PASS
schwab:state-test      10/10 PASS
production build      PASS
```

The full repository suite includes all Phase 4 tests plus existing analytics, EOD, market-data, Phase 3, and other deterministic regression coverage. The frozen V2.3 deterministic state suite remained 10/10 green.

`ARMED` in Phase 4 is an internal authorization/provenance freeze. It is not evidence of broker order placement or fill ownership.

---

## 7. PRE-TRADE versus existing V2.3 Execution Board

The V2.4 UI intentionally separates:

```text
PRE-TRADE
```

from:

```text
EXECUTION
```

The Phase 3 smoke test proved:

```text
candidate JSON
    ↓
POST /api/candidates/import
    ↓
validation / normalization
    ↓
persistence
    ↓
WAITING
    ↓
GET /api/candidates
    ↓
UI polling
    ↓
PRE-TRADE Waiting Candidate Board
```

Phase 4 now implements the internal risk-sizing and ARM-provenance path, but it does **not** yet establish the final transfer/binding of an `ARMED` V2.4 candidate into the existing V2.3 Execution Board.

The remaining architectural path is conceptually:

```text
WAITING
   ↓
trigger / permission evaluation
   ↓
Phase 3 DSS
   ↓
Phase 4 risk sizing
   ↓
broader context / decision gate
   ↓
READY / CAUTION / PASS
   ↓
ARM attempt
   ↓
fresh Phase 4 evaluation
   ↓
selected quantity validation
   ↓
internal ARMED provenance freeze
   ↓
future explicit V2.4 → V2.3 Execution Board handoff
```

An internal `ARMED` candidate is not automatically an owned/active broker trade.

---

## 8. Phase 3 → Phase 4 authority boundary

Phase 3 hands Phase 4 an immutable, fresh, non-stale `VALID` DSS evaluation containing:

- resolved structural invalidation;
- `effectiveStop`;
- exact DSS provenance;
- exact `dssEvaluationId`.

Phase 4 independently obtains fresh:

- `currentExpectedEntry`;
- exact-account net-liquidation equity;
- required instrument sizing metadata.

Phase 4 sizes exclusively from `effectiveStop`.

Phase 4 may reduce quantity but may never change structural invalidation or `effectiveStop`.

If minimum valid size cannot fit within the configured risk budget, the outcome is:

```text
NO_AFFORDABLE_SIZE
```

mapped by the permission layer to:

```text
PASS — STOP_RISK_CONFLICT
```

No Phase 3 or Phase 4 calculation grants broker-write authority by itself.

---

## 9. Phase 4 ARM authority boundary

Every ARM attempt requires a new Phase 4 evaluation from fresh inputs.

The final internal authorization freezes:

```text
authorizedDssEvaluationId
authorizedRiskEvaluationId
arm: {
  authorizedAt,
  candidateVersion,
  dssEvaluationId,
  riskEvaluationId,
  selectedQuantity
}
lifecycleState = ARMED
```

Final authorization rechecks:

- lifecycle state;
- candidate/source identity;
- exact current DSS identity;
- DSS staleness;
- immutable risk evaluation validity;
- selected quantity;
- five-second quote freshness;
- 15-second account freshness.

No Phase 4 ARM component can:

- place an order;
- modify/cancel an order;
- replace a stop;
- flatten a position;
- claim a broker fill;
- change trusted V2.3 execution ownership.

---

## 10. End-of-Day reporting documentation boundary

The EOD workflow uses two sources:

1. **Schwab history** — broker-authoritative fills, flat-to-flat reconstruction, gross realized P/L, and broker trade statistics.
2. **ExecutionOS browser History export** — Trade Contract, setup, planned risk, R, ownership, and process enrichment.

For an enriched report, the operator must keep Vite running, ensure completed trades are in ExecutionOS History, and download:

```text
http://localhost:5173/eod-export.html
```

before running:

```bash
npm run schwab:eod -- --date=YYYY-MM-DD
```

The full operator sequence is authoritative in `USER-GUIDE.md`. The technical/reporting semantics are authoritative in `docs/ExecutionOS_EOD_Report.md`.

---

## 11. Dated validation and acceptance records

| Document / record | Date | Status | Purpose |
|---|---|---|---|
| `ExecutionOS_Architecture_Validation_and_Monday_Plan_2026-08-23.pdf` | 2026-08-23 | **Historical snapshot** | Pre-live architecture, Sunday validation state, Monday live-test plan, latency criteria |
| `ExecutionOS_Work_Session_Report_2026-08-27` | 2026-08-27 | **Dated V2.3 acceptance record** | Aug. 27 V2.3 edge testing, reversal defect/fix, regressions, deferred items |
| PR #7 description / validation record | 2026-08-27 | **Dated EOD acceptance record** | Analytics, trade-state, build, real EOD reconciliation, HTML validation |
| `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` | 2026-08-31 | **Authoritative Phase 3 acceptance record** | DSS scope, live market-data proof, deterministic gate, UI smoke acceptance, safety boundary, Phase 4 handoff |
| PR #12 | 2026-08-31 | **Phase 3 implementation merge record** | Merged accepted Phase 3 runtime implementation |
| PR #13 | 2026-08-31 | **Phase 3 post-merge documentation record** | Documentation cleanup only; current pre-Phase-4 main head |
| `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md` | 2026-08-31 / 2026-09-01 work session | **Authoritative Phase 4 design approval record** | Locked Phase 4 risk-sizing design decisions |
| `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md` | 2026-09-01 | **Authoritative Phase 4 acceptance record** | Implemented risk sizing, immutable provenance, ARM-time refresh/freeze, deterministic gates, safety boundary, deferred work |

A phase closeout record may supersede an older implementation-status statement while leaving the earlier approved design document intact as historical approval evidence.

---

## 12. Historical / superseded project documents

| Document | Status | Use |
|---|---|---|
| `V2-MILESTONE-1.md` | **Historical** | Original V2 stateful-execution prototype design record |
| ExecutionOS Project Specification original 2026-08-26 edition | **Superseded** | Earlier project snapshot retained for provenance |
| ExecutionOS Project Specification v1.1 | **Superseded by v1.2** | Post-V2.3-validation decision history |
| ExecutionOS Project Specification v1.2 repository status | **Dated snapshot** | Architecture remains important; embedded branch/PR/tag status reflects Aug. 26 context |
| ExecutionOS Architecture, Validation & Monday Plan — 2026-08-23 | **Superseded as current guidance** | Retained as pre-live evidence |
| Approved design documents' implementation-status prose | **Historical at approval time** | Do not rewrite merely because later closeout records exist |
| Earlier branch-local README/User Guide states | **Implementation-era snapshots** | Do not use instead of current documentation |

Do not delete historical records simply because they are old. Their value is traceability.

---

## 13. Pull requests as project records

### PR #1 — V2.3 execution-system release merge

- Status: **merged**
- Records the broker-aware V2.3 execution system.

### PR #2 — analytics preservation

- Status: **merged**
- Preserves analytics modules, methodology, historical reconstruction evidence, and unresolved provenance boundaries.

### PR #3 — useful pre-V2 documentation preservation

- Status: **merged**
- Preserved execution-discipline Markdown without importing obsolete UI wiring.

### PR #4 — history-only reconciliation

- Status: **merged**
- Reconciled `main` history into the V2.3 lineage without changing the V2.3 tree.

### PR #5 — V2.3 release-documentation closeout

- Status: **merged**
- Closed pre-release living-document gaps.

### PR #6 — post-merge V2.3 documentation finalization

- Status: **merged**
- Finalized documentation after V2.3 reached `main`.

### PR #7 — read-only End-of-Day reporting

- Status: **merged**
- Historical merge commit: `bedd70979a3b18844386bcf8f927fd8a1f62307f`
- Added Schwab flat-to-flat EOD reconstruction, browser-History enrichment, planned risk/R reporting, context protection, terminal/HTML output, and deterministic tests.

### PR #12 — ExecutionOS V2.4 Phase 3 DSS implementation

- Branch: `v24-dss-phase3`
- Base: `main`
- Status: **merged**
- Merge commit: `ff437508f228b8a1eb0bb2e1c7bb9ea4ca0de97e`
- Merged the accepted Phase 3 DSS / Micro-Volatility Buffer implementation, live Schwab capability path, lifecycle/persistence integration, and exact Phase 4 handoff.

### PR #13 — V2.4 Phase 3 merge-status documentation

- Status: **merged**
- Current `main` commit: `ee5b84bf525f65e40304764a53d680e87286e062`
- Documentation cleanup only; no runtime or test changes.

### Phase 4 pull request

- Branch: `v24-risk-sizing-phase4`
- Base: `main`
- Status at this document update: **not yet created/merged**
- Phase 4 implementation and closeout are accepted and ready for PR review.

Use current repository history rather than old PR descriptions to identify the present mainline head.

---

## 14. Research evidence and reproducibility artifacts

The `research/30-day-management-study/` folder contains prose methodology plus deterministic analysis, diagnostics, tests, and benchmark artifacts.

Important classes include:

- `methodology.md` — authoritative research provenance;
- `expected-results.json` — preserved numerical fingerprint;
- study runners / reconstruction scripts;
- diagnostics for duration, initial-risk/R basis, stop provenance, minute alignment, fast-winner sampling, and market-data validation;
- local raw/normalized/enriched broker data and Schwab minute-history caches — intentionally Git-ignored and not documentation.

Preserve the distinction between historical evidence, reconstruction methodology, reproducible code, local sensitive/raw data, current production semantics, and current EOD reporting output.

---

## 15. Maintenance rules

Update this index when any of the following occurs:

- a new authoritative specification, design baseline, phase closeout, or User Guide version is created;
- a V2.4 phase changes implementation or merge status;
- the EOD reporting workflow materially changes;
- an important validation/work-session record is produced;
- a major pull request is merged or materially repurposed;
- a release tag is created/replaced;
- a V3 branch is explicitly authorized and created;
- a chat decision becomes important enough to require permanent documentation.

### Do not

- rewrite a dated approved-design artifact merely to erase its original approval-time implementation status;
- treat a dated planning report as current operating policy;
- claim an unmerged branch is already present on `main`;
- overwrite historical records to make them agree with newer evidence;
- fabricate ExecutionOS ownership/planned risk/R for broker-only trades;
- commit credentials, tokens, private account identifiers, raw private broker history, or private ExecutionOS EOD exports;
- let an old PR description or branch README silently supersede current authoritative documentation.

---

## 16. Quick reference — where to look first

| Question | First source |
|---|---|
| How do I operate ExecutionOS today? | `USER-GUIDE.md` |
| What is the authoritative overall V2.4 architecture/design? | `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` |
| What is the authoritative Phase 4 risk-sizing design? | `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md` |
| What exactly did Phase 3 implement and validate? | `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` |
| What exactly did Phase 4 implement and validate? | `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md` |
| Is Phase 3 merged? | **Yes — implementation PR #12; post-merge docs through #13** |
| Is Phase 4 merged? | **No — accepted/merge-ready on `v24-risk-sizing-phase4` pending PR/merge** |
| What is the accepted Phase 3→4 handoff? | Phase 3 closeout + Phase 4 approved design/closeout |
| Can Phase 4 change the stop to make a trade affordable? | **No. Reduce quantity or return no affordable size.** |
| Does Phase 4 cap notional exposure at account equity? | **No. It caps planned entry→effective-stop price risk to 0.5%; buying power/margin is separate.** |
| Does every ARM attempt get a fresh risk evaluation? | **Yes. A new `riskEvaluationId` is required for every ARM attempt.** |
| Does internal `ARMED` place an order? | **No. Broker writes remain unauthorized.** |
| Has the final V2.4 ARMED candidate → existing V2.3 Execution Board handoff been implemented? | **No; deferred.** |
| How do I generate an accurate enriched EOD report? | `USER-GUIDE.md` after-session/EOD instructions |
| What exactly does the EOD reporter compute and what are its limitations? | `docs/ExecutionOS_EOD_Report.md` |
| What is the longer-term architecture / Governor direction? | Project Specification v1.2, interpreted as a dated architecture record |
| What is current `main` before Phase 4 merge? | `ee5b84bf525f65e40304764a53d680e87286e062` |

---

## 17. Current project-documentation snapshot

As of **2026-09-01**:

- V2.3 execution behavior remains release-validated and frozen under annotated tag `v2.3.0` at `baabb75f36050599f20e6c89e8db2f1f7d7769a1`.
- Read-only EOD reporting remains part of the operational mainline documentation/analytics workflow.
- V2.4 Phase 1 Candidate Ingestion is complete/merged.
- V2.4 Phase 2 MarketDataProvider is complete/merged/live-accepted.
- `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` remains the authoritative overall V2.4 design baseline.
- V2.4 Phase 3 DSS is implementation-complete, accepted, and merged.
- Current pre-Phase-4 `main` head is `ee5b84bf525f65e40304764a53d680e87286e062`.
- `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md` is the authoritative Phase 4 design.
- `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md` is the authoritative Phase 4 implementation/acceptance record.
- V2.4 Phase 4 is implementation-complete, accepted, and merge-ready on `v24-risk-sizing-phase4`, but not yet merged.
- Final Phase 4 gate: 170/170 focused risk-sizing tests, 91/91 Phase 3 DSS regressions, 293/293 full repository tests, 10/10 frozen V2.3 trade-state tests, production build PASS.
- Phase 4 preserves the effective stop and may only reduce quantity or reject affordability.
- Every ARM attempt requires a new Phase 4 risk evaluation; final internal authorization freezes exact DSS/risk/quantity provenance.
- Phase 4 internal `ARMED` state does not place broker orders and does not claim fills.
- The explicit V2.4 internal `ARMED` → existing V2.3 Execution Board handoff remains future work.
- V3 has not started.

---

**Maintenance principle:** If a future contributor cannot answer “what is authoritative, what is historical, what has actually been implemented/accepted, what has merged, what data is required, what authority exists, and what remains intentionally gated?” from this file and the linked records, update the documentation before adding more architecture.
