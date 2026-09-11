import crypto from "node:crypto";
import {
  MANUAL_SUPERSESSION_AUTHORIZATION_AUTHORITY,
  MANUAL_SUPERSESSION_AUTHORIZATION_SCHEMA_VERSION,
  MANUAL_SUPERSESSION_DECLINE_AUTHORITY,
  MANUAL_SUPERSESSION_DECLINE_SCHEMA_VERSION,
  MANUAL_SUPERSESSION_REVIEW_AUTHORITY,
  MANUAL_SUPERSESSION_REVIEW_SCHEMA_VERSION,
  PRETRADE_TRIGGER_EVALUATING,
  assertManualSupersessionAuthorizationRecordIntegrity,
  assertManualSupersessionDeclineRecordIntegrity,
  assertManualSupersessionReviewRecordIntegrity,
  canonicalLifecycleState,
  manualSupersessionAuthorizationId,
  manualSupersessionAuthorizationIntegrityHash,
  manualSupersessionDeclineId,
  manualSupersessionDeclineIntegrityHash,
  manualSupersessionReviewId,
  manualSupersessionReviewIntegrityHash,
} from "./pretrade-state.mjs";
import {
  assertCanonicalCandidateIntegrity,
  buildCanonicalContractAuthority,
  canonicalCandidateContent,
  candidateContractHash,
  normalizeCanonicalCandidateProposal,
} from "./pretrade-candidate-contract.mjs";

export const AUTOMATED_UNTOUCHED_ONLY = "AUTOMATED_UNTOUCHED_ONLY";
export const MANUAL_AUTHORIZED = "MANUAL_AUTHORIZED";
export const AUTOMATED_VERSION_GAP = "AUTOMATED_VERSION_GAP";
export const AUTOMATED_SUPERSESSION_REQUIRES_UNTOUCHED_WAITING_REVISION_0 =
  "AUTOMATED_SUPERSESSION_REQUIRES_UNTOUCHED_WAITING_REVISION_0";
export const MANUAL_SUPERSESSION_AUTHORIZATION_REQUIRED =
  "MANUAL_SUPERSESSION_AUTHORIZATION_REQUIRED";
export const MANUAL_SUPERSESSION_AUTHORIZATION_INVALID =
  "MANUAL_SUPERSESSION_AUTHORIZATION_INVALID";
export const MANUAL_SUPERSESSION_REVIEW_REQUIRED =
  "MANUAL_SUPERSESSION_REVIEW_REQUIRED";
export const MANUAL_SUPERSESSION_AUTHORIZATION_REQUEST_INVALID =
  "MANUAL_SUPERSESSION_AUTHORIZATION_REQUEST_INVALID";
export const MANUAL_SUPERSESSION_DECLINE_REQUEST_INVALID =
  "MANUAL_SUPERSESSION_DECLINE_REQUEST_INVALID";
export const MANUAL_SUPERSESSION_OBSERVATION_REQUEST_INVALID =
  "MANUAL_SUPERSESSION_OBSERVATION_REQUEST_INVALID";
export const FORBIDDEN_SUPERSESSION_AUTHORITY_MATERIAL =
  "FORBIDDEN_SUPERSESSION_AUTHORITY_MATERIAL";

const ACTIVE_PRETRADE_STATES = new Set([
  "INGESTED",
  "WAITING",
  PRETRADE_TRIGGER_EVALUATING,
  "PERMISSION_EVALUATING",
  "READY",
  "CAUTION",
]);
const MANUAL_SUPERSESSION_ALLOWED_STATES = new Set([
  "WAITING",
  PRETRADE_TRIGGER_EVALUATING,
  "PERMISSION_EVALUATING",
  "READY",
  "CAUTION",
]);
const SUPERSESSION_BINDING_FIELDS = Object.freeze([
  "candidateId",
  "priorContractVersion",
  "priorLifecycleState",
  "priorStateRevision",
  "priorContentHash",
  "proposedContractVersion",
  "proposedContentHash",
]);
const FORBIDDEN_SUPERSESSION_AUTHORITY_FIELDS = new Set([
  "manualSupersessionReviews",
  "manualSupersessionReview",
  "manualSupersessionAuthorizations",
  "manualSupersessionAuthorization",
  "manualSupersessionDeclines",
  "manualSupersessionDecline",
  "manualSupersessionApproval",
  "authorizationId",
  "declineId",
  "reviewId",
  "manualApproved",
  "forceImport",
  "supersessionApproved",
]);
const AUTHORIZATION_COMMAND_FIELDS = new Set(["reviewId", "operatorConfirmed"]);
const DECLINE_COMMAND_FIELDS = new Set(["reviewId", "operatorDeclined"]);
const OBSERVATION_COMMAND_FIELDS = new Set(["candidate"]);

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

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value ?? {}, field);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
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

function normalizeIngressPolicy(value) {
  const policy = upper(value);
  if (!policy) return null;
  if (policy === AUTOMATED_UNTOUCHED_ONLY) return policy;
  if (policy === MANUAL_AUTHORIZED) return policy;
  throw ingressError(`Unsupported candidate ingress policy: ${policy}`, "INVALID_INGRESS_POLICY");
}

function resolveIngressPolicy(bundlePolicy, optionPolicy) {
  const normalizedBundlePolicy = normalizeIngressPolicy(bundlePolicy);
  const normalizedOptionPolicy = normalizeIngressPolicy(optionPolicy);
  if (
    normalizedBundlePolicy
    && normalizedOptionPolicy
    && normalizedBundlePolicy !== normalizedOptionPolicy
  ) {
    throw ingressError("Candidate ingress policy sources disagree", "INVALID_INGRESS_POLICY");
  }
  const resolved = normalizedOptionPolicy || normalizedBundlePolicy;
  if (!resolved) {
    throw ingressError(
      "Production candidate import requires an explicit recognized ingress policy",
      "INGRESS_POLICY_REQUIRED",
    );
  }
  return resolved;
}

