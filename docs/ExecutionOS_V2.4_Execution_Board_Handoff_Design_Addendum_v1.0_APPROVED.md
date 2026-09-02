# ExecutionOS V2.4 — Execution Board Handoff Design Addendum v1.0
## APPROVED — Decision 20: Serialized Runtime Router + Atomic Ownership Transfer

**Date:** 2026-09-02  
**Status:** APPROVED / FROZEN  
**Applies to:** ExecutionOS V2.4 Execution Board Handoff Integration  
**Supersedes:** none; this addendum extends Decisions 10–19.

---

## Decision 20

ExecutionOS shall run exactly one serialized top-level V2.4 runtime router for the lifetime of the application. The router is independent of which workspace is visible and consumes the continuously refreshed broker state plus the V2.4 handoff transport.

The router owns orchestration only. It does not place, modify, cancel, reduce, replace, or flatten broker orders.

### Frozen invariant

> **ExecutionOS shall run exactly one serialized top-level V2.4 runtime router. The router processes activation, retirement, first-fill ownership, and LIVE lifecycle exclusively from the latest canonical store and current broker provenance. A PREPARED/LISTENING installation reserves its symbol only until an exact-account first fill is atomically committed as both a durable V2.4 LIVE lifecycle and a V2.4-origin LIVE Execution Board projection. At that commit the immutable installation becomes provenance-only and may never continue reserving the symbol. LIVE, LIVE_RECONCILIATION_REQUIRED, and unclassified EXIT records retain symbol ownership; ownership is released only when the completed trade moves to History, while all handoff, installation, lifecycle, and history provenance remains durable. V2.4 pre-fill authorizations are displayed separately from legacy candidates and may be discarded only through the approved retirement protocol. V2.4 records are never routed through legacy symbol-only or detectedAt execution logic. No broker writes are authorized.**

---

## 1. Router placement and serialization

The router is mounted at the application level, alongside the existing continuously refreshed broker and pre-trade connections. It continues operating while either PRETRADE or EXECUTION workspace is hidden.

Only one router cycle may mutate V2.4 execution state at a time. Discovery envelopes are processed serially in deterministic server order. Every durable mutation starts from the latest canonical Execution Board store under Decision 19.

---

## 2. Decision-17 boundary retention

For a PREPARED handoff, the router may hold one in-memory proposed `executionListeningAt = T` while waiting for broker coverage to prove through T.

- ordinary subsequent broker polls reuse the same proposed T;
- T does not become authoritative until durable LISTENING readback;
- browser reload before LISTENING may select a fresh T under Decision 17;
- once LISTENING is durable, the exact persisted boundary is authoritative and ACK retries may not change it.

---

## 3. Runtime processing order

Each router cycle follows the logical order:

```text
handoff discovery / activation
→ local retirement resolution
→ pre-fill exact-account ownership evaluation
→ atomic first-fill promotion
→ exact-account LIVE lifecycle advancement
```

Retirement resolution has priority over ordinary first-fill promotion. A fill with authoritative `executionTime < retirement.cutoffAt` may supersede discard under Decision 16; an execution at or after the cutoff may not resurrect the listener.

Delivered handoffs no longer appear in transport discovery, therefore LISTENING installations and LIVE lifecycles are processed from the canonical local store independently of discovery.

---

## 4. Atomic first-fill promotion

When Decision 15 produces one eligible exact-account first fill, one canonical-store transaction must create both:

1. the durable Decision-18 V2.4 LIVE lifecycle; and
2. the visible `origin = V24_HANDOFF` LIVE Execution Board record.

The commit is all-or-nothing. A lifecycle may not be durably created without its corresponding visible LIVE ownership projection, and a V2.4 LIVE projection may not exist without its durable lifecycle.

The immutable LISTENING installation remains stored as authorization provenance but ceases to be an active symbol reservation once that lifecycle exists.

---

## 5. Active symbol ownership authority

Ownership authority is derived by state, not by deleting provenance.

### Pre-fill

A PREPARED or LISTENING installation reserves the symbol only while no corresponding V2.4 lifecycle exists and the handoff has not finalized RETIRED.

### LIVE

`LIVE` and `LIVE_RECONCILIATION_REQUIRED` lifecycle states reserve the symbol. The visible V2.4 LIVE record represents the same owned trade in the operator UI.

### EXIT awaiting classification

An `EXIT` lifecycle remains owned while its V2.4-origin trade remains in the active `liveTrades` collection awaiting operator exit classification. If the active projection is unexpectedly missing and no History record exists, ownership remains fail-closed rather than silently releasing.

### History

Once the completed V2.4-origin trade is durably moved to History, active symbol ownership is released. The handoff, installation, lifecycle, retirement records if any, and History record remain durable audit provenance.

---

## 6. V2.4 pre-fill operator projection

V2.4 PREPARED/LISTENING authorizations are not inserted into legacy `candidates[]`.

They are rendered from V2.4 installation/retirement provenance in a separate authorization board. Minimum displayed fields:

- symbol and direction;
- PREPARED / LISTENING / suspended or retirement state;
- structural invalidation;
- effective stop;
- current expected entry used by Phase 4;
- selected authorized quantity;
- frozen authorized max-dollar-risk when available;
- exact-account authorization provenance in non-secret form appropriate to the current UI.

The only pre-fill mutation exposed in this integration is **DISCARD**, which must invoke Decision 16 retirement semantics and must warn that broker orders are unchanged. V2.4 authorization-bearing EDIT remains prohibited under Decision 10 until the separate Revise → Re-arm workflow is implemented.

---

## 7. V2.4 LIVE operator projection

V2.4 LIVE/EXIT cards retain the existing Execution Board management and exit-classification workflow but must display V2.4 stop authority correctly:

- structural invalidation and effective stop are separate;
- actual stop risk uses the effective stop, never structural invalidation;
- the comparison budget is the frozen ARM-time `authorizedMaxDollarRisk`, not a newly calculated account budget;
- current quantity and average for automatic lifecycle state come from the Decision-18 lifecycle, not symbol-only current-position inference;
- `LIVE_RECONCILIATION_REQUIRED` remains visible, retains ownership, and explicitly states that automatic broker lifecycle processing is suspended.

No V2.4 live record may be processed by legacy symbol-only / `detectedAt` fill or lifecycle logic.

---

## 8. Fail-closed reconciliation

The router does not reconstruct missing ownership history from current positions.

Examples requiring retained ownership / reconciliation rather than silent release include:

- post-LISTENING execution coverage loss;
- post-LIVE coverage interval discontinuity;
- missing or contradictory exact-account broker provenance;
- a nonterminal durable lifecycle with a missing visible LIVE projection;
- an EXIT lifecycle with neither active EXIT projection nor History record.

---

## 9. Broker boundary

Decision 20 does not authorize broker writes. The full runtime route remains observational and state-management only:

```text
handoff → authorization/listening → observe Schwab execution → own lifecycle → UI/history
```

No order placement, modification, cancellation, automatic reduction, stop replacement, or automatic flattening is introduced by this decision.
