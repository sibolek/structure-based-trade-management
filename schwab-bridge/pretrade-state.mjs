import {
  assertCanonicalCandidateIntegrity,
  candidateContractHash,
  normalizeCanonicalCandidateProposal,
} from "./pretrade-candidate-contract.mjs";
import { canonicalJson as canonicalize } from "./canonical-json.mjs";
import crypto from "node:crypto";
import { isOperatorReviewedImportPolicy, OPERATOR_REVIEWED_IMPORT_SCOPE } from "./pretrade-preview-policy.mjs";
import fs from "node:fs";
import path from "node:path";

export const PRETRADE_SCHEMA_VERSION = 1;
export const PRETRADE_STORE_SCHEMA_VERSION = 3;
export const DEFAULT_PRETRADE_STATE_FILE = ".executionos-v24-state.json";
export const PRETRADE_TRIGGER_EVALUATING = "PRETRADE_TRIGGER_EVALUATING";
export const MANUAL_SUPERSESSION_REVIEW_SCHEMA_VERSION = 1;
export const MANUAL_SUPERSESSION_REVIEW_AUTHORITY = "PRETRADE_MANUAL_SUPERSESSION_REVIEW";
export const MANUAL_SUPERSESSION_AUTHORIZATION_SCHEMA_VERSION = 1;
export const MANUAL_SUPERSESSION_AUTHORIZATION_AUTHORITY = "PRETRADE_MANUAL_SUPERSESSION_AUTHORIZATION";
export const MANUAL_SUPERSESSION_DECLINE_SCHEMA_VERSION = 1;
export const MANUAL_SUPERSESSION_DECLINE_AUTHORITY = "PRETRADE_MANUAL_SUPERSESSION_DECLINE";

const LEGACY_TRIGGER_EVALUATING = "TRIGGER_EVALUATING";
const ABSOLUTE_TIMESTAMP_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PRETRADE_PROVIDER_RUN_KEYS = new Set([
  "schemaVersion", "storeEpoch", "challengeId", "challengeNonce", "issuedAt", "expiresAt",
  "bootGeneration", "draftId", "inputRevision", "runId", "inputManifestHash", "retirementRevision",
  "accountScopeId", "accountSelectionRevision", "policyHash", "status", "messageId", "envelopeHash",
  "providerResponseId", "previewId", "operationId", "finishedAt", "reasonCode", "integrityHash",
]);
const PRETRADE_PROVIDER_MESSAGE_KEYS = new Set([
  "schemaVersion", "messageId", "replayKey", "envelopeHash", "issuerId", "keyId",
  "providerResponseId", "challengeId", "draftId", "inputRevision", "runId", "status",
  "reservedAt", "finishedAt", "reasonCode", "previewId", "operationId", "integrityHash",
]);
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


export function contentHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function pretradeProviderRunIntegrityHash(record) {
  const material = structuredClone(record ?? {});
  delete material.integrityHash;
  return contentHash(material);
}

export function pretradeProviderMessageIntegrityHash(record) {
  const material = structuredClone(record ?? {});
  delete material.integrityHash;
  return contentHash(material);
}

export function pretradePreviewProposal(bundle) {
  const candidate = bundle?.candidates?.[0] || {};
  return {
    symbol: text(candidate.symbol).toUpperCase(),
    direction: text(candidate.direction).toUpperCase(),
    setup: text(candidate.setup),
    timeframe: text(candidate.timeframe) || null,
    trigger: structuredClone(candidate.trigger),
    structuralInvalidation: structuredClone(candidate.structuralInvalidation),
    targets: structuredClone(candidate.targets),
    validUntil: text(candidate.validity?.validUntil) || null,
  };
}

export function pretradePreviewProposalHash(bundle) {
  return contentHash(bundle);
}

export function pretradePreviewBindingHash(record) {
  return contentHash({
    storeEpoch: record?.storeEpoch,
    draftId: record?.draftId,
    inputRevision: record?.inputRevision,
    runId: record?.runId,
    revision: record?.revision,
    priorBindingHash: record?.priorBindingHash || null,
    proposalHash: record?.proposalHash,
    candidateIdentity: record?.candidateIdentity,
    proposal: record?.proposal,
    chartByteHashes: record?.chartByteHashes,
    provenance: record?.provenance,
    sourceTimes: record?.sourceTimes,
    evidenceIds: record?.evidenceIds,
    fixedProposalReferences: record?.fixedProposalReferences,
    policy: record?.policy,
    accountScope: record?.accountScope,
    ingressPolicy: record?.ingressPolicy,
    expiresAt: record?.expiresAt,
    stateFingerprint: record?.stateFingerprint,
    refreshedEvidence: record?.refreshedEvidence || null,
  });
}

export function pretradePreviewReceiptHash(record) {
  const material = structuredClone(record ?? {});
  delete material.receiptHash;
  return contentHash(material);
}

export function pretradePreviewOperationIntegrityHash(operation, preview) {
  const material = structuredClone(operation ?? {});
  delete material.integrityHash;
  return contentHash({
    operation: material,
    previewState: {
      previewId: preview?.previewId,
      revision: preview?.revision,
      operationId: preview?.operationId,
      bindingHash: preview?.bindingHash,
      state: preview?.state,
      createdAt: preview?.createdAt,
      expiresAt: preview?.expiresAt ?? null,
      revalidationRequired: preview?.revalidationRequired === true,
      processGeneration: preview?.processGeneration,
      discardedAt: preview?.discardedAt ?? null,
      retiredAt: preview?.retiredAt ?? null,
      finishedAt: preview?.finishedAt ?? null,
    },
  });
}

const MANUAL_SUPERSESSION_REVIEW_KEYS = new Set([
  "schemaVersion",
  "authority",
  "reviewId",
  "candidateId",
  "priorContractVersion",
  "priorLifecycleState",
  "priorStateRevision",
  "priorContentHash",
  "proposedContractVersion",
  "proposedContentHash",
  "proposedCandidate",
  "substantiveDiff",
  "createdAt",
  "disclosure",
  "reviewIntegrityHash",
]);

const MANUAL_SUPERSESSION_AUTHORIZATION_KEYS = new Set([
  "schemaVersion",
  "authority",
  "authorizationId",
  "reviewId",
  "candidateId",
  "priorContractVersion",
  "priorLifecycleState",
  "priorStateRevision",
  "priorContentHash",
  "proposedContractVersion",
  "proposedContentHash",
  "decision",
  "authorizedAt",
  "consumedAt",
  "consumedByOperationId",
  "authorizationIntegrityHash",
]);

