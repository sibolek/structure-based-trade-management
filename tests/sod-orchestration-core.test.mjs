import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCanonicalContractAuthority,
  candidateContractHash,
} from "../schwab-bridge/pretrade-candidate-contract.mjs";
import { buildCanonicalSodCandidateBundle } from "../schwab-bridge/sod-candidate-export.mjs";
import { listPendingCandidatePublications } from "../schwab-bridge/candidate-feeder.mjs";
import {
  prepareSodOrchestration,
  publishPreparedSodOrchestration,
  SOD_ORCHESTRATION_PRETRADE_PREFLIGHT_REQUIRED,
  SOD_ORCHESTRATION_READY_TO_PUBLISH,
} from "../schwab-bridge/sod-orchestration-core.mjs";
import {
  SOD_PUBLICATION_EXACT_REPLAY,
  SOD_PUBLICATION_NEW,
  SOD_PUBLICATION_PRETRADE_PREFLIGHT_REQUIRED,
} from "../schwab-bridge/sod-publication-intent.mjs";

const SOURCE_DATE = "2026-09-09";
const CANDIDATE_ID = "sod-2026-09-09-nvda-vwap-reclaim-long";

function proposal(overrides = {}) {
  return {
    candidateId: CANDIDATE_ID,
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
      provenance: { tradeDate: SOURCE_DATE },
    },
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

function request() {
  return {
    sourceDate: SOURCE_DATE,
    generationMode: "INITIAL",
    charts: [{
      chartId: "nvda-5m",
      contentRef: "chart-upload:nvda-5m",
      symbol: "NVDA",
      timeframe: "5m",
    }],
    marketContext: { session: "RTH" },
  };
}

function provider(candidateProposal) {
  return {
    async generate() {
      return {
        candidateProposals: [candidateProposal],
        report: { markdown: "# SOD" },
        dashboard: { html: "<html>SOD</html>" },
        generationMetadata: { provider: "test-double" },
      };
    },
  };
}

function canonicalPrior(candidateProposal, generatedAt = "2026-09-09T14:00:00.000Z") {
  const bundle = buildCanonicalSodCandidateBundle({
    sourceDate: SOURCE_DATE,
    generatedAt,
    bundleId: "prior-bundle",
    candidates: [candidateProposal],
  }, { automatedPublication: true, clock: () => generatedAt });
  const candidate = bundle.candidates[0];
  const hash = candidateContractHash(candidate);
  return {
    ...candidate,
    contentHash: hash,
    contractAuthority: buildCanonicalContractAuthority({
      contentHash: hash,
      bundleSource: "SOD_A_PLUS_TRADES",
      bundleId: "prior-bundle",
      acceptedAt: "2026-09-09T14:00:01.000Z",
    }),
    lifecycleState: "WAITING",
    stateRevision: 0,
    lifecycleJournal: { events: [], operations: [] },
  };
}

test("new SOD proposal prepares canonical NEW publication and atomically hands it to feeder inbox", async () => {
  const prepared = await prepareSodOrchestration({
    provider: provider(proposal()),
    request: request(),
    pretradeSnapshot: { candidates: [] },
    clock: () => "2026-09-09T15:00:00.000Z",
    bundleIdFactory: () => "sod-2026-09-09-a-plus-trades-test",
  });

  assert.equal(prepared.status, SOD_ORCHESTRATION_READY_TO_PUBLISH);
  assert.equal(prepared.requiresPretradePreflight, false);
  assert.equal(prepared.lineage[0].classification, "NEW");
  assert.equal(prepared.publicationIntents[0].publicationIntent, SOD_PUBLICATION_NEW);
  assert.equal(prepared.bundle.candidates[0].contractVersion, 1);

  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-sod-orchestrate-"));
  try {
    const publication = await publishPreparedSodOrchestration({
      prepared,
      inboxPath: inbox,
      idFactory: () => "orchestration-test",
    });
    assert.deepEqual(await listPendingCandidatePublications(inbox), [publication.finalPath]);
  } finally {
    await fs.rm(inbox, { recursive: true, force: true });
  }
});

test("unchanged SOD proposal reuses prior immutable contract and is an exact replay", async () => {
  const prior = canonicalPrior(proposal());
  const prepared = await prepareSodOrchestration({
    provider: provider(proposal()),
    request: request(),
    pretradeSnapshot: { candidates: [prior] },
    clock: () => "2026-09-09T16:00:00.000Z",
  });

  assert.equal(prepared.status, SOD_ORCHESTRATION_READY_TO_PUBLISH);
  assert.equal(prepared.lineage[0].classification, "UNCHANGED");
  assert.equal(prepared.publicationIntents[0].publicationIntent, SOD_PUBLICATION_EXACT_REPLAY);
  assert.equal(prepared.bundle.candidates[0].contractVersion, 1);
  assert.equal(prepared.bundle.candidates[0].generatedAt, "2026-09-09T14:00:00.000Z");
});

test("revised SOD proposal is lineage vNext but publication blocks pending authoritative PRETRADE preflight", async () => {
  const prior = canonicalPrior(proposal());
  const prepared = await prepareSodOrchestration({
    provider: provider(proposal({ thesis: "Updated reclaim thesis with stronger relative strength." })),
    request: request(),
    pretradeSnapshot: { candidates: [prior] },
    clock: () => "2026-09-09T16:30:00.000Z",
  });

  assert.equal(prepared.status, SOD_ORCHESTRATION_PRETRADE_PREFLIGHT_REQUIRED);
  assert.equal(prepared.requiresPretradePreflight, true);
  assert.equal(prepared.lineage[0].classification, "REVISED");
  assert.equal(prepared.bundle.candidates[0].contractVersion, 2);
  assert.equal(
    prepared.publicationIntents[0].publicationIntent,
    SOD_PUBLICATION_PRETRADE_PREFLIGHT_REQUIRED,
  );

  await assert.rejects(
    publishPreparedSodOrchestration({ prepared, inboxPath: os.tmpdir() }),
    (error) => error.code === "SOD_ORCHESTRATION_PRETRADE_PREFLIGHT_REQUIRED",
  );
});
