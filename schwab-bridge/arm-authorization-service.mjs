import { buildArmRiskHandoff } from "./arm-risk-preparation-service.mjs";
import { authorizeArmState } from "./arm-authorization-state.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function finiteTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function authorizationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sameHandoff(left, right) {
  return Number(left?.candidateVersion) === Number(right?.candidateVersion)
    && text(left?.dssEvaluationId) === text(right?.dssEvaluationId)
    && text(left?.riskEvaluationId) === text(right?.riskEvaluationId)
    && Number(left?.selectedQuantity) === Number(right?.selectedQuantity);
}

function assertRiskEvaluationFreshAtAuthorization(riskEvaluation, nowMs) {
  const quoteObservedAt = finiteTimestamp(riskEvaluation?.entry?.quoteObservedAt);
  const accountObservedAt = finiteTimestamp(riskEvaluation?.account?.snapshotObservedAt);
  if (quoteObservedAt === null || accountObservedAt === null) {
    throw authorizationError("ARM risk evaluation freshness provenance is incomplete", "ARM_RISK_EVALUATION_STALE");
  }

  const quoteAgeMs = Math.max(0, nowMs - quoteObservedAt);
  const accountAgeMs = Math.max(0, nowMs - accountObservedAt);
  if (quoteAgeMs > 5_000 || accountAgeMs > 15_000) {
    throw authorizationError("ARM risk evaluation is no longer fresh", "ARM_RISK_EVALUATION_STALE");
  }
}

export class ArmAuthorizationService {
  constructor({ store, riskEvaluationRepository, now = () => Date.now() } = {}) {
    if (!store || typeof store.snapshot !== "function" || typeof store.save !== "function") {
      throw new Error("ArmAuthorizationService requires a compatible pre-trade store");
    }
    if (!riskEvaluationRepository || typeof riskEvaluationRepository.getById !== "function") {
      throw new Error("ArmAuthorizationService requires riskEvaluationRepository.getById()");
    }
    if (typeof now !== "function") throw new Error("now must be a function");
    this.store = store;
    this.riskEvaluationRepository = riskEvaluationRepository;
    this.now = now;
  }

  authorize({
    sourceId,
    candidateId,
    contractVersion,
    armRiskHandoff,
  } = {}) {
    const identity = {
      sourceId: upper(sourceId),
      candidateId: text(candidateId),
      contractVersion: Number(contractVersion),
    };
    if (!identity.sourceId || !identity.candidateId || !Number.isInteger(identity.contractVersion) || identity.contractVersion < 1) {
      throw authorizationError("ARM authorization request identity is invalid", "INVALID_ARM_AUTHORIZATION_IDENTITY");
    }
    if (!armRiskHandoff || typeof armRiskHandoff !== "object") {
      throw authorizationError("ARM risk handoff is required", "ARM_AUTHORIZATION_HANDOFF_REQUIRED");
    }
    if (Number(armRiskHandoff.candidateVersion) !== identity.contractVersion) {
      throw authorizationError("ARM risk handoff candidate version does not match request", "ARM_AUTHORIZATION_HANDOFF_MISMATCH");
    }

    const riskEvaluationId = text(armRiskHandoff.riskEvaluationId);
    if (!riskEvaluationId) {
      throw authorizationError("ARM risk handoff riskEvaluationId is required", "ARM_AUTHORIZATION_HANDOFF_MISMATCH");
    }

    const riskEvaluation = this.riskEvaluationRepository.getById(riskEvaluationId);
    if (upper(riskEvaluation.status) !== "VALID") {
      throw authorizationError("ARM authorization requires a VALID risk evaluation", "ARM_AUTHORIZATION_RISK_EVALUATION_NOT_VALID");
    }
    if (
      text(riskEvaluation.candidate?.candidateId) !== identity.candidateId
      || Number(riskEvaluation.candidate?.contractVersion) !== identity.contractVersion
    ) {
      throw authorizationError("risk evaluation candidate identity does not match request", "ARM_AUTHORIZATION_RISK_IDENTITY_MISMATCH");
    }

    const nowMs = finiteTimestamp(this.now());
    if (nowMs === null) {
      throw authorizationError("ARM authorization clock returned an invalid timestamp", "ARM_AUTHORIZATION_CLOCK_INVALID");
    }
    assertRiskEvaluationFreshAtAuthorization(riskEvaluation, nowMs);

    // Rebuild the handoff from immutable persistence and current pre-trade state.
    // This prevents a forged/stale selected quantity or provenance bundle from
    // reaching the state transition.
    const rebuilt = buildArmRiskHandoff({
      store: this.store,
      riskEvaluation,
      selectedQuantity: armRiskHandoff.selectedQuantity,
    });
    if (!sameHandoff(rebuilt, armRiskHandoff)) {
      throw authorizationError("ARM risk handoff does not match immutable risk evaluation", "ARM_AUTHORIZATION_HANDOFF_MISMATCH");
    }

    return authorizeArmState({
      store: this.store,
      sourceId: identity.sourceId,
      candidateId: identity.candidateId,
      contractVersion: identity.contractVersion,
      candidateContentHash: riskEvaluation.candidate.candidateHash,
      dssEvaluationId: rebuilt.dssEvaluationId,
      riskEvaluationId: rebuilt.riskEvaluationId,
      selectedQuantity: rebuilt.selectedQuantity,
    });
  }
}
