import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PRETRADE_SCHEMA_VERSION = 1;
export const DEFAULT_PRETRADE_STATE_FILE = ".executionos-v24-state.json";
export const PRETRADE_TRIGGER_EVALUATING = "PRETRADE_TRIGGER_EVALUATING";

const LEGACY_TRIGGER_EVALUATING = "TRIGGER_EVALUATING";

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
    importLog: [],
  };
}

function normalizeState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  const candidates = Array.isArray(state.candidates)
    ? state.candidates.map((candidate) => {
        if (!candidate || typeof candidate !== "object") return candidate;
        return {
          ...candidate,
          lifecycleState: canonicalLifecycleState(candidate.lifecycleState),
        };
      })
    : [];

  return {
    schemaVersion: PRETRADE_SCHEMA_VERSION,
    updatedAt: state.updatedAt || null,
    candidates,
    importLog: Array.isArray(state.importLog) ? state.importLog : [],
  };
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
      const error = new Error("Import bundle must be an object with a candidates array");
      error.code = "INVALID_BUNDLE";
      throw error;
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
