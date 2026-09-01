export const RISK_SIZING_POLICY_VERSION = 1;

const POLICIES = Object.freeze({
  1: Object.freeze({
    policyId: "V24_EFFECTIVE_STOP_RISK_SIZING",
    policyVersion: 1,
    riskFraction: 0.005,
    quoteMaxAgeMs: 5_000,
    accountSnapshotMaxAgeMs: 15_000,
    budgetIncrement: 0.01,
    budgetRoundingRule: "FLOOR_TO_CENT",
    quantityRoundingRule: "FLOOR_TO_VALID_INCREMENT",
  }),
});

export function riskSizingPolicyForVersion(version = RISK_SIZING_POLICY_VERSION) {
  const normalized = Number(version);
  const policy = POLICIES[normalized];
  if (!policy) throw new Error(`unsupported risk sizing policy version: ${version}`);
  return policy;
}
