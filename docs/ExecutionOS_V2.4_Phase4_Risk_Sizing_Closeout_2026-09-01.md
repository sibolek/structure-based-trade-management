# ExecutionOS V2.4 — Phase 4 Effective-Stop Risk Sizing Closeout

**Date:** 2026-09-01  
**Status:** IMPLEMENTATION COMPLETE / ACCEPTED / MERGED via PR #14  
**Project:** `sibolek/structure-based-trade-management`  
**Implementation branch:** `v24-risk-sizing-phase4`  
**Branch base:** `ee5b84bf525f65e40304764a53d680e87286e062`  
**Merge PR:** `#14 — Merge ExecutionOS V2.4 Phase 4 effective-stop risk sizing`  
**Merge commit:** `0a976fb8bc68f64fd479d48322a011c9d419b2c2`  
**Design authority:** `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md`  
**Upstream stop authority:** Phase 3 DSS / effective-stop evaluation  
**Downstream broker boundary:** read-only; no order-placement or broker-write authority added

---

## 1. Closeout decision

ExecutionOS V2.4 **Phase 4 — Effective-Stop Risk Sizing** is implementation-complete, accepted, and merged to `main` as of 2026-09-01.

Phase 4 deterministically answers:

> Given the exact effective stop established by Phase 3, the current expected entry, the exact execution account's current net-liquidation equity, and trusted instrument sizing metadata, what is the maximum valid position size whose planned price risk does not exceed 0.5% of account equity?

The governing invariant is preserved end to end:

> **Phase 3 determines the correct stop. Phase 4 determines whether and how large we can afford to trade against that stop. Phase 4 never changes the stop.**

Implemented chain:

```text
fresh VALID Phase 3 DSS
        ↓
exact dssEvaluationId + effectiveStop
        ↓
currentExpectedEntry
        ↓
exact account-risk snapshot
        ↓
instrument sizing metadata
        ↓
0.5% effective-stop risk sizing
        ↓
immutable riskEvaluationId
        ↓
permission consequence
        ↓
fresh ARM-time re-evaluation
        ↓
selected-quantity validation
        ↓
exact ARM provenance freeze
        ↓
internal ARMED state
```

No broker order is placed by this chain.

---

## 2. Accepted Phase 4 scope

Phase 4 includes:

- versioned trusted risk-sizing policy;
- expected-entry resolution for `MARKETABLE_NOW` and `STOP_TRIGGER`;
- strict bid/ask validation and five-second quote freshness;
- exact execution-account resolution;
- Schwab current `liquidationValue` as authoritative account equity;
- 15-second account-risk snapshot freshness;
- USD-only account/instrument currency contract for V2.4;
- normalized equity and futures sizing metadata;
- exact futures tick-risk conversion with protective tick ceiling;
- exact 0.5% risk-budget calculation with downward cent rounding;
- downward-only quantity rounding;
- odd-lot equity support and no fractional-share assumption;
- `NO_AFFORDABLE_SIZE` when minimum valid size cannot fit;
- immutable `RiskEvaluation` construction and append-only persistence;
- exact candidate / DSS / quote / account / instrument / calculation provenance;
- deterministic input fingerprints with unique evaluation identities;
- statuses `VALID`, `NO_AFFORDABLE_SIZE`, `BLOCKED`, `ERROR`;
- narrow permission-handoff semantics;
- `NO_AFFORDABLE_SIZE → PASS — STOP_RISK_CONFLICT` mapping;
- mandatory fresh Phase 4 re-evaluation on every ARM attempt;
- selected-quantity validation against the exact fresh risk evaluation;
- immutable ARM-risk provenance;
- final quote/account freshness rechecks at authorization;
- atomic freeze of exact DSS, risk-evaluation, and selected-quantity provenance;
- rollback of in-memory ARM mutation if persistence fails;
- transition to internal `ARMED` without broker-order authority.

---

## 3. Frozen Phase 4 risk policy

| Item | Accepted rule |
|---|---|
| Risk fraction | `0.005` = 0.5% |
| Risk basis | Planned price risk from `currentExpectedEntry` to Phase 3 `effectiveStop` |
| Account equity | Exact execution account current net-liquidation / `liquidationValue` |
| Risk-budget rounding | Down to the cent; never upward |
| Quote maximum age | 5 seconds |
| Account snapshot maximum age | 15 seconds |
| Supported asset types | `EQUITY`, `FUTURE` |
| Supported currency | USD only in V2.4 |
| Equity minimum / increment | 1 share / 1 share |
| Futures minimum / increment | 1 contract / 1 unless trusted metadata specifies otherwise |
| Quantity rounding | Down to valid increment only |
| Stop adjustment to fit risk | Prohibited |
| Arbitrary notional cap at account equity | None in Phase 4 |
| Buying-power / margin gate | Deferred / separate layer |
| Portfolio heat | Deferred / separate layer |
| Slippage buffer in planned risk | None in V2.4 |

