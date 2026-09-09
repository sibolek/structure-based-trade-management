import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanonicalContractAuthority,
  candidateContractHash,
  normalizeCanonicalCandidateProposal,
  SOD_A_PLUS_TRADES_SOURCE,
} from "../schwab-bridge/pretrade-candidate-contract.mjs";
import {
  resolveSodCandidateLineage,
  SOD_LINEAGE_SOURCE_DATE_CONFLICT,
} from "../schwab-bridge/sod-candidate-lineage.mjs";

const SOURCE = SOD_A_PLUS_TRADES_SOURCE;
const CANDIDATE_ID = "sod-2026-09-09-nvda-vwap-reclaim-long";

function candidate(overrides = {}) {
  return {
    candidateId: CANDIDATE_ID,
    contractVersion: 1,
    schemaVersion: 1,
    source: SOURCE,
    sourceDate: "2026-09-09",
    generatedAt: "2026-09-09T14:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "VWAP reclaim",
    decisionTimeframe: "5m",
    entryTimeframe: "2m",
    volatilityTimeframe: "2m",
    timeframe: "2m",
    thesis: "Continuation after reclaim and hold.",
    plan: null,
    trigger: {
      schemaVersion: 1,
      evaluatorVersion: 1,
      satisfaction: {
        nodeId: "operator-confirm-vwap-reclaim",
        type: "MANUAL_CONFIRMATION",
        prompt: "Confirm VWAP reclaim and hold",
      },
      persistence: { type: "ONE_SHOT" },
    },
    structuralInvalidation: {
      price: 178.5,
      rule: "break below reclaim low",
      referenceType: "SWING_LOW",
      reason: "long thesis invalid",
      sourceTimeframe: "2m",
    },
    entryIntent: null,
    plannedEntryReference: null,
    entryConstraints: null,
    disqualifiers: null,
    noTradeConditions: null,
    targets: [{ targetId: "T1", label: "T1", price: 181 }],
    managementContract: {
      mode: "SINGLE_ENTRY",
      allowReAdd: false,
      allowFlatReEntry: false,
    },
    bestLocation: null,
    context: null,
    catalyst: null,
    rating: "A+",
    morningPriority: 1,
    sourceProvenance: { chartSet: "sod-2026-09-09" },
    validity: {
      validFrom: "2026-09-09T13:30:00.000Z",
      validUntil: "2026-09-09T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
      sourceLabel: "SOD",
      provenance: { tradeDate: "2026-09-09" },
    },
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

function canonicalPrior(input) {
  const normalized = normalizeCanonicalCandidateProposal(input, { bundleSource: SOURCE });
  assert.deepEqual(normalized.errors, []);
  const hash = candidateContractHash(normalized.normalized);
  return {
    ...normalized.normalized,
    contentHash: hash,
    contractAuthority: buildCanonicalContractAuthority({
      contentHash: hash,
      bundleSource: SOURCE,
      bundleId: "prior-bundle",
      acceptedAt: "2026-09-09T14:00:01.000Z",
    }),
    lifecycleState: "WAITING",
    stateRevision: 0,
    lifecycleJournal: { events: [], operations: [] },
  };
}

test("same SOD candidateId may not cross sourceDate identity boundary", () => {
  const prior = canonicalPrior(candidate());
  const nextDayProposal = candidate({
    sourceDate: "2026-09-10",
    generatedAt: "2026-09-10T13:45:00.000Z",
    sourceProvenance: { chartSet: "sod-2026-09-10" },
    validity: {
      validFrom: "2026-09-10T13:30:00.000Z",
      validUntil: "2026-09-10T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
      sourceLabel: "SOD",
      provenance: { tradeDate: "2026-09-10" },
    },
  });

  assert.throws(
    () => resolveSodCandidateLineage(nextDayProposal, [prior]),
    (error) => {
      assert.equal(error.code, SOD_LINEAGE_SOURCE_DATE_CONFLICT);
      assert.equal(error.details.candidateId, CANDIDATE_ID);
      assert.equal(error.details.proposalSourceDate, "2026-09-10");
      assert.deepEqual(error.details.priorSourceDates, ["2026-09-09"]);
      return true;
    },
  );
});