const MANUAL_SUPERSESSION_DECLINE_KEYS = new Set([
  "schemaVersion",
  "authority",
  "declineId",
  "reviewId",
  "candidateId",
  "priorContractVersion",
  "priorLifecycleState",
  "priorStateRevision",
  "priorContentHash",
  "proposedContractVersion",
  "proposedContentHash",
  "decision",
  "declinedAt",
  "declineIntegrityHash",
]);
const MANUAL_SUPERSESSION_AUTHORITY_LIMITS = Object.freeze({
  maxSerializedBytes: 8 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 250000,
  maxObjectKeys: 1000,
  maxArrayLength: 50000,
  maxStringBytes: 1024 * 1024,
});

function withoutField(record, field) {
  const material = structuredClone(record);
  delete material[field];
  return material;
}

function exactTimestamp(value) {
  const raw = text(value);
  return raw && ABSOLUTE_TIMESTAMP_PATTERN.test(raw) && Number.isFinite(Date.parse(raw)) ? raw : null;
}

function exactUtcTimestamp(value) {
  const raw = text(value);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === raw ? raw : null;
}

function assertClosedRecord(record, allowedKeys, code) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw storeError("PRETRADE manual supersession authority record must be an object", code);
  }
  const unexpected = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) {
    throw storeError(`PRETRADE manual supersession authority record has unexpected fields: ${unexpected.join(", ")}`, code);
  }
}

function assertHash(value, field, code) {
  if (!/^[0-9a-f]{64}$/.test(text(value))) {
    throw storeError(`${field} must be a SHA-256 hash`, code);
  }
}

function assertManualSupersessionAuthorityRecordSafety(record, code) {
  const limits = MANUAL_SUPERSESSION_AUTHORITY_LIMITS;
  const stack = [{ value: record, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > limits.maxNodes || current.depth > limits.maxDepth) {
      throw storeError("PRETRADE manual supersession authority record exceeds structural limits", code);
    }
    const value = current.value;
    if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
      throw storeError("PRETRADE manual supersession authority record contains non-JSON data", code);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw storeError("PRETRADE manual supersession authority record contains a non-finite number", code);
    }
    if (typeof value === "string" && Buffer.byteLength(value, "utf8") > limits.maxStringBytes) {
      throw storeError("PRETRADE manual supersession authority record contains an oversized string", code);
    }
    if (!value || typeof value !== "object") continue;
    if (seen.has(value)) throw storeError("PRETRADE manual supersession authority record contains a cycle", code);
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > limits.maxArrayLength) {
        throw storeError("PRETRADE manual supersession authority record contains an oversized array", code);
      }
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], depth: current.depth + 1 });
      }
      continue;
    }
    const keys = Object.keys(value);
    if (keys.length > limits.maxObjectKeys) {
      throw storeError("PRETRADE manual supersession authority record contains an oversized object", code);
    }
    for (const key of keys) stack.push({ value: value[key], depth: current.depth + 1 });
  }
  let serializedBytes;
  try {
    serializedBytes = Buffer.byteLength(JSON.stringify(record), "utf8");
  } catch {
    throw storeError("PRETRADE manual supersession authority record is not deterministic JSON", code);
  }
  if (serializedBytes > limits.maxSerializedBytes) {
    throw storeError("PRETRADE manual supersession authority record exceeds its byte limit", code);
  }
}

export function manualSupersessionReviewId(record) {
  return `manual-supersession-review-${contentHash({
    schemaVersion: record?.schemaVersion,
    authority: record?.authority,
    candidateId: record?.candidateId,
    priorContractVersion: record?.priorContractVersion,
    priorLifecycleState: record?.priorLifecycleState,
    priorStateRevision: record?.priorStateRevision,
    priorContentHash: record?.priorContentHash,
    proposedContractVersion: record?.proposedContractVersion,
    proposedContentHash: record?.proposedContentHash,
    proposedCandidate: record?.proposedCandidate,
    substantiveDiff: record?.substantiveDiff,
    disclosure: record?.disclosure,
  })}`;
}

export function manualSupersessionReviewIntegrityHash(record) {
  return contentHash(withoutField(record, "reviewIntegrityHash"));
}

export function manualSupersessionAuthorizationId(record) {
  return `manual-supersession-authorization-${contentHash({
    schemaVersion: record?.schemaVersion,
    authority: record?.authority,
    reviewId: record?.reviewId,
  })}`;
}

export function manualSupersessionAuthorizationIntegrityHash(record) {
  return contentHash(withoutField(record, "authorizationIntegrityHash"));
}

export function manualSupersessionDeclineId(record) {
  return `manual-supersession-decline-${contentHash({
    schemaVersion: record?.schemaVersion,
    authority: record?.authority,
    reviewId: record?.reviewId,
  })}`;
}

export function manualSupersessionDeclineIntegrityHash(record) {
  return contentHash(withoutField(record, "declineIntegrityHash"));
}

export function assertManualSupersessionReviewRecordIntegrity(record) {
  const code = "CORRUPT_MANUAL_SUPERSESSION_REVIEW_STATE";
  assertManualSupersessionAuthorityRecordSafety(record, code);
  assertClosedRecord(record, MANUAL_SUPERSESSION_REVIEW_KEYS, code);
  if (Number(record.schemaVersion) !== MANUAL_SUPERSESSION_REVIEW_SCHEMA_VERSION) {
    throw storeError("Unsupported manual supersession review schemaVersion", code);
  }
  if (record.authority !== MANUAL_SUPERSESSION_REVIEW_AUTHORITY) {
    throw storeError("Invalid manual supersession review authority", code);
  }
  if (!text(record.candidateId) || !text(record.priorLifecycleState)) {
    throw storeError("Manual supersession review prior identity is incomplete", code);
  }
  if (
    !Number.isInteger(Number(record.priorContractVersion))
    || Number(record.priorContractVersion) < 1
    || !Number.isInteger(Number(record.priorStateRevision))
    || Number(record.priorStateRevision) < 0
    || !Number.isInteger(Number(record.proposedContractVersion))
    || Number(record.proposedContractVersion) !== Number(record.priorContractVersion) + 1
  ) {
    throw storeError("Manual supersession review version/state binding is invalid", code);
  }
  assertHash(record.priorContentHash, "priorContentHash", code);
  assertHash(record.proposedContentHash, "proposedContentHash", code);
  if (!record.proposedCandidate || typeof record.proposedCandidate !== "object" || Array.isArray(record.proposedCandidate)) {
    throw storeError("Manual supersession review proposedCandidate is invalid", code);
  }
  if (!Array.isArray(record.substantiveDiff) || !record.substantiveDiff.length) {
    throw storeError("Manual supersession review substantiveDiff is invalid", code);
  }
  if (!record.disclosure || typeof record.disclosure !== "object" || Array.isArray(record.disclosure)) {
    throw storeError("Manual supersession review disclosure is invalid", code);
  }
  if (!exactTimestamp(record.createdAt)) {
    throw storeError("Manual supersession review createdAt is invalid", code);
  }
  if (text(record.reviewId) !== manualSupersessionReviewId(record)) {
    throw storeError("Manual supersession reviewId does not match reviewed material", code);
  }
  assertHash(record.reviewIntegrityHash, "reviewIntegrityHash", code);
  if (record.reviewIntegrityHash !== manualSupersessionReviewIntegrityHash(record)) {
    throw storeError("Manual supersession review integrity hash mismatch", code);
  }
  return record;
}

