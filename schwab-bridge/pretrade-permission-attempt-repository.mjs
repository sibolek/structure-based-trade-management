import fs from "node:fs";
import path from "node:path";
import { immutablePermissionAttempt, validatePermissionAttempt } from "./pretrade-permission-attempt.mjs";

export const PRETRADE_PERMISSION_ATTEMPT_REPOSITORY_SCHEMA_VERSION = 1;
export const DEFAULT_PRETRADE_PERMISSION_ATTEMPT_FILE = ".executionos-v24-permission-attempts.json";

function text(value) {
  return String(value ?? "").trim();
}

function repositoryError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function emptyState() {
  return {
    schemaVersion: PRETRADE_PERMISSION_ATTEMPT_REPOSITORY_SCHEMA_VERSION,
    updatedAt: null,
    attempts: [],
  };
}

function normalizeState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    schemaVersion: PRETRADE_PERMISSION_ATTEMPT_REPOSITORY_SCHEMA_VERSION,
    updatedAt: text(source.updatedAt) || null,
    attempts: Array.isArray(source.attempts)
      ? source.attempts.filter((item) => item && typeof item === "object").map(immutablePermissionAttempt)
      : [],
  };
}

export class PreTradePermissionAttemptRepository {
  constructor({ filePath = DEFAULT_PRETRADE_PERMISSION_ATTEMPT_FILE, clock = () => new Date().toISOString() } = {}) {
    if (typeof clock !== "function") throw new Error("clock must be a function");
    this.filePath = path.resolve(filePath);
    this.clock = clock;
    this.state = emptyState();
  }

  load() {
    try {
      this.state = normalizeState(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.state = emptyState();
    }
    this.#assertContracts();
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

  record(attempt) {
    const validation = validatePermissionAttempt(attempt);
    if (!validation.valid) {
      throw repositoryError(`permission attempt contract is invalid: ${validation.errors.join("; ")}`, "INVALID_PERMISSION_ATTEMPT");
    }
    const id = text(attempt.permissionAttemptId);
    const operationId = text(attempt.operationId);
    const existingId = this.state.attempts.find((item) => text(item.permissionAttemptId) === id);
    if (existingId) throw repositoryError(`permissionAttemptId ${id} already exists`, "PERMISSION_ATTEMPT_ID_CONFLICT");
    const existingOperation = this.state.attempts.find((item) => text(item.operationId) === operationId);
    if (existingOperation) {
      if (text(existingOperation.operationHash) !== text(attempt.operationHash)) {
        throw repositoryError(`operationId ${operationId} is already bound to different permission inputs`, "PERMISSION_OPERATION_ID_CONFLICT");
      }
      return immutablePermissionAttempt(existingOperation);
    }

    const immutableAttempt = immutablePermissionAttempt(attempt);
    this.state.attempts.push(immutableAttempt);
    const recordedAt = this.clock();
    const parsed = Date.parse(String(recordedAt ?? ""));
    if (!Number.isFinite(parsed)) {
      this.state.attempts.pop();
      throw repositoryError("permission attempt repository clock returned an invalid timestamp", "PERMISSION_ATTEMPT_REPOSITORY_CLOCK_INVALID");
    }
    this.state.updatedAt = new Date(parsed).toISOString();
    this.save();
    return immutablePermissionAttempt(immutableAttempt);
  }

  getById(permissionAttemptId) {
    const id = text(permissionAttemptId);
    const found = this.state.attempts.find((item) => text(item.permissionAttemptId) === id);
    if (!found) throw repositoryError(`permission attempt ${id} was not found`, "PERMISSION_ATTEMPT_NOT_FOUND");
    return immutablePermissionAttempt(found);
  }

  getByOperationId(operationId) {
    const id = text(operationId);
    if (!id) return null;
    const found = this.state.attempts.find((item) => text(item.operationId) === id);
    return found ? immutablePermissionAttempt(found) : null;
  }

  listForCandidate(candidateId, contractVersion = null) {
    const id = text(candidateId);
    const version = contractVersion === null || contractVersion === undefined ? null : Number(contractVersion);
    return this.state.attempts
      .filter((item) => text(item.candidate?.candidateId) === id)
      .filter((item) => version === null || Number(item.candidate?.contractVersion) === version)
      .map(immutablePermissionAttempt);
  }

  #assertContracts() {
    const ids = new Set();
    const operations = new Map();
    for (const attempt of this.state.attempts) {
      const validation = validatePermissionAttempt(attempt);
      if (!validation.valid) throw repositoryError(`persisted permission attempt is invalid: ${validation.errors.join("; ")}`, "CORRUPT_PERMISSION_ATTEMPT_REPOSITORY");
      const id = text(attempt.permissionAttemptId);
      if (ids.has(id)) throw repositoryError(`persisted permissionAttemptId ${id} is duplicated`, "CORRUPT_PERMISSION_ATTEMPT_REPOSITORY");
      ids.add(id);
      const operationId = text(attempt.operationId);
      const operationHash = text(attempt.operationHash);
      if (operations.has(operationId) && operations.get(operationId) !== operationHash) {
        throw repositoryError(`persisted operationId ${operationId} has conflicting payloads`, "CORRUPT_PERMISSION_ATTEMPT_REPOSITORY");
      }
      operations.set(operationId, operationHash);
    }
  }
}
