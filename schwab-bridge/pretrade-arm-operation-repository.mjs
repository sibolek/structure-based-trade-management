import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PRETRADE_ARM_OPERATION_REPOSITORY_SCHEMA_VERSION = 1;
export const PRETRADE_ARM_OPERATION_SCHEMA_VERSION = 1;
export const DEFAULT_PRETRADE_ARM_OPERATION_FILE = ".executionos-v24-arm-operations.json";
export const PRETRADE_ARM_OPERATION_AUTHORITY = "PRETRADE_ARM_OPERATION";

const STATUSES = new Set(["REQUESTED", "REVIEW_REQUIRED", "REJECTED", "AUTHORIZED", "COMPLETED"]);
const PERMISSION_STATES = new Set(["READY", "CAUTION"]);
const DIRECTIONS = new Set(["LONG", "SHORT"]);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
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

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function opError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validIso(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function positiveNumber(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function validAuthorization(authorization) {
  const value = authorization && typeof authorization === "object" ? authorization : {};
  if (!text(value.candidateId) || !Number.isInteger(Number(value.contractVersion)) || Number(value.contractVersion) < 1) return false;
  if (!text(value.candidateContentHash) || !text(value.symbol) || !DIRECTIONS.has(upper(value.direction))) return false;
  if (!text(value.reviewPackageId) || !text(value.permissionAttemptId) || !PERMISSION_STATES.has(upper(value.permissionState))) return false;
  if (!Number.isInteger(Number(value.permissionStateRevision)) || Number(value.permissionStateRevision) < 0) return false;
  if (!text(value.dssEvaluationId) || !text(value.riskEvaluationId) || !text(value.accountId)) return false;
  if (positiveNumber(value.selectedQuantity) === null || !validIso(value.authorizedAt)) return false;
  if (!text(value.handoffId) || !validIso(value.handoffCreatedAt)) return false;
  if (!value.executionOwnershipProof || upper(value.executionOwnershipProof.status) !== "FREE") return false;
  if (Array.isArray(value.ocoSiblings)) {
    for (const sibling of value.ocoSiblings) {
      if (!text(sibling?.candidateId) || !Number.isInteger(Number(sibling?.contractVersion)) || Number(sibling.contractVersion) < 1) return false;
    }
  }
  return true;
}

function emptyState() {
  return {
    schemaVersion: PRETRADE_ARM_OPERATION_REPOSITORY_SCHEMA_VERSION,
    updatedAt: null,
    operations: [],
  };
}

export function armAuthorizationProof(record) {
  if (!record || !["AUTHORIZED", "COMPLETED"].includes(upper(record.status)) || !validAuthorization(record.authorization)) return null;
  return immutable({
    authority: PRETRADE_ARM_OPERATION_AUTHORITY,
    status: "AUTHORIZED",
    operationId: record.operationId,
    ...record.authorization,
  });
}

export class PreTradeArmOperationRepository {
  constructor({ filePath = DEFAULT_PRETRADE_ARM_OPERATION_FILE, clock = () => new Date().toISOString() } = {}) {
    if (typeof clock !== "function") throw new Error("clock must be a function");
    this.filePath = path.resolve(filePath);
    this.clock = clock;
    this.state = emptyState();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      this.state = {
        schemaVersion: PRETRADE_ARM_OPERATION_REPOSITORY_SCHEMA_VERSION,
        updatedAt: text(parsed?.updatedAt) || null,
        operations: Array.isArray(parsed?.operations) ? parsed.operations.filter(Boolean).map(immutable) : [],
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.state = emptyState();
    }
    this.#assertState();
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

  getByOperationId(operationId) {
    const record = this.state.operations.find((item) => item.operationId === text(operationId));
    return record ? immutable(record) : null;
  }

  beginRequest({ operationId, request } = {}) {
    const id = text(operationId);
    if (!id || !request || typeof request !== "object") throw opError("operationId and ARM request are required", "INVALID_ARM_OPERATION_REQUEST");
    const requestHash = digest(request);
    const existing = this.state.operations.find((item) => item.operationId === id);
    if (existing) {
      if (existing.requestHash !== requestHash) throw opError("operationId is bound to different ARM request", "ARM_OPERATION_ID_CONFLICT");
      return immutable(existing);
    }
    const requestedAt = this.#now();
    const record = immutable({
      schemaVersion: PRETRADE_ARM_OPERATION_SCHEMA_VERSION,
      authority: PRETRADE_ARM_OPERATION_AUTHORITY,
      operationId: id,
      requestHash,
      request: immutable(request),
      status: "REQUESTED",
      requestedAt,
      terminalAt: null,
      reasonCode: null,
      details: null,
      authorization: null,
      completedAt: null,
    });
    this.#append(record);
    return immutable(record);
  }

  markReviewRequired(operationId, { reasonCode = "REVIEW_PACKAGE_CHANGED", details = null } = {}) {
    return this.#transition(operationId, new Set(["REQUESTED"]), "REVIEW_REQUIRED", {
      reasonCode: text(reasonCode) || "REVIEW_PACKAGE_CHANGED",
      details: details ? immutable(details) : null,
      terminalAt: this.#now(),
    });
  }

  reject(operationId, { reasonCode, details = null } = {}) {
    const reason = text(reasonCode);
    if (!reason) throw opError("ARM rejection requires reasonCode", "ARM_REJECTION_REASON_REQUIRED");
    return this.#transition(operationId, new Set(["REQUESTED"]), "REJECTED", {
      reasonCode: reason,
      details: details ? immutable(details) : null,
      terminalAt: this.#now(),
    });
  }

  authorize(operationId, authorization = {}) {
    const normalized = immutable({
      candidateId: text(authorization.candidateId),
      contractVersion: Number(authorization.contractVersion),
      candidateContentHash: text(authorization.candidateContentHash),
      symbol: upper(authorization.symbol),
      direction: upper(authorization.direction),
      reviewPackageId: text(authorization.reviewPackageId),
      permissionAttemptId: text(authorization.permissionAttemptId),
      permissionState: upper(authorization.permissionState),
      permissionStateRevision: Number(authorization.permissionStateRevision),
      dssEvaluationId: text(authorization.dssEvaluationId),
      riskEvaluationId: text(authorization.riskEvaluationId),
      accountId: text(authorization.accountId),
      selectedQuantity: Number(authorization.selectedQuantity),
      authorizedAt: validIso(authorization.authorizedAt),
      handoffId: text(authorization.handoffId),
      handoffCreatedAt: validIso(authorization.handoffCreatedAt || authorization.authorizedAt),
      ocoGroupId: text(authorization.ocoGroupId) || null,
      ocoSiblings: Array.isArray(authorization.ocoSiblings)
        ? authorization.ocoSiblings.map((item) => ({ candidateId: text(item.candidateId), contractVersion: Number(item.contractVersion) }))
        : [],
      executionOwnershipProof: authorization.executionOwnershipProof ? immutable(authorization.executionOwnershipProof) : null,
    });
    if (!validAuthorization(normalized)) {
      throw opError("ARM authorization proof is incomplete or invalid", "INVALID_ARM_AUTHORIZATION_PROOF");
    }
    return this.#transition(operationId, new Set(["REQUESTED"]), "AUTHORIZED", {
      authorization: normalized,
      reasonCode: null,
      details: null,
      terminalAt: null,
    });
  }

  markCompleted(operationId) {
    const current = this.#require(operationId);
    if (current.status === "COMPLETED") return immutable(current);
    if (current.status !== "AUTHORIZED") throw opError("only AUTHORIZED ARM operation may complete", "ARM_OPERATION_NOT_AUTHORIZED");
    return this.#transition(operationId, new Set(["AUTHORIZED"]), "COMPLETED", { completedAt: this.#now() });
  }

  #transition(operationId, allowed, status, patch) {
    const id = text(operationId);
    const index = this.state.operations.findIndex((item) => item.operationId === id);
    if (index < 0) throw opError("ARM operation was not found", "ARM_OPERATION_NOT_FOUND");
    const current = this.state.operations[index];
    if (current.status === status) return immutable(current);
    if (!allowed.has(current.status)) throw opError(`ARM operation cannot transition ${current.status} → ${status}`, "ARM_OPERATION_STATE_CONFLICT");
    const next = immutable({ ...current, ...patch, status });
    const previous = structuredClone(this.state);
    try {
      this.state.operations[index] = next;
      this.state.updatedAt = this.#now();
      this.save();
      return immutable(next);
    } catch (error) {
      this.state = previous;
      throw error;
    }
  }

  #append(record) {
    const previous = structuredClone(this.state);
    try {
      this.state.operations.push(record);
      this.state.updatedAt = this.#now();
      this.save();
    } catch (error) {
      this.state = previous;
      throw error;
    }
  }

  #require(operationId) {
    const record = this.state.operations.find((item) => item.operationId === text(operationId));
    if (!record) throw opError("ARM operation was not found", "ARM_OPERATION_NOT_FOUND");
    return record;
  }

  #now() {
    const parsed = Date.parse(String(this.clock() ?? ""));
    if (!Number.isFinite(parsed)) throw opError("ARM operation repository clock returned invalid timestamp", "ARM_OPERATION_CLOCK_INVALID");
    return new Date(parsed).toISOString();
  }

  #assertState() {
    const ids = new Set();
    for (const record of this.state.operations) {
      if (Number(record.schemaVersion) !== PRETRADE_ARM_OPERATION_SCHEMA_VERSION || record.authority !== PRETRADE_ARM_OPERATION_AUTHORITY || !text(record.operationId) || !text(record.requestHash) || !STATUSES.has(record.status)) {
        throw opError("persisted ARM operation is invalid", "CORRUPT_ARM_OPERATION_REPOSITORY");
      }
      if (ids.has(record.operationId)) throw opError("persisted ARM operationId is duplicated", "CORRUPT_ARM_OPERATION_REPOSITORY");
      ids.add(record.operationId);
      if (["AUTHORIZED", "COMPLETED"].includes(record.status) && !armAuthorizationProof(record)) throw opError("persisted authorized ARM operation lacks valid proof", "CORRUPT_ARM_OPERATION_REPOSITORY");
      if (["REVIEW_REQUIRED", "REJECTED"].includes(record.status) && !text(record.reasonCode)) throw opError("persisted terminal ARM operation lacks reason", "CORRUPT_ARM_OPERATION_REPOSITORY");
    }
  }
}
