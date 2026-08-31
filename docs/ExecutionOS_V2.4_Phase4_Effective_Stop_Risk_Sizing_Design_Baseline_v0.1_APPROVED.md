# ExecutionOS V2.4 - Phase 4 Effective-Stop Risk Sizing Design Baseline v0.1

**Status:** APPROVED  
**Implementation branch:** `v24-risk-sizing-phase4`  
**Date:** 2026-08-31

---

## 1. Purpose

Phase 4 determines whether a candidate can be traded within the configured account-risk budget using the exact effective stop produced by Phase 3.

The governing invariant is:

> **Phase 3 determines the correct stop. Phase 4 determines whether and how large we can afford to trade against that stop. Phase 4 never changes the stop.**

Phase 4 consumes an immutable, fresh, `VALID` Phase 3 DSS evaluation containing the exact `dssEvaluationId`, structural invalidation, and `effectiveStop`.

Phase 4 does not own:

- structural invalidation
- effective-stop calculation
- setup-quality decisions
- READY / CAUTION / PASS decisions except through its defined downstream mapping
- buying-power or margin policy
- portfolio heat
- broker-write authority
- order placement
- ARM authority

---

## 2. Permanent Risk Rule

Maximum planned stop risk per trade is:

```text
0.5% of current trading-account equity
```

Therefore:

```text
riskFraction = 0.005
rawMaxDollarRisk = accountEquity x riskFraction
```

The usable risk budget is floored to the nearest cent:

```text
maxDollarRisk = FLOOR_TO_CENT(rawMaxDollarRisk)
```

Rounding may never increase the permitted risk above 0.5%.

The rule is:

> If the correct effective stop cannot fit the risk budget, reduce quantity or pass. Never tighten the stop merely to make the trade affordable.

---

## 3. Phase 3 -> Phase 4 Handoff

Phase 4 requires:

```text
candidate identity/version/hash
VALID non-stale dssEvaluationId
structuralInvalidation
effectiveStop
DSS provenance
```

Phase 4 independently resolves:

```text
currentExpectedEntry
account-risk snapshot
instrument sizing metadata
```

Every Phase 4 evaluation must reference the exact Phase 3:

```text
dssEvaluationId
```

Phase 4 may never modify:

```text
structuralInvalidation
effectiveStop
```

---

## 4. Decision 1 - Current Expected Entry

### 4.1 Definition

`currentExpectedEntry` is:

> The conservative price Phase 4 should assume the trade would enter at if permission were granted under the candidate's current entry semantics.

It is a risk-sizing estimate, not fair value or an execution guarantee.

### 4.2 Supported entry modes

V2.4 Phase 4 initially supports exactly:

```text
MARKETABLE_NOW
STOP_TRIGGER
```

Unsupported modes return:

```text
BLOCKED
UNSUPPORTED_ENTRY_MODE
```

### 4.3 Marketable entries

LONG:

```text
currentExpectedEntry = ask
```

SHORT:

```text
currentExpectedEntry = bid
```

`mark` and `last` are not primary sizing prices.

### 4.4 Stop-trigger entries

LONG:

```text
currentExpectedEntry = max(triggerPrice, ask)
```

SHORT:

```text
currentExpectedEntry = min(triggerPrice, bid)
```

A trigger price never eliminates the requirement for a fresh quote.

### 4.5 Quote validity

Require:

```text
bid > 0
ask > 0
bid <= ask
required quote side present
quoteAge <= 5 seconds
```

A locked market:

```text
bid == ask
```

is valid.

A crossed market:

```text
bid > ask
```

returns:

```text
BLOCKED
CROSSED_MARKET
```

Missing required quote side:

```text
BLOCKED
REQUIRED_QUOTE_SIDE_MISSING
```

Stale quote:

```text
BLOCKED
QUOTE_STALE
```

Phase 4 uses the same five-second maximum quote age as Phase 3.

### 4.6 Wide spreads

Phase 4 does not apply an arbitrary spread-width rejection threshold.

The executable-side price naturally increases risk distance and reduces affordable quantity.

Liquidity/spread-quality rejection belongs outside Phase 4.

### 4.7 Directional risk geometry

Production risk geometry must be direction-aware.

LONG:

```text
riskDistance =
    currentExpectedEntry - effectiveStop
```

Require:

```text
currentExpectedEntry > effectiveStop
```

SHORT:

```text
riskDistance =
    effectiveStop - currentExpectedEntry
```

Require:

```text
currentExpectedEntry < effectiveStop
```

`abs(currentExpectedEntry - effectiveStop)` is prohibited as the validation rule.

