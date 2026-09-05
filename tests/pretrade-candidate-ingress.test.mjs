import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";

const SOURCE = "SOD_A_PLUS_TRADES";

function tempStatePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-ingress-")), "state.json");
}

function candidate(overrides = {}) {
  return {
    candidateId: "sod-2026-09-05-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: SOURCE,
    sourceDate: "2026-09-05",
    generatedAt: "2026-09-05T13:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "H2 trend continuation",
    timeframe: "2m",
    thesis: "Second-entry continuation after pullback",
    trigger: { type: "MANUAL_CONFIRMATION", prompt: "Confirm H2 signal bar" },
    structuralInvalidation: {
      price: 176.5,
      rule: "break below pullback low",
      referenceType: "PULLBACK_LOW",
      reason: "long thesis invalid below pullback structure",
    },
    plannedEntryReference: 177.25,
    targets: [178.5, 180],
    managementPlan: { mode: "FLEXIBLE_WITHIN_CEILING" },
    validity: {
      validFrom: "2026-09-05T13:00:00.000Z",
      validUntil: "2026-09-05T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
      provenance: { source: "SOD", label: "RTH opportunity window" },
    },
    armPolicy: { requestedMode: "MANUAL", armAuthorized: false },
    armAuthorized: false,
    status: "WAITING",
    ...overrides,
  };
}

function bundle(candidates, overrides = {}) {
  return {
    source: SOURCE,
    bundleId: "2026-09-05-v1",
    candidates,
    ...overrides,
  };
}

function createIngress({ filePath = tempStatePath(), times = [] } = {}) {
  let clockIndex = 0;
  let id = 0;
  const store = new PreTradeStore({ filePath });
  store.load();
  const ingress = new PreTradeCandidateIngress({
    store,
    clock: () => times[clockIndex++] || `2026-09-05T13:0${clockIndex}:00.000Z`,
    idFactory: () => `ingress-event-${++id}`,
  });
  return { store, ingress, filePath };
}

test("accepted canonical candidate starts WAITING with exact validity and immutable ingress provenance", () => {
  const { store, ingress, filePath } = createIngress({ times: ["2026-09-05T13:01:00.000Z"] });
  const result = ingress.importBundle(bundle([candidate()]));

  assert.equal(result.outcomes[0].status, "ACCEPTED");
  assert.equal(result.outcomes[0].lifecycleState, "WAITING");
  assert.equal(result.outcomes[0].stateRevision, 0);
  assert.ok(result.outcomes[0].contentHash);

  const accepted = store.snapshot().candidates[0];
  assert.equal(accepted.source, SOURCE);
  assert.equal(accepted.decisionTimeframe, "5m");
  assert.equal(accepted.entryTimeframe, "2m");
  assert.equal(accepted.volatilityTimeframe, "2m");
  assert.equal(accepted.validity.validFrom, "2026-09-05T13:00:00.000Z");
  assert.equal(accepted.validity.validUntil, "2026-09-05T20:00:00.000Z");
  assert.equal(accepted.validity.timezone, "America/New_York");
  assert.equal(accepted.validity.session, "RTH");
  assert.equal(accepted.armPolicy.finalAuthorizationMode, "MANUAL");
  assert.equal(accepted.armAuthorized, false);
  assert.equal(accepted.contractAuthority.authority, "CANONICAL_CANDIDATE_INGRESS");
  assert.equal(accepted.contractAuthority.contentHash, accepted.contentHash);
  assert.equal(accepted.stateRevision, 0);
  assert.equal(accepted.lifecycleJournal.events.length, 1);
  assert.equal(accepted.lifecycleJournal.events[0].eventType, "CANDIDATE_ACCEPTED");
  assert.equal(accepted.lifecycleJournal.operations.length, 1);
  assert.equal(accepted.lifecycleJournal.operations[0].action, "ACCEPT_CANDIDATE");

  const reloaded = new PreTradeStore({ filePath });
  const persisted = reloaded.load().candidates[0];
  assert.equal(persisted.contractAuthority.contentHash, accepted.contentHash);
  assert.equal(persisted.lifecycleJournal.events[0].eventType, "CANDIDATE_ACCEPTED");
});

test("canonical ingress requires authoritative bundle source and bundleId", () => {
  const { ingress } = createIngress();
  assert.throws(
    () => ingress.importBundle({ bundleId: "x", candidates: [candidate()] }),
    (error) => error.code === "INVALID_BUNDLE_SOURCE",
  );
  assert.throws(
    () => ingress.importBundle({ source: SOURCE, candidates: [candidate()] }),
    (error) => error.code === "INVALID_BUNDLE_ID",
  );
});

test("candidate source must match bundle source and SOD requires manual ARM intent", () => {
  const { ingress } = createIngress();
  const mismatch = ingress.importBundle(bundle([candidate({ source: "SCANNER" })]));
  assert.equal(mismatch.outcomes[0].status, "REJECTED");
  assert.match(mismatch.outcomes[0].reasons.join(" "), /source must match/i);

  const autoSod = ingress.importBundle(bundle([candidate({ armPolicy: { requestedMode: "AUTO" } })], { bundleId: "auto-sod" }));
  assert.equal(autoSod.outcomes[0].status, "REJECTED");
  assert.match(autoSod.outcomes[0].reasons.join(" "), /SOD_A_PLUS_TRADES.*MANUAL/i);
});

