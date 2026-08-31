# ExecutionOS Documentation Index

**Status:** Current documentation inventory  
**Date:** 2026-08-31  
**Repository:** `sibolek/structure-based-trade-management`  
**Purpose:** Provide one definitive map of ExecutionOS documentation, authority, implementation acceptance records, release references, research provenance, and historical records.

---

## 1. Authority and precedence

When documents disagree, use this precedence:

1. **Current code and validated broker/runtime behavior** define what the running system actually does.
2. **`USER-GUIDE.md`** is the living operator reference for how to use the current operational system.
3. **`docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md`** is the authoritative top-level V2.4 design baseline for V2.4 architecture and locked design decisions.
4. **Phase implementation closeout / acceptance records** establish what a phase actually implemented and what was validated after the design baseline was approved. For Phase 3, use `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md`.
5. **`docs/ExecutionOS_Project_Specification_v1.2_2026-08-26.md`** remains an authoritative dated architecture record for the validated V2.3-era project and Management Governor direction; embedded repository-status fields are historical snapshots.
6. **`docs/ExecutionOS_EOD_Report.md`** is the dedicated operational/technical reference for EOD reconstruction, enrichment, matching, risk/R interpretation, and report limitations.
7. **`research/30-day-management-study/methodology.md`** is authoritative for historical analytics provenance and reconstruction boundaries.
8. **`DOCUMENTATION-STATUS.md`** explains which older records are current versus historical/superseded.
9. Dated work-session and validation reports are evidence snapshots, not evergreen specifications unless explicitly designated as a phase acceptance record.
10. Older specifications, milestone notes, and planning reports must not override later authoritative documentation.

Historical approval documents should not be rewritten merely because later implementation succeeded. Their dated statements remain evidence of what had been approved or implemented at that point. Later implementation status belongs in a closeout/acceptance record and this index.

---

## 2. Current authoritative repository documentation

| Document | Repository location | Role | Authority |
|---|---|---|---|
| `USER-GUIDE.md` | Repository root | Living operator guide: setup, session startup, risk sizing, candidate creation, ARMED/LIVE behavior, lifecycle use, persistence, troubleshooting, security, CLI commands, and enriched-EOD workflow | **Current authoritative operator guide** |
| `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` | `docs/` | Consolidated V2.4 pre-trade architecture, source boundary, lifecycle, Phase 3 DSS design, Phase 3→4 handoff, later permission/ARM architecture | **Authoritative V2.4 design baseline** |
| `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` | `docs/` | Phase 3 implementation scope, live DSS proof, deterministic acceptance gates, candidate-to-PRE-TRADE UI smoke acceptance, safety boundary, Phase 4 handoff | **Authoritative Phase 3 implementation/acceptance record** |
| `docs/ExecutionOS_EOD_Report.md` | `docs/` | EOD trade reconstruction, History export/enrichment, ownership matching, risk/R formulas, carry-in protection, metrics, output, and validation | **Current authoritative EOD reference** |
| `docs/ExecutionOS_Project_Specification_v1.2_2026-08-26.md` | `docs/` | Architecture, empirical rationale, validated V2.3 design, analytics-preservation closeout, Trade Contract model, Management Governor target architecture, safety model | **Authoritative dated architecture record; embedded repository-status fields are historical** |
| `research/30-day-management-study/methodology.md` | `research/30-day-management-study/` | Technical provenance for duration, stop-management, historical R, MFE/counterfactual work, unresolved sample boundary, anti-curve-fitting policy | **Current authoritative analytics provenance** |
| `DOCUMENTATION-STATUS.md` | Repository root | Distinguishes current authoritative records from historical/superseded records | **Documentation-governance record** |
| `README.md` | Repository root | Operational overview and project entry point | **Current overview; defer to the more specific sources above** |

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

Phase 3 was merged into `main` on 2026-08-31 through **PR #12**.

Current post-Phase-3 merge commit:

```text
ff437508f228b8a1eb0bb2e1c7bb9ea4ca0de97e
```

Merge title:

```text
Merge ExecutionOS V2.4 Phase 3 DSS implementation (#12)
```

That mainline contains:

- frozen/trusted V2.3 downstream execution behavior;
- read-only EOD reporting and preserved analytics tooling;
- V2.4 Phase 1 Candidate Ingestion;
- V2.4 Phase 2 MarketDataProvider;
- approved consolidated V2.4 design baseline v0.4;
- V2.4 Phase 3 DSS / Micro-Volatility Buffer implementation and acceptance documentation.

### Current Phase 4 development branch

The Phase 4 branch was created from the exact post-Phase-3 mainline merge commit:

```text
v24-phase4-risk-sizing
```

Initial branch point:

```text
ff437508f228b8a1eb0bb2e1c7bb9ea4ca0de97e
```