Invalid geometry returns:

```text
BLOCKED
INVALID_ENTRY_STOP_GEOMETRY
```

---

## 5. Decision 2 - Account-Risk Snapshot

### 5.1 Account-equity definition

`accountEquity` means:

> Current net-liquidation/account-equity value of the exact trading account in which the candidate would be executed.

It does not mean:

- cash balance
- buying power
- day-trading buying power
- settled cash
- available funds
- margin excess

### 5.2 Account identity

Phase 4 must resolve the exact trading account.

Failure:

```text
BLOCKED
ACCOUNT_NOT_RESOLVED
```

No implicit default account is allowed.

### 5.3 Normalized contract

```text
AccountRiskSnapshot
{
    accountId
    accountEquity
    currency
    observedAt
    ageMs
    source
    sourceSnapshotId?
}
```

Broker-specific transport fields remain behind `AccountRiskProvider`.

### 5.4 Freshness

Maximum account snapshot age:

```text
15 seconds
```

Stale snapshot:

```text
BLOCKED
ACCOUNT_SNAPSHOT_STALE
```

Unavailable snapshot:

```text
BLOCKED
ACCOUNT_SNAPSHOT_UNAVAILABLE
```

Invalid equity:

```text
BLOCKED
ACCOUNT_EQUITY_INVALID
```

### 5.5 Net liquidation is not a notional-position cap

Phase 4 does **not** impose:

```text
positionNotional <= accountEquity
```

A position may have a notional value greater than account equity if its planned loss at the effective stop remains within the 0.5% budget.

Buying-power and margin constraints are separate downstream controls.

### 5.6 Existing P/L

Current broker-reported account equity is the authoritative input.

Phase 4 does not manually reconstruct equity from realized and unrealized P/L.

---

## 6. Decision 3 - Instrument-Value Metadata and Sizing Conversion

Initially supported asset classes:

```text
EQUITY
FUTURE
```

Unsupported classes:

```text
BLOCKED
UNSUPPORTED_ASSET_TYPE
```

### 6.1 Equities

LONG:

```text
riskPerShare =
    currentExpectedEntry - effectiveStop
```

SHORT:

```text
riskPerShare =
    effectiveStop - currentExpectedEntry
```

Then:

```text
rawQuantity =
    maxDollarRisk / riskPerShare
```

### 6.2 Futures

Required metadata:

```text
tickSize
tickValue
minimumQuantity
quantityIncrement
currency
```

Optional cross-check metadata:

```text
pointValue
```

Directional `riskDistance` is converted to ticks:

```text
riskTicks =
    CEILING(riskDistance / tickSize)
```

Risk ticks are always rounded protectively upward.

Then:

```text
riskPerContract =
    riskTicks x tickValue
```

and:

```text
rawQuantity =
    maxDollarRisk / riskPerContract
```

### 6.3 Metadata consistency

When `pointValue` is present:

```text
tickValue ~= tickSize x pointValue
```

Material disagreement returns:

```text
BLOCKED
INSTRUMENT_METADATA_INCONSISTENT
```

Phase 4 may not silently choose between contradictory metadata fields.

### 6.4 Currency

Account-risk currency and instrument-risk currency must match.

Currency mismatch returns:

```text
BLOCKED
CURRENCY_CONVERSION_UNSUPPORTED
```

FX conversion is outside V2.4 Phase 4.

---

## 7. Decision 4 - Quantity Rules

### 7.1 General invariant

Quantity may only be rounded downward.

Never upward.

General rule:

```text
finalQuantity =
    floor(rawQuantity / quantityIncrement)
    x quantityIncrement
```

Require:

```text
finalQuantity >= minimumQuantity
```

### 7.2 Equities

```text
minimumQuantity   = 1 share
quantityIncrement = 1 share
fractional shares = unsupported
odd lots          = allowed
```

### 7.3 Futures

Normally:

```text
minimumQuantity   = 1 contract
quantityIncrement = 1 contract
```

Instrument metadata may define another valid increment if required.

### 7.4 Maximum affordable quantity

`finalQuantity` means:

> Maximum risk-affordable quantity.

It is not necessarily the quantity ultimately traded.

Later:

```text
selectedQuantity <= finalQuantity
```

is valid.

A quantity above `finalQuantity` is prohibited without a new valid sizing evaluation.

### 7.5 Minimum size failure

If:

```text
rawQuantity < minimumQuantity
```

return:

```text
NO_AFFORDABLE_SIZE
```

with:

```text
MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET
```

### 7.6 Planned-risk recomputation

After rounding:

