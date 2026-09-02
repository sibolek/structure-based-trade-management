import fs from "node:fs";
import path from "node:path";
import { validateExecutionBoardHandoffContract } from "./execution-board-handoff.mjs";

export const EXECUTION_BOARD_HANDOFF_REPOSITORY_SCHEMA_VERSION = 1;
export const DEFAULT_EXECUTION_BOARD_HANDOFF_FILE = ".executionos-v24-execution-board-handoffs.json";

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
    schemaVersion: EXECUTION_BOARD_HANDOFF_REPOSITORY_SCHEMA_VERSION,
    updatedAt: null,
    handoffs: [],
  };
}

function normalizeState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    schemaVersion: EXECUTION_BOARD_HANDOFF_REPOSITORY_SCHEMA_VERSION,
    updatedAt: text(source.updatedAt) || null,
    handoffs: Array.isArray(source.handoffs)
      ? source.handoffs
        .filter((value) => value && typeof value === "object")
        .map((value) => immutable(value))
      : [],
  };
}

export class ExecutionBoardHandoffRepository {
  constructor({
    filePath = DEFAULT_EXECUTION_BOARD_HANDOFF_FILE,
    clock = () => new Date().toISOString(),
  } = {}) {
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

  record(handoff) {
    const contract = validateExecutionBoardHandoffContract(handoff);
    if (!contract.valid) {
      throw repositoryError(
        `Execution Board handoff contract is invalid: ${contract.errors.join("; ")}`,
        "INVALID_EXECUTION_BOARD_HANDOFF",
      );
    }

    const handoffId = text(handoff.handoffId);
    if (this.state.handoffs.some((item) => text(item?.handoffId) === handoffId)) {
      throw repositoryError(
        `handoffId ${handoffId} already exists`,
        "EXECUTION_BOARD_HANDOFF_ID_CONFLICT",
      );
    }

    const riskEvaluationId = text(handoff.riskEvaluationId);
    if (this.state.handoffs.some((item) => text(item?.riskEvaluationId) === riskEvaluationId)) {
      throw repositoryError(
        `riskEvaluationId ${riskEvaluationId} already has an Execution Board handoff`,
        "EXECUTION_BOARD_HANDOFF_AUTHORIZATION_CONFLICT",
      );
    }

    const immutableHandoff = immutable(handoff);
    this.state.handoffs.push(immutableHandoff);

    const recordedAt = this.clock();
    if (!text(recordedAt) || Number.isNaN(Date.parse(recordedAt))) {
      this.state.handoffs.pop();
      throw repositoryError(
        "repository clock returned an invalid timestamp",
        "EXECUTION_BOARD_HANDOFF_REPOSITORY_CLOCK_INVALID",
      );
    }

    this.state.updatedAt = new Date(Date.parse(recordedAt)).toISOString();
    try {
      this.save();
    } catch (error) {
      this.state.handoffs.pop();
      throw repositoryError(
        "Execution Board handoff persistence failed",
        "EXECUTION_BOARD_HANDOFF_PERSISTENCE_ERROR",
      );
    }

    return immutable({
      handoffId,
      sourceId: immutableHandoff.sourceId,
      candidateId: immutableHandoff.candidateId,
      contractVersion: immutableHandoff.contractVersion,
      riskEvaluationId: immutableHandoff.riskEvaluationId,
      recordedAt: this.state.updatedAt,
    });
  }

  getById(handoffId) {
    const normalizedId = text(handoffId);
    if (!normalizedId) {
      throw repositoryError("handoffId is required", "EXECUTION_BOARD_HANDOFF_ID_REQUIRED");
    }
    const found = this.state.handoffs.find((item) => text(item?.handoffId) === normalizedId);
    if (!found) {
      throw repositoryError(`Execution Board handoff ${normalizedId} was not found`, "EXECUTION_BOARD_HANDOFF_NOT_FOUND");
    }
    return immutable(found);
  }

  getByRiskEvaluationId(riskEvaluationId) {
    const normalizedId = text(riskEvaluationId);
    if (!normalizedId) {
      throw repositoryError("riskEvaluationId is required", "RISK_EVALUATION_ID_REQUIRED");
    }
    const found = this.state.handoffs.find((item) => text(item?.riskEvaluationId) === normalizedId);
    return found ? immutable(found) : null;
  }

  listForCandidate(candidateId, contractVersion = null) {
    const normalizedCandidateId = text(candidateId);
    if (!normalizedCandidateId) return [];
    const version = contractVersion === null || contractVersion === undefined ? null : Number(contractVersion);
    return this.state.handoffs
      .filter((item) => text(item?.candidateId) === normalizedCandidateId)
      .filter((item) => version === null || Number(item?.contractVersion) === version)
      .map((item) => immutable(item));
  }

  #assertPersistedContracts() {
    const handoffIds = new Set();
    const riskEvaluationIds = new Set();

    for (const handoff of this.state.handoffs) {
      const contract = validateExecutionBoardHandoffContract(handoff);
      if (!contract.valid) {
        throw repositoryError(
          `persisted Execution Board handoff is invalid: ${contract.errors.join("; ")}`,
          "CORRUPT_EXECUTION_BOARD_HANDOFF_REPOSITORY",
        );
      }

      const handoffId = text(handoff.handoffId);
      const riskEvaluationId = text(handoff.riskEvaluationId);
      if (handoffIds.has(handoffId) || riskEvaluationIds.has(riskEvaluationId)) {
        throw repositoryError(
          "persisted Execution Board handoff repository contains duplicate authorization identity",
          "CORRUPT_EXECUTION_BOARD_HANDOFF_REPOSITORY",
        );
      }
      handoffIds.add(handoffId);
      riskEvaluationIds.add(riskEvaluationId);
    }
  }
}
