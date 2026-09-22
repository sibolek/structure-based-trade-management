export const MAX_FUTURE_CLOCK_SKEW_MS = 2_000;

export const CURRENT_LIVE_QUOTE_EVIDENCE_POLICY = Object.freeze({
  sourceMaxAgeMs: 5_000,
  receiptMaxAgeMs: 5_000,
  validateReceivedAt: true,
  requireReceivedAt: true,
  requireRealtime: true,
});

function timestampMs(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeNumber(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function freshness(asOf, {
  nowMs = Date.now(),
  maxAgeMs,
  maxFutureSkewMs = MAX_FUTURE_CLOCK_SKEW_MS,
} = {}) {
  const timestamp = timestampMs(asOf);
  const current = timestampMs(nowMs);
  const threshold = nonNegativeNumber(maxAgeMs);
  const futureThreshold = nonNegativeNumber(maxFutureSkewMs);
  const base = {
    asOf: timestamp === null ? null : new Date(timestamp).toISOString(),
    ageMs: null,
    maxAgeMs: threshold,
    maxFutureSkewMs: futureThreshold,
    clockSkewMs: null,
    isStale: true,
  };

  if (timestamp === null || current === null || threshold === null || futureThreshold === null) {
    return base;
  }

  const signedAgeMs = current - timestamp;
  if (signedAgeMs < -futureThreshold) {
    return {
      ...base,
      clockSkewMs: -signedAgeMs,
    };
  }

  const ageMs = Math.max(0, signedAgeMs);
  return {
    ...base,
    ageMs,
    clockSkewMs: signedAgeMs < 0 ? -signedAgeMs : 0,
    isStale: ageMs > threshold,
  };
}

export function assessQuoteEvidence(quote, {
  nowMs = Date.now(),
  sourceMaxAgeMs,
  receiptMaxAgeMs = sourceMaxAgeMs,
  validateReceivedAt = false,
  requireReceivedAt = false,
  requireRealtime = false,
  maxFutureSkewMs = MAX_FUTURE_CLOCK_SKEW_MS,
} = {}) {
  const sourceTimestamp = quote?.quoteTime ?? quote?.asOf ?? quote?.tradeTime;
  const sourceFreshness = freshness(sourceTimestamp, {
    nowMs,
    maxAgeMs: sourceMaxAgeMs,
    maxFutureSkewMs,
  });
  const receivedAt = timestampMs(quote?.receivedAt);
  const receiptFreshness = receivedAt === null
    ? null
    : freshness(receivedAt, {
      nowMs,
      maxAgeMs: receiptMaxAgeMs,
      maxFutureSkewMs,
    });
  const sourceReceiptConsistency = validateReceivedAt && sourceFreshness.asOf && receiptFreshness?.asOf
    ? freshness(sourceFreshness.asOf, {
      nowMs: receivedAt,
      maxAgeMs: Number.MAX_SAFE_INTEGER,
      maxFutureSkewMs,
    })
    : null;
  const reasonCodes = [];

  if (sourceFreshness.isStale) reasonCodes.push("STALE_OR_INVALID_QUOTE_SOURCE");
  if (requireReceivedAt && !receiptFreshness) {
    reasonCodes.push("QUOTE_RECEIPT_TIMESTAMP_UNAVAILABLE");
  } else if (validateReceivedAt && receiptFreshness?.isStale) {
    reasonCodes.push("STALE_OR_INVALID_QUOTE_RECEIPT");
  }
  if (sourceReceiptConsistency?.isStale) reasonCodes.push("QUOTE_SOURCE_RECEIPT_CLOCK_MISMATCH");
  if (requireRealtime && quote?.realtime !== true) reasonCodes.push("QUOTE_NOT_REALTIME");

  return Object.freeze({
    valid: reasonCodes.length === 0,
    reasonCodes: Object.freeze(reasonCodes),
    sourceFreshness: Object.freeze({ ...sourceFreshness }),
    receiptFreshness: receiptFreshness ? Object.freeze({ ...receiptFreshness }) : null,
    sourceReceiptConsistency: sourceReceiptConsistency ? Object.freeze({ ...sourceReceiptConsistency }) : null,
    realtime: typeof quote?.realtime === "boolean" ? quote.realtime : null,
  });
}