```text
plannedDollarRisk =
    finalQuantity x riskPerUnit
```

Require:

```text
plannedDollarRisk <= maxDollarRisk
```

Violation after validated inputs is:

```text
ERROR
RISK_INVARIANT_VIOLATION
```

---

## 8. Decision 5 - Phase 4 Status Vocabulary

Exactly four statuses exist:

```text
VALID
NO_AFFORDABLE_SIZE
BLOCKED
ERROR
```

### 8.1 VALID

All prerequisites are valid and at least one valid unit fits the risk budget.

`VALID` means only:

> The candidate can be sized within the Phase 4 stop-risk constraint.

It does not grant READY or ARM authority.

### 8.2 NO_AFFORDABLE_SIZE

All inputs and calculations are valid, but even minimum quantity exceeds the risk budget.

This is a valid business result, not a failure.

### 8.3 BLOCKED

Safe sizing cannot be performed because a prerequisite is:

- missing
- stale
- unsupported
- invalid

### 8.4 ERROR

Reserved for unexpected software/runtime/invariant failures.

### 8.5 Reason codes

Persist:

```text
reasonCodes[]
```

`VALID` has an empty list.

Multiple independently observable blockers may be retained.

Do not derive downstream reason codes after a prerequisite makes the downstream calculation unsafe.

### 8.6 Status precedence

```text
ERROR
BLOCKED
NO_AFFORDABLE_SIZE
VALID
```

Affordability is only meaningful after all prerequisites are valid.

---

## 9. Decision 6 - Immutable Risk-Evaluation Contract

Every Phase 4 evaluation is:

> An immutable historical fact.

Once persisted, it is never edited or replaced.

Changed inputs produce:

```text
new riskEvaluationId
```

### 9.1 Conceptual schema

```text
RiskEvaluation
{
  schemaVersion

  riskEvaluationId
  evaluatedAt

  candidate
  {
    candidateId
    candidateVersion
    candidateHash
    symbol
    direction
  }

  dss
  {
    dssEvaluationId
    structuralInvalidation
    effectiveStop
  }

  entry
  {
    entryMode
    triggerPrice?

    currentExpectedEntry

    bid?
    ask?

    quoteObservedAt
    quoteAgeMs
    quoteSource

    expectedEntryRule
  }

  account
  {
    accountId
    accountEquity
    accountCurrency

    snapshotObservedAt
    snapshotAgeMs
    snapshotSource
    sourceSnapshotId?

    riskFraction
    rawMaxDollarRisk
    maxDollarRisk
    budgetRoundingRule
  }

  instrument
  {
    assetType
    instrumentCurrency

    minimumQuantity
    quantityIncrement

    tickSize?
    tickValue?
    pointValue?

    metadataSource
    metadataObservedAt?
    metadataVersion?
  }

  calculation
  {
    riskDistance
    riskTicks?
    riskPerUnit

    rawQuantity
    finalQuantity
    quantityRoundingRule

    plannedDollarRisk
    plannedRiskFraction
  }

  status
  reasonCodes[]

  inputFingerprint
}
```

### 9.2 Phase 3 values

Phase 4 persists copied immutable values:

```text
structuralInvalidation
effectiveStop
```

for auditability, while `dssEvaluationId` remains their authoritative provenance link.

Phase 4 never reinterprets them.

### 9.3 Input fingerprint

`inputFingerprint` deterministically identifies materially equivalent input sets.

Identical fingerprints do **not** cause reuse of `riskEvaluationId`.

Two runtime evaluations remain two separate immutable historical events.

### 9.4 Persist all outcomes

Persist:

```text
VALID
NO_AFFORDABLE_SIZE
BLOCKED
ERROR
```

not only successful evaluations.

### 9.5 VALID invariants

A persisted `VALID` evaluation requires:

```text
dssEvaluationId present
currentExpectedEntry present
effectiveStop present
riskDistance > 0
riskPerUnit > 0
accountEquity > 0
maxDollarRisk > 0
rawQuantity >= finalQuantity
finalQuantity >= minimumQuantity
plannedDollarRisk <= maxDollarRisk
plannedRiskFraction <= 0.005
reasonCodes is empty
```

---

## 10. Decision 7 - Recalculation, Freshness, and Staleness

### 10.1 WAITING

Do not continuously calculate Phase 4 while a candidate is merely:

```text
WAITING
```

Quote ticks alone do not cause persisted Phase 4 evaluations.

### 10.2 Permission evaluation

Each new logical:

```text
PERMISSION_EVALUATING
```

cycle obtains current required inputs and produces a new immutable Phase 4 evaluation.

