# ExecutionOS V2.4 — Execution Board Handoff Integration
## Approved Design Addendum v0.9

**Status:** APPROVED / FROZEN  
**Date:** 2026-09-02  
**Branch:** `v24-execution-board-handoff`  
**Parent authority:** handoff baseline v0.1 plus approved addenda v0.1–v0.8  
**Decision:** 19 — One durable Execution Board store authority

---

## Decision 19 — One durable Execution Board store authority

### Frozen invariant

> **The Execution Board has exactly one durable store authority. React component state is a projection of that store and may never overwrite it from a stale full-state snapshot. All legacy/manual and V2.4 activation, retirement, fill-promotion, lifecycle, EXIT, and History mutations execute as read-latest → mutate → exact-persist/readback transactions through the same repository. The repository preserves all legacy and V2.4 namespaces and a monotonic store revision. Unifying persistence does not unify execution semantics: V2.4-origin records remain exclusively routed through exact-account V2.4 ownership logic, while legacy/manual V2.3 behavior remains unchanged.**

### Canonical store

The durable local Execution Board store remains under the existing key:

```text
execution-v23-store
```

The canonical repository preserves at minimum:

```text
storeRevision

draft
candidates
liveTrades
history
view
notice

v24Installations
v24Retirements
v24Lifecycles
```

Unknown forward-compatible fields must not be discarded merely because an older UI projection does not understand them.

### Transaction rule

Every durable mutation follows:

```text
read latest durable store
→ validate / normalize canonical namespaces
→ apply one mutation to latest state
→ increment monotonic storeRevision
→ write complete canonical store
→ exact durable readback
→ publish the committed snapshot
```

A caller may never serialize and overwrite the durable store from an older React/component snapshot.

Persistence/readback failure fails closed with the existing local execution persistence failure semantics. Best-effort rollback may restore the prior serialized store, but a failed transaction is never reported as committed.

### React ownership

React is a projection/subscriber, not storage authority.

UI actions must transact against the latest repository state and render the returned committed snapshot. Repository-originated V2.4 activation, retirement, ownership, or lifecycle mutations must be publishable back to the same React projection without requiring a stale UI rewrite.

Cross-document browser storage notifications may refresh the projection, but they do not change the execution ownership rules.

### V2.4 persistence migration

The V2.4 local installation, retirement, and LIVE lifecycle helpers must use the same canonical repository rather than maintaining separate private parse/write implementations.

This includes:

- PREPARED / LISTENING installation state;
- pre-fill retirement state;
- durable LIVE lifecycle cursor state;
- future first-fill promotion and UI/History projection mutations.

### Store revision

`storeRevision` is a monotonic non-negative integer.

A successful durable mutation increments the latest committed revision exactly once. The revision is persistence provenance only; it does not replace candidate contract versions, handoff versions, DSS/risk identities, lifecycle journal sequence, or broker execution provenance.

### Execution routing remains split

Unifying the store does not allow fallback between execution engines:

```text
LEGACY_MANUAL_V23
→ existing legacy/manual broker lifecycle semantics

V24_HANDOFF
→ exact authorized account
  + lossless ownership journal
  + authoritative executionTime
  + Decision-18 lifecycle
```

A V2.4 record may never enter the legacy symbol-only / detectedAt matcher merely because both generations are persisted in one store.

### No broker writes

Decision 19 changes local persistence authority only. It authorizes no broker order placement, modification, cancellation, replacement, reduction, or flattening.
