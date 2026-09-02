# ExecutionOS Documentation Index

**Status:** Current documentation inventory  
**Date:** 2026-09-02  
**Repository:** `sibolek/structure-based-trade-management`  
**Purpose:** Definitive map of current authority, implementation acceptance, release references, research provenance, and historical records.

---

## 1. Authority and precedence

When documents disagree, use this precedence:

1. **Current code and validated broker/runtime behavior** define what the running system actually does.
2. **`USER-GUIDE.md`** is the living operator reference for current normal use.
3. **Approved design baselines** define locked architecture/design decisions for their scope:
   - `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` — consolidated V2.4 architecture;
   - `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md` — Phase 4 risk sizing;
   - `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md` — explicit V2.4 internal `ARMED` → V2.3 Execution Board handoff integration.
4. **Closeout / implementation-status records** establish what was actually implemented and validated:
   - `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md`;
   - `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md`;
   - `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Implementation_Status_2026-09-02.md` — active branch implementation checkpoint.
5. **`docs/ExecutionOS_Project_Specification_v1.2_2026-08-26.md`** remains an authoritative dated architecture record; repository-status fields inside it are historical snapshots.
6. **`docs/ExecutionOS_EOD_Report.md`** is authoritative for EOD reconstruction, enrichment, matching, risk/R interpretation, and limitations.
7. **`research/30-day-management-study/methodology.md`** is authoritative for historical analytics provenance.
8. **`DOCUMENTATION-STATUS.md`** distinguishes current records from historical/superseded ones.

Historical approved documents are not rewritten merely because implementation later succeeds. Later status belongs in closeout/status records.

---

## 2. Current authoritative documentation

| Document | Role | Authority |
|---|---|---|
| `USER-GUIDE.md` | Living operator guide | **Current authoritative operator guide** |
| `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` | Consolidated V2.4 architecture | **Authoritative V2.4 design baseline** |
| `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md` | Locked Phase 4 risk design | **Authoritative Phase 4 design baseline** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md` | Locked handoff architecture | **Authoritative handoff design baseline** |
| `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` | Implemented Phase 3 scope and acceptance | **Authoritative Phase 3 implementation record** |
| `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md` | Implemented Phase 4 scope and acceptance | **Authoritative Phase 4 implementation record** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Implementation_Status_2026-09-02.md` | Current accepted handoff branch increments/tests/remaining gates | **Current handoff implementation-status record** |
| `docs/ExecutionOS_EOD_Report.md` | EOD technical/operational semantics | **Current authoritative EOD reference** |
| `docs/ExecutionOS_Project_Specification_v1.2_2026-08-26.md` | Dated V2.3-era architecture | **Authoritative dated architecture record** |
| `research/30-day-management-study/methodology.md` | Historical analytics provenance | **Current authoritative research provenance** |
| `DOCUMENTATION-STATUS.md` | Current vs historical map | **Documentation-governance record** |
| `README.md` | Repository overview | **Current overview** |

---

## 3. Current implementation baseline

### Frozen downstream execution release

```text
v2.3.0
```

Tag target:

```text
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

V2.3 remains the frozen broker-fill ownership/execution-management reference. V2.4 is an upstream extension and must not silently change those semantics.

### Merged V2.4 baseline on `main`

V2.4 Phase 4 was merged through **PR #14** on 2026-09-01.

```text
Merge commit: 0a976fb8bc68f64fd479d48322a011c9d419b2c2
```

Merged to `main`:

- Phase 1 Candidate Ingestion;
- Phase 2 MarketDataProvider;
- Phase 3 DSS / Micro-Volatility Buffer;
- Phase 4 Effective-Stop Risk Sizing;
- immutable risk evaluations;
- mandatory ARM-time risk refresh;
- selected-quantity enforcement;
- internal exact-provenance `ARMED` freeze.

### Active Execution Board handoff integration

Branch:

```text
v24-execution-board-handoff
```

Current accepted checkpoint:

```text
Increment 1 — Immutable handoff contract + persistence               ACCEPTED
Increment 2 — Claim / delivery state machine                         ACCEPTED
Increment 3 — Broker account identity + execution coverage           ACCEPTED / LIVE-PROVEN

