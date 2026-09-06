import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  EXECUTION_BOARD_STORE_KEY,
  EXECUTION_BOARD_STORE_SCHEMA_VERSION,
  normalizeExecutionBoardStore,
} from "../src/execution/execution-board-store-repository.js";
import { executionOwnedSymbolsForHandoffAdmission } from "../src/execution/execution-v24-active-ownership.js";

export const EXECUTION_OWNERSHIP_AUTHORITY_SCHEMA_VERSION = 1;
export const EXECUTION_OWNERSHIP_PROJECTION_AUTHORITY = "EXECUTION_BOARD_STORE";
export const EXECUTION_OWNERSHIP_PROJECTION_SOURCE = "EXECUTION_CANONICAL_STORE";
export const DEFAULT_EXECUTION_OWNERSHIP_FILE = ".executionos-v24-execution-ownership.json";
export const DEFAULT_EXECUTION_OWNERSHIP_MAX_AGE_MS = 3000;

const ABSOLUTE_TIMESTAMP_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i;
const OWNERSHIP_ARRAY_FIELDS = [
  "candidates",
  "liveTrades",
  "history",
  "v24Installations",
  "v24Retirements",
  "v24Lifecycles",
];

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function authorityError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
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

function absoluteTimestamp(value) {
  const raw = text(value);
  if (!raw || !ABSOLUTE_TIMESTAMP_PATTERN.test(raw)) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizedOwnedSymbols(value) {
  if (!Array.isArray(value)) return null;
  const symbols = value.map(upper);
  if (symbols.some((symbol) => !symbol)) return null;
  return [...new Set(symbols)].sort();
}

function projectionIntegrityContent(value) {
  return {
    source: value.source,
    authority: value.authority,
    storeKey: value.storeKey,
    storeSchemaVersion: value.storeSchemaVersion,
    storeRevision: value.storeRevision,
    storeHash: value.storeHash,
    ownedSymbols: value.ownedSymbols,
  };
}

function emptyState() {
  return {
    schemaVersion: EXECUTION_OWNERSHIP_AUTHORITY_SCHEMA_VERSION,
    updatedAt: null,
    projection: null,
  };
}

function normalizePersistedProjection(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw authorityError("persisted Execution ownership projection must be an object", "CORRUPT_EXECUTION_OWNERSHIP_AUTHORITY");
  }
  const ownedSymbols = normalizedOwnedSymbols(raw.ownedSymbols);
  const storeRevision = Number(raw.storeRevision);
  const storeSchemaVersion = Number(raw.storeSchemaVersion);
  const receivedAt = absoluteTimestamp(raw.receivedAt);
  const publishedAt = absoluteTimestamp(raw.publishedAt);
  const storeHash = text(raw.storeHash).toLowerCase();
  const projectionHash = text(raw.projectionHash).toLowerCase();

  if (upper(raw.source) !== EXECUTION_OWNERSHIP_PROJECTION_SOURCE
    || upper(raw.authority) !== EXECUTION_OWNERSHIP_PROJECTION_AUTHORITY
    || text(raw.storeKey) !== EXECUTION_BOARD_STORE_KEY
    || storeSchemaVersion !== EXECUTION_BOARD_STORE_SCHEMA_VERSION
    || !Number.isInteger(storeRevision) || storeRevision < 0
    || !/^[a-f0-9]{64}$/.test(storeHash)
    || !/^[a-f0-9]{64}$/.test(projectionHash)
    || !ownedSymbols
    || !receivedAt
    || !publishedAt
    || !text(raw.publisherId)) {
    throw authorityError("persisted Execution ownership projection is invalid", "CORRUPT_EXECUTION_OWNERSHIP_AUTHORITY");
  }

  const normalized = {
    source: EXECUTION_OWNERSHIP_PROJECTION_SOURCE,
    authority: EXECUTION_OWNERSHIP_PROJECTION_AUTHORITY,
    storeKey: EXECUTION_BOARD_STORE_KEY,
    storeSchemaVersion,
    storeRevision,
    storeHash,
    ownedSymbols,
  };
  const expectedProjectionHash = digest(projectionIntegrityContent(normalized));
  if (projectionHash !== expectedProjectionHash) {
    throw authorityError("persisted Execution ownership projection integrity hash does not match", "CORRUPT_EXECUTION_OWNERSHIP_AUTHORITY");
  }

  return Object.freeze({
    ...normalized,
    ownedSymbols: Object.freeze(ownedSymbols),
    projectionHash,
    publisherId: text(raw.publisherId),
    publishedAt,
    receivedAt,
  });
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw authorityError("Execution ownership authority state must be an object", "CORRUPT_EXECUTION_OWNERSHIP_AUTHORITY");
  }
  if (Number(raw.schemaVersion) !== EXECUTION_OWNERSHIP_AUTHORITY_SCHEMA_VERSION) {
    throw authorityError("Execution ownership authority schemaVersion is unsupported", "CORRUPT_EXECUTION_OWNERSHIP_AUTHORITY");
  }
  const updatedAt = raw.updatedAt === null || raw.updatedAt === undefined
    ? null
    : absoluteTimestamp(raw.updatedAt);
  if (raw.updatedAt && !updatedAt) {
    throw authorityError("Execution ownership authority updatedAt is invalid", "CORRUPT_EXECUTION_OWNERSHIP_AUTHORITY");
  }
  return {
    schemaVersion: EXECUTION_OWNERSHIP_AUTHORITY_SCHEMA_VERSION,
    updatedAt,
    projection: raw.projection ? normalizePersistedProjection(raw.projection) : null,
  };
}