Phase 4 implementation has **not** started; the next step is formal Phase 4 Effective-Stop Risk Sizing design.

V3 has **not** started.

---

## 4. V2.4 phase status

| Phase | Status as of 2026-08-31 | Primary record |
|---|---|---|
| Phase 1 — Candidate Ingestion | **COMPLETE / MERGED** | V2.4 Design Baseline v0.4 + current code |
| Phase 2 — MarketDataProvider | **COMPLETE / MERGED / LIVE-ACCEPTED** | V2.4 Design Baseline v0.4 + current code |
| Phase 3 — DSS / Micro-Volatility Buffer | **IMPLEMENTATION COMPLETE / ACCEPTED / MERGED via PR #12** | `ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` |
| Phase 4 — Effective-Stop Risk Sizing | **NOT YET IMPLEMENTED; design session next** | V2.4 Design Baseline v0.4 Phase 3→4 handoff |
| Later context / decision gate / ARM work | **NOT YET IMPLEMENTED** | V2.4 Design Baseline v0.4 |

The Phase 3 closeout record supersedes the older implementation-status statement inside the dated v0.4 approval artifact. It does **not** supersede the v0.4 design itself.

---

## 5. Phase 3 DSS implementation acceptance

The authoritative acceptance record is:

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

Final local acceptance gate before merge:

```text
v24:dss-test       91/91 PASS
analytics:test     123/123 PASS
schwab:state-test  10/10 PASS
production build   PASS
```

The commits after that functional gate were documentation-only.

Live read-only NVDA diagnostic acceptance used a synthetic LONG structural invalidation of `216.25` and produced:

```text
ATR(14,2m) = 0.250291
raw buffer = 0.075087
effective stop = 216.17
DSS status = VALID
```

The synthetic price was a capability probe only, not a trade recommendation or authorization.

---

## 6. PRE-TRADE versus existing V2.3 Execution Board

The V2.4 UI intentionally separates:

```text
PRE-TRADE
```

from:

```text
EXECUTION
```

The 2026-08-31 smoke test proved:

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

A WAITING candidate is not ARMED and must not appear as an owned/active trade in the downstream V2.3 Execution Board.

The later path still requires:

```text
WAITING
   ↓
trigger / permission evaluation
   ↓
Phase 3 DSS
   ↓
Phase 4 risk sizing
   ↓
context / decision gate
   ↓
READY
   ↓
ARM
   ↓
existing V2.3 Execution Board
```

The final ARM-to-V2.3 handoff remains future V2.4 work.

---

## 7. Phase 3 → Phase 4 authority boundary

Phase 3 hands Phase 4 an immutable, fresh, non-stale `VALID` DSS evaluation containing:

- resolved structural invalidation;
- `effectiveStop`;
- exact DSS provenance;
- exact `dssEvaluationId`.

Phase 4 independently obtains fresh expected-entry and account-risk inputs and sizes exclusively from `effectiveStop`.

Phase 4 may reduce quantity but may never change structural invalidation or `effectiveStop`.

If minimum valid size cannot fit within the configured risk budget, the expected Phase 4 outcome is:

```text
NO_AFFORDABLE_SIZE
```

later mapped by the permission layer to:

```text
PASS — STOP_RISK_CONFLICT
```

No Phase 3 or Phase 4 sizing result grants broker-write authority by itself.

---

## 8. End-of-Day reporting documentation boundary

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

## 9. Dated validation and acceptance records

| Document / record | Date | Status | Purpose |
|---|---|---|---|
| `ExecutionOS_Architecture_Validation_and_Monday_Plan_2026-08-23.pdf` | 2026-08-23 | **Historical snapshot** | Pre-live architecture, Sunday validation state, Monday live-test plan, latency criteria |
| `ExecutionOS_Work_Session_Report_2026-08-27` | 2026-08-27 | **Dated V2.3 acceptance record** | Aug. 27 V2.3 edge testing, reversal defect/fix, regressions, deferred items |
| PR #7 description / validation record | 2026-08-27 | **Dated EOD acceptance record** | Analytics, trade-state, build, real EOD reconciliation, HTML validation |
| `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` | 2026-08-31 | **Authoritative Phase 3 acceptance record** | Implemented DSS scope, live market-data proof, final deterministic gate, UI smoke acceptance, safety boundary, Phase 4 handoff |
| PR #12 | 2026-08-31 | **Phase 3 merge record** | Merged accepted Phase 3 implementation and closeout documentation to `main` |

A phase closeout record may supersede an older implementation-status statement while leaving the earlier approved design document intact as historical approval evidence.

---

## 10. Historical / superseded project documents

