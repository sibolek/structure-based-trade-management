# ExecutionOS Documentation Index

**Status:** Current documentation inventory  
**Date:** 2026-09-06  
**Repository:** `sibolek/structure-based-trade-management`

---

## 1. Authority and precedence

1. **Current code and validated runtime behavior** define what the system actually does.
2. `USER-GUIDE.md` is the living operator guide for the accepted handoff branch.
3. `docs/ExecutionOS_V2.4_Design_Baseline_v0.5_APPROVED.md` is the consolidated frozen V2.4 architectural authority for Decisions 22–97.
4. `docs/ExecutionOS_V2.4_Design_Baseline_v0.5_Traceability_Audit_APPROVED.md` is the approved decision-coverage companion to v0.5.
5. Closeout/status records define implemented/accepted state.
6. Earlier approved baselines/addenda remain historical approval-time evidence and do not override later frozen authority or accepted runtime behavior.

---

## 2. Current authoritative documentation

| Document | Role | Authority |
|---|---|---|
| `USER-GUIDE.md` | Current operator workflow | **Authoritative operator guide for accepted handoff branch** |
| `README.md` | Current repository overview | **Current overview** |
| `DOCUMENTATION-STATUS.md` | Current vs historical map | **Documentation governance** |
| `docs/ExecutionOS_Documentation_Index.md` | Cross-document authority/status | **Current index** |
| `docs/ExecutionOS_V2.4_Design_Baseline_v0.5_APPROVED.md` | Consolidated PRETRADE→ARM→Execution architecture | **Current frozen V2.4 design authority** |
| `docs/ExecutionOS_V2.4_Design_Baseline_v0.5_Traceability_Audit_APPROVED.md` | Decision 22–97 traceability | **Approved implementation companion** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Closeout_2026-09-06.md` | Slices 1–7 implementation/acceptance record | **Accepted implementation closeout** |
| `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` | Phase 3 accepted implementation | **Accepted implementation** |
| `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md` | Phase 4 accepted implementation | **Accepted implementation** |
| `docs/ExecutionOS_EOD_Report.md` | EOD semantics | **Current reporting reference** |

Earlier approved handoff baselines/addenda and `ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` remain preserved historical evidence. Do not rewrite them merely because implementation status advanced.

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

### Accepted V2.4 integration branch

```text
v24-execution-board-handoff
```

Accepted implementation checkpoint before documentation-only closeout commits:

```text
3f794538ffbe5c5875a3d671143cb33890530b1f
```

The handoff branch is accepted/closed but must not be assumed to exist on `main` until an explicit merge occurs.

---

## 4. Accepted end-to-end model

Governing invariant:

> **V2.4 authorizes; the handoff transfers; V2.3-compatible execution infrastructure owns execution.**

Accepted lifecycle:

```text
CANDIDATE SOURCE
→ CANONICAL INGRESS
→ WAITING
→ PRETRADE_TRIGGER_EVALUATING
→ PERMISSION_EVALUATING
→ READY / CAUTION / PASS
→ OPERATOR REVIEW
→ ARM
→ IMMUTABLE HANDOFF
→ PENDING
→ CLAIMED
→ PREPARED
→ LISTENING
→ EXACT-ACCOUNT OPENING FILL
→ LIVE
→ PARTIAL / SCALE / MANAGEMENT
→ FLAT
→ EXIT
→ OPERATOR EXIT CLASSIFICATION
→ HISTORY
→ OWNERSHIP RELEASE
```

Browser code is presentation/intent only. Server-side PRETRADE authorities own candidate lifecycle, trigger, permission, review, OCO, and ARM. The canonical Execution Board store owns downstream installation/lifecycle/management state.

---

## 5. Accepted PRETRADE / ARM capabilities

Implemented/accepted on the handoff branch:

- canonical candidate ingress, validity, immutable hashing, versioning and supersession;
- automatic relevance plus versioned trigger-satisfaction evidence;
- durable trigger progress/recovery;
- immutable permission attempts;
- structural-validity authority;
- Phase 3 DSS + Phase 4 risk integration;
- `READY / CAUTION / PASS` outcomes;
- exact-package operator review;
- explicit quantity selection;
- exact-package CAUTION acknowledgement;
- OCO group authority and same-symbol ARM gate;
- final symbol/direction/quantity/account confirmation;
- fresh ARM-time permission and risk revalidation;
- durable ARM operation journal and recovery;
- immutable ARMED provenance;
- exactly one immutable handoff and one PENDING delivery per successful authorization;
- PRETRADE browser Active, Authorized/Execution, and History projections;
- no browser generic lifecycle or ARM authority.

An imported WAITING candidate is still a proposal only. Progression requires the explicit operator/server workflow; it is never automatically ARMED merely because the router is running.

---

## 6. Accepted downstream/runtime capabilities

Implemented/accepted:

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
- canonical browser store authority;
- browser-wide writer lock across V2.3 + V2.4;
- browser-wide single router leader;
- default-on runtime router with negative emergency pause only;
- router health and structured telemetry;
- reload/HMR/remount/takeover recovery;
- read-only full trade-specification inspector;
- no broker writes.

---

## 7. Slice 7 live-management authority

Accepted Slice 7 behavior includes:

- finite immutable first-entry authorization deadline;
- no deadline extension by delay/restart/recovery;
- late-fill broker truth retained as authorization exception, never retroactive authorization;
- immutable ARM quantity ceiling;
- finite position-build window;
- explicit **Complete Position Build**;
- downward-only live ceiling after build capacity is relinquished/expired;
- re-add gating within the same authorization/account/symbol/direction and established ceiling;
- exposure-increase risk checks;
- finite lifecycle loss budget;
- realized losses consume capacity, profits do not replenish it;
- explicit live effective-stop authority and audit trail;
- tighter stops may free risk only within existing ceilings;
- wider stops cannot manufacture capacity;
- structured target observations;
- discretionary notes without machine authority;
- CRITICAL Authorization Exceptions;
- explicit exception reconciliation;
- retired-authorization late-fill detection and exact later-handoff reassignment when admissible;
- managed runtime recovery;
- legacy V2.4 compatibility isolated from native Phase 4 economics.

---

## 8. Read-only broker boundary

Accepted invariant:

```text
readOnly === true
brokerWriteAuthority === false
```

ExecutionOS does not place, replace, cancel, modify, reduce, or flatten broker orders.

Actual equity order entry remains in thinkorswim/Schwab. Schwab observation is exact-account and authoritative `executionTime` based.

---

## 9. Current intentionally incomplete/deferred areas

- no broker order placement/modification/cancellation/flattening;
- no general broker-write Governor;
- no buying-power/margin or aggregate portfolio-heat gate;
- no live NinjaTrader execution binding;
- no cloud/multi-device authority;
- generic coverage/provenance reconciliation beyond the implemented Authorization Exception workflow remains fail-closed/operator-supervised;
- V3 Management Governor not started.

---

## 10. Router model

Runtime router is default-on.

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

Health states:

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

Reconciliation remains ownership/trade state rather than router health.

---

## 11. EOD semantics

Current origin-aware risk-stop rule:

```text
V24_HANDOFF        -> authoritative V2.4 effective stop / managed stop semantics
LEGACY_MANUAL_V23  -> originalPlan.structuralStop
```

Structural invalidation remains separate from the V2.4 effective stop.

---

## 12. Acceptance evidence

Final closeout evidence:

```text
Focused Slice 7:                 26 / 26 PASS
Downstream lifecycle E2E:         1 / 1 PASS
Canonical PRETRADE→Execution E2E: 1 / 1 PASS
Full repository regression:      734 / 734 PASS
Production build:                PASS
Implementation worktree:         CLEAN
Broker-write authority:          NONE
```

Dedicated tests include:

```text
node --test tests/execution-v24-live-management.test.mjs \
  tests/execution-v24-slice7.test.mjs \
  tests/execution-v24-slice7-final.test.mjs \
  tests/execution-v24-retired-assignment.test.mjs \
  tests/execution-v24-legacy-management-compat.test.mjs

npm run v24:full-lifecycle-e2e-test
node --test tests/execution-v24-pretrade-full-e2e.test.mjs
npm run analytics:test
npm run build
```

---

## 13. Pull requests as project records

- PR #1 — V2.3 execution system; merged.
- PR #7 — read-only EOD reporting; merged.
- PR #12 — V2.4 Phase 3 DSS; merged.
- PR #13 — Phase 3 documentation cleanup; merged.
- PR #14 — V2.4 Phase 4 risk sizing; merged.
- Execution Board handoff integration — accepted/closed on `v24-execution-board-handoff`; merge status must be checked explicitly.

---

**Maintenance principle:** current code/runtime and accepted closeout evidence govern current truth. Preserve frozen approved documents, but synchronize `USER-GUIDE.md`, `README.md`, `DOCUMENTATION-STATUS.md`, this index, and current operational references whenever accepted behavior changes.