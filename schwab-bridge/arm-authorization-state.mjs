import { canonicalLifecycleState } from "./pretrade-state.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function positiveNumber(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function authorizationError(message, code, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function validIso(value) {
  const source = text(value);
  if (!source) return null;
  const parsed = Date.parse(source);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function authorizeArmState({
  store,
  sourceId,
  candidateId,
  contractVersion,
  candidateContentHash,
  dssEvaluationId,
  riskEvaluationId,
  selectedQuantity,
} = {}) {
  if (!store || !store.state || typeof store.save !== "function" || typeof store.clock !== "function") {
    throw new Error("ARM authorization requires a compatible pre-trade store");
  }

  const identity = {
    sourceId: upper(sourceId),
    candidateId: text(candidateId),
    contractVersion: Number(contractVersion),
    candidateContentHash: text(candidateContentHash),
    dssEvaluationId: text(dssEvaluationId),
    riskEvaluationId: text(riskEvaluationId),
    selectedQuantity: positiveNumber(selectedQuantity),
  };
  if (
    !identity.sourceId
    || !identity.candidateId
    || !Number.isInteger(identity.contractVersion)
    || identity.contractVersion < 1
    || !identity.candidateContentHash
    || !identity.dssEvaluationId
    || !identity.riskEvaluationId
    || identity.selectedQuantity === null
  ) {
    throw authorizationError("ARM authorization identity/provenance is invalid", "INVALID_ARM_AUTHORIZATION_PROVENANCE");
  }

  const candidate = (Array.isArray(store.state.candidates) ? store.state.candidates : []).find((item) => (
    text(item?.candidateId) === identity.candidateId
    && Number(item?.contractVersion) === identity.contractVersion
  ));
  if (!candidate) {
    throw authorizationError(
      `candidate ${identity.candidateId} v${identity.contractVersion} was not found`,
      "ARM_AUTHORIZATION_CANDIDATE_NOT_FOUND",
    );
  }
  if (upper(candidate.source) !== identity.sourceId) {
    throw authorizationError("ARM authorization source does not match candidate", "ARM_AUTHORIZATION_SOURCE_MISMATCH");
  }
  if (text(candidate.contentHash) !== identity.candidateContentHash) {
    throw authorizationError("ARM authorization candidate hash does not match", "ARM_AUTHORIZATION_CANDIDATE_HASH_MISMATCH");
  }

  const lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
  if (!["READY", "CAUTION"].includes(lifecycleState)) {
    throw authorizationError(
      `ARM authorization is not allowed while candidate is ${lifecycleState}`,
      "ARM_AUTHORIZATION_NOT_ALLOWED_IN_STATE",
    );
  }
  if (text(candidate.authorizedDssEvaluationId) || text(candidate.authorizedRiskEvaluationId) || candidate.arm) {
    throw authorizationError("candidate is already authorized", "ARM_AUTHORIZATION_ALREADY_FROZEN");
  }
  if (candidate.currentDssEvaluationStale) {
    throw authorizationError("current DSS evaluation is stale", "STALE_DSS_EVALUATION");
  }
  if (text(candidate.currentDssEvaluationId) !== identity.dssEvaluationId) {
    throw authorizationError("ARM authorization DSS does not match current DSS", "ARM_AUTHORIZATION_DSS_MISMATCH");
  }

  const dss = (Array.isArray(store.state.dssEvaluations) ? store.state.dssEvaluations : []).find((item) => (
    text(item?.dssEvaluationId) === identity.dssEvaluationId
  ));
  if (!dss) {
    throw authorizationError("ARM authorization DSS evaluation was not found", "DSS_EVALUATION_NOT_FOUND");
  }
  if (upper(dss.status) !== "VALID") {
    throw authorizationError("ARM authorization requires a VALID DSS evaluation", "DSS_EVALUATION_NOT_VALID");
  }
  if (
    text(dss.candidateId) !== identity.candidateId
    || Number(dss.candidateContractVersion) !== identity.contractVersion
    || text(dss.candidateContentHash) !== identity.candidateContentHash
  ) {
    throw authorizationError("DSS identity does not match candidate", "DSS_EVALUATION_IDENTITY_MISMATCH");
  }

  const authorizedAt = validIso(store.clock());
  if (!authorizedAt) {
    throw authorizationError("pre-trade store clock returned an invalid timestamp", "ARM_AUTHORIZATION_CLOCK_INVALID");
  }

  const previousState = structuredClone(store.state);
  const arm = {
    authorizedAt,
    candidateVersion: identity.contractVersion,
    dssEvaluationId: identity.dssEvaluationId,
    riskEvaluationId: identity.riskEvaluationId,
    selectedQuantity: identity.selectedQuantity,
  };

  candidate.authorizedDssEvaluationId = identity.dssEvaluationId;
  candidate.authorizedRiskEvaluationId = identity.riskEvaluationId;
  candidate.lifecycleState = "ARMED";
  candidate.arm = immutable(arm);
  store.state.updatedAt = authorizedAt;

  try {
    store.save();
  } catch (error) {
    store.state = previousState;
    throw authorizationError("ARM authorization persistence failed", "ARM_AUTHORIZATION_PERSISTENCE_ERROR", error);
  }

  return immutable({
    candidateId: identity.candidateId,
    contractVersion: identity.contractVersion,
    lifecycleState: "ARMED",
    arm,
  });
}
