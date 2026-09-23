import { canonicalJson } from "./canonical-json.mjs";
import { CURRENT_LIVE_QUOTE_EVIDENCE_POLICY } from "./clock-freshness.mjs";

// Approval of this import contract is not production configuration or release approval.
export const OPERATOR_REVIEWED_CARD_IMPORT_V1 = "OPERATOR_REVIEWED_CARD_IMPORT_V1";
export const OPERATOR_REVIEWED_IMPORT_POLICY = Object.freeze({
  policyId: OPERATOR_REVIEWED_CARD_IMPORT_V1,
  policyVersion: 1,
  profileId: OPERATOR_REVIEWED_CARD_IMPORT_V1,
  profileVersion: 1,
  schemaVersion: 1,
  quoteEvidencePolicy: CURRENT_LIVE_QUOTE_EVIDENCE_POLICY,
  accountMaxAgeMs: 15_000,
  setupAssessment: "OPERATOR_REVIEW_REQUIRED",
  chartCardAgeThresholdMs: null,
  additionalPreviewLifetimeMs: null,
});

export const OPERATOR_REVIEWED_IMPORT_SCOPE = Object.freeze({
  profileId: OPERATOR_REVIEWED_CARD_IMPORT_V1,
  setupAssessmentStatus: "NOT_EVALUATED",
  tradingReviewRequired: true,
});

export function isOperatorReviewedImportPolicy(policy) {
  return JSON.stringify(canonicalJson(policy ?? null))
    === JSON.stringify(canonicalJson(OPERATOR_REVIEWED_IMPORT_POLICY));
}

export function previewPolicyMode(policy, { allowLegacyTestPolicy = false } = {}) {
  if (isOperatorReviewedImportPolicy(policy)) return "OPERATOR_REVIEWED";
  // Existing offline fault fixtures exercise the former strict predicate protocol.
  // No production caller supplies this test-only constructor capability.
  if (allowLegacyTestPolicy && policy?.policyId === "TEST_ONLY" && !policy.profileId) return "LEGACY_TEST";
  return null;
}