A position may have notional exposure above account equity when planned stop risk remains within 0.5%. Broker buying power and margin eligibility are separate concerns and must not change the Phase 4 stop-risk calculation.

---

## 4. Expected-entry and stop geometry

### `MARKETABLE_NOW`

```text
LONG  → ask
SHORT → bid
```

### `STOP_TRIGGER`

```text
LONG  → max(triggerPrice, ask)
SHORT → min(triggerPrice, bid)
```

Accepted quote rules:

- positive bid and ask required;
- `bid <= ask`;
- locked markets are valid;
- crossed markets block;
- quote age must be at most five seconds;
- no fallback to mark, last, previous quote, or candle close.

Directional geometry is mandatory:

```text
LONG:  currentExpectedEntry > effectiveStop
SHORT: currentExpectedEntry < effectiveStop
```

Invalid geometry fails closed.

---

## 5. Account-risk and instrument metadata

The Schwab account-risk provider uses the exact execution account and normalizes:

```text
currentBalances.liquidationValue
```

It does not substitute cash, buying power, available funds, margin excess, initial balances, another account, or `currentBalances.equity` when liquidation value is absent.

Account snapshots preserve account identity, equity, currency, observation time, age, source, and source snapshot identity.

For equities, Phase 4 uses whole-share USD sizing. Phase 3 remains responsible for effective-stop price-increment rounding.

For futures, sizing metadata supports:

```text
tickSize
tickValue
pointValue?        // optional consistency cross-check
minimumQuantity
quantityIncrement
currency
metadataSource
metadataVersion
```

Schwab-normalized mappings are:

```text
tick             → tickSize
tickAmount       → tickValue
futureMultiplier → pointValue
```

Futures risk uses:

```text
riskTicks = ceil(riskDistance / tickSize)
riskPerContract = riskTicks × tickValue
```

If `pointValue` is present, it must be consistent with `tickSize × pointValue == tickValue`.

---

## 6. Deterministic calculation and affordability

```text
rawMaxDollarRisk = accountEquity × 0.005
maxDollarRisk = floorToCent(rawMaxDollarRisk)
```

Equity risk:

```text
LONG riskDistance  = currentExpectedEntry - effectiveStop
SHORT riskDistance = effectiveStop - currentExpectedEntry
riskPerShare = riskDistance
```

Futures risk:

```text
riskTicks = ceil(riskDistance / tickSize)
riskPerContract = riskTicks × tickValue
```

Quantity:

```text
rawQuantity = maxDollarRisk / riskPerUnit
finalQuantity = floor(rawQuantity / quantityIncrement) × quantityIncrement
```

Phase 4 may only round quantity downward.

If the minimum valid quantity does not fit:

```text
NO_AFFORDABLE_SIZE
MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET
```

For a valid result:

```text
plannedDollarRisk <= maxDollarRisk
plannedRiskFraction <= 0.005
```

Trusted invariant violations are `ERROR`, not ordinary trade outcomes.

---

## 7. Status and permission semantics

Phase 4 statuses are exactly:

```text
VALID
NO_AFFORDABLE_SIZE
BLOCKED
ERROR
```

Precedence:

```text
ERROR > BLOCKED > NO_AFFORDABLE_SIZE > VALID
```

Downstream mapping:

| Phase 4 status | Permission consequence |
|---|---|
| `VALID` | Continue permission evaluation |
| `NO_AFFORDABLE_SIZE` | `PASS — STOP_RISK_CONFLICT` |
| `BLOCKED` | Permission cannot advance |
| `ERROR` | Fail closed |

Phase 4 itself does not manufacture `READY`, `CAUTION`, or discretionary trade permission.

---

## 8. Immutable RiskEvaluation and persistence

Every Phase 4 evaluation that reaches the risk-evaluation boundary receives a unique immutable `riskEvaluationId` linked to the exact candidate and Phase 3 DSS evaluation.

```text
candidate identity
      ↓
dssEvaluationId + effectiveStop
      ↓
expected-entry provenance
      ↓
account snapshot provenance
      ↓
instrument metadata provenance
      ↓
calculation
      ↓
riskEvaluationId
```

Accepted persistence behavior:

