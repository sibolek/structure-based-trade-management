# ExecutionOS V2.4 — Execution Board Handoff Integration
## Implementation Status — 2026-09-02

**Branch:** `v24-execution-board-handoff`  
**Design authority:** `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md`  
**Approved addenda:** Decisions 10–14 in addenda v0.1–v0.4  
**Overall status:** **IN PROGRESS — HANDOFF CONTRACT/DELIVERY, BROKER PROVENANCE, PURE ADMISSION GATE, V2.3 COMPATIBILITY/PROVENANCE, STABLE RECEIVER IDENTITY, AND DORMANT LOCAL INSTALLATION FOUNDATION ACCEPTED; LIVE V2.4 FILL OWNERSHIP NOT YET ENABLED**

---

## 1. Governing boundary

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

Broker order placement, modification, cancellation, stop replacement, or automatic flattening remain **NOT AUTHORIZED / NOT IMPLEMENTED**.

---

## 2. Accepted implementation checkpoint

| Work | Status |
|---|---|
| Increment 1 — Immutable handoff contract + persistence | **ACCEPTED** |
| Increment 2 — Claim / delivery state machine | **ACCEPTED** |
| Increment 3 — Exact broker account identity + execution coverage | **ACCEPTED / LIVE-PROVEN** |
| Increment 4 — Server-side handoff transport API | **ACCEPTED / ISOLATED RUNTIME-PROVEN** |
| Sequence item 6 — execution-activity provenance + pure pre-install admission gate | **ACCEPTED / LIVE-PROVEN** |
| Sequence item 5 — V2.3 compatibility helpers / provenance model | **ACCEPTED** |
| Sequence item 7 foundation — stable receiver identity + dormant PREPARED/LISTENING local persistence | **ACCEPTED** |

The sequence-item-7 foundation is deliberately dormant: it is not yet wired into the live React candidate array or legacy fill matcher.

---

## 3. Approved design freezes

- **Decision 10 — V2.4 authorization immutability:** V2.4 authorization-bearing fields may not be edited in place. Mutation fails with `V24_AUTHORIZATION_IMMUTABLE`. Desired changes use fast Revise → retire → fresh authorization → Re-arm. Manual/legacy V2.3 Edit remains unchanged.
- **Decision 11 — Universal pre-fill discard/disarm:** every pre-fill `ARMED` / `LISTENING` trade may be discarded regardless of origin; discard ends fill eligibility, releases symbol ownership, preserves audit history, and does not cancel broker orders.
- **Decision 12 — Symbol-global broker cleanliness:** exact Phase 4 account determines which account may own the trade, while current-position and intervening-execution cleanliness is checked across all observable connected accounts.
- **Decision 13 — Authoritative execution timing:** Schwab `executionTime` governs admission and future fill ownership; `detectedAt` is audit-only. Safety uses a lossless account+symbol execution-activity watermark, not the bounded recent-execution UI list.
- **Decision 14 — Stable Execution Board receiver identity:** each browser/profile owns one stable opaque receiver ID persisted independently of trade state. Losing that storage creates a new receiver; sticky claims are never silently migrated or stolen.

---

## 4. Accepted broker provenance + pure admission gate

Accepted runtime includes `broker-execution-activity.mjs`, `execution-board-handoff-admission.mjs`, and aligned live-state coverage/activity provenance.

Accepted evidence:

```text
v24:broker-provenance-test  24/24 PASS
v24:handoff-admission-test  16/16 PASS
v24:handoff-test            34/34 PASS
v24:handoff-api-test         7/7 PASS
schwab:state-test            10/10 PASS
production build            PASS
```

Live Schwab proof confirmed aligned `executionCoverage` / `executionActivity`, `status = ARMED`, `readOnly = true`, and `lastError = null`.

---

## 5. Accepted V2.3 compatibility / provenance

Runtime: `src/execution/execution-v23-compat.js`.