test("non-SOD upstream AUTO intent may be preserved but final ARM authority remains MANUAL", () => {
  const { store, ingress } = createIngress();
  const source = "CHATGPT_AD_HOC";
  const proposed = candidate({ source, armPolicy: { requestedMode: "AUTO", armAuthorized: false }, armAuthorized: false });
  const result = ingress.importBundle({ source, bundleId: "adhoc-1", candidates: [proposed] });
  assert.equal(result.outcomes[0].status, "ACCEPTED");
  const accepted = store.snapshot().candidates[0];
  assert.equal(accepted.armPolicy.requestedMode, "AUTO");
  assert.equal(accepted.armPolicy.finalAuthorizationMode, "MANUAL");
  assert.equal(accepted.armAuthorized, false);
});

test("upstream proposal cannot import permission ARM risk quantity or execution authority", () => {
  const authorityOverrides = [
    { armAuthorized: true },
    { arm: { authorizedAt: "2026-09-05T13:00:00Z" } },
    { selectedQuantity: 25 },
    { riskEvaluation: { status: "VALID" } },
    { lifecycleState: "READY" },
  ];

  for (const [index, overrides] of authorityOverrides.entries()) {
    const { ingress } = createIngress();
    const result = ingress.importBundle(bundle([candidate(overrides)], { bundleId: `forbidden-${index}` }));
    assert.equal(result.outcomes[0].status, "REJECTED");
  }
});

test("finite exact validity is mandatory and friendly labels alone cannot be accepted", () => {
  const invalidValidity = [
    null,
    { sourceLabel: "morning only", timezone: "America/New_York", session: "RTH" },
    { validFrom: "2026-09-05T09:30:00", validUntil: "2026-09-05T16:00:00", timezone: "America/New_York", session: "RTH" },
    { validFrom: "2026-09-05T20:00:00Z", validUntil: "2026-09-05T13:00:00Z", timezone: "America/New_York", session: "RTH" },
    { validFrom: "2026-09-05T13:00:00Z", validUntil: "2026-09-05T20:00:00Z", timezone: "Not/AZone", session: "RTH" },
    { validFrom: "2026-09-05T13:00:00Z", validUntil: "2026-09-05T20:00:00Z", timezone: "America/New_York" },
  ];

  for (const [index, validity] of invalidValidity.entries()) {
    const { ingress } = createIngress();
    const result = ingress.importBundle(bundle([candidate({ validity })], { bundleId: `invalid-validity-${index}` }));
    assert.equal(result.outcomes[0].status, "REJECTED");
  }
});

test("equivalent absolute validity representations normalize to one idempotent contract", () => {
  const { store, ingress } = createIngress();
  ingress.importBundle(bundle([candidate()], { bundleId: "bundle-a" }));
  const equivalent = candidate({
    generatedAt: "2026-09-05T09:00:00-04:00",
    validity: {
      validFrom: "2026-09-05T09:00:00-04:00",
      validUntil: "2026-09-05T16:00:00-04:00",
      timezone: "America/New_York",
      session: "RTH",
      provenance: { source: "SOD", label: "RTH opportunity window" },
    },
  });
  const result = ingress.importBundle(bundle([equivalent], { bundleId: "bundle-b" }));

  assert.equal(result.outcomes[0].status, "DUPLICATE");
  const accepted = store.snapshot().candidates[0];
  assert.equal(accepted.lifecycleJournal.events.length, 1);
  assert.equal(accepted.lifecycleJournal.operations.length, 1);
});

test("material validity change on same contractVersion is a fail-closed conflict", () => {
  const { ingress } = createIngress();
  ingress.importBundle(bundle([candidate()], { bundleId: "v1-a" }));
  const conflict = ingress.importBundle(bundle([candidate({
    validity: {
      ...candidate().validity,
      validUntil: "2026-09-05T19:30:00.000Z",
    },
  })], { bundleId: "v1-b" }));
  assert.equal(conflict.outcomes[0].status, "CONFLICT");
});

test("newer accepted version supersedes active prior version with revision and durable event", () => {
  const { store, ingress, filePath } = createIngress({
    times: ["2026-09-05T13:01:00.000Z", "2026-09-05T13:05:00.000Z"],
  });

  ingress.importBundle(bundle([candidate()], { bundleId: "v1" }));
  const result = ingress.importBundle(bundle([
    candidate({ contractVersion: 2, thesis: "Updated H2 continuation thesis" }),
  ], { bundleId: "v2" }));

  assert.equal(result.outcomes[0].status, "ACCEPTED");
  const state = store.snapshot();
  const v1 = state.candidates.find((item) => item.contractVersion === 1);
  const v2 = state.candidates.find((item) => item.contractVersion === 2);

  assert.equal(v1.lifecycleState, "SUPERSEDED");
  assert.equal(v1.stateRevision, 1);
  assert.equal(v1.supersededByVersion, 2);
  assert.equal(v1.lifecycleJournal.events[1].eventType, "CANDIDATE_SUPERSEDED");
  assert.equal(v1.lifecycleJournal.events[1].beforeState, "WAITING");
  assert.equal(v1.lifecycleJournal.events[1].afterState, "SUPERSEDED");
  assert.equal(v2.lifecycleState, "WAITING");
  assert.equal(v2.stateRevision, 0);

  const reloaded = new PreTradeStore({ filePath });
  const persistedV1 = reloaded.load().candidates.find((item) => item.contractVersion === 1);
  assert.equal(persistedV1.lifecycleState, "SUPERSEDED");
  assert.equal(persistedV1.lifecycleJournal.events[1].eventType, "CANDIDATE_SUPERSEDED");
});

