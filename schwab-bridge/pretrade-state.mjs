import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PRETRADE_SCHEMA_VERSION = 1;
export const DEFAULT_PRETRADE_STATE_FILE = ".executionos-v24-state.json";
export const PRETRADE_TRIGGER_EVALUATING = "PRETRADE_TRIGGER_EVALUATING";

const LEGACY_TRIGGER_EVALUATING = "TRIGGER_EVALUATING";
const DSS_STATUSES = new Set(["VALID", "BLOCKED", "ERROR"]);
const DSS_PERMISSION_ACTIVE_STATES = new Set([
  "PERMISSION_EVALUATING",
  "READY",
  "CAUTION",
]);

const ACTIVE_PRETRADE_STATES = new Set([
  "INGESTED",
  "WAITING",
  PRETRADE_TRIGGER_EVALUATING,
  "PERMISSION_EVALUATING",
  "READY",
  "CAUTION",
]);

function nowIso() {
  return new Date().toISOString();
}

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function text(value) {
  return String(value ?? "").trim();
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function runtimeCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return candidate;
  return {
    ...candidate,
    lifecycleState: canonicalLifecycleState(candidate.lifecycleState),
    currentDssEvaluationId: text(candidate.currentDssEvaluationId) || null,
    authorizedDssEvaluationId: text(candidate.authorizedDssEvaluationId) || null,
    currentDssEvaluationStale: Boolean(candidate.currentDssEvaluationStale),
    currentDssEvaluationStaleAt: text(candidate.currentDssEvaluationStaleAt) || null,
    currentDssEvaluationStaleReason: text(candidate.currentDssEvaluationStaleReason) || null,
    currentDssEvaluationStaleBarTimestamp: finiteTimestamp(candidate.currentDssEvaluationStaleBarTimestamp),
  };
}