export function assertManualSupersessionAuthorizationRecordIntegrity(record) {
  const code = "CORRUPT_MANUAL_SUPERSESSION_AUTHORIZATION_STATE";
  assertManualSupersessionAuthorityRecordSafety(record, code);
  assertClosedRecord(record, MANUAL_SUPERSESSION_AUTHORIZATION_KEYS, code);
  if (Number(record.schemaVersion) !== MANUAL_SUPERSESSION_AUTHORIZATION_SCHEMA_VERSION) {
    throw storeError("Unsupported manual supersession authorization schemaVersion", code);
  }
  if (record.authority !== MANUAL_SUPERSESSION_AUTHORIZATION_AUTHORITY) {
    throw storeError("Invalid manual supersession authorization authority", code);
  }
  if (!text(record.reviewId) || !text(record.candidateId) || !text(record.priorLifecycleState)) {
    throw storeError("Manual supersession authorization binding is incomplete", code);
  }
  if (
    !Number.isInteger(Number(record.priorContractVersion))
    || Number(record.priorContractVersion) < 1
    || !Number.isInteger(Number(record.priorStateRevision))
    || Number(record.priorStateRevision) < 0
    || !Number.isInteger(Number(record.proposedContractVersion))
    || Number(record.proposedContractVersion) !== Number(record.priorContractVersion) + 1
  ) {
    throw storeError("Manual supersession authorization version/state binding is invalid", code);
  }
  assertHash(record.priorContentHash, "priorContentHash", code);
  assertHash(record.proposedContentHash, "proposedContentHash", code);
  if (record.decision !== "AUTHORIZED" || !exactTimestamp(record.authorizedAt)) {
    throw storeError("Manual supersession authorization decision evidence is invalid", code);
  }
  const consumedAt = text(record.consumedAt);
  const consumedByOperationId = text(record.consumedByOperationId);
  if (Boolean(consumedAt) !== Boolean(consumedByOperationId) || (consumedAt && !exactTimestamp(consumedAt))) {
    throw storeError("Manual supersession authorization consumption evidence is invalid", code);
  }
  if (text(record.authorizationId) !== manualSupersessionAuthorizationId(record)) {
    throw storeError("Manual supersession authorizationId does not match review provenance", code);
  }
  assertHash(record.authorizationIntegrityHash, "authorizationIntegrityHash", code);
  if (record.authorizationIntegrityHash !== manualSupersessionAuthorizationIntegrityHash(record)) {
    throw storeError("Manual supersession authorization integrity hash mismatch", code);
  }
  return record;
}

export function assertManualSupersessionDeclineRecordIntegrity(record) {
  const code = "CORRUPT_MANUAL_SUPERSESSION_DECLINE_STATE";
  assertManualSupersessionAuthorityRecordSafety(record, code);
  assertClosedRecord(record, MANUAL_SUPERSESSION_DECLINE_KEYS, code);
  if (Number(record.schemaVersion) !== MANUAL_SUPERSESSION_DECLINE_SCHEMA_VERSION) {
    throw storeError("Unsupported manual supersession decline schemaVersion", code);
  }
  if (record.authority !== MANUAL_SUPERSESSION_DECLINE_AUTHORITY) {
    throw storeError("Invalid manual supersession decline authority", code);
  }
  if (!text(record.reviewId) || !text(record.candidateId) || !text(record.priorLifecycleState)) {
    throw storeError("Manual supersession decline binding is incomplete", code);
  }
  if (
    !Number.isInteger(Number(record.priorContractVersion))
    || Number(record.priorContractVersion) < 1
    || !Number.isInteger(Number(record.priorStateRevision))
    || Number(record.priorStateRevision) < 0
    || !Number.isInteger(Number(record.proposedContractVersion))
    || Number(record.proposedContractVersion) !== Number(record.priorContractVersion) + 1
  ) {
    throw storeError("Manual supersession decline version/state binding is invalid", code);
  }
  assertHash(record.priorContentHash, "priorContentHash", code);
  assertHash(record.proposedContentHash, "proposedContentHash", code);
  if (record.decision !== "DECLINED" || !exactTimestamp(record.declinedAt)) {
    throw storeError("Manual supersession decline decision evidence is invalid", code);
  }
  if (text(record.declineId) !== manualSupersessionDeclineId(record)) {
    throw storeError("Manual supersession declineId does not match review provenance", code);
  }
  assertHash(record.declineIntegrityHash, "declineIntegrityHash", code);
  if (record.declineIntegrityHash !== manualSupersessionDeclineIntegrityHash(record)) {
    throw storeError("Manual supersession decline integrity hash mismatch", code);
  }
  return record;
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
    schemaVersion: PRETRADE_STORE_SCHEMA_VERSION,
    storeEpoch: crypto.randomUUID(),
    storeRevision: 0,
    transactionId: null,
    updatedAt: null,
    candidates: [],
    dssEvaluations: [],
    manualSupersessionReviews: [],
    manualSupersessionAuthorizations: [],
    manualSupersessionDeclines: [],
    importLog: [],
    pretradePreviews: [],
    pretradePreviewOperations: [],
    pretradePreviewReceipts: [],
    pretradeProviderRuns: [],
    pretradeProviderMessages: [],
  };
}

function normalizePreviewRecords(state, field, idField, requiredSinceVersion = 2) {
  if (!Object.prototype.hasOwnProperty.call(state, field)) {
    if (Number(state.schemaVersion) >= requiredSinceVersion) {
      throw storeError(`${field} is missing from initialized preview state`, "CORRUPT_PRETRADE_PREVIEW_STATE");
    }
    return [];
  }
  if (!Array.isArray(state[field])) {
    throw storeError(`${field} must be an array`, "CORRUPT_PRETRADE_PREVIEW_STATE");
  }
  const seen = new Set();
  return state[field].map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record) || !text(record[idField])) {
      throw storeError(`${field} contains an invalid record`, "CORRUPT_PRETRADE_PREVIEW_STATE");
    }
    if (seen.has(record[idField])) {
      throw storeError(`${field} contains a duplicate ${idField}`, "CORRUPT_PRETRADE_PREVIEW_STATE");
    }
    seen.add(record[idField]);
    return deepFreeze(structuredClone(record));
  });
}