v24:handoff-test                                                      31/31 PASS
v24:broker-provenance-test                                           13/13 PASS
schwab:state-test                                                     10/10 PASS
production build                                                     PASS
```

Increment 1 broader regression evidence:

```text
v24:risk-sizing-test  170/170 PASS
v24:dss-test           91/91 PASS
analytics:test        307/307 PASS
schwab:state-test      10/10 PASS
production build      PASS
```

Increment 3 live read-only Schwab proof established:

- stable opaque `accountId` exposed separately from masked account display;
- same account identity on public account and position state;
- `executionCoverage.status = CONTIGUOUS`;
- `coverageStartedAt = baselineCompletedAt` at baseline completion;
- `currentThrough` advances only on successful polling;
- no gap was present during the accepted proof;
- monitor remained read-only.

The handoff integration is **not yet end-to-end operational**. No V2.4 candidate is yet installed into V2.3 by the new handoff path, and no new broker-fill ownership behavior is enabled.

V3 has not started.

---

## 4. V2.4 phase / boundary status

| Phase / boundary | Current status | Primary record |
|---|---|---|
| Phase 1 — Candidate Ingestion | **COMPLETE / MERGED** | V2.4 baseline + code |
| Phase 2 — MarketDataProvider | **COMPLETE / MERGED / LIVE-ACCEPTED** | V2.4 baseline + code |
| Phase 3 — DSS / Micro-Volatility Buffer | **IMPLEMENTATION COMPLETE / ACCEPTED / MERGED** | Phase 3 closeout |
| Phase 4 — Effective-Stop Risk Sizing | **IMPLEMENTATION COMPLETE / ACCEPTED / MERGED via PR #14** | Phase 4 design + closeout |
| Execution Board handoff integration | **IN PROGRESS — INCREMENTS 1–3 ACCEPTED ON BRANCH** | Handoff design + implementation-status record |
| Broader context / decision gate beyond risk consequence | **DEFERRED / LATER V2.4 WORK** | V2.4 baseline |
| Broker-write / order-placement capability | **NOT AUTHORIZED / NOT IMPLEMENTED** | Safety boundaries |
| V3 Management Governor | **NOT STARTED** | Project Specification v1.2 direction only |

Important distinction:

> Phase 4 creates an internal `ARMED` authorization/provenance state. The branch now has immutable handoff transport, durable claim/delivery state, exact broker account identity, and provable monitor coverage intervals. Browser/V2.3 installation and broker-fill ownership are still not implemented.

---

## 5. Phase 4 governing invariant

> **Phase 3 determines the correct stop. Phase 4 determines whether and how large the trade can be against that stop. Phase 4 never changes the stop.**

Final merged Phase 4 gate:

```text
v24:risk-sizing-test  170/170 PASS
v24:dss-test           91/91 PASS
analytics:test        293/293 PASS
schwab:state-test      10/10 PASS
production build      PASS
```

---

## 6. Execution Board handoff integration checkpoint

Approved governing invariant:

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

### Increment 1 accepted

Implemented immutable handoff construction/persistence with exact candidate, DSS, risk, selected quantity, structural invalidation, effective stop, and Phase 4 execution-account provenance.

### Increment 2 accepted

Implemented durable delivery lifecycle:

```text
PENDING → CLAIMED → DELIVERED
                  ↘ BLOCKED
```

with permanent receiver claim, no claim stealing, idempotent retries, terminal delivery/block states, and frozen `executionListeningAt` on ACK.

### Increment 3 accepted

Implemented exact opaque broker account identity and explicit monitor coverage provenance:

```text
ESTABLISHING → CONTIGUOUS
                   ↓ failure
                  GAP
                   ↓ successful recovery
               CONTIGUOUS (new coverageStartedAt)
```

The system never claims continuous coverage across a failed poll interval.

### Next increment

```text
Increment 4 — Server-side handoff endpoints
```

Still pending:

- pending/claim/block/ACK API;
- stable browser receiver identity;
- pre-install broker conflict gate;
- V2.3 same-symbol ownership gate;
- idempotent local installation/read-back verification;
- exact-account fill matching from `executionListeningAt`;
- effective-stop compatibility helpers;
- quantity and wrong-account variance handling;
- end-to-end dashboard validation.

Therefore the handoff is **not yet available as an operator workflow** and `USER-GUIDE.md` remains intentionally unchanged.

---

## 7. PRE-TRADE versus existing V2.3 Execution Board

```text
Candidate / PRE-TRADE
   ↓
Phase 3 DSS
   ↓
Phase 4 risk sizing
   ↓
READY / CAUTION / PASS
   ↓
ARM attempt
   ↓
fresh Phase 4 evaluation
   ↓
internal V2.4 ARMED provenance freeze
   ↓
immutable handoff + durable claim/delivery state     [implemented]
   ↓
exact broker identity + coverage provenance          [implemented]
   ↓
local handoff API transport                          [next]
   ↓
V2.3 installation / executionListeningAt             [not yet implemented]
   ↓
existing V2.3 Execution Board
   ↓
broker-fill ownership / LIVE management
```

A V2.4 internal `ARMED`, PENDING, or CLAIMED state does not itself place an order or make V2.3 own a position.

---

## 8. Quick reference

| Question | Answer / first source |
|---|---|
| Overall V2.4 architecture? | `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` |
| Handoff integration design? | `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md` |
| Current handoff status? | `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Implementation_Status_2026-09-02.md` |
| Is Phase 4 merged? | **Yes — PR #14 / `0a976fb...`** |
| Can Phase 4 tighten the stop to fit risk? | **No. Reduce quantity or reject affordability.** |
| Does CLAIMED mean broker-fill ownership? | **No.** |
| Is broker account identity exact? | **Yes on accepted Increment 3 branch state; opaque `accountId` is separate from mask.** |
| Can coverage bridge a monitor error? | **No. Recovery starts a new coverage interval.** |
| Is the full V2.4 → V2.3 handoff complete? | **No. Increments 1–3 are accepted; downstream installation/binding remains pending.** |
| Broker writes authorized? | **No.** |
| V3 started? | **No.** |

---

## 9. Pull requests as project records

- **PR #1** — V2.3 execution system; merged.
- **PR #7** — read-only EOD reporting; merged.
- **PR #12** — V2.4 Phase 3 DSS implementation; merged.
- **PR #13** — Phase 3 documentation cleanup; merged.
- **PR #14** — V2.4 Phase 4 Effective-Stop Risk Sizing; merged.
- Execution Board handoff integration — **active branch work; PR not yet opened**.

---

## 10. Historical / superseded records

Preserve historical specifications, planning snapshots, older branch docs, and approval-time implementation-status prose. They remain evidence/history but do not override current code, validated runtime behavior, or current implementation-status records.

---

**Maintenance principle:** If a future contributor cannot answer what is authoritative, what is historical, what is merged, what is branch-only, what authority exists, and what remains intentionally gated from this file and the linked records, update the documentation before adding more architecture.
