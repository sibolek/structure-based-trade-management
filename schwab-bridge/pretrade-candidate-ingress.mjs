import crypto from "node:crypto";
import {
  PRETRADE_SCHEMA_VERSION,
  PRETRADE_TRIGGER_EVALUATING,
  canonicalLifecycleState,
  contentHash,
  normalizeCandidate,
} from "./pretrade-state.mjs";

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

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function clone(value) {
  return structuredClone(value);
}

function normalizeRevision(value) {
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

function ingressError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function ensureCandidateAuthorityShape(candidate) {
  candidate.lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
  candidate.stateRevision = normalizeRevision(candidate.stateRevision);
  if (!Array.isArray(candidate.lifecycleEvents)) candidate.lifecycleEvents = [];
  if (!Array.isArray(candidate.lifecycleOperations)) candidate.lifecycleOperations = [];
  return candidate;
}

function operationFingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

export class PreTradeCandidateIngress {
  constructor({ store, clock = nowIso, idFactory = () => crypto.randomUUID() } = {}) {
    if (!store || typeof store !== "object" || typeof store.save !== "function" || typeof store.snapshot !== "function") {
      throw ingressError("store with snapshot() and save() is required", "INVALID_INGRESS_STORE");
    }
    this.store = store;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  importBundle(bundle) {
    if (!bundle || typeof bundle !== "object" || !Array.isArray(bundle.candidates)) {
      throw ingressError("Import bundle must be an object with a candidates array", "INVALID_BUNDLE");
    }
    if (!this.store.state || !Array.isArray(this.store.state.candidates)) {
      throw ingressError("store state is unavailable; call store.load() first", "INGRESS_STORE_NOT_LOADED");
    }

    const stateBeforeMutation = clone(this.store.state);
    const importedAt = this.clock();
    const bundleSource = upper(bundle.source || "UNKNOWN");
    const bundleId = text(bundle.bundleId) || null;

    try {
      const outcomes = bundle.candidates.map((candidate) => this.#importCandidate({
        input: candidate,
        importedAt,
        bundleSource,
        bundleId,
      }));

      this.store.state.updatedAt = importedAt;
      if (!Array.isArray(this.store.state.importLog)) this.store.state.importLog = [];
      this.store.state.importLog.push({
        importedAt,
        source: bundleSource,
        bundleId,
        accepted: outcomes.filter((item) => item.status === "ACCEPTED").length,
        duplicate: outcomes.filter((item) => item.status === "DUPLICATE").length,
        rejected: outcomes.filter((item) => item.status === "REJECTED").length,
        conflict: outcomes.filter((item) => item.status === "CONFLICT").length,
        stale: outcomes.filter((item) => item.status === "STALE").length,
      });

      this.store.save();
      return { importedAt, outcomes };
    } catch (error) {
      this.store.state = stateBeforeMutation;
      throw error;
    }
  }

  #importCandidate({ input, importedAt, bundleSource, bundleId }) {
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
    const versions = this.store.state.candidates.filter((item) => item.candidateId === normalized.candidateId);
    const sameVersion = versions.find((item) => Number(item.contractVersion) === normalized.contractVersion);

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

    for (const existingRaw of versions) {
      const existing = ensureCandidateAuthorityShape(existingRaw);
      if (
        Number(existing.contractVersion) < normalized.contractVersion
        && ACTIVE_PRETRADE_STATES.has(existing.lifecycleState)
      ) {
        this.#supersedeExistingCandidate({
          existing,
          importedAt,
          supersededByVersion: normalized.contractVersion,
          supersedingContentHash: hash,
          bundleSource,
          bundleId,
        });
      }
    }

    const acceptanceOperationId = `INGRESS_ACCEPT:${normalized.candidateId}:v${normalized.contractVersion}:${hash}`;
    const acceptanceEventId = this.idFactory();
    const acceptanceEvent = {
      eventId: acceptanceEventId,
      eventType: "CANDIDATE_ACCEPTED",
      candidateId: normalized.candidateId,
      contractVersion: normalized.contractVersion,
      resultingRevision: 0,
      beforeState: null,
      afterState: "WAITING",
      occurredAt: importedAt,
      source: "CANDIDATE_INGRESS",
      reason: "ACCEPTED_CANDIDATE_PROPOSAL",
      operationId: acceptanceOperationId,
      provenance: {
        bundleSource,
        bundleId,
        candidateSource: normalized.source,
        candidateContentHash: hash,
      },
      metadata: null,
    };

    const acceptanceOperation = {
      operationId: acceptanceOperationId,
      fingerprint: operationFingerprint({
        action: "ACCEPT_CANDIDATE",
        candidateId: normalized.candidateId,
        contractVersion: normalized.contractVersion,
        contentHash: hash,
      }),
      action: "ACCEPT_CANDIDATE",
      candidateId: normalized.candidateId,
      contractVersion: normalized.contractVersion,
      committedAt: importedAt,
      result: {
        candidateId: normalized.candidateId,
        contractVersion: normalized.contractVersion,
        lifecycleState: "WAITING",
        stateRevision: 0,
        eventId: acceptanceEventId,
        committedAt: importedAt,
      },
    };

    this.store.state.candidates.push({
      ...normalized,
      schemaVersion: Number(normalized.schemaVersion || PRETRADE_SCHEMA_VERSION),
      contentHash: hash,
      lifecycleState: "WAITING",
      stateRevision: 0,
      lifecycleEvents: [acceptanceEvent],
      lifecycleOperations: [acceptanceOperation],
      importedAt,
      evaluation: null,
      prerequisiteStatus: null,
      activation: null,
      triggerSatisfaction: null,
      permissionEvaluationStatus: null,
      permissionBlocker: null,
      currentPermissionOutcome: null,
      recoveryGate: null,
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
      stateRevision: 0,
      reasons: [],
    };
  }

  #supersedeExistingCandidate({
    existing,
    importedAt,
    supersededByVersion,
    supersedingContentHash,
    bundleSource,
    bundleId,
  }) {
    const beforeState = existing.lifecycleState;
    const beforeRevision = existing.stateRevision;
    const operationId = `INGRESS_SUPERSEDE:${existing.candidateId}:v${existing.contractVersion}->v${supersededByVersion}:${supersedingContentHash}`;

    if (existing.lifecycleOperations.some((item) => item?.operationId === operationId)) return;

    existing.lifecycleState = "SUPERSEDED";
    existing.stateRevision = beforeRevision + 1;
    existing.supersededAt = importedAt;
    existing.supersededByVersion = supersededByVersion;
    existing.lastLifecycleMutationAt = importedAt;

    const eventId = this.idFactory();
    const event = {
      eventId,
      eventType: "CANDIDATE_SUPERSEDED",
      candidateId: existing.candidateId,
      contractVersion: existing.contractVersion,
      resultingRevision: existing.stateRevision,
      beforeState,
      afterState: "SUPERSEDED",
      occurredAt: importedAt,
      source: "CANDIDATE_INGRESS",
      reason: "NEWER_CONTRACT_VERSION_ACCEPTED",
      operationId,
      provenance: {
        bundleSource,
        bundleId,
        supersededByVersion,
        supersedingContentHash,
      },
      metadata: null,
    };

    existing.lifecycleEvents.push(event);
    existing.lifecycleOperations.push({
      operationId,
      fingerprint: operationFingerprint({
        action: "SUPERSEDE_CANDIDATE",
        candidateId: existing.candidateId,
        contractVersion: existing.contractVersion,
        beforeState,
        beforeRevision,
        supersededByVersion,
        supersedingContentHash,
      }),
      action: "SUPERSEDE_CANDIDATE",
      candidateId: existing.candidateId,
      contractVersion: existing.contractVersion,
      committedAt: importedAt,
      result: {
        candidateId: existing.candidateId,
        contractVersion: existing.contractVersion,
        lifecycleState: "SUPERSEDED",
        stateRevision: existing.stateRevision,
        eventId,
        committedAt: importedAt,
      },
    });
  }
}
