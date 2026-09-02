export const BROKER_EXECUTION_COVERAGE_SCHEMA_VERSION = 1;
export const BROKER_EXECUTION_COVERAGE_STATUSES = Object.freeze([
  "ESTABLISHING",
  "CONTIGUOUS",
  "GAP",
]);

const STATUS_SET = new Set(BROKER_EXECUTION_COVERAGE_STATUSES);
const COVERAGE_SOURCE = "SCHWAB_ORDER_API_POLL";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function finiteNumber(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (Number.isFinite(number)) return new Date(number).toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function provenanceError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function validateBrokerExecutionCoverage(coverage) {
  const value = coverage && typeof coverage === "object" ? coverage : {};
  const errors = [];
  const status = upper(value.status);
  const source = upper(value.source);
  const coverageStartedAt = isoTimestamp(value.coverageStartedAt);
  const baselineCompletedAt = isoTimestamp(value.baselineCompletedAt);
  const currentThrough = isoTimestamp(value.currentThrough);
  const lastGapAt = isoTimestamp(value.lastGapAt);
  const lastGapReason = text(value.lastGapReason);

  if (Number(value.schemaVersion) !== BROKER_EXECUTION_COVERAGE_SCHEMA_VERSION) errors.push("unsupported schemaVersion");
  if (!STATUS_SET.has(status)) errors.push("status is invalid");
  if (source !== COVERAGE_SOURCE) errors.push("source is invalid");

  if (status === "ESTABLISHING") {
    if (coverageStartedAt || baselineCompletedAt || currentThrough) {
      errors.push("ESTABLISHING coverage cannot claim a completed coverage interval");
    }
  }

  if (status === "CONTIGUOUS") {
    if (!coverageStartedAt || !baselineCompletedAt || !currentThrough) {
      errors.push("CONTIGUOUS coverage requires coverageStartedAt, baselineCompletedAt, and currentThrough");
    }
  }

  if (status === "GAP") {
    if (!baselineCompletedAt || !lastGapAt || !lastGapReason) {
      errors.push("GAP coverage requires baseline and gap provenance");
    }
  }

  const startedMs = coverageStartedAt ? Date.parse(coverageStartedAt) : null;
  const baselineMs = baselineCompletedAt ? Date.parse(baselineCompletedAt) : null;
  const currentMs = currentThrough ? Date.parse(currentThrough) : null;
  const gapMs = lastGapAt ? Date.parse(lastGapAt) : null;

  if (startedMs !== null && baselineMs !== null && startedMs < baselineMs) {
    errors.push("coverageStartedAt cannot precede baselineCompletedAt");
  }
  if (startedMs !== null && currentMs !== null && currentMs < startedMs) {
    errors.push("currentThrough cannot precede coverageStartedAt");
  }
  if (baselineMs !== null && currentMs !== null && currentMs < baselineMs) {
    errors.push("currentThrough cannot precede baselineCompletedAt");
  }
  if (status === "GAP" && currentMs !== null && gapMs !== null && gapMs < currentMs) {
    errors.push("lastGapAt cannot precede currentThrough while coverage is GAP");
  }

  return { valid: errors.length === 0, errors: Object.freeze(errors) };
}

function requireValidCoverage(coverage) {
  const contract = validateBrokerExecutionCoverage(coverage);
  if (!contract.valid) {
    throw provenanceError(
      `broker execution coverage is invalid: ${contract.errors.join("; ")}`,
      "INVALID_BROKER_EXECUTION_COVERAGE",
    );
  }
  return coverage;
}

export function createBrokerExecutionCoverage() {
  return immutable(requireValidCoverage({
    schemaVersion: BROKER_EXECUTION_COVERAGE_SCHEMA_VERSION,
    status: "ESTABLISHING",
    source: COVERAGE_SOURCE,
    coverageStartedAt: null,
    baselineCompletedAt: null,
    currentThrough: null,
    lastGapAt: null,
    lastGapReason: null,
  }));
}

export function establishBrokerExecutionCoverage(coverage, { baselineCompletedAt } = {}) {
  requireValidCoverage(coverage);
  const completedAt = isoTimestamp(baselineCompletedAt);
  if (!completedAt) {
    throw provenanceError("baselineCompletedAt is required", "BROKER_EXECUTION_BASELINE_TIME_REQUIRED");
  }
  if (coverage.status !== "ESTABLISHING") {
    throw provenanceError("execution coverage baseline may only be established once", "BROKER_EXECUTION_BASELINE_ALREADY_ESTABLISHED");
  }

  return immutable(requireValidCoverage({
    ...structuredClone(coverage),
    status: "CONTIGUOUS",
    coverageStartedAt: completedAt,
    baselineCompletedAt: completedAt,
    currentThrough: completedAt,
  }));
}

export function advanceBrokerExecutionCoverage(coverage, { observedThrough } = {}) {
  requireValidCoverage(coverage);
  const observedAt = isoTimestamp(observedThrough);
  if (!observedAt) {
    throw provenanceError("observedThrough is required", "BROKER_EXECUTION_OBSERVED_THROUGH_REQUIRED");
  }
  if (coverage.status === "ESTABLISHING") {
    throw provenanceError("execution baseline must complete before coverage can advance", "BROKER_EXECUTION_BASELINE_NOT_ESTABLISHED");
  }

  const observedMs = Date.parse(observedAt);
  const baselineMs = Date.parse(coverage.baselineCompletedAt);
  if (observedMs < baselineMs) {
    throw provenanceError("observedThrough cannot precede baseline completion", "BROKER_EXECUTION_COVERAGE_TIME_REGRESSION");
  }

  if (coverage.status === "CONTIGUOUS") {
    const currentMs = Date.parse(coverage.currentThrough);
    if (observedMs < currentMs) {
      throw provenanceError("execution coverage cannot move backward", "BROKER_EXECUTION_COVERAGE_TIME_REGRESSION");
    }
    return immutable(requireValidCoverage({
      ...structuredClone(coverage),
      currentThrough: observedAt,
    }));
  }

  // A successful poll after a GAP begins a new provable continuous interval.
  // It does not heal or claim coverage across the failed interval.
  return immutable(requireValidCoverage({
    ...structuredClone(coverage),
    status: "CONTIGUOUS",
    coverageStartedAt: observedAt,
    currentThrough: observedAt,
  }));
}

export function markBrokerExecutionCoverageGap(coverage, {
  gapDetectedAt,
  reason,
} = {}) {
  requireValidCoverage(coverage);
  if (coverage.status === "ESTABLISHING") {
    throw provenanceError("execution baseline is not established", "BROKER_EXECUTION_BASELINE_NOT_ESTABLISHED");
  }

  const gapAt = isoTimestamp(gapDetectedAt);
  const gapReason = text(reason);
  if (!gapAt) {
    throw provenanceError("gapDetectedAt is required", "BROKER_EXECUTION_GAP_TIME_REQUIRED");
  }
  if (!gapReason) {
    throw provenanceError("gap reason is required", "BROKER_EXECUTION_GAP_REASON_REQUIRED");
  }

  const currentMs = Date.parse(coverage.currentThrough);
  if (Date.parse(gapAt) < currentMs) {
    throw provenanceError("gapDetectedAt cannot precede currentThrough", "BROKER_EXECUTION_COVERAGE_TIME_REGRESSION");
  }

  return immutable(requireValidCoverage({
    ...structuredClone(coverage),
    status: "GAP",
    lastGapAt: coverage.status === "GAP" ? coverage.lastGapAt : gapAt,
    lastGapReason: gapReason,
  }));
}

function requireAccountId(accountId) {
  const normalized = text(accountId);
  if (!normalized) {
    throw provenanceError("stable opaque accountId is required", "BROKER_ACCOUNT_ID_REQUIRED");
  }
  return normalized;
}

export function publicBrokerAccount(snapshot) {
  const accountId = requireAccountId(snapshot?.accountHash ?? snapshot?.accountId);
  return immutable({
    accountId,
    account: text(snapshot?.accountDisplay ?? snapshot?.account) || null,
    equity: finiteNumber(snapshot?.equity),
    maxRisk: finiteNumber(snapshot?.maxRisk),
  });
}

export function publicBrokerPosition({ accountId, accountDisplay, state } = {}) {
  const normalizedAccountId = requireAccountId(accountId);
  if (!state || typeof state !== "object") {
    throw provenanceError("position state is required", "BROKER_POSITION_STATE_REQUIRED");
  }
  return immutable({
    accountId: normalizedAccountId,
    account: text(accountDisplay) || null,
    symbol: upper(state.symbol) || "?",
    side: upper(state.side) || null,
    quantity: finiteNumber(state.quantity) ?? 0,
    averagePrice: finiteNumber(state.averagePrice),
  });
}

export function publicBrokerExecution({ fill, detectedAt, result } = {}) {
  const accountId = requireAccountId(fill?.accountHash ?? fill?.accountId);
  const detected = isoTimestamp(detectedAt);
  if (!detected) {
    throw provenanceError("execution detectedAt is required", "BROKER_EXECUTION_DETECTED_AT_REQUIRED");
  }
  if (!result || typeof result !== "object") {
    throw provenanceError("execution state result is required", "BROKER_EXECUTION_STATE_RESULT_REQUIRED");
  }

  const executionTime = isoTimestamp(fill?.executionTime);
  const executionMs = executionTime ? Date.parse(executionTime) : null;
  const detectedMs = Date.parse(detected);

  return immutable({
    detectedAt: detected,
    accountId,
    account: text(fill?.accountDisplay ?? fill?.account) || null,
    symbol: upper(fill?.symbol) || "?",
    instruction: upper(fill?.instruction) || "?",
    positionEffect: upper(fill?.positionEffect) || "?",
    quantity: finiteNumber(fill?.quantity) ?? 0,
    price: finiteNumber(fill?.price),
    executionTime,
    observedDelayMs: executionMs === null ? null : detectedMs - executionMs,
    stateEvent: upper(result.event) || null,
    previousSide: upper(result.previousSide) || null,
    previousQuantity: finiteNumber(result.previousQuantity) ?? 0,
    nextSide: upper(result.nextSide) || null,
    nextQuantity: finiteNumber(result.nextQuantity) ?? 0,
    averagePrice: finiteNumber(result.nextAveragePrice),
  });
}
