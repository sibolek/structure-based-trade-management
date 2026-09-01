# ExecutionOS V2.4 — Phase 4 Effective-Stop Risk Sizing Closeout

**Date:** 2026-09-01  
**Status:** IMPLEMENTATION COMPLETE / ACCEPTED / MERGE-READY  
**Project:** `sibolek/structure-based-trade-management`  
**Implementation branch:** `v24-risk-sizing-phase4`  
**Branch base:** `ee5b84bf525f65e40304764a53d680e87286e062`  
**Design authority:** `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md`  
**Upstream stop authority:** Phase 3 DSS / effective-stop evaluation  
**Downstream broker boundary:** remains read-only; no order placement or broker-write authority added

---

## 1. Closeout decision

ExecutionOS V2.4 **Phase 4 — Effective-Stop Risk Sizing** is accepted as implementation-complete and merge-ready as of 2026-09-01.

Phase 4 now deterministically answers the question:

> Given the exact effective stop established by Phase 3, the current expected entry, the exact execution account's current net-liquidation equity, and verified instrument sizing metadata, what is the maximum valid position size whose planned price risk does not exceed 0.5% of account equity?

The governing invariant is preserved end to end:

> **Phase 3 determines the correct stop. Phase 4 determines whether and how large we can afford to trade against that stop. Phase 4 never changes the stop.**