export function canonicalLifecycleState(value) {
  return value === LEGACY_TRIGGER_EVALUATING ? PRETRADE_TRIGGER_EVALUATING : value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

export function contentHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function normalizeCandidate(input) {
  const candidate = input && typeof input === "object" ? input : {};
  const structural = candidate.structuralInvalidation && typeof candidate.structuralInvalidation === "object"
    ? candidate.structuralInvalidation
    : {};
  const armPolicy = candidate.armPolicy && typeof candidate.armPolicy === "object"
    ? candidate.armPolicy
    : {};

  const normalized = {
    candidateId: text(candidate.candidateId),
    contractVersion: Number(candidate.contractVersion),
    schemaVersion: Number(candidate.schemaVersion ?? PRETRADE_SCHEMA_VERSION),
    source: upper(candidate.source || "SOD_A_PLUS"),
    sourceDate: text(candidate.sourceDate),
    generatedAt: text(candidate.generatedAt),
    symbol: upper(candidate.symbol),
    direction: upper(candidate.direction),
    setup: text(candidate.setup),
    timeframe: text(candidate.timeframe || "2m"),
    thesis: text(candidate.thesis),
    trigger: candidate.trigger && typeof candidate.trigger === "object" ? candidate.trigger : null,
    structuralInvalidation: {
      price: finiteNumber(structural.price),
      rule: text(structural.rule),
      referenceType: text(structural.referenceType),
      reason: text(structural.reason),
    },
    plannedEntryReference: candidate.plannedEntryReference ?? null,
    targets: Array.isArray(candidate.targets) ? candidate.targets : [],
    managementPlan: candidate.managementPlan ?? null,
    context: candidate.context ?? null,
    rating: candidate.rating ?? null,
    validity: candidate.validity ?? null,
    armPolicy: {
      requestedMode: upper(armPolicy.requestedMode || "MANUAL"),
    },
  };

  const errors = [];
  if (!normalized.candidateId) errors.push("candidateId is required");
  if (!Number.isInteger(normalized.contractVersion) || normalized.contractVersion < 1) errors.push("contractVersion must be an integer >= 1");
  if (!Number.isInteger(normalized.schemaVersion) || normalized.schemaVersion < 1) errors.push("schemaVersion must be an integer >= 1");
  if (!normalized.sourceDate) errors.push("sourceDate is required");
  if (!normalized.generatedAt || Number.isNaN(Date.parse(normalized.generatedAt))) errors.push("generatedAt must be an ISO-compatible timestamp");
  if (!normalized.symbol) errors.push("symbol is required");
  if (!["LONG", "SHORT"].includes(normalized.direction)) errors.push("direction must be LONG or SHORT");
  if (!normalized.setup) errors.push("setup is required");
  if (!normalized.thesis) errors.push("thesis is required");
  if (!normalized.trigger) errors.push("trigger object is required");
  if (normalized.structuralInvalidation.price === null) errors.push("structuralInvalidation.price must be numeric");
  if (!normalized.structuralInvalidation.rule) errors.push("structuralInvalidation.rule is required");
  if (!["MANUAL", "AUTO"].includes(normalized.armPolicy.requestedMode)) errors.push("armPolicy.requestedMode must be MANUAL or AUTO");

  return { normalized, errors };
}

function emptyState() {
  return {
    schemaVersion: PRETRADE_SCHEMA_VERSION,
    updatedAt: null,
    candidates: [],
    dssEvaluations: [],
    importLog: [],
  };
}

function normalizeState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  const dssEvaluations = Array.isArray(state.dssEvaluations)
    ? state.dssEvaluations
        .filter((evaluation) => evaluation && typeof evaluation === "object")
        .map((evaluation) => deepFreeze(structuredClone(evaluation)))
    : [];
  const evaluationIds = new Set(dssEvaluations.map((evaluation) => text(evaluation.dssEvaluationId)).filter(Boolean));
  const candidates = Array.isArray(state.candidates)
    ? state.candidates.map((candidate) => {
        const normalized = runtimeCandidate(candidate);
        if (!normalized || typeof normalized !== "object") return normalized;
        if (normalized.currentDssEvaluationId && !evaluationIds.has(normalized.currentDssEvaluationId)) {
          normalized.currentDssEvaluationStale = true;
          normalized.currentDssEvaluationStaleAt ||= state.updatedAt || null;
          normalized.currentDssEvaluationStaleReason = "MISSING_PERSISTED_DSS_EVALUATION";
        }
        return normalized;
      })
    : [];

  return {
    schemaVersion: PRETRADE_SCHEMA_VERSION,
    updatedAt: state.updatedAt || null,
    candidates,
    dssEvaluations,
    importLog: Array.isArray(state.importLog) ? state.importLog : [],
  };
}