### 10.3 Phase 3 dependency

A stale Phase 3 DSS evaluation may never be used for new Phase 4 sizing.

A newly completed 2-minute bar makes the prior active DSS evaluation stale under the frozen Phase 3 rules.

Therefore:

```text
new completed 2m bar
        |
        v
refresh Phase 3 DSS
        |
        v
obtain new VALID dssEvaluationId
        |
        v
run new Phase 4 evaluation
```

### 10.4 Freshness

Quote:

```text
<= 5 seconds
```

Account snapshot:

```text
<= 15 seconds
```

An immutable evaluation may remain historically valid while becoming unusable for a new current decision.

### 10.5 No material-move threshold

There is no rule such as:

```text
recalculate only if price moved X cents
```

New permission evaluation uses the current valid inputs.

### 10.6 ARM

Every ARM attempt requires a newly generated Phase 4 risk evaluation.

ARM must not merely reuse the previous displayed risk evaluation.

At ARM:

```text
verify current VALID DSS
obtain fresh quote
obtain fresh-enough account snapshot
resolve currentExpectedEntry
recalculate risk sizing
persist new riskEvaluationId
freeze exact riskEvaluationId with ARM
```

### 10.7 After ARM

No automatic Phase 4 recalculation occurs after ARM.

If a candidate is disarmed and later rearmed:

```text
new permission evaluation
new Phase 4 evaluation
new riskEvaluationId
```

---

## 11. Decision 8 - Permission-Engine Handoff

Phase 4 never emits:

```text
READY
CAUTION
PASS
```

directly.

It returns the narrow risk result.

Conceptual handoff:

```text
RiskSizingPermissionResult
{
    riskEvaluationId
    dssEvaluationId

    status

    maxAffordableQuantity

    plannedDollarRisk
    plannedRiskFraction

    reasonCodes[]
}
```

`maxAffordableQuantity` represents the persisted Phase 4 `finalQuantity`.

### 11.1 Permission mapping

```text
VALID
    -> continue permission evaluation
```

```text
NO_AFFORDABLE_SIZE
    -> PASS - STOP_RISK_CONFLICT
```

```text
BLOCKED
    -> permission cannot advance
```

```text
ERROR
    -> permission cannot advance / fail closed
```

### 11.2 CAUTION

Phase 4 never produces CAUTION.

Risk affordability is:

- valid
- unaffordable
- indeterminable because blocked
- failed because of system error

There is no "partially affordable" state.

### 11.3 Selected quantity

Later ARM logic may choose:

```text
selectedQuantity <= maxAffordableQuantity
```

A smaller quantity does not require a new risk evaluation solely because it is smaller.

Attempting:

```text
selectedQuantity > maxAffordableQuantity
```

must fail.

The effective stop may never be altered to accommodate a larger desired quantity.

---

## 12. Planned Risk vs Realized Loss

The 0.5% invariant applies to:

> **Planned price risk from expected entry to the effective stop.**

It does not guarantee that realized loss can never exceed 0.5%.

Realized loss may differ because of:

- slippage
- gaps
- commissions
- exchange fees
- liquidity events

Phase 4 does not add speculative slippage or fee buffers in V2.4.

---

## 13. Buying Power, Margin, and Notional Exposure

Phase 4 does not determine:

```text
buying-power sufficiency
margin sufficiency
position-notional limits
```

Therefore a Phase 4 `VALID` position may still be rejected or reduced later by account/broker permission logic.

A position's notional value may exceed account equity while remaining Phase 4-valid if the planned loss at the effective stop remains within the 0.5% risk budget.

---

## 14. Portfolio Risk Scope

Phase 4 is a per-trade stop-risk sizing engine.

It does not evaluate:

- aggregate open risk
- correlated positions
- daily loss limits
- sector concentration
- portfolio heat
- simultaneous-candidate exposure

These belong to broader permission/risk-policy layers.

---

## 15. Numerical Precision

Phase 4 must not rely on ordinary binary floating-point behavior for hard financial invariants.

Use deterministic:

- decimal/fixed-point arithmetic, or
- integerized monetary/tick representations

for:

```text
accountEquity
currentExpectedEntry
effectiveStop
riskDistance
risk budget
tick values
riskPerUnit
plannedDollarRisk
```

Tests must cover:

- exactly 0.5%
- one minimal currency unit below
- one minimal currency unit above
- exact integer quantity boundaries
- values immediately below integer quantity boundaries
- tick-grid boundaries
- futures protective tick rounding

---

## 16. Canonical Phase 4 Data Flow

