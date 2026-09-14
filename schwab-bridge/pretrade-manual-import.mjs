import { preflightManualSubmission } from "./manual-sod-ingestion.mjs";

// Thin adapter for the existing exported manual envelope. No new candidate
// schema, lineage algorithm, repository, supersession decision or execution path.
export function importStandaloneManualEnvelope(candidateIngress, envelope) {
  if (!Array.isArray(envelope?.candidates) || envelope.candidates.length !== 1) {
    return { outcomes: [{ status: "REJECTED", reasons: ["Manual import requires exactly one candidate."] }] };
  }
  const preflight = preflightManualSubmission(envelope, candidateIngress.store.snapshot().candidates);
  if (preflight.errors.length) {
    return { outcomes: [{ status: "REJECTED", reasons: preflight.errors }] };
  }
  if (preflight.plan.some(item => ["REJECTED", "CONFLICT", "STALE"].includes(item.preflightStatus))) {
    return {
      outcomes: preflight.plan.map(item => ({
        candidateId: item.candidateId,
        contractVersion: item.contractVersion,
        status: ["CONFLICT", "STALE"].includes(item.preflightStatus) ? item.preflightStatus : "REJECTED",
        reasons: item.reasons,
        ...(item.code ? { code: item.code } : {}),
      })),
    };
  }
  // REVISED is still subject to MANUAL_AUTHORIZED ingress. Only PRETRADE may
  // consume an existing, exact review authorization; this adapter never grants it.
  return candidateIngress.importBundle(preflight.canonicalBundle);
}
