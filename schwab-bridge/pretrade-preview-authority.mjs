import crypto from "node:crypto";
import { canonicalJson } from "./canonical-json.mjs";
import { candidateContractHash, normalizeCanonicalCandidateProposal } from "./pretrade-candidate-contract.mjs";
import { AUTOMATED_UNTOUCHED_ONLY } from "./pretrade-candidate-ingress.mjs";
import { assessQuoteEvidence, CURRENT_LIVE_QUOTE_EVIDENCE_POLICY, freshness, timestampIso, timestampMs } from "./clock-freshness.mjs";
import { isOperatorReviewedImportPolicy, OPERATOR_REVIEWED_IMPORT_SCOPE, previewPolicyMode } from "./pretrade-preview-policy.mjs";
import {
  parsePreTradeProviderHandoff,
  preTradeProviderHandoffEnvelopeHash,
  verifyPreTradeProviderHandoffSignature,
} from "./pretrade-provider-handoff.mjs";
import {
  contentHash,
  pretradeProviderMessageIntegrityHash,
  pretradeProviderRunIntegrityHash,
  pretradePreviewBindingHash,
  pretradePreviewProposal,
  pretradePreviewProposalHash,
  pretradePreviewOperationIntegrityHash,
  pretradePreviewReceiptHash,
} from "./pretrade-state.mjs";

export const PRETRADE_PREVIEW_SCHEMA_VERSION = 1;
export const PRETRADE_PREVIEW_FEATURE_DISABLED = "PRETRADE_PREVIEW_FEATURE_DISABLED";

const TERMINAL_RECEIPT_RESULTS = new Set(["ADMITTED", "ALREADY_PRESENT", "NOT_ADMITTED"]);
const TERMINAL_PREVIEW_STATES = new Set(["ADMITTED", "ALREADY_PRESENT", "NOT_ADMITTED", "DISCARDED", "RETIRED"]);
const AUTHENTICATED_HANDOFF_REGISTRATION = Symbol("AUTHENTICATED_HANDOFF_REGISTRATION");
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_256_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function text(value) {
  return String(value ?? "").trim();
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalJson(value))).digest("hex");
}

function immutable(value) {
  const clone = structuredClone(value);
  const freeze = (item) => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return item;
    for (const child of Object.values(item)) freeze(child);
    return Object.freeze(item);
  };
  return freeze(clone);
}

function previewError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function providerRunProjection(record) {
  return immutable({
    challengeId: record.challengeId,
    challengeNonce: record.challengeNonce,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    bootGeneration: record.bootGeneration,
    draftId: record.draftId,
    inputRevision: record.inputRevision,
    runId: record.runId,
    inputManifestHash: record.inputManifestHash,
    retirementRevision: record.retirementRevision,
    accountScopeId: record.accountScopeId,
    accountSelectionRevision: record.accountSelectionRevision,
    status: record.status,
  });
}

function relevantStateFingerprint(state, bundle) {
  const candidateIds = new Set((bundle?.candidates || []).map((candidate) => text(candidate?.candidateId)).filter(Boolean));
  return digest({
    candidates: (state.candidates || [])
      .filter((candidate) => candidateIds.has(text(candidate.candidateId)))
      .map((candidate) => ({
        candidateId: candidate.candidateId,
        contractVersion: candidate.contractVersion,
        contentHash: candidateContractHash(candidate),
        lifecycleState: candidate.lifecycleState,
        stateRevision: candidate.stateRevision,
      })),
    manualSupersessionAuthorizations: (state.manualSupersessionAuthorizations || [])
      .filter((record) => candidateIds.has(text(record.candidateId)))
      .map((record) => ({
        authorizationId: record.authorizationId,
        consumedAt: record.consumedAt,
        consumedByOperationId: record.consumedByOperationId,
      })),
  });
}

function candidateProjection(state, outcome) {
  const candidate = (state.candidates || []).find((item) => (
    text(item.candidateId) === text(outcome?.candidateId)
    && Number(item.contractVersion) === Number(outcome?.contractVersion)
  ));
  return candidate ? {
    candidateId: candidate.candidateId,
    contractVersion: candidate.contractVersion,
    contentHash: candidate.contentHash,
    lifecycleState: candidate.lifecycleState,
    stateRevision: candidate.stateRevision,
    observedAt: new Date().toISOString(),
  } : null;
}

function projectedPreview(record) {
  if (!record) return null;
  return immutable({
    previewId: record.previewId,
    revision: record.revision,
    operationId: record.operationId,
    proposalHash: record.proposalHash,
    state: record.state,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revalidationRequired: Boolean(record.revalidationRequired),
    accountScope: record.accountScope,
    candidateIdentity: record.candidateIdentity,
    proposal: record.proposal,
    preflight: record.preflight,
    policy: record.policy,
    reviewScope: isOperatorReviewedImportPolicy(record.policy) ? OPERATOR_REVIEWED_IMPORT_SCOPE : null,
  });
}

function projectedReceipt(record) {
  if (!record) return null;
  return immutable({
    receiptId: record.receiptId,
    operationId: record.operationId,
    previewId: record.previewId,
    previewRevision: record.previewRevision,
    result: record.result,
    reason: record.reason,
    requestedAt: record.requestedAt,
    finishedAt: record.finishedAt,
    commitTransactionId: record.commitTransactionId,
    commitRevision: record.commitRevision,
    candidate: record.candidate,
    canonicalAdmission: record.canonicalAdmission,
    ...(record.reviewScope ? { reviewScope: record.reviewScope } : {}),
  });
}

export class PreTradePreviewAuthority {
  constructor({
    store,
    candidateIngress,
    enabled = false,
    policy = null,
    evidenceProvider = null,
    evidenceValidator = null,
    clock = () => new Date().toISOString(),
    idFactory = () => crypto.randomUUID(),
    maxPreviews = 500,
    maxBytes = 16 * 1024 * 1024,
    allowLegacyTestPolicy = false,
    providerHandoff = null,
    requireAuthenticatedRegistration = allowLegacyTestPolicy !== true,
  } = {}) {
    if (!store || typeof store.transaction !== "function" || typeof store.snapshot !== "function") {
      throw new Error("PreTradePreviewAuthority requires a transactional PRETRADE store");
    }
    if (
      !candidateIngress
      || typeof candidateIngress.planBundle !== "function"
      || typeof candidateIngress.planBundleForPreviewRegistration !== "function"
      || typeof candidateIngress.planBundleForPreviewAcceptance !== "function"
    ) {
      throw new Error("PreTradePreviewAuthority requires the shared candidate ingress planner");
    }
    this.store = store;
    this.candidateIngress = candidateIngress;
    this.enabled = enabled === true;
    this.policy = policy ? immutable(policy) : null;
    this.evidenceProvider = evidenceProvider;
    this.evidenceValidator = evidenceValidator;
    this.clock = clock;
    this.idFactory = idFactory;
    this.maxPreviews = maxPreviews;
    this.maxBytes = maxBytes;
    this.allowLegacyTestPolicy = allowLegacyTestPolicy === true;
    this.providerHandoff = providerHandoff;
    this.requireAuthenticatedRegistration = requireAuthenticatedRegistration === true;
    this.processGeneration = crypto.randomUUID();
  }

  readiness() {
    const state = this.store.snapshot();
    const profileMode = previewPolicyMode(this.policy, this);
    const policySafeguardsValid = Boolean(text(this.policy?.policyId))
      && Number.isInteger(Number(this.policy?.policyVersion)) && Number(this.policy.policyVersion) > 0
      && contentHash(this.policy?.quoteEvidencePolicy ?? null) === contentHash(CURRENT_LIVE_QUOTE_EVIDENCE_POLICY)
      && this.policy?.accountMaxAgeMs === 15_000;
    const providerHandoffConfigured = this.#providerHandoffConfigured();
    return immutable({
      enabled: this.enabled
        && policySafeguardsValid
        && profileMode !== null
        && typeof this.evidenceProvider === "function"
        && typeof this.evidenceValidator === "function"
        && (!this.requireAuthenticatedRegistration || providerHandoffConfigured)
        && this.store.lockFd !== null
        && this.store.filesystemDurabilityValidated === true
        && !this.store.fenced,
      featureConfigured: Boolean(this.policy),
      policySafeguardsValid,
      profileSupported: profileMode !== null,
      profileId: this.policy?.profileId ?? null,
      evidenceProviderConfigured: typeof this.evidenceProvider === "function",
      evidenceValidatorConfigured: typeof this.evidenceValidator === "function",
      authenticatedRegistrationRequired: this.requireAuthenticatedRegistration,
      providerHandoffConfigured,
      writerLockHeld: this.store.lockFd !== null,
      filesystemDurabilityValidated: this.store.filesystemDurabilityValidated === true,
      writerFenced: Boolean(this.store.fenced),
      outcomeLookupAvailable: state.pretradePreviewOperations.length > 0,
      chartCardAgeThresholdConfigured: false,
    });
  }

