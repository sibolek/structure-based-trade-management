# ExecutionOS V2.4 — Execution Board Handoff Integration
## Approved Design Addendum v0.5

**Status:** APPROVED / FROZEN  
**Date:** 2026-09-02  
**Branch:** `v24-execution-board-handoff`  
**Parent authority:** handoff baseline v0.1 plus approved addenda v0.1–v0.4  
**Decision:** 15 — Lossless execution-event evidence for V2.4 broker-fill ownership

---

## Decision 15 — Lossless execution journal for ownership

### Frozen invariant

> **V2.4 broker-fill ownership may use only lossless execution-event evidence from the candidate's proven contiguous listening interval. The bounded recent-executions UI list is never ownership authority. A coverage gap after `executionListeningAt` suspends automatic ownership and requires explicit reconciliation; successful polling after the gap does not silently restore auto-eligibility.**

### Separation of broker execution data roles

ExecutionOS maintains three distinct broker-execution views with different authority:

```text
executions[25]
    = bounded dashboard / human-inspection display only

executionActivity
    = lossless account+symbol latest-execution watermark used to prove admission cleanliness

executionOwnershipJournal
    = lossless execution-event evidence used for V2.4 fill ownership and lifecycle reconstruction
```

The bounded recent-execution array may never be substituted for either safety proof or fill-ownership evidence.

### Ownership-journal interval

The ownership journal is scoped to the monitor's current contiguous Schwab execution-coverage interval.

It records every observed broker execution in that interval with the execution facts required by downstream ownership, including at minimum:

```text
accountId
symbol
instruction
positionEffect
quantity
price
executionTime
detectedAt
stateEvent
previousQuantity
nextQuantity
```

`executionTime` remains authoritative event time under Decision 13. `detectedAt` remains audit/latency provenance only.

Events whose authoritative `executionTime` predates the current coverage interval are baseline/history observations and are not retained as current-interval ownership evidence.

### Coverage loss after LISTENING

For a V2.4 candidate whose immutable `executionListeningAt` has already been established:

```text
LISTENING
    ↓
broker execution coverage becomes GAP
    ↓
automatic fill ownership is suspended
```

A later successful broker poll starts a new contiguous coverage interval but does **not** restore automatic matching for the old authorization.

If the current coverage interval begins after that candidate's `executionListeningAt`, the system cannot prove complete execution-event observation from the listening boundary and must fail closed as a coverage-gap/reconciliation condition.

No later fill may silently bind to that old authorization merely because monitoring recovered.

### Initial-fill eligibility

During an uninterrupted proven listening interval, the first V2.4-owned broker fill must satisfy all of the existing frozen ownership rules:

```text
exact authorizedExecutionAccountId
+ exact symbol
+ correct opening instruction for direction
+ positionEffect = OPENING
+ executionTime >= executionListeningAt
```

For LONG, the expected opening instruction is `BUY`.
For SHORT, the expected opening instruction is `SELL_SHORT`.

A qualifying partial first fill makes the trade LIVE immediately; `selectedQuantity` remains the immutable authorized initial-position ceiling, not a required first-fill quantity.

### Wrong-account activity

Decision 7 remains authoritative:

- a same-symbol execution on another account is never adopted;
- if such an execution is observed before an eligible authorized-account first fill, automatic eligibility is lost with `WRONG_ACCOUNT_EXECUTION_OBSERVED`;
- a later correct-account execution may not silently rescue that still-unfilled authorization;
- after a correct-account first fill has already established V2.3 ownership, later broker lifecycle processing remains scoped to the frozen execution account and is handled by the downstream lifecycle rules.

### Unexpected authorized-account activity

Before an eligible first opening fill is owned, same-symbol activity on the authorized account that does not satisfy the exact opening contract is not skipped in search of a later matching fill. It is an ambiguous broker-state change and must fail closed rather than allowing delayed accidental ownership.

### No broker writes

Decision 15 adds observation/provenance requirements only. It authorizes no order placement, modification, cancellation, replacement, or flattening.

---

## Implementation consequence

Sequence item 8 must consume `executionOwnershipJournal`, never `brokerState.executions`, for V2.4 first-fill matching and subsequent exact-account lifecycle processing.

Activation of the real V2.4 local installation/ACK path remains gated on accepted exact-account ownership matching so a newly installed V2.4 candidate cannot fall through to the legacy V2.3 symbol-only / `detectedAt` matcher.
