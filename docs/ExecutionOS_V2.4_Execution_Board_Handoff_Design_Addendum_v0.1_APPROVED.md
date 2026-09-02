# ExecutionOS V2.4 — Execution Board Handoff Integration
## Design Addendum v0.1 — APPROVED

**Date:** 2026-09-02  
**Branch:** `v24-execution-board-handoff`  
**Parent authority:** `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md`  
**Status:** **APPROVED — DECISIONS 10 AND 11 FROZEN**

---

## 1. Purpose

This addendum freezes two design decisions approved after the original Handoff Integration Design Baseline v0.1:

1. V2.4-origin authorization immutability with a fast revise/re-arm path;
2. universal pre-fill discard/disarm for both V2.4-origin and manual V2.3 armed trades.

This addendum does not renumber the approved top-level V2.4 phases and does not authorize broker writes.

The governing handoff boundary remains:

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

---

## 2. Decision 10 — V2.4-origin authorization immutability

### 2.1 Approved invariant

> **For every V2.4-origin Execution Board candidate or trade, the authorization-bearing fields transferred by the immutable handoff are immutable for the lifetime of that execution-ownership contract. Legacy/manual V2.3 Edit behavior remains unchanged. Any attempted mutation of V2.4 authorization-bearing fields fails closed with `V24_AUTHORIZATION_IMMUTABLE`. A desired pre-fill plan change requires retirement of the current authorization and a fresh upstream authorization rather than editing the installed contract.**

### 2.2 Authorization-bearing fields

At minimum, the following are immutable for a V2.4-origin installed contract:

- symbol;
- direction;
- setup;
- timeframe;
- thesis;
- trigger and invalidation source;
- structural invalidation;
- Phase 3 `effectiveStop`;
- Phase 4 expected entry;
- selected/authorized quantity;
- authorized execution account;
- source ID;
- candidate ID;
- candidate contract version;
- candidate content hash;
- DSS evaluation ID;
- risk evaluation ID;
- `authorizedAt`;
- `handoffId`;
- receiver identity;
- once established, `executionListeningAt`.

Broker-derived execution facts remain mutable under normal V2.3 execution semantics, including actual fills, average entry, current quantity, ADD/PARTIAL/FLAT/REVERSAL events, and History.

### 2.3 Legacy/manual behavior

Manual V2.3 candidates retain their existing Edit behavior unless changed by a separate future design decision. Decision 10 applies specifically to V2.4-origin authorization contracts.

### 2.4 Fast revise / re-arm path

Immutability must not create an operationally slow or cumbersome workflow.

The approved operator intent is:

```text
V2.4-origin ARMED/LISTENING trade
        ↓
REVISE
        ↓
retire old authorization/ownership contract
        ↓
apply revised proposal
        ↓
fresh required validation / Phase 4 risk evaluation
        ↓
new authorization
        ↓
new immutable handoff
        ↓
new downstream installation / LISTENING
```

This is an automated **Revise → Re-arm** workflow, not a manual restart from scratch.

Where valid by existing Phase 3 rules, the most recent valid completed-bar/DSS state may be reused; the system must not require waiting for a new 2-minute bar merely because a user revised a trade. Fresh market/account inputs required by Phase 4 remain mandatory.

### 2.5 Performance target

The implementation should be benchmarked so the revise/re-arm path remains appropriate for 2-minute trading.

Initial engineering target:

> **Median end-to-end revise/re-arm latency < 1 second under normal Schwab conditions.**

This is a performance acceptance target, not permission to bypass freshness, provenance, account, or risk checks. Slower broker/API conditions may produce longer re-arm latency and must fail closed if required fresh inputs cannot be established.

---

## 3. Decision 11 — Universal pre-fill discard / disarm

### 3.1 Approved invariant

> **Every pre-fill ExecutionOS `ARMED` / `LISTENING` trade is user-discardable regardless of origin. Discard immediately terminates future fill eligibility, releases symbol ownership, preserves immutable audit/provenance history, and cannot affect broker orders under the current read-only broker boundary. After the first owned fill, the trade is LIVE and may no longer be discarded; it must be managed or exited through normal execution semantics. For V2.4-origin trades, discard must synchronize retirement of the execution-ownership contract so a previously delivered handoff can never resurrect the discarded trade.**

### 3.2 Applies to both origin paths

```text
V2.4 candidate → ARM → LISTENING → DISCARD
Manual V2.3    → ARM → LISTENING → DISCARD
```

Discard availability must not depend on whether the trade originated from an upstream V2.4 candidate or from manual V2.3 arming.

### 3.3 Required pre-fill effects

Before any owned fill exists, `DISCARD` must:

1. stop the trade from listening for future fills;
2. release ExecutionOS same-symbol ownership;
3. remove it from the active/armed board;
4. preserve a durable audit record that it was discarded/retired;
5. make later broker fills ineligible to bind to that discarded authorization;
6. require a fresh ARM authorization before the trade can become eligible again.

For V2.4-origin trades, discard must synchronize upstream/downstream retirement so a `DELIVERED` handoff or persisted local record cannot later recreate or reactivate the discarded ownership contract.

### 3.4 First-fill boundary

```text
ARMED / LISTENING + zero owned fills
        ↓
DISCARD allowed

first owned fill
        ↓
LIVE
        ↓
DISCARD no longer allowed
```

Once the first broker fill has been validly owned by ExecutionOS, the trade must remain part of normal execution lifecycle and History. It may be managed or exited, but not discarded as though the trade never existed.

### 3.5 Broker-order boundary

ExecutionOS remains read-only with respect to broker orders.

Therefore:

> **Discarding an ExecutionOS armed/listening trade does not cancel, replace, or otherwise modify a working order in thinkorswim/Schwab.**

The UI must make this explicit whenever a user discards a pre-fill trade:

> **ExecutionOS listener discarded. Broker orders, if any, are unchanged.**

Broker-order cancellation remains outside current authority.

---

## 4. Interaction between Decisions 10 and 11

These decisions intentionally work together:

```text
Do not want the armed trade anymore?
        ↓
DISCARD

Want to change it and still trade it?
        ↓
REVISE
        ↓
retire old authorization automatically
        ↓
fresh authorization
        ↓
RE-ARM
```

The system must never mutate a frozen V2.4 authorization in place merely for speed or convenience.

The operator must also never be trapped in an unwanted pre-fill armed/listening state.

---

## 5. Implementation consequences

The downstream implementation must now include:

- a code-level `V24_AUTHORIZATION_IMMUTABLE` guard;
- V2.4-specific UI behavior that disables direct legacy Edit of authorization-bearing fields;
- a dedicated fast `REVISE → RE-ARM` path;
- durable retirement/cancellation state for pre-fill ownership contracts;
- universal pre-fill `DISCARD` for manual and V2.4-origin armed/listening trades;
- same-symbol ownership release on discard;
- prevention of handoff resurrection after discard;
- explicit broker-order-unchanged warning;
- performance instrumentation for revise/re-arm latency;
- tests proving no fill can bind after discard and that legacy/manual Edit remains unchanged.

The exact persistence/state-machine representation of retirement/discard may be implemented in the handoff integration workstream, but it must satisfy the invariants above.

---

## 6. Safety boundary

Nothing in Decisions 10 or 11 authorizes ExecutionOS to place, replace, cancel, or flatten broker orders.

The existing read-only broker boundary remains unchanged.

---

## 7. Approval

Decision 10 and Decision 11 were explicitly approved by the user on 2026-09-02 and are frozen by this addendum.
