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
9. Dated validation/planning records are evidence snapshots unless explicitly designated as closeout/acceptance records.
10. Old PR descriptions, branch-local READMEs, or planning artifacts must not override newer authoritative documentation.

Historical approved documents are not rewritten merely because implementation later succeeded. Later status belongs in closeout/status records.

---

## 2. Current authoritative documentation

| Document | Role | Authority |
|---|---|---|
| `USER-GUIDE.md` | Living operator guide: setup, startup, current architecture boundary, risk/ARM semantics, broker execution, persistence, troubleshooting, EOD workflow | **Current authoritative operator guide** |
| `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` | Consolidated V2.4 pre-trade architecture and lifecycle design | **Authoritative V2.4 design baseline** |
| `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md` | Locked Phase 4 expected-entry/account/instrument/quantity/persistence/freshness/ARM-time design | **Authoritative Phase 4 design baseline** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md` | Locked handoff architecture: immutable transport, claim/ACK, ownership boundary, exact account, effective stop, quantity, fail-closed semantics | **Authoritative handoff integration design baseline** |
| `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` | Implemented Phase 3 DSS scope, live proof, acceptance gates, safety boundary | **Authoritative Phase 3 implementation record** |
| `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md` | Implemented Phase 4 risk sizing, immutable provenance, ARM-time refresh/freeze, acceptance gates, merge record | **Authoritative Phase 4 implementation record** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Implementation_Status_2026-09-02.md` | Current accepted handoff branch increments, tests, remaining gates, next increment | **Current handoff implementation-status record** |
| `docs/ExecutionOS_EOD_Report.md` | EOD technical/operational semantics | **Current authoritative EOD reference** |
| `docs/ExecutionOS_Project_Specification_v1.2_2026-08-26.md` | Dated V2.3-era architecture / Management Governor direction | **Authoritative dated architecture record** |
| `research/30-day-management-study/methodology.md` | Historical analytics provenance and anti-curve-fitting boundary | **Current authoritative research provenance** |
| `DOCUMENTATION-STATUS.md` | Current vs historical documentation map | **Documentation-governance record** |
| `README.md` | Current repository/project overview | **Current overview; defer to more specific sources above** |

---

## 3. Current implementation baseline

### Frozen downstream execution release

The validated downstream execution release remains:

```text
v2.3.0
```

Tag target:

```text
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

V2.3 remains the frozen broker-fill ownership/execution-management reference. V2.4 is an upstream pre-trade extension and must not silently change those semantics.

### Merged V2.4 baseline on `main`

V2.4 Phase 4 was merged through **PR #14** on 2026-09-01.

```text
Phase 4 branch: v24-risk-sizing-phase4
Phase 4 base:   ee5b84bf525f65e40304764a53d680e87286e062
Merge commit:   0a976fb8bc68f64fd479d48322a011c9d419b2c2
```

That merge brought `main` through:

- V2.4 Phase 1 Candidate Ingestion;
- V2.4 Phase 2 MarketDataProvider;
- V2.4 Phase 3 DSS / Micro-Volatility Buffer;
- V2.4 Phase 4 Effective-Stop Risk Sizing;
- immutable Phase 4 risk evaluations;
- mandatory ARM-time risk refresh;
- selected-quantity enforcement;
- internal exact-provenance `ARMED` freeze;
- formal Phase 4 design/closeout documentation.

Documentation-only commits after `0a976fb...` may advance `main` without changing the Phase 4 runtime acceptance baseline.

### Active Execution Board handoff integration

Branch:

```text
v24-execution-board-handoff
```

Approved design authority:

```text
docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md
```

Current accepted checkpoint:

```text
Increment 1 — Immutable handoff contract + persistence      ACCEPTED
Increment 2 — Claim / delivery state machine                ACCEPTED
v24:handoff-test                                             31/31 PASS
```

Increment 1 regression gate:

```text
v24:risk-sizing-test  170/170 PASS
v24:dss-test           91/91 PASS
analytics:test        307/307 PASS
schwab:state-test      10/10 PASS
production build      PASS
```

The handoff integration is **not yet end-to-end operational**. No V2.4 candidate is yet installed into the V2.3 Execution Board by the new handoff path, and no new broker-fill ownership behavior has been enabled.

V3 has not started.

---

## 4. V2.4 phase / boundary status

| Phase / boundary | Current status | Primary record |
|---|---|---|
| Phase 1 — Candidate Ingestion | **COMPLETE / MERGED** | V2.4 baseline + code |
| Phase 2 — MarketDataProvider | **COMPLETE / MERGED / LIVE-ACCEPTED** | V2.4 baseline + code |
| Phase 3 — DSS / Micro-Volatility Buffer | **IMPLEMENTATION COMPLETE / ACCEPTED / MERGED** | Phase 3 closeout |
| Phase 4 — Effective-Stop Risk Sizing | **IMPLEMENTATION COMPLETE / ACCEPTED / MERGED via PR #14** | Phase 4 design + closeout |
| Execution Board handoff integration | **IN PROGRESS — INCREMENTS 1–2 ACCEPTED ON BRANCH** | Handoff design baseline + implementation-status record |
| Broader context / decision gate beyond risk consequence | **DEFERRED / LATER V2.4 WORK** | V2.4 baseline + Phase 4 deferred work |
| Broker-write / order-placement capability | **NOT AUTHORIZED / NOT IMPLEMENTED** | Safety boundaries |
| V3 Management Governor | **NOT STARTED** | Project Specification v1.2 direction only |

Important distinction:

> Phase 4 creates an internal `ARMED` authorization/provenance state. Increment 1 can now create an immutable handoff from that authorization and Increment 2 can durably claim/deliver/block that handoff state, but the browser/V2.3 installation and broker-fill ownership boundary are still not implemented.

---

## 5. Phase 3 acceptance summary

Authoritative record:

```text
docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md
```

Accepted Phase 3 includes:

- RTH-only Wilder ATR(14) on completed 2-minute bars;
- locked `ATR × 0.30` volatility buffer;
- directionally protective effective-stop rounding;
- immutable DSS evaluation and exact `dssEvaluationId`;
- fresh/reuse/staleness/retry/freeze semantics;
- live Schwab input assembly;
- price-increment verification and Reg NMS fallback with 2026-11-02 cutoff;
- exact Phase 4 handoff.

Final Phase 3 gate:

```text
v24:dss-test       91/91 PASS
analytics:test     123/123 PASS
schwab:state-test  10/10 PASS
production build   PASS
```

---

## 6. Phase 4 acceptance summary

Authoritative design:

```text
docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md
```

Authoritative implementation record:

```text
docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md
```

Accepted Phase 4 includes:

- `MARKETABLE_NOW` / `STOP_TRIGGER` expected-entry semantics;
- five-second quote freshness and no last/mark fallback;
- exact Schwab account resolution;
- current `liquidationValue` account equity;
- 15-second account freshness;
- 0.5% planned stop-risk budget with downward cent rounding;
- equity and futures risk conversion;
- protective futures risk-tick ceiling;
- downward-only quantity rounding;
- no arbitrary notional cap at account equity;
- immutable append-only `RiskEvaluation` provenance;
- `VALID`, `NO_AFFORDABLE_SIZE`, `BLOCKED`, `ERROR` semantics;
- `NO_AFFORDABLE_SIZE → PASS — STOP_RISK_CONFLICT` mapping;
- mandatory fresh risk evaluation on every ARM attempt;
- selected quantity at/below exact risk maximum;
- exact `{candidateVersion, dssEvaluationId, riskEvaluationId, selectedQuantity}` provenance;
- final quote/account freshness rechecks;
- atomic internal `ARMED` freeze with rollback on persistence failure;
- no broker-order authority.

Governing invariant:

> **Phase 3 determines the correct stop. Phase 4 determines whether and how large the trade can be against that stop. Phase 4 never changes the stop.**

Final Phase 4 gate:

```text
v24:risk-sizing-test  170/170 PASS
v24:dss-test           91/91 PASS
analytics:test        293/293 PASS
schwab:state-test      10/10 PASS
production build      PASS
```

---

## 7. Execution Board handoff integration checkpoint

Approved governing invariant:

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

### Increment 1 accepted

Implemented:

- immutable `ExecutionBoardHandoff`;
- exact candidate / DSS / risk / quantity provenance;
- separate structural invalidation and Phase 3 effective stop;
- exact Phase 4 execution account;
- one handoff per ARM risk authorization;
- durable append-only-style handoff persistence and corruption detection.

### Increment 2 accepted

Implemented durable delivery states:

```text
PENDING → CLAIMED → DELIVERED
                  ↘ BLOCKED
```

with:

- one permanent receiver claim;
- no claim stealing;
- idempotent same-receiver claim retry;
- no broker-fill ownership at claim time;
- exact receiver delivery acknowledgment;
- immutable `executionListeningAt` once delivered;
- idempotent identical ACK retry;
- terminal `DELIVERED` / `BLOCKED`;
- restart durability and persistence rollback.

### Next increment

```text
Increment 3 — Broker account identity + execution-coverage provenance
```

Still pending after Increment 2:

- public broker state exact opaque account identity;
- execution-coverage proof;
- pre-install broker conflict gate;
- handoff endpoints;
- stable browser receiver identity;
- V2.3 local installation/read-back verification;
- exact-account fill matching from `executionListeningAt`;
- quantity and wrong-account variance handling;
- end-to-end dashboard validation.

Therefore the handoff is **not yet available as an operator workflow** and `USER-GUIDE.md` remains intentionally unchanged at this checkpoint.

---

## 8. PRE-TRADE versus existing V2.3 Execution Board

The product intentionally separates upstream pre-trade decision support from frozen downstream execution ownership.

```text
Candidate / PRE-TRADE
   ↓
Phase 3 DSS
   ↓
Phase 4 risk sizing
   ↓
broader context / permission logic
   ↓
READY / CAUTION / PASS
   ↓
ARM attempt
   ↓
fresh Phase 4 evaluation
   ↓
selected quantity validation
   ↓
internal V2.4 ARMED provenance freeze
   ↓