  create({
    bundle,
    ingressPolicy,
    draftId,
    inputRevision,
    runId,
    accountScope,
    chartByteHashes = [],
    provenance = null,
    sourceTimes = null,
    evidenceIds = [],
    fixedProposalReferences = null,
    expiresAt = null,
  } = {}, options = {}) {
    this.#assertEnabled();
    if (this.requireAuthenticatedRegistration && options?.capability !== AUTHENTICATED_HANDOFF_REGISTRATION) {
      throw previewError(
        "preview registration requires an authenticated provider handoff",
        "PRETRADE_PROVIDER_HANDOFF_REQUIRED",
      );
    }
    if (!bundle || typeof bundle !== "object" || !Array.isArray(bundle.candidates) || bundle.candidates.length !== 1) {
      throw previewError("preview requires one canonical candidate bundle", "INVALID_PREVIEW_BUNDLE");
    }
    if (!text(draftId) || !Number.isInteger(Number(inputRevision)) || Number(inputRevision) < 0 || !text(runId)) {
      throw previewError("draftId, inputRevision and runId are required", "INVALID_PREVIEW_IDENTITY");
    }
    if (!text(accountScope)) throw previewError("accountScope is required", "INVALID_PREVIEW_ACCOUNT_SCOPE");
    const now = this.#time();
    const normalizedExpiry = expiresAt === null ? null : timestampIso(expiresAt);
    if (expiresAt !== null && !normalizedExpiry) throw previewError("expiresAt is invalid", "INVALID_PREVIEW_EXPIRY");
    if (isOperatorReviewedImportPolicy(this.policy) && expiresAt !== null) {
      throw previewError("operator-reviewed import uses canonical validity only", "PREVIEW_ADDITIONAL_EXPIRY_FORBIDDEN");
    }
    const previewId = text(this.idFactory());
    const operationId = text(this.idFactory());
    if (!previewId || !operationId || previewId === operationId) throw previewError("preview id allocation failed", "PREVIEW_ID_ALLOCATION_FAILED");
    const proposalHash = pretradePreviewProposalHash(bundle);
    const input = this.store.snapshot();
    const unresolved = input.pretradePreviewOperations.find((item) => (
      item.proposalHash === proposalHash && ["UNSTARTED", "ACCEPTING"].includes(item.state)
    ));
    if (unresolved) {
      throw previewError("proposal already has an unresolved preview operation", "PREVIEW_PROPOSAL_UNRESOLVED", {
        previewId: unresolved.previewId,
        operationId: unresolved.operationId,
      });
    }
    const planned = this.candidateIngress.planBundleForPreviewRegistration(bundle, { ingressPolicy }, { state: input, importedAt: now });
    const stateFingerprint = relevantStateFingerprint(input, bundle);
    const candidate = bundle.candidates[0];
    const proposal = pretradePreviewProposal(bundle);
    const candidateIdentity = {
      candidateId: text(candidate.candidateId),
      contractVersion: Number(candidate.contractVersion),
      contentHash: candidateContractHash(candidate),
    };
    const record = {
      schemaVersion: PRETRADE_PREVIEW_SCHEMA_VERSION,
      previewId,
      revision: 1,
      storeEpoch: input.storeEpoch,
      inputStoreRevision: input.storeRevision,
      draftId,
      inputRevision: Number(inputRevision),
      runId,
      priorBindingHash: null,
      proposalHash,
      bindingHash: null,
      candidateIdentity,
      proposal,
      chartByteHashes: structuredClone(chartByteHashes),
      provenance: structuredClone(provenance),
      sourceTimes: structuredClone(sourceTimes),
      evidenceIds: structuredClone(evidenceIds),
      fixedProposalReferences: structuredClone(fixedProposalReferences),
      policy: structuredClone(this.policy),
      accountScope: text(accountScope) || null,
      ingressPolicy: text(ingressPolicy),
      bundle: structuredClone(bundle),
      preflight: structuredClone(planned.result),
      stateFingerprint,
      operationId,
      state: "PREVIEW_READY",
      createdAt: now,
      expiresAt: normalizedExpiry,
      revalidationRequired: false,
      processGeneration: this.processGeneration,
    };
    record.bindingHash = pretradePreviewBindingHash(record);
    const operation = {
      schemaVersion: 1,
      operationId,
      previewId,
      previewRevision: 1,
      bindingHash: record.bindingHash,
      proposalHash,
      accountScope: record.accountScope,
      state: "UNSTARTED",
      requestedAt: null,
      finishedAt: null,
      processGeneration: this.processGeneration,
      receiptId: null,
      integrityHash: null,
    };
    this.#sealOperation(record, operation);
    this.store.transaction((draft) => {
      const unresolved = draft.pretradePreviewOperations.find((item) => (
        item.proposalHash === proposalHash && ["UNSTARTED", "ACCEPTING"].includes(item.state)
      ));
      if (unresolved) {
        throw previewError("proposal already has an unresolved preview operation", "PREVIEW_PROPOSAL_UNRESOLVED", {
          previewId: unresolved.previewId,
          operationId: unresolved.operationId,
        });
      }
      this.#assertCapacity(draft, record, operation);
      draft.pretradePreviews.push(record);
      draft.pretradePreviewOperations.push(operation);
      if (options?.capability === AUTHENTICATED_HANDOFF_REGISTRATION) {
        if (typeof options.atomicMutation !== "function") {
          throw previewError("authenticated registration mutation is required", "PRETRADE_PROVIDER_HANDOFF_REGISTRATION_INVALID");
        }
        options.atomicMutation(draft, record, operation, now);
      } else if (options?.atomicMutation !== undefined || options?.capability !== undefined) {
        throw previewError("preview registration capability is invalid", "PRETRADE_PROVIDER_HANDOFF_REGISTRATION_INVALID");
      }
      draft.updatedAt = now;
    });
    return projectedPreview(record);
  }