| Document | Status | Use |
|---|---|---|
| `V2-MILESTONE-1.md` | **Historical** | Original V2 stateful-execution prototype design record |
| ExecutionOS Project Specification original 2026-08-26 edition | **Superseded** | Earlier project snapshot retained for provenance |
| ExecutionOS Project Specification v1.1 | **Superseded by v1.2** | Post-V2.3-validation decision history |
| ExecutionOS Project Specification v1.2 repository status | **Dated snapshot** | Architecture remains important; branch/PR/tag status reflects 26 Aug context |
| ExecutionOS Architecture, Validation & Monday Plan — 2026-08-23 | **Superseded as current guidance** | Retained as pre-live evidence |
| Earlier branch-local README/User Guide states | **Implementation-era snapshots** | Do not use instead of current documentation |

Do not delete these simply because they are old. Their value is historical traceability.

---

## 11. Pull requests as project records

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
- Merged the accepted Phase 3 DSS / Micro-Volatility Buffer implementation, live Schwab capability path, lifecycle/persistence integration, exact Phase 4 handoff, and formal Phase 3 closeout documentation.

Use current repository history rather than old PR descriptions to identify the present mainline head.

---

## 12. Research evidence and reproducibility artifacts

The `research/30-day-management-study/` folder contains prose methodology plus deterministic analysis, diagnostics, tests, and benchmark artifacts.

Important classes include:

- `methodology.md` — authoritative research provenance;
- `expected-results.json` — preserved numerical fingerprint;
- study runners / reconstruction scripts;
- diagnostics for duration, initial-risk/R basis, stop provenance, minute alignment, fast-winner sampling, and market-data validation;
- local raw/normalized/enriched broker data and Schwab minute-history caches — intentionally Git-ignored and not documentation.

Preserve the distinction between historical evidence, reconstruction methodology, reproducible code, local sensitive/raw data, current production semantics, and current EOD reporting output.

---

## 13. Maintenance rules

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

## 14. Quick reference — where to look first

| Question | First source |
|---|---|
| How do I operate ExecutionOS today? | `USER-GUIDE.md` |
| What is the authoritative V2.4 architecture/design? | `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` |
| What exactly did Phase 3 implement and validate? | `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` |
| Is Phase 3 merged? | **Yes — PR #12, merge commit `ff437508f228b8a1eb0bb2e1c7bb9ea4ca0de97e`** |
| What is the accepted Phase 3→4 handoff? | Phase 3 closeout + V2.4 Design Baseline Phase 3→Phase 4 risk handoff |
| Has a candidate actually appeared in the UI? | Phase 3 closeout candidate-ingestion → PRE-TRADE UI smoke acceptance |
| Has a WAITING candidate reached the V2.3 Execution Board? | **No**; that requires later READY/ARM work |
| What branch starts Phase 4? | `v24-phase4-risk-sizing` |
| How do I generate an accurate enriched EOD report? | `USER-GUIDE.md` after-session/EOD instructions |
| What exactly does the EOD reporter compute and what are its limitations? | `docs/ExecutionOS_EOD_Report.md` |
| What is the longer-term architecture / Governor direction? | Project Specification v1.2, interpreted as a dated architecture record |
| What code state is current main after Phase 3 merge? | `ff437508f228b8a1eb0bb2e1c7bb9ea4ca0de97e` |

---

## 15. Current project-documentation snapshot

As of **2026-08-31**:

- V2.3 execution behavior remains release-validated and frozen under annotated tag `v2.3.0` at `baabb75f36050599f20e6c89e8db2f1f7d7769a1`.
- Read-only EOD reporting remains part of the operational mainline documentation/analytics workflow.
- V2.4 Phase 1 Candidate Ingestion is complete/merged.
- V2.4 Phase 2 MarketDataProvider is complete/merged/live-accepted.
- `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` is the authoritative V2.4 design baseline.
- V2.4 Phase 3 DSS is implementation-complete, accepted, and **merged via PR #12**.
- Phase 3 merge commit is `ff437508f228b8a1eb0bb2e1c7bb9ea4ca0de97e`.
- The final Phase 3 gate is 91/91 focused DSS, 123/123 full tests, 10/10 frozen V2.3 trade state, production build PASS.
- A live read-only NVDA Phase 3 probe returned a VALID effective stop from real Schwab market data and verified instrument metadata.
- A synthetic candidate was accepted through the actual import API and visibly rendered in the PRE-TRADE Waiting Candidate Board.
- A WAITING candidate has **not** yet crossed into the existing V2.3 Execution Board; that remains intentionally gated behind later permission/READY/ARM work.
- `v24-phase4-risk-sizing` is the clean Phase 4 branch created from the post-Phase-3 mainline.
- Phase 4 Effective-Stop Risk Sizing is the next V2.4 design/implementation phase.
- V3 has not started.

---

**Maintenance principle:** If a future contributor cannot answer “what is authoritative, what is historical, what has actually been implemented/accepted, what has merged, what data is required, and what remains intentionally gated?” from this file and the linked records, update the documentation before adding more architecture.