function validateEnvelope(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw authorityError("Execution ownership publication must be an object", "EXECUTION_OWNERSHIP_PUBLICATION_INVALID");
  }
  if (upper(payload.source) !== EXECUTION_OWNERSHIP_PROJECTION_SOURCE) {
    throw authorityError(`Execution ownership source must be ${EXECUTION_OWNERSHIP_PROJECTION_SOURCE}`, "EXECUTION_OWNERSHIP_SOURCE_INVALID");
  }
  if (upper(payload.authority) !== EXECUTION_OWNERSHIP_PROJECTION_AUTHORITY) {
    throw authorityError(`Execution ownership authority must be ${EXECUTION_OWNERSHIP_PROJECTION_AUTHORITY}`, "EXECUTION_OWNERSHIP_AUTHORITY_INVALID");
  }
  if (text(payload.storeKey) !== EXECUTION_BOARD_STORE_KEY) {
    throw authorityError(`Execution ownership storeKey must be ${EXECUTION_BOARD_STORE_KEY}`, "EXECUTION_OWNERSHIP_STORE_KEY_INVALID");
  }
  if (!text(payload.publisherId)) {
    throw authorityError("Execution ownership publisherId is required", "EXECUTION_OWNERSHIP_PUBLISHER_REQUIRED");
  }
  if (!absoluteTimestamp(payload.publishedAt)) {
    throw authorityError("Execution ownership publishedAt must be an absolute timestamp", "EXECUTION_OWNERSHIP_PUBLISHED_AT_INVALID");
  }
  for (const forbidden of ["status", "owned", "free", "ownedSymbols"]) {
    if (Object.prototype.hasOwnProperty.call(payload, forbidden)) {
      throw authorityError(
        `${forbidden} is derived by PRETRADE from the canonical Execution store snapshot and may not be supplied by the browser`,
        "EXECUTION_OWNERSHIP_DERIVED_FIELD_FORBIDDEN",
      );
    }
  }
}

function normalizeCanonicalStoreSnapshot(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw authorityError("canonical Execution store snapshot must be an object", "EXECUTION_OWNERSHIP_STORE_INVALID");
  }
  if (Number(raw.storeSchemaVersion) !== EXECUTION_BOARD_STORE_SCHEMA_VERSION) {
    throw authorityError("canonical Execution store schemaVersion is invalid", "EXECUTION_OWNERSHIP_STORE_INVALID");
  }
  const storeRevision = Number(raw.storeRevision);
  if (!Number.isInteger(storeRevision) || storeRevision < 0) {
    throw authorityError("canonical Execution storeRevision must be an integer >= 0", "EXECUTION_OWNERSHIP_STORE_INVALID");
  }
  for (const field of OWNERSHIP_ARRAY_FIELDS) {
    if (!Array.isArray(raw[field])) {
      throw authorityError(`canonical Execution store ${field} must be an array`, "EXECUTION_OWNERSHIP_STORE_INVALID");
    }
  }
  if (raw.draft !== null && raw.draft !== undefined && (typeof raw.draft !== "object" || Array.isArray(raw.draft))) {
    throw authorityError("canonical Execution store draft must be an object or null", "EXECUTION_OWNERSHIP_STORE_INVALID");
  }

  try {
    const normalized = normalizeExecutionBoardStore(raw);
    if (normalized.storeRevision !== storeRevision) {
      throw authorityError("canonical Execution storeRevision normalization changed the supplied revision", "EXECUTION_OWNERSHIP_STORE_INVALID");
    }
    return normalized;
  } catch (error) {
    if (error?.code === "EXECUTION_OWNERSHIP_STORE_INVALID") throw error;
    throw authorityError(
      `canonical Execution store snapshot is invalid: ${error.message}`,
      "EXECUTION_OWNERSHIP_STORE_INVALID",
      { causeCode: error.code || null },
    );
  }
}