function candidateLifecycleProjection(candidate) {
  return {
    lifecycleState: canonicalLifecycleState(candidate?.lifecycleState),
    stateRevision: normalizeRevision(candidate?.stateRevision),
  };
}

function rejectedPolicyOutcome(candidate, reason) {
  return {
    candidateId: candidate.candidateId,
    contractVersion: candidate.contractVersion,
    status: "REJECTED",
    reasons: [reason],
  };
}

function assertNoInboundSupersessionAuthority(bundle, options = null) {
  const locations = [{ value: bundle, path: "bundle" }];
  if (options && typeof options === "object") locations.push({ value: options, path: "options" });
  if (bundle?.metadata && typeof bundle.metadata === "object") {
    locations.push({ value: bundle.metadata, path: "bundle.metadata" });
  }
  if (bundle?.admissionMetadata && typeof bundle.admissionMetadata === "object") {
    locations.push({ value: bundle.admissionMetadata, path: "bundle.admissionMetadata" });
  }
  if (bundle?.ingressMetadata && typeof bundle.ingressMetadata === "object") {
    locations.push({ value: bundle.ingressMetadata, path: "bundle.ingressMetadata" });
  }
  if (Array.isArray(bundle?.candidates)) {
    for (const [index, candidate] of bundle.candidates.entries()) {
      locations.push({ value: candidate, path: `bundle.candidates[${index}]` });
    }
  }

  for (const { value, path } of locations) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const field of FORBIDDEN_SUPERSESSION_AUTHORITY_FIELDS) {
      if (hasOwn(value, field)) {
        throw ingressError(
          `${path}.${field} cannot establish candidate ingress or supersession authority`,
          FORBIDDEN_SUPERSESSION_AUTHORITY_MATERIAL,
        );
      }
    }
  }
}

function sameBinding(left, right) {
  return SUPERSESSION_BINDING_FIELDS.every((field) => Object.is(left?.[field], right?.[field]));
}

function findManualSupersessionAuthorization({
  authorizations,
  reviewsById,
  prior,
  proposed,
}) {
  const priorProjection = candidateLifecycleProjection(prior);
  const binding = buildReviewBinding({
    candidateId: proposed.candidateId,
    priorContractVersion: Number(prior.contractVersion),
    priorLifecycleState: priorProjection.lifecycleState,
    priorStateRevision: priorProjection.stateRevision,
    priorContentHash: candidateContractHash(prior),
    proposedContractVersion: proposed.contractVersion,
    proposedContentHash: candidateContractHash(proposed),
  });
  const { candidateId, priorLifecycleState, proposedContractVersion, proposedContentHash } = binding;
  if (!MANUAL_SUPERSESSION_ALLOWED_STATES.has(priorLifecycleState)) return { status: "INELIGIBLE_PRIOR_STATE" };
  const proposalMatches = authorizations.filter((authorization) => (
    text(authorization?.candidateId) === candidateId
    && Number(authorization?.proposedContractVersion) === proposedContractVersion
    && text(authorization?.proposedContentHash) === proposedContentHash
  ));
  if (!proposalMatches.length) return null;
  const matches = proposalMatches.filter((authorization) => sameBinding(authorization, binding));
  if (matches.length !== 1) return { status: "STALE_OR_AMBIGUOUS_BINDING" };
  const authorization = matches[0];
  const review = reviewsById.get(text(authorization.reviewId));
  if (!review || !sameBinding(authorization, review)) return { status: "INVALID_REVIEW_PROVENANCE" };
  assertManualSupersessionReviewSemantics(review, { prior });
  if (!valuesEqual(review.proposedCandidate, proposed)) return { status: "PROPOSED_CANDIDATE_MISMATCH" };
  if (text(authorization.consumedAt) || text(authorization.consumedByOperationId)) return { status: "CONSUMED" };
  return {
    status: "AUTHORIZED",
    authorizationId: text(authorization.authorizationId),
    reviewId: text(authorization.reviewId),
    authorization,
  };
}

function ensureCandidateAuthorityShape(candidate) {
  candidate.lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
  candidate.stateRevision = normalizeRevision(candidate.stateRevision);
  if (!candidate.lifecycleJournal || typeof candidate.lifecycleJournal !== "object") {
    candidate.lifecycleJournal = { events: [], operations: [] };
  }
  if (!Array.isArray(candidate.lifecycleJournal.events)) candidate.lifecycleJournal.events = [];
  if (!Array.isArray(candidate.lifecycleJournal.operations)) candidate.lifecycleJournal.operations = [];

  if (Array.isArray(candidate.lifecycleEvents) && candidate.lifecycleEvents.length) {
    candidate.lifecycleJournal.events.push(...candidate.lifecycleEvents);
  }
  if (Array.isArray(candidate.lifecycleOperations) && candidate.lifecycleOperations.length) {
    candidate.lifecycleJournal.operations.push(...candidate.lifecycleOperations.map((operation) => ({
      ...operation,
      operationHash: operation.operationHash || operation.fingerprint || null,
    })));
  }
  delete candidate.lifecycleEvents;
  delete candidate.lifecycleOperations;
  return candidate;
}

function operationHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

const NON_SUBSTANTIVE_REVIEW_FIELDS = new Set([
  "contractVersion",
  "generatedAt",
]);

const NO_INHERITED_AUTHORITY_DISCLOSURE = Object.freeze({
  newLifecycleState: "WAITING",
  newStateRevision: 0,
  inherits: {
    triggerSatisfaction: false,
    dssResult: false,
    riskResult: false,
    reviewState: false,
    selectedQuantity: false,
    armAuthorization: false,
    handoff: false,
    executionAuthority: false,
  },
});

function reviewContent(candidate) {
  const content = canonicalCandidateContent(candidate);
  for (const field of NON_SUBSTANTIVE_REVIEW_FIELDS) delete content[field];
  return content;
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableJson(value[key]);
        return result;
      }, {});
  }
  return value;
}

