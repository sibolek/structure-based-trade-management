export const EXECUTION_BOARD_HANDOFF_SCHEMA_VERSION = 1;

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

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
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

function handoffError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function candidateArm(candidate) {
  return candidate?.arm && typeof candidate.arm === "object" ? candidate.arm : null;
}

export function validateExecutionBoardHandoffContract(handoff) {
  const value = handoff && typeof handoff === "object" ? handoff : {};
  const errors = [];

  if (Number(value.schemaVersion) !== EXECUTION_BOARD_HANDOFF_SCHEMA_VERSION) errors.push("unsupported schemaVersion");
  if (!text(value.handoffId)) errors.push("handoffId is required");
  if (!isoTimestamp(value.createdAt)) errors.push("createdAt is invalid");
  if (!isoTimestamp(value.authorizedAt)) errors.push("authorizedAt is invalid");
  if (!text(value.sourceId)) errors.push("sourceId is required");
  if (!text(value.candidateId)) errors.push("candidateId is required");
  if (!Number.isInteger(Number(value.contractVersion)) || Number(value.contractVersion) < 1) errors.push("contractVersion is invalid");
  if (!text(value.candidateContentHash)) errors.push("candidateContentHash is required");
  if (!text(value.symbol)) errors.push("symbol is required");
  if (!["LONG", "SHORT"].includes(upper(value.direction))) errors.push("direction must be LONG or SHORT");
  if (!text(value.setup)) errors.push("setup is required");
  if (!text(value.timeframe)) errors.push("timeframe is required");
  if (!text(value.thesis)) errors.push("thesis is required");
  if (!value.trigger || typeof value.trigger !== "object") errors.push("trigger object is required");
  if (!Array.isArray(value.targets)) errors.push("targets must be an array");
  if (positiveNumber(value.structuralInvalidation) === null) errors.push("structuralInvalidation must be positive");
  if (positiveNumber(value.effectiveStop) === null) errors.push("effectiveStop must be positive");
  if (positiveNumber(value.currentExpectedEntry) === null) errors.push("currentExpectedEntry must be positive");
  if (positiveNumber(value.selectedQuantity) === null) errors.push("selectedQuantity must be positive");
  if (value.authorizedMaxDollarRisk !== undefined && value.authorizedMaxDollarRisk !== null && positiveNumber(value.authorizedMaxDollarRisk) === null) {
    errors.push("authorizedMaxDollarRisk must be positive when present");
  }
  if (!text(value.authorizedExecutionAccountId)) errors.push("authorizedExecutionAccountId is required");
  if (!text(value.dssEvaluationId)) errors.push("dssEvaluationId is required");
  if (!text(value.riskEvaluationId)) errors.push("riskEvaluationId is required");

  const expectedEntry = positiveNumber(value.currentExpectedEntry);
  const effectiveStop = positiveNumber(value.effectiveStop);
  if (expectedEntry !== null && effectiveStop !== null) {
    if (upper(value.direction) === "LONG" && !(expectedEntry > effectiveStop)) errors.push("LONG currentExpectedEntry must be above effectiveStop");
    if (upper(value.direction) === "SHORT" && !(expectedEntry < effectiveStop)) errors.push("SHORT currentExpectedEntry must be below effectiveStop");
  }

  const authorizedAtIso = isoTimestamp(value.authorizedAt);
  const createdAtIso = isoTimestamp(value.createdAt);
  const authorizedAtMs = authorizedAtIso ? Date.parse(authorizedAtIso) : null;
  const createdAtMs = createdAtIso ? Date.parse(createdAtIso) : null;
  if (authorizedAtMs !== null && createdAtMs !== null && createdAtMs < authorizedAtMs) {
    errors.push("createdAt cannot precede authorizedAt");
  }

  return { valid: errors.length === 0, errors: Object.freeze(errors) };
}

