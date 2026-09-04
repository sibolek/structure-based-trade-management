# ExecutionOS Documentation Status

**Updated:** 2026-09-04

This file distinguishes current authoritative project records from historical planning snapshots and dated approval artifacts.

## Current authoritative records

### `USER-GUIDE.md`

The living operator guide for the accepted V2.4 Execution Board handoff branch.

Current integration branch:

```text
v24-execution-board-handoff
```

Important release distinction:

- V2.4 Phases 1–4 are merged to `main`;
- the accepted Execution Board handoff/runtime/recovery implementation is still on `v24-execution-board-handoff` and has not yet been merged to `main`;
- therefore operators expecting Decision 22 behavior must remain on the handoff branch until an explicit merge occurs.

### Approved design authority

Top-level V2.4:

- `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md`.
- `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md`.

Execution Board handoff:

- `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md`.
- approved handoff addenda v0.1 through v1.0 — Decisions 10–20.
- `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v1.1_APPROVED.md` — Decision 21, Full Trade Specification Inspector.
- `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v1.2_APPROVED.md` — Decision 22, Normal Router Enablement & Recovery Hardening.

Historical approved baselines remain frozen approval-time evidence. Do not rewrite them merely because implementation status advanced later.

### Accepted implementation / closeout records

- `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md`.
- `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md`.
- Execution Board handoff accepted implementation is represented by the current handoff branch code, approved Decisions 10–22, deterministic/browser acceptance suites, and the living operator/status documentation.

---

## Current implementation / release state

### Frozen downstream execution release

```text
v2.3.0
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

Legacy/manual V2.3 behavior remains the frozen downstream reference. V2.4-origin trades use the accepted exact-account ownership/lifecycle path and may not be routed through legacy symbol-only / `detectedAt` ownership logic.

### V2.4 merged state on `main`

- Phase 1 Candidate Ingestion — **COMPLETE / MERGED**;
- Phase 2 MarketDataProvider — **COMPLETE / MERGED / LIVE-ACCEPTED**;
- Phase 3 DSS / Micro-Volatility Buffer — **COMPLETE / ACCEPTED / MERGED**;
- Phase 4 Effective-Stop Risk Sizing — **COMPLETE / ACCEPTED / MERGED via PR #14**.

### Accepted handoff integration branch

```text
v24-execution-board-handoff
```

Implemented/accepted capabilities include:

- immutable V2.4 authorization/handoff provenance;
- handoff persistence and delivery state machine;
- stable browser receiver identity;
- exact-account broker cleanliness/admission;
- authoritative Schwab `executionTime` and lossless activity/journal proof;
- PREPARED/LISTENING installation and immutable `executionListeningAt`;
- universal pre-fill DISCARD/retirement with immutable cutoff;
- exact-account first-fill ownership;
- atomic LIVE lifecycle + visible V2.4 Execution Board promotion;
- fragmented-entry / ADD / PARTIAL / FLAT / REVERSAL lifecycle semantics;
- canonical browser store authority and serialized cross-tab writes;
- serialized top-level runtime router;
- read-only full trade-specification inspector;
- default-on router with negative emergency pause only;
- router health/telemetry;
- reload/HMR/remount/takeover recovery;
- deterministic and real-browser Web Lock acceptance tests;
- no broker-write authority.

### Current operator-surface boundary

The downstream handoff receiver/router/ownership path is implemented and accepted.

The current PRE-TRADE browser/API surface does **not yet expose the complete**:

```text
WAITING → permission → READY/CAUTION → ARM → create/register handoff
```

workflow as one normal operator action path. Imported WAITING candidates remain proposals only until a valid handoff is created through the implemented internal authorization/handoff services.

### Current intentionally incomplete areas

- complete upstream browser/API permission→ARM→handoff orchestration;
- explicit reconciliation-resolution workflow;
- broker writes/order placement/modification/cancellation/flattening;
- buying-power/margin and portfolio-heat gates;
- live NinjaTrader binding;
- V3 Management Governor.

V3 has not started.

---

## Decision 22 accepted runtime model

The runtime router is default-on on the accepted handoff branch.

Emergency negative switch:

```text
VITE_EXECUTIONOS_V24_ROUTER_DISABLED=true
```

Interpretation:

```text
unset / false -> enabled
true          -> PAUSED
other nonempty value -> BLOCKED / fail closed
```

The retired positive enable flag must not be used.

Router health states:

```text
RUNNING
WAITING_FOR_SCHWAB
WAITING_FOR_PRETRADE
WAITING_FOR_ROUTER_LOCK
PAUSED
STALE
BLOCKED
ERROR
```

Reconciliation is durable trade/ownership state, not router health.

---

## EOD reporting status

EOD enrichment is origin-aware:

```text
V24_HANDOFF        -> v24.effectiveStop is risk-stop authority
LEGACY_MANUAL_V23  -> originalPlan.structuralStop is risk-stop authority
```

V2.4 structural invalidation remains separate provenance and is not substituted for `effectiveStop` in planned-risk/R calculations.

---

## Other current references

- `README.md` — current repository overview.
- `docs/ExecutionOS_EOD_Report.md` — authoritative EOD technical/operational reference.
- `docs/ExecutionOS_Project_Specification_v1.2_2026-08-26.md` — authoritative dated V2.3-era architecture record.
- `research/30-day-management-study/methodology.md` — historical analytics provenance.
- `docs/ExecutionOS_Documentation_Index.md` — cross-document authority/status map.

---

## Pull requests as project records

- PR #1 — V2.3 execution system; merged.
- PR #7 — read-only EOD reporting; merged.
- PR #12 — V2.4 Phase 3 DSS implementation; merged.
- PR #13 — Phase 3 documentation cleanup; merged.
- PR #14 — V2.4 Phase 4 Effective-Stop Risk Sizing; merged.
- Execution Board handoff integration — accepted branch work; merge status must be checked explicitly before treating `main` as containing it.

---

## Documentation rule

Current validated code/runtime defines what the system actually does. `USER-GUIDE.md` translates that into operator procedure. Approved dated documents preserve frozen architecture/approval-time context and should not be rewritten to simulate later state.

When accepted implementation status changes, synchronize this file, `USER-GUIDE.md`, `README.md`, and `docs/ExecutionOS_Documentation_Index.md` so current records do not contradict one another.
