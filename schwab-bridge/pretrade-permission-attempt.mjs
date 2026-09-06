import crypto from "node:crypto";

export const PRETRADE_PERMISSION_ATTEMPT_SCHEMA_VERSION = 1;
export const PRETRADE_PERMISSION_PIPELINE_AUTHORITY = "PRETRADE_PERMISSION_PIPELINE";

const RESULT_KINDS = new Set(["OUTCOME", "BLOCKED_RETRYABLE", "BLOCKED_INTEGRITY", "ERROR"]);
const OUTCOMES = new Set(["READY", "CAUTION", "PASS"]);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stable(value[key]);
      return result;
    }, {});
  }
  return value;
}

export function permissionAttemptHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function immutablePermissionAttempt(value) {
  return deepFreeze(structuredClone(value));
}

export function buildPermissionAttempt({
  permissionAttemptId,
  operationId,
  operationHash,
  candidate,
  triggerSatisfaction,
  structuralValidity,
  dssResult = null,
  riskEvaluation = null,
  result,
  startedAt,
  completedAt,
} = {}) {
  const attempt = {
    schemaVersion: PRETRADE_PERMISSION_ATTEMPT_SCHEMA_VERSION,
    authority: PRETRADE_PERMISSION_PIPELINE_AUTHORITY,
    permissionAttemptId: text(permissionAttemptId),
    operationId: text(operationId),
    operationHash: text(operationHash),
    candidate: {
      candidateId: text(candidate?.candidateId),
      contractVersion: Number(candidate?.contractVersion),
      candidateContentHash: text(candidate?.contentHash),
      source: upper(candidate?.source),
      symbol: upper(candidate?.symbol),
      direction: upper(candidate?.direction),
    },
    triggerSatisfaction: triggerSatisfaction ? structuredClone(triggerSatisfaction) : null,
    structuralValidity: structuralValidity ? structuredClone(structuralValidity) : null,
    dss: dssResult ? {
      action: text(dssResult.action) || null,
      status: upper(dssResult.status ?? dssResult.evaluation?.status) || null,
      dssEvaluationId: text(dssResult.dssEvaluationId ?? dssResult.evaluation?.dssEvaluationId) || null,
      evaluation: dssResult.evaluation ? structuredClone(dssResult.evaluation) : null,
    } : null,
    phase4: riskEvaluation ? {
      riskEvaluationId: text(riskEvaluation.riskEvaluationId) || null,
      status: upper(riskEvaluation.status) || null,
      dssEvaluationId: text(riskEvaluation.dss?.dssEvaluationId) || null,
      maxAffordableQuantity: finiteNumber(riskEvaluation.calculation?.finalQuantity),
      plannedDollarRisk: finiteNumber(riskEvaluation.calculation?.plannedDollarRisk),
      plannedRiskFraction: finiteNumber(riskEvaluation.calculation?.plannedRiskFraction),
      evaluation: structuredClone(riskEvaluation),
    } : null,
    market: riskEvaluation?.entry ? {
      bid: finiteNumber(riskEvaluation.entry.bid),
      ask: finiteNumber(riskEvaluation.entry.ask),
      quoteObservedAt: timestamp(riskEvaluation.entry.quoteObservedAt),
      quoteAgeMs: finiteNumber(riskEvaluation.entry.quoteAgeMs),
      quoteSource: upper(riskEvaluation.entry.quoteSource) || null,
    } : null,
    expectedEntry: riskEvaluation?.entry ? structuredClone(riskEvaluation.entry) : null,
    account: riskEvaluation?.account ? structuredClone(riskEvaluation.account) : null,
    instrument: riskEvaluation?.instrument ? structuredClone(riskEvaluation.instrument) : null,
    result: result ? {
      kind: upper(result.kind),
      outcome: result.outcome ? upper(result.outcome) : null,
      reasonCode: text(result.reasonCode) || null,
      reasonCodes: [...new Set((result.reasonCodes || []).map(upper).filter(Boolean))],
    } : null,
    startedAt: timestamp(startedAt),
    completedAt: timestamp(completedAt),
  };

  const validation = validatePermissionAttempt(attempt);
  if (!validation.valid) {
    const error = new Error(`permission attempt contract is invalid: ${validation.errors.join("; ")}`);
    error.code = "INVALID_PERMISSION_ATTEMPT";
    throw error;
  }
  return immutablePermissionAttempt(attempt);
}

