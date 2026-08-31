import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";

function tempStatePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-dss-life-")), "state.json");
}

function candidate(overrides = {}) {
  return {
    candidateId: "sod-2026-08-31-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "SOD_A_PLUS",
    sourceDate: "2026-08-31",
    generatedAt: "2026-08-31T12:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "PMH breakout retest",
    timeframe: "2m",
    thesis: "Breakout acceptance holds above PMH",
    trigger: { type: "RETEST_HOLD" },
    structuralInvalidation: {
      price: 216.25,
      rule: "LOSS_OF_PULLBACK_LOW",
      referenceType: "BREAKOUT_PULLBACK_LOW",
      reason: "breakout/retest thesis fails below pullback structure",
    },
    plannedEntryReference: 217.10,
    targets: [218, 219],
    managementPlan: "Manage against structure",
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

function setLifecycle(filePath, lifecycleState, extra = {}) {
  const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
  Object.assign(state.candidates[0], { lifecycleState, ...extra });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function permissionStore({ lifecycleState = "PERMISSION_EVALUATING" } = {}) {
  const filePath = tempStatePath();
  let now = "2026-08-31T14:36:05.000Z";
  const store = new PreTradeStore({ filePath, clock: () => now });
  store.load();
  store.importBundle({ candidates: [candidate()] });
  setLifecycle(filePath, lifecycleState);
  store.load();
  return {
    filePath,
    store,
    setNow(value) { now = value; },
  };
}

function validEvaluation(store, overrides = {}) {
  const c = store.snapshot().candidates[0];
  return {
    dssEvaluationId: "dss-eval-001",
    status: "VALID",
    reasonCodes: [],
    candidateId: c.candidateId,
    sourceId: c.source,
    candidateContractVersion: c.contractVersion,
    candidateContentHash: c.contentHash,
    latestCompletedBar: {
      timestamp: Date.parse("2026-08-31T14:34:00.000Z"),
      timeframe: "2m",
      complete: true,
    },
    effectiveStop: 216.01,
    evaluatedAt: "2026-08-31T14:36:05.000Z",
    ...overrides,
  };
}

test("recorded DSS evaluation is immutable, persisted, and becomes the candidate current pointer", () => {
  const { filePath, store } = permissionStore();
  const evaluation = validEvaluation(store);
  const before = structuredClone(evaluation);

  const result = store.recordDssEvaluation(evaluation);
  evaluation.effectiveStop = 999;

  assert.equal(result.dssEvaluationId, "dss-eval-001");
  const state = store.snapshot();
  assert.equal(state.dssEvaluations.length, 1);
  assert.deepEqual(state.dssEvaluations[0], before);
  assert.equal(state.candidates[0].currentDssEvaluationId, "dss-eval-001");
  assert.equal(state.candidates[0].authorizedDssEvaluationId, null);
  assert.equal(state.candidates[0].currentDssEvaluationStale, false);

  const reloaded = new PreTradeStore({ filePath });
  const persisted = reloaded.load();
  assert.deepEqual(persisted.dssEvaluations[0], before);
  assert.equal(persisted.candidates[0].currentDssEvaluationId, "dss-eval-001");
});

test("each DSS evaluation identity is append-only and may not be reused", () => {
  const { store } = permissionStore();
  store.recordDssEvaluation(validEvaluation(store));

  assert.throws(
    () => store.recordDssEvaluation(validEvaluation(store, { effectiveStop: 215.50 })),
    (error) => error.code === "DSS_EVALUATION_ID_CONFLICT",
  );
  assert.equal(store.snapshot().dssEvaluations.length, 1);
});

test("WAITING candidate cannot continuously record DSS evaluations", () => {
  const { store } = permissionStore({ lifecycleState: "WAITING" });

  assert.throws(
    () => store.recordDssEvaluation(validEvaluation(store)),
    (error) => error.code === "DSS_EVALUATION_NOT_ALLOWED_IN_STATE",
  );
  assert.equal(store.snapshot().dssEvaluations.length, 0);
});

test("BLOCKED and ERROR evaluations are preserved but cannot hand off to Phase 4", () => {
  for (const status of ["BLOCKED", "ERROR"]) {
    const { store } = permissionStore();
    store.recordDssEvaluation(validEvaluation(store, {
      dssEvaluationId: `dss-${status.toLowerCase()}`,
      status,
      effectiveStop: null,
    }));

    assert.equal(store.snapshot().dssEvaluations[0].status, status);
    assert.throws(
      () => store.currentDssEvaluationForRiskHandoff("sod-2026-08-31-NVDA-1", 1),
      (error) => error.code === "DSS_EVALUATION_NOT_VALID",
    );
  }
});

test("a newer completed 2-minute bar marks the current evaluation stale without mutating history", () => {
  const { store } = permissionStore();
  store.recordDssEvaluation(validEvaluation(store));
  const before = structuredClone(store.snapshot().dssEvaluations[0]);

  const result = store.markCurrentDssEvaluationStale({
    candidateId: "sod-2026-08-31-NVDA-1",
    contractVersion: 1,
    completedBarTimestamp: Date.parse("2026-08-31T14:36:00.000Z"),
    observedAt: "2026-08-31T14:38:01.000Z",
  });

  assert.equal(result.status, "STALE");
  const state = store.snapshot();
  assert.deepEqual(state.dssEvaluations[0], before);
  assert.equal(state.candidates[0].currentDssEvaluationId, "dss-eval-001");
  assert.equal(state.candidates[0].currentDssEvaluationStale, true);
  assert.equal(state.candidates[0].currentDssEvaluationStaleReason, "NEW_COMPLETED_2M_BAR");
  assert.equal(state.candidates[0].currentDssEvaluationStaleBarTimestamp, Date.parse("2026-08-31T14:36:00.000Z"));
  assert.throws(
    () => store.currentDssEvaluationForRiskHandoff("sod-2026-08-31-NVDA-1", 1),
    (error) => error.code === "STALE_DSS_EVALUATION",
  );
});

test("same or older completed bar does not stale the current DSS evaluation", () => {
  const { store } = permissionStore();
  store.recordDssEvaluation(validEvaluation(store));

  const same = store.markCurrentDssEvaluationStale({
    candidateId: "sod-2026-08-31-NVDA-1",
    contractVersion: 1,
    completedBarTimestamp: Date.parse("2026-08-31T14:34:00.000Z"),
  });
  const older = store.markCurrentDssEvaluationStale({
    candidateId: "sod-2026-08-31-NVDA-1",
    contractVersion: 1,
    completedBarTimestamp: Date.parse("2026-08-31T14:32:00.000Z"),
  });

  assert.equal(same.status, "IGNORED");
  assert.equal(older.status, "IGNORED");
  assert.equal(store.snapshot().candidates[0].currentDssEvaluationStale, false);
});

test("staleness is tracked only while permission remains active", () => {
  for (const lifecycleState of ["READY", "CAUTION"]) {
    const { filePath, store } = permissionStore();
    store.recordDssEvaluation(validEvaluation(store));
    setLifecycle(filePath, lifecycleState);
    store.load();
    const result = store.markCurrentDssEvaluationStale({
      candidateId: "sod-2026-08-31-NVDA-1",
      contractVersion: 1,
      completedBarTimestamp: Date.parse("2026-08-31T14:36:00.000Z"),
    });
    assert.equal(result.status, "STALE");
  }

  for (const lifecycleState of ["WAITING", "PRETRADE_TRIGGER_EVALUATING", "PASS", "ARMED"]) {
    const { filePath, store } = permissionStore();
    store.recordDssEvaluation(validEvaluation(store));
    setLifecycle(filePath, lifecycleState);
    store.load();
    const result = store.markCurrentDssEvaluationStale({
      candidateId: "sod-2026-08-31-NVDA-1",
      contractVersion: 1,
      completedBarTimestamp: Date.parse("2026-08-31T14:36:00.000Z"),
    });
    assert.equal(result.status, "IGNORED");
    assert.equal(store.snapshot().candidates[0].currentDssEvaluationStale, false);
  }
});

test("risk handoff returns the exact fresh VALID evaluation without granting ARM authority", () => {
  const { store } = permissionStore();
  const evaluation = validEvaluation(store);
  store.recordDssEvaluation(evaluation);

  const handoff = store.currentDssEvaluationForRiskHandoff("sod-2026-08-31-NVDA-1", 1);
  assert.equal(handoff.dssEvaluationId, evaluation.dssEvaluationId);
  assert.deepEqual(handoff.evaluation, evaluation);
  assert.equal(Object.isFrozen(handoff), true);
  assert.equal(Object.isFrozen(handoff.evaluation), true);
  assert.equal(store.snapshot().candidates[0].authorizedDssEvaluationId, null);
});

test("authorized DSS pointer freezes Phase 3 recalculation and legacy state migrates fail-closed", () => {
  const { filePath, store } = permissionStore();
  store.recordDssEvaluation(validEvaluation(store));
  setLifecycle(filePath, "PERMISSION_EVALUATING", { authorizedDssEvaluationId: "dss-eval-001" });
  store.load();

  assert.throws(
    () => store.recordDssEvaluation(validEvaluation(store, { dssEvaluationId: "dss-eval-002" })),
    (error) => error.code === "DSS_EVALUATION_FROZEN",
  );

  const corruptPath = tempStatePath();
  fs.writeFileSync(corruptPath, `${JSON.stringify({
    schemaVersion: 1,
    updatedAt: "2026-08-31T14:36:05.000Z",
    candidates: [{
      candidateId: "legacy",
      contractVersion: 1,
      lifecycleState: "PERMISSION_EVALUATING",
      currentDssEvaluationId: "missing-eval",
    }],
    importLog: [],
  }, null, 2)}\n`, "utf8");
  const legacy = new PreTradeStore({ filePath: corruptPath }).load();
  assert.deepEqual(legacy.dssEvaluations, []);
  assert.equal(legacy.candidates[0].authorizedDssEvaluationId, null);
  assert.equal(legacy.candidates[0].currentDssEvaluationStale, true);
  assert.equal(legacy.candidates[0].currentDssEvaluationStaleReason, "MISSING_PERSISTED_DSS_EVALUATION");
});
