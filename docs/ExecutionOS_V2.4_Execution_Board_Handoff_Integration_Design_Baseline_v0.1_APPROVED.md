# ExecutionOS V2.4 — Execution Board Handoff Integration

## Approved Design Baseline

**Version:** 0.1  
**Status:** APPROVED — IMPLEMENTATION AUTHORIZED  
**Date:** 2026-09-02  
**Project:** `sibolek/structure-based-trade-management`  
**Implementation branch:** `v24-execution-board-handoff`  
**Branch base:** `main @ a0846e5232f9737faa0085871e381d989bdfd2c8`  
**Relationship to V2.4:** Bridges already-authorized internal V2.4 `ARMED` state into the existing V2.3 Execution Board.  
**Broker-write authority:** NONE.

---

# 1. Purpose

This integration connects the V2.4 pre-trade authorization layer to the trusted V2.3 Execution Board without duplicating broker-fill ownership logic, weakening account/symbol ownership rules, or changing Phase 3/4 stop and risk authority.

Canonical flow:

```text
V2.4 candidate
      ↓
permission / DSS / risk
      ↓
internal V2.4 ARMED authorization
      ↓
immutable ExecutionBoardHandoff
      ↓
controlled delivery protocol
      ↓
existing V2.3 Execution Board
      ↓
broker-fill ownership
      ↓
LIVE / ADD / PARTIAL / FLAT / REVERSAL
      ↓
History
```

Governing principle:

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

---

# 2. Authority Boundaries

| Concern | Authority |
|---|---|
| Structural invalidation | V2.4 candidate / structure evaluation |
| Effective stop | Phase 3 DSS |
| Maximum affordable quantity | Phase 4 risk sizing |
| Selected authorized quantity | V2.4 ARM authorization |
| Authorized execution account | Exact Phase 4 risk-evaluation account |
| Handoff transport | Execution Board handoff layer |
| Broker-fill matching | Existing V2.3 Execution Board |
| Actual position state | Broker |
| ADD / PARTIAL / FLAT / REVERSAL | Existing V2.3 execution lifecycle |
| History | Existing execution layer |

No handoff component may recalculate or replace the Phase 3 effective stop or Phase 4 authorization provenance.

---

# 3. Decision 1 — Immutable, Acknowledged Handoff

Every successful internal V2.4 ARM produces one immutable `ExecutionBoardHandoff` identified by a unique `handoffId`.

Conceptual contract:

```text
ExecutionBoardHandoff {
    handoffId

    sourceId
    candidateId
    contractVersion
    candidateContentHash

    symbol
    direction
    setup
    timeframe
    thesis
    trigger
    targets
    managementPlan

    structuralInvalidation
    effectiveStop

    currentExpectedEntry
    selectedQuantity
    authorizedExecutionAccountId

    dssEvaluationId
    riskEvaluationId

    authorizedAt
    createdAt
}
```

The handoff payload is immutable. Claim/delivery state is persisted separately.

Delivery must be acknowledged only after the receiving Execution Board has durably installed and verified the exact contract.

---

# 4. Decision 2 — Broker Ownership Begins at Execution Board Installation

Preserve two distinct timestamps:

```text
authorizedAt
    = V2.4 authorization/provenance

executionListeningAt
    = start of V2.3 broker-fill ownership
```

Permanent invariant:

> **No broker fill may be claimed retroactively from V2.4 authorization time.**

Only fills occurring after successful verified Execution Board installation may bind to the candidate.

---

# 5. Decision 3 — Clean Broker Interval Required

Before installation, the receiver must establish a provably clean broker interval from `authorizedAt` through installation.

Required:

1. broker monitor healthy;
2. exact authorized account available;
3. no current non-zero position in the symbol;
4. no same-symbol broker execution since `authorizedAt`;
5. execution-history coverage sufficient to prove the preceding condition.

Initial failure reasons:

```text
EXISTING_POSITION_AT_HANDOFF
INTERVENING_BROKER_ACTIVITY
BROKER_STATE_UNAVAILABLE
BROKER_EXECUTION_COVERAGE_GAP
```

An existing apparently matching position is never automatically adopted.

A failed/uncertain handoff is not held indefinitely for later automatic retry. A later attempt requires fresh V2.4 authorization and a new handoff.

---

