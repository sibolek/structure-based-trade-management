# ExecutionOS Documentation Index

**Status:** Current documentation inventory  
**Date:** 2026-09-04  
**Repository:** `sibolek/structure-based-trade-management`

---

## 1. Authority and precedence

1. **Current code and validated runtime behavior** define what the system actually does.
2. `USER-GUIDE.md` is the living operator guide for the accepted handoff branch.
3. Approved design baselines/addenda define frozen architecture for their scope.
4. Closeout/status records define implemented/accepted state.
5. Historical specifications remain dated evidence and do not override newer validated behavior.

---

## 2. Current authoritative documentation

| Document | Role | Authority |
|---|---|---|
| `USER-GUIDE.md` | Current operator workflow | **Authoritative operator guide for accepted handoff branch** |
| `README.md` | Current repository overview | **Current overview** |
| `DOCUMENTATION-STATUS.md` | Current vs historical map | **Documentation governance** |
| `docs/ExecutionOS_Documentation_Index.md` | Cross-document authority/status | **Current index** |
| `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` | Consolidated V2.4 architecture | **Approved historical/top-level design** |
| `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md` | Phase 4 risk design | **Approved Phase 4 design** |
| `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` | Phase 3 accepted implementation | **Accepted implementation** |
| `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md` | Phase 4 accepted implementation | **Accepted implementation** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md` | Original handoff architecture | **Approved handoff baseline** |
| Handoff addenda v0.1 through v1.0 | Decisions 10–20 | **Approved / frozen** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v1.1_APPROVED.md` | Decision 21 — Full Trade Specification Inspector | **Approved / frozen** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v1.2_APPROVED.md` | Decision 22 — Normal Router Enablement & Recovery Hardening | **Approved / frozen** |
| `docs/ExecutionOS_EOD_Report.md` | EOD semantics | **Current reporting reference** |

---

## 3. Release / branch map

### `main`

Contains merged V2.4 Phases 1–4.

Phase 4 merge:

```text
PR #14
0a976fb8bc68f64fd479d48322a011c9d419b2c2
```

### Frozen downstream reference

```text
v2.3.0
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

### Accepted handoff/runtime branch

```text
v24-execution-board-handoff
```

The handoff/runtime branch is not yet merged to `main`. Decision 22 behavior must not be assumed to exist on `main` until that merge actually occurs.

---

## 4. Accepted handoff/runtime capabilities

Governing invariant:

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

Implemented/accepted on the handoff branch:

- immutable authorization/handoff provenance;
- persistent handoff + delivery state machine;
- stable browser receiver identity;
- exact-account admission and symbol-global broker cleanliness;
- authoritative Schwab `executionTime`;
- lossless execution-activity and ownership-journal proof;
- PREPARED/LISTENING local installation;
- immutable `executionListeningAt`;
- durable DISCARD retirement cutoff and prior-fill precedence;
- exact-account first-fill ownership;
- atomic V2.4 LIVE lifecycle + visible Execution Board projection;
- entry-fragment / ADD / PARTIAL / FLAT / REVERSAL lifecycle handling;
- fail-closed `LIVE_RECONCILIATION_REQUIRED`;
- canonical browser store authority;
- browser-wide writer lock across V2.3 + V2.4;
- browser-wide single router leader;
- default-on runtime router with negative emergency pause only;
- router health and structured telemetry;
- reload/HMR/remount/takeover recovery;
- read-only full trade-specification inspector;
- real-browser Web Lock/multi-tab/recovery acceptance;
- no broker writes.

---

## 5. Current operator-surface boundary

The downstream receiver/router/ownership path is accepted and operational for valid handoffs.

The current PRE-TRADE browser/API surface does **not yet expose the complete**:

```text
WAITING
→ permission evaluation
→ READY / CAUTION
→ ARM
→ create/register production handoff
```

workflow as one normal operator path.

Imported WAITING candidates remain proposals only. Internal Phase 3, Phase 4, ARM authorization, and handoff construction services exist and are tested, but current browser PRE-TRADE UI does not orchestrate them end to end.

---

## 6. Decision 22 runtime model

### Default-on router

No positive enable flag is required.

Emergency negative switch:

```text
VITE_EXECUTIONOS_V24_ROUTER_DISABLED=true
```

Semantics:

```text
unset / false -> enabled
true          -> PAUSED
other nonempty value -> BLOCKED / fail closed
```

### Health states

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

Reconciliation remains ownership state rather than router health.

### Recovery invariants

- post-LISTENING ownership work is independent of pretrade transport;
- Schwab evidence loss freezes broker-sensitive conclusions;
- browser refresh is not required for deterministic recovery;
- reload/HMR/takeover creates a fresh epoch that rereads durable authority;
- graceful stop must not release leadership before in-flight work settles;
- actual Web Locks remain the concurrency authority.

---

## 7. EOD semantics

Current origin-aware risk-stop rule:

```text
V24_HANDOFF        -> v24.effectiveStop
LEGACY_MANUAL_V23  -> originalPlan.structuralStop
```

For V2.4, structural invalidation is preserved separately and is not substituted for the effective stop in planned-risk/R enrichment.

---

## 8. Known current limitations

- no complete browser/API WAITING→permission→ARM→handoff-creation workflow;
- no complete explicit reconciliation-resolution operator workflow;
- no broker order placement/modification/cancellation/flattening;
- no buying-power/margin or portfolio-heat gate;
- no live NinjaTrader binding;
- V3 Management Governor not started.

---

## 9. Validation references

Decision 22 acceptance work includes deterministic suites, synthetic read-only recovery E2E, real-browser Web Lock/multi-tab/reload recovery tests, no-write assertions, and production build validation.

The dedicated command surfaces are listed in `USER-GUIDE.md` and `package.json`, including:

```text
v24:runtime-router-test
v24:store-authority-test
v24:v23-install-test
v24:retirement-test
v24:activation-test
v24:fill-ownership-test
v24:live-lifecycle-test
v24:v23-compat-test
v24:router-hardening-test
v24:router-browser-test
```

---

## 10. Pull requests as project records

- PR #1 — V2.3 execution system; merged.
- PR #7 — read-only EOD reporting; merged.
- PR #12 — V2.4 Phase 3 DSS; merged.
- PR #13 — Phase 3 documentation cleanup; merged.
- PR #14 — V2.4 Phase 4 risk sizing; merged.
- Execution Board handoff integration — accepted branch work; merge status must be checked explicitly.

---

**Maintenance principle:** current code/runtime and accepted closeout evidence govern current truth. Preserve historical approved documents, but keep `USER-GUIDE.md`, `README.md`, `DOCUMENTATION-STATUS.md`, this index, and current operational references synchronized whenever accepted behavior changes.
