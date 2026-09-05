import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCanonicalCandidateIntegrity,
  buildCanonicalContractAuthority,
  candidateContractHash,
  candidateValidityStatusAt,
  normalizeCanonicalCandidateProposal,
} from "../schwab-bridge/pretrade-candidate-contract.mjs";

function proposal(overrides = {}) {
  return {
    candidateId: "contract-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "SOD_A_PLUS_TRADES",
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

function acceptedCandidate(overrides = {}) {
  const { normalized, errors } = normalizeCanonicalCandidateProposal(proposal(overrides), {
    bundleSource: overrides.source || "SOD_A_PLUS_TRADES",
  });
  assert.deepEqual(errors, []);
  const hash = candidateContractHash(normalized);
  return {
    ...normalized,
    contentHash: hash,
    contractAuthority: buildCanonicalContractAuthority({
      contentHash: hash,
      bundleSource: normalized.source,
      bundleId: "bundle-1",
      acceptedAt: "2026-09-05T13:01:00.000Z",
    }),
    lifecycleState: "WAITING",
    stateRevision: 0,
  };
}

test("canonical proposal normalizes exact timestamps, symbol/direction, timeframe defaults, and manual final ARM", () => {
  const { normalized, errors } = normalizeCanonicalCandidateProposal(proposal(), {
    bundleSource: "SOD_A_PLUS_TRADES",
  });
  assert.deepEqual(errors, []);
  assert.equal(normalized.generatedAt, "2026-09-05T13:00:00.000Z");
  assert.equal(normalized.validity.validFrom, "2026-09-05T13:30:00.000Z");
  assert.equal(normalized.validity.validUntil, "2026-09-05T20:00:00.000Z");
  assert.equal(normalized.validity.timezone, "America/New_York");
  assert.equal(normalized.validity.session, "RTH");
  assert.equal(normalized.symbol, "NVDA");
  assert.equal(normalized.direction, "LONG");
  assert.equal(normalized.decisionTimeframe, "5m");
  assert.equal(normalized.entryTimeframe, "2m");
  assert.equal(normalized.volatilityTimeframe, "2m");
  assert.equal(normalized.armPolicy.requestedMode, "MANUAL");
  assert.equal(normalized.armPolicy.finalAuthorizationMode, "MANUAL");
});

test("dynamic structural invalidation may be accepted with a structured unresolved reference instead of a guessed price", () => {
  const dynamic = proposal({
    structuralInvalidation: {
      rule: "break below resolved ORL reference",
      referenceType: "ORL",
      reference: { type: "OPENING_RANGE_LOW", durationMinutes: 5, session: "RTH" },
      reason: "opening-range structure fails",
    },
  });
  const { normalized, errors } = normalizeCanonicalCandidateProposal(dynamic, {
    bundleSource: "SOD_A_PLUS_TRADES",
  });
  assert.deepEqual(errors, []);
  assert.equal(normalized.structuralInvalidation.price, null);
  assert.equal(normalized.structuralInvalidation.reference.type, "OPENING_RANGE_LOW");
});

test("candidate validity is left-closed and right-open at exact boundaries", () => {
  const candidate = acceptedCandidate();
  assert.equal(candidateValidityStatusAt(candidate, "2026-09-05T13:29:59.999Z").status, "NOT_YET_VALID");
  assert.equal(candidateValidityStatusAt(candidate, "2026-09-05T13:30:00.000Z").status, "VALID");
  assert.equal(candidateValidityStatusAt(candidate, "2026-09-05T19:59:59.999Z").status, "VALID");
  assert.equal(candidateValidityStatusAt(candidate, "2026-09-05T20:00:00.000Z").status, "EXPIRED");
});

test("legacy candidate without canonical ingress authority remains compatibility-managed", () => {
  assert.equal(candidateValidityStatusAt({ candidateId: "legacy" }, "2026-09-05T14:00:00Z").status, "UNMANAGED_LEGACY");
});

test("canonical contract integrity accepts lifecycle-only state changes but rejects material contract mutation", () => {
  const candidate = acceptedCandidate();
  candidate.lifecycleState = "PRETRADE_TRIGGER_EVALUATING";
  candidate.stateRevision = 1;
  candidate.activation = { mode: "MANUAL" };
  assert.equal(assertCanonicalCandidateIntegrity(candidate).canonical, true);

  candidate.thesis = "silently mutated thesis";
  assert.throws(
    () => assertCanonicalCandidateIntegrity(candidate),
    (error) => error.code === "CANDIDATE_CONTRACT_INTEGRITY_ERROR",
  );
});

test("validity and management are material contract content and change the immutable hash", () => {
  const first = acceptedCandidate();
  const second = acceptedCandidate({
    contractVersion: 1,
    validity: {
      ...proposal().validity,
      validUntil: "2026-09-05T15:30:00-04:00",
    },
  });
  const third = acceptedCandidate({
    contractVersion: 1,
    managementContract: { mode: "SINGLE_ENTRY" },
  });
  assert.notEqual(first.contentHash, second.contentHash);
  assert.notEqual(first.contentHash, third.contentHash);
});

test("conflicting legacy timeframe/entryTimeframe and management aliases fail closed", () => {
  let result = normalizeCanonicalCandidateProposal(proposal({ timeframe: "2m", entryTimeframe: "5m" }), {
    bundleSource: "SOD_A_PLUS_TRADES",
  });
  assert.match(result.errors.join(" "), /timeframe.*conflict/i);

  result = normalizeCanonicalCandidateProposal(proposal({
    managementPlan: { mode: "A" },
    managementContract: { mode: "B" },
  }), { bundleSource: "SOD_A_PLUS_TRADES" });
  assert.match(result.errors.join(" "), /managementContract.*conflict/i);
});