# 6. Decision 4 — One Active Execution Owner per Symbol

If V2.3 already owns any nonterminal candidate/trade for the symbol, an incoming V2.4 handoff may not be installed.

Ownership includes:

- armed/listening candidate;
- handed-off candidate already listening;
- candidate being edited;
- LIVE trade;
- trade awaiting exit classification.

Failure:

```text
EXECUTION_SYMBOL_OWNERSHIP_CONFLICT
```

No overwrite, merge, substitution, queueing, or delayed replay is permitted.

---

# 7. Decision 5 — Preserve Structural Invalidation and Effective Stop Separately

For V2.4-originated trades:

```text
structuralInvalidation
    = thesis-invalidating structure

effectiveStop
    = immutable Phase 3 protective execution/risk stop
```

V2.3 must use `effectiveStop` for planned and actual stop-risk calculations.

Legacy/manual V2.3 records remain compatible through:

```text
executionStop(trade)
    V2.4-originated → effectiveStop
    legacy/manual   → structuralStop
```

V2.3 may not recompute, substitute, or tighten the V2.4 effective stop.

---

# 8. Decision 6 — Authorized Quantity vs Actual Broker Quantity

`selectedQuantity` is the immutable authorized initial-position ceiling, not a required individual execution-leg size.

The first eligible partial/fragmented opening fill makes the trade LIVE immediately.

Examples:

```text
Authorized 30
Fill 10 → LIVE, actual 10
Fill +8 → actual 18
Fill +12 → actual 30
```

If actual broker exposure exceeds authorization:

```text
AUTHORIZED_QUANTITY_EXCEEDED
```

and, where applicable:

```text
ACTUAL_STOP_RISK_EXCEEDS_AUTHORIZED_BUDGET
```

The Execution Board continues tracking the full real broker position. It may not rewrite `selectedQuantity`, tighten the stop, or automatically trade the excess.

---

# 9. Decision 7 — Exact Broker-Account Ownership

The handoff carries the exact opaque account identity from the fresh ARM-time Phase 4 risk evaluation:

```text
authorizedExecutionAccountId
```

A V2.4 candidate may bind only to fills from this exact account.

No fallback to:

- first account;
- masked account suffix;
- another account with sufficient equity;
- another authorized Schwab account.

Same-symbol execution in another account is never adopted and produces:

```text
WRONG_ACCOUNT_EXECUTION_OBSERVED
```

Once this ambiguity occurs, the candidate may not silently remain eligible to claim a later intended-account fill.

The broker UI API must expose stable opaque `accountId` values on accounts, positions, and executions while retaining masked display labels separately.

---

# 10. Decision 8 — Idempotent Installation and Durable ACK

Because V2.4 state is server-side while V2.3 armed candidates are currently browser-persisted, cross-domain delivery uses:

> **at-least-once transport + idempotent receiver + durable acknowledgment**

The receiving board must:

1. check `handoffId` locally;
2. construct the V2.3 candidate;
3. persist it;
4. read it back;
5. verify exact immutable provenance;
6. establish `executionListeningAt`;
7. ACK the handoff.

Failure to persist/verify:

```text
LOCAL_EXECUTION_PERSISTENCE_FAILED
```

If a restart finds the exact `handoffId` already installed with matching content, it must not duplicate it; it may safely retry ACK.

Content mismatch:

```text
HANDOFF_ID_CONTENT_CONFLICT
```

ACK is idempotent when metadata match. Conflicting ACK metadata fail:

```text
HANDOFF_ACK_CONTENT_CONFLICT
```

A `DELIVERED` handoff is never automatically replayed merely because later local state is missing:

```text
DELIVERED_HANDOFF_MISSING_LOCALLY
```

---

# 11. Decision 9 — One Stable Receiver Claim per Handoff

Before local installation, a handoff must be atomically claimed by one stable opaque:

```text
executionBoardReceiverId
```

Claim freezes:

```text
claimedBy
claimedAt
```

The claim is sticky; it is not an expiring lease.

A different receiver may not automatically take over a claimed handoff.

Claiming does **not** begin broker-fill ownership. `executionListeningAt` is established only after verified local installation.

If a claimed receiver is permanently unavailable:

```text
CLAIMED_HANDOFF_RECEIVER_UNAVAILABLE
```

