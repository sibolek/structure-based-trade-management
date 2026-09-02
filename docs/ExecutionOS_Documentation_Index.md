# ExecutionOS Documentation Index

**Status:** Current documentation inventory  
**Date:** 2026-09-02  
**Repository:** `sibolek/structure-based-trade-management`

---

## 1. Authority and precedence

1. Current code and validated runtime behavior define what the system actually does.
2. `USER-GUIDE.md` is the living operator guide.
3. Approved design baselines define locked architecture for their scope:
   - `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md`;
   - `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md`;
   - `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md`.
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
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md` | Handoff architecture | **Authoritative handoff design** |
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

Current accepted checkpoint:

| Increment | Status |
|---|---|
| 1 — Immutable handoff contract + persistence | **ACCEPTED** |
| 2 — Claim / delivery state machine | **ACCEPTED** |
| 3 — Exact broker account identity + execution coverage | **ACCEPTED / LIVE-PROVEN** |
| 4 — Server-side handoff transport API | **ACCEPTED / ISOLATED RUNTIME-PROVEN** |

Latest deterministic gate:

```text
v24:handoff-api-test         7/7 PASS
v24:handoff-test            34/34 PASS
v24:broker-provenance-test  13/13 PASS
schwab:state-test            10/10 PASS
production build            PASS
```

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

### Increment 1

- immutable handoff from exact V2.4 `ARMED` provenance;
- candidate/version/hash, DSS, risk, selected quantity, expected-entry, and account provenance;
- structural invalidation separated from Phase 3 effective stop;
- one handoff per ARM risk authorization;
- durable fail-closed persistence.

### Increment 2

```text
PENDING → CLAIMED → DELIVERED
                  ↘ BLOCKED
```

- sticky one-receiver claim;
- no claim stealing;
- claim does not begin broker-fill ownership;
- ACK freezes `executionListeningAt`;
- terminal block/delivery states;
- idempotent retries including clock-independent identical retries.

### Increment 3

- opaque broker `accountId` separated from masked display account;
- exact account identity on account/position/execution state;
- explicit monitor coverage provenance;
- recovery after a poll gap starts a new continuous interval rather than bridging the gap;
- live read-only Schwab proof completed.

### Increment 4

Transport API:

```text
GET  /api/handoffs?receiverId=...
POST /api/handoffs/:handoffId/claim
POST /api/handoffs/:handoffId/ack
POST /api/handoffs/:handoffId/block
```

Accepted runtime proof used temporary `/tmp` persistence and port `8798`, confirmed:

- isolated health/configuration;
- PENDING discovery;
- successful exclusive claim by receiver A;
- `executionListeningAt` remained null after claim;
- receiver B could not steal the claim;
- `brokerWriteAuthority: false`.

---

## 6. Current boundary: handoff is still not an operator workflow

The branch does **not** yet:

- install a V2.4 handoff into V2.3;
- establish `executionListeningAt` through a real V2.3 durable installation;
- bind broker fills through the V2.4-origin path;
- modify/place/cancel/replace broker orders.

Therefore V2.4 internal `ARMED`, PENDING, and CLAIMED states do not themselves create downstream broker ownership.

---

## 7. Required design decision before V2.3 installation

The existing legacy V2.3 Edit workflow can alter plan/risk fields while the saved candidate continues listening. That behavior is incompatible with immutable V2.4 authorization-bearing provenance.

Before implementing browser/V2.3 installation, explicitly freeze the rule for **V2.4-origin authorization immutability**.

After that decision, remaining implementation includes:

- stable browser `executionBoardReceiverId`;
- pre-install broker conflict/coverage gate;
- same-symbol V2.3 ownership gate;
- exact authorized-account installation gate;
- idempotent V2.3 local installation/read-back verification;
- V2.4-origin provenance/effective-stop mapping;
- exact-account fill matching from `executionListeningAt`;
- partial fill/quantity variance and wrong-account handling;
- cancel/retire/disarm synchronization;
- delivered-but-local-missing reconciliation;
- end-to-end dashboard validation and final closeout.

---

## 8. Quick reference

| Question | Answer |
|---|---|
| Are V2.4 Phases 1–4 merged? | **Yes.** |
| Is Phase 4 allowed to tighten a stop to fit risk? | **No. Reduce quantity or reject.** |
| Does CLAIMED mean broker-fill ownership? | **No.** |
| Is exact account identity available? | **Yes, accepted in Increment 3.** |
| Can execution coverage bridge a monitor error? | **No.** |
| Is the handoff transport API accepted? | **Yes, Increment 4.** |
| Is V2.4 → V2.3 end-to-end ownership complete? | **No.** |
| Are broker writes authorized? | **No.** |
| What must be decided before V2.3 installation? | **V2.4-origin authorization immutability versus legacy Edit.** |

---

## 9. Pull requests as project records

- PR #1 — V2.3 execution system; merged.
- PR #7 — read-only EOD reporting; merged.
- PR #12 — V2.4 Phase 3 DSS implementation; merged.
- PR #13 — Phase 3 documentation cleanup; merged.
- PR #14 — V2.4 Phase 4 risk sizing; merged.
- Execution Board handoff integration — **active branch; PR not yet opened**.

---

**Maintenance principle:** update this index when accepted implementation status or authority changes; do not rewrite dated approval artifacts to simulate later implementation state.
