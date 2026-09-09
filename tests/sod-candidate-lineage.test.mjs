import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanonicalContractAuthority,
  candidateContractHash,
  canonicalCandidateContent,
  normalizeCanonicalCandidateProposal,
  SOD_A_PLUS_TRADES_SOURCE,
} from "../schwab-bridge/pretrade-candidate-contract.mjs";
import {
  candidateSubstantiveHash,
  resolveSodCandidateBundleLineage,
  resolveSodCandidateLineage,
  SOD_LINEAGE_NEW,
  SOD_LINEAGE_REVISED,
  SOD_LINEAGE_UNCHANGED,
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
    plan: {
      bullCase: "VWAP reclaim holds with higher low.",
      bearCase: "Reclaim fails back below structure.",
    },
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
    entryIntent: { mode: "BREAKOUT_PULLBACK" },
    plannedEntryReference: { label: "VWAP reclaim hold" },
    entryConstraints: { maxExtensionFromVwap: 1.5 },
    disqualifiers: ["Failed reclaim"],
    noTradeConditions: ["Mid-range chop"],
    targets: [
      { targetId: "T1", label: "T1", price: 181 },
      { targetId: "T2", label: "T2", price: 182 },
    ],
    managementContract: {
      mode: "SINGLE_ENTRY",
      allowReAdd: false,
      allowFlatReEntry: false,
    },
    bestLocation: { label: "VWAP reclaim" },
    context: { marketStructure: "bull trend" },
    catalyst: { label: "relative strength" },
    rating: "A+",
    morningPriority: 1,
    sourceProvenance: {
      chartSet: "sod-2026-09-09",
      chartCount: 7,
    },
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

function normalized(input) {
  const result = normalizeCanonicalCandidateProposal(input, { bundleSource: SOURCE });
  assert.deepEqual(result.errors, []);
  return result.normalized;
}

function canonicalPrior(input, {
  lifecycleState = "WAITING",
  stateRevision = 0,
  bundleId = "prior-sod-bundle",
  acceptedAt = "2026-09-09T14:00:01.000Z",
} = {}) {
  const contract = normalized(input);
  const hash = candidateContractHash(contract);
  return {
    ...contract,
    contentHash: hash,
    contractAuthority: buildCanonicalContractAuthority({
      contentHash: hash,
      bundleSource: SOURCE,
      bundleId,
      acceptedAt,
    }),
    lifecycleState,
    stateRevision,
    lifecycleJournal: { events: [], operations: [] },
    runtimeOnlyMarker: "MUST_NOT_LEAK_UPSTREAM",
  };
}

test("new logical SOD candidate is assigned contractVersion 1 regardless of proposal placeholder", () => {
  const proposal = candidate({ contractVersion: 99 });
  const result = resolveSodCandidateLineage(proposal, []);

  assert.equal(result.classification, SOD_LINEAGE_NEW);
  assert.equal(result.contractVersion, 1);
  assert.equal(result.priorContractVersion, null);
  assert.equal(result.candidate.contractVersion, 1);
  assert.equal(result.candidate.generatedAt, proposal.generatedAt);
  assert.equal(result.reusedPriorContract, false);
});

test("generatedAt-only rerun is UNCHANGED and reuses exact prior immutable contract fields", () => {
  const prior = canonicalPrior(candidate(), {
    lifecycleState: "READY",
    stateRevision: 7,
  });
  const rerun = candidate({
    contractVersion: 42,
    generatedAt: "2026-09-09T15:15:00.000Z",
  });

  const result = resolveSodCandidateLineage(rerun, [prior]);

  assert.equal(result.classification, SOD_LINEAGE_UNCHANGED);
  assert.equal(result.contractVersion, 1);
  assert.equal(result.priorContractVersion, 1);
  assert.equal(result.reusedPriorContract, true);
  assert.equal(result.candidate.generatedAt, "2026-09-09T14:00:00.000Z");
  assert.deepEqual(result.candidate, canonicalCandidateContent(prior));
  assert.equal("lifecycleState" in result.candidate, false);
  assert.equal("stateRevision" in result.candidate, false);
  assert.equal("contentHash" in result.candidate, false);
  assert.equal("contractAuthority" in result.candidate, false);
  assert.equal("runtimeOnlyMarker" in result.candidate, false);
});

test("substantive rerun is REVISED with exactly newest prior version plus one and proposed generatedAt", () => {
  const prior = canonicalPrior(candidate());
  const rerun = candidate({
    contractVersion: 1,
    generatedAt: "2026-09-09T15:15:00.000Z",
    thesis: "Continuation after reclaim, higher low, and renewed momentum.",
  });

  const result = resolveSodCandidateLineage(rerun, [prior]);

  assert.equal(result.classification, SOD_LINEAGE_REVISED);
  assert.equal(result.contractVersion, 2);
  assert.equal(result.priorContractVersion, 1);
  assert.equal(result.candidate.contractVersion, 2);
  assert.equal(result.candidate.generatedAt, "2026-09-09T15:15:00.000Z");
  assert.notEqual(result.substantiveHash, result.priorSubstantiveHash);
  assert.equal(result.reusedPriorContract, false);
});

test("morning priority validity and provenance are substantive lineage fields", async (t) => {
  const prior = canonicalPrior(candidate());
  const cases = [
    ["morning priority", { morningPriority: 2 }],
    ["validity", {
      validity: {
        ...candidate().validity,
        validUntil: "2026-09-09T19:30:00.000Z",
      },
    }],
    ["source provenance", {
      sourceProvenance: {
        ...candidate().sourceProvenance,
        chartCount: 8,
      },
    }],
  ];

  for (const [name, override] of cases) {
    await t.test(name, () => {
      const result = resolveSodCandidateLineage(candidate({
        ...override,
        generatedAt: "2026-09-09T15:30:00.000Z",
      }), [prior]);
      assert.equal(result.classification, SOD_LINEAGE_REVISED);
      assert.equal(result.contractVersion, 2);
    });
  }
});

test("newest canonical prior version is the comparison authority", () => {
  const v1 = canonicalPrior(candidate());
  const v2 = canonicalPrior(candidate({
    contractVersion: 2,
    generatedAt: "2026-09-09T14:30:00.000Z",
    thesis: "Updated continuation thesis.",
  }), { bundleId: "prior-sod-bundle-v2", acceptedAt: "2026-09-09T14:30:01.000Z" });

  const rerun = candidate({
    contractVersion: 88,
    generatedAt: "2026-09-09T16:00:00.000Z",
    thesis: "Updated continuation thesis.",
  });
  const result = resolveSodCandidateLineage(rerun, [v1, v2]);

  assert.equal(result.classification, SOD_LINEAGE_UNCHANGED);
  assert.equal(result.contractVersion, 2);
  assert.equal(result.candidate.generatedAt, "2026-09-09T14:30:00.000Z");
});

test("lineage refuses missing explicit identity and untrusted prior state", () => {
  assert.throws(
    () => resolveSodCandidateLineage(candidate({ candidateId: "" }), []),
    (error) => error.code === "SOD_LINEAGE_CANDIDATE_ID_REQUIRED",
  );

  const legacyPrior = {
    ...normalized(candidate()),
    lifecycleState: "WAITING",
    stateRevision: 0,
  };
  assert.throws(
    () => resolveSodCandidateLineage(candidate(), [legacyPrior]),
    (error) => error.code === "SOD_LINEAGE_PRIOR_NOT_CANONICAL",
  );

  const tampered = canonicalPrior(candidate());
  tampered.thesis = "tampered after acceptance";
  assert.throws(
    () => resolveSodCandidateLineage(candidate(), [tampered]),
    (error) => error.code === "CANDIDATE_CONTRACT_INTEGRITY_ERROR",
  );
});

test("bundle lineage resolves NEW UNCHANGED and REVISED together without runtime authority leakage", () => {
  const unchangedPrior = canonicalPrior(candidate());
  const revisedId = "sod-2026-09-09-amd-vwap-reclaim-long";
  const revisedPrior = canonicalPrior(candidate({
    candidateId: revisedId,
    symbol: "AMD",
  }));
  const newId = "sod-2026-09-09-meta-breakout-pullback-long";

  const bundle = {
    schemaVersion: 1,
    source: SOURCE,
    sourceDate: "2026-09-09",
    generatedAt: "2026-09-09T15:45:00.000Z",
    bundleId: "sod-2026-09-09-a-plus-trades-v2",
    ingressPolicy: "AUTOMATED_UNTOUCHED_ONLY",
    candidates: [
      candidate({ generatedAt: "2026-09-09T15:45:00.000Z" }),
      candidate({
        candidateId: revisedId,
        symbol: "AMD",
        generatedAt: "2026-09-09T15:45:00.000Z",
        thesis: "AMD reclaim with improving relative strength.",
      }),
      candidate({
        candidateId: newId,
        symbol: "META",
        setup: "Breakout pullback",
        generatedAt: "2026-09-09T15:45:00.000Z",
      }),
    ],
  };

  const result = resolveSodCandidateBundleLineage(bundle, [unchangedPrior, revisedPrior]);
  assert.deepEqual(
    result.lineage.map((item) => item.classification),
    [SOD_LINEAGE_UNCHANGED, SOD_LINEAGE_REVISED, SOD_LINEAGE_NEW],
  );
  assert.deepEqual(
    result.bundle.candidates.map((item) => item.contractVersion),
    [1, 2, 1],
  );
  for (const item of result.bundle.candidates) {
    assert.equal("lifecycleState" in item, false);
    assert.equal("stateRevision" in item, false);
    assert.equal("contentHash" in item, false);
    assert.equal("contractAuthority" in item, false);
  }
});

test("substantive hash ignores only publication time and version", () => {
  const base = normalized(candidate());
  const sameSubstance = normalized(candidate({
    contractVersion: 19,
    generatedAt: "2026-09-09T18:00:00.000Z",
  }));
  const changed = normalized(candidate({
    context: { marketStructure: "trading range" },
  }));

  assert.equal(candidateSubstantiveHash(base), candidateSubstantiveHash(sameSubstance));
  assert.notEqual(candidateSubstantiveHash(base), candidateSubstantiveHash(changed));
});
