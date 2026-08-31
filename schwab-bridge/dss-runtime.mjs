import { evaluateDss } from "./dss-evaluator.mjs";
import { canonicalLifecycleState } from "./pretrade-state.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function finiteTimestamp(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
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

function runtimeError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function findCandidate(state, candidateId, contractVersion) {
  return (Array.isArray(state?.candidates) ? state.candidates : []).find((candidate) => (
    text(candidate?.candidateId) === candidateId
    && Number(candidate?.contractVersion) === contractVersion
  ));
}

function findEvaluation(state, dssEvaluationId) {
  return (Array.isArray(state?.dssEvaluations) ? state.dssEvaluations : []).find((evaluation) => (
    text(evaluation?.dssEvaluationId) === dssEvaluationId
  ));
}

function evaluationIdentity(input) {
  const candidate = input?.candidate && typeof input.candidate === "object" ? input.candidate : {};
  return {
    candidateId: text(candidate.candidateId),
    contractVersion: Number(candidate.contractVersion),
    sourceId: upper(candidate.sourceId ?? candidate.source),
    candidateContentHash: text(candidate.candidateContentHash ?? candidate.contentHash),
  };
}

function immutableResult(value) {
  return deepFreeze(structuredClone(value));
}

export class DssRuntime {
  constructor({
    store,
    evaluator = evaluateDss,
    now = () => Date.now(),
    idFactory,
  } = {}) {
    const requiredStoreMethods = [
      "snapshot",
      "recordDssEvaluation",
      "markCurrentDssEvaluationStale",
      "currentDssEvaluationForRiskHandoff",
    ];
    if (!store || requiredStoreMethods.some((method) => typeof store[method] !== "function")) {
      throw new Error("DssRuntime requires a compatible pre-trade store");
    }
    if (typeof evaluator !== "function") throw new Error("evaluator must be a function");
    if (typeof now !== "function") throw new Error("now must be a function");
    if (idFactory !== undefined && typeof idFactory !== "function") throw new Error("idFactory must be a function");

    this.store = store;
    this.evaluator = evaluator;
    this.now = now;
    this.idFactory = idFactory;
  }

  evaluate(input) {
    const identity = evaluationIdentity(input);
    if (!identity.candidateId || !Number.isInteger(identity.contractVersion) || identity.contractVersion < 1) {
      throw runtimeError("DSS runtime input must identify candidateId and integer contractVersion >= 1", "INVALID_DSS_RUNTIME_CANDIDATE_IDENTITY");
    }

    const state = this.store.snapshot();
    const candidate = findCandidate(state, identity.candidateId, identity.contractVersion);
    if (!candidate) {
      throw runtimeError(
        `candidate ${identity.candidateId} v${identity.contractVersion} was not found`,
        "DSS_RUNTIME_CANDIDATE_NOT_FOUND",
      );
    }

    if (identity.sourceId !== upper(candidate.source)) {
      throw runtimeError("DSS runtime source identity does not match persisted candidate", "DSS_RUNTIME_SOURCE_MISMATCH");
    }
    if (identity.candidateContentHash !== text(candidate.contentHash)) {
      throw runtimeError("DSS runtime candidate content hash does not match persisted candidate", "DSS_RUNTIME_HASH_MISMATCH");
    }

    if (candidate.authorizedDssEvaluationId) {
      const authorizedId = text(candidate.authorizedDssEvaluationId);
      const authorized = findEvaluation(state, authorizedId);
      if (!authorized) {
        throw runtimeError("authorizedDssEvaluationId has no persisted immutable evaluation", "DSS_RUNTIME_MISSING_AUTHORIZED_EVALUATION");
      }
      return immutableResult({
        action: "FROZEN",
        reason: "AUTHORIZED_DSS_EVALUATION",
        candidateId: identity.candidateId,
        contractVersion: identity.contractVersion,
        dssEvaluationId: authorizedId,
        evaluation: structuredClone(authorized),
      });
    }

    const lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
    if (lifecycleState !== "PERMISSION_EVALUATING") {
      throw runtimeError(
        `DSS runtime evaluation is not allowed while candidate is ${lifecycleState}`,
        "DSS_RUNTIME_NOT_ALLOWED_IN_STATE",
      );
    }

    if (candidate.currentDssEvaluationId && !candidate.currentDssEvaluationStale) {
      const current = findEvaluation(state, text(candidate.currentDssEvaluationId));
      if (!current) {
        throw runtimeError("currentDssEvaluationId has no persisted evaluation", "DSS_RUNTIME_MISSING_CURRENT_EVALUATION");
      }
      if (upper(current.status) === "VALID") {
        return immutableResult({
          action: "REUSED",
          reason: "CURRENT_VALID_DSS_STILL_FRESH",
          candidateId: identity.candidateId,
          contractVersion: identity.contractVersion,
          dssEvaluationId: current.dssEvaluationId,
          status: current.status,
          evaluation: structuredClone(current),
        });
      }
    }

    const nowMs = Number(this.now());
    if (!Number.isFinite(nowMs)) {
      throw runtimeError("DSS runtime clock must return epoch milliseconds", "INVALID_DSS_RUNTIME_CLOCK");
    }

    const options = { nowMs };
    if (this.idFactory) options.idFactory = this.idFactory;
    const evaluation = this.evaluator(input, options);
    const recorded = this.store.recordDssEvaluation(evaluation);

    return immutableResult({
      action: "EVALUATED",
      candidateId: identity.candidateId,
      contractVersion: identity.contractVersion,
      dssEvaluationId: recorded.dssEvaluationId,
      status: recorded.status,
      evaluation: structuredClone(evaluation),
    });
  }

  observeCompletedBar({
    candidateId,
    contractVersion,
    bar,
    observedAt = null,
  } = {}) {
    if (!bar || typeof bar !== "object") {
      throw runtimeError("completed bar is required", "INVALID_DSS_COMPLETED_BAR_EVENT");
    }
    if (bar.complete !== true) {
      throw runtimeError("DSS staleness event requires a completed bar", "INVALID_DSS_COMPLETED_BAR_EVENT");
    }
    if (text(bar.timeframe) !== "2m") {
      throw runtimeError("DSS staleness event requires a 2m bar", "INVALID_DSS_COMPLETED_BAR_EVENT");
    }

    const timestamp = finiteTimestamp(bar.timestamp);
    if (timestamp === null) {
      throw runtimeError("completed bar timestamp is invalid", "INVALID_DSS_COMPLETED_BAR_EVENT");
    }

    return this.store.markCurrentDssEvaluationStale({
      candidateId: text(candidateId),
      contractVersion: Number(contractVersion),
      completedBarTimestamp: timestamp,
      observedAt,
    });
  }

  riskHandoff(candidateId, contractVersion) {
    return this.store.currentDssEvaluationForRiskHandoff(text(candidateId), Number(contractVersion));
  }
}
