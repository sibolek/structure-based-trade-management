import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";

function tempStatePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-ingress-")), "state.json");
}

function candidate(overrides = {}) {
  return {
    candidateId: "sod-2026-09-05-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "SOD_A_PLUS_TRADES",
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
    armPolicy: { requestedMode: "AUTO" },
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

test("accepted candidate starts WAITING at revision 0 with durable ingress event and operation", () => {
  const { store, ingress, filePath } = createIngress({ times: ["2026-09-05T13:01:00.000Z"] });
  const result = ingress.importBundle({
    source: "SOD_A_PLUS_TRADES",
    bundleId: "2026-09-05-v1",
    candidates: [candidate()],
  });

  assert.equal(result.outcomes[0].status, "ACCEPTED");
  assert.equal(result.outcomes[0].lifecycleState, "WAITING");
  assert.equal(result.outcomes[0].stateRevision, 0);

  const accepted = store.snapshot().candidates[0];
  assert.equal(accepted.stateRevision, 0);
  assert.equal(accepted.lifecycleJournal.events.length, 1);
  assert.equal(accepted.lifecycleJournal.events[0].eventType, "CANDIDATE_ACCEPTED");
  assert.equal(accepted.lifecycleJournal.events[0].beforeState, null);
  assert.equal(accepted.lifecycleJournal.events[0].afterState, "WAITING");
  assert.equal(accepted.lifecycleJournal.events[0].resultingRevision, 0);
  assert.equal(accepted.lifecycleJournal.operations.length, 1);
  assert.equal(accepted.lifecycleJournal.operations[0].action, "ACCEPT_CANDIDATE");
  assert.ok(accepted.lifecycleJournal.operations[0].operationHash);

  const reloaded = new PreTradeStore({ filePath });
  const persisted = reloaded.load().candidates[0];
  assert.equal(persisted.stateRevision, 0);
  assert.equal(persisted.lifecycleJournal.events[0].eventType, "CANDIDATE_ACCEPTED");
  assert.equal(persisted.lifecycleJournal.operations[0].action, "ACCEPT_CANDIDATE");
});

test("duplicate same version/content remains idempotent and does not duplicate ingress provenance", () => {
  const { store, ingress } = createIngress();
  ingress.importBundle({ bundleId: "bundle-a", candidates: [candidate()] });
  const result = ingress.importBundle({ bundleId: "bundle-b", candidates: [candidate()] });

  assert.equal(result.outcomes[0].status, "DUPLICATE");
  const accepted = store.snapshot().candidates[0];
  assert.equal(accepted.stateRevision, 0);
  assert.equal(accepted.lifecycleJournal.events.length, 1);
  assert.equal(accepted.lifecycleJournal.operations.length, 1);
});

test("newer accepted version supersedes active prior version with revision and durable event", () => {
  const { store, ingress, filePath } = createIngress({
    times: ["2026-09-05T13:01:00.000Z", "2026-09-05T13:05:00.000Z"],
  });

  ingress.importBundle({ bundleId: "v1", candidates: [candidate()] });
  const result = ingress.importBundle({
    bundleId: "v2",
    candidates: [candidate({ contractVersion: 2, thesis: "Updated H2 continuation thesis" })],
  });

  assert.equal(result.outcomes[0].status, "ACCEPTED");
  const state = store.snapshot();
  const v1 = state.candidates.find((item) => item.contractVersion === 1);
  const v2 = state.candidates.find((item) => item.contractVersion === 2);

  assert.equal(v1.lifecycleState, "SUPERSEDED");
  assert.equal(v1.stateRevision, 1);
  assert.equal(v1.supersededByVersion, 2);
  assert.equal(v1.lifecycleJournal.events.length, 2);
  assert.equal(v1.lifecycleJournal.events[1].eventType, "CANDIDATE_SUPERSEDED");
  assert.equal(v1.lifecycleJournal.events[1].beforeState, "WAITING");
  assert.equal(v1.lifecycleJournal.events[1].afterState, "SUPERSEDED");
  assert.equal(v1.lifecycleJournal.events[1].resultingRevision, 1);
  assert.equal(v1.lifecycleJournal.operations.length, 2);
  assert.equal(v1.lifecycleJournal.operations[1].action, "SUPERSEDE_CANDIDATE");

  assert.equal(v2.lifecycleState, "WAITING");
  assert.equal(v2.stateRevision, 0);
  assert.equal(v2.lifecycleJournal.events[0].eventType, "CANDIDATE_ACCEPTED");

  const reloaded = new PreTradeStore({ filePath });
  const persistedV1 = reloaded.load().candidates.find((item) => item.contractVersion === 1);
  assert.equal(persistedV1.lifecycleState, "SUPERSEDED");
  assert.equal(persistedV1.stateRevision, 1);
  assert.equal(persistedV1.lifecycleJournal.events[1].eventType, "CANDIDATE_SUPERSEDED");
});

test("same version different content conflicts and older version remains stale", () => {
  const { store, ingress } = createIngress();
  ingress.importBundle({ candidates: [candidate({ contractVersion: 2 })] });

  const conflict = ingress.importBundle({ candidates: [candidate({ contractVersion: 2, thesis: "different" })] });
  assert.equal(conflict.outcomes[0].status, "CONFLICT");

  const stale = ingress.importBundle({ candidates: [candidate({ contractVersion: 1 })] });
  assert.equal(stale.outcomes[0].status, "STALE");
  assert.equal(store.snapshot().candidates.length, 1);
});

test("terminal prior version is not rewritten when newer version is accepted", () => {
  const { store, ingress } = createIngress();
  ingress.importBundle({ candidates: [candidate()] });
  store.state.candidates[0].lifecycleState = "DECLINED";
  store.state.candidates[0].stateRevision = 1;
  store.save();

  ingress.importBundle({ candidates: [candidate({ contractVersion: 2, thesis: "new version" })] });
  const prior = store.snapshot().candidates.find((item) => item.contractVersion === 1);
  assert.equal(prior.lifecycleState, "DECLINED");
  assert.equal(prior.stateRevision, 1);
  assert.equal(prior.lifecycleJournal.events.length, 1);
});

test("legacy split lifecycle arrays migrate into canonical lifecycleJournal when ingress touches candidate", () => {
  const { store, ingress } = createIngress();
  ingress.importBundle({ candidates: [candidate()] });
  const existing = store.state.candidates[0];
  existing.lifecycleEvents = existing.lifecycleJournal.events;
  existing.lifecycleOperations = existing.lifecycleJournal.operations.map((operation) => ({
    ...operation,
    fingerprint: operation.operationHash,
    operationHash: undefined,
  }));
  delete existing.lifecycleJournal;
  store.save();

  ingress.importBundle({ candidates: [candidate({ contractVersion: 2, thesis: "new version" })] });
  const migrated = store.snapshot().candidates.find((item) => item.contractVersion === 1);
  assert.equal(migrated.lifecycleJournal.events.length, 2);
  assert.equal(migrated.lifecycleJournal.operations.length, 2);
  assert.ok(migrated.lifecycleJournal.operations[0].operationHash);
  assert.equal(Object.prototype.hasOwnProperty.call(migrated, "lifecycleEvents"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(migrated, "lifecycleOperations"), false);
});

test("persistence failure rolls back acceptance and supersession mutations", () => {
  const { store, ingress } = createIngress();
  ingress.importBundle({ candidates: [candidate()] });
  const before = store.snapshot();

  const originalSave = store.save.bind(store);
  store.save = () => {
    throw Object.assign(new Error("simulated persistence failure"), { code: "SIMULATED_SAVE_FAILURE" });
  };

  assert.throws(
    () => ingress.importBundle({ candidates: [candidate({ contractVersion: 2, thesis: "new version" })] }),
    (error) => error.code === "SIMULATED_SAVE_FAILURE",
  );

  store.save = originalSave;
  assert.deepEqual(store.snapshot(), before);
});