Key accepted rule:

```text
executionStop(trade)
  V2.4-origin   → effectiveStop
  legacy/manual → originalPlan.structuralStop
```

The layer preserves structural invalidation separately, selected quantity, exact account, candidate/version/hash, DSS/risk IDs, handoff/receiver provenance, authorization time, and one-time `executionListeningAt`. V2.4 authorization mutation fails with `V24_AUTHORIZATION_IMMUTABLE`; manual/legacy behavior remains compatible.

Focused acceptance:

```text
v24:v23-compat-test          13/13 PASS
v24:handoff-admission-test  16/16 PASS
v24:handoff-test            34/34 PASS
schwab:state-test            10/10 PASS
production build            PASS
```

---

## 6. Accepted sequence-item-7 foundation

Runtime:

- `src/execution/execution-board-receiver.js`
- `src/execution/execution-v24-local-installation.js`

Accepted behavior:

- dedicated stable `executionBoardReceiverId`, separate from `execution-v23-store`;
- storage/readback failures fail closed;
- exact durable `PREPARED` installation without fill ownership;
- same-handoff retry is idempotent;
- mismatched same `handoffId` fails with `HANDOFF_ID_CONTENT_CONFLICT`;
- same-symbol local ownership blocks duplicate installation;
- nonterminal ownership adapter includes manual candidate, LIVE/EXIT ownership, Edit working state, PREPARED, and LISTENING records;
- one-time durable `PREPARED → LISTENING` transition freezes `executionListeningAt`;
- LISTENING installation can construct a V2.3-shaped candidate without losing Phase 3 `effectiveStop` authority;
- the V2.4 record is intentionally **not inserted into the live V2.3 candidate array yet**, preventing the legacy symbol-only / `detectedAt` matcher from claiming it.

User acceptance: all focused installation/receiver tests and requested regressions reported green on 2026-09-02.

This is **not full sequence-item-7 completion** yet. Final broker revalidation, activation into the live V2.3 store, and transport ACK remain to be wired after safe exact-account ownership matching exists.

---

## 7. Newly identified fill-ownership completeness issue

The public `executions` array remains intentionally bounded for UI use. That means it cannot safely serve as the only durable source for first-fill ownership after a browser reload or temporary receiver outage: an eligible execution could be evicted before the receiver processes it.

A new design decision is therefore required before sequence item 8 is activated: preserve exact broker execution events needed for V2.4 ownership independently of the bounded UI list, with the same fail-closed coverage discipline used by admission provenance.

No live matcher has been enabled pending that decision.

---

## 8. Current boundary — not yet end-to-end

The branch still does **not**:

- activate a V2.4 LISTENING installation into the live V2.3 candidate array;
- ACK a real completed local installation;
- bind a real broker fill through the V2.4-origin path;
- implement exact-account V2.4 fill matching;
- implement partial/fragmented entry lifecycle and authorized-quantity variance;
- implement universal discard retirement / anti-resurrection synchronization;
- implement fast Revise → Re-arm;
- place, modify, cancel, or flatten broker orders.

Therefore a V2.4 internal `ARMED`, handoff `PENDING`/`CLAIMED`, pure `ADMITTED`, `PREPARED`, or dormant `LISTENING` record does not yet create live V2.3 broker-fill ownership.

---

## 9. Next implementation focus

Freeze the execution-event retention rule required for safe sequence-item-8 matching, then implement a pure initial-fill matcher using:

```text
exact authorized account
+ exact symbol
+ correct opening direction
+ authoritative executionTime >= executionListeningAt
```

Only after that matcher is accepted will sequence item 7 be wired live through final admission revalidation, durable listening activation, and ACK.

---

## 10. Documentation rule

`USER-GUIDE.md` remains intentionally unchanged because there is still no accepted end-to-end operator workflow. Approved dated design records remain immutable; this status record tracks current accepted implementation behavior.