export function validatePermissionAttempt(value) {
  const attempt = value && typeof value === "object" ? value : {};
  const errors = [];
  if (Number(attempt.schemaVersion) !== PRETRADE_PERMISSION_ATTEMPT_SCHEMA_VERSION) errors.push("unsupported schemaVersion");
  if (attempt.authority !== PRETRADE_PERMISSION_PIPELINE_AUTHORITY) errors.push("invalid authority");
  if (!text(attempt.permissionAttemptId)) errors.push("permissionAttemptId is required");
  if (!text(attempt.operationId)) errors.push("operationId is required");
  if (!text(attempt.operationHash)) errors.push("operationHash is required");
  if (!text(attempt.candidate?.candidateId)) errors.push("candidateId is required");
  if (!Number.isInteger(Number(attempt.candidate?.contractVersion)) || Number(attempt.candidate?.contractVersion) < 1) errors.push("contractVersion is invalid");
  if (!text(attempt.candidate?.candidateContentHash)) errors.push("candidateContentHash is required");
  if (!text(attempt.candidate?.source)) errors.push("candidate source is required");
  if (!text(attempt.candidate?.symbol)) errors.push("candidate symbol is required");
  if (!["LONG", "SHORT"].includes(upper(attempt.candidate?.direction))) errors.push("candidate direction is invalid");
  if (!attempt.triggerSatisfaction || attempt.triggerSatisfaction.authority !== "PRETRADE_TRIGGER_ENGINE") errors.push("authoritative triggerSatisfaction is required");
  if (!attempt.structuralValidity || attempt.structuralValidity.authority !== "PRETRADE_STRUCTURAL_VALIDITY") errors.push("authoritative structuralValidity is required");
  if (!timestamp(attempt.startedAt)) errors.push("startedAt is invalid");
  if (!timestamp(attempt.completedAt)) errors.push("completedAt is invalid");

  const kind = upper(attempt.result?.kind);
  if (!RESULT_KINDS.has(kind)) errors.push("result.kind is invalid");
  if (kind === "OUTCOME") {
    const outcome = upper(attempt.result?.outcome);
    if (!OUTCOMES.has(outcome)) errors.push("result.outcome is invalid");
    if (["READY", "CAUTION"].includes(outcome)) {
      if (upper(attempt.structuralValidity?.status) !== "VALID") errors.push(`${outcome} requires VALID structuralValidity`);
      if (upper(attempt.dss?.status) !== "VALID") errors.push(`${outcome} requires VALID DSS`);
      if (upper(attempt.phase4?.status) !== "VALID") errors.push(`${outcome} requires VALID Phase 4`);
      if (!text(attempt.phase4?.riskEvaluationId)) errors.push(`${outcome} requires riskEvaluationId`);
      if (!text(attempt.account?.accountId)) errors.push(`${outcome} requires exact accountId`);
      if (finiteNumber(attempt.expectedEntry?.currentExpectedEntry) === null) errors.push(`${outcome} requires currentExpectedEntry`);
      if (outcome === "CAUTION" && !(attempt.result?.reasonCodes || []).length) errors.push("CAUTION requires reasonCodes");
    }
  } else if (!text(attempt.result?.reasonCode) && !(attempt.result?.reasonCodes || []).length) {
    errors.push(`${kind || "blocked/error"} result requires reason provenance`);
  }

  return { valid: errors.length === 0, errors: Object.freeze(errors) };
}
