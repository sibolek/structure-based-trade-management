import {
  ATR_RECONSTRUCTION_COMPLETED_RTH_SESSIONS,
  WILDER_ATR_METHOD,
  WILDER_ATR_PERIOD,
} from "./wilder-atr.mjs";

export const DSS_POLICY_ID = "EXECUTIONOS_DSS";
export const DSS_POLICY_VERSION = 1;

export const DSS_POLICY_V1 = Object.freeze({
  policyId: DSS_POLICY_ID,
  policyVersion: DSS_POLICY_VERSION,
  volatilityMethod: WILDER_ATR_METHOD,
  volatilityPeriod: WILDER_ATR_PERIOD,
  volatilityTimeframe: "2m",
  bufferMultiplier: 0.30,
  quoteMaxAgeMs: 5_000,
  completedBarPublicationGraceMs: 10_000,
  atrReconstructionCompletedRthSessions: ATR_RECONSTRUCTION_COMPLETED_RTH_SESSIONS,
});

export function dssPolicyForVersion(version = DSS_POLICY_VERSION) {
  const normalizedVersion = Number(version);
  if (normalizedVersion !== DSS_POLICY_VERSION) {
    throw new Error(`unsupported DSS policy version: ${version}`);
  }
  return DSS_POLICY_V1;
}