- evaluation IDs are append-only and may not be reused;
- identical inputs may produce separate evaluation IDs;
- identical inputs may share the same deterministic fingerprint;
- validly constructible `BLOCKED`, `ERROR`, and `NO_AFFORDABLE_SIZE` attempts are retained;
- corrupted persisted contracts fail closed;
- duplicate persisted IDs fail closed;
- historical evaluations are never mutated into a newer truth.

---

## 9. Permission-time and ARM-time orchestration

Permission-time orchestration is:

```text
fresh VALID DSS handoff
        ↓
ExpectedEntryResolver
        ↓
AccountRiskProvider
        ↓
InstrumentSizingMetadataProvider
        ↓
RiskSizingCalculator
        ↓
RiskEvaluation persistence
        ↓
narrow Phase 4 permission result
```

A stale/invalid Phase 3 DSS fails before Phase 4 live reads and before Phase 4 risk persistence.

Every ARM attempt from `READY` or `CAUTION` requires a **new Phase 4 evaluation**. A recent permission-time risk evaluation is never reused merely because it is recent.

Selected quantity must satisfy trusted minimum/increment metadata and:

```text
selectedQuantity <= maxAffordableQuantity
```

Smaller selected quantity is allowed without changing the risk evaluation or effective stop.

---

## 10. Final ARM authorization and provenance freeze

At final internal authorization, the system rechecks:

- candidate/source identity;
- `READY` / `CAUTION` lifecycle;
- exact current DSS identity;
- DSS non-staleness;
- immutable risk-evaluation validity;
- selected quantity versus exact maximum/increment;
- quote age at authorization ≤ 5 seconds;
- account snapshot age at authorization ≤ 15 seconds.

Successful authorization freezes:

```text
authorizedDssEvaluationId
authorizedRiskEvaluationId
arm: {
  authorizedAt,
  candidateVersion,
  dssEvaluationId,
  riskEvaluationId,
  selectedQuantity
}
lifecycleState = ARMED
```

If state persistence fails, the in-memory transition rolls back.

`ARMED` here is an **internal V2.4 authorization/provenance state**. It is not proof of broker order submission, fill ownership, or transfer into the existing V2.3 Execution Board.

---

## 11. Final deterministic acceptance gate

Executed locally on 2026-09-01:

```text
v24:risk-sizing-test  170/170 PASS
v24:dss-test           91/91 PASS
analytics:test        293/293 PASS
schwab:state-test      10/10 PASS
production build      PASS
```

Zero failures were observed.

The frozen V2.3 deterministic trade-state suite remained 10/10 green across long/short entries, adds, partials, flats, and reversals.

---

## 12. Safety boundary and deferred work

Phase 4 may:

- calculate maximum planned-risk-affordable size from the Phase 3 effective stop;
- persist immutable risk evaluations;
- produce the narrow risk consequence for downstream permission logic;
- validate selected quantity;
- freeze exact DSS/risk/quantity provenance into internal `ARMED`.

Phase 4 may **not**:

- change structural invalidation;
- change the Phase 3 effective stop;
- place, modify, cancel, or replace broker orders;
- flatten a position;
- claim ownership of a broker fill;
- silently change trusted V2.3 execution-management semantics.

Deferred work includes:

1. broader context / decision-gate logic beyond Phase 4 risk consequences;
2. explicit internal V2.4 `ARMED` → existing V2.3 Execution Board transfer/binding;
3. broker-write / order-placement capability;
4. buying-power / margin / broker-eligibility gate;
5. portfolio heat / aggregate concurrent risk;
6. non-USD conversion and additional asset types;
7. fractional-share support if needed;
8. slippage/gap/fee modeling beyond planned entry-to-effective-stop risk;
9. operator/UI exposure of Phase 4 internals where later product work chooses to expose them;
10. production live smoke testing of the complete internal chain if a safe harness is later desired.

---

## 13. Merge record

Phase 4 was merged through **PR #14** on 2026-09-01.

```text
PR:           #14
Branch:       v24-risk-sizing-phase4
Base at PR:   main @ ee5b84bf525f65e40304764a53d680e87286e062
Merge commit: 0a976fb8bc68f64fd479d48322a011c9d419b2c2
```

The merge added the approved Phase 4 design baseline, Phase 4 runtime modules, focused tests, closeout record, and documentation-index update. The accepted safety boundary remains unchanged after merge.

---

**Governing principle:** The stop is a statement about where the trade thesis is invalid. Position size is a statement about how much capital can be risked if that invalidation occurs. Phase 4 may change the second answer. It may never change the first.
