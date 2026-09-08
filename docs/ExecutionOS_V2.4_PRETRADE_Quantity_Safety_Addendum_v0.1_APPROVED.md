# ExecutionOS V2.4 — PRETRADE Quantity Safety Addendum

**Version:** 0.1  
**Status:** APPROVED  
**Scope:** PRETRADE quantity-safety policy layered after Phase 4 effective-stop risk sizing  
**Issue:** TODO #19 — prevent near-stop risk sizing from exploding permitted quantity

## 1. Decision

Phase 4 remains unchanged and continues to size exclusively from the actual `currentExpectedEntry -> effectiveStop` risk distance.

A separate PRETRADE Quantity Safety Policy is applied after a VALID Phase 4 result.

The policy computes a volatility-stress quantity ceiling from the same account risk budget using a **2 × current authoritative 2-minute Wilder ATR(14)** adverse-move distance.

The final review quantity ceiling is the lesser of:

1. the Phase 4 stop-risk maximum quantity;
2. the 2-ATR volatility-stress maximum quantity; and
3. during ARM revalidation, the previously reviewed non-expanding quantity ceiling.

Structural invalidation and `effectiveStop` are never moved by this policy.

## 2. Purpose

A very small entry-to-stop distance can make the mathematical Phase 4 risk per unit temporarily tiny and therefore allow a very large quantity. This is mathematically consistent with the Phase 4 contract but can create excessive exposure relative to the instrument's normal short-term movement.

The quantity-safety layer prevents a temporarily tiny stop distance from mechanically expanding permitted position size beyond a volatility-normalized exposure ceiling.

## 3. Volatility Stress Calculation

For a VALID Phase 4 evaluation and matching VALID DSS evaluation:

```text
stressDistance = 2 × current 2m Wilder ATR(14)
```

For equities:

```text
stressRiskPerUnit = stressDistance
volatilityMaxQuantity = floor_to_valid_increment(maxDollarRisk / stressRiskPerUnit)
```

For futures:

```text
stressTicks = ceil(stressDistance / tickSize)
stressRiskPerUnit = stressTicks × tickValue
volatilityMaxQuantity = floor_to_valid_increment(maxDollarRisk / stressRiskPerUnit)
```

Protective tick rounding is used for the futures stress calculation. The calculation is a sizing constraint only; it does not change the executable stop.

## 4. Policy Maximum

```text
policyMaxQuantity = min(
  phase4MaxAffordableQuantity,
  volatilityMaxQuantity
)
```

If the minimum native quantity cannot fit inside the 2-ATR stress budget, the policy returns no safe quantity and PRETRADE remains fail-closed.

## 5. Review Ceiling

At an explicit operator review, the current `policyMaxQuantity` establishes the review quantity ceiling.

During final ARM revalidation:

```text
finalAllowedQuantity = min(
  freshPhase4MaxQuantity,
  freshVolatilityMaxQuantity,
  previouslyReviewedQuantityCeiling
)
```

Therefore ARM-time revalidation may reduce the quantity ceiling but may not increase it without a new explicit operator review.

This prevents quote drift toward the stop from silently expanding authorization.

## 6. Operator Auditability

The PRETRADE review UI must display separately:

- Phase 4 stop-risk maximum;
- 2-ATR volatility maximum;
- reviewed ceiling;
- final allowed quantity;
- the currently binding constraint;
- 2-minute Wilder ATR(14), stress multiplier, and stress distance.

The UI must state that the effective stop is unchanged and that the final quantity is not a trade recommendation.

## 7. Architectural Boundary

This addendum does not revise the frozen Phase 4 risk-sizing contract.

Phase 4 continues to report actual expected-entry-to-effective-stop risk and `plannedDollarRisk` using the real effective stop.

The PRETRADE Quantity Safety Policy is an independent downstream permission/safety layer that may only reduce a Phase-4-valid quantity.

## 8. Fail-Closed Requirements

Quantity safety must fail closed when required evidence cannot be established, including:

- missing or invalid Phase 4 evidence;
- missing or invalid DSS evidence;
- Phase 4 and DSS evidence identity mismatch;
- missing required ATR data;
- missing futures tick metadata;
- unsupported asset type;
- minimum quantity exceeding the volatility-safety budget.

No failure in this layer may authorize a larger quantity by falling back to a guessed value.

## 9. Broker Boundary

This policy adds no broker-write authority.

ExecutionOS V2.4 remains read-only with respect to broker order placement, replacement, cancellation, and flattening.

## 10. Approved Policy Summary

> Preserve Phase 4 effective-stop risk sizing unchanged. Add a separate PRETRADE quantity-safety layer using a 2 × 2-minute Wilder ATR(14) adverse-move stress ceiling. Final quantity is the lesser of the Phase 4 maximum, the volatility-stress maximum, and any previously reviewed non-expanding ceiling. ARM-time revalidation may reduce but may not increase the reviewed ceiling without a new explicit operator review. Structural invalidation and effective stop remain unchanged.
