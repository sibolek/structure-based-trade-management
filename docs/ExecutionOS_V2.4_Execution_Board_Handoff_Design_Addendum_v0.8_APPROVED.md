# ExecutionOS V2.4 — Execution Board Handoff Integration
## Approved Design Addendum v0.8

**Status:** APPROVED / FROZEN  
**Date:** 2026-09-02  
**Branch:** `v24-execution-board-handoff`  
**Parent authority:** handoff baseline v0.1 plus approved addenda v0.1–v0.7  
**Decision:** 18 — Exact-account V2.4 LIVE lifecycle

---

## Decision 18 — Exact-account V2.4 LIVE lifecycle

### Frozen invariant

> **After a V2.4 first fill establishes LIVE ownership, the exact execution account is permanently frozen for that trade. All subsequent fragmented-entry, ADD, PARTIAL, FLAT, and REVERSAL processing must consume lossless execution-journal events from that exact account and the same uninterrupted coverage interval, ordered by authoritative `executionTime` and durable journal sequence. Initial-entry fragments are distinguished from later ADDs by broker order provenance, never by elapsed-time heuristics. A broker coverage discontinuity after LIVE does not release ownership or infer lifecycle from current position; it places the trade into `LIVE_RECONCILIATION_REQUIRED` until explicitly reconciled. Legacy/manual V2.3 lifecycle behavior remains unchanged.**

### Exact-account lifecycle ownership

The account frozen by the Phase 4 authorization and confirmed by the first owned fill remains the only broker account allowed to mutate the V2.4 trade lifecycle.

A same-symbol execution in another account after LIVE ownership is never adopted. It is retained as diagnostic provenance (`WRONG_ACCOUNT_EXECUTION_OBSERVED`) but cannot ADD to, partially close, flatten, or reverse the owned trade.

### Broker order provenance

Schwab execution provenance must retain stable broker order identity and execution identity (`orderId` and execution key/provenance) in the lossless ownership journal.

The first owned fill freezes `entryOrderId`.

Subsequent expected-direction OPENING fills from the same exact account, symbol, and `entryOrderId` are `ENTRY_FRAGMENT` events even though the trusted position reducer classifies the position increase as ADD.

An expected-direction OPENING fill from a different broker order whose trusted state transition is ADD is a genuine `ADD`.

No elapsed-time heuristic may be used to distinguish an entry fragment from an ADD.

### Trusted V2.3 state-transition semantics

Decision 18 reuses the existing deterministic broker state reducer semantics:

```text
flat → position               ENTRY
same side, quantity increases ADD
same side, quantity decreases PARTIAL
position → flat               FLAT
side changes                  REVERSAL
```

For V2.4, those semantics are scoped to the frozen exact account and symbol and are driven only by lossless execution-journal events.

### Entry fragments and quantity authority

A qualifying partial first fill establishes LIVE immediately.

Further fills from the same `entryOrderId` update actual entry quantity and weighted actual entry price but do not rewrite immutable `selectedQuantity`.

Actual exposure above the authorized initial-position ceiling remains owned and produces `AUTHORIZED_QUANTITY_EXCEEDED` provenance. No automatic reduction and no stop tightening are authorized.

### Risk variance

The Phase 3 `effectiveStop` remains execution-stop authority. Actual stop risk is calculated from actual broker average fill/position quantity to `effectiveStop`.

When exact ARM-time Phase 4 max-dollar-risk provenance is available downstream, actual stop risk above that frozen budget produces `ACTUAL_STOP_RISK_EXCEEDS_AUTHORIZED_BUDGET`. The warning never authorizes changing the stop or performing a broker write.

### PARTIAL / FLAT / REVERSAL

Exact-account closing executions update quantity and exit provenance using the trusted reducer.

- `PARTIAL`: trade remains LIVE with reduced quantity.
- `FLAT`: original V2.4 trade transitions to EXIT and awaits the existing operator exit-classification workflow.
- `REVERSAL`: original V2.4 trade transitions to EXIT. The opposite-side broker exposure is not silently adopted into the original authorization.

### LIVE coverage discontinuity

Once LIVE ownership exists, any loss of continuous broker execution coverage fails closed differently from a pre-fill gap:

```text
LIVE
  ↓
coverage discontinuity / interval replacement
  ↓
LIVE_RECONCILIATION_REQUIRED
```

The trade remains owned and the symbol remains reserved. Current broker position may be displayed as observational information, but missing lifecycle events may not be reconstructed from position alone. Successful polling after the gap does not silently resume the old lifecycle cursor.

### Durable lifecycle cursor

The V2.4 LIVE record persists at minimum:

```text
executionAccountId
entryOrderId
coverageStartedAt
firstOwnedSequence
lastProcessedSequence
firstExecutionTime
lastProcessedExecutionTime
currentQuantity
peakQuantity
entryQuantity
entryVwap
status
warnings[]
```

A reload may resume only when the journal still belongs to the same continuous coverage interval. A changed `coverageStartedAt` requires reconciliation.

### No broker writes

Decision 18 authorizes no order placement, modification, cancellation, replacement, reduction, or flattening.
