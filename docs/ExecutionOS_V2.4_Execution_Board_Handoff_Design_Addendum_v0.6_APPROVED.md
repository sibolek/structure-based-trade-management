# ExecutionOS V2.4 — Execution Board Handoff Integration
## Approved Design Addendum v0.6

**Status:** APPROVED / FROZEN  
**Date:** 2026-09-02  
**Branch:** `v24-execution-board-handoff`  
**Parent authority:** handoff baseline v0.1 plus approved addenda v0.1–v0.5  
**Decision:** 16 — Durable pre-fill retirement cutoff and anti-resurrection

---

## Decision 16 — Durable retirement cutoff

### Frozen invariant

> **A pre-fill discard freezes an immediate broker-event eligibility cutoff. ExecutionOS finalizes retirement only after continuous broker coverage proves the interval through that cutoff. An eligible fill whose authoritative `executionTime` precedes the cutoff wins and becomes LIVE; absence of such a fill finalizes RETIRED and releases symbol ownership; insufficient coverage requires explicit reconciliation. Retirement is persisted separately from immutable handoff-delivery history and can never be undone by reload, redelivery, or later execution discovery.**

### Cutoff semantics

When the operator discards a V2.4-origin pre-fill listener, ExecutionOS freezes one immutable `cutoffAt` / `discardRequestedAt` timestamp.

Broker-event eligibility is then:

```text
executionTime < cutoffAt   → may still establish prior fill ownership
executionTime >= cutoffAt  → ineligible for this retired authorization
```

`executionTime` remains authoritative under Decision 13. `detectedAt` remains audit provenance only.

### Durable retirement record

Retirement lifecycle is persisted independently from immutable handoff delivery:

```text
executionBoardRetirement {
  schemaVersion
  retirementId
  handoffId
  receiverId
  symbol
  executionListeningAt
  requestedAt
  cutoffAt
  reason
  status
  finalizedAt
  priorFill
}
```

Required statuses:

```text
REQUESTED
RETIRED
SUPERSEDED_BY_PRIOR_FILL
RECONCILIATION_REQUIRED
```

`REQUESTED` freezes the cutoff immediately and remains symbol-owning until resolution.

### Resolution rules

For a LISTENING authorization:

1. Broker state must remain healthy and the lossless ownership journal must prove one uninterrupted interval beginning no later than `executionListeningAt` and extending through `cutoffAt`.
2. Search only the exact account + symbol + expected opening direction in the lossless ownership journal using authoritative `executionTime`.
3. If an eligible first fill has `executionTime < cutoffAt`, the discard loses the race and retirement becomes `SUPERSEDED_BY_PRIOR_FILL`. The broker fill owns the trade and downstream promotion must become LIVE.
4. If no eligible fill exists before the cutoff and coverage proves through the cutoff, retirement becomes `RETIRED` and local symbol ownership is released.
5. If the listening interval cannot be proved through the cutoff, retirement becomes `RECONCILIATION_REQUIRED`; symbol ownership remains reserved and no fresh authorization may silently replace it.

A qualifying event at exactly `cutoffAt` is ineligible because the discard cutoff is effective immediately at that timestamp.

### PREPARED but not LISTENING

A durable PREPARED installation has not yet begun broker-fill ownership. Discard may therefore finalize directly to `RETIRED` without broker-event reconciliation, while preserving the immutable installation/handoff audit record.

### Anti-resurrection

Once `RETIRED`:

- the same handoff may not be prepared or rebound to LISTENING;
- reload may not restore broker-fill eligibility;
- a later ACK/redelivery retry may not reactivate the listener;
- later broker executions may not bind to the retired handoff;
- local symbol ownership is released;
- re-entry requires a fresh Phase 4 evaluation, new ARM authorization, and new handoff.

`REQUESTED` and `RECONCILIATION_REQUIRED` remain ownership-reserving and fail closed.

`SUPERSEDED_BY_PRIOR_FILL` is not a successful discard. It preserves ownership for downstream LIVE promotion.

### Delivery-history separation

A retirement record does not rewrite a previously immutable `DELIVERED` handoff record. Delivery answers whether the exact handoff was durably installed/acknowledged; retirement answers whether the downstream pre-fill listener later remained eligible.

For a not-yet-delivered claimed handoff, the transport may still be terminally blocked through the existing delivery state machine where appropriate, but post-delivery retirement remains separate execution-lifecycle provenance.

### Broker-write boundary

Discard retires the ExecutionOS listener only. It does not place, cancel, modify, replace, or flatten any broker order or position.

The operator warning remains:

> **ExecutionOS listener discarded. Broker orders, if any, are unchanged.**
