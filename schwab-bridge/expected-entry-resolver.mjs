import { RISK_SIZING_POLICY_VERSION, riskSizingPolicyForVersion } from "./risk-sizing-policy.mjs";

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function text(value) {
  return String(value ?? "").trim();
}

function finiteNumber(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function timestampMs(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function blocked(reasonCode, partial = {}) {
  return {
    ...partial,
    status: "BLOCKED",
    reasonCodes: [reasonCode],
  };
}

function quoteProvenance({ bid, ask, quoteObservedAt, quoteAgeMs, quoteSource }) {
  return {
    bid,
    ask,
    quoteObservedAt,
    quoteAgeMs,
    quoteSource,
  };
}

export function resolveExpectedEntry({
  direction,
  entryMode,
  triggerPrice = null,
  effectiveStop,
  quote,
  nowMs = Date.now(),
  policyVersion = RISK_SIZING_POLICY_VERSION,
} = {}) {
  const policy = riskSizingPolicyForVersion(policyVersion);
  if (policy.quoteMaxAgeMs !== 5_000) {
    throw new Error("risk sizing quote freshness policy is unsupported");
  }

  const normalizedDirection = upper(direction);
  if (!["LONG", "SHORT"].includes(normalizedDirection)) {
    throw new Error("direction must be LONG or SHORT");
  }

  const normalizedMode = upper(entryMode);
  if (!["MARKETABLE_NOW", "STOP_TRIGGER"].includes(normalizedMode)) {
    return blocked("UNSUPPORTED_ENTRY_MODE", {
      direction: normalizedDirection,
      entryMode: normalizedMode || null,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
    });
  }

  const evaluatedAtMs = finiteNumber(nowMs);
  if (evaluatedAtMs === null) {
    throw new Error("nowMs must be epoch milliseconds");
  }

  const bid = positiveNumber(quote?.bid);
  const ask = positiveNumber(quote?.ask);
  if (bid === null || ask === null) {
    return blocked("REQUIRED_QUOTE_SIDE_MISSING", {
      direction: normalizedDirection,
      entryMode: normalizedMode,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      bid,
      ask,
      quoteSource: text(quote?.source) || null,
    });
  }

  const quoteTimeMs = timestampMs(quote?.asOf ?? quote?.quoteObservedAt);
  if (quoteTimeMs === null) {
    return blocked("QUOTE_UNAVAILABLE", {
      direction: normalizedDirection,
      entryMode: normalizedMode,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      bid,
      ask,
      quoteSource: text(quote?.source) || null,
    });
  }

  const quoteObservedAt = new Date(quoteTimeMs).toISOString();
  const quoteAgeMs = Math.max(0, evaluatedAtMs - quoteTimeMs);
  const quoteSource = text(quote?.source) || null;
  const provenance = quoteProvenance({ bid, ask, quoteObservedAt, quoteAgeMs, quoteSource });

  if (bid > ask) {
    return blocked("CROSSED_MARKET", {
      direction: normalizedDirection,
      entryMode: normalizedMode,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      ...provenance,
    });
  }

  if (quoteAgeMs > policy.quoteMaxAgeMs) {
    return blocked("QUOTE_STALE", {
      direction: normalizedDirection,
      entryMode: normalizedMode,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      quoteMaxAgeMs: policy.quoteMaxAgeMs,
      ...provenance,
    });
  }

  let normalizedTriggerPrice = null;
  if (normalizedMode === "STOP_TRIGGER") {
    normalizedTriggerPrice = positiveNumber(triggerPrice);
    if (normalizedTriggerPrice === null) {
      return blocked("INVALID_TRIGGER_PRICE", {
        direction: normalizedDirection,
        entryMode: normalizedMode,
        policyId: policy.policyId,
        policyVersion: policy.policyVersion,
        ...provenance,
      });
    }
  }

  let currentExpectedEntry;
  let expectedEntryRule;
  if (normalizedMode === "MARKETABLE_NOW") {
    if (normalizedDirection === "LONG") {
      currentExpectedEntry = ask;
      expectedEntryRule = "ASK_MARKETABLE_LONG";
    } else {
      currentExpectedEntry = bid;
      expectedEntryRule = "BID_MARKETABLE_SHORT";
    }
  } else if (normalizedDirection === "LONG") {
    currentExpectedEntry = Math.max(normalizedTriggerPrice, ask);
    expectedEntryRule = "MAX_TRIGGER_ASK_STOP_LONG";
  } else {
    currentExpectedEntry = Math.min(normalizedTriggerPrice, bid);
    expectedEntryRule = "MIN_TRIGGER_BID_STOP_SHORT";
  }

  const stop = finiteNumber(effectiveStop);
  if (stop === null) {
    return blocked("INVALID_ENTRY_STOP_GEOMETRY", {
      direction: normalizedDirection,
      entryMode: normalizedMode,
      triggerPrice: normalizedTriggerPrice,
      currentExpectedEntry,
      expectedEntryRule,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      ...provenance,
    });
  }

  const validGeometry = normalizedDirection === "LONG"
    ? currentExpectedEntry > stop
    : currentExpectedEntry < stop;
  if (!validGeometry) {
    return blocked("INVALID_ENTRY_STOP_GEOMETRY", {
      direction: normalizedDirection,
      entryMode: normalizedMode,
      triggerPrice: normalizedTriggerPrice,
      currentExpectedEntry,
      effectiveStop: stop,
      expectedEntryRule,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      ...provenance,
    });
  }

  return {
    status: "VALID",
    reasonCodes: [],
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    direction: normalizedDirection,
    entryMode: normalizedMode,
    triggerPrice: normalizedTriggerPrice,
    currentExpectedEntry,
    effectiveStop: stop,
    expectedEntryRule,
    quoteMaxAgeMs: policy.quoteMaxAgeMs,
    ...provenance,
  };
}
