# ExecutionOS V2.4 — Execution Board Handoff Integration
## Implementation Status — 2026-09-02

**Branch:** `v24-execution-board-handoff`  
**Design authority:** `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md`  
**Approved addenda:** Decisions 10–18 in addenda v0.1–v0.8  
**Overall status:** **IN PROGRESS — HANDOFF CONTRACT/DELIVERY, BROKER PROVENANCE, ADMISSION, V2.3 COMPATIBILITY, STABLE RECEIVER IDENTITY, LOCAL INSTALLATION, LOSSLESS INITIAL-FILL OWNERSHIP, DURABLE RETIREMENT, ATOMIC INSTALL/ACK ACTIVATION, AND EXACT-ACCOUNT LIVE LIFECYCLE ACCEPTED; LIVE REACT ROUTING NOT YET ENABLED**

---

## 1. Governing boundary

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

Broker order placement, modification, cancellation, stop replacement, automatic reduction, or automatic flattening remain **NOT AUTHORIZED / NOT IMPLEMENTED**.

---

## 2. Accepted implementation checkpoint

| Work | Status |
|---|---|
| Increment 1 — Immutable handoff contract + persistence | **ACCEPTED** |
| Increment 2 — Claim / delivery state machine | **ACCEPTED** |
| Increment 3 — Exact broker account identity + execution coverage | **ACCEPTED / LIVE-PROVEN** |
| Increment 4 — Server-side handoff transport API | **ACCEPTED / ISOLATED RUNTIME-PROVEN** |
| Sequence item 6 — execution-activity provenance + pure admission gate | **ACCEPTED / LIVE-PROVEN** |
| Sequence item 5 — V2.3 compatibility helpers / provenance model | **ACCEPTED** |
| Sequence item 7 foundation — receiver identity + durable PREPARED/LISTENING persistence | **ACCEPTED** |
| Sequence item 8 first slice — lossless journal + exact-account initial-fill matcher | **ACCEPTED / LIVE-PROVEN** |
| Decision 11/16 — durable pre-fill retirement + anti-resurrection | **ACCEPTED** |
| Decision 17 — atomic LISTENING activation + browser transport/orchestrator | **ACCEPTED** |
| Decision 18 — exact-account V2.4 LIVE lifecycle | **ACCEPTED** |

The accepted runtime pieces are still intentionally not mounted into the continuously running React Execution Board. That final routing step is now the next integration target.

---

## 3. Frozen decisions 10–18

- **Decision 10 — authorization immutability:** V2.4 authorization-bearing fields cannot be edited in place; mutation fails with `V24_AUTHORIZATION_IMMUTABLE`.
- **Decision 11 — universal pre-fill discard/disarm:** pre-fill ownership may be discarded, preserving audit and never altering broker orders.
- **Decision 12 — symbol-global broker cleanliness:** exact authorized account owns the trade; cleanliness is checked across all observable accounts.
- **Decision 13 — authoritative broker timing:** Schwab `executionTime` governs admission and fill ownership; `detectedAt` is audit-only.
- **Decision 14 — stable receiver identity:** each browser/profile owns one durable opaque `executionBoardReceiverId`; sticky claims are never silently migrated.
- **Decision 15 — lossless ownership evidence:** V2.4 ownership uses `executionOwnershipJournal`, never bounded `executions[25]`; coverage loss suspends automatic ownership.
- **Decision 16 — durable retirement cutoff:** fill with `executionTime < cutoffAt` wins; `executionTime >= cutoffAt` cannot bind; incomplete proof requires reconciliation.
- **Decision 17 — atomic LISTENING activation:** proposed `executionListeningAt = T` is chosen only after durable PREPARED readback, broker cleanliness is proven continuously through exact T, LISTENING(T) is durably read back before T becomes effective, and ACK retries preserve exact T.
- **Decision 18 — exact-account LIVE lifecycle:** after first owned fill, every fragmented-entry / ADD / PARTIAL / FLAT / REVERSAL transition uses the frozen execution account, the same uninterrupted lossless-journal interval, authoritative execution time, durable sequence, and broker order identity. Coverage discontinuity becomes `LIVE_RECONCILIATION_REQUIRED` and never releases ownership automatically.