The implemented chain is:

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
ARMED
```

No broker order is placed by this chain.

---

## 2. Accepted Phase 4 scope

Phase 4 implementation includes:

- versioned trusted risk-sizing policy;
- deterministic expected-entry resolution for `MARKETABLE_NOW` and `STOP_TRIGGER` entry semantics;
- strict bid/ask quote validation and five-second quote freshness;
- exact execution-account resolution and normalized Schwab net-liquidation account equity;
- 15-second account-risk snapshot freshness;
- USD-only V2.4 account/instrument currency contract;
- normalized equity and futures sizing metadata;
- exact futures tick-risk conversion and protective risk-tick ceiling;
- deterministic 0.5% risk-budget calculation with downward cent rounding;
- deterministic quantity calculation with downward-only quantity rounding;
- odd-lot equity support and no fractional-share assumption;
- `NO_AFFORDABLE_SIZE` business outcome when minimum valid size cannot fit;
- exact planned-risk invariant enforcement;
- immutable `RiskEvaluation` construction and append-only persistence;
- exact candidate / DSS / account / quote / instrument / calculation provenance;
- deterministic input fingerprints while preserving unique evaluation identities;
- Phase 4 status semantics: `VALID`, `NO_AFFORDABLE_SIZE`, `BLOCKED`, `ERROR`;
- narrow permission handoff semantics;
- `NO_AFFORDABLE_SIZE → PASS — STOP_RISK_CONFLICT` permission mapping;
- separate ARM-time DSS freshness validation for `READY` / `CAUTION`;
- mandatory fresh Phase 4 re-evaluation on every ARM attempt;
- selected-quantity validation against the exact fresh risk evaluation;
- exact immutable ARM-risk provenance;
- final ARM authorization freshness rechecks;
- atomic freeze of exact DSS, risk-evaluation, and selected-quantity provenance;
- rollback of the in-memory ARM transition if state persistence fails;
- transition to `ARMED` without granting broker-order authority.

---

## 3. Frozen Phase 4 risk policy

The accepted V1 policy is:

| Item | Accepted rule |
|---|---|
| Risk fraction | `0.005` = 0.5% |
| Risk basis | Planned price risk from `currentExpectedEntry` to Phase 3 `effectiveStop` |
| Account equity | Exact execution account current net-liquidation / liquidation value |
| Risk-budget rounding | Down to the cent; never upward |
| Quote maximum age | 5 seconds |
| Account snapshot maximum age | 15 seconds |
| Supported asset types | `EQUITY`, `FUTURE` |
| Supported account/instrument currency | USD only in V2.4 |
| Equity minimum quantity | 1 share |
| Equity quantity increment | 1 share |
| Futures minimum quantity | 1 contract unless trusted metadata specifies otherwise |
| Quantity rounding | Down to valid increment only |
| Stop adjustment to fit risk | Prohibited |
| Arbitrary notional cap at account equity | None in Phase 4 |
| Portfolio heat / margin / buying-power gate | Deferred / separate layer |
| Slippage buffer in planned risk | None in V2.4 |

A position may have notional exposure greater than account equity if planned stop risk remains within 0.5%. Broker buying power and margin eligibility are separate concerns and do not change the Phase 4 stop-risk calculation.

---

## 4. Expected-entry semantics

Phase 4 uses a conservative current expected entry rather than last/mark fallback.

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

- bid must be positive;
- ask must be positive;
- `bid <= ask`;
- locked markets are valid;
- crossed markets block;
- required quote side must exist;
- quote age must be at most five seconds;
- no fallback to mark, last, prior quote, or candle close.

Directional stop geometry is mandatory:

```text
LONG:  currentExpectedEntry > effectiveStop
SHORT: currentExpectedEntry < effectiveStop
```

Invalid geometry fails closed.

---

## 5. Account-risk snapshot

The Schwab account-risk provider uses the exact execution account and normalizes:

```text
currentBalances.liquidationValue
```

as Phase 4 `accountEquity`.

It does not substitute:

- current cash;
- buying power;
- available funds;
- margin excess;
- initial balances;
- another account;
- `currentBalances.equity` when authoritative liquidation value is absent.

The account snapshot carries:

```text
accountId
accountEquity
currency
observedAt
ageMs
source
sourceSnapshotId
```

The maximum valid snapshot age is 15 seconds. Invalid, missing, stale, zero, negative, unsupported-currency, or unresolved-account data blocks sizing.

---

## 6. Instrument sizing metadata

### Equities

Phase 4 equity sizing uses:

```text
assetType = EQUITY
currency = USD
minimumQuantity = 1
quantityIncrement = 1
```

A Phase 3 price-increment resolver is not required for Phase 4 equity dollar-risk conversion. Phase 3 price-increment logic remains responsible for effective-stop price rounding.

### Futures

Phase 4 futures sizing metadata supports:

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

For futures:

```text
riskTicks = ceil(riskDistance / tickSize)
riskPerContract = riskTicks × tickValue
```

If `pointValue` exists, `tickSize × pointValue` must agree with `tickValue`; otherwise metadata is inconsistent and sizing blocks.

---

## 7. Deterministic risk calculation

The calculator uses exact decimal/rational arithmetic at hard boundaries rather than trusting binary floating-point rounding.

### Risk budget

```text
rawMaxDollarRisk = accountEquity × 0.005
maxDollarRisk = floorToCent(rawMaxDollarRisk)
```

### Equity risk

```text
LONG riskDistance  = currentExpectedEntry - effectiveStop
SHORT riskDistance = effectiveStop - currentExpectedEntry
riskPerShare = riskDistance
```

### Futures risk

```text
riskTicks = ceil(riskDistance / tickSize)
riskPerContract = riskTicks × tickValue
```

### Quantity

```text
rawQuantity = maxDollarRisk / riskPerUnit
finalQuantity = floor(rawQuantity / quantityIncrement) × quantityIncrement
```

Phase 4 may only round quantity downward.

If:

```text
finalQuantity < minimumQuantity
```

then the result is:

```text
NO_AFFORDABLE_SIZE
MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET
```

For a valid size:

```text
plannedDollarRisk = finalQuantity × riskPerUnit
plannedDollarRisk <= maxDollarRisk
plannedRiskFraction <= 0.005
```

Violation of those trusted invariants is an `ERROR`, not a normal trading outcome.

---

## 8. Phase 4 status and permission semantics

Phase 4 statuses are exactly:

```text
VALID
NO_AFFORDABLE_SIZE
BLOCKED
ERROR
```

Precedence is:

```text
ERROR > BLOCKED > NO_AFFORDABLE_SIZE > VALID
```

Downstream mapping is:

| Phase 4 status | Permission consequence |
|---|---|
| `VALID` | Continue permission evaluation |
| `NO_AFFORDABLE_SIZE` | `PASS — STOP_RISK_CONFLICT` |
| `BLOCKED` | Permission cannot advance |
| `ERROR` | Fail closed |

Phase 4 does not itself emit `READY`, `CAUTION`, or `PASS` and never manufactures `CAUTION`.

---

## 9. Immutable RiskEvaluation and persistence

Every attempted Phase 4 evaluation produces a unique immutable `riskEvaluationId` when a valid Phase 3 DSS handoff exists and Phase 4 execution reaches the evaluation boundary.

The immutable record links:

```text
candidateId
candidateVersion
candidateHash
      ↓
