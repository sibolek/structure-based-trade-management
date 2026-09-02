# ExecutionOS Documentation Index

**Status:** Current documentation inventory  
**Date:** 2026-09-02  
**Repository:** `sibolek/structure-based-trade-management`

---

## 1. Authority and precedence

1. Current code and validated runtime behavior define what the system actually does.
2. `USER-GUIDE.md` is the living operator guide.
3. Approved design baselines/addenda define locked architecture for their scope:
   - `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md`;
   - `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md`;
   - `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md`;
   - `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v0.1_APPROVED.md` — Decisions 10–11;
   - `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v0.2_APPROVED.md` — Decision 12;
   - `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v0.3_APPROVED.md` — Decision 13.
4. Closeout/status records define what was actually implemented and accepted:
   - `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md`;
   - `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md`;
   - `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Implementation_Status_2026-09-02.md`.
5. Historical specifications and planning documents remain dated evidence and do not override current validated behavior.

---

## 2. Current authoritative documentation

| Document | Role | Authority |
|---|---|---|
| `USER-GUIDE.md` | Current operator workflow | **Authoritative operator guide** |
| `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` | Consolidated V2.4 architecture | **Authoritative V2.4 design** |
| `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md` | Phase 4 risk design | **Authoritative Phase 4 design** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md` | Original handoff architecture | **Authoritative handoff design baseline** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v0.1_APPROVED.md` | Decisions 10–11 | **Authoritative approved handoff addendum** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v0.2_APPROVED.md` | Decision 12 | **Authoritative approved handoff addendum** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v0.3_APPROVED.md` | Decision 13 | **Authoritative approved handoff addendum** |
| `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` | Phase 3 accepted implementation | **Authoritative Phase 3 implementation** |
| `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md` | Phase 4 accepted implementation | **Authoritative Phase 4 implementation** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Implementation_Status_2026-09-02.md` | Active handoff implementation checkpoint | **Current handoff status** |
| `DOCUMENTATION-STATUS.md` | Current/historical map | **Documentation governance** |

---

## 3. Merged V2.4 baseline

V2.4 Phases 1–4 are merged to `main`.

Phase 4 merge:

```text
PR #14
Merge commit: 0a976fb8bc68f64fd479d48322a011c9d419b2c2
```

Frozen downstream execution reference:

```text
v2.3.0
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

V2.3 remains the downstream authority for broker-fill ownership, LIVE promotion, execution lifecycle semantics, and History.

---

## 4. Active Execution Board handoff integration

Branch:

```text
v24-execution-board-handoff
```

Governing invariant:

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

Current accepted implementation checkpoint:

| Work | Status |
|---|---|
| Increment 1 — Immutable handoff contract + persistence | **ACCEPTED** |
| Increment 2 — Claim / delivery state machine | **ACCEPTED** |
| Increment 3 — Exact broker account identity + execution coverage | **ACCEPTED / LIVE-PROVEN** |
| Increment 4 — Server-side handoff transport API | **ACCEPTED / ISOLATED RUNTIME-PROVEN** |
| Execution-activity provenance + pure pre-install admission gate | **ACCEPTED / LIVE-PROVEN** |

Approved post-baseline design:

| Decision | Status |
|---|---|
| 10 — V2.4-origin authorization immutability + automated fast revise/re-arm | **APPROVED / FROZEN** |
| 11 — Universal pre-fill discard/disarm | **APPROVED / FROZEN** |
| 12 — Broker cleanliness is symbol-global across observable connected accounts | **APPROVED / FROZEN** |
| 13 — Schwab `executionTime` authority + lossless account/symbol execution activity proof | **APPROVED / FROZEN** |

Latest deterministic acceptance gate:

```text
v24:broker-provenance-test  24/24 PASS
v24:handoff-admission-test  16/16 PASS
v24:handoff-test            34/34 PASS
v24:handoff-api-test         7/7 PASS
schwab:state-test            10/10 PASS
production build            PASS
```

Live read-only Schwab proof also confirmed exact alignment between `executionCoverage` and `executionActivity` intervals, with `status = ARMED`, `readOnly = true`, and `lastError = null`.

Earlier broader regression evidence remains:

```text
v24:risk-sizing-test  170/170 PASS
v24:dss-test           91/91 PASS
analytics:test        307/307 PASS
schwab:state-test      10/10 PASS
production build      PASS
```

---

## 5. Accepted handoff capabilities

### Immutable handoff + delivery

- exact V2.4 `ARMED` candidate/version/hash/DSS/risk/account provenance;
- structural invalidation separate from Phase 3 `effectiveStop`;
- one handoff per ARM risk authorization;
- PENDING → CLAIMED → DELIVERED / BLOCKED;
- sticky one-receiver claim;
- no broker-fill ownership at claim time;
- ACK freezes `executionListeningAt` only after successful downstream installation;
- idempotent transport retries;
- no broker-write authority.

### Broker identity / coverage / activity provenance

- stable opaque `accountId` separate from masked account display;
- exact account identity on account, position, and execution records;
- `ESTABLISHING / CONTIGUOUS / GAP` execution coverage;
- no coverage bridging across monitor failures;
- bounded recent-execution list retained for UI only;
- separate lossless latest-execution watermark per exact account+symbol for the current contiguous interval;
- Schwab `executionTime` is authoritative; `detectedAt` is audit-only;
- invalid/missing authoritative execution time fails closed and prevents silent recovery for the running monitor process.

