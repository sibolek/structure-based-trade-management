import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import {
  AUTOMATED_UNTOUCHED_ONLY,
  AUTOMATED_VERSION_GAP,
  AUTOMATED_SUPERSESSION_REQUIRES_UNTOUCHED_WAITING_REVISION_0,
  PreTradeCandidateIngress,
} from "../schwab-bridge/pretrade-candidate-ingress.mjs";

const SOURCE = "SOD_A_PLUS_TRADES";

function tempStatePath() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-automated-ingress-")),
    "state.json",
  );
}

function candidate(overrides = {}) {
  return {
    candidateId: "sod-2026-09-09-nvda-vwap-reclaim-long",
    contractVersion: 1,
    schemaVersion: 1,
    source: SOURCE,
    sourceDate: "2026-09-09",
    generatedAt: "2026-09-09T14:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "VWAP reclaim continuation",
    timeframe: "2m",
    thesis: "Continuation long after a confirmed VWAP reclaim.",
    trigger: {
      type: "MANUAL_CONFIRMATION",
      prompt: "Confirm 2m reclaim and hold above VWAP",
    },
    structuralInvalidation: {
      price: 224.5,
      rule: "acceptance below reclaim structure",
      referenceType: "SWING_LOW",
      reason: "long thesis invalid below reclaimed structure",
    },
    plannedEntryReference: 225.25,
    targets: [226.5, 228],
    managementContract: { mode: "FLEXIBLE_WITHIN_CEILING" },
    validity: {
      validFrom: "2026-09-09T13:30:00.000Z",
      validUntil: "2026-09-09T20:00:00.000Z",
      timezone: "America/Denver",
      session: "RTH",
      provenance: { source: "SOD", label: "RTH opportunity window" },
    },
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

function bundle(candidates, overrides = {}) {
  return {
    source: SOURCE,
    bundleId: "sod-2026-09-09-a-plus-trades-v1",
    candidates,
    ...overrides,
  };
}

function createIngress({ times = [] } = {}) {
  let clockIndex = 0;
  let eventId = 0;
  const store = new PreTradeStore({ filePath: tempStatePath() });
  store.load();
  const ingress = new PreTradeCandidateIngress({
    store,
    clock: () => times[clockIndex++] || `2026-09-09T14:0${clockIndex}:00.000Z`,
    idFactory: () => `automated-ingress-event-${++eventId}`,
  });
  return { store, ingress };
}

function automatedImport(ingress, payload) {
  return ingress.importBundle(payload, { ingressPolicy: AUTOMATED_UNTOUCHED_ONLY });
}

function setLifecycle(store, lifecycleState, stateRevision) {
  const existing = store.state.candidates[0];
  existing.lifecycleState = lifecycleState;
  existing.stateRevision = stateRevision;
  store.save();
}

test("automated policy accepts a brand-new v1 candidate", () => {
  const { store, ingress } = createIngress();
  const result = automatedImport(ingress, bundle([candidate()]));

  assert.equal(result.ingressPolicy, AUTOMATED_UNTOUCHED_ONLY);
  assert.equal(result.outcomes[0].status, "ACCEPTED");
  assert.equal(result.outcomes[0].lifecycleState, "WAITING");
  assert.equal(result.outcomes[0].stateRevision, 0);
  assert.equal(store.snapshot().candidates.length, 1);
  assert.equal(
    store.snapshot().candidates[0].lifecycleJournal.events[0].provenance.ingressPolicy,
    AUTOMATED_UNTOUCHED_ONLY,
  );
});

test("automated policy rejects a brand-new logical candidate that starts above v1", () => {
  const { store, ingress } = createIngress();
  const result = automatedImport(ingress, bundle([
    candidate({ contractVersion: 2, thesis: "invalid lineage start" }),
  ]));

  assert.equal(result.outcomes[0].status, "REJECTED");
  assert.deepEqual(result.outcomes[0].reasons, [AUTOMATED_VERSION_GAP]);
  assert.equal(store.snapshot().candidates.length, 0);
});

test("exact automated replay remains DUPLICATE even after operator lifecycle activity", () => {
  const { store, ingress } = createIngress();
  automatedImport(ingress, bundle([candidate()], { bundleId: "v1" }));
  setLifecycle(store, "READY", 3);
  const before = structuredClone(store.snapshot().candidates[0]);

  const result = automatedImport(ingress, bundle([candidate()], { bundleId: "v1-retry" }));

  assert.equal(result.outcomes[0].status, "DUPLICATE");
  assert.deepEqual(store.snapshot().candidates[0], before);
});

test("automated v2 atomically supersedes only untouched WAITING revision 0 v1", () => {
  const { store, ingress } = createIngress({
    times: ["2026-09-09T14:01:00.000Z", "2026-09-09T14:02:00.000Z"],
  });
  automatedImport(ingress, bundle([candidate()], { bundleId: "v1" }));

  const result = automatedImport(ingress, bundle([
    candidate({
      contractVersion: 2,
      generatedAt: "2026-09-09T14:02:00.000Z",
      thesis: "Revised continuation long after stronger VWAP reclaim confirmation.",
    }),
  ], { bundleId: "v2" }));

  assert.equal(result.outcomes[0].status, "ACCEPTED");
  const state = store.snapshot();
  const v1 = state.candidates.find((item) => item.contractVersion === 1);
  const v2 = state.candidates.find((item) => item.contractVersion === 2);
  assert.equal(v1.lifecycleState, "SUPERSEDED");
  assert.equal(v1.stateRevision, 1);
  assert.equal(v1.supersededByVersion, 2);
  assert.equal(
    v1.lifecycleJournal.events.at(-1).provenance.ingressPolicy,
    AUTOMATED_UNTOUCHED_ONLY,
  );
  assert.equal(v2.lifecycleState, "WAITING");
  assert.equal(v2.stateRevision, 0);
});

test("automated higher version is blocked after any local lifecycle interaction", () => {
  const blockedStates = [
    ["WAITING", 1],
    ["READY", 2],
    ["CAUTION", 3],
    ["DECLINED", 1],
    ["ARMED", 1],
  ];

  for (const [lifecycleState, stateRevision] of blockedStates) {
    const { store, ingress } = createIngress();
    automatedImport(ingress, bundle([candidate()], { bundleId: `v1-${lifecycleState}` }));
    setLifecycle(store, lifecycleState, stateRevision);
    const before = structuredClone(store.snapshot().candidates[0]);

    const result = automatedImport(ingress, bundle([
      candidate({
        contractVersion: 2,
        generatedAt: "2026-09-09T14:03:00.000Z",
        thesis: `Revised thesis while local state is ${lifecycleState}`,
      }),
    ], { bundleId: `v2-${lifecycleState}` }));

    assert.equal(result.outcomes[0].status, "REJECTED", lifecycleState);
    assert.deepEqual(
      result.outcomes[0].reasons,
      [AUTOMATED_SUPERSESSION_REQUIRES_UNTOUCHED_WAITING_REVISION_0],
      lifecycleState,
    );
    assert.equal(store.snapshot().candidates.length, 1, lifecycleState);
    assert.deepEqual(store.snapshot().candidates[0], before, lifecycleState);
  }
});

test("automated version gap v1 to v3 is rejected without mutating v1", () => {
  const { store, ingress } = createIngress();
  automatedImport(ingress, bundle([candidate()], { bundleId: "v1" }));
  const before = structuredClone(store.snapshot().candidates[0]);

  const result = automatedImport(ingress, bundle([
    candidate({
      contractVersion: 3,
      generatedAt: "2026-09-09T14:04:00.000Z",
      thesis: "Invalid skipped version",
    }),
  ], { bundleId: "v3" }));

  assert.equal(result.outcomes[0].status, "REJECTED");
  assert.deepEqual(result.outcomes[0].reasons, [AUTOMATED_VERSION_GAP]);
  assert.equal(store.snapshot().candidates.length, 1);
  assert.deepEqual(store.snapshot().candidates[0], before);
});

test("no-policy production ingress fails closed before mutation", () => {
  const { store, ingress } = createIngress();
  assert.throws(
    () => ingress.importBundle(bundle([candidate()], { bundleId: "manual-v1" })),
    (error) => error.code === "INGRESS_POLICY_REQUIRED",
  );
  assert.equal(store.snapshot().candidates.length, 0);
});

test("unsupported ingress policy fails closed before candidate mutation", () => {
  const { store, ingress } = createIngress();

  assert.throws(
    () => ingress.importBundle(bundle([candidate()]), { ingressPolicy: "UNSAFE_AUTO_REPLACE" }),
    (error) => error.code === "INVALID_INGRESS_POLICY",
  );
  assert.equal(store.snapshot().candidates.length, 0);
});