dssEvaluationId
effectiveStop
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

The repository is append-only.

Accepted behavior:

- evaluation IDs may not be reused;
- identical inputs may produce separate evaluation IDs;
- identical inputs produce the same deterministic input fingerprint;
- `BLOCKED`, `ERROR`, and `NO_AFFORDABLE_SIZE` records are retained when an evaluation record can validly be constructed;
- corrupted persisted evaluation contracts fail closed on load;
- duplicate persisted IDs fail closed;
- historical evaluations are never mutated into a newer truth.

---

## 10. Permission-time orchestration

`RiskSizingPermissionService` orchestrates:

```text
fresh VALID DSS handoff
        ↓
quote / ExpectedEntryResolver
        ↓
AccountRiskProvider
        ↓
InstrumentSizingMetadataProvider
        ↓
RiskSizingCalculator
        ↓
RiskEvaluation
        ↓
append-only persistence
        ↓
narrow Phase 4 permission result
```

Independent live prerequisites are read together where appropriate so multiple observable blockers can be preserved without running sizing against incomplete inputs.

A stale or invalid Phase 3 DSS fails before Phase 4 live reads and before Phase 4 risk-evaluation persistence.

Each permission evaluation that reaches Phase 4 creates a new immutable Phase 4 evaluation. Phase 4 does not persist on every quote tick while a candidate merely waits.

---

## 11. ARM-time fresh risk sizing

Every ARM attempt requires a brand-new Phase 4 evaluation.

The ARM path accepts only:

```text
READY
CAUTION
```

and first proves that the exact current Phase 3 DSS is:

- present;
- `VALID`;
- non-stale;
- candidate-identity consistent;
- not already authorized/frozen.

Then the system obtains fresh Phase 4 inputs and persists a new `riskEvaluationId`.

There is no rule that a recent permission-time risk evaluation is "fresh enough" for ARM. ARM always re-evaluates.

After `ARMED`, automatic Phase 4 recalculation is prohibited.

---

## 12. Selected quantity and ARM provenance

The Phase 4 calculated `finalQuantity` is a maximum risk-affordable quantity, not a mandatory trade size.

The selected quantity may be smaller, provided it satisfies trusted minimum/increment metadata.

```text
selectedQuantity <= finalQuantity
```

Examples:

```text
maxAffordableQuantity = 90
90 → valid
50 → valid
91 → QUANTITY_EXCEEDS_RISK_LIMIT
```

A smaller selected quantity does not alter:

- the Phase 3 structural invalidation;
- the Phase 3 effective stop;
- the immutable Phase 4 risk evaluation.

The exact ARM-risk provenance is:

```text
candidateVersion
dssEvaluationId
riskEvaluationId
selectedQuantity
```

---

## 13. Final ARM authorization and freeze

Authorization uses a two-layer validation boundary:

1. Reload the exact immutable `riskEvaluationId` and reconstruct/validate the ARM-risk handoff.
2. Recheck final candidate state and atomically freeze authorization provenance.

At authorization, the system rechecks:

- candidate source/identity;
- `READY` / `CAUTION` lifecycle;
- current DSS identity;
- DSS non-staleness;
- risk-evaluation validity;
- selected quantity versus exact maximum and increment;
- quote age at authorization, maximum five seconds;
- account snapshot age at authorization, maximum 15 seconds.

A successful authorization freezes:

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

If persistence fails, the in-memory ARM mutation is rolled back rather than leaving a half-armed candidate.

Authorization returns provenance only. It does not expose broker-order authority.

---

## 14. Final deterministic acceptance gate

The final Phase 4 closeout gate was executed in the user's local Phase 4 worktree on 2026-09-01.

Results:

```text
v24:risk-sizing-test  170/170 PASS
v24:dss-test           91/91 PASS
analytics:test        293/293 PASS
schwab:state-test      10/10 PASS
production build      PASS
```

The full repository test suite completed with zero failures.

The frozen V2.3 deterministic trade-state suite remained 10/10 green, covering:

- flat → long entry;
- long add;
- long partial;
- long → flat;
- long → short reversal;
- flat → short entry;
- short add;
- short partial cover;
- short → flat;
- short → long reversal.

