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
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v0.1_APPROVED.md` | Decisions 10–11: authorization immutability / fast revise-rearm / universal pre-fill discard | **Authoritative approved handoff addendum** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v0.2_APPROVED.md` | Decision 12: symbol-global broker cleanliness | **Authoritative approved handoff addendum** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v0.3_APPROVED.md` | Decision 13: authoritative executionTime + lossless activity proof | **Authoritative approved handoff addendum** |
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

Current **accepted** implementation checkpoint:

| Increment | Status |
|---|---|
| 1 — Immutable handoff contract + persistence | **ACCEPTED** |
| 2 — Claim / delivery state machine | **ACCEPTED** |
| 3 — Exact broker account identity + execution coverage | **ACCEPTED / LIVE-PROVEN** |
| 4 — Server-side handoff transport API | **ACCEPTED / ISOLATED RUNTIME-PROVEN** |

Approved post-baseline design:

| Decision | Status |
|---|---|
| 10 — V2.4-origin authorization immutability + automated fast revise/re-arm | **APPROVED / FROZEN** |
| 11 — Universal pre-fill discard/disarm for V2.4-origin and manual armed/listening trades | **APPROVED / FROZEN** |
| 12 — Broker cleanliness is symbol-global across all connected observable accounts | **APPROVED / FROZEN** |
| 13 — Schwab `executionTime` authority + lossless account/symbol execution activity proof | **APPROVED / FROZEN** |

Latest **accepted** deterministic gate remains:

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

Current branch implementation awaiting acceptance adds:

- `schwab-bridge/broker-execution-activity.mjs`;
- `schwab-bridge/execution-board-handoff-admission.mjs`;
- live-state activity/coverage synchronization and sticky malformed-execution-time provenance failure;
- `tests/broker-execution-activity.test.mjs`;
- `tests/execution-board-handoff-admission.test.mjs`.

It is intentionally not wired into V2.3 installation before focused acceptance.

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

Accepted runtime proof used temporary `/tmp` persistence and port `8798`, confirming isolated health/configuration, PENDING discovery, successful exclusive claim, `executionListeningAt: null` after claim, competing-receiver rejection, and `brokerWriteAuthority: false`.

---

## 6. Approved downstream behavioral rules

### Decision 10 — authorization immutability

V2.4 authorization-bearing fields are immutable once installed. Programmatic mutation must fail with:

```text
V24_AUTHORIZATION_IMMUTABLE
```

Manual/legacy V2.3 Edit remains unchanged. Desired pre-fill changes use automated Revise → retire → fresh authorization → Re-arm, with a target median latency under one second in normal Schwab conditions without weakening risk/freshness rules.

### Decision 11 — universal pre-fill discard/disarm

Any pre-fill `ARMED` / `LISTENING` trade may be discarded regardless of origin. Discard ends fill eligibility, releases symbol ownership, preserves audit history, and prevents V2.4 handoff resurrection. After first owned fill, normal LIVE management applies. Broker orders remain unchanged.

### Decision 12 — symbol-global broker cleanliness

The exact Phase 4 account determines which account may own the trade. Cleanliness is global across every connected observable account: any current same-symbol position or same-symbol execution inside the authorization interval blocks installation. Wrong-account activity is never adopted.

### Decision 13 — authoritative execution activity proof

Schwab `executionTime` is authoritative for clean-interval and fill-ownership timing; `detectedAt` is audit provenance. The recent executions list remains bounded/UI-only. Safety uses a separate account+symbol latest-execution watermark for the current contiguous coverage interval. The watermark resets when coverage is lost. Missing/invalid `executionTime` fails closed rather than substituting a detection/inferred time.

---

## 7. Current unaccepted admission/provenance implementation

Focused commands:

```text
npm run v24:broker-provenance-test
npm run v24:handoff-admission-test
```

The admission evaluator applies the approved ordering:

```text
exact account
→ broker availability
→ aligned full coverage/activity proof
→ symbol-global current positions
→ symbol-global execution activity since authorizedAt
→ existing local symbol ownership
→ ADMITTED
```

It deliberately ignores the bounded `brokerState.executions` array for completeness decisions.

The evaluator can also require coverage through an explicit later `requiredThrough` point so the same pure gate can be reused for final installation revalidation.

This implementation is **not accepted yet** and does not install, ACK, or bind a broker fill.

---

## 8. Current boundary: handoff is still not an operator workflow

The branch does **not** yet:

- install a V2.4 handoff into V2.3;
- establish `executionListeningAt` through a real V2.3 durable installation;
- bind broker fills through the V2.4-origin path;
- implement the approved revise/re-arm or universal discard synchronization;
- modify/place/cancel/replace broker orders.

Therefore V2.4 internal `ARMED`, PENDING, CLAIMED, and pure admission states do not themselves create downstream broker ownership.

---

## 9. Remaining implementation work

After activity/admission acceptance, remaining work includes:

- code-level V2.4 authorization immutability guard and V2.4-specific Edit behavior;
- fast revise/re-arm and latency instrumentation;
- universal discard/retirement persistence and anti-resurrection synchronization;
- stable browser `executionBoardReceiverId`;
- V2.3 adapter that exposes the exact nonterminal symbol-ownership set to the admission evaluator;
- idempotent V2.3 local installation/read-back verification;
- final install-time broker revalidation and durable `executionListeningAt` establishment;
- V2.4-origin provenance/effective-stop mapping;
- exact-account fill matching from `executionListeningAt` using authoritative `executionTime`;
- partial fill/quantity variance and wrong-account handling;
- delivered-but-local-missing reconciliation;
- end-to-end dashboard validation and final closeout.

---

## 10. Quick reference

| Question | Answer |
|---|---|
| Are V2.4 Phases 1–4 merged? | **Yes.** |
| Is Phase 4 allowed to tighten a stop to fit risk? | **No. Reduce quantity or reject.** |
| Does CLAIMED mean broker-fill ownership? | **No.** |
| Is exact account identity available? | **Yes, accepted in Increment 3.** |
| Can execution coverage bridge a monitor error? | **No.** |
| Is the handoff transport API accepted? | **Yes, Increment 4.** |
| Can a V2.4 authorization be edited in place after installation? | **No. Use Revise → Re-arm.** |
| Can any pre-fill armed/listening trade be discarded? | **Yes, regardless of origin.** |
| Is broker cleanliness account-local? | **No. Symbol cleanliness is global across observable connected accounts.** |
| Which timestamp is authoritative for broker execution timing? | **Schwab `executionTime`; `detectedAt` is audit only.** |
| Can the recent 25 executions prove no intervening activity? | **No. Safety uses the lossless activity watermark.** |
| Is the new activity/admission increment accepted? | **Not yet; focused tests are pending.** |
| Is V2.4 → V2.3 end-to-end ownership complete? | **No.** |
| Are broker writes authorized? | **No.** |

---

## 11. Pull requests as project records

- PR #1 — V2.3 execution system; merged.
- PR #7 — read-only EOD reporting; merged.
- PR #12 — V2.4 Phase 3 DSS implementation; merged.
- PR #13 — Phase 3 documentation cleanup; merged.
- PR #14 — V2.4 Phase 4 risk sizing; merged.
- Execution Board handoff integration — **active branch; PR not yet opened**.

---

**Maintenance principle:** update this index when accepted implementation status or approved authority changes; do not rewrite dated approval artifacts to simulate later implementation state.
