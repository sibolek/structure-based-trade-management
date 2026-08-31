import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DssRuntime } from "../schwab-bridge/dss-runtime.mjs";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";

function tempStatePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-dss-runtime-")), "state.json");
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

function setCandidateState(filePath, lifecycleState, extra = {}) {
  const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
  Object.assign(state.candidates[0], { lifecycleState, ...extra });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function makeStore({ lifecycleState = "PERMISSION_EVALUATING" } = {}) {
  const filePath = tempStatePath();
  let clock = "2026-08-31T14:36:05.000Z";
  const store = new PreTradeStore({ filePath, clock: () => clock });
  store.load();
  store.importBundle({ candidates: [candidate()] });
  setCandidateState(filePath, lifecycleState);
  store.load();
  return {
    filePath,
    store,
    setClock(value) { clock = value; },
  };
}

function dssInput(store, {
  latestBarTimestamp = Date.parse("2026-08-31T14:34:00.000Z"),
  sourceId = null,
  candidateContentHash = null,
} = {}) {
  const persisted = store.snapshot().candidates[0];
  return {
    candidate: {
      candidateId: persisted.candidateId,
      sourceId: sourceId ?? persisted.source,
      contractVersion: persisted.contractVersion,
      candidateContentHash: candidateContentHash ?? persisted.contentHash,
      symbol: persisted.symbol,
      direction: persisted.direction,
      decisionTimeframe: "5m",
      entryTimeframe: "2m",
    },
    marketSnapshot: {
      executionBars: [{
        timestamp: latestBarTimestamp,
        timeframe: "2m",
        complete: true,
      }],
    },
  };
}

function fakeEvaluator(statuses = ["VALID"]) {
  let calls = 0;
  const evaluator = (input, { nowMs }) => {
    calls += 1;
    const status = statuses[Math.min(calls - 1, statuses.length - 1)];
    const latestCompletedBar = input.marketSnapshot.executionBars[input.marketSnapshot.executionBars.length - 1];
    return Object.freeze({
      dssEvaluationId: `runtime-eval-${calls}`,
      status,
      reasonCodes: status === "VALID" ? [] : [`TEST_${status}`],
      candidateId: input.candidate.candidateId,
      sourceId: input.candidate.sourceId,
      candidateContractVersion: input.candidate.contractVersion,
      candidateContentHash: input.candidate.candidateContentHash,
      latestCompletedBar: structuredClone(latestCompletedBar),
      effectiveStop: status === "VALID" ? 216.01 - (calls - 1) * 0.01 : null,
      evaluatedAt: new Date(nowMs).toISOString(),
    });
  };
  return {
    evaluator,
    calls: () => calls,
  };
}

test("runtime evaluates once in PERMISSION_EVALUATING and persists the returned DSS evaluation", () => {
  const { store } = makeStore();
  const fake = fakeEvaluator();
  const runtime = new DssRuntime({ store, evaluator: fake.evaluator, now: () => Date.parse("2026-08-31T14:36:05.000Z") });

  const result = runtime.evaluate(dssInput(store));
  const state = store.snapshot();

  assert.equal(result.action, "EVALUATED");
  assert.equal(result.status, "VALID");
  assert.equal(result.dssEvaluationId, "runtime-eval-1");
  assert.equal(fake.calls(), 1);
  assert.equal(state.dssEvaluations.length, 1);
  assert.equal(state.candidates[0].currentDssEvaluationId, "runtime-eval-1");
});

test("quote-only permission activity reuses the exact fresh VALID evaluation without invoking DSS again", () => {
  const { store } = makeStore();
  const fake = fakeEvaluator();
  const runtime = new DssRuntime({ store, evaluator: fake.evaluator, now: () => Date.parse("2026-08-31T14:36:06.000Z") });

  const first = runtime.evaluate(dssInput(store));
  const second = runtime.evaluate(dssInput(store));

  assert.equal(first.action, "EVALUATED");
  assert.equal(second.action, "REUSED");
  assert.equal(second.dssEvaluationId, first.dssEvaluationId);
  assert.equal(fake.calls(), 1);
  assert.equal(store.snapshot().dssEvaluations.length, 1);
});

test("new completed 2-minute bar stales the pointer and the next permission cycle creates a new evaluation", () => {
  const { store } = makeStore();
  const fake = fakeEvaluator();
  const runtime = new DssRuntime({ store, evaluator: fake.evaluator, now: () => Date.parse("2026-08-31T14:38:02.000Z") });

  const first = runtime.evaluate(dssInput(store));
  const stale = runtime.observeCompletedBar({
    candidateId: "sod-2026-08-31-NVDA-1",
    contractVersion: 1,
    bar: {
      timestamp: Date.parse("2026-08-31T14:36:00.000Z"),
      timeframe: "2m",
      complete: true,
    },
    observedAt: "2026-08-31T14:38:01.000Z",
  });
  const second = runtime.evaluate(dssInput(store, {
    latestBarTimestamp: Date.parse("2026-08-31T14:36:00.000Z"),
  }));

  assert.equal(stale.status, "STALE");
  assert.equal(first.dssEvaluationId, "runtime-eval-1");
  assert.equal(second.dssEvaluationId, "runtime-eval-2");
  assert.equal(fake.calls(), 2);
  const state = store.snapshot();
  assert.equal(state.dssEvaluations.length, 2);
  assert.equal(state.candidates[0].currentDssEvaluationId, "runtime-eval-2");
  assert.equal(state.candidates[0].currentDssEvaluationStale, false);
});

test("BLOCKED and ERROR outcomes may be retried without pretending they are a fresh VALID stop", () => {
  for (const status of ["BLOCKED", "ERROR"]) {
    const { store } = makeStore();
    const fake = fakeEvaluator([status, "VALID"]);
    const runtime = new DssRuntime({ store, evaluator: fake.evaluator, now: () => Date.parse("2026-08-31T14:36:05.000Z") });

    const first = runtime.evaluate(dssInput(store));
    const second = runtime.evaluate(dssInput(store));

    assert.equal(first.status, status);
    assert.equal(second.status, "VALID");
    assert.equal(fake.calls(), 2);
    assert.equal(store.snapshot().dssEvaluations.length, 2);
  }
});

test("runtime refuses evaluation outside PERMISSION_EVALUATING before calling the calculator", () => {
  const { store } = makeStore({ lifecycleState: "WAITING" });
  const fake = fakeEvaluator();
  const runtime = new DssRuntime({ store, evaluator: fake.evaluator });

  assert.throws(
    () => runtime.evaluate(dssInput(store)),
    (error) => error.code === "DSS_RUNTIME_NOT_ALLOWED_IN_STATE",
  );
  assert.equal(fake.calls(), 0);
  assert.equal(store.snapshot().dssEvaluations.length, 0);
});

test("authorized DSS identity freezes Phase 3 runtime evaluation and must remain auditable", () => {
  const { filePath, store } = makeStore();
  const fake = fakeEvaluator();
  const runtime = new DssRuntime({ store, evaluator: fake.evaluator, now: () => Date.parse("2026-08-31T14:36:05.000Z") });
  runtime.evaluate(dssInput(store));

  setCandidateState(filePath, "ARMED", { authorizedDssEvaluationId: "runtime-eval-1" });
  store.load();
  const frozen = runtime.evaluate(dssInput(store));

  assert.equal(frozen.action, "FROZEN");
  assert.equal(frozen.dssEvaluationId, "runtime-eval-1");
  assert.equal(fake.calls(), 1);
  assert.equal(store.snapshot().dssEvaluations.length, 1);

  setCandidateState(filePath, "ARMED", { authorizedDssEvaluationId: "missing-evaluation" });
  store.load();
  assert.throws(
    () => runtime.evaluate(dssInput(store)),
    (error) => error.code === "DSS_RUNTIME_MISSING_AUTHORIZED_EVALUATION",
  );
  assert.equal(fake.calls(), 1);
});

test("completed-bar observer rejects forming, missing-timeframe, wrong-timeframe, and invalid-timestamp events", () => {
  const { store } = makeStore();
  const runtime = new DssRuntime({ store, evaluator: fakeEvaluator().evaluator });

  for (const bar of [
    { timestamp: Date.now(), timeframe: "2m", complete: false },
    { timestamp: Date.now(), complete: true },
    { timestamp: Date.now(), timeframe: "1m", complete: true },
    { timestamp: false, timeframe: "2m", complete: true },
  ]) {
    assert.throws(
      () => runtime.observeCompletedBar({
        candidateId: "sod-2026-08-31-NVDA-1",
        contractVersion: 1,
        bar,
      }),
      (error) => error.code === "INVALID_DSS_COMPLETED_BAR_EVENT",
    );
  }
});

test("runtime fails before evaluation when source or candidate hash identity does not match persistence", () => {
  const { store } = makeStore();
  const fake = fakeEvaluator();
  const runtime = new DssRuntime({ store, evaluator: fake.evaluator });

  assert.throws(
    () => runtime.evaluate(dssInput(store, { sourceId: "OTHER_SOURCE" })),
    (error) => error.code === "DSS_RUNTIME_SOURCE_MISMATCH",
  );
  assert.throws(
    () => runtime.evaluate(dssInput(store, { candidateContentHash: "wrong-hash" })),
    (error) => error.code === "DSS_RUNTIME_HASH_MISMATCH",
  );
  assert.equal(fake.calls(), 0);
});

test("runtime risk handoff preserves the exact current fresh VALID dssEvaluationId", () => {
  const { store } = makeStore();
  const fake = fakeEvaluator();
  const runtime = new DssRuntime({ store, evaluator: fake.evaluator, now: () => Date.parse("2026-08-31T14:36:05.000Z") });

  const evaluated = runtime.evaluate(dssInput(store));
  const handoff = runtime.riskHandoff("sod-2026-08-31-NVDA-1", 1);

  assert.equal(handoff.dssEvaluationId, evaluated.dssEvaluationId);
  assert.equal(handoff.evaluation.dssEvaluationId, evaluated.dssEvaluationId);
  assert.equal(Object.isFrozen(handoff), true);
  assert.equal(Object.isFrozen(handoff.evaluation), true);
});