immutable handoff + durable claim/delivery state   [implemented through Increment 2]
   ↓
V2.3 installation / executionListeningAt           [not yet implemented]
   ↓
existing V2.3 Execution Board
   ↓
broker-fill ownership / LIVE management
```

A V2.4 internal `ARMED` record, a PENDING handoff, or a CLAIMED handoff does not itself place an order or make the V2.3 Execution Board own a position.

---

## 9. EOD documentation boundary

For an enriched EOD report:

1. completed trades must be in ExecutionOS History;
2. keep the Vite app running;
3. open the export helper on the same origin/profile;
4. download ExecutionOS EOD History;
5. run the Schwab EOD reporter.

Typical commands:

```text
http://localhost:5173/eod-export.html
```

```bash
npm run schwab:eod -- --date=YYYY-MM-DD
```

For full operator sequencing use `USER-GUIDE.md`; for report semantics use `docs/ExecutionOS_EOD_Report.md`.

---

## 10. Pull requests as project records

Important merge records:

- **PR #1** — V2.3 execution system; merged.
- **PR #2** — analytics preservation; merged.
- **PR #3** — useful pre-V2 execution-discipline documentation; merged.
- **PR #4** — history-only reconciliation; merged.
- **PR #5** — V2.3 release-documentation closeout; merged.
- **PR #6** — post-merge V2.3 documentation finalization; merged.
- **PR #7** — read-only EOD reporting; merged at `bedd70979a3b18844386bcf8f927fd8a1f62307f`.
- **PR #12** — V2.4 Phase 3 DSS implementation; merged.
- **PR #13** — Phase 3 post-merge documentation cleanup; merged.
- **PR #14** — V2.4 Phase 4 Effective-Stop Risk Sizing; merged at `0a976fb8bc68f64fd479d48322a011c9d419b2c2`.
- Execution Board handoff integration — **active branch work; PR not yet opened**.

Use current repository history rather than old PR descriptions to identify the latest documentation-only head.

---

## 11. Historical / superseded records

Preserve, but do not use as current status:

- `V2-MILESTONE-1.md` — historical original V2 prototype record;
- older Project Specification versions — superseded by v1.2 for their dated architecture record;
- v1.2 embedded repository-status fields — historical as of 2026-08-26;
- `ExecutionOS_Architecture_Validation_and_Monday_Plan_2026-08-23.pdf` — historical planning snapshot;
- implementation-status prose inside approved V2.4 design artifacts — historical at approval time;
- older branch-local README/User Guide states.

Approved design history should not be rewritten merely to make it look as though implementation had already happened at approval time.

---

## 12. Quick reference

| Question | First source |
|---|---|
| How do I operate ExecutionOS now? | `USER-GUIDE.md` |
| Overall V2.4 architecture? | `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` |
| Phase 4 design? | `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md` |
| Handoff integration design? | `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md` |
| Current handoff implementation status? | `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Implementation_Status_2026-09-02.md` |
| What did Phase 3 implement? | Phase 3 closeout |
| What did Phase 4 implement? | Phase 4 closeout |
| Is Phase 4 merged? | **Yes — PR #14, merge commit `0a976fb8bc68f64fd479d48322a011c9d419b2c2`** |
| Can Phase 4 tighten the stop to fit risk? | **No. Reduce quantity or return no affordable size.** |
| Does every ARM attempt get a fresh risk evaluation? | **Yes.** |
| Does internal V2.4 `ARMED` place an order? | **No.** |
| Is the full V2.4 → V2.3 handoff complete? | **No. Increments 1–2 are accepted; downstream broker/V2.3 integration remains pending.** |
| Does CLAIMED mean broker-fill ownership has begun? | **No. Ownership begins only at future successful V2.3 installation / `executionListeningAt`.** |
| Accurate enriched EOD procedure? | `USER-GUIDE.md` + `docs/ExecutionOS_EOD_Report.md` |
| Is V3 started? | **No.** |

---

## 13. Current project snapshot

As of 2026-09-02:

- V2.3 execution behavior remains frozen under tag `v2.3.0`.
- EOD reporting remains read-only and operational.
- V2.4 Phases 1–4 are merged to `main`.
- Phase 4 merge record is PR #14 / `0a976fb8bc68f64fd479d48322a011c9d419b2c2`.
- Phase 4 preserves structural invalidation/effective stop and may only size downward or reject affordability.
- Every ARM attempt requires a new risk evaluation and exact provenance freeze.
- Execution Board handoff work is active on `v24-execution-board-handoff`.
- Handoff Increment 1 and Increment 2 are implemented and accepted; focused gate is 31/31 PASS.
- End-to-end V2.4 candidate installation into V2.3 is not yet implemented.
- Internal V2.4 `ARMED`, PENDING, and CLAIMED states have no broker-write authority.
- Increment 3 is broker account identity + execution-coverage provenance.
- V3 has not started.

---

**Maintenance principle:** If a future contributor cannot answer what is authoritative, what is historical, what is merged, what is branch-only, what authority exists, and what remains intentionally gated from this file and the linked records, update the documentation before adding more architecture.
