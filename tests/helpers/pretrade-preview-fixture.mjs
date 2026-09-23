// Synthetic fixture; no provider, credentials, live accounts or runtime wiring.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentHash, PreTradeStore } from "../../schwab-bridge/pretrade-state.mjs";
import { AUTOMATED_UNTOUCHED_ONLY, PreTradeCandidateIngress } from "../../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradePreviewAuthority } from "../../schwab-bridge/pretrade-preview-authority.mjs";
import { CURRENT_LIVE_QUOTE_EVIDENCE_POLICY } from "../../schwab-bridge/clock-freshness.mjs";

const SOURCE = "SOD_A_PLUS_TRADES";
const PREVIEW_POLICY = Object.freeze({
  policyId: "TEST_ONLY",
  policyVersion: 1,
  profileVersion: 1,
  schemaVersion: 1,
  quoteEvidencePolicy: CURRENT_LIVE_QUOTE_EVIDENCE_POLICY,
  accountMaxAgeMs: 15_000,
});

function finalEvidence(preview, observedAt, overrides = {}) {
  return {
    valid: true,
    accountScope: preview.accountScope,
    policyHash: contentHash(preview.policy),
    bindingHash: preview.bindingHash,
    proposalHash: preview.proposalHash,
    fixedProposalReferencesHash: contentHash(preview.fixedProposalReferences),
    quoteEvidence: { quoteTime: observedAt, receivedAt: observedAt, realtime: true },
    accountEvidence: { accountScope: preview.accountScope, revision: "account-revision-1", observedAt },
    ownershipEvidence: { healthy: true, storeRevision: 7, storeHash: "a".repeat(64) },
    fixedPredicates: {
      valid: true,
      proposalHash: preview.proposalHash,
      fixedProposalReferencesHash: contentHash(preview.fixedProposalReferences),
    },
    evidenceId: "evidence-1",
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    candidateId: "live-2026-09-21-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: SOURCE,
    sourceDate: "2026-09-21",
    generatedAt: "2026-09-21T15:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "H2 trend continuation",
    timeframe: "2m",
    thesis: "Second-entry continuation after pullback",
    trigger: { type: "MANUAL_CONFIRMATION", prompt: "Confirm H2 signal bar" },
    structuralInvalidation: {
      price: 176.5,
      rule: "break below pullback low",
      referenceType: "PULLBACK_LOW",
      reason: "long thesis invalid below pullback structure",
    },
    plannedEntryReference: 177.25,
    targets: [178.5, 180],
    managementContract: { mode: "FLEXIBLE_WITHIN_CEILING" },
    validity: {
      validFrom: "2026-09-21T15:00:00.000Z",
      validUntil: "2026-09-21T21:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
      provenance: { source: "LIVE_REVIEW", label: "operator-reviewed contract window" },
    },
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

export function bundle(overrides = {}) {
  return { source: SOURCE, bundleId: "live-run-1", candidates: [candidate()], ...overrides };
}

export function harness({ filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pretrade-preview-")), "state.json"), failpoint = null, evidenceProvider = null } = {}) {
  let tick = 0;
  let id = 0;
  const clock = () => new Date(Date.parse("2026-09-21T15:00:00.000Z") + tick++ * 100).toISOString();
  const store = new PreTradeStore({ filePath, clock, failpoint });
  store.acquireWriterLock();
  store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock, idFactory: () => `ingress-${++id}` });
  const rawEvidenceProvider = evidenceProvider || (async () => ({}));
  const authority = new PreTradePreviewAuthority({
    store,
    candidateIngress: ingress,
    enabled: true,
    allowLegacyTestPolicy: true,
    policy: PREVIEW_POLICY,
    evidenceProvider: async (context) => {
      const overrides = await rawEvidenceProvider(context);
      return finalEvidence(context.preview, clock(), overrides);
    },
    evidenceValidator: ({ evidence }) => ({
      valid: evidence.ownershipEvidence.storeRevision === 7
        && evidence.accountEvidence.revision === "account-revision-1",
      reasonCode: "FINAL_AUTHORITY_VERSION_CHANGED",
    }),
    clock,
    idFactory: () => `preview-id-${++id}`,
  });
  return { authority, store, ingress, filePath, clock };
}

export function create(authority, overrides = {}) {
  return authority.create({
    bundle: bundle(),
    ingressPolicy: AUTOMATED_UNTOUCHED_ONLY,
    draftId: "draft-1",
    inputRevision: 1,
    runId: "run-1",
    accountScope: "account-hash-1",
    chartByteHashes: ["chart-hash-1"],
    provenance: { channel: "TEST_TRUSTED_INTERNAL" },
    sourceTimes: { chartCapturedAt: "2026-09-21T14:59:55.000Z" },
    evidenceIds: ["research-evidence-1"],
    fixedProposalReferences: { structuralReference: "pullback-low-1" },
    ...overrides,
  });
}
