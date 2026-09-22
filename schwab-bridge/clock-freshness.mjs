export const MAX_FUTURE_CLOCK_SKEW_MS = 2_000;

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