function hasExactKeys(record, expected) {
  const actual = Object.keys(record);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}

function normalizeManualSupersessionRecords(state, {
  field,
  idField,
  validator,
  freeze = false,
  corruptCode,
}) {
  if (!Object.prototype.hasOwnProperty.call(state, field)) return [];
  if (!Array.isArray(state[field])) {
    throw storeError(`PRETRADE ${field} must be an array`, corruptCode);
  }
  const seen = new Set();
  return state[field].map((record) => {
    validator(record);
    const id = text(record[idField]);
    if (seen.has(id)) throw storeError(`Duplicate PRETRADE ${idField}: ${id}`, corruptCode);
    seen.add(id);
    const cloned = structuredClone(record);
    return freeze ? deepFreeze(cloned) : cloned;
  });
}

function normalizeState(raw, { reconcileMissingDss = false } = {}) {
  const state = raw && typeof raw === "object" ? raw : {};
  if (
    state.schemaVersion !== undefined
    && ![PRETRADE_SCHEMA_VERSION, 2, PRETRADE_STORE_SCHEMA_VERSION].includes(Number(state.schemaVersion))
  ) {
    throw storeError("Unsupported PRETRADE store schema", "UNSUPPORTED_PRETRADE_SCHEMA");
  }
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
        if (reconcileMissingDss && normalized.currentDssEvaluationId && !evaluationIds.has(normalized.currentDssEvaluationId)) {
          normalized.currentDssEvaluationStale = true;
          normalized.currentDssEvaluationStaleAt ||= state.updatedAt || null;
          normalized.currentDssEvaluationStaleReason = "MISSING_PERSISTED_DSS_EVALUATION";
        }
        return normalized;
      })
    : [];
  const manualSupersessionReviews = normalizeManualSupersessionRecords(state, {
    field: "manualSupersessionReviews",
    idField: "reviewId",
    validator: assertManualSupersessionReviewRecordIntegrity,
    freeze: true,
    corruptCode: "CORRUPT_MANUAL_SUPERSESSION_REVIEW_STATE",
  });
  const manualSupersessionAuthorizations = normalizeManualSupersessionRecords(state, {
    field: "manualSupersessionAuthorizations",
    idField: "authorizationId",
    validator: assertManualSupersessionAuthorizationRecordIntegrity,
    corruptCode: "CORRUPT_MANUAL_SUPERSESSION_AUTHORIZATION_STATE",
  });
  const manualSupersessionDeclines = normalizeManualSupersessionRecords(state, {
    field: "manualSupersessionDeclines",
    idField: "declineId",
    validator: assertManualSupersessionDeclineRecordIntegrity,
    freeze: true,
    corruptCode: "CORRUPT_MANUAL_SUPERSESSION_DECLINE_STATE",
  });
  const reviewsById = new Map(manualSupersessionReviews.map((review) => [review.reviewId, review]));
  for (const authorization of manualSupersessionAuthorizations) {
    const review = reviewsById.get(authorization.reviewId);
    if (!review) {
      throw storeError(
        `Manual supersession authorization references unknown reviewId ${authorization.reviewId}`,
        "CORRUPT_MANUAL_SUPERSESSION_AUTHORIZATION_STATE",
      );
    }
    for (const field of [
      "candidateId",
      "priorContractVersion",
      "priorLifecycleState",
      "priorStateRevision",
      "priorContentHash",
      "proposedContractVersion",
      "proposedContentHash",
    ]) {
      if (!Object.is(authorization[field], review[field])) {
        throw storeError(
          `Manual supersession authorization does not match review field ${field}`,
          "CORRUPT_MANUAL_SUPERSESSION_AUTHORIZATION_STATE",
        );
      }
    }
  }
  const authorizedReviewIds = new Set(manualSupersessionAuthorizations.map((authorization) => authorization.reviewId));
  for (const decline of manualSupersessionDeclines) {
    const review = reviewsById.get(decline.reviewId);
    if (!review) {
      throw storeError(
        `Manual supersession decline references unknown reviewId ${decline.reviewId}`,
        "CORRUPT_MANUAL_SUPERSESSION_DECLINE_STATE",
      );
    }
    for (const field of [
      "candidateId",
      "priorContractVersion",
      "priorLifecycleState",
      "priorStateRevision",
      "priorContentHash",
      "proposedContractVersion",
      "proposedContentHash",
    ]) {
      if (!Object.is(decline[field], review[field])) {
        throw storeError(
          `Manual supersession decline does not match review field ${field}`,
          "CORRUPT_MANUAL_SUPERSESSION_DECLINE_STATE",
        );
      }
    }
    if (authorizedReviewIds.has(decline.reviewId)) {
      throw storeError(
        `Manual supersession review ${decline.reviewId} has conflicting durable decisions`,
        "CORRUPT_MANUAL_SUPERSESSION_DECISION_STATE",
      );
    }
  }

  const pretradePreviews = normalizePreviewRecords(state, "pretradePreviews", "previewId");
  const pretradePreviewOperations = normalizePreviewRecords(state, "pretradePreviewOperations", "operationId");
  const pretradePreviewReceipts = normalizePreviewRecords(state, "pretradePreviewReceipts", "receiptId");
  const pretradeProviderRuns = normalizePreviewRecords(state, "pretradeProviderRuns", "challengeId", 3);
  const pretradeProviderMessages = normalizePreviewRecords(state, "pretradeProviderMessages", "messageId", 3);
  const previewsById = new Map(pretradePreviews.map((record) => [record.previewId, record]));
  const operationsById = new Map(pretradePreviewOperations.map((record) => [record.operationId, record]));
  const receiptsById = new Map(pretradePreviewReceipts.map((record) => [record.receiptId, record]));
  const previewsByBindingHash = new Map(pretradePreviews.map((record) => [record.bindingHash, record]));
  const unresolvedProposalHashes = new Set();
  for (const preview of pretradePreviews) {
    let candidateHash = null;
    try {
      candidateHash = candidateContractHash(preview.bundle?.candidates?.[0]);
    } catch {
      candidateHash = null;
    }
    const revision = Number(preview.revision);
    const prior = text(preview.priorBindingHash) ? previewsByBindingHash.get(preview.priorBindingHash) : null;
    if (
      Number(preview.schemaVersion) !== 1
      || !Number.isInteger(revision)
      || revision < 1
      || preview.storeEpoch !== text(state.storeEpoch)
      || !preview.bundle
      || preview.bundle.candidates?.length !== 1
      || preview.proposalHash !== pretradePreviewProposalHash(preview.bundle)
      || contentHash(preview.proposal) !== contentHash(pretradePreviewProposal(preview.bundle))
      || text(preview.candidateIdentity?.candidateId) !== text(preview.bundle.candidates[0]?.candidateId)
      || Number(preview.candidateIdentity?.contractVersion) !== Number(preview.bundle.candidates[0]?.contractVersion)
      || preview.candidateIdentity?.contentHash !== candidateHash
      || preview.bindingHash !== pretradePreviewBindingHash(preview)
      || !operationsById.has(preview.operationId)
      || (revision === 1 && text(preview.priorBindingHash))
      || (revision > 1 && (
        !prior
        || Number(prior.revision) !== revision - 1
        || prior.proposalHash !== preview.proposalHash
        || prior.state !== "RETIRED"
      ))
    ) {
      throw storeError("PRETRADE preview record schema or binding is invalid", "CORRUPT_PRETRADE_PREVIEW_STATE");
    }
  }
  for (const operation of pretradePreviewOperations) {
    const preview = previewsById.get(operation.previewId);
    if (
      Number(operation.schemaVersion) !== 1
      || !preview
      || !["UNSTARTED", "ACCEPTING", "DISCARDED", "RETIRED", "ADMITTED", "ALREADY_PRESENT", "NOT_ADMITTED"].includes(operation.state)
      || (["ADMITTED", "ALREADY_PRESENT", "NOT_ADMITTED"].includes(operation.state) && !operation.receiptId)
      || (!["ADMITTED", "ALREADY_PRESENT", "NOT_ADMITTED"].includes(operation.state) && Boolean(operation.receiptId))
      || preview.operationId !== operation.operationId
      || preview.bindingHash !== operation.bindingHash
      || preview.proposalHash !== operation.proposalHash
      || text(preview.accountScope) !== text(operation.accountScope)
      || Number(preview.revision) !== Number(operation.previewRevision)
      || operation.integrityHash !== pretradePreviewOperationIntegrityHash(operation, preview)
      || (operation.receiptId && !receiptsById.has(operation.receiptId))
      || preview.state !== (operation.state === "UNSTARTED" ? "PREVIEW_READY" : operation.state)
    ) {
      throw storeError("PRETRADE preview operation linkage is invalid", "CORRUPT_PRETRADE_PREVIEW_STATE");
    }
    if (["UNSTARTED", "ACCEPTING"].includes(operation.state)) {
      if (unresolvedProposalHashes.has(operation.proposalHash)) {
        throw storeError("PRETRADE proposal has multiple unresolved operations", "CORRUPT_PRETRADE_PREVIEW_STATE");
      }
      unresolvedProposalHashes.add(operation.proposalHash);
    }
  }
  for (const receipt of pretradePreviewReceipts) {
    const preview = previewsById.get(receipt.previewId);
    const operation = operationsById.get(receipt.operationId);
    if (
      Number(receipt.schemaVersion) !== 1
      || !["ADMITTED", "ALREADY_PRESENT", "NOT_ADMITTED"].includes(receipt.result)
      || !preview
      || !operation
      || receipt.receiptId !== `preview-receipt:${receipt.operationId}`
      || receipt.receiptHash !== pretradePreviewReceiptHash(receipt)
      || (isOperatorReviewedImportPolicy(preview?.policy)
        ? contentHash(receipt.reviewScope ?? null) !== contentHash(OPERATOR_REVIEWED_IMPORT_SCOPE)
        : receipt.reviewScope !== undefined)
      || preview.bindingHash !== receipt.bindingHash
      || preview.proposalHash !== receipt.proposalHash
      || Number(preview.revision) !== Number(receipt.previewRevision)
      || operation.receiptId !== receipt.receiptId
      || operation.state !== receipt.result
      || preview.state !== receipt.result
      || !Number.isInteger(Number(receipt.commitRevision))
      || Number(receipt.commitRevision) < 1
      || Number(receipt.commitRevision) > Number(state.storeRevision || 0)
    ) {
      throw storeError("PRETRADE preview receipt linkage is invalid", "CORRUPT_PRETRADE_PREVIEW_STATE");
    }
    if (["ADMITTED", "ALREADY_PRESENT"].includes(receipt.result)) {
      const normalizedPreviewCandidate = normalizeCanonicalCandidateProposal(
        preview.bundle?.candidates?.[0],
        { bundleSource: preview.bundle?.source },
      );
      const previewCanonicalCandidateHash = normalizedPreviewCandidate.errors.length
        ? null
        : candidateContractHash(normalizedPreviewCandidate.normalized);
      if (
        text(receipt.candidate?.candidateId) !== text(preview.candidateIdentity?.candidateId)
        || Number(receipt.candidate?.contractVersion) !== Number(preview.candidateIdentity?.contractVersion)
        || text(receipt.candidate?.contentHash) !== text(previewCanonicalCandidateHash)
      ) {
        throw storeError("PRETRADE receipt candidate does not match its preview", "CORRUPT_PRETRADE_PREVIEW_STATE");
      }
      const candidate = candidates.find((item) => (
        item.candidateId === receipt.candidate?.candidateId
        && Number(item.contractVersion) === Number(receipt.candidate?.contractVersion)
      ));
      if (
        !candidate
        || candidate.contentHash !== receipt.candidate?.contentHash
        || candidateContractHash(candidate) !== previewCanonicalCandidateHash
      ) {
        throw storeError("PRETRADE receipt candidate binding is invalid", "CORRUPT_PRETRADE_PREVIEW_STATE");
      }
      if (receipt.result === "ALREADY_PRESENT" && receipt.canonicalAdmission !== null) {
        throw storeError("PRETRADE existing-candidate receipt claims a new admission", "CORRUPT_PRETRADE_PREVIEW_STATE");
      }
      if (receipt.result !== "ADMITTED") continue;
      const admissionOperation = candidate?.lifecycleJournal?.operations?.find((item) => (
        item.operationId === receipt.canonicalAdmission?.operationId
      ));
      const admissionEvent = candidate?.lifecycleJournal?.events?.find((item) => (
        item.eventId === receipt.canonicalAdmission?.eventId
        && item.operationId === receipt.canonicalAdmission?.operationId
      ));
      if (
        admissionOperation?.action !== "ACCEPT_CANDIDATE"
        || admissionOperation?.result?.eventId !== receipt.canonicalAdmission?.eventId
        || !admissionEvent
        || admissionEvent.eventType !== "CANDIDATE_ACCEPTED"
        || admissionEvent.provenance?.candidateContentHash !== receipt.candidate?.contentHash
      ) {
        throw storeError("PRETRADE admitted receipt lacks canonical journal linkage", "CORRUPT_PRETRADE_PREVIEW_STATE");
      }
    }
  }

  const providerRunsByChallenge = new Map();
  const providerRunsByRunKey = new Map();
  for (const run of pretradeProviderRuns) {
    const runKey = `${text(run.draftId)}\u0000${Number(run.inputRevision)}\u0000${text(run.runId)}`;
    if (
      Number(run.schemaVersion) !== 1
      || !hasExactKeys(run, PRETRADE_PROVIDER_RUN_KEYS)
      || run.storeEpoch !== text(state.storeEpoch)
      || !UUID_PATTERN.test(text(run.challengeId))
      || !BASE64URL_256_PATTERN.test(text(run.challengeNonce))
      || Buffer.from(text(run.challengeNonce), "base64url").length !== 32
      || Buffer.from(text(run.challengeNonce), "base64url").toString("base64url") !== text(run.challengeNonce)
      || !UUID_PATTERN.test(text(run.bootGeneration))
      || !exactUtcTimestamp(run.issuedAt)
      || !exactUtcTimestamp(run.expiresAt)
      || Date.parse(run.issuedAt) >= Date.parse(run.expiresAt)
      || !text(run.draftId)
      || !Number.isSafeInteger(Number(run.inputRevision))
      || Number(run.inputRevision) < 0
      || !text(run.runId)
      || !text(run.inputManifestHash)
      || !Number.isSafeInteger(Number(run.retirementRevision))
      || Number(run.retirementRevision) < 0
      || !text(run.accountScopeId)
      || !text(run.accountSelectionRevision)
      || !/^[0-9a-f]{64}$/.test(text(run.inputManifestHash))
      || !/^[0-9a-f]{64}$/.test(text(run.policyHash))
      || !["ACTIVE", "VERIFYING", "REGISTERED", "REJECTED", "RETIRED", "INTERRUPTED"].includes(run.status)
      || run.integrityHash !== pretradeProviderRunIntegrityHash(run)
      || (["ACTIVE", "VERIFYING"].includes(run.status) ? run.finishedAt !== null : !exactUtcTimestamp(run.finishedAt))
      || (["ACTIVE", "VERIFYING", "REGISTERED"].includes(run.status) ? run.reasonCode !== null : !text(run.reasonCode))
      || (run.status === "ACTIVE" && [run.messageId, run.envelopeHash, run.providerResponseId, run.previewId, run.operationId].some(value => value !== null))
      || (["VERIFYING", "REGISTERED", "REJECTED"].includes(run.status) && (
        !UUID_PATTERN.test(text(run.messageId))
        || !/^[0-9a-f]{64}$/.test(text(run.envelopeHash))
        || !text(run.providerResponseId)
      ))
      || (run.status !== "REGISTERED" && (run.previewId !== null || run.operationId !== null))
      || (run.status === "REGISTERED" && (!text(run.previewId) || !text(run.operationId)))
    ) {
      throw storeError("PRETRADE provider run ledger is invalid", "CORRUPT_PRETRADE_PROVIDER_HANDOFF_STATE");
    }
    if (providerRunsByRunKey.has(runKey)) {
      throw storeError("PRETRADE provider run ledger contains duplicate active identity", "CORRUPT_PRETRADE_PROVIDER_HANDOFF_STATE");
    }
    providerRunsByChallenge.set(run.challengeId, run);
    providerRunsByRunKey.set(runKey, run);
  }

  const providerReplayKeys = new Set();
  const providerChallengeMessages = new Set();
  const providerMessagesByChallenge = new Map();
  for (const message of pretradeProviderMessages) {
    const run = providerRunsByChallenge.get(message.challengeId);
    const registeredPreview = message.status === "REGISTERED" ? previewsById.get(message.previewId) : null;
    const registeredOperation = message.status === "REGISTERED" ? operationsById.get(message.operationId) : null;
    const expectedReplayKey = contentHash({
      issuerId: message.issuerId,
      storeEpoch: state.storeEpoch,
      runId: message.runId,
      inputRevision: message.inputRevision,
      providerResponseId: message.providerResponseId,
    });
    if (
      Number(message.schemaVersion) !== 1
      || !hasExactKeys(message, PRETRADE_PROVIDER_MESSAGE_KEYS)
      || !run
      || !UUID_PATTERN.test(text(message.messageId))
      || !/^[0-9a-f]{64}$/.test(text(message.replayKey))
      || !/^[0-9a-f]{64}$/.test(text(message.envelopeHash))
      || message.replayKey !== expectedReplayKey
      || !text(message.issuerId)
      || !text(message.keyId)
      || !text(message.providerResponseId)
      || !["VERIFYING", "REGISTERED", "REJECTED", "INTERRUPTED"].includes(message.status)
      || message.integrityHash !== pretradeProviderMessageIntegrityHash(message)
      || !exactUtcTimestamp(message.reservedAt)
      || (message.status === "VERIFYING" ? message.finishedAt !== null : !exactUtcTimestamp(message.finishedAt))
      || (["VERIFYING", "REGISTERED"].includes(message.status) ? message.reasonCode !== null : !text(message.reasonCode))
      || (message.status !== "REGISTERED" && (message.previewId !== null || message.operationId !== null))
      || (message.status !== "VERIFYING" && message.finishedAt !== run.finishedAt)
      || text(message.draftId) !== text(run.draftId)
      || Number(message.inputRevision) !== Number(run.inputRevision)
      || text(message.runId) !== text(run.runId)
      || text(run.messageId) !== text(message.messageId)
      || text(run.envelopeHash) !== text(message.envelopeHash)
      || text(run.providerResponseId) !== text(message.providerResponseId)
      || (message.status === "VERIFYING" && run.status !== "VERIFYING")
      || (message.status === "REJECTED" && run.status !== "REJECTED")
      || (message.status === "INTERRUPTED" && !["INTERRUPTED", "RETIRED"].includes(run.status))
      || (message.status === "REGISTERED" && (
        run.status !== "REGISTERED"
        || text(run.messageId) !== text(message.messageId)
        || !text(message.previewId)
        || !text(message.operationId)
        || text(run.previewId) !== text(message.previewId)
        || text(run.operationId) !== text(message.operationId)
        || !previewsById.has(message.previewId)
        || !operationsById.has(message.operationId)
        || previewsById.get(message.previewId)?.operationId !== message.operationId
        || operationsById.get(message.operationId)?.previewId !== message.previewId
        || Number(registeredPreview?.revision) !== 1
        || registeredPreview?.priorBindingHash !== null
        || registeredPreview?.storeEpoch !== run.storeEpoch
        || text(registeredPreview?.draftId) !== text(run.draftId)
        || Number(registeredPreview?.inputRevision) !== Number(run.inputRevision)
        || text(registeredPreview?.runId) !== text(run.runId)
        || text(registeredPreview?.accountScope) !== text(run.accountScopeId)
        || contentHash(registeredPreview?.policy) !== run.policyHash
        || registeredPreview?.createdAt !== message.finishedAt
        || text(registeredPreview?.provenance?.channel) !== "AUTHENTICATED_PROVIDER_HANDOFF"
        || text(registeredPreview?.provenance?.issuerId) !== text(message.issuerId)
        || text(registeredPreview?.provenance?.keyId) !== text(message.keyId)
        || text(registeredPreview?.provenance?.messageId) !== text(message.messageId)
        || text(registeredPreview?.provenance?.providerResponseId) !== text(message.providerResponseId)
        || registeredPreview?.provenance?.byteIdentityVerified !== true
        || registeredOperation?.bindingHash !== registeredPreview?.bindingHash
      ))
    ) {
      throw storeError("PRETRADE provider message ledger is invalid", "CORRUPT_PRETRADE_PROVIDER_HANDOFF_STATE");
    }
    if (providerReplayKeys.has(message.replayKey) || providerChallengeMessages.has(message.challengeId)) {
      throw storeError("PRETRADE provider message ledger contains duplicate replay authority", "CORRUPT_PRETRADE_PROVIDER_HANDOFF_STATE");
    }
    providerReplayKeys.add(message.replayKey);
    providerChallengeMessages.add(message.challengeId);
    providerMessagesByChallenge.set(message.challengeId, message);
  }
  for (const run of pretradeProviderRuns) {
    const message = providerMessagesByChallenge.get(run.challengeId);
    if (
      (["VERIFYING", "REGISTERED", "REJECTED"].includes(run.status) && !message)
      || (text(run.messageId) && !message)
      || (!text(run.messageId) && message)
    ) {
      throw storeError("PRETRADE provider run/message linkage is incomplete", "CORRUPT_PRETRADE_PROVIDER_HANDOFF_STATE");
    }
  }

  return {
    schemaVersion: PRETRADE_STORE_SCHEMA_VERSION,
    storeEpoch: text(state.storeEpoch) || crypto.randomUUID(),
    storeRevision: Number.isInteger(Number(state.storeRevision)) && Number(state.storeRevision) >= 0
      ? Number(state.storeRevision)
      : 0,
    transactionId: text(state.transactionId) || null,
    updatedAt: state.updatedAt || null,
    candidates,
    dssEvaluations,
    manualSupersessionReviews,
    manualSupersessionAuthorizations,
    manualSupersessionDeclines,
    importLog: Array.isArray(state.importLog) ? state.importLog : [],
    pretradePreviews,
    pretradePreviewOperations,
    pretradePreviewReceipts,
    pretradeProviderRuns,
    pretradeProviderMessages,
  };
}

