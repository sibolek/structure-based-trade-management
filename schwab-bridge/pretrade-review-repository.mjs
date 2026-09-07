import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { immutableReview, validatePreTradeReviewPackage } from "./pretrade-review.mjs";

export const PRETRADE_REVIEW_REPOSITORY_SCHEMA_VERSION = 1;
export const DEFAULT_PRETRADE_REVIEW_FILE = ".executionos-v24-reviews.json";

function text(value) {
  return String(value ?? "").trim();
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

function immutable(value) {
  return immutableReview(value);
}

function repositoryError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function emptyState() {
  return {
    schemaVersion: PRETRADE_REVIEW_REPOSITORY_SCHEMA_VERSION,
    updatedAt: null,
    reviews: [],
    operations: [],
  };
}

function normalizeState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    schemaVersion: PRETRADE_REVIEW_REPOSITORY_SCHEMA_VERSION,
    updatedAt: text(source.updatedAt) || null,
    reviews: Array.isArray(source.reviews) ? source.reviews.filter(Boolean).map((item) => structuredClone(item)) : [],
    operations: Array.isArray(source.operations) ? source.operations.filter(Boolean).map((item) => structuredClone(item)) : [],
  };
}

function gcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x || 1n;
}

function rat(value) {
  if (value === null || value === undefined || typeof value === "boolean") throw new Error("invalid decimal");
  const source = String(value).trim();
  const match = source.toLowerCase().match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/);
  if (!match) throw new Error("invalid decimal");
  const sign = match[1] === "-" ? -1n : 1n;
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 30) throw new Error("invalid decimal");
  let n = BigInt(`${match[2]}${fraction}`) * sign;
  let scale = fraction.length - exponent;
  if (scale < 0) {
    n *= 10n ** BigInt(-scale);
    scale = 0;
  }
  let d = 10n ** BigInt(scale);
  const divisor = gcd(n, d);
  n /= divisor;
  d /= divisor;
  return { n, d };
}