```text
candidate identity/version
        |
        v
exact fresh VALID dssEvaluationId
        |
        v
immutable effectiveStop
        |
        v
fresh expected-entry resolution
        |
        v
directional entry/stop geometry validation
        |
        v
fresh account-risk snapshot
        |
        v
0.5% risk budget
        |
        v
instrument sizing metadata
        |
        v
risk per share / contract
        |
        v
raw quantity
        |
        v
protective downward quantity rounding
        |
        v
planned-risk verification
        |
        v
immutable riskEvaluationId
        |
        v
VALID / NO_AFFORDABLE_SIZE / BLOCKED / ERROR
        |
        v
permission engine
```

---

## 17. Frozen Phase 4 Invariants

1. Phase 4 consumes only a fresh, non-stale `VALID` Phase 3 DSS evaluation.
2. Every risk evaluation references the exact `dssEvaluationId`.
3. Phase 4 independently resolves fresh `currentExpectedEntry`.
4. Phase 4 independently obtains fresh account-risk information.
5. Maximum planned stop risk is 0.5% of current account equity.
6. Position sizing is based exclusively on the Phase 3 `effectiveStop`.
7. Phase 4 may reduce quantity.
8. Phase 4 may never alter structural invalidation.
9. Phase 4 may never alter `effectiveStop`.
10. If minimum valid quantity cannot fit, return `NO_AFFORDABLE_SIZE`.
11. `NO_AFFORDABLE_SIZE` maps downstream to `PASS - STOP_RISK_CONFLICT`.
12. Phase 4 grants no ARM authority.
13. Phase 4 has no broker-write authority.
14. Risk geometry is direction-aware.
15. `abs(entry-stop)` is prohibited as production validity logic.
16. LONG expected entry must remain above the effective stop.
17. SHORT expected entry must remain below the effective stop.
18. Marketable LONG uses ask.
19. Marketable SHORT uses bid.
20. Stop-trigger LONG uses `max(triggerPrice, ask)`.
21. Stop-trigger SHORT uses `min(triggerPrice, bid)`.
22. Quote age may not exceed five seconds.
23. Account-risk snapshot age may not exceed fifteen seconds.
24. Risk budget is never rounded upward.
25. Quantity is never rounded upward.
26. Equities and futures use instrument-appropriate sizing.
27. Futures risk ticks round protectively upward.
28. Phase 4 does not cap position notional to account equity.
29. Phase 4 does not enforce buying power or margin.
30. Phase 4 does not enforce portfolio heat.
31. Phase 4 planned-risk calculations exclude unpredictable slippage and fees.
32. Quote ticks alone do not create new Phase 4 evaluations.
33. New permission cycles create new immutable risk evaluations.
34. ARM requires a fresh Phase 4 evaluation.
35. Exact `riskEvaluationId` freezes at ARM.
36. No automatic Phase 4 recalculation occurs after ARM.
37. Risk evaluations are immutable and append-only.
38. Same inputs do not cause evaluation-ID reuse.
39. Phase 4 never emits CAUTION.
40. A selected quantity may be smaller than the maximum affordable quantity but never larger.

---

## 18. Architecture

Recommended components:

```text
RiskSizingPermissionService
ExpectedEntryResolver
AccountRiskProvider
InstrumentSizingMetadataProvider
RiskSizingCalculator
RiskEvaluationRepository
```

Responsibilities remain separated.

### `RiskSizingPermissionService`

Orchestration and prerequisite validation.

### `ExpectedEntryResolver`

Deterministic executable-entry estimate.

### `AccountRiskProvider`

Broker-independent normalized account-equity snapshot.

### `InstrumentSizingMetadataProvider`

Normalized equity/futures sizing metadata.

### `RiskSizingCalculator`

Pure deterministic sizing mathematics.

### `RiskEvaluationRepository`

Immutable persistence and retrieval.

The architecture continues the project's preference for immutable evaluations, provenance, deterministic tests, fail-closed behavior, clear interfaces, and source/runtime separation.

---

## 19. Implementation Boundary

Implementation must preserve V2.3 and all completed Phase 1-3 behavior.

Do not introduce during Phase 4:

- automatic broker orders
- broker-write authority
- stop modification
- risk-based stop tightening
- macro-volatility stop adjustment
- arbitrary stop clamps
- ARM authority
- unrelated portfolio-risk architecture
- speculative execution features

Implementation should proceed in small, self-contained slices with deterministic tests.

---

## 20. Governing Principle

> **The stop is a statement about where the trade thesis is invalid. Position size is a statement about how much capital we can afford to risk if that invalidation occurs. The risk engine may change the second answer. It may never change the first.**