function storeError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export class PreTradeStore {
  constructor({ filePath = DEFAULT_PRETRADE_STATE_FILE, clock = nowIso, failpoint = null } = {}) {
    this.filePath = path.resolve(filePath);
    this.generationPath = `${this.filePath}.generation.json`;
    this.lockPath = `${this.filePath}.writer.lock`;
    this.clock = clock;
    this.failpoint = typeof failpoint === "function" ? failpoint : () => {};
    this.state = emptyState();
    this.fenced = false;
    this.lockFd = null;
    this.filesystemDurabilityValidated = false;
    this.transactionActive = false;
    this.persistedBytesHash = null;
  }

  acquireWriterLock() {
    if (this.lockFd !== null) return;
    fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });
    let created = false;
    try {
      this.lockFd = fs.openSync(this.lockPath, "wx", 0o600);
      created = true;
      fs.writeFileSync(this.lockFd, `${JSON.stringify({ pid: process.pid, acquiredAt: this.clock() })}\n`);
      fs.fsyncSync(this.lockFd);
      this.#validateFilesystemDurability();
    } catch (error) {
      if (this.lockFd !== null) {
        try { fs.closeSync(this.lockFd); } finally { this.lockFd = null; }
      }
      if (created) {
        try { fs.unlinkSync(this.lockPath); } catch (unlinkError) { if (unlinkError?.code !== "ENOENT") throw unlinkError; }
      }
      if (error?.code === "EEXIST") throw storeError("PRETRADE store already has a writer", "PRETRADE_WRITER_LOCKED");
      throw error;
    }
  }

  close() {
    if (this.lockFd === null) return;
    fs.closeSync(this.lockFd);
    this.lockFd = null;
    try { fs.unlinkSync(this.lockPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }

  #validateFilesystemDurability() {
    const directory = path.dirname(this.filePath);
    const probeId = `${process.pid}.${crypto.randomUUID()}`;
    const pendingPath = path.join(directory, `.pretrade-durability-${probeId}.tmp`);
    const renamedPath = path.join(directory, `.pretrade-durability-${probeId}.committed`);
    let fileFd = null;
    try {
      fileFd = fs.openSync(pendingPath, "wx", 0o600);
      fs.writeFileSync(fileFd, `${probeId}\n`, "utf8");
      fs.fsyncSync(fileFd);
      fs.closeSync(fileFd);
      fileFd = null;
      fs.renameSync(pendingPath, renamedPath);
      const directoryFd = fs.openSync(directory, "r");
      try {
        fs.fsyncSync(directoryFd);
        fs.unlinkSync(renamedPath);
        fs.fsyncSync(directoryFd);
      } finally {
        fs.closeSync(directoryFd);
      }
      this.filesystemDurabilityValidated = true;
    } catch (cause) {
      if (fileFd !== null) fs.closeSync(fileFd);
      for (const target of [pendingPath, renamedPath]) {
        try { fs.unlinkSync(target); } catch (error) { if (error?.code !== "ENOENT") cause.cleanupError = error; }
      }
      this.filesystemDurabilityValidated = false;
      const error = storeError("PRETRADE filesystem does not support the required durable replacement protocol", "PRETRADE_FILESYSTEM_UNSUPPORTED");
      error.cause = cause;
      throw error;
    }
  }

  load() {
    try {
      const bytes = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(bytes);
      for (const candidate of parsed.candidates || []) assertCanonicalCandidateIntegrity(candidate);
      this.state = normalizeState(parsed, { reconcileMissingDss: true });
      if (fs.existsSync(this.generationPath)) {
        const generation = JSON.parse(fs.readFileSync(this.generationPath, "utf8"));
        if (text(generation.storeEpoch) !== this.state.storeEpoch) {
          throw storeError("PRETRADE generation record does not match state", "PRETRADE_RECOVERY_REQUIRED");
        }
      } else if (Number(parsed.schemaVersion) >= 2) {
        throw storeError("PRETRADE generation record is missing", "PRETRADE_RECOVERY_REQUIRED");
      }
      this.persistedBytesHash = contentHash(bytes);
    } catch (error) {
      if (error?.code !== "ENOENT") { this.fenced = true; throw error; }
      if (fs.existsSync(this.generationPath)) {
        this.fenced = true;
        throw storeError("Initialized PRETRADE state is missing", "PRETRADE_RECOVERY_REQUIRED");
      }
      this.state = emptyState();
    }
    return this.snapshot();
  }

  snapshot() {
    return structuredClone(this.state);
  }

  save() {
    if (this.transactionActive) {
      throw storeError("PRETRADE store mutation cannot reenter an active transaction", "PRETRADE_TRANSACTION_REENTRANT");
    }
    return this.commit(this.state);
  }

  transaction(mutator, { transactionId = crypto.randomUUID() } = {}) {
    if (this.fenced) throw storeError("PRETRADE writers are fenced pending recovery", "PRETRADE_WRITER_FENCED");
    if (this.transactionActive) {
      throw storeError("PRETRADE store mutation cannot reenter an active transaction", "PRETRADE_TRANSACTION_REENTRANT");
    }
    if (typeof mutator !== "function") throw storeError("transaction mutator is required", "INVALID_PRETRADE_TRANSACTION");
    const draft = this.snapshot();
    let result;
    this.transactionActive = true;
    try {
      result = mutator(draft);
      if (result && typeof result.then === "function") {
        throw storeError("PRETRADE transactions must be synchronous", "ASYNC_PRETRADE_TRANSACTION_FORBIDDEN");
      }
    } finally {
      this.transactionActive = false;
    }
    if (JSON.stringify(draft) !== JSON.stringify(this.state)) {
      this.commit(draft, { transactionId });
    }
    return structuredClone(result);
  }

  commit(draft, { transactionId = crypto.randomUUID() } = {}) {
    if (this.fenced) throw storeError("PRETRADE writers are fenced pending recovery", "PRETRADE_WRITER_FENCED");
    if (this.transactionActive) {
      throw storeError("PRETRADE store mutation cannot reenter an active transaction", "PRETRADE_TRANSACTION_REENTRANT");
    }
    const next = normalizeState({
      ...structuredClone(draft),
      storeEpoch: this.state.storeEpoch,
      storeRevision: Number(this.state.storeRevision || 0) + 1,
      transactionId,
    });
    const temporaryLock = this.lockFd === null;
    if (temporaryLock) this.acquireWriterLock();
    try {
      let diskHash = null;
      try { diskHash = contentHash(fs.readFileSync(this.filePath, "utf8")); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      if (diskHash !== this.persistedBytesHash) {
        this.fenced = true;
        throw storeError("PRETRADE snapshot changed outside this store owner; reload under exclusive recovery", "PRETRADE_CONCURRENT_WRITE");
      }
      this.#durableWrite(next);
      this.persistedBytesHash = contentHash(`${JSON.stringify(next, null, 2)}\n`);
      this.state = next;
      return this.snapshot();
    } finally {
      if (temporaryLock) this.close();
    }
  }

  #durableWrite(next) {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    if (!fs.existsSync(this.generationPath)) {
      const generationTemp = `${this.generationPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      let generationFd = null;
      let generationRenamed = false;
      try {
        generationFd = fs.openSync(generationTemp, "wx", 0o600);
        fs.writeFileSync(generationFd, `${JSON.stringify({ storeEpoch: next.storeEpoch, initializedAt: this.clock() }, null, 2)}\n`, "utf8");
        fs.fsyncSync(generationFd);
        fs.closeSync(generationFd);
        generationFd = null;
        fs.renameSync(generationTemp, this.generationPath);
        generationRenamed = true;
        const directoryFd = fs.openSync(directory, "r");
        try {
          fs.fsyncSync(directoryFd);
        } finally {
          fs.closeSync(directoryFd);
        }
      } catch (error) {
        if (generationFd !== null) fs.closeSync(generationFd);
        if (!generationRenamed) {
          try { fs.unlinkSync(generationTemp); } catch (unlinkError) { if (unlinkError?.code !== "ENOENT") throw unlinkError; }
          throw error;
        }
        this.fenced = true;
        const ambiguous = storeError("PRETRADE generation initialization is ambiguous; recovery is required", "PRETRADE_COMMIT_AMBIGUOUS");
        ambiguous.cause = error;
        ambiguous.transactionId = next.transactionId;
        throw ambiguous;
      }
    }
    const tempPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let renamed = false;
    let fileFd = null;
    try {
      this.failpoint("BEFORE_TEMP_WRITE");
      fileFd = fs.openSync(tempPath, "wx", 0o600);
      fs.writeFileSync(fileFd, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      fs.fsyncSync(fileFd);
      this.failpoint("AFTER_FILE_FLUSH");
      fs.closeSync(fileFd);
      fileFd = null;
      this.failpoint("BEFORE_RENAME");
      fs.renameSync(tempPath, this.filePath);
      renamed = true;
      this.failpoint("AFTER_RENAME");
      const directoryFd = fs.openSync(directory, "r");
      try {
        this.failpoint("DURING_DIRECTORY_FLUSH");
        fs.fsyncSync(directoryFd);
        this.failpoint("AFTER_DIRECTORY_FLUSH");
      } finally {
        fs.closeSync(directoryFd);
      }
    } catch (error) {
      if (fileFd !== null) fs.closeSync(fileFd);
      if (!renamed) {
        try { fs.unlinkSync(tempPath); } catch (unlinkError) { if (unlinkError?.code !== "ENOENT") throw unlinkError; }
        throw error;
      }
      this.fenced = true;
      const ambiguous = storeError("PRETRADE commit durability is ambiguous; recovery is required", "PRETRADE_COMMIT_AMBIGUOUS");
      ambiguous.cause = error;
      ambiguous.transactionId = next.transactionId;
      throw ambiguous;
    }
  }

  importBundle(bundle) {
    if (!bundle || typeof bundle !== "object" || !Array.isArray(bundle.candidates)) {
      throw storeError("Import bundle must be an object with a candidates array", "INVALID_BUNDLE");
    }
    const registered = (this.state.pretradePreviewOperations || []).flatMap((operation) => {
      const preview = (this.state.pretradePreviews || []).find((item) => item.previewId === operation.previewId);
      if (!preview) return [];
      return bundle.candidates.some((item) => (
        text(item?.candidateId) === text(preview.candidateIdentity?.candidateId)
        && Number(item?.contractVersion) === Number(preview.candidateIdentity?.contractVersion)
      )) ? [operation] : [];
    });
    if (registered.length) {
      throw storeError("registered proposal requires preview acceptance authority", "PREVIEW_ACCEPTANCE_REQUIRED");
    }

    const before = this.snapshot();
    try {
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
    } catch (error) {
      if (!this.fenced) this.state = before;
      throw error;
    }
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

    const before = this.snapshot();
    try {
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
    } catch (error) {
      if (!this.fenced) this.state = before;
      throw error;
    }
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

    const before = this.snapshot();
    try {
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
    } catch (error) {
      if (!this.fenced) this.state = before;
      throw error;
    }
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