### Pure pre-install admission gate

Admission ordering is now accepted:

```text
exact authorized account
→ healthy broker state
→ complete aligned coverage/activity proof
→ symbol-global current-position check
→ symbol-global intervening execution check since authorizedAt
→ local nonterminal symbol-ownership check
→ ADMITTED
```

The evaluator ignores the bounded `brokerState.executions` array for completeness decisions and can require proof through a caller-supplied later `requiredThrough` point for final-install revalidation.

Failure codes include:

```text
AUTHORIZED_EXECUTION_ACCOUNT_UNAVAILABLE
BROKER_STATE_UNAVAILABLE
BROKER_EXECUTION_COVERAGE_GAP
EXISTING_POSITION_AT_HANDOFF
INTERVENING_BROKER_ACTIVITY
WRONG_ACCOUNT_EXECUTION_OBSERVED
EXECUTION_SYMBOL_OWNERSHIP_CONFLICT
```

---

## 6. Approved downstream behavioral rules

### Decision 10 — authorization immutability

V2.4 authorization-bearing fields are immutable once installed. Direct mutation fails with `V24_AUTHORIZATION_IMMUTABLE`. Desired pre-fill changes use automated Revise → retire → fresh authorization → Re-arm. Manual/legacy V2.3 Edit remains unchanged.

### Decision 11 — universal pre-fill discard/disarm

Any pre-fill `ARMED` / `LISTENING` trade may be discarded regardless of origin. Discard ends fill eligibility, releases symbol ownership, preserves audit history, and prevents V2.4 handoff resurrection. After first owned fill, normal LIVE management applies. Broker orders remain unchanged.

### Decision 12 — symbol-global broker cleanliness

Exact Phase 4 account determines which account may own the trade. Cleanliness is global across observable connected accounts: any current same-symbol position or same-symbol execution inside the authorization interval blocks installation.

### Decision 13 — authoritative execution activity proof

Schwab `executionTime` governs admission and future V2.4 fill-ownership timing. `detectedAt` does not move the ownership boundary. Safety provenance is independent of the bounded recent-execution UI list.

---

## 7. Current boundary: handoff is still not an operator workflow

The branch does **not** yet:

- install a V2.4 handoff into V2.3;
- establish `executionListeningAt` through a real durable V2.3 installation;
- ACK a real local installation;
- bind broker fills through the V2.4-origin path;
- implement the approved revise/re-arm or universal discard synchronization;
- modify/place/cancel/replace broker orders.

Therefore V2.4 internal `ARMED`, PENDING, CLAIMED, and pure `ADMITTED` states do not themselves create downstream broker ownership.

---

## 8. Implementation sequence / next work

The original approved sequence remains authoritative:

```text
5. V2.3 compatibility helpers / provenance model
6. pre-install safety gates
7. idempotent local installation + ACK
8. exact-account fill matching
...
```

The pure sequence-item-6 admission evaluator was implemented and accepted ahead of wiring because its broker-provenance dependency could be isolated and proved safely. **This does not renumber the sequence and does not mark item 5 complete.**

Immediate next focus: **sequence item 5 — V2.3 compatibility helpers / provenance model**, including:

- origin/provenance shape for V2.4 handed-off candidates;
- canonical `executionStop(trade)`:
  - V2.4-origin → `effectiveStop`;
  - legacy/manual → `originalPlan.structuralStop`;
- preservation of structural invalidation separately from effective stop;
- preservation of selected quantity, exact account, candidate/version/hash, DSS/risk, handoff, receiver, authorization, and listening provenance;
- legacy/manual V2.3 behavior unchanged where not explicitly governed by Decisions 10–13.

After that, the accepted admission gate can be wired into idempotent local installation + ACK.

---

## 9. Quick reference

| Question | Answer |
|---|---|
| Are V2.4 Phases 1–4 merged? | **Yes.** |
| Is Phase 4 allowed to tighten a stop to fit risk? | **No. Reduce quantity or reject.** |
| Does CLAIMED mean broker-fill ownership? | **No.** |
| Is exact account identity available? | **Yes.** |
| Can execution coverage bridge a monitor error? | **No.** |
| Can recent 25 executions prove no intervening activity? | **No. Safety uses the lossless activity watermark.** |
| Which timestamp is authoritative? | **Schwab `executionTime`.** |
| Is broker cleanliness account-local? | **No. It is symbol-global across observable connected accounts.** |
| Is the admission gate accepted? | **Yes, as a pure pre-install gate; it does not install anything yet.** |
| Can a V2.4 authorization be edited in place after installation? | **No. Use Revise → Re-arm.** |
| Can any pre-fill armed/listening trade be discarded? | **Yes, regardless of origin.** |
| Is V2.4 → V2.3 end-to-end ownership complete? | **No.** |
| Are broker writes authorized? | **No.** |

---

## 10. Pull requests as project records

- PR #1 — V2.3 execution system; merged.
- PR #7 — read-only EOD reporting; merged.
- PR #12 — V2.4 Phase 3 DSS implementation; merged.
- PR #13 — Phase 3 documentation cleanup; merged.
- PR #14 — V2.4 Phase 4 risk sizing; merged.
- Execution Board handoff integration — **active branch; PR not yet opened**.

---

**Maintenance principle:** update this index when accepted implementation status or approved authority changes; do not rewrite dated approval artifacts to simulate later implementation state.