function storeError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export class PreTradeStore {
  constructor({ filePath = DEFAULT_PRETRADE_STATE_FILE, clock = nowIso } = {}) {
    this.filePath = path.resolve(filePath);
    this.clock = clock;
    this.state = emptyState();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      this.state = normalizeState(parsed);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.state = emptyState();
    }
    return this.snapshot();
  }

  snapshot() {
    return structuredClone(this.state);
  }

  save() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, this.filePath);
  }

  importBundle(bundle) {
    if (!bundle || typeof bundle !== "object" || !Array.isArray(bundle.candidates)) {
      throw storeError("Import bundle must be an object with a candidates array", "INVALID_BUNDLE");
    }

    const importedAt = this.clock();
    const outcomes = bundle.candidates.map((candidate) => this.#importCandidate(candidate, importedAt));
    this.state.updatedAt = importedAt;
    this.state.importLog.push({
      importedAt,
      source: upper(bundle.source || "UNKNOWN"),
      bundleId: text(bundle.bundleId) || null,
      accepted: outcomes.filter((item) => item.status === "ACCEPTED").length,
      duplicate: outcomes.filter((item) => item.status === "DUPLICATE").length,
      rejected: outcomes.filter((item) => item.status === "REJECTED").length,
      conflict: outcomes.filter((item) => item.status === "CONFLICT").length,
      stale: outcomes.filter((item) => item.status === "STALE").length,
    });
    this.save();
    return { importedAt, outcomes };
  }

  recordDssEvaluation(evaluation) {
    if (!evaluation || typeof evaluation !== "object") {
      throw storeError("DSS evaluation must be an object", "INVALID_DSS_EVALUATION");
    }

    const dssEvaluationId = text(evaluation.dssEvaluationId);
    const status = upper(evaluation.status);
    const candidateId = text(evaluation.candidateId);
    const contractVersion = Number(evaluation.candidateContractVersion);
    const candidateContentHash = text(evaluation.candidateContentHash);

    if (!dssEvaluationId) throw storeError("dssEvaluationId is required", "INVALID_DSS_EVALUATION");
    if (!DSS_STATUSES.has(status)) throw storeError("status must be VALID, BLOCKED, or ERROR", "INVALID_DSS_EVALUATION");
    if (!candidateId || !Number.isInteger(contractVersion) || contractVersion < 1) {
      throw storeError("DSS evaluation candidate identity is invalid", "INVALID_DSS_EVALUATION");
    }
    if (this.state.dssEvaluations.some((item) => item.dssEvaluationId === dssEvaluationId)) {
      throw storeError(`dssEvaluationId ${dssEvaluationId} already exists`, "DSS_EVALUATION_ID_CONFLICT");
    }

    const candidate = this.#findCandidate(candidateId, contractVersion);
    if (canonicalLifecycleState(candidate.lifecycleState) !== "PERMISSION_EVALUATING") {
      throw storeError(
        `DSS evaluation cannot be recorded while candidate is ${candidate.lifecycleState}`,
        "DSS_EVALUATION_NOT_ALLOWED_IN_STATE",
      );
    }
    if (candidate.authorizedDssEvaluationId) {
      throw storeError("authorized DSS evaluation is frozen; Phase 3 recalculation is prohibited", "DSS_EVALUATION_FROZEN");
    }
    if (candidate.currentDssEvaluationId && !candidate.currentDssEvaluationStale) {
      const currentEvaluation = this.#findDssEvaluation(candidate.currentDssEvaluationId);
      if (upper(currentEvaluation.status) === "VALID") {
        throw storeError(
          "current VALID DSS evaluation is still fresh; recalculation requires a new completed 2-minute bar",
          "DSS_RECALCULATION_NOT_REQUIRED",
        );
      }
    }
    if (upper(evaluation.sourceId) !== upper(candidate.source)) {
      throw storeError("DSS evaluation sourceId does not match candidate source", "DSS_CANDIDATE_SOURCE_MISMATCH");
    }
    if (candidateContentHash !== text(candidate.contentHash)) {
      throw storeError("DSS evaluation candidateContentHash does not match candidate version", "DSS_CANDIDATE_HASH_MISMATCH");
    }

    const immutableEvaluation = deepFreeze(structuredClone({ ...evaluation, status }));
    this.state.dssEvaluations.push(immutableEvaluation);
    candidate.currentDssEvaluationId = dssEvaluationId;
    candidate.currentDssEvaluationStale = false;
    candidate.currentDssEvaluationStaleAt = null;
    candidate.currentDssEvaluationStaleReason = null;
    candidate.currentDssEvaluationStaleBarTimestamp = null;

    const recordedAt = this.clock();
    this.state.updatedAt = recordedAt;
    this.save();

    return {
      dssEvaluationId,
      status,
      candidateId,
      contractVersion,
      currentDssEvaluationId: candidate.currentDssEvaluationId,
      recordedAt,
    };
  }

  markCurrentDssEvaluationStale({
    candidateId,
    contractVersion,
    completedBarTimestamp,
    observedAt = null,
  } = {}) {
    const candidate = this.#findCandidate(text(candidateId), Number(contractVersion));
    const lifecycleState = canonicalLifecycleState(candidate.lifecycleState);

    if (candidate.authorizedDssEvaluationId) {
      return { status: "FROZEN", reason: "AUTHORIZED_DSS_EVALUATION", dssEvaluationId: candidate.authorizedDssEvaluationId };
    }
    if (!DSS_PERMISSION_ACTIVE_STATES.has(lifecycleState)) {
      return { status: "IGNORED", reason: "PERMISSION_NOT_ACTIVE", lifecycleState };
    }
    if (!candidate.currentDssEvaluationId) {
      return { status: "IGNORED", reason: "NO_CURRENT_DSS_EVALUATION", lifecycleState };
    }
    if (candidate.currentDssEvaluationStale) {
      return { status: "ALREADY_STALE", dssEvaluationId: candidate.currentDssEvaluationId };
    }

    const nextBarTimestamp = finiteTimestamp(completedBarTimestamp);
    if (nextBarTimestamp === null) {
      throw storeError("completedBarTimestamp must be an epoch-millisecond or ISO-compatible timestamp", "INVALID_COMPLETED_BAR_TIMESTAMP");
    }

    const evaluation = this.#findDssEvaluation(candidate.currentDssEvaluationId);
    const currentBarTimestamp = finiteTimestamp(evaluation.latestCompletedBar?.timestamp);
    if (currentBarTimestamp === null) {
      return { status: "IGNORED", reason: "NO_COMPLETED_BAR_PROVENANCE", dssEvaluationId: evaluation.dssEvaluationId };
    }
    if (nextBarTimestamp <= currentBarTimestamp) {
      return {
        status: "IGNORED",
        reason: "COMPLETED_BAR_NOT_NEWER",
        dssEvaluationId: evaluation.dssEvaluationId,
        currentBarTimestamp,
        completedBarTimestamp: nextBarTimestamp,
      };
    }

    const observedTimestamp = observedAt ? finiteTimestamp(observedAt) : null;
    if (observedAt && observedTimestamp === null) {
      throw storeError("observedAt must be an epoch-millisecond or ISO-compatible timestamp", "INVALID_STALE_OBSERVED_AT");
    }
    const staleAt = observedTimestamp === null ? this.clock() : new Date(observedTimestamp).toISOString();

    candidate.currentDssEvaluationStale = true;
    candidate.currentDssEvaluationStaleAt = staleAt;
    candidate.currentDssEvaluationStaleReason = "NEW_COMPLETED_2M_BAR";
    candidate.currentDssEvaluationStaleBarTimestamp = nextBarTimestamp;
    this.state.updatedAt = staleAt;
    this.save();

    return {
      status: "STALE",
      reason: candidate.currentDssEvaluationStaleReason,
      dssEvaluationId: evaluation.dssEvaluationId,
      staleAt,
      previousCompletedBarTimestamp: currentBarTimestamp,
      completedBarTimestamp: nextBarTimestamp,
    };
  }

  currentDssEvaluationForRiskHandoff(candidateId, contractVersion) {
    const candidate = this.#findCandidate(text(candidateId), Number(contractVersion));
    if (canonicalLifecycleState(candidate.lifecycleState) !== "PERMISSION_EVALUATING") {
      throw storeError(
        `Phase 4 DSS handoff is not allowed while candidate is ${candidate.lifecycleState}`,
        "DSS_HANDOFF_NOT_ALLOWED_IN_STATE",
      );
    }
    if (!candidate.currentDssEvaluationId) {
      throw storeError("candidate has no current DSS evaluation", "NO_CURRENT_DSS_EVALUATION");
    }
    if (candidate.currentDssEvaluationStale) {
      throw storeError("current DSS evaluation is stale and must be recalculated", "STALE_DSS_EVALUATION");
    }

    const evaluation = this.#findDssEvaluation(candidate.currentDssEvaluationId);
    if (upper(evaluation.status) !== "VALID") {
      throw storeError(`current DSS evaluation status is ${evaluation.status}`, "DSS_EVALUATION_NOT_VALID");
    }
    if (
      text(evaluation.candidateId) !== text(candidate.candidateId)
      || Number(evaluation.candidateContractVersion) !== Number(candidate.contractVersion)
      || text(evaluation.candidateContentHash) !== text(candidate.contentHash)
    ) {
      throw storeError("current DSS evaluation identity does not match candidate version", "DSS_EVALUATION_IDENTITY_MISMATCH");
    }

    return deepFreeze(structuredClone({
      dssEvaluationId: evaluation.dssEvaluationId,
      evaluation,
    }));
  }

  #findCandidate(candidateId, contractVersion) {
    const candidate = this.state.candidates.find((item) => (
      text(item?.candidateId) === candidateId
      && Number(item?.contractVersion) === contractVersion
    ));
    if (!candidate) {
      throw storeError(`candidate ${candidateId} v${contractVersion} was not found`, "CANDIDATE_NOT_FOUND");
    }
    return candidate;
  }

  #findDssEvaluation(dssEvaluationId) {
    const evaluation = this.state.dssEvaluations.find((item) => text(item?.dssEvaluationId) === text(dssEvaluationId));
    if (!evaluation) {
      throw storeError(`DSS evaluation ${dssEvaluationId} was not found`, "DSS_EVALUATION_NOT_FOUND");
    }
    return evaluation;
  }

  #importCandidate(input, importedAt) {
    const { normalized, errors } = normalizeCandidate(input);
    if (errors.length) {
      return {
        candidateId: normalized.candidateId || null,
        contractVersion: Number.isInteger(normalized.contractVersion) ? normalized.contractVersion : null,
        status: "REJECTED",
        reasons: errors,
      };
    }

    const hash = contentHash(normalized);
    const versions = this.state.candidates.filter((item) => item.candidateId === normalized.candidateId);
    const sameVersion = versions.find((item) => item.contractVersion === normalized.contractVersion);

    if (sameVersion) {
      if (sameVersion.contentHash === hash) {
        return {
          candidateId: normalized.candidateId,
          contractVersion: normalized.contractVersion,
          status: "DUPLICATE",
          reasons: ["same candidateId, contractVersion, and content already imported"],
        };
      }
      return {
        candidateId: normalized.candidateId,
        contractVersion: normalized.contractVersion,
        status: "CONFLICT",
        reasons: ["same candidateId and contractVersion already exist with different content"],
      };
    }

    const newestVersion = versions.reduce((max, item) => Math.max(max, Number(item.contractVersion || 0)), 0);
    if (newestVersion > normalized.contractVersion) {
      return {
        candidateId: normalized.candidateId,
        contractVersion: normalized.contractVersion,
        status: "STALE",
        reasons: [`newer contractVersion ${newestVersion} already exists`],
      };
    }

    for (const existing of versions) {
      if (existing.contractVersion < normalized.contractVersion && ACTIVE_PRETRADE_STATES.has(canonicalLifecycleState(existing.lifecycleState))) {
        existing.lifecycleState = "SUPERSEDED";
        existing.supersededAt = importedAt;
        existing.supersededByVersion = normalized.contractVersion;
      }
    }

    this.state.candidates.push({
      ...normalized,
      contentHash: hash,
      lifecycleState: "WAITING",
      importedAt,
      evaluation: null,
      currentDssEvaluationId: null,
      authorizedDssEvaluationId: null,
      currentDssEvaluationStale: false,
      currentDssEvaluationStaleAt: null,
      currentDssEvaluationStaleReason: null,
      currentDssEvaluationStaleBarTimestamp: null,
      arm: null,
    });

    return {
      candidateId: normalized.candidateId,
      contractVersion: normalized.contractVersion,
      status: "ACCEPTED",
      lifecycleState: "WAITING",
      reasons: [],
    };
  }
}
