export const EXECUTION_ORIGINS = Object.freeze({
  LEGACY_MANUAL_V23: "LEGACY_MANUAL_V23",
  V24_HANDOFF: "V24_HANDOFF",
});

const V24_REQUIRED_TEXT_FIELDS = Object.freeze([
  "handoffId",
  "sourceId",
  "candidateId",
  "candidateContentHash",
  "symbol",
  "direction",
  "setup",
  "timeframe",
  "thesis",
  "authorizedExecutionAccountId",
  "dssEvaluationId",
  "riskEvaluationId",
  "authorizedAt",
]);

function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
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
function isoTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return new Date(numeric).toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function immutable(value) { return deepFreeze(structuredClone(value)); }
function compatibilityError(message, code) { const error = new Error(message); error.code = code; return error; }

function normalizeHandoffForV23(handoff) {
  if (!handoff || typeof handoff !== "object") throw compatibilityError("immutable V2.4 handoff is required", "V24_HANDOFF_REQUIRED");
  for (const field of V24_REQUIRED_TEXT_FIELDS) {
    if (!text(handoff[field])) throw compatibilityError(`handoff ${field} is required`, "INVALID_V24_EXECUTION_PROVENANCE");
  }

  const contractVersion = Number(handoff.contractVersion);
  const structuralInvalidation = positiveNumber(handoff.structuralInvalidation);
  const effectiveStop = positiveNumber(handoff.effectiveStop);
  const currentExpectedEntry = positiveNumber(handoff.currentExpectedEntry);
  const selectedQuantity = positiveNumber(handoff.selectedQuantity);
  const authorizedMaxDollarRisk = positiveNumber(handoff.authorizedMaxDollarRisk);
  const authorizedAt = isoTimestamp(handoff.authorizedAt);
  const createdAt = isoTimestamp(handoff.createdAt);
  const direction = upper(handoff.direction);

  if (!Number.isInteger(contractVersion) || contractVersion < 1) throw compatibilityError("handoff contractVersion is invalid", "INVALID_V24_EXECUTION_PROVENANCE");
  if (!["LONG", "SHORT"].includes(direction)) throw compatibilityError("handoff direction must be LONG or SHORT", "INVALID_V24_EXECUTION_PROVENANCE");
  if (!handoff.trigger || typeof handoff.trigger !== "object" || Array.isArray(handoff.trigger)) throw compatibilityError("handoff trigger object is required", "INVALID_V24_EXECUTION_PROVENANCE");
  if (!Array.isArray(handoff.targets)) throw compatibilityError("handoff targets must be an array", "INVALID_V24_EXECUTION_PROVENANCE");
  if ([structuralInvalidation, effectiveStop, currentExpectedEntry, selectedQuantity].some((value) => value === null)) {
    throw compatibilityError("handoff stop/entry/quantity provenance is incomplete", "INVALID_V24_EXECUTION_PROVENANCE");
  }
  if (handoff.authorizedMaxDollarRisk !== undefined && handoff.authorizedMaxDollarRisk !== null && authorizedMaxDollarRisk === null) {
    throw compatibilityError("handoff authorizedMaxDollarRisk is invalid", "INVALID_V24_EXECUTION_PROVENANCE");
  }
  if (!authorizedAt || !createdAt) throw compatibilityError("handoff timestamps are invalid", "INVALID_V24_EXECUTION_PROVENANCE");
  if (Date.parse(createdAt) < Date.parse(authorizedAt)) throw compatibilityError("handoff createdAt cannot precede authorizedAt", "INVALID_V24_EXECUTION_PROVENANCE");
  if (direction === "LONG" && !(currentExpectedEntry > effectiveStop)) throw compatibilityError("LONG expected entry must be above effective stop", "INVALID_V24_EXECUTION_PROVENANCE");
  if (direction === "SHORT" && !(currentExpectedEntry < effectiveStop)) throw compatibilityError("SHORT expected entry must be below effective stop", "INVALID_V24_EXECUTION_PROVENANCE");

  return {
    handoffId: text(handoff.handoffId),
    sourceId: text(handoff.sourceId),
    candidateId: text(handoff.candidateId),
    contractVersion,
    candidateContentHash: text(handoff.candidateContentHash),
    symbol: upper(handoff.symbol),
    direction,
    setup: text(handoff.setup),
    timeframe: text(handoff.timeframe),
    thesis: text(handoff.thesis),
    trigger: structuredClone(handoff.trigger),
    targets: structuredClone(handoff.targets),
    managementPlan: handoff.managementPlan ?? null,
    structuralInvalidation,
    effectiveStop,
    currentExpectedEntry,
    selectedQuantity,
    authorizedMaxDollarRisk,
    authorizedExecutionAccountId: text(handoff.authorizedExecutionAccountId),
    dssEvaluationId: text(handoff.dssEvaluationId),
    riskEvaluationId: text(handoff.riskEvaluationId),
    authorizedAt,
    handoffCreatedAt: createdAt,
  };
}