function valuesEqual(left, right) {
  return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));
}

function diffReviewContent(prior, proposed, prefix = "") {
  if (valuesEqual(prior, proposed)) return [];
  const bothObjects = prior && proposed
    && typeof prior === "object"
    && typeof proposed === "object"
    && !Array.isArray(prior)
    && !Array.isArray(proposed);
  if (!bothObjects) {
    return [{
      path: prefix || "$",
      priorPresent: prior !== undefined,
      proposedPresent: proposed !== undefined,
      ...(prior !== undefined ? { prior: clone(prior) } : {}),
      ...(proposed !== undefined ? { proposed: clone(proposed) } : {}),
    }];
  }
  const keys = [...new Set([...Object.keys(prior), ...Object.keys(proposed)])].sort();
  return keys.flatMap((key) => (
    diffReviewContent(prior[key], proposed[key], prefix ? `${prefix}.${key}` : key)
  ));
}

function buildReviewBinding({
  candidateId,
  priorContractVersion,
  priorLifecycleState,
  priorStateRevision,
  priorContentHash,
  proposedContractVersion,
  proposedContentHash,
}) {
  return {
    candidateId,
    priorContractVersion,
    priorLifecycleState,
    priorStateRevision,
    priorContentHash,
    proposedContractVersion,
    proposedContentHash,
  };
}

function reviewResponse(record) {
  return {
    status: "ACTION_REQUIRED",
    reasons: [],
    reviewId: record.reviewId,
    binding: buildReviewBinding(record),
    substantiveDiff: clone(record.substantiveDiff),
    disclosure: clone(record.disclosure),
    createdAt: record.createdAt,
  };
}

function assertManualSupersessionReviewSemantics(review, { prior = null } = {}) {
  assertManualSupersessionReviewRecordIntegrity(review);
  const { normalized: proposed, errors } = normalizeCanonicalCandidateProposal(review.proposedCandidate, {
    bundleSource: review.proposedCandidate?.source,
  });
  if (
    errors.length
    || !valuesEqual(proposed, review.proposedCandidate)
    || proposed.candidateId !== review.candidateId
    || proposed.contractVersion !== review.proposedContractVersion
    || candidateContractHash(proposed) !== review.proposedContentHash
    || !valuesEqual(review.disclosure, NO_INHERITED_AUTHORITY_DISCLOSURE)
  ) {
    throw ingressError(
      "Persisted manual supersession review does not match its canonical proposed candidate",
      "CORRUPT_MANUAL_SUPERSESSION_REVIEW_STATE",
    );
  }

  if (prior) {
    assertCanonicalCandidateIntegrity(prior);
    const priorProjection = candidateLifecycleProjection(prior);
    const currentBinding = buildReviewBinding({
      candidateId: prior.candidateId,
      priorContractVersion: Number(prior.contractVersion),
      priorLifecycleState: priorProjection.lifecycleState,
      priorStateRevision: priorProjection.stateRevision,
      priorContentHash: candidateContractHash(prior),
      proposedContractVersion: proposed.contractVersion,
      proposedContentHash: candidateContractHash(proposed),
    });
    if (!sameBinding(review, currentBinding)) {
      throw ingressError(
        "Manual supersession review is stale against current PRETRADE state",
        MANUAL_SUPERSESSION_AUTHORIZATION_INVALID,
      );
    }
    const expectedDiff = diffReviewContent(reviewContent(prior), reviewContent(proposed));
    if (!expectedDiff.length || !valuesEqual(review.substantiveDiff, expectedDiff)) {
      throw ingressError(
        "Persisted manual supersession review diff does not match reviewed candidate content",
        "CORRUPT_MANUAL_SUPERSESSION_REVIEW_STATE",
      );
    }
  }
  return proposed;
}

function assertManualSupersessionAuthorityState(state) {
  if (!Array.isArray(state?.manualSupersessionReviews)) {
    throw ingressError(
      "PRETRADE manual supersession review state is unavailable or corrupt",
      "CORRUPT_MANUAL_SUPERSESSION_REVIEW_STATE",
    );
  }
  if (!Array.isArray(state?.manualSupersessionAuthorizations)) {
    throw ingressError(
      "PRETRADE manual supersession authorization state is unavailable or corrupt",
      "CORRUPT_MANUAL_SUPERSESSION_AUTHORIZATION_STATE",
    );
  }
  if (!Array.isArray(state?.manualSupersessionDeclines)) {
    throw ingressError(
      "PRETRADE manual supersession decline state is unavailable or corrupt",
      "CORRUPT_MANUAL_SUPERSESSION_DECLINE_STATE",
    );
  }

  const reviewsById = new Map();
  for (const review of state.manualSupersessionReviews) {
    assertManualSupersessionReviewSemantics(review);
    if (reviewsById.has(review.reviewId)) {
      throw ingressError("Duplicate PRETRADE manual supersession reviewId", "CORRUPT_MANUAL_SUPERSESSION_REVIEW_STATE");
    }
    reviewsById.set(review.reviewId, review);
  }

  const authorizationsById = new Map();
  const authorizedReviewIds = new Set();
  for (const authorization of state.manualSupersessionAuthorizations) {
    assertManualSupersessionAuthorizationRecordIntegrity(authorization);
    if (authorizationsById.has(authorization.authorizationId)) {
      throw ingressError("Duplicate PRETRADE manual supersession authorizationId", "CORRUPT_MANUAL_SUPERSESSION_AUTHORIZATION_STATE");
    }
    const review = reviewsById.get(authorization.reviewId);
    if (!review || !sameBinding(authorization, review)) {
      throw ingressError(
        "PRETRADE manual supersession authorization has invalid review provenance",
        "CORRUPT_MANUAL_SUPERSESSION_AUTHORIZATION_STATE",
      );
    }
    authorizationsById.set(authorization.authorizationId, authorization);
    authorizedReviewIds.add(authorization.reviewId);
  }

  const declinesById = new Map();
  const declinesByReviewId = new Map();
  for (const decline of state.manualSupersessionDeclines) {
    assertManualSupersessionDeclineRecordIntegrity(decline);
    if (declinesById.has(decline.declineId) || declinesByReviewId.has(decline.reviewId)) {
      throw ingressError("Duplicate PRETRADE manual supersession decline evidence", "CORRUPT_MANUAL_SUPERSESSION_DECLINE_STATE");
    }
    const review = reviewsById.get(decline.reviewId);
    if (!review || !sameBinding(decline, review)) {
      throw ingressError(
        "PRETRADE manual supersession decline has invalid review provenance",
        "CORRUPT_MANUAL_SUPERSESSION_DECLINE_STATE",
      );
    }
    if (authorizedReviewIds.has(decline.reviewId)) {
      throw ingressError(
        "PRETRADE manual supersession review has conflicting durable decisions",
        "CORRUPT_MANUAL_SUPERSESSION_DECISION_STATE",
      );
    }
    declinesById.set(decline.declineId, decline);
    declinesByReviewId.set(decline.reviewId, decline);
  }
  return { reviewsById, authorizationsById, declinesById, declinesByReviewId };
}