export class PreTradeExecutionOwnershipAuthority {
  constructor({
    filePath = DEFAULT_EXECUTION_OWNERSHIP_FILE,
    clock = () => new Date().toISOString(),
    maxAgeMs = DEFAULT_EXECUTION_OWNERSHIP_MAX_AGE_MS,
  } = {}) {
    if (typeof clock !== "function") throw new Error("clock must be a function");
    if (!Number.isFinite(Number(maxAgeMs)) || Number(maxAgeMs) <= 0) throw new Error("maxAgeMs must be a positive finite number");
    this.filePath = path.resolve(filePath);
    this.clock = clock;
    this.maxAgeMs = Number(maxAgeMs);
    this.state = emptyState();
  }

  load() {
    try {
      this.state = normalizeState(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") this.state = emptyState();
      else if (error?.code === "CORRUPT_EXECUTION_OWNERSHIP_AUTHORITY") throw error;
      else throw authorityError(
        `Execution ownership authority could not be loaded: ${error.message}`,
        "CORRUPT_EXECUTION_OWNERSHIP_AUTHORITY",
      );
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

  publish(payload) {
    validateEnvelope(payload);
    if (upper(payload.kind || "SNAPSHOT") === "HEARTBEAT") return this.#heartbeat(payload);
    if (upper(payload.kind || "SNAPSHOT") !== "SNAPSHOT") {
      throw authorityError("Execution ownership publication kind must be SNAPSHOT or HEARTBEAT", "EXECUTION_OWNERSHIP_KIND_INVALID");
    }

    const canonicalStore = normalizeCanonicalStoreSnapshot(payload.store);
    const storeRevision = Number(canonicalStore.storeRevision);
    const storeHash = digest(canonicalStore);
    const ownedSymbols = executionOwnedSymbolsForHandoffAdmission(canonicalStore);
    const receivedAt = this.#now();
    const publishedAt = absoluteTimestamp(payload.publishedAt);
    const current = this.state.projection;

    if (current && storeRevision < current.storeRevision) {
      throw authorityError(
        `Execution ownership snapshot revision ${storeRevision} is older than authoritative revision ${current.storeRevision}`,
        "EXECUTION_OWNERSHIP_STALE_REVISION",
        { receivedRevision: storeRevision, authoritativeRevision: current.storeRevision },
      );
    }
    if (current && storeRevision === current.storeRevision && storeHash !== current.storeHash) {
      throw authorityError(
        "same Execution storeRevision arrived with different canonical content",
        "EXECUTION_OWNERSHIP_REVISION_CONFLICT",
        { storeRevision, authoritativeStoreHash: current.storeHash, receivedStoreHash: storeHash },
      );
    }

    const integrityContent = {
      source: EXECUTION_OWNERSHIP_PROJECTION_SOURCE,
      authority: EXECUTION_OWNERSHIP_PROJECTION_AUTHORITY,
      storeKey: EXECUTION_BOARD_STORE_KEY,
      storeSchemaVersion: EXECUTION_BOARD_STORE_SCHEMA_VERSION,
      storeRevision,
      storeHash,
      ownedSymbols: [...ownedSymbols],
    };
    const projection = Object.freeze({
      ...integrityContent,
      ownedSymbols: Object.freeze([...ownedSymbols]),
      projectionHash: digest(projectionIntegrityContent(integrityContent)),
      publisherId: text(payload.publisherId),
      publishedAt,
      receivedAt,
    });
    this.state.projection = projection;
    this.state.updatedAt = receivedAt;
    this.save();
    return structuredClone(projection);
  }

  health() {
    const projection = this.state.projection;
    if (!projection) {
      return Object.freeze({
        connected: false,
        reasonCode: "EXECUTION_OWNERSHIP_AUTHORITY_UNAVAILABLE",
        ageMs: null,
        storeRevision: null,
        receivedAt: null,
      });
    }

    const nowMs = Date.parse(this.#now());
    const receivedMs = Date.parse(projection.receivedAt);
    const ageMs = nowMs - receivedMs;
    if (!Number.isFinite(ageMs) || ageMs < 0) {
      return Object.freeze({
        connected: false,
        reasonCode: "EXECUTION_OWNERSHIP_AUTHORITY_CLOCK_INVALID",
        ageMs: Number.isFinite(ageMs) ? ageMs : null,
        storeRevision: projection.storeRevision,
        receivedAt: projection.receivedAt,
      });
    }
    if (ageMs > this.maxAgeMs) {
      return Object.freeze({
        connected: false,
        reasonCode: "EXECUTION_OWNERSHIP_AUTHORITY_STALE",
        ageMs,
        storeRevision: projection.storeRevision,
        receivedAt: projection.receivedAt,
      });
    }
    return Object.freeze({
      connected: true,
      reasonCode: null,
      ageMs,
      storeRevision: projection.storeRevision,
      receivedAt: projection.receivedAt,
    });
  }

  async resolveSymbol(symbol) {
    const normalizedSymbol = upper(symbol);
    if (!normalizedSymbol) {
      throw authorityError("symbol is required", "EXECUTION_OWNERSHIP_SYMBOL_REQUIRED");
    }
    const health = this.health();
    if (!health.connected) {
      return Object.freeze({
        status: "UNKNOWN",
        reasonCode: health.reasonCode,
        symbol: normalizedSymbol,
        source: EXECUTION_OWNERSHIP_PROJECTION_SOURCE,
        authoritative: false,
        storeRevision: health.storeRevision,
        receivedAt: health.receivedAt,
        ageMs: health.ageMs,
      });
    }
    const projection = this.state.projection;
    const owned = projection.ownedSymbols.includes(normalizedSymbol);
    return Object.freeze({
      status: owned ? "OWNED" : "FREE",
      reasonCode: owned ? "EXECUTION_SYMBOL_OWNED" : null,
      symbol: normalizedSymbol,
      source: EXECUTION_OWNERSHIP_PROJECTION_SOURCE,
      authority: EXECUTION_OWNERSHIP_PROJECTION_AUTHORITY,
      authoritative: true,
      storeRevision: projection.storeRevision,
      storeHash: projection.storeHash,
      projectionHash: projection.projectionHash,
      receivedAt: projection.receivedAt,
      ageMs: health.ageMs,
    });
  }

  #heartbeat(payload) {
    const current = this.state.projection;
    if (!current) {
      throw authorityError("Execution ownership heartbeat requires an accepted canonical store snapshot", "EXECUTION_OWNERSHIP_SNAPSHOT_REQUIRED");
    }
    const storeRevision = Number(payload.storeRevision);
    const storeHash = text(payload.storeHash).toLowerCase();
    if (!Number.isInteger(storeRevision) || storeRevision < 0 || !/^[a-f0-9]{64}$/.test(storeHash)) {
      throw authorityError("Execution ownership heartbeat requires exact storeRevision and storeHash", "EXECUTION_OWNERSHIP_HEARTBEAT_INVALID");
    }
    if (storeRevision !== current.storeRevision || storeHash !== current.storeHash) {
      throw authorityError(
        "Execution ownership heartbeat does not match the authoritative canonical store projection",
        "EXECUTION_OWNERSHIP_HEARTBEAT_MISMATCH",
        {
          receivedRevision: storeRevision,
          authoritativeRevision: current.storeRevision,
          receivedStoreHash: storeHash,
          authoritativeStoreHash: current.storeHash,
        },
      );
    }
    const receivedAt = this.#now();
    const projection = Object.freeze({
      ...current,
      publisherId: text(payload.publisherId),
      publishedAt: absoluteTimestamp(payload.publishedAt),
      receivedAt,
    });
    this.state.projection = projection;
    this.state.updatedAt = receivedAt;
    this.save();
    return structuredClone(projection);
  }

  #now() {
    const value = absoluteTimestamp(this.clock());
    if (!value) throw authorityError("Execution ownership authority clock returned an invalid timestamp", "EXECUTION_OWNERSHIP_AUTHORITY_CLOCK_INVALID");
    return value;
  }
}
