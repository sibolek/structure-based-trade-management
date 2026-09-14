export function manualCandidateFixture(overrides = {}) {
  return {
    candidateId: "contract-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "AD_HOC_CHATGPT",
    sourceDate: "2026-09-05",
    generatedAt: "2026-09-05T09:00:00-04:00",
    symbol: "nvda",
    direction: "long",
    setup: "Breakout retest",
    thesis: "Continuation after clean retest",
    trigger: { type: "MANUAL_CONFIRMATION", evaluatorVersion: 1 },
    structuralInvalidation: {
      price: 179.5,
      rule: "break below retest low",
      referenceType: "SWING_LOW",
      reason: "thesis fails below structure",
    },
    managementContract: { mode: "FLEXIBLE_WITHIN_CEILING" },
    targets: [181, 182],
    validity: {
      validFrom: "2026-09-05T09:30:00-04:00",
      validUntil: "2026-09-05T16:00:00-04:00",
      timezone: "America/New_York",
      session: "rth",
    },
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}
