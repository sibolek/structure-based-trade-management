# ExecutionOS V2.4 — Execution Board Handoff Integration
## Design Addendum v0.4 — APPROVED

**Date:** 2026-09-02  
**Branch:** `v24-execution-board-handoff`  
**Parent authorities:** Handoff Integration Design Baseline v0.1 and approved addenda v0.1–v0.3  
**Status:** **APPROVED — DECISION 14 FROZEN**

---

## 1. Decision 14 — Stable Execution Board receiver identity

### 1.1 Approved invariant

> **Each browser profile running the V2.3 Execution Board owns one stable opaque `executionBoardReceiverId`, generated once with a cryptographically strong UUID source and persisted independently of mutable trade state. The same identity is reused across ordinary page reloads and browser restarts. Clearing or losing the receiver-identity storage creates a new receiver; old sticky claims are never silently transferred or reconstructed.**

The receiver identity is transport/ownership provenance. It is not a broker account identifier and it does not itself begin broker-fill ownership.

### 1.2 Dedicated persistence

The browser receiver identity is stored separately from the mutable V2.3 execution store.

Canonical storage key:

```text
executionos-v23-receiver-id
```

The existing trade-state key remains separate:

```text
execution-v23-store
```

Arming, editing, discarding, completing, clearing, or migrating trade-state records must not rotate the receiver identity.

### 1.3 Generation and readback

On first use:

```text
no receiver identity
    ↓
crypto.randomUUID()
    ↓
persist dedicated key
    ↓
read back exact value
    ↓
receiver ready
```

If stable storage is unavailable, the generated identity cannot be durably read back, or the stored value cannot be trusted, the receiver must fail closed rather than operate with an ephemeral identity.

### 1.4 Sticky claim recovery

A receiver may discover:

- unclaimed `PENDING` handoffs; and
- `CLAIMED` handoffs whose `claimedBy` exactly equals its stable receiver ID.

A different browser/profile may not steal or adopt another receiver's sticky claim.

If a handoff is permanently claimed to receiver A but receiver A's browser storage is lost, receiver B must not assume receiver A's identity. Existing recovery rule applies:

```text
CLAIMED_HANDOFF_RECEIVER_UNAVAILABLE
```

Recovery requires explicit reconciliation or a fresh V2.4 authorization/handoff as already governed by the handoff design.

### 1.5 Distinct ownership timestamps

The following remain separate:

```text
claimedAt
    = permanent receiver assignment

executionListeningAt
    = later downstream broker-fill ownership boundary
```

Creating or recovering a receiver ID and claiming a handoff do not establish `executionListeningAt`.

### 1.6 UI / security behavior

The receiver ID is not normally user-editable. It may be exposed in diagnostic/audit views if useful, but ordinary trade controls must not allow replacing it.

### 1.7 Broker-write boundary

Nothing in Decision 14 authorizes broker writes. The Schwab/TOS integration remains read-only.

---

## 2. Approval

Decision 14 was approved by the user on 2026-09-02 and is frozen by this addendum.