function buildManualSupersessionReviewRecord({ prior, proposed, createdAt }) {
  const priorProjection = candidateLifecycleProjection(prior);
  const record = {
    schemaVersion: MANUAL_SUPERSESSION_REVIEW_SCHEMA_VERSION,
    authority: MANUAL_SUPERSESSION_REVIEW_AUTHORITY,
    reviewId: null,
    ...buildReviewBinding({
      candidateId: proposed.candidateId,
      priorContractVersion: Number(prior.contractVersion),
      priorLifecycleState: priorProjection.lifecycleState,
      priorStateRevision: priorProjection.stateRevision,
      priorContentHash: candidateContractHash(prior),
      proposedContractVersion: proposed.contractVersion,
      proposedContentHash: candidateContractHash(proposed),
    }),
    proposedCandidate: clone(proposed),
    substantiveDiff: diffReviewContent(reviewContent(prior), reviewContent(proposed)),
    createdAt,
    disclosure: clone(NO_INHERITED_AUTHORITY_DISCLOSURE),
    reviewIntegrityHash: null,
  };
  if (!record.substantiveDiff.length) return null;
  record.reviewId = manualSupersessionReviewId(record);
  record.reviewIntegrityHash = manualSupersessionReviewIntegrityHash(record);
  assertManualSupersessionReviewSemantics(record, { prior });
  return record;
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

  createManualSupersessionReview(bundle, { ingressPolicy = MANUAL_AUTHORIZED } = {}) {
    if (!bundle || typeof bundle !== "object" || !Array.isArray(bundle.candidates)) {
      throw ingressError("Manual supersession review requires a candidate bundle", "INVALID_BUNDLE");
    }
    if (!this.store.state || !Array.isArray(this.store.state.candidates)) {
      throw ingressError("store state is unavailable; call store.load() first", "INGRESS_STORE_NOT_LOADED");
    }
    assertNoInboundSupersessionAuthority(bundle);
    const { reviewsById } = assertManualSupersessionAuthorityState(this.store.state);
    const normalizedIngressPolicy = resolveIngressPolicy(bundle.ingressPolicy, ingressPolicy);
    if (normalizedIngressPolicy !== MANUAL_AUTHORIZED) {
      throw ingressError("Manual supersession review requires MANUAL_AUTHORIZED ingress", "INVALID_INGRESS_POLICY");
    }
    const bundleSource = upper(bundle.source);
    const bundleId = text(bundle.bundleId);
    if (!bundleSource) throw ingressError("canonical candidate bundle source is required", "INVALID_BUNDLE_SOURCE");
    if (!bundleId) throw ingressError("canonical candidate bundleId is required", "INVALID_BUNDLE_ID");

    const stateBeforeMutation = clone(this.store.state);
    let changed = false;
    try {
      const reviews = bundle.candidates.map((input) => {
        const { normalized, errors } = normalizeCanonicalCandidateProposal(input, { bundleSource });
        if (errors.length) {
          return {
            candidateId: normalized.candidateId || null,
            contractVersion: Number.isInteger(normalized.contractVersion) ? normalized.contractVersion : null,
            status: "REJECTED",
            reasons: errors,
          };
        }

        const versions = this.store.state.candidates.filter((item) => item.candidateId === normalized.candidateId);
        const newestVersion = versions.reduce((max, item) => Math.max(max, Number(item.contractVersion || 0)), 0);
        if (!versions.length || normalized.contractVersion !== newestVersion + 1) {
          return {
            candidateId: normalized.candidateId,
            contractVersion: normalized.contractVersion,
            status: "NOT_REVISED",
            reasons: [MANUAL_SUPERSESSION_REVIEW_REQUIRED],
          };
        }

        for (const existing of versions) assertCanonicalCandidateIntegrity(existing);
        const prior = versions.find((item) => Number(item.contractVersion) === newestVersion);
        const priorProjection = candidateLifecycleProjection(prior);
        if (!MANUAL_SUPERSESSION_ALLOWED_STATES.has(priorProjection.lifecycleState)) {
          return {
            candidateId: normalized.candidateId,
            contractVersion: normalized.contractVersion,
            status: "REJECTED",
            reasons: [MANUAL_SUPERSESSION_AUTHORIZATION_INVALID],
          };
        }

        const record = buildManualSupersessionReviewRecord({
          prior,
          proposed: normalized,
          createdAt: this.clock(),
        });
        if (!record) {
          return {
            candidateId: normalized.candidateId,
            contractVersion: normalized.contractVersion,
            status: "NOT_REVISED",
            reasons: [MANUAL_SUPERSESSION_REVIEW_REQUIRED],
          };
        }
        const existingReview = reviewsById.get(record.reviewId);
        if (existingReview) {
          assertManualSupersessionReviewSemantics(existingReview, { prior });
          return reviewResponse(existingReview);
        }
        const immutableRecord = deepFreeze(clone(record));
        this.store.state.manualSupersessionReviews.push(immutableRecord);
        reviewsById.set(record.reviewId, immutableRecord);
        changed = true;
        return reviewResponse(record);
      });
      if (changed) this.store.save();
      return {
        status: reviews.some((review) => review.status === "ACTION_REQUIRED") ? "ACTION_REQUIRED" : "NO_ACTION_REQUIRED",
        reviews,
      };
    } catch (error) {
      this.store.state = stateBeforeMutation;
      throw error;
    }
  }

  authorizeManualSupersession(command = {}) {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      throw ingressError("Manual supersession authorization command must be an object", MANUAL_SUPERSESSION_AUTHORIZATION_REQUEST_INVALID);
    }
    const unexpectedFields = Object.keys(command).filter((field) => !AUTHORIZATION_COMMAND_FIELDS.has(field));
    if (unexpectedFields.length) {
      throw ingressError(
        `Manual supersession authorization command has unexpected fields: ${unexpectedFields.join(", ")}`,
        MANUAL_SUPERSESSION_AUTHORIZATION_REQUEST_INVALID,
      );
    }
    const { reviewId, operatorConfirmed = false } = command;
    if (operatorConfirmed !== true) {
      throw ingressError("Manual supersession authorization requires explicit operator confirmation", "MANUAL_SUPERSESSION_CONFIRMATION_REQUIRED");
    }
    if (!this.store.state || !Array.isArray(this.store.state.candidates)) {
      throw ingressError("store state is unavailable; call store.load() first", "INGRESS_STORE_NOT_LOADED");
    }
    const normalizedReviewId = text(reviewId);
    if (!normalizedReviewId) {
      throw ingressError("Manual supersession authorization requires a persisted reviewId", MANUAL_SUPERSESSION_REVIEW_REQUIRED);
    }
    const { reviewsById, declinesByReviewId } = assertManualSupersessionAuthorityState(this.store.state);
    const review = reviewsById.get(normalizedReviewId);
    if (!review) {
      throw ingressError("Manual supersession reviewId was not found in PRETRADE", MANUAL_SUPERSESSION_REVIEW_REQUIRED);
    }
    const prior = this.store.state.candidates.find((item) => (
      item.candidateId === review.candidateId
      && Number(item.contractVersion) === review.priorContractVersion
    ));
    if (!prior) throw ingressError("Prior candidate for manual supersession authorization was not found", MANUAL_SUPERSESSION_AUTHORIZATION_INVALID);
    assertManualSupersessionReviewSemantics(review, { prior });
    if (!MANUAL_SUPERSESSION_ALLOWED_STATES.has(candidateLifecycleProjection(prior).lifecycleState)) {
      throw ingressError("Manual supersession review is no longer eligible", MANUAL_SUPERSESSION_AUTHORIZATION_INVALID);
    }
    if (declinesByReviewId.has(review.reviewId)) {
      throw ingressError(
        "Manual supersession review already has a durable decline decision",
        MANUAL_SUPERSESSION_AUTHORIZATION_INVALID,
      );
    }

    const existing = this.store.state.manualSupersessionAuthorizations.find((authorization) => (
      authorization.reviewId === review.reviewId
    ));
    if (existing) {
      assertManualSupersessionAuthorizationRecordIntegrity(existing);
      if (!sameBinding(existing, review)) {
        throw ingressError("Existing manual supersession authorization does not match its review", MANUAL_SUPERSESSION_AUTHORIZATION_INVALID);
      }
      if (text(existing.consumedAt) || text(existing.consumedByOperationId)) {
        throw ingressError("Manual supersession authorization has already been consumed", MANUAL_SUPERSESSION_AUTHORIZATION_INVALID);
      }
      return clone(existing);
    }

    const authorizedAt = this.clock();
    const record = {
      schemaVersion: MANUAL_SUPERSESSION_AUTHORIZATION_SCHEMA_VERSION,
      authority: MANUAL_SUPERSESSION_AUTHORIZATION_AUTHORITY,
      authorizationId: null,
      reviewId: review.reviewId,
      ...buildReviewBinding(review),
      decision: "AUTHORIZED",
      authorizedAt,
      consumedAt: null,
      consumedByOperationId: null,
      authorizationIntegrityHash: null,
    };
    record.authorizationId = manualSupersessionAuthorizationId(record);
    record.authorizationIntegrityHash = manualSupersessionAuthorizationIntegrityHash(record);
    assertManualSupersessionAuthorizationRecordIntegrity(record);
    const stateBeforeMutation = clone(this.store.state);
    try {
      this.store.state.manualSupersessionAuthorizations.push(record);
      this.store.save();
      return clone(record);
    } catch (error) {
      this.store.state = stateBeforeMutation;
      throw error;
    }
  }

  declineManualSupersession(command = {}) {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      throw ingressError("Manual supersession decline command must be an object", MANUAL_SUPERSESSION_DECLINE_REQUEST_INVALID);
    }
    const unexpectedFields = Object.keys(command).filter((field) => !DECLINE_COMMAND_FIELDS.has(field));
    if (unexpectedFields.length) {
      throw ingressError(
        `Manual supersession decline command has unexpected fields: ${unexpectedFields.join(", ")}`,
        MANUAL_SUPERSESSION_DECLINE_REQUEST_INVALID,
      );
    }
    if (command.operatorDeclined !== true) {
      throw ingressError("Manual supersession decline requires an explicit operator decision", MANUAL_SUPERSESSION_DECLINE_REQUEST_INVALID);
    }
    if (!this.store.state || !Array.isArray(this.store.state.candidates)) {
      throw ingressError("store state is unavailable; call store.load() first", "INGRESS_STORE_NOT_LOADED");
    }
    const reviewId = text(command.reviewId);
    if (!reviewId) {
      throw ingressError("Manual supersession decline requires a persisted reviewId", MANUAL_SUPERSESSION_REVIEW_REQUIRED);
    }
    const authorityState = assertManualSupersessionAuthorityState(this.store.state);
    const review = authorityState.reviewsById.get(reviewId);
    if (!review) {
      throw ingressError("Manual supersession reviewId was not found in PRETRADE", MANUAL_SUPERSESSION_REVIEW_REQUIRED);
    }
    const prior = this.store.state.candidates.find((item) => (
      item.candidateId === review.candidateId
      && Number(item.contractVersion) === review.priorContractVersion
    ));
    if (!prior) throw ingressError("Prior candidate for manual supersession decline was not found", MANUAL_SUPERSESSION_AUTHORIZATION_INVALID);
    assertManualSupersessionReviewSemantics(review, { prior });
    if (!MANUAL_SUPERSESSION_ALLOWED_STATES.has(candidateLifecycleProjection(prior).lifecycleState)) {
      throw ingressError("Manual supersession review is no longer eligible for decline", MANUAL_SUPERSESSION_AUTHORIZATION_INVALID);
    }
    if ([...authorityState.authorizationsById.values()].some((authorization) => authorization.reviewId === reviewId)) {
      throw ingressError(
        "Manual supersession review already has a durable authorization decision",
        MANUAL_SUPERSESSION_AUTHORIZATION_INVALID,
      );
    }
    const existing = authorityState.declinesByReviewId.get(reviewId);
    if (existing) return clone(existing);

    const record = {
      schemaVersion: MANUAL_SUPERSESSION_DECLINE_SCHEMA_VERSION,
      authority: MANUAL_SUPERSESSION_DECLINE_AUTHORITY,
      declineId: null,
      reviewId,
      ...buildReviewBinding(review),
      decision: "DECLINED",
      declinedAt: this.clock(),
      declineIntegrityHash: null,
    };
    record.declineId = manualSupersessionDeclineId(record);
    record.declineIntegrityHash = manualSupersessionDeclineIntegrityHash(record);
    assertManualSupersessionDeclineRecordIntegrity(record);
    const stateBeforeMutation = clone(this.store.state);
    try {
      this.store.state.manualSupersessionDeclines.push(deepFreeze(clone(record)));
      this.store.save();
      return clone(record);
    } catch (error) {
      this.store.state = stateBeforeMutation;
      throw error;
    }
  }

  observeManualSupersessionDecision(command = {}) {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      throw ingressError("Manual supersession observation command must be an object", MANUAL_SUPERSESSION_OBSERVATION_REQUEST_INVALID);
    }
    const unexpectedFields = Object.keys(command).filter((field) => !OBSERVATION_COMMAND_FIELDS.has(field));
    if (unexpectedFields.length) {
      throw ingressError(
        `Manual supersession observation command has unexpected fields: ${unexpectedFields.join(", ")}`,
        MANUAL_SUPERSESSION_OBSERVATION_REQUEST_INVALID,
      );
    }
    if (!this.store.state || !Array.isArray(this.store.state.candidates)) {
      throw ingressError("store state is unavailable; call store.load() first", "INGRESS_STORE_NOT_LOADED");
    }
    const input = command.candidate;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw ingressError("Manual supersession observation requires a canonical candidate", MANUAL_SUPERSESSION_OBSERVATION_REQUEST_INVALID);
    }
    const { normalized: proposed, errors } = normalizeCanonicalCandidateProposal(input, {
      bundleSource: upper(input.source),
    });
    if (errors.length || !valuesEqual(proposed, input)) {
      throw ingressError(
        `Manual supersession observation candidate is not canonical: ${errors.join("; ") || "canonical content mismatch"}`,
        MANUAL_SUPERSESSION_OBSERVATION_REQUEST_INVALID,
      );
    }
    const proposedContentHash = candidateContractHash(proposed);
    const authorityState = assertManualSupersessionAuthorityState(this.store.state);
    const admitted = this.store.state.candidates.find((candidate) => (
      candidate.candidateId === proposed.candidateId
      && Number(candidate.contractVersion) === proposed.contractVersion
      && candidateContractHash(candidate) === proposedContentHash
    ));
    const matchingReviews = [...authorityState.reviewsById.values()].filter((review) => (
      review.candidateId === proposed.candidateId
      && review.proposedContractVersion === proposed.contractVersion
      && review.proposedContentHash === proposedContentHash
      && valuesEqual(review.proposedCandidate, proposed)
    ));
    if (matchingReviews.length > 1) {
      throw ingressError(
        "Multiple PRETRADE manual supersession reviews match the proposed candidate",
        "CORRUPT_MANUAL_SUPERSESSION_DECISION_STATE",
      );
    }
    const review = matchingReviews[0] ?? null;
    const binding = review ? buildReviewBinding(review) : null;
    const decline = review ? authorityState.declinesByReviewId.get(review.reviewId) : null;
    if (decline) {
      return {
        status: "DECLINED",
        reviewId: review.reviewId,
        declineId: decline.declineId,
        binding,
      };
    }
    if (admitted) {
      assertCanonicalCandidateIntegrity(admitted);
      return {
        status: "ADMITTED",
        candidateId: proposed.candidateId,
        proposedContractVersion: proposed.contractVersion,
        proposedContentHash,
        lifecycleState: canonicalLifecycleState(admitted.lifecycleState),
        stateRevision: normalizeRevision(admitted.stateRevision),
      };
    }
    if (!review) {
      return {
        status: "REVIEW_REQUIRED",
        candidateId: proposed.candidateId,
        proposedContractVersion: proposed.contractVersion,
        proposedContentHash,
      };
    }

    const authorization = [...authorityState.authorizationsById.values()].find((item) => item.reviewId === review.reviewId) ?? null;
    const prior = this.store.state.candidates.find((candidate) => (
      candidate.candidateId === review.candidateId
      && Number(candidate.contractVersion) === review.priorContractVersion
    ));
    try {
      if (!prior) throw ingressError("Prior candidate no longer exists", MANUAL_SUPERSESSION_AUTHORIZATION_INVALID);
      assertManualSupersessionReviewSemantics(review, { prior });
      if (!MANUAL_SUPERSESSION_ALLOWED_STATES.has(candidateLifecycleProjection(prior).lifecycleState)) {
        throw ingressError("Prior candidate is no longer eligible", MANUAL_SUPERSESSION_AUTHORIZATION_INVALID);
      }
    } catch (error) {
      if (error.code !== MANUAL_SUPERSESSION_AUTHORIZATION_INVALID) throw error;
      return {
        status: "INVALIDATED",
        reviewId: review.reviewId,
        binding,
        reasonCode: MANUAL_SUPERSESSION_AUTHORIZATION_INVALID,
      };
    }
    if (!authorization) {
      return { status: "UNRESOLVED", reviewId: review.reviewId, binding };
    }
    if (text(authorization.consumedAt) || text(authorization.consumedByOperationId)) {
      return {
        status: "INVALIDATED",
        reviewId: review.reviewId,
        authorizationId: authorization.authorizationId,
        binding,
        reasonCode: MANUAL_SUPERSESSION_AUTHORIZATION_INVALID,
      };
    }
    return {
      status: "AUTHORIZED",
      reviewId: review.reviewId,
      authorizationId: authorization.authorizationId,
      binding,
    };
  }

  importBundle(bundle, options = {}) {
    if (!bundle || typeof bundle !== "object" || !Array.isArray(bundle.candidates)) {
      throw ingressError("Import bundle must be an object with a candidates array", "INVALID_BUNDLE");
    }
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw ingressError("Candidate import options must be an object", "INVALID_INGRESS_OPTIONS");
    }
    if (!this.store.state || !Array.isArray(this.store.state.candidates)) {
      throw ingressError("store state is unavailable; call store.load() first", "INGRESS_STORE_NOT_LOADED");
    }

    assertNoInboundSupersessionAuthority(bundle, options);
    const unexpectedOptions = Object.keys(options).filter((field) => field !== "ingressPolicy");
    if (unexpectedOptions.length) {
      throw ingressError(
        `Candidate import options have unexpected fields: ${unexpectedOptions.join(", ")}`,
        "INVALID_INGRESS_OPTIONS",
      );
    }
    const authorityState = assertManualSupersessionAuthorityState(this.store.state);
    const { ingressPolicy = null } = options;
    const normalizedIngressPolicy = resolveIngressPolicy(bundle.ingressPolicy, ingressPolicy);
    const stateBeforeMutation = clone(this.store.state);
    const importedAt = this.clock();
    const bundleSource = upper(bundle.source);
    const bundleId = text(bundle.bundleId);
    if (!bundleSource) throw ingressError("canonical candidate bundle source is required", "INVALID_BUNDLE_SOURCE");
    if (!bundleId) throw ingressError("canonical candidate bundleId is required", "INVALID_BUNDLE_ID");

    try {
      const outcomes = bundle.candidates.map((candidate) => this.#importCandidate({
        input: candidate,
        importedAt,
        bundleSource,
        bundleId,
        ingressPolicy: normalizedIngressPolicy,
        authorityState,
      }));

      this.store.state.updatedAt = importedAt;
      if (!Array.isArray(this.store.state.importLog)) this.store.state.importLog = [];
      this.store.state.importLog.push({
        importedAt,
        source: bundleSource,
        bundleId,
        ...(normalizedIngressPolicy ? { ingressPolicy: normalizedIngressPolicy } : {}),
        accepted: outcomes.filter((item) => item.status === "ACCEPTED").length,
        duplicate: outcomes.filter((item) => item.status === "DUPLICATE").length,
        rejected: outcomes.filter((item) => item.status === "REJECTED").length,
        conflict: outcomes.filter((item) => item.status === "CONFLICT").length,
        stale: outcomes.filter((item) => item.status === "STALE").length,
      });

      this.store.save();
      return {
        importedAt,
        ...(normalizedIngressPolicy ? { ingressPolicy: normalizedIngressPolicy } : {}),
        outcomes,
      };
    } catch (error) {
      this.store.state = stateBeforeMutation;
      throw error;
    }
  }

  #importCandidate({
    input,
    importedAt,
    bundleSource,
    bundleId,
    ingressPolicy,
    authorityState,
  }) {
    const { normalized, errors } = normalizeCanonicalCandidateProposal(input, { bundleSource });
    if (errors.length) {
      return {
        candidateId: normalized.candidateId || null,
        contractVersion: Number.isInteger(normalized.contractVersion) ? normalized.contractVersion : null,
        status: "REJECTED",
        reasons: errors,
      };
    }

    const hash = candidateContractHash(normalized);
    const versions = this.store.state.candidates.filter((item) => item.candidateId === normalized.candidateId);
    const sameVersionRaw = versions.find((item) => Number(item.contractVersion) === normalized.contractVersion);

    if (sameVersionRaw) {
      const sameVersion = ensureCandidateAuthorityShape(sameVersionRaw);
      assertCanonicalCandidateIntegrity(sameVersion);
      if (sameVersion.contentHash === hash) {
        return {
          candidateId: normalized.candidateId,
          contractVersion: normalized.contractVersion,
          status: "DUPLICATE",
          reasons: ["same candidateId, contractVersion, and canonical content already imported"],
        };
      }
      return {
        candidateId: normalized.candidateId,
        contractVersion: normalized.contractVersion,
        status: "CONFLICT",
        reasons: ["same candidateId and contractVersion already exist with different canonical content"],
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

    if (ingressPolicy === AUTOMATED_UNTOUCHED_ONLY) {
      if (!versions.length) {
        if (normalized.contractVersion !== 1) {
          return rejectedPolicyOutcome(normalized, AUTOMATED_VERSION_GAP);
        }
      } else {
        if (normalized.contractVersion !== newestVersion + 1) {
          return rejectedPolicyOutcome(normalized, AUTOMATED_VERSION_GAP);
        }

        for (const existingRaw of versions) assertCanonicalCandidateIntegrity(existingRaw);

        const newestRaw = versions.find((item) => Number(item.contractVersion) === newestVersion);
        const newestProjection = candidateLifecycleProjection(newestRaw);
        const activePriorVersions = versions.filter((item) => (
          Number(item.contractVersion) < normalized.contractVersion
          && ACTIVE_PRETRADE_STATES.has(candidateLifecycleProjection(item).lifecycleState)
        ));

        if (
          !newestRaw
          || newestProjection.lifecycleState !== "WAITING"
          || newestProjection.stateRevision !== 0
          || activePriorVersions.length !== 1
          || activePriorVersions[0] !== newestRaw
        ) {
          return rejectedPolicyOutcome(
            normalized,
            AUTOMATED_SUPERSESSION_REQUIRES_UNTOUCHED_WAITING_REVISION_0,
          );
        }
      }
    }

    let manualSupersessionAuthorization = null;
    if (ingressPolicy === MANUAL_AUTHORIZED && versions.length && normalized.contractVersion > newestVersion) {
      if (normalized.contractVersion !== newestVersion + 1) {
        return rejectedPolicyOutcome(normalized, AUTOMATED_VERSION_GAP);
      }
      for (const existingRaw of versions) assertCanonicalCandidateIntegrity(existingRaw);
      const newestRaw = versions.find((item) => Number(item.contractVersion) === newestVersion);
      const activePriorVersions = versions.filter((item) => (
        Number(item.contractVersion) < normalized.contractVersion
        && ACTIVE_PRETRADE_STATES.has(candidateLifecycleProjection(item).lifecycleState)
      ));
      if (activePriorVersions.length !== 1 || activePriorVersions[0] !== newestRaw) {
        return rejectedPolicyOutcome(normalized, MANUAL_SUPERSESSION_AUTHORIZATION_INVALID);
      }
      manualSupersessionAuthorization = findManualSupersessionAuthorization({
        authorizations: this.store.state.manualSupersessionAuthorizations,
        reviewsById: authorityState.reviewsById,
        prior: newestRaw,
        proposed: normalized,
      });
      if (!manualSupersessionAuthorization) {
        return {
          candidateId: normalized.candidateId,
          contractVersion: normalized.contractVersion,
          status: "ACTION_REQUIRED",
          reasons: [MANUAL_SUPERSESSION_AUTHORIZATION_REQUIRED],
        };
      }
      if (manualSupersessionAuthorization.status !== "AUTHORIZED") {
        return rejectedPolicyOutcome(normalized, MANUAL_SUPERSESSION_AUTHORIZATION_INVALID);
      }
    }

    for (const existingRaw of versions) {
      const existing = ensureCandidateAuthorityShape(existingRaw);
      assertCanonicalCandidateIntegrity(existing);
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
          ingressPolicy,
          manualSupersessionAuthorization,
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
        ...(ingressPolicy ? { ingressPolicy } : {}),
      },
      metadata: null,
    };

    const acceptanceOperation = {
      operationId: acceptanceOperationId,
      operationHash: operationHash({
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
      contentHash: hash,
      contractAuthority: buildCanonicalContractAuthority({
        contentHash: hash,
        bundleSource,
        bundleId,
        acceptedAt: importedAt,
      }),
      lifecycleState: "WAITING",
      stateRevision: 0,
      lifecycleJournal: {
        events: [acceptanceEvent],
        operations: [acceptanceOperation],
      },
      importedAt,
      armAuthorized: false,
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
      contentHash: hash,
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
    ingressPolicy,
    manualSupersessionAuthorization,
  }) {
    const beforeState = existing.lifecycleState;
    const beforeRevision = existing.stateRevision;
    const operationId = `INGRESS_SUPERSEDE:${existing.candidateId}:v${existing.contractVersion}->v${supersededByVersion}:${supersedingContentHash}`;

    if (existing.lifecycleJournal.operations.some((item) => item?.operationId === operationId)) return;

    if (manualSupersessionAuthorization?.authorization) {
      const authorization = manualSupersessionAuthorization.authorization;
      assertManualSupersessionAuthorizationRecordIntegrity(authorization);
      const currentBinding = buildReviewBinding({
        candidateId: existing.candidateId,
        priorContractVersion: Number(existing.contractVersion),
        priorLifecycleState: canonicalLifecycleState(existing.lifecycleState),
        priorStateRevision: normalizeRevision(existing.stateRevision),
        priorContentHash: candidateContractHash(existing),
        proposedContractVersion: supersededByVersion,
        proposedContentHash: supersedingContentHash,
      });
      if (
        !sameBinding(authorization, currentBinding)
        || text(authorization.consumedAt)
        || text(authorization.consumedByOperationId)
      ) {
        throw ingressError(
          "Manual supersession authorization is stale, mismatched, or already consumed",
          MANUAL_SUPERSESSION_AUTHORIZATION_INVALID,
        );
      }
    }

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
        ...(ingressPolicy ? { ingressPolicy } : {}),
        ...(manualSupersessionAuthorization ? {
          manualSupersessionAuthorizationId: manualSupersessionAuthorization.authorizationId,
          manualSupersessionReviewId: manualSupersessionAuthorization.reviewId,
        } : {}),
      },
      metadata: null,
    };

    existing.lifecycleJournal.events.push(event);
    existing.lifecycleJournal.operations.push({
      operationId,
      operationHash: operationHash({
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
    if (manualSupersessionAuthorization?.authorization) {
      manualSupersessionAuthorization.authorization.consumedByOperationId = operationId;
      manualSupersessionAuthorization.authorization.consumedAt = importedAt;
      manualSupersessionAuthorization.authorization.authorizationIntegrityHash =
        manualSupersessionAuthorizationIntegrityHash(manualSupersessionAuthorization.authorization);
      assertManualSupersessionAuthorizationRecordIntegrity(manualSupersessionAuthorization.authorization);
    }
  }
}
