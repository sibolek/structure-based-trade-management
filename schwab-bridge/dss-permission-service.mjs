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

function serviceError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function identityInput(candidate) {
  return {
    candidate: {
      candidateId: text(candidate?.candidateId),
      sourceId: upper(candidate?.source),
      contractVersion: Number(candidate?.contractVersion),
      candidateContentHash: text(candidate?.contentHash),
      symbol: upper(candidate?.symbol),
      direction: upper(candidate?.direction),
      decisionTimeframe: "5m",
      entryTimeframe: "2m",
    },
  };
}

function findPersistedCandidate(state, { sourceId, candidateId, contractVersion }) {
  const candidates = Array.isArray(state?.candidates) ? state.candidates : [];
  const byVersion = candidates.find((candidate) => (
    text(candidate?.candidateId) === candidateId
    && Number(candidate?.contractVersion) === contractVersion
  ));
  if (!byVersion) {
    throw serviceError(
      `candidate ${sourceId}:${candidateId} v${contractVersion} was not found`,
      "DSS_PERMISSION_CANDIDATE_NOT_FOUND",
    );
  }
  if (upper(byVersion.source) !== sourceId) {
    throw serviceError(
      `candidate ${candidateId} v${contractVersion} belongs to source ${upper(byVersion.source)}, not ${sourceId}`,
      "DSS_PERMISSION_SOURCE_MISMATCH",
    );
  }
  return byVersion;
}

function findEvaluation(state, dssEvaluationId) {
  return (Array.isArray(state?.dssEvaluations) ? state.dssEvaluations : []).find((evaluation) => (
    text(evaluation?.dssEvaluationId) === text(dssEvaluationId)
  ));
}

export class DssPermissionService {
  constructor({ store, inputAssembler, runtime } = {}) {
    if (!store || typeof store.snapshot !== "function") {
      throw new Error("DssPermissionService requires a pre-trade store with snapshot()");
    }
    if (!inputAssembler || typeof inputAssembler.assemble !== "function") {
      throw new Error("DssPermissionService requires a DSS input assembler with assemble()");
    }
    if (!runtime || typeof runtime.evaluate !== "function" || typeof runtime.riskHandoff !== "function") {
      throw new Error("DssPermissionService requires a DssRuntime-compatible runtime");
    }

    this.store = store;
    this.inputAssembler = inputAssembler;
    this.runtime = runtime;
  }

  async evaluate({
    sourceId,
    candidateId,
    contractVersion,
    structuralInvalidationDefinition,
    structureEvaluation,
  } = {}) {
    const identity = {
      sourceId: upper(sourceId),
      candidateId: text(candidateId),
      contractVersion: Number(contractVersion),
    };

    if (!identity.sourceId || !identity.candidateId || !Number.isInteger(identity.contractVersion) || identity.contractVersion < 1) {
      throw serviceError(
        "DSS permission evaluation requires sourceId, candidateId, and integer contractVersion >= 1",
        "INVALID_DSS_PERMISSION_CANDIDATE_IDENTITY",
      );
    }
    if (!structuralInvalidationDefinition || typeof structuralInvalidationDefinition !== "object") {
      throw serviceError(
        "structuralInvalidationDefinition is required before DSS permission evaluation",
        "MISSING_DSS_PERMISSION_STRUCTURE_DEFINITION",
      );
    }
    if (!structureEvaluation || typeof structureEvaluation !== "object") {
      throw serviceError(
        "structureEvaluation is required before DSS permission evaluation",
        "MISSING_DSS_PERMISSION_STRUCTURE_EVALUATION",
      );
    }

    const state = this.store.snapshot();
    const candidate = findPersistedCandidate(state, identity);
    const compactIdentityInput = identityInput(candidate);

    // Authorized DSS identity is already frozen. Let DssRuntime enforce the exact
    // persisted-evaluation audit invariant without performing market-data reads.
    if (candidate.authorizedDssEvaluationId) {
      return immutable(this.runtime.evaluate(compactIdentityInput));
    }

    const lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
    if (lifecycleState !== "PERMISSION_EVALUATING") {
      throw serviceError(
        `DSS permission evaluation is not allowed while candidate is ${lifecycleState}`,
        "DSS_PERMISSION_NOT_ALLOWED_IN_STATE",
      );
    }

    // A fresh VALID evaluation is reusable until a newer completed 2m bar makes it
    // stale. Avoid unnecessary quote/history reads on quote-only permission activity.
    if (candidate.currentDssEvaluationId && !candidate.currentDssEvaluationStale) {
      const current = findEvaluation(state, candidate.currentDssEvaluationId);
      if (!current) {
        // Preserve DssRuntime's fail-closed corruption handling and error code.
        return immutable(this.runtime.evaluate(compactIdentityInput));
      }
      if (upper(current.status) === "VALID") {
        return immutable(this.runtime.evaluate(compactIdentityInput));
      }
      // BLOCKED/ERROR evaluations are retryable and therefore fall through to a
      // newly assembled live input.
    }

    const input = await this.inputAssembler.assemble({
      candidate: compactIdentityInput.candidate,
      structuralInvalidationDefinition: structuredClone(structuralInvalidationDefinition),
      structureEvaluation: structuredClone(structureEvaluation),
    });

    return immutable(this.runtime.evaluate(input));
  }

  riskHandoff(candidateId, contractVersion) {
    return immutable(this.runtime.riskHandoff(text(candidateId), Number(contractVersion)));
  }
}
