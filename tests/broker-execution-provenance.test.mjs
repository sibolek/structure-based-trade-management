import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceBrokerExecutionCoverage,
  createBrokerExecutionCoverage,
  establishBrokerExecutionCoverage,
  markBrokerExecutionCoverageGap,
  publicBrokerAccount,
  publicBrokerExecution,
  publicBrokerPosition,
  validateBrokerExecutionCoverage,
} from "../schwab-bridge/broker-execution-provenance.mjs";
import { createLiveStateApi } from "../schwab-bridge/live-state-api.mjs";

test("execution coverage begins ESTABLISHING and claims no interval", () => {
  const coverage = createBrokerExecutionCoverage();
  assert.equal(coverage.status, "ESTABLISHING");
  assert.equal(coverage.coverageStartedAt, null);
  assert.equal(coverage.currentThrough, null);
  assert.ok(Object.isFrozen(coverage));
});

test("successful baseline establishes a conservative continuous interval at completion time", () => {
  const coverage = establishBrokerExecutionCoverage(createBrokerExecutionCoverage(), {
    baselineCompletedAt: "2026-09-02T14:00:00.000Z",
  });
  assert.equal(coverage.status, "CONTIGUOUS");
  assert.equal(coverage.coverageStartedAt, "2026-09-02T14:00:00.000Z");
  assert.equal(coverage.baselineCompletedAt, "2026-09-02T14:00:00.000Z");
  assert.equal(coverage.currentThrough, "2026-09-02T14:00:00.000Z");
});

test("successful polls advance currentThrough without moving coverageStartedAt", () => {
  const established = establishBrokerExecutionCoverage(createBrokerExecutionCoverage(), {
    baselineCompletedAt: "2026-09-02T14:00:00.000Z",
  });
  const advanced = advanceBrokerExecutionCoverage(established, {
    observedThrough: "2026-09-02T14:00:05.000Z",
  });
  assert.equal(advanced.coverageStartedAt, established.coverageStartedAt);
  assert.equal(advanced.currentThrough, "2026-09-02T14:00:05.000Z");
});

test("monitor failure creates GAP without pretending currentThrough advanced", () => {
  const established = establishBrokerExecutionCoverage(createBrokerExecutionCoverage(), {
    baselineCompletedAt: "2026-09-02T14:00:00.000Z",
  });
  const advanced = advanceBrokerExecutionCoverage(established, {
    observedThrough: "2026-09-02T14:00:05.000Z",
  });
  const gap = markBrokerExecutionCoverageGap(advanced, {
    gapDetectedAt: "2026-09-02T14:00:06.000Z",
    reason: "Schwab poll failed",
  });
  assert.equal(gap.status, "GAP");
  assert.equal(gap.currentThrough, "2026-09-02T14:00:05.000Z");
  assert.equal(gap.lastGapAt, "2026-09-02T14:00:06.000Z");
});

test("first successful poll after GAP starts a new continuous coverage interval", () => {
  const established = establishBrokerExecutionCoverage(createBrokerExecutionCoverage(), {
    baselineCompletedAt: "2026-09-02T14:00:00.000Z",
  });
  const gap = markBrokerExecutionCoverageGap(established, {
    gapDetectedAt: "2026-09-02T14:00:06.000Z",
    reason: "temporary failure",
  });
  const recovered = advanceBrokerExecutionCoverage(gap, {
    observedThrough: "2026-09-02T14:00:08.000Z",
  });
  assert.equal(recovered.status, "CONTIGUOUS");
  assert.equal(recovered.coverageStartedAt, "2026-09-02T14:00:08.000Z");
  assert.equal(recovered.currentThrough, "2026-09-02T14:00:08.000Z");
  assert.equal(recovered.baselineCompletedAt, "2026-09-02T14:00:00.000Z");
  assert.equal(recovered.lastGapAt, "2026-09-02T14:00:06.000Z");
});

test("coverage time may never move backward", () => {
  const established = establishBrokerExecutionCoverage(createBrokerExecutionCoverage(), {
    baselineCompletedAt: "2026-09-02T14:00:05.000Z",
  });
  assert.throws(
    () => advanceBrokerExecutionCoverage(established, {
      observedThrough: "2026-09-02T14:00:04.999Z",
    }),
    (error) => error.code === "BROKER_EXECUTION_COVERAGE_TIME_REGRESSION",
  );
});