  issueProviderChallenge({
    draftId,
    inputRevision,
    runId,
    inputManifestHash,
    retirementRevision = 0,
    accountScopeId,
    accountSelectionRevision,
  } = {}) {
    this.#assertEnabled();
    this.#assertProviderHandoffConfigured();
    if (
      !text(draftId)
      || !Number.isSafeInteger(Number(inputRevision))
      || Number(inputRevision) < 0
      || !text(runId)
      || !HASH_PATTERN.test(text(inputManifestHash))
      || !Number.isSafeInteger(Number(retirementRevision))
      || Number(retirementRevision) < 0
      || !text(accountScopeId)
      || !text(accountSelectionRevision)
    ) {
      throw previewError("provider run identity is invalid", "PRETRADE_PROVIDER_RUN_INVALID");
    }
    this.#assertCurrentAccountSelection(accountScopeId, accountSelectionRevision);
    const issuedAt = this.#time();
    const ttlMs = Number(this.providerHandoff.challengeTtlMs ?? 60_000);
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 10 * 60_000) {
      throw previewError("provider challenge TTL is invalid", "PRETRADE_PROVIDER_HANDOFF_CONFIGURATION_INVALID");
    }
    const challengeId = text((this.providerHandoff.challengeIdFactory || (() => crypto.randomUUID()))());
    const challengeNonce = text((this.providerHandoff.nonceFactory || (() => crypto.randomBytes(32).toString("base64url")))());
    const challengeNonceBytes = Buffer.from(challengeNonce, "base64url");
    if (
      !UUID_PATTERN.test(challengeId)
      || !BASE64URL_256_PATTERN.test(challengeNonce)
      || challengeNonceBytes.length !== 32
      || challengeNonceBytes.toString("base64url") !== challengeNonce
    ) {
      throw previewError("provider challenge allocation failed", "PRETRADE_PROVIDER_CHALLENGE_ALLOCATION_FAILED");
    }
    const record = {
      schemaVersion: 1,
      storeEpoch: this.store.snapshot().storeEpoch,
      challengeId,
      challengeNonce,
      issuedAt,
      expiresAt: new Date(timestampMs(issuedAt) + ttlMs).toISOString(),
      bootGeneration: this.processGeneration,
      draftId: text(draftId),
      inputRevision: Number(inputRevision),
      runId: text(runId),
      inputManifestHash: text(inputManifestHash),
      retirementRevision: Number(retirementRevision),
      accountScopeId: text(accountScopeId),
      accountSelectionRevision: text(accountSelectionRevision),
      policyHash: contentHash(this.policy),
      status: "ACTIVE",
      messageId: null,
      envelopeHash: null,
      providerResponseId: null,
      previewId: null,
      operationId: null,
      finishedAt: null,
      reasonCode: null,
      integrityHash: null,
    };
    record.integrityHash = pretradeProviderRunIntegrityHash(record);
    this.store.transaction((draft) => {
      const duplicate = draft.pretradeProviderRuns.find((item) => (
        text(item.draftId) === record.draftId
        && Number(item.inputRevision) === record.inputRevision
        && text(item.runId) === record.runId
      ));
      if (duplicate) {
        throw previewError("provider run already has a durable challenge", "PRETRADE_PROVIDER_RUN_CONFLICT", {
          challengeId: duplicate.challengeId,
        });
      }
      this.#assertProviderLedgerCapacity(draft, record, null);
      draft.pretradeProviderRuns.push(record);
      draft.updatedAt = issuedAt;
    });
    return providerRunProjection(record);
  }

  retireProviderRun({ draftId, inputRevision, runId, retirementRevision, reasonCode = "INPUT_RETIRED" } = {}) {
    this.#assertProviderHandoffConfigured();
    const retiredAt = this.#time();
    return this.store.transaction((draft) => {
      const run = draft.pretradeProviderRuns.find((item) => (
        text(item.draftId) === text(draftId)
        && Number(item.inputRevision) === Number(inputRevision)
        && text(item.runId) === text(runId)
      ));
      if (!run) throw previewError("provider run is unavailable", "PRETRADE_PROVIDER_RUN_UNAVAILABLE");
      if (run.status === "REGISTERED") {
        throw previewError("registered preview must use its discard lifecycle", "PRETRADE_PROVIDER_RUN_ALREADY_REGISTERED", {
          previewId: run.previewId,
          operationId: run.operationId,
        });
      }
      if (!Number.isSafeInteger(Number(retirementRevision)) || Number(retirementRevision) <= Number(run.retirementRevision)) {
        throw previewError("retirement revision must advance", "PRETRADE_PROVIDER_RETIREMENT_REVISION_INVALID");
      }
      run.status = "RETIRED";
      run.retirementRevision = Number(retirementRevision);
      run.finishedAt = retiredAt;
      run.reasonCode = text(reasonCode) || "INPUT_RETIRED";
      const message = draft.pretradeProviderMessages.find((item) => item.challengeId === run.challengeId);
      if (message?.status === "VERIFYING") {
        message.status = "INTERRUPTED";
        message.finishedAt = retiredAt;
        message.reasonCode = "INPUT_RETIRED";
        message.integrityHash = pretradeProviderMessageIntegrityHash(message);
      }
      run.integrityHash = pretradeProviderRunIntegrityHash(run);
      draft.updatedAt = retiredAt;
      return providerRunProjection(run);
    });
  }

  async registerProviderHandoff(input) {
    this.#assertEnabled();
    this.#assertProviderHandoffConfigured();
    const parsed = parsePreTradeProviderHandoff(input, {
      maxBytes: Number(this.providerHandoff.maxEnvelopeBytes ?? 2 * 1024 * 1024),
    });
    const { envelope, bytes } = parsed;
    const issuer = this.#issuer(envelope.issuerId, envelope.keyId);
    verifyPreTradeProviderHandoffSignature(envelope, issuer.publicKey);
    this.#assertProviderEnvelopeConfiguration(envelope, issuer);
    const envelopeHash = preTradeProviderHandoffEnvelopeHash(bytes);
    const replayKey = contentHash({
      issuerId: envelope.issuerId,
      storeEpoch: envelope.storeEpoch,
      runId: envelope.run.runId,
      inputRevision: envelope.run.inputRevision,
      providerResponseId: envelope.provider.responseId,
    });
    const reservedAt = this.#time();
    const reservation = this.store.transaction((draft) => {
      const existingByReplay = draft.pretradeProviderMessages.find((item) => item.replayKey === replayKey);
      const existingByMessage = draft.pretradeProviderMessages.find((item) => item.messageId === envelope.messageId);
      const existing = existingByReplay || existingByMessage;
      if (existing) {
        if (existing.envelopeHash !== envelopeHash || existing.replayKey !== replayKey) {
          throw previewError("provider response replay changed signed bytes", "PRETRADE_PROVIDER_REPLAY_CONFLICT", {
            operationId: existing.operationId || null,
          });
        }
        if (existing.status === "REGISTERED") return { replay: true, previewId: existing.previewId };
        if (existing.status === "VERIFYING") {
          throw previewError("provider registration is already being verified", "PRETRADE_PROVIDER_REGISTRATION_IN_PROGRESS");
        }
        throw previewError("provider response is already terminal", existing.reasonCode || "PRETRADE_PROVIDER_REGISTRATION_UNAVAILABLE");
      }
      const run = draft.pretradeProviderRuns.find((item) => item.challengeId === envelope.challenge.challengeId);
      this.#assertEnvelopeRunBinding(envelope, run, draft, reservedAt);
      const message = {
        schemaVersion: 1,
        messageId: envelope.messageId,
        replayKey,
        envelopeHash,
        issuerId: envelope.issuerId,
        keyId: envelope.keyId,
        providerResponseId: envelope.provider.responseId,
        challengeId: run.challengeId,
        draftId: run.draftId,
        inputRevision: run.inputRevision,
        runId: run.runId,
        status: "VERIFYING",
        reservedAt,
        finishedAt: null,
        reasonCode: null,
        previewId: null,
        operationId: null,
        integrityHash: null,
      };
      run.status = "VERIFYING";
      run.messageId = message.messageId;
      run.envelopeHash = envelopeHash;
      run.providerResponseId = message.providerResponseId;
      run.integrityHash = pretradeProviderRunIntegrityHash(run);
      message.integrityHash = pretradeProviderMessageIntegrityHash(message);
      this.#assertProviderLedgerCapacity(draft, null, message);
      draft.pretradeProviderMessages.push(message);
      draft.updatedAt = reservedAt;
      return { replay: false, messageId: message.messageId, challengeId: run.challengeId };
    });
    if (reservation.replay) return this.status(reservation.previewId);

    try {
      const verified = await this.#verifyProviderEnvelopeBytes(envelope);
      const preview = this.create({
        bundle: envelope.output.bundle,
        ingressPolicy: this.providerHandoff.ingressPolicy || AUTOMATED_UNTOUCHED_ONLY,
        draftId: envelope.run.draftId,
        inputRevision: envelope.run.inputRevision,
        runId: envelope.run.runId,
        accountScope: envelope.run.accountScopeId,
        chartByteHashes: verified.chartByteHashes,
        provenance: verified.provenance,
        sourceTimes: verified.sourceTimes,
        evidenceIds: envelope.evidence.map((record) => record.evidenceId),
        fixedProposalReferences: envelope.output.fixedProposalReferences,
        expiresAt: null,
      }, {
        capability: AUTHENTICATED_HANDOFF_REGISTRATION,
        atomicMutation: (draft, previewRecord, operation, finishedAt) => {
          const run = draft.pretradeProviderRuns.find((item) => item.challengeId === reservation.challengeId);
          const message = draft.pretradeProviderMessages.find((item) => item.messageId === reservation.messageId);
          this.#assertEnvelopeRunBinding(envelope, run, draft, finishedAt, { requireVerifying: true });
          if (!message || message.status !== "VERIFYING" || message.envelopeHash !== envelopeHash) {
            throw previewError("provider registration continuation is no longer authoritative", "PRETRADE_PROVIDER_CONTINUATION_INVALID");
          }
          run.status = "REGISTERED";
          run.previewId = previewRecord.previewId;
          run.operationId = operation.operationId;
          run.finishedAt = finishedAt;
          run.reasonCode = null;
          message.status = "REGISTERED";
          message.previewId = previewRecord.previewId;
          message.operationId = operation.operationId;
          message.finishedAt = finishedAt;
          message.reasonCode = null;
          run.integrityHash = pretradeProviderRunIntegrityHash(run);
          message.integrityHash = pretradeProviderMessageIntegrityHash(message);
        },
      });
      return this.status(preview.previewId);
    } catch (error) {
      this.#rejectProviderRegistration(reservation, error?.code || "PRETRADE_PROVIDER_REGISTRATION_FAILED");
      throw error;
    }
  }

  status(previewId) {
    if (this.store.fenced) throw previewError("PRETRADE requires recovery before outcome projection", "PRETRADE_RECOVERY_REQUIRED");
    const state = this.store.snapshot();
    const preview = state.pretradePreviews.find((item) => item.previewId === text(previewId));
    if (!preview) throw previewError("preview is unavailable", "PREVIEW_UNAVAILABLE");
    const operation = state.pretradePreviewOperations.find((item) => item.operationId === preview.operationId) ?? null;
    const receipt = state.pretradePreviewReceipts.find((item) => item.operationId === preview.operationId) ?? null;
    return immutable({
      preview: projectedPreview(preview),
      operation: operation ? {
        operationId: operation.operationId,
        state: operation.state,
        requestedAt: operation.requestedAt,
        finishedAt: operation.finishedAt,
      } : null,
      receipt: projectedReceipt(receipt),
      lifecycle: receipt ? candidateProjection(state, receipt.candidate) : null,
    });
  }

  list() {
    if (this.store.fenced) throw previewError("PRETRADE requires recovery before outcome projection", "PRETRADE_RECOVERY_REQUIRED");
    const state = this.store.snapshot();
    return immutable(state.pretradePreviews.map((preview) => {
      const operation = state.pretradePreviewOperations.find((item) => item.operationId === preview.operationId) ?? null;
      const receipt = state.pretradePreviewReceipts.find((item) => item.operationId === preview.operationId) ?? null;
      return {
        preview: projectedPreview(preview),
        operation: operation ? {
          operationId: operation.operationId,
          state: operation.state,
          requestedAt: operation.requestedAt,
          finishedAt: operation.finishedAt,
        } : null,
        receipt: projectedReceipt(receipt),
        lifecycle: receipt ? candidateProjection(state, receipt.candidate) : null,
      };
    }));
  }

  discard({ previewId, operationId } = {}) {
    const now = this.#time();
    return this.store.transaction((draft) => {
      const preview = this.#preview(draft, previewId);
      const operation = this.#operation(draft, operationId || preview.operationId);
      this.#assertBound(preview, operation);
      const receipt = draft.pretradePreviewReceipts.find((item) => item.operationId === operation.operationId);
      if (receipt) return { status: "RECEIPT_COMMITTED", receipt: projectedReceipt(receipt) };
      if (operation.state === "ACCEPTING") return { status: "ACCEPTANCE_IN_PROGRESS", operationId: operation.operationId };
      if (preview.state === "DISCARDED") return { status: "DISCARDED", previewId: preview.previewId };
      if (TERMINAL_PREVIEW_STATES.has(preview.state)) return { status: preview.state, previewId: preview.previewId };
      preview.state = "DISCARDED";
      preview.discardedAt = now;
      operation.state = "DISCARDED";
      operation.finishedAt = now;
      this.#sealOperation(preview, operation);
      draft.updatedAt = now;
      return { status: "DISCARDED", previewId: preview.previewId };
    });
  }

  async refresh({ previewId, operationId } = {}) {
    this.#assertEnabled();
    const state = this.store.snapshot();
    const current = this.#preview(state, previewId);
    const currentOperation = this.#operation(state, operationId || current.operationId);
    this.#assertBound(current, currentOperation);
    if (currentOperation.state === "ACCEPTING" || TERMINAL_PREVIEW_STATES.has(current.state)) {
      throw previewError("preview cannot refresh while acceptance is unresolved or terminal", "PREVIEW_REFRESH_CONFLICT");
    }
    const now = this.#time();
    if (current.expiresAt && timestampMs(now) >= timestampMs(current.expiresAt)) {
      throw previewError("fixed preview review window expired", "PREVIEW_EXPIRED");
    }
    const generation = this.processGeneration;
    const evidence = await this.evidenceProvider({ mode: "REFRESH", preview: immutable(current), operation: immutable(currentOperation) });
    const nextPreviewId = text(this.idFactory());
    const nextOperationId = text(this.idFactory());
    if (!nextPreviewId || !nextOperationId || nextPreviewId === nextOperationId) {
      throw previewError("preview refresh id allocation failed", "PREVIEW_ID_ALLOCATION_FAILED");
    }
    const refreshedAt = this.#time();
    return this.store.transaction((draft) => {
      const preview = this.#preview(draft, previewId);
      const operation = this.#operation(draft, currentOperation.operationId);
      this.#assertBound(preview, operation);
      if (generation !== this.processGeneration || preview.processGeneration !== current.processGeneration) {
        throw previewError("refresh continuation is no longer authoritative", "PREVIEW_CONTINUATION_INVALID");
      }
      if (!["UNSTARTED"].includes(operation.state)) {
        throw previewError("preview changed while refresh evidence was obtained", "PREVIEW_REFRESH_CONFLICT");
      }
      if (preview.expiresAt && timestampMs(refreshedAt) >= timestampMs(preview.expiresAt)) {
        throw previewError("fixed preview review window expired", "PREVIEW_EXPIRED");
      }
      if (relevantStateFingerprint(draft, preview.bundle) !== preview.stateFingerprint) {
        throw previewError("relevant state changed; a new explicit review is required", "PREVIEW_REVALIDATION_REQUIRED");
      }
      this.#assertEnabled();
      const refreshAssessment = this.#assessEvidence(evidence, preview, refreshedAt, draft);
      if (!refreshAssessment.valid) throw previewError("refreshed evidence is invalid", "PREVIEW_REFRESH_EVIDENCE_INVALID", refreshAssessment);
      const revision = Number(preview.revision) + 1;
      preview.state = "RETIRED";
      preview.retiredAt = refreshedAt;
      operation.state = "RETIRED";
      operation.finishedAt = refreshedAt;
      this.#sealOperation(preview, operation);
      const replacement = {
        ...structuredClone(preview),
        previewId: nextPreviewId,
        revision,
        priorBindingHash: preview.bindingHash,
        bindingHash: null,
        operationId: nextOperationId,
        state: "PREVIEW_READY",
        createdAt: refreshedAt,
        retiredAt: null,
        finishedAt: null,
        revalidationRequired: false,
        processGeneration: this.processGeneration,
        evidenceIds: [...preview.evidenceIds, ...(evidence.evidenceId ? [evidence.evidenceId] : [])],
        refreshedEvidence: structuredClone(evidence),
      };
      replacement.bindingHash = pretradePreviewBindingHash(replacement);
      const replacementOperation = {
        schemaVersion: 1,
        operationId: nextOperationId,
        previewId: nextPreviewId,
        previewRevision: revision,
        bindingHash: replacement.bindingHash,
        proposalHash: preview.proposalHash,
        accountScope: preview.accountScope,
        state: "UNSTARTED",
        requestedAt: null,
        finishedAt: null,
        processGeneration: this.processGeneration,
        receiptId: null,
        integrityHash: null,
      };
      this.#sealOperation(replacement, replacementOperation);
      this.#assertCapacity(draft, replacement, replacementOperation);
      draft.pretradePreviews.push(replacement);
      draft.pretradePreviewOperations.push(replacementOperation);
      draft.updatedAt = refreshedAt;
      return projectedPreview(replacement);
    });
  }

  async accept({ previewId, operationId, proposalHash, accountScope } = {}) {
    const existing = this.#terminalByOperation(operationId);
    if (existing) {
      const state = this.store.snapshot();
      const preview = this.#preview(state, previewId);
      const operation = this.#operation(state, operationId);
      this.#assertBound(preview, operation);
      if (text(proposalHash) !== preview.proposalHash || text(accountScope) !== text(preview.accountScope)) {
        throw previewError("accept intent does not match committed operation", "PREVIEW_ACCEPT_CONFLICT");
      }
      return existing;
    }
    this.#assertEnabled();
    const reservedAt = this.#time();
    const generation = this.processGeneration;
    const reservation = this.store.transaction((draft) => {
      const preview = this.#preview(draft, previewId);
      const operation = this.#operation(draft, operationId);
      this.#assertBound(preview, operation);
      if (text(proposalHash) !== preview.proposalHash || text(accountScope) !== text(preview.accountScope)) {
        throw previewError("accept intent does not match preview binding", "PREVIEW_ACCEPT_CONFLICT");
      }
      if (operation.state === "ACCEPTING") return { duplicate: true, preview: projectedPreview(preview), operation: structuredClone(operation) };
      if (preview.state === "DISCARDED" || operation.state === "DISCARDED") {
        throw previewError("discarded preview cannot be accepted", "PREVIEW_DISCARDED");
      }
      if (preview.state !== "PREVIEW_READY" || operation.state !== "UNSTARTED") {
        throw previewError("preview revision is no longer eligible", "PREVIEW_REVALIDATION_REQUIRED");
      }
      if (preview.revalidationRequired) throw previewError("preview requires a new review after restart", "PREVIEW_REVALIDATION_REQUIRED");
      if (preview.expiresAt && timestampMs(reservedAt) >= timestampMs(preview.expiresAt)) {
        throw previewError("preview expired", "PREVIEW_EXPIRED");
      }
      operation.state = "ACCEPTING";
      operation.requestedAt = reservedAt;
      operation.processGeneration = generation;
      preview.state = "ACCEPTING";
      this.#sealOperation(preview, operation);
      draft.updatedAt = reservedAt;
      return { duplicate: false, preview: structuredClone(preview), operation: structuredClone(operation) };
    });
    if (reservation.duplicate) return this.status(previewId);

    let evidence;
    try {
      evidence = await this.evidenceProvider({
        preview: immutable(reservation.preview),
        operation: immutable(reservation.operation),
      });
    } catch (error) {
      return this.#finishNotAdmitted(reservation, "EVIDENCE_UNAVAILABLE", error?.message || null);
    }

    const finishedAt = this.#time();
    try {
      const commitTransactionId = crypto.randomUUID();
      return this.store.transaction((draft) => {
        const preview = this.#preview(draft, previewId);
        const operation = this.#operation(draft, operationId);
        this.#assertBound(preview, operation);
        const existingReceipt = draft.pretradePreviewReceipts.find((item) => item.operationId === operationId);
        if (existingReceipt) return projectedReceipt(existingReceipt);
        if (operation.state !== "ACCEPTING" || operation.processGeneration !== generation || generation !== this.processGeneration) {
          throw previewError("acceptance continuation is no longer authoritative", "PREVIEW_CONTINUATION_INVALID");
        }
        if (!this.readiness().enabled) {
          return this.#recordReceipt(draft, preview, operation, {
            result: "NOT_ADMITTED", reason: "PREVIEW_READINESS_CHANGED", finishedAt, evidence: null, commitTransactionId,
          });
        }
        if (preview.expiresAt && timestampMs(finishedAt) >= timestampMs(preview.expiresAt)) {
          return this.#recordReceipt(draft, preview, operation, {
            result: "NOT_ADMITTED", reason: "PREVIEW_EXPIRED", finishedAt, evidence, commitTransactionId,
          });
        }
        const evidenceAssessment = this.#assessEvidence(evidence, preview, finishedAt, draft);
        if (!evidenceAssessment.valid) {
          return this.#recordReceipt(draft, preview, operation, {
            result: "NOT_ADMITTED",
            reason: evidenceAssessment.reasonCode,
            finishedAt,
            evidence,
            commitTransactionId,
          });
        }
        const planned = this.candidateIngress.planBundleForPreviewAcceptance(
          preview.bundle,
          { ingressPolicy: preview.ingressPolicy },
          { state: draft, importedAt: finishedAt, previewOperationId: operation.operationId },
        );
        const outcome = planned.result.outcomes[0];
        if (
          relevantStateFingerprint(draft, preview.bundle) !== preview.stateFingerprint
          && outcome.status !== "DUPLICATE"
        ) {
          return this.#recordReceipt(draft, preview, operation, {
            result: "NOT_ADMITTED", reason: "RELEVANT_STATE_CHANGED_REVIEW_REQUIRED", finishedAt, evidence, commitTransactionId,
          });
        }
        const result = outcome.status === "ACCEPTED"
          ? "ADMITTED"
          : outcome.status === "DUPLICATE" ? "ALREADY_PRESENT" : "NOT_ADMITTED";
        const reason = result === "NOT_ADMITTED" ? (outcome.reasons?.[0] || outcome.status) : null;
        if (result !== "NOT_ADMITTED") {
          const previewRoots = {
            pretradePreviews: draft.pretradePreviews,
            pretradePreviewOperations: draft.pretradePreviewOperations,
            pretradePreviewReceipts: draft.pretradePreviewReceipts,
            pretradeProviderRuns: draft.pretradeProviderRuns,
            pretradeProviderMessages: draft.pretradeProviderMessages,
          };
          Object.assign(draft, planned.state, previewRoots);
        }
        return this.#recordReceipt(draft, preview, operation, {
          result, reason, finishedAt, evidence, candidate: outcome, commitTransactionId,
        });
      }, { transactionId: commitTransactionId });
    } catch (error) {
      if (error?.code === "PRETRADE_COMMIT_AMBIGUOUS") {
        throw previewError("acceptance outcome is unknown; check the original operation", "OUTCOME_UNKNOWN", { operationId });
      }
      throw error;
    }
  }

  recoverAfterRestart() {
    this.processGeneration = crypto.randomUUID();
    const now = this.#time();
    const commitTransactionId = crypto.randomUUID();
    return this.store.transaction((draft) => {
      const recovered = [];
      for (const operation of draft.pretradePreviewOperations) {
        const preview = draft.pretradePreviews.find((item) => item.previewId === operation.previewId);
        if (!preview) throw previewError("preview operation linkage is corrupt", "PRETRADE_RECOVERY_REQUIRED");
        if (operation.state === "ACCEPTING") {
          const committed = draft.pretradePreviewReceipts.find((item) => item.operationId === operation.operationId);
          if (committed) continue;
          recovered.push(this.#recordReceipt(draft, preview, operation, {
            result: "NOT_ADMITTED", reason: "INTERRUPTED", finishedAt: now, evidence: null, commitTransactionId,
          }));
        } else if (!TERMINAL_PREVIEW_STATES.has(preview.state)) {
          preview.revalidationRequired = true;
          preview.processGeneration = this.processGeneration;
          this.#sealOperation(preview, operation);
        }
      }
      for (const run of draft.pretradeProviderRuns) {
        if (!["ACTIVE", "VERIFYING"].includes(run.status)) continue;
        run.status = "INTERRUPTED";
        run.finishedAt = now;
        run.reasonCode = "INTERRUPTED";
        run.integrityHash = pretradeProviderRunIntegrityHash(run);
      }
      for (const message of draft.pretradeProviderMessages) {
        if (message.status !== "VERIFYING") continue;
        message.status = "INTERRUPTED";
        message.finishedAt = now;
        message.reasonCode = "INTERRUPTED";
        message.integrityHash = pretradeProviderMessageIntegrityHash(message);
      }
      draft.updatedAt = now;
      return recovered;
    }, { transactionId: commitTransactionId });
  }

  #finishNotAdmitted(reservation, reason, details) {
    const finishedAt = this.#time();
    const commitTransactionId = crypto.randomUUID();
    return this.store.transaction((draft) => {
      const preview = this.#preview(draft, reservation.preview.previewId);
      const operation = this.#operation(draft, reservation.operation.operationId);
      this.#assertBound(preview, operation);
      const existingReceipt = draft.pretradePreviewReceipts.find((item) => item.operationId === operation.operationId);
      if (existingReceipt) return projectedReceipt(existingReceipt);
      if (
        operation.state !== "ACCEPTING"
        || operation.processGeneration !== reservation.operation.processGeneration
        || reservation.operation.processGeneration !== this.processGeneration
      ) {
        throw previewError("acceptance continuation is no longer authoritative", "PREVIEW_CONTINUATION_INVALID");
      }
      return this.#recordReceipt(draft, preview, operation, {
        result: "NOT_ADMITTED",
        reason,
        finishedAt,
        evidence: details ? { details } : null,
        commitTransactionId,
      });
    }, { transactionId: commitTransactionId });
  }

  #recordReceipt(draft, preview, operation, {
    result,
    reason,
    finishedAt,
    evidence,
    candidate = null,
    commitTransactionId = null,
  }) {
    if (!TERMINAL_RECEIPT_RESULTS.has(result)) throw previewError("invalid receipt result", "INVALID_PREVIEW_RECEIPT");
    const receipt = {
      schemaVersion: 1,
      receiptId: `preview-receipt:${operation.operationId}`,
      operationId: operation.operationId,
      previewId: preview.previewId,
      previewRevision: preview.revision,
      bindingHash: preview.bindingHash,
      proposalHash: preview.proposalHash,
      result,
      reason: reason || null,
      requestedAt: operation.requestedAt,
      finishedAt,
      commitTransactionId,
      commitRevision: Number(draft.storeRevision || 0) + 1,
      candidate: candidate ? {
        candidateId: candidate.candidateId,
        contractVersion: candidate.contractVersion,
        contentHash: candidate.contentHash ?? preview.candidateIdentity.contentHash,
      } : null,
      canonicalAdmission: result === "ADMITTED" ? {
        operationId: candidate?.acceptanceOperationId || null,
        eventId: candidate?.acceptanceEventId || null,
      } : null,
      evidence: evidence ? structuredClone(evidence) : null,
      receiptHash: null,
      ...(isOperatorReviewedImportPolicy(preview.policy) ? { reviewScope: { ...OPERATOR_REVIEWED_IMPORT_SCOPE } } : {}),
    };
    if (result === "ADMITTED" && (!receipt.canonicalAdmission.operationId || !receipt.canonicalAdmission.eventId)) {
      throw previewError("admitted receipt requires canonical operation and event linkage", "INVALID_PREVIEW_RECEIPT");
    }
    receipt.receiptHash = pretradePreviewReceiptHash(receipt);
    if (Buffer.byteLength(JSON.stringify({
      ...draft,
      pretradePreviewReceipts: [...draft.pretradePreviewReceipts, receipt],
    }), "utf8") > this.maxBytes) {
      throw previewError("preview receipt capacity is exhausted", "PREVIEW_CAPACITY_EXHAUSTED");
    }
    draft.pretradePreviewReceipts.push(receipt);
    operation.state = result;
    operation.finishedAt = finishedAt;
    operation.receiptId = receipt.receiptId;
    preview.state = result;
    preview.finishedAt = finishedAt;
    this.#sealOperation(preview, operation);
    draft.updatedAt = finishedAt;
    return projectedReceipt(receipt);
  }

  #terminalByOperation(operationId) {
    if (this.store.fenced) throw previewError("PRETRADE requires recovery before outcome projection", "PRETRADE_RECOVERY_REQUIRED");
    const state = this.store.snapshot();
    const receipt = state.pretradePreviewReceipts.find((item) => item.operationId === text(operationId));
    return projectedReceipt(receipt);
  }

  #preview(state, previewId) {
    const record = state.pretradePreviews.find((item) => item.previewId === text(previewId));
    if (!record) throw previewError("preview is unavailable", "PREVIEW_UNAVAILABLE");
    return record;
  }

  #operation(state, operationId) {
    const record = state.pretradePreviewOperations.find((item) => item.operationId === text(operationId));
    if (!record) throw previewError("acceptance operation is unavailable", "PREVIEW_OPERATION_UNAVAILABLE");
    return record;
  }

  #assertBound(preview, operation) {
    if (
      operation.previewId !== preview.previewId
      || operation.previewRevision !== preview.revision
      || operation.bindingHash !== preview.bindingHash
      || operation.integrityHash !== pretradePreviewOperationIntegrityHash(operation, preview)
    ) {
      throw previewError("preview operation binding is corrupt", "PRETRADE_RECOVERY_REQUIRED");
    }
  }

  #sealOperation(preview, operation) {
    operation.integrityHash = pretradePreviewOperationIntegrityHash(operation, preview);
  }

  #assertCapacity(state, record, operation) {
    if (state.pretradePreviews.length >= this.maxPreviews) {
      throw previewError("preview capacity is exhausted", "PREVIEW_CAPACITY_EXHAUSTED");
    }
    if (Buffer.byteLength(JSON.stringify({
      ...state,
      pretradePreviews: [...state.pretradePreviews, record],
      pretradePreviewOperations: [...state.pretradePreviewOperations, operation],
    }), "utf8") > this.maxBytes) {
      throw previewError("preview record is too large", "PREVIEW_TOO_LARGE");
    }
  }

  #assessEvidence(evidence, preview, now, state) {
    const fail = (reasonCode) => ({ valid: false, reasonCode });
    if (!evidence || evidence.valid !== true) return fail(text(evidence?.reasonCode) || "FINAL_EVIDENCE_INVALID");
    if (contentHash(preview.policy) !== contentHash(this.policy)) return fail("PREVIEW_POLICY_CHANGED");
    if (
      evidence.policyHash !== contentHash(preview.policy)
      || evidence.bindingHash !== preview.bindingHash
      || evidence.proposalHash !== preview.proposalHash
      || text(evidence.accountScope) !== text(preview.accountScope)
      || evidence.fixedProposalReferencesHash !== contentHash(preview.fixedProposalReferences)
    ) return fail("FINAL_EVIDENCE_BINDING_MISMATCH");

    const quotePolicy = preview.policy?.quoteEvidencePolicy;
    if (!quotePolicy || typeof quotePolicy !== "object") return fail("FINAL_EVIDENCE_POLICY_INVALID");
    const quoteAssessment = assessQuoteEvidence(evidence.quoteEvidence, {
      nowMs: now,
      sourceMaxAgeMs: quotePolicy.sourceMaxAgeMs,
      receiptMaxAgeMs: quotePolicy.receiptMaxAgeMs,
      validateReceivedAt: quotePolicy.validateReceivedAt,
      requireReceivedAt: quotePolicy.requireReceivedAt,
      requireRealtime: quotePolicy.requireRealtime,
      maxFutureSkewMs: quotePolicy.maxFutureSkewMs,
    });
    if (!quoteAssessment.valid) return fail(quoteAssessment.reasonCodes[0] || "FINAL_QUOTE_EVIDENCE_INVALID");

    const accountFreshness = freshness(evidence.accountEvidence?.observedAt, {
      nowMs: now,
      maxAgeMs: preview.policy?.accountMaxAgeMs,
      maxFutureSkewMs: quotePolicy.maxFutureSkewMs,
    });
    if (
      accountFreshness.isStale
      || text(evidence.accountEvidence?.accountScope) !== text(preview.accountScope)
      || !text(evidence.accountEvidence?.revision)
    ) return fail("FINAL_ACCOUNT_EVIDENCE_INVALID");

    if (
      evidence.ownershipEvidence?.healthy !== true
      || !Number.isInteger(Number(evidence.ownershipEvidence?.storeRevision))
      || Number(evidence.ownershipEvidence.storeRevision) < 0
      || !/^[a-f0-9]{64}$/.test(text(evidence.ownershipEvidence?.storeHash).toLowerCase())
    ) return fail("FINAL_OWNERSHIP_EVIDENCE_INVALID");
    if (isOperatorReviewedImportPolicy(preview.policy)) {
      // This profile makes no automated setup-history/displacement claim. Never
      // encode an unevaluated setup as a successful fixed-predicate assessment.
      if (Object.hasOwn(evidence, "fixedPredicates") || Object.hasOwn(evidence, "setupAssessment")) {
        return fail("FINAL_SETUP_ASSESSMENT_CONFLICT");
      }
      const validity = preview.bundle?.candidates?.[0]?.validity;
      const from = timestampMs(validity?.validFrom);
      const until = timestampMs(validity?.validUntil);
      const current = timestampMs(now);
      if (from === null || until === null || current === null || until <= from) return fail("FINAL_CANDIDATE_VALIDITY_INVALID");
      const normalized = normalizeCanonicalCandidateProposal(preview.bundle.candidates[0], { bundleSource: preview.bundle.source });
      const canonicalHash = normalized.errors.length ? null : candidateContractHash(normalized.normalized);
      const alreadyPresent = canonicalHash !== null && state.candidates.some(candidate => (
        candidate.candidateId === preview.candidateIdentity.candidateId
        && Number(candidate.contractVersion) === preview.candidateIdentity.contractVersion
        && candidateContractHash(candidate) === canonicalHash
      ));
      // Looking up an exact existing candidate grants no new admission or lifecycle
      // authority. Its actual (possibly expired/terminal) state is returned separately.
      if (!alreadyPresent && current < from) return fail("FINAL_CANDIDATE_NOT_YET_VALID");
      if (!alreadyPresent && current >= until) return fail("FINAL_CANDIDATE_EXPIRED");
    } else if (
      evidence.fixedPredicates?.valid !== true
      || evidence.fixedPredicates?.proposalHash !== preview.proposalHash
      || evidence.fixedPredicates?.fixedProposalReferencesHash !== contentHash(preview.fixedProposalReferences)
    ) return fail("FINAL_FIXED_PREDICATES_INVALID");

    let external;
    try {
      external = this.evidenceValidator({
        evidence: immutable(evidence),
        preview: immutable(preview),
        currentPolicy: immutable(this.policy),
        state: immutable(state),
        observedAt: now,
      });
    } catch {
      return fail("FINAL_EVIDENCE_REVALIDATION_FAILED");
    }
    if (external && typeof external.then === "function") return fail("ASYNC_FINAL_EVIDENCE_VALIDATOR_FORBIDDEN");
    if (external?.valid !== true) return fail(text(external?.reasonCode) || "FINAL_EVIDENCE_REVALIDATION_FAILED");
    return { valid: true, reasonCode: null };
  }

  #providerHandoffConfigured() {
    const config = this.providerHandoff;
    if (!config || typeof config !== "object") return false;
    const challengeTtlMs = Number(config.challengeTtlMs ?? 60_000);
    const maxClockSkewMs = Number(config.maxClockSkewMs ?? 5_000);
    const maxEnvelopeBytes = Number(config.maxEnvelopeBytes ?? 2 * 1024 * 1024);
    if (
      !text(config.installationId)
      || !config.issuers
      || typeof config.issuers !== "object"
      || typeof config.resolveChart !== "function"
      || typeof config.accountSelectionResolver !== "function"
      || !HASH_PATTERN.test(text(config.profileHash))
      || !text(config.prompt?.version)
      || !HASH_PATTERN.test(text(config.prompt?.hash))
      || !Number.isSafeInteger(Number(config.outputSchema?.version))
      || Number(config.outputSchema.version) < 1
      || !HASH_PATTERN.test(text(config.outputSchema?.hash))
      || !Number.isSafeInteger(challengeTtlMs)
      || challengeTtlMs < 1_000
      || challengeTtlMs > 10 * 60_000
      || !Number.isSafeInteger(maxClockSkewMs)
      || maxClockSkewMs < 0
      || maxClockSkewMs > 60_000
      || !Number.isSafeInteger(maxEnvelopeBytes)
      || maxEnvelopeBytes < 1_024
      || maxEnvelopeBytes > 16 * 1024 * 1024
    ) return false;
    return Object.values(config.issuers).some((issuer) => (
      issuer
      && typeof issuer === "object"
      && text(issuer.serviceId)
      && issuer.keys
      && typeof issuer.keys === "object"
      && Object.values(issuer.keys).some(Boolean)
    ));
  }

  #assertProviderHandoffConfigured() {
    if (!this.#providerHandoffConfigured()) {
      throw previewError("authenticated provider handoff is unconfigured", "PRETRADE_PROVIDER_HANDOFF_UNCONFIGURED");
    }
  }

  #issuer(issuerId, keyId) {
    const issuer = this.providerHandoff?.issuers?.[text(issuerId)];
    const key = issuer?.keys?.[text(keyId)];
    if (!issuer || !key || issuer.revoked === true || (issuer.revokedKeyIds || []).includes(text(keyId))) {
      throw previewError("provider issuer or key is not trusted", "PRETRADE_PROVIDER_KEY_UNTRUSTED");
    }
    return { ...issuer, publicKey: key };
  }

  #assertProviderEnvelopeConfiguration(envelope, issuer) {
    const state = this.store.snapshot();
    if (envelope.audienceInstallationId !== text(this.providerHandoff.installationId)) {
      throw previewError("provider handoff audience is invalid", "PRETRADE_PROVIDER_AUDIENCE_MISMATCH");
    }
    if (envelope.storeEpoch !== state.storeEpoch) {
      throw previewError("provider handoff store epoch is invalid", "PRETRADE_PROVIDER_STORE_EPOCH_MISMATCH");
    }
    if (envelope.provider.serviceId !== text(issuer.serviceId)) {
      throw previewError("provider service identity is invalid", "PRETRADE_PROVIDER_SERVICE_MISMATCH");
    }
    if (Array.isArray(issuer.modelIds) && !issuer.modelIds.includes(envelope.provider.modelId)) {
      throw previewError("provider model is not allowed", "PRETRADE_PROVIDER_MODEL_UNSUPPORTED");
    }
    if (Array.isArray(issuer.reasoningEfforts) && !issuer.reasoningEfforts.includes(envelope.provider.reasoningEffort)) {
      throw previewError("provider reasoning effort is not allowed", "PRETRADE_PROVIDER_REASONING_UNSUPPORTED");
    }
    if (
      envelope.provider.promptVersion !== text(this.providerHandoff.prompt.version)
      || envelope.provider.promptHash !== text(this.providerHandoff.prompt.hash)
      || Number(envelope.provider.outputSchemaVersion) !== Number(this.providerHandoff.outputSchema.version)
      || envelope.provider.outputSchemaHash !== text(this.providerHandoff.outputSchema.hash)
      || envelope.provider.profileId !== text(this.policy?.profileId)
      || Number(envelope.provider.profileVersion) !== Number(this.policy?.profileVersion)
      || envelope.provider.profileHash !== text(this.providerHandoff.profileHash)
      || envelope.provider.policyId !== text(this.policy?.policyId)
      || Number(envelope.provider.policyVersion) !== Number(this.policy?.policyVersion)
      || envelope.provider.policyHash !== contentHash(this.policy)
    ) {
      throw previewError("provider configuration does not match the active preview policy", "PRETRADE_PROVIDER_CONFIGURATION_MISMATCH");
    }
  }

  #assertCurrentAccountSelection(accountScopeId, accountSelectionRevision) {
    let current;
    try {
      current = this.providerHandoff.accountSelectionResolver();
    } catch {
      throw previewError("account selection authority is unavailable", "PRETRADE_PROVIDER_ACCOUNT_SELECTION_UNAVAILABLE");
    }
    if (current && typeof current.then === "function") {
      throw previewError("account selection authority must be synchronous", "PRETRADE_PROVIDER_ACCOUNT_SELECTION_ASYNC_FORBIDDEN");
    }
    if (
      !current
      || text(current.accountScopeId) !== text(accountScopeId)
      || text(current.revision) !== text(accountSelectionRevision)
      || current.healthy !== true
    ) {
      throw previewError("account selection changed or is unhealthy", "PRETRADE_PROVIDER_ACCOUNT_SELECTION_CHANGED");
    }
    return current;
  }

  #assertEnvelopeRunBinding(envelope, run, state, observedAt, { requireVerifying = false } = {}) {
    if (!run) throw previewError("provider challenge is unavailable", "PRETRADE_PROVIDER_CHALLENGE_UNAVAILABLE");
    const issuer = this.#issuer(envelope.issuerId, envelope.keyId);
    this.#assertProviderEnvelopeConfiguration(envelope, issuer);
    this.#assertCurrentAccountSelection(run.accountScopeId, run.accountSelectionRevision);
    const nowMs = timestampMs(observedAt);
    const skewMs = Number(this.providerHandoff.maxClockSkewMs ?? 5_000);
    if (!Number.isSafeInteger(skewMs) || skewMs < 0 || skewMs > 60_000) {
      throw previewError("provider handoff clock-skew policy is invalid", "PRETRADE_PROVIDER_HANDOFF_CONFIGURATION_INVALID");
    }
    const times = [
      envelope.times.providerRequestStartedAt,
      envelope.times.providerRequestFinishedAt,
      envelope.times.serviceOutputReceivedAt,
      envelope.times.envelopeIssuedAt,
      envelope.times.envelopeExpiresAt,
    ].map(timestampMs);
    const challengeIssuedMs = timestampMs(envelope.challenge.issuedAt);
    const challengeExpiresMs = timestampMs(envelope.challenge.expiresAt);
    if (
      times.some((value) => value === null)
      || times.some((value, index) => index > 0 && value < times[index - 1])
      || challengeIssuedMs >= challengeExpiresMs
      || times[0] < challengeIssuedMs
      || times[3] > challengeExpiresMs
      || times[4] > challengeExpiresMs
      || times[3] > nowMs + skewMs
      || nowMs >= times[4]
      || nowMs >= timestampMs(run.expiresAt)
    ) {
      throw previewError("provider handoff timing is invalid or expired", "PRETRADE_PROVIDER_HANDOFF_EXPIRED");
    }
    if (
      run.storeEpoch !== state.storeEpoch
      || run.challengeNonce !== envelope.challenge.nonce
      || run.issuedAt !== envelope.challenge.issuedAt
      || run.expiresAt !== envelope.challenge.expiresAt
      || run.bootGeneration !== envelope.challenge.bootGeneration
      || run.bootGeneration !== this.processGeneration
      || run.draftId !== envelope.run.draftId
      || Number(run.inputRevision) !== Number(envelope.run.inputRevision)
      || run.runId !== envelope.run.runId
      || run.inputManifestHash !== envelope.run.inputManifestHash
      || Number(run.retirementRevision) !== Number(envelope.run.retirementRevision)
      || run.accountScopeId !== envelope.run.accountScopeId
      || run.accountSelectionRevision !== envelope.run.accountSelectionRevision
      || run.policyHash !== contentHash(this.policy)
      || (requireVerifying ? run.status !== "VERIFYING" : run.status !== "ACTIVE")
    ) {
      throw previewError("provider handoff does not match the active run challenge", "PRETRADE_PROVIDER_RUN_BINDING_MISMATCH");
    }
  }

  async #verifyProviderEnvelopeBytes(envelope) {
    const candidate = envelope.output.bundle?.candidates?.[0];
    if (
      !candidate
      || envelope.output.bundle.candidates.length !== 1
      || pretradePreviewProposalHash(envelope.output.bundle) !== envelope.output.proposalHash
      || candidateContractHash(candidate) !== envelope.output.candidateContractHash
      || text(candidate.candidateId) !== envelope.output.candidateId
      || Number(candidate.contractVersion) !== Number(envelope.output.contractVersion)
      || contentHash({
        bundle: envelope.output.bundle,
        fixedProposalReferences: envelope.output.fixedProposalReferences,
      }) !== envelope.output.normalizedOutputHash
    ) {
      throw previewError("provider output does not match its canonical candidate bindings", "PRETRADE_PROVIDER_OUTPUT_BINDING_MISMATCH");
    }
    const chartManifestHash = contentHash(envelope.charts);
    for (const evidence of envelope.evidence) {
      const evidenceMaterial = structuredClone(evidence);
      delete evidenceMaterial.evidenceHash;
      if (
        evidence.chartManifestHash !== chartManifestHash
        || evidence.accountScopeId !== envelope.run.accountScopeId
        || evidence.policyHash !== contentHash(this.policy)
        || evidence.evidenceHash !== contentHash(evidenceMaterial)
        || timestampMs(evidence.sourceTime) > timestampMs(evidence.observedAt)
        || timestampMs(evidence.observedAt) > timestampMs(evidence.receivedAt)
        || timestampMs(evidence.receivedAt) > timestampMs(envelope.times.serviceOutputReceivedAt)
      ) {
        throw previewError("provider evidence does not match the signed run", "PRETRADE_PROVIDER_EVIDENCE_BINDING_MISMATCH");
      }
    }
    const chartByteHashes = [];
    for (const chart of envelope.charts) {
      if (
        timestampMs(chart.receivedAt) > timestampMs(envelope.times.providerRequestStartedAt)
        || (chart.captureTime !== null && timestampMs(chart.captureTime) > timestampMs(chart.receivedAt))
      ) {
        throw previewError("provider chart times are impossible", "PRETRADE_PROVIDER_CHART_TIME_INVALID");
      }
      const resolved = await this.providerHandoff.resolveChart(chart.contentRef);
      const bytes = resolved?.bytes;
      if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
        throw previewError("trusted chart resolver returned no bytes", "PRETRADE_PROVIDER_CHART_UNAVAILABLE");
      }
      const rawBytes = Buffer.from(bytes);
      const rawHash = crypto.createHash("sha256").update(rawBytes).digest("hex");
      if (
        text(resolved.contentRef) !== chart.contentRef
        || text(resolved.chartId) !== chart.chartId
        || text(resolved.mediaType) !== chart.mediaType
        || Number(resolved.byteLength) !== chart.byteCount
        || text(resolved.sha256) !== chart.rawByteHash
        || rawBytes.length !== chart.byteCount
        || rawHash !== chart.rawByteHash
        || text(resolved.ingestedAt) !== chart.receivedAt
        || (chart.width !== null && Number(resolved.width) !== chart.width)
        || (chart.height !== null && Number(resolved.height) !== chart.height)
      ) {
        throw previewError("provider chart manifest does not match trusted bytes", "PRETRADE_PROVIDER_CHART_BINDING_MISMATCH");
      }
      if (chart.transformVersion === null && chart.transformHash === null) {
        if (chart.providerInputByteHash !== rawHash) {
          throw previewError("provider input bytes do not match the original chart", "PRETRADE_PROVIDER_INPUT_BYTES_MISMATCH");
        }
      } else {
        if (typeof this.providerHandoff.resolveProviderInput !== "function") {
          throw previewError("transformed provider input cannot be independently verified", "PRETRADE_PROVIDER_TRANSFORM_UNVERIFIED");
        }
        const transformed = await this.providerHandoff.resolveProviderInput(chart, resolved);
        const transformedBytes = Buffer.isBuffer(transformed) ? transformed : Buffer.from(transformed?.bytes || []);
        const transformedHash = crypto.createHash("sha256").update(transformedBytes).digest("hex");
        if (
          !transformedBytes.length
          || transformedHash !== chart.providerInputByteHash
          || Buffer.isBuffer(transformed)
          || text(transformed.transformVersion) !== text(chart.transformVersion)
          || text(transformed.transformHash) !== text(chart.transformHash)
        ) {
          throw previewError("transformed provider input bytes do not match", "PRETRADE_PROVIDER_INPUT_BYTES_MISMATCH");
        }
      }
      chartByteHashes.push(rawHash);
    }
    return {
      chartByteHashes,
      provenance: {
        channel: "AUTHENTICATED_PROVIDER_HANDOFF",
        issuerId: envelope.issuerId,
        keyId: envelope.keyId,
        providerServiceId: envelope.provider.serviceId,
        providerResponseId: envelope.provider.responseId,
        messageId: envelope.messageId,
        chartManifestHash,
        byteIdentityVerified: true,
        captureProvenanceVerified: false,
        buildSourceDigest: envelope.provider.buildSourceDigest,
      },
      sourceTimes: {
        charts: envelope.charts.map((chart) => ({
          chartId: chart.chartId,
          receivedAt: chart.receivedAt,
          captureTime: chart.captureTime,
          captureTimeProvenance: chart.captureTimeProvenance,
        })),
        providerRequestStartedAt: envelope.times.providerRequestStartedAt,
        providerRequestFinishedAt: envelope.times.providerRequestFinishedAt,
        serviceOutputReceivedAt: envelope.times.serviceOutputReceivedAt,
      },
    };
  }

  #rejectProviderRegistration(reservation, reasonCode) {
    if (this.store.fenced) return;
    const finishedAt = this.#time();
    this.store.transaction((draft) => {
      const message = draft.pretradeProviderMessages.find((item) => item.messageId === reservation.messageId);
      const run = draft.pretradeProviderRuns.find((item) => item.challengeId === reservation.challengeId);
      if (!message || !run || message.status !== "VERIFYING" || run.status !== "VERIFYING") return;
      message.status = "REJECTED";
      message.finishedAt = finishedAt;
      message.reasonCode = text(reasonCode) || "PRETRADE_PROVIDER_REGISTRATION_FAILED";
      run.status = "REJECTED";
      run.finishedAt = finishedAt;
      run.reasonCode = message.reasonCode;
      message.integrityHash = pretradeProviderMessageIntegrityHash(message);
      run.integrityHash = pretradeProviderRunIntegrityHash(run);
      draft.updatedAt = finishedAt;
    });
  }

  #assertProviderLedgerCapacity(state, run, message) {
    const maxRecords = Number(this.providerHandoff.maxLedgerRecords ?? 1_000);
    if (
      !Number.isSafeInteger(maxRecords)
      || maxRecords < 1
      || state.pretradeProviderRuns.length + (run ? 1 : 0) > maxRecords
      || state.pretradeProviderMessages.length + (message ? 1 : 0) > maxRecords
    ) {
      throw previewError("provider handoff ledger capacity is exhausted", "PRETRADE_PROVIDER_LEDGER_CAPACITY_EXHAUSTED");
    }
    if (Buffer.byteLength(JSON.stringify({
      ...state,
      pretradeProviderRuns: run ? [...state.pretradeProviderRuns, run] : state.pretradeProviderRuns,
      pretradeProviderMessages: message ? [...state.pretradeProviderMessages, message] : state.pretradeProviderMessages,
    }), "utf8") > this.maxBytes) {
      throw previewError("provider handoff ledger exceeds the store capacity", "PRETRADE_PROVIDER_LEDGER_CAPACITY_EXHAUSTED");
    }
  }

  #assertEnabled() {
    if (!this.readiness().enabled) throw previewError("PRETRADE preview admission is disabled or unconfigured", PRETRADE_PREVIEW_FEATURE_DISABLED);
  }

  #time() {
    const value = timestampIso(this.clock());
    if (!value) throw previewError("preview clock returned an invalid timestamp", "PREVIEW_CLOCK_INVALID");
    return value;
  }
}
