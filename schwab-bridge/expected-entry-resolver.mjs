import { RISK_SIZING_POLICY_VERSION, riskSizingPolicyForVersion } from "./risk-sizing-policy.mjs";
import { assessQuoteEvidence, quoteSourceTimestamp, timestampMs } from "./clock-freshness.mjs";

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

function quoteEvidenceReason(reasonCodes = []) {
  if (reasonCodes.includes("QUOTE_NOT_REALTIME")) return "QUOTE_NOT_REALTIME";
  if (reasonCodes.includes("QUOTE_RECEIPT_TIMESTAMP_UNAVAILABLE")) return "QUOTE_RECEIPT_UNAVAILABLE";
  if (reasonCodes.includes("STALE_OR_INVALID_QUOTE_RECEIPT")) return "QUOTE_RECEIPT_STALE";
  if (reasonCodes.includes("QUOTE_SOURCE_RECEIPT_CLOCK_MISMATCH")) return "QUOTE_CLOCK_INCONSISTENT";
  if (reasonCodes.includes("STALE_OR_INVALID_QUOTE_SOURCE")) return "QUOTE_STALE";
  return null;
}

export function resolveExpectedEntry({
  direction,
  entryMode,
  triggerPrice = null,
  effectiveStop,
  quote,
  nowMs = Date.now(),
  policyVersion = RISK_SIZING_POLICY_VERSION,
  quoteEvidencePolicy = null,
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

  const evaluatedAtMs = timestampMs(nowMs);
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

  const quoteTimeMs = timestampMs(quoteSourceTimestamp(quote));
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

  const quoteEvidence = assessQuoteEvidence(quote, {
    nowMs: evaluatedAtMs,
    sourceMaxAgeMs: policy.quoteMaxAgeMs,
    ...(quoteEvidencePolicy || {}),
  });
  const quoteFreshness = quoteEvidence.sourceFreshness;
  const quoteObservedAt = quoteFreshness.asOf;
  const quoteAgeMs = quoteFreshness.ageMs;
  const quoteSource = text(quote?.source) || null;
  const provenance = {
    ...quoteProvenance({ bid, ask, quoteObservedAt, quoteAgeMs, quoteSource }),
    ...(quoteEvidencePolicy ? { quoteEvidence: {
      sourceObservedAt: quoteObservedAt,
      receivedAt: quoteEvidence.receiptFreshness?.asOf ?? null,
      realtime: quoteEvidence.realtime,
      policy: {
        sourceMaxAgeMs: policy.quoteMaxAgeMs,
        receiptMaxAgeMs: quoteEvidencePolicy?.receiptMaxAgeMs ?? policy.quoteMaxAgeMs,
        validateReceivedAt: quoteEvidencePolicy?.validateReceivedAt === true,
        requireReceivedAt: quoteEvidencePolicy?.requireReceivedAt === true,
        requireRealtime: quoteEvidencePolicy?.requireRealtime === true,
        maxFutureSkewMs: quoteEvidencePolicy?.maxFutureSkewMs ?? quoteEvidence.sourceFreshness.maxFutureSkewMs,
      },
    } } : {}),
  };

  if (bid > ask) {
    return blocked("CROSSED_MARKET", {
      direction: normalizedDirection,
      entryMode: normalizedMode,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      ...provenance,
    });
  }

  const evidenceReason = quoteEvidenceReason(quoteEvidence.reasonCodes);
  if (evidenceReason) {
    return blocked(evidenceReason, {
      direction: normalizedDirection,
      entryMode: normalizedMode,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      quoteMaxAgeMs: policy.quoteMaxAgeMs,
      quoteEvidenceReasonCodes: [...quoteEvidence.reasonCodes],
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
