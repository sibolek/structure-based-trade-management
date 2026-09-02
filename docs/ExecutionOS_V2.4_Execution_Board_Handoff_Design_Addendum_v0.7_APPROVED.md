# ExecutionOS V2.4 — Execution Board Handoff Integration
## Approved Design Addendum v0.7

**Status:** APPROVED / FROZEN  
**Date:** 2026-09-02  
**Branch:** `v24-execution-board-handoff`  
**Parent authority:** handoff baseline v0.1 plus approved addenda v0.1–v0.6  
**Decision:** 17 — Atomic LISTENING activation boundary

---

## Decision 17 — Atomic LISTENING activation boundary

### Frozen invariant

> **`executionListeningAt` is first captured as a proposed activation cutoff only after durable PREPARED readback. Broker coverage and admission must prove the authorization clean continuously through that exact cutoff before LISTENING may be persisted. The cutoff becomes effective only after exact durable LISTENING readback. Broker executions with authoritative `executionTime >= executionListeningAt` may then be owned, including executions occurring during the LISTENING write/readback window. If LISTENING persistence fails, the proposed cutoff never becomes effective. ACK must use the exact persisted cutoff and may be retried idempotently without changing broker-fill ownership.**

### Activation order

```text
handoff discovery
→ sticky receiver claim
→ initial admission check
→ PREPARED durable persistence
→ exact PREPARED readback
→ capture proposed executionListeningAt = T
→ wait until broker coverage proves through T
→ final admission revalidation with requiredThrough = T
→ persist LISTENING with exact T
→ exact LISTENING readback
→ ACK exact T
```

The initial admission check avoids reserving obviously dirty or conflicting handoffs. The final admission check is authoritative for activation and must use the exact proposed boundary.

### Proposed boundary

The proposed boundary is not broker-fill ownership. It may exist only in transient receiver memory while waiting for broker coverage to advance through it.

A receiver reload while still PREPARED may discard the old proposal and choose a new proposed boundary, because no boundary becomes authoritative until LISTENING is durably persisted and read back.

The receiver must not continuously replace the proposed boundary on every broker poll; it holds one proposal long enough for broker coverage to catch up.

### Persistence failure

If LISTENING persistence or exact readback fails:

```text
proposed T
→ persistence/readback failure
→ PREPARED remains authoritative
→ T never becomes effective
→ no V2.4 fill ownership begins
```

A later retry chooses a fresh proposed boundary and performs a fresh final admission proof.

### ACK failure

Once LISTENING with exact T is durably persisted and exactly read back, T is authoritative even if the transport ACK fails.

```text
LISTENING(T) durable
→ ACK unavailable/fails
→ local broker-fill ownership remains active from T
→ retry ACK with the exact same T
```

No replacement timestamp is permitted on ACK retry.

### Restart behavior

```text
PENDING
→ claim and continue

CLAIMED only
→ resume installation

PREPARED
→ choose fresh proposed T
→ final revalidate again

LISTENING but server still CLAIMED
→ preserve original T
→ retry ACK exact T

DELIVERED with matching local LISTENING
→ normal delivered state

server DELIVERED but local installation missing
→ DELIVERED_HANDOFF_MISSING_LOCALLY
→ explicit reconciliation; no automatic recreation
```

### Final-admission failure after PREPARED

If final admission fails after the local PREPARED reservation already exists, the local reservation must be terminally retired before symbol ownership is released. The immutable handoff is then server-side BLOCKED with the exact admission reason. The local retirement is audit provenance and does not rewrite handoff-delivery history.

### No broker writes

Decision 17 authorizes no broker order placement, modification, cancellation, replacement, or flattening. It defines only the downstream execution-listening ownership boundary and transport acknowledgement semantics.
