import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCanonicalSodCandidateBundle,
  buildManualSodIngestionEnvelope,
} from "../schwab-bridge/sod-candidate-export.mjs";
import {
  preflightManualSubmission,
  validateManualIngestionEnvelope,
} from "../schwab-bridge/manual-sod-ingestion.mjs";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { MANUAL_AUTHORIZED, PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { candidateContractHash } from "../schwab-bridge/pretrade-candidate-contract.mjs";

function draft(overrides = {}) {
  return {
    sourceDate: "2026-09-08",
    generatedAt: "2026-09-08T12:45:00.000Z",
    validity: {
      validFrom: "2026-09-08T13:25:00.000Z",
      validUntil: "2026-09-08T20:00:00.000Z",
      timezone: "America/Denver",
      session: "RTH",
      sourceLabel: "SOD_A_PLUS_TRADES",
      provenance: { source: "START_OF_DAY_REPORT" },
    },
    candidates: [
      {
        symbol: "NVDA",
        direction: "LONG",
        setup: "Breakout / Continuation",
        timeframe: "2m",
        morningPriority: 1,
        rating: "★★★★★",
        thesis: "Strong relative strength near highs.",
        plan: {
          bestLocation: "Above 232.48 or strong reclaim of 231.20",
          noTradeZone: "Do not chase a vertical breakout.",
        },
        trigger: {
          type: "MANUAL_CONFIRMATION",
          description: "Confirm breakout or reclaim with valid price action.",
        },
        structuralInvalidation: {
          price: 229.85,
          rule: "Break below 229.85 invalidates the long thesis.",
          referenceType: "PRICE",
          reason: "Continuation structure has failed.",
          sourceTimeframe: "2m",
        },
        plannedEntryReference: "Above 232.48 or strong reclaim of 231.20",
        targets: [
          { label: "T1", priceOrZone: "234.00" },
          { label: "T2", priceOrZone: "236.00" },
        ],
        riskPolicy: {
          maxPlannedLossPctOfAccountEquity: 0.5,
          sizeFromStructuralStop: true,
          tightenStopToFitRisk: false,
          onRiskFailure: "REDUCE_SIZE_OR_PASS",
        },
      },
    ],
    ...overrides,
  };
}

test("SOD exporter builds canonical V2.4 bundle and normalizes common SOD fields", () => {
  const bundle = buildCanonicalSodCandidateBundle(draft());
  const candidate = bundle.candidates[0];

  assert.equal(bundle.source, "SOD_A_PLUS_TRADES");
  assert.equal(bundle.bundleId, "sod-2026-09-08-a-plus-trades-v1");
  assert.equal(candidate.candidateId, "sod-2026-09-08-nvda-long-breakout-continuation-p1");
  assert.equal(candidate.contractVersion, 1);
  assert.equal(candidate.source, "SOD_A_PLUS_TRADES");
  assert.equal(candidate.sourceDate, "2026-09-08");
  assert.equal(candidate.generatedAt, "2026-09-08T12:45:00.000Z");
  assert.equal(candidate.decisionTimeframe, "5m");
  assert.equal(candidate.entryTimeframe, "2m");
  assert.equal(candidate.trigger.satisfaction.type, "MANUAL_CONFIRMATION");
  assert.equal(candidate.trigger.satisfaction.prompt, "Confirm breakout or reclaim with valid price action.");
  assert.equal(candidate.structuralInvalidation.price, 229.85);
  assert.equal(candidate.targets[0].price, 234);
  assert.equal(candidate.targets[1].price, 236);
  assert.equal(candidate.managementContract.mode, "SINGLE_ENTRY");
  assert.equal(candidate.managementContract.allowReAdd, false);
  assert.equal(candidate.context.riskPolicy.maxPlannedLossPctOfAccountEquity, 0.5);
  assert.equal(candidate.noTradeConditions[0], "Do not chase a vertical breakout.");
  assert.equal(candidate.validity.timezone, "America/Denver");
  assert.equal(candidate.armPolicy.requestedMode, "MANUAL");
  assert.equal(candidate.armPolicy.finalAuthorizationMode, "MANUAL");
});

test("SOD exporter builds an ingestion-ready manual proposal envelope without canonical authority fields", () => {
  const manualEnvelope = buildManualSodIngestionEnvelope(draft({
    submissionId: "manual-generated-001",
  }), {
    idFactory: () => "unused",
  });

  assert.deepEqual(validateManualIngestionEnvelope(manualEnvelope), []);
  assert.equal(manualEnvelope.ingestionSchemaVersion, 1);
  assert.equal(manualEnvelope.submission.submissionId, "manual-generated-001");
  assert.equal(manualEnvelope.submission.submissionType, "MANUAL_SOD");
  assert.equal(manualEnvelope.source, "SOD_A_PLUS_TRADES");
  const candidate = manualEnvelope.candidates[0];
  assert.equal(candidate.candidateId, "sod-2026-09-08-nvda-long-breakout-continuation-p1");
  assert.equal(Object.prototype.hasOwnProperty.call(candidate, "contractVersion"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(candidate, "schemaVersion"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(candidate, "generatedAt"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(candidate, "source"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(candidate.armPolicy, "finalAuthorizationMode"), false);
});

test("exported SOD bundle is accepted by authoritative ingress as WAITING", () => {
  const bundle = buildCanonicalSodCandidateBundle(draft());
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-sod-export-")), "state.json");
  const store = new PreTradeStore({ filePath: statePath });
  store.load();
  const ingress = new PreTradeCandidateIngress({
    store,
    clock: () => "2026-09-08T13:30:00.000Z",
    idFactory: () => "sod-export-ingress-event",
  });

  const result = ingress.importBundle(bundle, { ingressPolicy: MANUAL_AUTHORIZED });
  assert.equal(result.outcomes[0].status, "ACCEPTED");
  assert.equal(result.outcomes[0].lifecycleState, "WAITING");
  assert.equal(store.snapshot().candidates[0].contractAuthority.authority, "CANONICAL_CANDIDATE_INGRESS");
});

test("SOD exporter fails closed instead of guessing legacy free-text invalidation structure", () => {
  const input = draft();
  input.candidates[0].structuralInvalidation = {
    type: "MANUAL_CONFIRMATION",
    description: "Below 230.40 / 229.85",
  };

  assert.throws(
    () => buildCanonicalSodCandidateBundle(input),
    (error) => {
      assert.equal(error.code, "SOD_CANDIDATE_EXPORT_INVALID");
      assert.match(error.message, /structuralInvalidation\.rule is required/);
      assert.match(error.message, /resolved price or structured reference definition/);
      return true;
    },
  );
});

test("SOD exporter requires exact finite validity and never invents a session window", () => {
  const input = draft({
    validity: {
      tradeDate: "2026-09-08",
      session: "RTH",
      sourceSnapshot: "PREMARKET",
    },
  });

  assert.throws(
    () => buildCanonicalSodCandidateBundle(input),
    (error) => {
      assert.equal(error.code, "SOD_CANDIDATE_EXPORT_INVALID");
      assert.match(error.message, /validity\.validFrom/);
      assert.match(error.message, /validity\.validUntil/);
      assert.match(error.message, /valid IANA timezone/);
      return true;
    },
  );
});

test("candidate-specific partial validity fails closed instead of silently falling back to bundle validity", () => {
  const input = draft();
  input.candidates[0].validity = {
    validUntil: "2026-09-08T20:00:00.000Z",
    timezone: "America/Denver",
    session: "RTH",
  };

  assert.throws(
    () => buildCanonicalSodCandidateBundle(input),
    (error) => {
      assert.equal(error.code, "SOD_CANDIDATE_EXPORT_INVALID");
      assert.match(error.message, /validity\.validFrom/);
      return true;
    },
  );
});

test("SOD exporter refuses AUTO ARM intent", () => {
  const input = draft();
  input.candidates[0].armPolicy = { requestedMode: "AUTO" };

  assert.throws(
    () => buildCanonicalSodCandidateBundle(input),
    (error) => {
      assert.equal(error.code, "SOD_CANDIDATE_EXPORT_INVALID");
      assert.match(error.message, /SOD_A_PLUS_TRADES.*MANUAL/);
      return true;
    },
  );
});

test("SOD exporter rejects runtime authority instead of silently sanitizing it", () => {
  for (const forbidden of [
    { selectedQuantity: 25 },
    { riskEvaluation: { status: "VALID" } },
    { permissionOutcome: "READY" },
    { armAuthorized: true },
    { armPolicy: { requestedMode: "MANUAL", armAuthorized: true } },
    { lifecycleState: "READY" },
    { manualSupersessionDeclines: [{ decision: "DECLINED" }] },
  ]) {
    const input = draft();
    Object.assign(input.candidates[0], forbidden);
    assert.throws(
      () => buildCanonicalSodCandidateBundle(input),
      (error) => {
        assert.equal(error.code, "SOD_CANDIDATE_EXPORT_INVALID");
        assert.match(error.message, /runtime authority|ARM authorization/i);
        return true;
      },
    );
  }
});

test("SOD exporter rejects candidate source and sourceDate conflicts with the bundle", () => {
  const wrongSource = draft();
  wrongSource.candidates[0].source = "CHATGPT_AD_HOC";
  assert.throws(
    () => buildCanonicalSodCandidateBundle(wrongSource),
    (error) => error.code === "SOD_CANDIDATE_EXPORT_INVALID" && /source must be SOD_A_PLUS_TRADES/.test(error.message),
  );

  const wrongDate = draft();
  wrongDate.candidates[0].sourceDate = "2026-09-09";
  assert.throws(
    () => buildCanonicalSodCandidateBundle(wrongDate),
    (error) => error.code === "SOD_CANDIDATE_EXPORT_INVALID" && /conflicts with bundle sourceDate/.test(error.message),
  );
});

test("SOD exporter rejects ambiguous free-text legacy management plans", () => {
  const input = draft();
  input.candidates[0].managementPlan = "Manage against structure.";

  assert.throws(
    () => buildCanonicalSodCandidateBundle(input),
    (error) => {
      assert.equal(error.code, "SOD_CANDIDATE_EXPORT_INVALID");
      assert.match(error.message, /managementPlan.*structured object/i);
      return true;
    },
  );
});

test("SOD exporter preserves independent managementContract and managementPlan", () => {
  const input = draft();
  input.candidates[0].managementContract = {
    mode: "SINGLE_ENTRY",
    allowReAdd: false,
    allowFlatReEntry: false,
  };
  input.candidates[0].managementPlan = {
    mode: "FLEXIBLE_WITHIN_CEILING",
  };

  const bundle = buildCanonicalSodCandidateBundle(input);
  assert.deepEqual(bundle.candidates[0].managementContract, {
    mode: "SINGLE_ENTRY",
    allowReAdd: false,
    allowFlatReEntry: false,
  });
  assert.deepEqual(bundle.candidates[0].managementPlan, {
    mode: "FLEXIBLE_WITHIN_CEILING",
  });
});

test("SOD exporter preserves arbitrary inert optional content through manual PRETRADE admission", () => {
  const input = draft();
  Object.assign(input.candidates[0], {
    orderFlowContext: {
      openingDrive: "balanced",
      deltas: [{ timeframe: "2m", reading: "buyers absorbing" }],
    },
    scenarioTree: [
      { name: "base", branches: [{ if: "holds VWAP", then: "wait for trigger" }] },
      { name: "invalid", branches: [{ if: "loses structure", then: "pass" }] },
    ],
    tradeNotes: {
      operator: "Structured note survives as substantive inert JSON.",
      tags: ["manual", "a-plus"],
    },
    presentationMetadata: {
      cardAccent: "blue",
      collapsedByDefault: false,
    },
  });

  const bundle = buildCanonicalSodCandidateBundle(input);
  const candidate = bundle.candidates[0];
  assert.deepEqual(candidate.orderFlowContext.deltas[0], { timeframe: "2m", reading: "buyers absorbing" });
  assert.equal(candidate.scenarioTree[1].name, "invalid");
  assert.equal(candidate.tradeNotes.tags[1], "a-plus");
  assert.equal(candidate.presentationMetadata.cardAccent, "blue");

  const changed = buildCanonicalSodCandidateBundle(draft({
    candidates: [{
      ...input.candidates[0],
      orderFlowContext: { ...input.candidates[0].orderFlowContext, openingDrive: "trend" },
    }],
  }));
  assert.notEqual(candidateContractHash(candidate), candidateContractHash(changed.candidates[0]));

  const envelope = buildManualSodIngestionEnvelope(input, { idFactory: () => "open-content-manual" });
  assert.deepEqual(validateManualIngestionEnvelope(envelope), []);
  assert.equal(envelope.candidates[0].orderFlowContext.openingDrive, "balanced");
  const preflight = preflightManualSubmission(envelope, []);
  assert.equal(preflight.status, "PREFLIGHTED");
  assert.equal(preflight.canonicalBundle.candidates[0].scenarioTree[0].branches[0].then, "wait for trigger");

  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-open-content-")), "state.json");
  const store = new PreTradeStore({ filePath: statePath });
  store.load();
  const ingress = new PreTradeCandidateIngress({
    store,
    clock: () => "2026-09-08T13:30:00.000Z",
    idFactory: () => "open-content-ingress-event",
  });
  const result = ingress.importBundle(preflight.canonicalBundle, { ingressPolicy: MANUAL_AUTHORIZED });
  assert.equal(result.outcomes[0].status, "ACCEPTED");
  const persisted = store.snapshot().candidates[0];
  assert.equal(persisted.orderFlowContext.openingDrive, "balanced");
  assert.equal(persisted.scenarioTree[0].branches[0].then, "wait for trigger");
  assert.equal(persisted.tradeNotes.operator, "Structured note survives as substantive inert JSON.");
  assert.equal(persisted.presentationMetadata.collapsedByDefault, false);
});

test("SOD exporter rejects duplicate generated candidate identities", () => {
  const first = draft().candidates[0];
  const input = draft({ candidates: [structuredClone(first), structuredClone(first)] });

  assert.throws(
    () => buildCanonicalSodCandidateBundle(input),
    (error) => {
      assert.equal(error.code, "SOD_CANDIDATE_EXPORT_INVALID");
      assert.match(error.message, /duplicate candidateId/i);
      return true;
    },
  );
});
