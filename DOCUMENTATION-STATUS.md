# ExecutionOS Documentation Status

**Updated:** 2026-09-01

This file distinguishes current authoritative project records from historical planning snapshots and dated approval artifacts.

## Current authoritative records

### `USER-GUIDE.md`

The **living operator guide** for ExecutionOS as it exists on current `main`.

It is the primary day-to-day reference for installation, Schwab authorization, startup, current V2.4/V2.3 architecture boundaries, risk and ARM semantics, broker binding, execution management, persistence, troubleshooting, security, CLI commands, and the enriched End-of-Day workflow.

Important current distinction: V2.4 Phase 4 internal risk sizing and `ARMED` provenance are merged, but the explicit V2.4 internal `ARMED` → existing V2.3 Execution Board transfer remains deferred. Normal broker order entry remains in thinkorswim/Schwab and the Schwab integration remains read-only.

### `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md`

The **authoritative top-level V2.4 design baseline**.

It records the approved pre-trade architecture, source boundary, lifecycle, Phase 3 DSS design, Phase 3→4 handoff, context/decision-gate direction, and ARM boundary.

Its approval-time implementation-status statements are historical snapshots and should not be rewritten.

### `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md`

The **authoritative Phase 4 design baseline**.

It locks expected-entry semantics, exact-account risk snapshot semantics, equity/futures conversion, quantity rounding, immutable risk evaluation, freshness/recalculation rules, permission mapping, and ARM-time risk sizing.

Its approval-time status remains historical; implementation status is recorded in the Phase 4 closeout.

### `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md`

The **authoritative Phase 3 implementation/acceptance record**.

It records the implemented DSS/effective-stop path, live Schwab proof, deterministic acceptance gates, no-sizing/no-broker-write boundary, and exact Phase 3→4 handoff.

### `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md`

The **authoritative Phase 4 implementation/acceptance/merge record**.

It records:

- the exact 0.5% effective-stop risk policy;
- expected-entry semantics;
- exact-account `liquidationValue` equity;
- quote/account freshness;
- equity and futures risk conversion;
- downward-only quantity rounding;
- immutable append-only `RiskEvaluation` provenance;
- `NO_AFFORDABLE_SIZE → PASS — STOP_RISK_CONFLICT` mapping;
- mandatory fresh Phase 4 evaluation on each ARM attempt;
- selected-quantity enforcement;
- exact DSS/risk/quantity provenance freeze;
- final authorization freshness checks and rollback semantics;
- final deterministic acceptance gate;
- no broker-order authority;
- PR #14 merge record.

### `docs/ExecutionOS_EOD_Report.md`

The dedicated operational/technical reference for read-only End-of-Day reporting.

For normal operator sequencing, defer to `USER-GUIDE.md`; for report reconstruction, matching, risk/R interpretation, carry-in handling, and limitations, use this document.

### `docs/ExecutionOS_Project_Specification_v1.2_2026-08-26.md`

A dated architecture/project decision record for the validated V2.3-era system and future Management Governor direction.

Its embedded repository SHA/PR/status fields are historical as of 2026-08-26 and should not be rewritten to mimic later V2.4 merges.

### `research/30-day-management-study/methodology.md`

Authoritative technical provenance for the preserved historical study.

### `README.md`

Current project/repository overview. Defer to the User Guide for operation, design baselines for architecture, and closeout records for implementation acceptance.

### `docs/ExecutionOS_Documentation_Index.md`

The cross-document inventory and authority map. Update it whenever phase status, major merge state, or authoritative documentation changes.

---

## Current implementation / release state

### Frozen downstream execution release

```text
v2.3.0
```

Tag target:

```text
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

This remains the frozen broker-fill ownership and execution-management reference.

### V2.4 merge state

- Phase 1 Candidate Ingestion — **COMPLETE / MERGED**;
- Phase 2 MarketDataProvider — **COMPLETE / MERGED / LIVE-ACCEPTED**;
- Phase 3 DSS / Micro-Volatility Buffer — **IMPLEMENTATION COMPLETE / ACCEPTED / MERGED**;
- Phase 4 Effective-Stop Risk Sizing — **IMPLEMENTATION COMPLETE / ACCEPTED / MERGED via PR #14**.

Phase 4 merge record:

```text
PR #14
Merge commit: 0a976fb8bc68f64fd479d48322a011c9d419b2c2
```

Final Phase 4 acceptance gate:

```text
v24:risk-sizing-test  170/170 PASS
v24:dss-test           91/91 PASS
analytics:test        293/293 PASS
schwab:state-test      10/10 PASS
production build      PASS
```

### What is still intentionally not complete

The following remain outside the merged Phase 4 scope:

- broader context/decision-gate logic beyond the Phase 4 risk consequence;
- explicit V2.4 internal `ARMED` → existing V2.3 Execution Board transfer/binding;
- broker write/order placement, replacement, cancellation, stop replacement, or flattening;
- buying-power/margin eligibility gating;
- portfolio heat / aggregate concurrent-risk controls;
- non-USD currency conversion and additional asset types;
- automatic NinjaTrader futures binding.

`ARMED` in the Phase 4 closeout is an internal authorization/provenance state. It is not proof that an order was sent or that a fill is owned by the V2.3 Execution Board.

V3 has not started.

---

## Historical / superseded records

### `V2-MILESTONE-1.md`

Historical original V2 stateful-execution prototype record.

### `ExecutionOS_Architecture_Validation_and_Monday_Plan_2026-08-23.pdf`

Historical planning snapshot superseded as current guidance by later validated behavior and phase closeouts.

### Project Specification v1.0 / v1.1

Historical specifications; v1.2 supersedes them for its dated architecture record.

### Project Specification v1.2 repository-status fields

Historical snapshot only. Architecture/design decisions remain important, but embedded repository status is not current.

### V2.4 approved-design implementation-status prose

Historical at approval time. Do not rewrite design baselines merely because Phase 3 and Phase 4 are now implemented and merged.

---

## Pull requests as project records

- **PR #1** — V2.3 execution system; merged.
- **PR #2** — analytics preservation; merged.
- **PR #3** — useful pre-V2 execution-discipline documentation; merged.
- **PR #4** — history-only reconciliation; merged.
- **PR #5** — V2.3 release-documentation closeout; merged.
- **PR #6** — post-merge V2.3 documentation finalization; merged.
- **PR #7** — read-only EOD reporting; merged at `bedd70979a3b18844386bcf8f927fd8a1f62307f`.
- **PR #12** — V2.4 Phase 3 DSS implementation; merged.
- **PR #13** — Phase 3 post-merge documentation cleanup; merged.
- **PR #14** — V2.4 Phase 4 Effective-Stop Risk Sizing; merged at `0a976fb8bc68f64fd479d48322a011c9d419b2c2`.

Use current repository history and the Documentation Index for present status.

---

## Documentation rule

Do not rewrite historical or approved dated documents merely because later evidence changed project state.

When a change affects day-to-day operation, update the User Guide as part of the same documentation closeout.

When an approved architecture phase is implemented, create/update a formal implementation/acceptance record and synchronize this status file plus the Documentation Index.

When project-wide architecture changes beyond the scope of an existing dated specification, create a new specification revision rather than silently rewriting the old one.