function compare(a, b) {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactIncrement(value, increment) {
  const numerator = value.n * increment.d;
  const denominator = value.d * increment.n;
  return denominator !== 0n && numerator % denominator === 0n;
}

function validateQuantity(reviewPackage, selectedQuantity) {
  let selected;
  let minimum;
  let increment;
  let maximum;
  try {
    selected = rat(selectedQuantity);
    minimum = rat(reviewPackage.material.instrument.minimumQuantity);
    increment = rat(reviewPackage.material.instrument.quantityIncrement);
    maximum = rat(reviewPackage.material.maxAffordableQuantity);
  } catch {
    throw repositoryError("selected quantity is invalid", "INVALID_SELECTED_QUANTITY");
  }
  const zero = { n: 0n, d: 1n };
  if (
    compare(selected, zero) <= 0
    || compare(minimum, zero) <= 0
    || compare(increment, zero) <= 0
    || compare(selected, minimum) < 0
    || compare(selected, maximum) > 0
    || !exactIncrement(selected, increment)
  ) {
    throw repositoryError("selected quantity is outside the current review package ceiling or increment", "INVALID_SELECTED_QUANTITY");
  }
  const number = Number(selected.n) / Number(selected.d);
  if (!Number.isFinite(number)) throw repositoryError("selected quantity is outside supported range", "INVALID_SELECTED_QUANTITY");
  return number;
}

export class PreTradeReviewRepository {
  constructor({ filePath = DEFAULT_PRETRADE_REVIEW_FILE, clock = () => new Date().toISOString() } = {}) {
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

  get(candidateId, contractVersion) {
    const record = this.#find(candidateId, contractVersion);
    return record ? immutable(record) : null;
  }

  syncPackage({ operationId, reviewPackage } = {}) {
    const validation = validatePreTradeReviewPackage(reviewPackage);
    if (!validation.valid) throw repositoryError(`review package is invalid: ${validation.errors.join("; ")}`, "INVALID_REVIEW_PACKAGE");
    return this.#run(operationId, "SYNC_REVIEW_PACKAGE", {
      reviewPackage,
    }, () => {
      let record = this.#find(reviewPackage.candidateId, reviewPackage.contractVersion);
      const at = this.#now();
      if (!record) {
        record = {
          candidateId: reviewPackage.candidateId,
          contractVersion: reviewPackage.contractVersion,
          reviewRevision: 0,
          currentPackage: null,
          selectedQuantity: null,
          cautionAcknowledgment: null,
          events: [],
        };
        this.state.reviews.push(record);
      }
      const previousPackageId = text(record.currentPackage?.reviewPackageId);
      const changed = previousPackageId && previousPackageId !== reviewPackage.reviewPackageId;
      record.currentPackage = immutable(reviewPackage);
      if (changed) {
        record.selectedQuantity = null;
        record.cautionAcknowledgment = null;
      }
      record.reviewRevision = Number(record.reviewRevision || 0) + 1;
      record.events.push(immutable({
        type: changed ? "REVIEW_PACKAGE_CHANGED" : previousPackageId ? "REVIEW_PACKAGE_REFRESHED" : "REVIEW_PACKAGE_ESTABLISHED",
        at,
        reviewPackageId: reviewPackage.reviewPackageId,
        previousReviewPackageId: previousPackageId || null,
        reviewStateCleared: Boolean(changed),
      }));
      return immutable(record);
    });
  }

  selectQuantity({ operationId, candidateId, contractVersion, reviewPackageId, selectedQuantity } = {}) {
    return this.#run(operationId, "SELECT_QUANTITY", { candidateId, contractVersion, reviewPackageId, selectedQuantity }, () => {
      const record = this.#requireCurrent(candidateId, contractVersion, reviewPackageId);
      const quantity = validateQuantity(record.currentPackage, selectedQuantity);
      const at = this.#now();
      record.selectedQuantity = immutable({
        reviewPackageId: record.currentPackage.reviewPackageId,
        value: quantity,
        selectedAt: at,
      });
      record.reviewRevision += 1;
      record.events.push(immutable({ type: "QUANTITY_SELECTED", at, reviewPackageId, selectedQuantity: quantity }));
      return immutable(record);
    });
  }

  acknowledgeCaution({ operationId, candidateId, contractVersion, reviewPackageId, acknowledged = true } = {}) {
    return this.#run(operationId, "ACKNOWLEDGE_CAUTION", { candidateId, contractVersion, reviewPackageId, acknowledged }, () => {
      const record = this.#requireCurrent(candidateId, contractVersion, reviewPackageId);
      if (record.currentPackage.permissionOutcome !== "CAUTION") {
        throw repositoryError("READY review does not require a CAUTION acknowledgment", "CAUTION_ACK_NOT_REQUIRED");
      }
      if (acknowledged !== true) throw repositoryError("CAUTION acknowledgment must be explicit", "CAUTION_ACK_REQUIRED");
      const at = this.#now();
      record.cautionAcknowledgment = immutable({
        reviewPackageId,
        acknowledgedAt: at,
        reasonCodes: [...record.currentPackage.material.cautionReasonCodes],
      });
      record.reviewRevision += 1;
      record.events.push(immutable({ type: "CAUTION_ACKNOWLEDGED", at, reviewPackageId, reasonCodes: [...record.currentPackage.material.cautionReasonCodes] }));
      return immutable(record);
    });
  }

  #run(operationId, action, payload, mutation) {
    const id = text(operationId);
    if (!id) throw repositoryError("operationId is required", "REVIEW_OPERATION_ID_REQUIRED");
    const operationHash = digest({ action, payload });
    const prior = this.state.operations.find((item) => item.operationId === id);
    if (prior) {
      if (prior.operationHash !== operationHash) throw repositoryError(`operationId ${id} conflicts with prior review mutation`, "REVIEW_OPERATION_ID_CONFLICT");
      return immutable(prior.result);
    }
    const previous = structuredClone(this.state);
    try {
      const result = mutation();
      this.state.operations.push(immutable({ operationId: id, operationHash, action, result: immutable(result) }));
      this.state.updatedAt = this.#now();
      this.save();
      return immutable(result);
    } catch (error) {
      this.state = previous;
      throw error;
    }
  }

  #find(candidateId, contractVersion) {
    const id = text(candidateId);
    const version = Number(contractVersion);
    return this.state.reviews.find((item) => item.candidateId === id && Number(item.contractVersion) === version) || null;
  }

  #requireCurrent(candidateId, contractVersion, reviewPackageId) {
    const record = this.#find(candidateId, contractVersion);
    if (!record) throw repositoryError("candidate has no review package", "REVIEW_NOT_FOUND");
    if (text(record.currentPackage?.reviewPackageId) !== text(reviewPackageId)) {
      throw repositoryError("reviewPackageId is stale", "STALE_REVIEW_PACKAGE");
    }
    return record;
  }

  #now() {
    const parsed = Date.parse(String(this.clock() ?? ""));
    if (!Number.isFinite(parsed)) throw repositoryError("review repository clock returned an invalid timestamp", "REVIEW_CLOCK_INVALID");
    return new Date(parsed).toISOString();
  }

  #assertState() {
    const keys = new Set();
    const operationIds = new Set();
    for (const record of this.state.reviews) {
      const key = `${record.candidateId}:v${record.contractVersion}`;
      if (keys.has(key)) throw repositoryError("review repository contains duplicate candidate identity", "CORRUPT_REVIEW_REPOSITORY");
      keys.add(key);
      if (!record.currentPackage) throw repositoryError("review record is missing currentPackage", "CORRUPT_REVIEW_REPOSITORY");
      const validation = validatePreTradeReviewPackage(record.currentPackage);
      if (!validation.valid) throw repositoryError(`persisted review package is invalid: ${validation.errors.join("; ")}`, "CORRUPT_REVIEW_REPOSITORY");
      if (record.selectedQuantity && record.selectedQuantity.reviewPackageId !== record.currentPackage.reviewPackageId) {
        throw repositoryError("selected quantity is bound to a stale review package", "CORRUPT_REVIEW_REPOSITORY");
      }
      if (record.cautionAcknowledgment && record.cautionAcknowledgment.reviewPackageId !== record.currentPackage.reviewPackageId) {
        throw repositoryError("CAUTION acknowledgment is bound to a stale review package", "CORRUPT_REVIEW_REPOSITORY");
      }
    }
    for (const operation of this.state.operations) {
      if (!text(operation.operationId) || !text(operation.operationHash) || operationIds.has(operation.operationId)) {
        throw repositoryError("review repository contains invalid operation journal", "CORRUPT_REVIEW_REPOSITORY");
      }
      operationIds.add(operation.operationId);
    }
  }
}