---

## 4. Accepted Decision 18 exact-account LIVE lifecycle

Approved design authority:

- `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v0.8_APPROVED.md`

Runtime:

- `src/execution/execution-v24-live-lifecycle.js`
- upgraded `schwab-bridge/broker-execution-provenance.mjs`
- upgraded `schwab-bridge/broker-execution-ownership-journal.mjs`
- upgraded `schwab-bridge/execution-board-handoff.mjs`
- upgraded `src/execution/execution-v23-compat.js`

Accepted behavior:

- public broker execution provenance carries Schwab `orderId` and stable execution identity when available;
- the lossless ownership journal preserves those identities;
- new real Phase-4 handoffs carry frozen `authorizedMaxDollarRisk` while old/minimal handoffs remain readable;
- first owned fill freezes exact account, `entryOrderId`, coverage interval, first journal sequence, and durable lifecycle cursor;
- same-order expected-direction OPENING increases are `ENTRY_FRAGMENT`, not ADD;
- different-order expected-direction OPENING increases use trusted reducer `ADD` semantics;
- PARTIAL / FLAT / REVERSAL semantics are validated against `trade-state.mjs` rather than trusting display labels;
- wrong-account same-symbol execution after LIVE is diagnostic only and cannot mutate the trade;
- quantity above immutable `selectedQuantity` produces `AUTHORIZED_QUANTITY_EXCEEDED`;
- actual stop risk above frozen ARM-time max-dollar-risk produces `ACTUAL_STOP_RISK_EXCEEDS_AUTHORIZED_BUDGET` without stop mutation or broker write;
- FLAT transitions the original V2.4 trade to EXIT;
- REVERSAL ends the original authorization and records opposite-side exposure without adopting it;
- coverage GAP, changed interval, exact-account authoritative-time regression, missing order identity, or trusted-state contradiction fails closed into `LIVE_RECONCILIATION_REQUIRED`;
- lifecycle cursor persists across reload and prevents duplicate event processing.

Acceptance evidence:

```text
v24:live-lifecycle-test       15/15 PASS
v24:broker-provenance-test   24/24 PASS
v24:fill-ownership-test      24/24 PASS
v24:v23-compat-test          13/13 PASS
v24:v23-install-test         16/16 PASS
v24:handoff-admission-test   16/16 PASS
v24:handoff-test             34/34 PASS
v24:handoff-api-test          7/7 PASS
v24:retirement-test          14/14 PASS
v24:activation-test          20/20 PASS
schwab:state-test            10/10 PASS
production build             PASS
```

---

## 5. Current boundary — not yet end-to-end

The branch still does **not**:

- mount the Decision-17 receiver loop into the live React Execution Board;
- promote a real matched V2.4 first fill into the visible V2.3 LIVE board;
- project the accepted Decision-18 exact-account lifecycle into existing LIVE / EXIT / History UI state;
- implement fast Revise → Re-arm;
- place, modify, cancel, reduce, or flatten broker orders.

Therefore V2.4 remains short of a true live-fill end-to-end test only because the accepted components have not yet been joined into the React runtime path.

---

## 6. Next implementation focus

Design and implement the live React execution router that keeps legacy/manual V2.3 behavior unchanged while routing V2.4-origin records exclusively through the accepted V2.4 activation, first-fill, retirement, and exact-account lifecycle engines.

Target flow:

```text
handoff discovery
→ sticky receiver claim
→ PREPARED
→ final admission through exact T
→ LISTENING(T)
→ ACK
→ exact-account first fill
→ V2.4 LIVE lifecycle
→ existing Execution Board LIVE / EXIT / History projection
```

The router must never expose a V2.4-origin record to the legacy symbol-only / `detectedAt` fill or lifecycle matcher.

---

## 7. Documentation rule

`USER-GUIDE.md` remains intentionally unchanged because there is still no accepted end-to-end operator workflow. Approved dated design records remain immutable; this status record tracks current accepted implementation behavior.
