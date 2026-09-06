import crypto from "node:crypto";
import { canonicalLifecycleState } from "./pretrade-state.mjs";

export const PRETRADE_REVIEW_SCHEMA_VERSION = 1;
export const PRETRADE_REVIEW_AUTHORITY = "PRETRADE_REVIEW";

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

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function immutableReview(value) {
  return deepFreeze(structuredClone(value));
}

function reviewError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function reasonCodes(attempt) {
  return [...new Set((attempt?.result?.reasonCodes || []).map(upper).filter(Boolean))].sort();
}

export function buildPreTradeReviewPackage({ candidate, permissionAttempt, generatedAt = new Date().toISOString() } = {}) {
  if (!candidate || typeof candidate !== "object") throw reviewError("candidate is required", "REVIEW_CANDIDATE_REQUIRED");
  if (!permissionAttempt || typeof permissionAttempt !== "object") throw reviewError("permissionAttempt is required", "REVIEW_PERMISSION_ATTEMPT_REQUIRED");

  const state = canonicalLifecycleState(candidate.lifecycleState);
  if (!["READY", "CAUTION"].includes(state)) {
    throw reviewError(`review package is not available while candidate is ${state}`, "REVIEW_NOT_ALLOWED_IN_STATE");
  }

  const candidateId = text(candidate.candidateId);
  const contractVersion = Number(candidate.contractVersion);
  const candidateContentHash = text(candidate.contentHash);
  if (
    text(permissionAttempt.candidate?.candidateId) !== candidateId
    || Number(permissionAttempt.candidate?.contractVersion) !== contractVersion
    || text(permissionAttempt.candidate?.candidateContentHash) !== candidateContentHash
  ) {
    throw reviewError("permission attempt candidate identity does not match current candidate", "REVIEW_PERMISSION_IDENTITY_MISMATCH");
  }

  const permissionAttemptId = text(permissionAttempt.permissionAttemptId);
  if (text(candidate.currentPermissionOutcome?.permissionEvaluationId) !== permissionAttemptId) {
    throw reviewError("permission attempt is not the candidate current permission outcome", "REVIEW_PERMISSION_NOT_CURRENT");
  }
  const outcome = upper(permissionAttempt.result?.outcome);
  if (outcome !== state || !["READY", "CAUTION"].includes(outcome)) {
    throw reviewError("permission attempt outcome does not match current reviewable lifecycle state", "REVIEW_PERMISSION_OUTCOME_MISMATCH");
  }

  const risk = permissionAttempt.phase4?.evaluation;
  if (!risk || upper(risk.status) !== "VALID") {
    throw reviewError("review requires the exact VALID Phase 4 evaluation from permission", "REVIEW_RISK_EVALUATION_REQUIRED");
  }
  const dss = risk.dss || {};
  const entry = risk.entry || {};
  const account = risk.account || {};
  const instrument = risk.instrument || {};
  const calculation = risk.calculation || {};

  const structuralInvalidation = positiveNumber(dss.structuralInvalidation);
  const effectiveStop = positiveNumber(dss.effectiveStop);
  const currentExpectedEntry = positiveNumber(entry.currentExpectedEntry);
  const maxAffordableQuantity = positiveNumber(calculation.finalQuantity);
  const maxDollarRisk = positiveNumber(account.maxDollarRisk);
  const accountId = text(account.accountId);
  const minimumQuantity = positiveNumber(instrument.minimumQuantity);
  const quantityIncrement = positiveNumber(instrument.quantityIncrement);
  if (
    structuralInvalidation === null
    || effectiveStop === null
    || currentExpectedEntry === null
    || maxAffordableQuantity === null
    || maxDollarRisk === null
    || !accountId
    || minimumQuantity === null
    || quantityIncrement === null
  ) {
    throw reviewError("permission evidence is incomplete for ARM-critical review", "REVIEW_PACKAGE_INCOMPLETE");
  }

  const cautionReasonCodes = outcome === "CAUTION" ? reasonCodes(permissionAttempt) : [];
  if (outcome === "CAUTION" && cautionReasonCodes.length === 0) {
    throw reviewError("CAUTION review requires explicit warning reasons", "REVIEW_CAUTION_REASONS_REQUIRED");
  }

  const material = {
    candidateContentHash,
    permissionOutcome: outcome,
    structuralInvalidation,
    effectiveStop,
    currentExpectedEntry,
    accountId,
    maxDollarRisk,
    maxAffordableQuantity,
    instrument: {
      assetType: upper(instrument.assetType),
      symbol: upper(instrument.symbol || candidate.symbol),
      currency: upper(instrument.instrumentCurrency),
      minimumQuantity,
      quantityIncrement,
      tickSize: finiteNumber(instrument.tickSize),
      tickValue: finiteNumber(instrument.tickValue),
      pointValue: finiteNumber(instrument.pointValue),
    },
    cautionReasonCodes,
  };

  const reviewPackageId = `review-${hash(material)}`;
  const packageValue = {
    schemaVersion: PRETRADE_REVIEW_SCHEMA_VERSION,
    authority: PRETRADE_REVIEW_AUTHORITY,
    reviewPackageId,
    candidateId,
    contractVersion,
    candidateContentHash,
    symbol: upper(candidate.symbol),
    direction: upper(candidate.direction),
    setup: text(candidate.setup),
    timeframe: text(candidate.timeframe),
    permissionOutcome: outcome,
    material,
    evidence: {
      permissionAttemptId,
      structuralEvaluationId: text(permissionAttempt.structuralValidity?.structuralEvaluationId) || null,
      dssEvaluationId: text(permissionAttempt.dss?.dssEvaluationId) || text(risk.dss?.dssEvaluationId) || null,
      riskEvaluationId: text(risk.riskEvaluationId),
      permissionDecisionId: text(permissionAttempt.permissionDecision?.permissionDecisionId) || null,
      generatedAt: isoTimestamp(generatedAt),
    },
  };

  const validation = validatePreTradeReviewPackage(packageValue);
  if (!validation.valid) {
    throw reviewError(`review package is invalid: ${validation.errors.join("; ")}`, "INVALID_REVIEW_PACKAGE");
  }
  return immutableReview(packageValue);
}