Recovery normally requires abandoning the old authorization and producing a fresh authorization/new handoff.

Permanent invariant:

> **One handoff may produce at most one Execution Board owner.**

---

# 12. Delivery State Machine

Authoritative handoff-delivery state:

```text
PENDING
   │
   └── atomic receiver claim
             ↓
          CLAIMED
          /     \
         /       \
 successful       safety / integrity failure
 install + ACK             ↓
       ↓                 BLOCKED
   DELIVERED
```

`DELIVERED` and `BLOCKED` are terminal for the exact handoff.

No automatic transition back to `PENDING` and no automatic replay are permitted.

---

# 13. Broker Monitor Contract Upgrade

The public broker state must expose opaque machine identity in addition to display labels:

```text
account: {
    accountId,
    accountDisplay
}

position: {
    accountId,
    accountDisplay,
    ...
}

execution: {
    accountId,
    accountDisplay,
    ...
}
```

It must also expose sufficient execution-coverage provenance for the clean-interval gate, conceptually:

```text
coverageStartedAt
baselineCompletedAt
currentThrough
coverageStatus
```

The raw brokerage account number need not be exposed to the browser.

---

# 14. V2.4-Originated Fill Matching

Conceptual eligibility:

```text
eligible fill =
    exact authorized account
    AND exact symbol
    AND correct opening direction
    AND execution time >= executionListeningAt
```

Once the first eligible fill binds, the existing V2.3 lifecycle owns the trade and remains authoritative for subsequent broker-state evolution.

---

# 15. V2.3 Backward Compatibility

Existing manual/legacy V2.3 records must remain loadable and operational.

Compatibility should be introduced through narrow helpers/optional provenance rather than destructive migration, for example:

```text
executionStop(trade)
executionAccountId(trade)
authorizedQuantity(trade)
```

The trusted V2.3 lifecycle is changed only where necessary to support deterministic V2.4 handoff/account ownership.

---

# 16. Failure Taxonomy

Initial integration reason codes:

```text
EXISTING_POSITION_AT_HANDOFF
INTERVENING_BROKER_ACTIVITY
BROKER_STATE_UNAVAILABLE
BROKER_EXECUTION_COVERAGE_GAP

EXECUTION_SYMBOL_OWNERSHIP_CONFLICT

AUTHORIZED_EXECUTION_ACCOUNT_UNAVAILABLE
WRONG_ACCOUNT_EXECUTION_OBSERVED

LOCAL_EXECUTION_PERSISTENCE_FAILED
HANDOFF_ID_CONTENT_CONFLICT
HANDOFF_ACK_CONTENT_CONFLICT
DELIVERED_HANDOFF_MISSING_LOCALLY
CLAIMED_HANDOFF_RECEIVER_UNAVAILABLE

AUTHORIZED_QUANTITY_EXCEEDED
ACTUAL_STOP_RISK_EXCEEDS_AUTHORIZED_BUDGET
```

These are handoff/execution-ownership outcomes, not Phase 4 risk statuses and not permission `PASS` results.

---

# 17. Broker-Write Boundary

This integration may not:

- place broker orders;
- modify broker orders;
- cancel broker orders;
- replace stops;
- flatten positions;
- automatically correct oversize.

The broker boundary remains read-only.

---

# 18. Implementation Sequence

Approved implementation sequence:

1. handoff contract + immutable persistence;
2. claim/delivery state machine;
3. broker API account identity + coverage provenance;
4. server handoff endpoints;
5. V2.3 compatibility helpers / provenance model;
6. pre-install safety gates;
7. idempotent local installation + ACK;
8. exact-account fill matching;
9. quantity-variance handling;
10. UI exposure;
11. focused integration tests;
12. full Phase 3/4 + V2.3 regression;
13. synthetic dashboard end-to-end test;
14. documentation + closeout.

---

# 19. Final Governing Invariants

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

> **Phase 3's effective stop crosses the boundary unchanged.**

> **Phase 4's selected quantity and exact account provenance cross the boundary unchanged.**

> **Broker-fill ownership begins only after verified Execution Board installation.**

> **No retroactive ownership.**

> **One symbol, one active execution owner.**

> **One handoff, one receiver.**

> **Actual broker exposure is never orphaned, but deviations never rewrite authorization history.**

> **Uncertainty at an ownership boundary fails closed.**