The focused Phase 4 suite includes coverage for:

- expected-entry semantics and quote freshness;
- account-equity semantics and account freshness;
- equity and futures instrument metadata;
- exact risk arithmetic and quantity boundaries;
- immutable risk evaluation/persistence;
- end-to-end permission sizing;
- ARM DSS handoff;
- mandatory ARM-time Phase 4 refresh;
- selected quantity / provenance validation;
- permission status mapping;
- final atomic authorization/freeze;
- stale quote/account at authorization;
- changed DSS after preparation;
- tampered provenance;
- duplicate authorization;
- persistence rollback;
- no broker-order authority.

---

## 15. Safety and authority boundary at closeout

Phase 4 has authority to:

- calculate maximum planned-risk-affordable size from the Phase 3 effective stop;
- produce immutable risk evaluations;
- map sizing outcomes into a narrow permission consequence;
- validate a selected quantity;
- freeze exact risk/DSS/quantity provenance into `ARMED` state.

Phase 4 does **not** have authority to:

- change structural invalidation;
- change the Phase 3 effective stop;
- place a broker order;
- modify a broker order;
- cancel an order;
- replace a stop order;
- flatten a position;
- claim ownership of a broker fill;
- change trusted V2.3 execution-management semantics.

The Schwab market/account-data path used here remains read-only.

`ARMED` is an internal authorization state, not proof that an order has been submitted or filled.

---

## 16. Phase 3 → Phase 4 → downstream authority chain

The accepted authority chain is now:

```text
Candidate / structure authority
        ↓
Phase 3 DSS
  structural invalidation
  effectiveStop
  dssEvaluationId
        ↓
Phase 4 risk sizing
  currentExpectedEntry
  account equity
  instrument conversion
  maxAffordableQuantity
  riskEvaluationId
        ↓
Permission consequence
        ↓
READY / CAUTION only when broader permission logic allows
        ↓
ARM attempt
        ↓
fresh Phase 4 evaluation
        ↓
selected quantity validation
        ↓
exact provenance freeze
        ↓
ARMED
```

The existing V2.3 Execution Board and broker-fill ownership remain downstream and separate.

---

## 17. Known follow-up / deferred work

The following are intentionally outside this Phase 4 closeout and are not Phase 4 defects:

1. **Broader context / decision-gate logic** that determines when otherwise valid candidates become `READY`, `CAUTION`, or `PASS` beyond the implemented risk-sizing consequence.
2. **ARM-to-existing-V2.3 Execution Board transfer/integration** and any explicit execution-contract binding required after internal `ARMED` state.
3. **Broker write / order placement** capability; no such authority is added here.
4. **Buying-power / margin / broker-eligibility gate** separate from planned stop-risk sizing.
5. **Portfolio heat / aggregate concurrent risk** beyond per-trade 0.5% planned risk.
6. **Non-USD currency conversion**.
7. **Additional asset types** beyond equities and futures.
8. **Fractional-share support** if a future execution venue requires it.
9. **Slippage/gap/fee loss modeling** beyond planned entry-to-effective-stop price risk.
10. **Disarm/rearm lifecycle integration** beyond the accepted rule that a rearm requires a new permission/ARM risk evaluation.
11. **Operator/UI exposure of Phase 4 sizing and ARM provenance**, where later product work chooses to display it.
12. **Production live smoke acceptance of the complete Phase 4 internal chain**, if/when a safe read-only/synthetic harness is desired; deterministic implementation acceptance is complete without broker writes.

---

## 18. Merge-readiness statement

As of this closeout:

- the Phase 4 branch is based on current `main` commit `ee5b84bf525f65e40304764a53d680e87286e062`;
- the branch is ahead of `main` with no behind/divergence condition observed at final review;
- the Phase 4 implementation is additive to the post-Phase-3 baseline;
- the approved Phase 4 design baseline is committed in the branch;
- all focused, upstream-regression, full-repository, frozen V2.3 state, and production-build gates pass;
- the broker boundary remains read-only;
- the implementation is ready for pull-request review and merge into `main`.

---

**Governing principle:** The stop is a statement about where the trade thesis is invalid. Position size is a statement about how much capital can be risked if that invalidation occurs. Phase 4 may change the second answer. It may never change the first.