test("older version is stale and terminal prior version is not rewritten by a newer version", () => {
  const { store, ingress } = createIngress();
  ingress.importBundle(bundle([candidate({ contractVersion: 2 })], { bundleId: "v2-first" }));
  const stale = ingress.importBundle(bundle([candidate({ contractVersion: 1 })], { bundleId: "v1-late" }));
  assert.equal(stale.outcomes[0].status, "STALE");

  const existing = store.state.candidates[0];
  existing.lifecycleState = "DECLINED";
  existing.stateRevision = 1;
  store.save();
  ingress.importBundle(bundle([candidate({ contractVersion: 3, thesis: "third version" })], { bundleId: "v3" }));
  const prior = store.snapshot().candidates.find((item) => item.contractVersion === 2);
  assert.equal(prior.lifecycleState, "DECLINED");
  assert.equal(prior.stateRevision, 1);
});

test("ARMED prior version is immutable and is never superseded operationally", () => {
  const { store, ingress } = createIngress();
  ingress.importBundle(bundle([candidate()], { bundleId: "v1" }));
  const prior = store.state.candidates[0];
  prior.lifecycleState = "ARMED";
  prior.stateRevision = 1;
  prior.armAuthorized = true;
  store.save();

  ingress.importBundle(bundle([candidate({ contractVersion: 2, thesis: "new opportunity version" })], { bundleId: "v2" }));
  const persistedPrior = store.snapshot().candidates.find((item) => item.contractVersion === 1);
  assert.equal(persistedPrior.lifecycleState, "ARMED");
  assert.equal(persistedPrior.stateRevision, 1);
  assert.equal(persistedPrior.supersededByVersion, undefined);
});

test("canonical contract tampering fails closed before duplicate or supersession processing", () => {
  const { store, ingress } = createIngress();
  ingress.importBundle(bundle([candidate()], { bundleId: "v1" }));
  store.state.candidates[0].thesis = "tampered without contractVersion";
  store.save();

  assert.throws(
    () => ingress.importBundle(bundle([candidate()], { bundleId: "duplicate-after-tamper" })),
    (error) => error.code === "CANDIDATE_CONTRACT_INTEGRITY_ERROR",
  );
  assert.throws(
    () => ingress.importBundle(bundle([candidate({ contractVersion: 2, thesis: "valid new version" })], { bundleId: "v2-after-tamper" })),
    (error) => error.code === "CANDIDATE_CONTRACT_INTEGRITY_ERROR",
  );
});

test("legacy split lifecycle arrays migrate into canonical lifecycleJournal when ingress touches candidate", () => {
  const { store, ingress } = createIngress();
  ingress.importBundle(bundle([candidate()], { bundleId: "v1" }));
  const existing = store.state.candidates[0];
  existing.lifecycleEvents = existing.lifecycleJournal.events;
  existing.lifecycleOperations = existing.lifecycleJournal.operations.map((operation) => ({
    ...operation,
    fingerprint: operation.operationHash,
    operationHash: undefined,
  }));
  delete existing.lifecycleJournal;
  store.save();

  ingress.importBundle(bundle([candidate({ contractVersion: 2, thesis: "new version" })], { bundleId: "v2" }));
  const migrated = store.snapshot().candidates.find((item) => item.contractVersion === 1);
  assert.equal(migrated.lifecycleJournal.events.length, 2);
  assert.equal(migrated.lifecycleJournal.operations.length, 2);
  assert.ok(migrated.lifecycleJournal.operations[0].operationHash);
  assert.equal(Object.prototype.hasOwnProperty.call(migrated, "lifecycleEvents"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(migrated, "lifecycleOperations"), false);
});

test("persistence failure rolls back acceptance and supersession mutations", () => {
  const { store, ingress } = createIngress();
  ingress.importBundle(bundle([candidate()], { bundleId: "v1" }));
  const before = store.snapshot();

  const originalSave = store.save.bind(store);
  store.save = () => {
    throw Object.assign(new Error("simulated persistence failure"), { code: "SIMULATED_SAVE_FAILURE" });
  };

  assert.throws(
    () => ingress.importBundle(bundle([candidate({ contractVersion: 2, thesis: "new version" })], { bundleId: "v2" })),
    (error) => error.code === "SIMULATED_SAVE_FAILURE",
  );

  store.save = originalSave;
  assert.deepEqual(store.snapshot(), before);
});
