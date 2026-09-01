import { canonicalLifecycleState } from "./pretrade-state.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
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

export function currentDssEvaluationForArmHandoff(store, candidateId, contractVersion) {
  if (!store || typeof store.snapshot !== "function") {
    throw new Error("ARM DSS handoff requires a pre-trade store with snapshot()");
  }

  const normalizedCandidateId = text(candidateId);
  const normalizedVersion = Number(contractVersion);
  if (!normalizedCandidateId || !Number.isInteger(normalizedVersion) || normalizedVersion < 1) {
    throw handoffError(
      "ARM DSS handoff requires candidateId and integer contractVersion >= 1",
      "INVALID_DSS_ARM_HANDOFF_CANDIDATE_IDENTITY",
    );
  }

  const state = store.snapshot();
  const candidate = (Array.isArray(state?.candidates) ? state.candidates : []).find((item) => (
    text(item?.candidateId) === normalizedCandidateId
    && Number(item?.contractVersion) === normalizedVersion
  ));
  if (!candidate) {
    throw handoffError(
      `candidate ${normalizedCandidateId} v${normalizedVersion} was not found`,
      "DSS_ARM_HANDOFF_CANDIDATE_NOT_FOUND",
    );
  }

  const lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
  if (!["READY", "CAUTION"].includes(lifecycleState)) {
    throw handoffError(
      `ARM DSS handoff is not allowed while candidate is ${lifecycleState}`,
      "DSS_ARM_HANDOFF_NOT_ALLOWED_IN_STATE",
    );
  }

  if (text(candidate.authorizedDssEvaluationId)) {
    throw handoffError(
      "DSS identity is already authorized and frozen",
      "DSS_ARM_HANDOFF_ALREADY_AUTHORIZED",
    );
  }

  const currentId = text(candidate.currentDssEvaluationId);
  if (!currentId) {
    throw handoffError("candidate has no current DSS evaluation", "NO_CURRENT_DSS_EVALUATION");
  }
  if (candidate.currentDssEvaluationStale) {
    throw handoffError(
      "current DSS evaluation is stale and permission must be reevaluated before ARM",
      "STALE_DSS_EVALUATION",
    );
  }

  const evaluation = (Array.isArray(state?.dssEvaluations) ? state.dssEvaluations : []).find((item) => (
    text(item?.dssEvaluationId) === currentId
  ));
  if (!evaluation) {
    throw handoffError(`DSS evaluation ${currentId} was not found`, "DSS_EVALUATION_NOT_FOUND");
  }
  if (upper(evaluation.status) !== "VALID") {
    throw handoffError(
      `current DSS evaluation status is ${evaluation.status}`,
      "DSS_EVALUATION_NOT_VALID",
    );
  }
  if (
    text(evaluation.candidateId) !== text(candidate.candidateId)
    || Number(evaluation.candidateContractVersion) !== Number(candidate.contractVersion)
    || text(evaluation.candidateContentHash) !== text(candidate.contentHash)
  ) {
    throw handoffError(
      "current DSS evaluation identity does not match candidate version",
      "DSS_EVALUATION_IDENTITY_MISMATCH",
    );
  }

  return immutable({
    dssEvaluationId: evaluation.dssEvaluationId,
    evaluation,
  });
}
