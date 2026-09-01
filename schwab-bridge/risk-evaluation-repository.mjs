import fs from "node:fs";
import path from "node:path";
import { validateRiskEvaluationContract } from "./risk-evaluation.mjs";

export const RISK_EVALUATION_REPOSITORY_SCHEMA_VERSION = 1;
export const DEFAULT_RISK_EVALUATION_FILE = ".executionos-v24-risk-evaluations.json";

function text(value) {
  return String(value ?? "").trim();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function repositoryError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function emptyState() {
  return {
    schemaVersion: RISK_EVALUATION_REPOSITORY_SCHEMA_VERSION,
    updatedAt: null,
    evaluations: [],
  };
}

function normalizeState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const evaluations = Array.isArray(source.evaluations)
    ? source.evaluations
      .filter((value) => value && typeof value === "object")
      .map((value) => immutable(value))
    : [];
  return {
    schemaVersion: RISK_EVALUATION_REPOSITORY_SCHEMA_VERSION,
    updatedAt: text(source.updatedAt) || null,
    evaluations,
  };
}

export class RiskEvaluationRepository {
  constructor({ filePath = DEFAULT_RISK_EVALUATION_FILE, clock = () => new Date().toISOString() } = {}) {
    if (typeof clock !== "function") throw new Error("clock must be a function");
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
    this.#assertPersistedContracts();
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

  record(evaluation) {
    const contract = validateRiskEvaluationContract(evaluation);
    if (!contract.valid) {
      throw repositoryError(
        `risk evaluation contract is invalid: ${contract.errors.join("; ")}`,
        "INVALID_RISK_EVALUATION",
      );
    }

    const riskEvaluationId = text(evaluation.riskEvaluationId);
    if (this.state.evaluations.some((item) => text(item?.riskEvaluationId) === riskEvaluationId)) {
      throw repositoryError(
        `riskEvaluationId ${riskEvaluationId} already exists`,
        "RISK_EVALUATION_ID_CONFLICT",
      );
    }

    const immutableEvaluation = immutable(evaluation);
    this.state.evaluations.push(immutableEvaluation);
    const recordedAt = this.clock();
    if (!text(recordedAt) || Number.isNaN(Date.parse(recordedAt))) {
      this.state.evaluations.pop();
      throw repositoryError("repository clock returned an invalid timestamp", "RISK_EVALUATION_REPOSITORY_CLOCK_INVALID");
    }
    this.state.updatedAt = new Date(Date.parse(recordedAt)).toISOString();
    this.save();

    return immutable({
      riskEvaluationId,
      candidateId: immutableEvaluation.candidate.candidateId,
      contractVersion: immutableEvaluation.candidate.contractVersion,
      dssEvaluationId: immutableEvaluation.dss.dssEvaluationId,
      status: immutableEvaluation.status,
      recordedAt: this.state.updatedAt,
    });
  }

  getById(riskEvaluationId) {
    const normalizedId = text(riskEvaluationId);
    if (!normalizedId) {
      throw repositoryError("riskEvaluationId is required", "RISK_EVALUATION_ID_REQUIRED");
    }
    const found = this.state.evaluations.find((item) => text(item?.riskEvaluationId) === normalizedId);
    if (!found) {
      throw repositoryError(`risk evaluation ${normalizedId} was not found`, "RISK_EVALUATION_NOT_FOUND");
    }
    return immutable(found);
  }

  listForCandidate(candidateId, contractVersion = null) {
    const normalizedCandidateId = text(candidateId);
    if (!normalizedCandidateId) return [];
    const version = contractVersion === null || contractVersion === undefined ? null : Number(contractVersion);
    return this.state.evaluations
      .filter((item) => text(item?.candidate?.candidateId) === normalizedCandidateId)
      .filter((item) => version === null || Number(item?.candidate?.contractVersion) === version)
      .map((item) => immutable(item));
  }

  #assertPersistedContracts() {
    const seen = new Set();
    for (const evaluation of this.state.evaluations) {
      const contract = validateRiskEvaluationContract(evaluation);
      if (!contract.valid) {
        throw repositoryError(
          `persisted risk evaluation is invalid: ${contract.errors.join("; ")}`,
          "CORRUPT_RISK_EVALUATION_REPOSITORY",
        );
      }
      const id = text(evaluation.riskEvaluationId);
      if (seen.has(id)) {
        throw repositoryError(
          `persisted riskEvaluationId ${id} is duplicated`,
          "CORRUPT_RISK_EVALUATION_REPOSITORY",
        );
      }
      seen.add(id);
    }
  }
}