test("public account exposes stable opaque accountId separately from display label", () => {
  const account = publicBrokerAccount({
    accountHash: "opaque-account-A",
    accountDisplay: "••••8891",
    equity: 14422.71,
    maxRisk: 72.11355,
  });
  assert.equal(account.accountId, "opaque-account-A");
  assert.equal(account.account, "••••8891");
  assert.equal(account.equity, 14422.71);
});

test("public position carries exact accountId", () => {
  const position = publicBrokerPosition({
    accountId: "opaque-account-A",
    accountDisplay: "••••8891",
    state: { symbol: "nvda", side: "LONG", quantity: 20, averagePrice: 225.5 },
  });
  assert.equal(position.accountId, "opaque-account-A");
  assert.equal(position.symbol, "NVDA");
  assert.equal(position.quantity, 20);
});

test("public execution carries exact accountId and normalized timing provenance", () => {
  const execution = publicBrokerExecution({
    fill: {
      accountHash: "opaque-account-A",
      accountDisplay: "••••8891",
      symbol: "nvda",
      instruction: "buy",
      positionEffect: "opening",
      quantity: 10,
      price: 225.6,
      executionTime: "2026-09-02T14:00:03.000Z",
    },
    detectedAt: "2026-09-02T14:00:03.250Z",
    result: {
      event: "ENTRY",
      previousSide: "FLAT",
      previousQuantity: 0,
      nextSide: "LONG",
      nextQuantity: 10,
      nextAveragePrice: 225.6,
    },
  });
  assert.equal(execution.accountId, "opaque-account-A");
  assert.equal(execution.account, "••••8891");
  assert.equal(execution.observedDelayMs, 250);
});

test("public broker provenance refuses missing account identity", () => {
  assert.throws(
    () => publicBrokerAccount({ accountDisplay: "••••8891" }),
    (error) => error.code === "BROKER_ACCOUNT_ID_REQUIRED",
  );
});

test("live state stores account identity and execution coverage without using masked account as key", () => {
  const api = createLiveStateApi();
  const coverage = establishBrokerExecutionCoverage(createBrokerExecutionCoverage(), {
    baselineCompletedAt: "2026-09-02T14:00:00.000Z",
  });

  api.setBootstrap({
    pollMs: 1000,
    accounts: [
      { accountId: "opaque-A", account: "••••8891", equity: 10000, maxRisk: 50 },
      { accountId: "opaque-B", account: "••••8891", equity: 20000, maxRisk: 100 },
    ],
    positions: [],
  });
  api.setExecutionCoverage(coverage);
  api.updatePosition({ accountId: "opaque-A", account: "••••8891", symbol: "NVDA", quantity: 10 });
  api.updatePosition({ accountId: "opaque-B", account: "••••8891", symbol: "NVDA", quantity: 20 });

  const snapshot = api.snapshot();
  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.executionCoverage.status, "CONTIGUOUS");
  assert.equal(snapshot.accounts.length, 2);
  assert.equal(snapshot.positions.length, 2);
  assert.deepEqual(snapshot.positions.map((item) => item.accountId).sort(), ["opaque-A", "opaque-B"]);
});

test("live state rejects invalid execution coverage", () => {
  const api = createLiveStateApi();
  assert.throws(
    () => api.setExecutionCoverage({ schemaVersion: 1, status: "CONTIGUOUS" }),
    (error) => error.code === "INVALID_BROKER_EXECUTION_COVERAGE",
  );
});

test("coverage contract remains valid after a gap and recovery", () => {
  let coverage = createBrokerExecutionCoverage();
  coverage = establishBrokerExecutionCoverage(coverage, { baselineCompletedAt: "2026-09-02T14:00:00.000Z" });
  coverage = advanceBrokerExecutionCoverage(coverage, { observedThrough: "2026-09-02T14:00:02.000Z" });
  coverage = markBrokerExecutionCoverageGap(coverage, { gapDetectedAt: "2026-09-02T14:00:03.000Z", reason: "poll failure" });
  coverage = advanceBrokerExecutionCoverage(coverage, { observedThrough: "2026-09-02T14:00:05.000Z" });
  assert.deepEqual(validateBrokerExecutionCoverage(coverage), {
    valid: true,
    errors: Object.freeze([]),
  });
});