export function buildV24ExecutionCompatibilityEnvelope({ handoff, receiverId } = {}) {
  const normalizedReceiverId = text(receiverId);
  if (!normalizedReceiverId) throw compatibilityError("executionBoardReceiverId is required", "EXECUTION_BOARD_RECEIVER_ID_REQUIRED");
  return immutable({
    origin: EXECUTION_ORIGINS.V24_HANDOFF,
    v24: {
      ...normalizeHandoffForV23(handoff),
      executionBoardReceiverId: normalizedReceiverId,
      executionListeningAt: null,
    },
  });
}

export function bindV24ExecutionListeningAt(envelope, executionListeningAt) {
  if (!isV24Origin(envelope)) throw compatibilityError("V2.4 compatibility envelope is required", "V24_EXECUTION_PROVENANCE_REQUIRED");
  if (envelope.v24.executionListeningAt) throw compatibilityError("executionListeningAt is already frozen", "V24_EXECUTION_LISTENING_AT_ALREADY_BOUND");
  const listeningAt = isoTimestamp(executionListeningAt);
  if (!listeningAt) throw compatibilityError("executionListeningAt is invalid", "V24_EXECUTION_LISTENING_AT_INVALID");
  if (Date.parse(listeningAt) < Date.parse(envelope.v24.authorizedAt)) throw compatibilityError("executionListeningAt cannot precede authorizedAt", "V24_EXECUTION_LISTENING_AT_INVALID");
  return immutable({ origin: EXECUTION_ORIGINS.V24_HANDOFF, v24: { ...structuredClone(envelope.v24), executionListeningAt: listeningAt } });
}

export function executionOrigin(trade) {
  return trade?.origin === EXECUTION_ORIGINS.V24_HANDOFF && trade?.v24 ? EXECUTION_ORIGINS.V24_HANDOFF : EXECUTION_ORIGINS.LEGACY_MANUAL_V23;
}
export function isV24Origin(trade) { return executionOrigin(trade) === EXECUTION_ORIGINS.V24_HANDOFF; }
export function executionStop(trade) { return isV24Origin(trade) ? positiveNumber(trade.v24.effectiveStop) : positiveNumber(trade?.originalPlan?.structuralStop); }
export function executionStructuralInvalidation(trade) { return isV24Origin(trade) ? positiveNumber(trade.v24.structuralInvalidation) : positiveNumber(trade?.originalPlan?.structuralStop); }
export function executionExpectedEntry(trade) { return isV24Origin(trade) ? positiveNumber(trade.v24.currentExpectedEntry) : positiveNumber(trade?.risk?.expectedEntry); }
export function executionAuthorizedQuantity(trade) { return isV24Origin(trade) ? positiveNumber(trade.v24.selectedQuantity) : positiveNumber(trade?.risk?.intendedSize); }
export function executionAuthorizedAccountId(trade) { return isV24Origin(trade) ? text(trade.v24.authorizedExecutionAccountId) || null : null; }
export function executionAuthorizedMaxDollarRisk(trade) { return isV24Origin(trade) ? positiveNumber(trade.v24.authorizedMaxDollarRisk) : null; }

export function plannedExecutionRisk(trade) {
  const entry = executionExpectedEntry(trade);
  const stop = executionStop(trade);
  const quantity = executionAuthorizedQuantity(trade);
  if ([entry, stop, quantity].some((value) => value === null)) return null;
  return Math.abs(entry - stop) * quantity;
}

export function assertV24AuthorizationImmutable(before, after) {
  if (!isV24Origin(before)) return after;
  if (!isV24Origin(after)) throw compatibilityError("V2.4 execution origin may not be removed", "V24_AUTHORIZATION_IMMUTABLE");
  if (JSON.stringify(before.v24) !== JSON.stringify(after.v24)) throw compatibilityError("V2.4 authorization-bearing provenance is immutable", "V24_AUTHORIZATION_IMMUTABLE");
  return after;
}