export function buildExecutionBoardHandoff({ handoffId, createdAt = Date.now(), candidate, riskEvaluation } = {}) {
  const normalizedHandoffId = text(handoffId);
  if (!normalizedHandoffId) throw handoffError("handoffId is required", "EXECUTION_BOARD_HANDOFF_ID_REQUIRED");
  if (!candidate || typeof candidate !== "object") throw handoffError("candidate is required", "EXECUTION_BOARD_HANDOFF_CANDIDATE_REQUIRED");
  if (upper(candidate.lifecycleState) !== "ARMED") throw handoffError("candidate must be internally ARMED before handoff creation", "EXECUTION_BOARD_HANDOFF_CANDIDATE_NOT_ARMED");

  const arm = candidateArm(candidate);
  if (!arm) throw handoffError("candidate ARM provenance is required", "EXECUTION_BOARD_HANDOFF_ARM_PROVENANCE_REQUIRED");
  if (Number(arm.candidateVersion) !== Number(candidate.contractVersion)) throw handoffError("ARM candidate version does not match candidate", "EXECUTION_BOARD_HANDOFF_ARM_STATE_MISMATCH");
  if (text(candidate.authorizedDssEvaluationId) !== text(arm.dssEvaluationId) || text(candidate.authorizedRiskEvaluationId) !== text(arm.riskEvaluationId)) {
    throw handoffError("candidate frozen ARM identity is inconsistent", "EXECUTION_BOARD_HANDOFF_ARM_STATE_MISMATCH");
  }

  if (!riskEvaluation || typeof riskEvaluation !== "object" || upper(riskEvaluation.status) !== "VALID") {
    throw handoffError("VALID risk evaluation is required", "EXECUTION_BOARD_HANDOFF_RISK_EVALUATION_NOT_VALID");
  }

  const identityMatches = (
    text(riskEvaluation.candidate?.candidateId) === text(candidate.candidateId)
    && Number(riskEvaluation.candidate?.contractVersion) === Number(candidate.contractVersion)
    && text(riskEvaluation.candidate?.candidateHash) === text(candidate.contentHash)
    && upper(riskEvaluation.candidate?.symbol) === upper(candidate.symbol)
    && upper(riskEvaluation.candidate?.direction) === upper(candidate.direction)
  );
  if (!identityMatches) throw handoffError("risk evaluation candidate identity does not match ARMED candidate", "EXECUTION_BOARD_HANDOFF_RISK_IDENTITY_MISMATCH");

  if (text(arm.dssEvaluationId) !== text(riskEvaluation.dss?.dssEvaluationId) || text(arm.riskEvaluationId) !== text(riskEvaluation.riskEvaluationId)) {
    throw handoffError("ARM provenance does not match risk evaluation", "EXECUTION_BOARD_HANDOFF_ARM_RISK_MISMATCH");
  }

  const selectedQuantity = positiveNumber(arm.selectedQuantity);
  const maxAffordableQuantity = positiveNumber(riskEvaluation.calculation?.finalQuantity);
  if (selectedQuantity === null || maxAffordableQuantity === null || selectedQuantity > maxAffordableQuantity) {
    throw handoffError("ARM selected quantity is not valid for the risk evaluation", "EXECUTION_BOARD_HANDOFF_QUANTITY_INVALID");
  }

  const structuralInvalidation = positiveNumber(riskEvaluation.dss?.structuralInvalidation);
  const effectiveStop = positiveNumber(riskEvaluation.dss?.effectiveStop);
  const currentExpectedEntry = positiveNumber(riskEvaluation.entry?.currentExpectedEntry);
  const authorizedMaxDollarRisk = positiveNumber(riskEvaluation.account?.maxDollarRisk);
  const authorizedExecutionAccountId = text(riskEvaluation.account?.accountId);
  const authorizedAt = isoTimestamp(arm.authorizedAt);
  const normalizedCreatedAt = isoTimestamp(createdAt);

  if (!authorizedAt) throw handoffError("ARM authorizedAt is invalid", "EXECUTION_BOARD_HANDOFF_AUTHORIZED_AT_INVALID");
  if (!normalizedCreatedAt) throw handoffError("handoff createdAt is invalid", "EXECUTION_BOARD_HANDOFF_CREATED_AT_INVALID");
  if (structuralInvalidation === null || effectiveStop === null || currentExpectedEntry === null) {
    throw handoffError("risk evaluation stop/entry provenance is incomplete", "EXECUTION_BOARD_HANDOFF_RISK_PROVENANCE_INCOMPLETE");
  }
  if (!authorizedExecutionAccountId) throw handoffError("authorized execution account is missing", "EXECUTION_BOARD_HANDOFF_ACCOUNT_REQUIRED");

  const handoff = {
    schemaVersion: EXECUTION_BOARD_HANDOFF_SCHEMA_VERSION,
    handoffId: normalizedHandoffId,
    createdAt: normalizedCreatedAt,
    authorizedAt,
    sourceId: upper(candidate.source),
    candidateId: text(candidate.candidateId),
    contractVersion: Number(candidate.contractVersion),
    candidateContentHash: text(candidate.contentHash),
    symbol: upper(candidate.symbol),
    direction: upper(candidate.direction),
    setup: text(candidate.setup),
    timeframe: text(candidate.timeframe),
    thesis: text(candidate.thesis),
    trigger: structuredClone(candidate.trigger),
    targets: Array.isArray(candidate.targets) ? structuredClone(candidate.targets) : [],
    managementPlan: candidate.managementPlan ?? null,
    structuralInvalidation,
    effectiveStop,
    currentExpectedEntry,
    selectedQuantity,
    authorizedMaxDollarRisk,
    authorizedExecutionAccountId,
    dssEvaluationId: text(arm.dssEvaluationId),
    riskEvaluationId: text(arm.riskEvaluationId),
  };

  const contract = validateExecutionBoardHandoffContract(handoff);
  if (!contract.valid) {
    throw handoffError(`constructed Execution Board handoff is invalid: ${contract.errors.join("; ")}`, "INVALID_EXECUTION_BOARD_HANDOFF");
  }
  return immutable(handoff);
}