export function validatePreTradeReviewPackage(value) {
  const review = value && typeof value === "object" ? value : {};
  const errors = [];
  if (Number(review.schemaVersion) !== PRETRADE_REVIEW_SCHEMA_VERSION) errors.push("unsupported schemaVersion");
  if (review.authority !== PRETRADE_REVIEW_AUTHORITY) errors.push("invalid authority");
  if (!text(review.reviewPackageId)) errors.push("reviewPackageId is required");
  if (!text(review.candidateId)) errors.push("candidateId is required");
  if (!Number.isInteger(Number(review.contractVersion)) || Number(review.contractVersion) < 1) errors.push("contractVersion is invalid");
  if (!text(review.candidateContentHash)) errors.push("candidateContentHash is required");
  if (!text(review.symbol)) errors.push("symbol is required");
  if (!["LONG", "SHORT"].includes(upper(review.direction))) errors.push("direction is invalid");
  if (!["READY", "CAUTION"].includes(upper(review.permissionOutcome))) errors.push("permissionOutcome is invalid");
  if (!review.material || typeof review.material !== "object") errors.push("material package is required");
  if (text(review.material?.candidateContentHash) !== text(review.candidateContentHash)) errors.push("material candidate hash mismatch");
  if (upper(review.material?.permissionOutcome) !== upper(review.permissionOutcome)) errors.push("material permission outcome mismatch");
  if (positiveNumber(review.material?.structuralInvalidation) === null) errors.push("structuralInvalidation is required");
  if (positiveNumber(review.material?.effectiveStop) === null) errors.push("effectiveStop is required");
  if (positiveNumber(review.material?.currentExpectedEntry) === null) errors.push("currentExpectedEntry is required");
  if (!text(review.material?.accountId)) errors.push("accountId is required");
  if (positiveNumber(review.material?.maxDollarRisk) === null) errors.push("maxDollarRisk is required");
  if (positiveNumber(review.material?.maxAffordableQuantity) === null) errors.push("maxAffordableQuantity is required");
  if (positiveNumber(review.material?.instrument?.minimumQuantity) === null) errors.push("minimumQuantity is required");
  if (positiveNumber(review.material?.instrument?.quantityIncrement) === null) errors.push("quantityIncrement is required");
  if (upper(review.permissionOutcome) === "CAUTION" && !(review.material?.cautionReasonCodes || []).length) errors.push("CAUTION reasons are required");
  if (!text(review.evidence?.permissionAttemptId)) errors.push("permissionAttemptId is required");
  if (!text(review.evidence?.dssEvaluationId)) errors.push("dssEvaluationId is required");
  if (!text(review.evidence?.riskEvaluationId)) errors.push("riskEvaluationId is required");
  if (!isoTimestamp(review.evidence?.generatedAt)) errors.push("generatedAt is invalid");

  if (review.material && typeof review.material === "object" && text(review.reviewPackageId)) {
    const expectedId = `review-${hash(review.material)}`;
    if (review.reviewPackageId !== expectedId) errors.push("reviewPackageId does not match material package");
  }
  return { valid: errors.length === 0, errors: Object.freeze(errors) };
}
