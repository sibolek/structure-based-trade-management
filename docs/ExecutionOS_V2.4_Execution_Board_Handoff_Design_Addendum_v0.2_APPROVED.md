# ExecutionOS V2.4 — Execution Board Handoff Integration
## Design Addendum v0.2 — APPROVED

**Date:** 2026-09-02  
**Branch:** `v24-execution-board-handoff`  
**Parent authorities:**
- `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md`
- `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v0.1_APPROVED.md`

**Status:** **APPROVED — DECISION 12 FROZEN**

---

## 1. Purpose

This addendum freezes Decision 12, approved after Decisions 10 and 11. It resolves the multi-account ambiguity in the pre-install broker-cleanliness gate.

The governing handoff boundary remains:

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

Nothing in this addendum authorizes broker writes.

---

## 2. Decision 12 — Broker cleanliness is symbol-global across connected accounts

### 2.1 Approved invariant

> **The exact Phase 4 account determines which broker account may own the V2.4 trade, but symbol cleanliness is evaluated across every connected broker account observable by ExecutionOS. Any current non-zero position or intervening broker execution in the handoff symbol on any observed account blocks installation.**

This preserves the approved one-symbol/one-execution-owner model while retaining exact-account fill ownership.

### 2.2 Exact account remains mandatory

The handoff continues to carry:

```text
authorizedExecutionAccountId
```

The exact opaque account identified by the fresh ARM-time Phase 4 risk evaluation must be present and available before installation.

Failure:

```text
AUTHORIZED_EXECUTION_ACCOUNT_UNAVAILABLE
```

No fallback to another account, masked suffix, first account, or sufficient-equity account is permitted.

### 2.3 Current-position gate is symbol-global

Before installation, ExecutionOS must inspect all currently observed broker positions across all connected accounts.

If any non-zero position exists in the handoff symbol, regardless of account, direction, or quantity, installation is blocked:

```text
EXISTING_POSITION_AT_HANDOFF
```

Examples:

```text
Handoff: NVDA authorized to account A
Account A: NVDA flat
Account B: NVDA long 20
→ BLOCK
```

```text
Handoff: NVDA LONG authorized to account A
Account B: NVDA short 5
→ BLOCK
```

No existing position is automatically adopted, merged, netted, or interpreted as compatible.

### 2.4 Intervening execution gate is symbol-global

The clean interval begins at the immutable V2.4 `authorizedAt` timestamp and must be provable through the pre-install check and final installation boundary.

Any broker execution in the handoff symbol during the relevant interval blocks installation, regardless of account.

If the execution is in the authorized account:

```text
INTERVENING_BROKER_ACTIVITY
```

If the execution is in another observed account:

```text
WRONG_ACCOUNT_EXECUTION_OBSERVED
```

A wrong-account execution may never be adopted by the candidate and may not leave the candidate silently eligible for a later intended-account fill.

### 2.5 Local Execution Board ownership remains symbol-global

Decision 4 from the approved handoff baseline remains unchanged:

> **If V2.3 already owns any nonterminal candidate/trade for the symbol, the incoming V2.4 handoff may not install.**

Failure:

```text
EXECUTION_SYMBOL_OWNERSHIP_CONFLICT
```

This applies regardless of whether the existing V2.3 owner is manual or V2.4-origin.

### 2.6 Admission ordering

The pre-install evaluator should apply the following fail-closed ordering:

```text
1. Exact authorized account present?
   NO → AUTHORIZED_EXECUTION_ACCOUNT_UNAVAILABLE

2. Broker monitor healthy / usable?
   NO → BROKER_STATE_UNAVAILABLE

3. Execution coverage sufficient for the full interval?
   NO → BROKER_EXECUTION_COVERAGE_GAP

4. Any current non-zero position in symbol on any account?
   YES → EXISTING_POSITION_AT_HANDOFF

5. Any execution in symbol since authorizedAt?
   authorized account → INTERVENING_BROKER_ACTIVITY
   other account      → WRONG_ACCOUNT_EXECUTION_OBSERVED

6. Existing nonterminal V2.3 owner for symbol?
   YES → EXECUTION_SYMBOL_OWNERSHIP_CONFLICT

7. Otherwise admission may proceed to durable installation.
```

Final installation must still revalidate the required broker interval so a clean pre-check cannot be treated as permanent permission if broker state changes before `executionListeningAt` is durably established.

---

## 3. Consequence for implementation

The admission implementation must therefore distinguish:

```text
account identity = exact / trade-specific
symbol cleanliness = global / all observed accounts
```

The gate must never use masked display account identifiers for ownership or cleanliness decisions.

The implementation must remain fail-closed if broker account identity, monitor health, execution coverage, or same-symbol activity cannot be established with sufficient provenance.

---

## 4. Safety boundary

Decision 12 does not authorize ExecutionOS to place, modify, cancel, replace, or flatten broker orders.

The broker integration remains read-only.

---

## 5. Approval

Decision 12 was explicitly approved by the user on 2026-09-02 and is frozen by this addendum.
