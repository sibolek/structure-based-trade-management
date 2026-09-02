import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceBrokerExecutionActivity,
  brokerExecutionActivitySince,
  createBrokerExecutionActivity,
  establishBrokerExecutionActivity,
  validateBrokerExecutionActivity,
} from "../schwab-bridge/broker-execution-activity.mjs";
import {
  advanceBrokerExecutionCoverage,
  createBrokerExecutionCoverage,
  establishBrokerExecutionCoverage,
  markBrokerExecutionCoverageGap,
} from "../schwab-bridge/broker-execution-provenance.mjs";
import { createLiveStateApi } from "../schwab-bridge/live-state-api.mjs";

function establishedActivity() {
  return establishBrokerExecutionActivity(createBrokerExecutionActivity(), {
    coverageStartedAt: "2026-09-02T14:00:00.000Z",
    currentThrough: "2026-09-02T14:00:05.000Z",
  });
}

function execution({
  accountId = "opaque-A",
  symbol = "NVDA",
  instruction = "BUY",
  positionEffect = "OPENING",
  quantity = 1,
  price = 100,
  executionTime = "2026-09-02T14:00:03.000Z",
  detectedAt = "2026-09-02T14:00:03.250Z",
} = {}) {
  return {
    accountId,
    symbol,
    instruction,
    positionEffect,
    quantity,
    price,
    executionTime,
    detectedAt,
  };
}

test("execution activity begins unestablished and immutable", () => {
  const activity = createBrokerExecutionActivity();
  assert.equal(activity.coverageStartedAt, null);
  assert.equal(activity.currentThrough, null);
  assert.deepEqual(activity.entries, []);
  assert.ok(Object.isFrozen(activity));
});

test("execution activity establishes exactly one contiguous proof interval", () => {
  const activity = establishedActivity();
  assert.equal(activity.coverageStartedAt, "2026-09-02T14:00:00.000Z");
  assert.equal(activity.currentThrough, "2026-09-02T14:00:05.000Z");
  assert.deepEqual(activity.entries, []);
  assert.throws(
    () => establishBrokerExecutionActivity(activity, {
      coverageStartedAt: "2026-09-02T14:00:06.000Z",
    }),
    (error) => error.code === "BROKER_EXECUTION_ACTIVITY_ALREADY_ESTABLISHED",
  );
});

test("activity keeps only the latest authoritative execution per exact account and symbol", () => {
  let activity = establishedActivity();
  activity = advanceBrokerExecutionActivity(activity, {
    observedThrough: "2026-09-02T14:00:06.000Z",
    executions: [
      execution({ executionTime: "2026-09-02T14:00:02.000Z", detectedAt: "2026-09-02T14:00:02.200Z" }),
      execution({ executionTime: "2026-09-02T14:00:04.000Z", detectedAt: "2026-09-02T14:00:04.200Z" }),
      execution({ accountId: "opaque-B", executionTime: "2026-09-02T14:00:03.000Z" }),
    ],
  });

  assert.equal(activity.entries.length, 2);
  assert.deepEqual(activity.entries.find((item) => item.accountId === "opaque-A"), {
    accountId: "opaque-A",
    symbol: "NVDA",
    latestExecutionTime: "2026-09-02T14:00:04.000Z",
    latestDetectedAt: "2026-09-02T14:00:04.200Z",
  });
});

test("an older execution never overwrites a later account+symbol watermark", () => {
  let activity = establishedActivity();
  activity = advanceBrokerExecutionActivity(activity, {
    observedThrough: "2026-09-02T14:00:06.000Z",
    executions: [execution({ executionTime: "2026-09-02T14:00:04.000Z" })],
  });
  activity = advanceBrokerExecutionActivity(activity, {
    observedThrough: "2026-09-02T14:00:07.000Z",
    executions: [execution({ executionTime: "2026-09-02T14:00:03.500Z" })],
  });
  assert.equal(activity.entries[0].latestExecutionTime, "2026-09-02T14:00:04.000Z");
});

test("executions before the current coverage interval are valid observations but not retained as proof entries", () => {
  let activity = establishedActivity();
  activity = advanceBrokerExecutionActivity(activity, {
    observedThrough: "2026-09-02T14:00:06.000Z",
    executions: [execution({ executionTime: "2026-09-02T13:59:59.999Z" })],
  });
  assert.deepEqual(activity.entries, []);
});

test("missing authoritative Schwab executionTime fails closed", () => {
  const activity = establishedActivity();
  assert.throws(
    () => advanceBrokerExecutionActivity(activity, {
      observedThrough: "2026-09-02T14:00:06.000Z",
      executions: [execution({ executionTime: null })],
    }),
    (error) => error.code === "BROKER_EXECUTION_TIME_REQUIRED",
  );
});

test("activity query uses executionTime rather than detectedAt", () => {
  let activity = establishedActivity();
  activity = advanceBrokerExecutionActivity(activity, {
    observedThrough: "2026-09-02T14:00:06.000Z",
    executions: [execution({
      executionTime: "2026-09-02T14:00:02.000Z",
      detectedAt: "2026-09-02T14:00:05.500Z",
    })],
  });

  assert.equal(brokerExecutionActivitySince(activity, {
    symbol: "NVDA",
    since: "2026-09-02T14:00:03.000Z",
  }).length, 0);
});

test("live state aligns activity interval with coverage and resets it on GAP/recovery", () => {
  const api = createLiveStateApi();
  let coverage = establishBrokerExecutionCoverage(createBrokerExecutionCoverage(), {
    baselineCompletedAt: "2026-09-02T14:00:00.000Z",
  });
  api.setExecutionCoverage(coverage);
  api.recordExecution(execution({ executionTime: "2026-09-02T14:00:00.500Z" }));

  coverage = advanceBrokerExecutionCoverage(coverage, {
    observedThrough: "2026-09-02T14:00:02.000Z",
  });
  api.setExecutionCoverage(coverage);
  let snapshot = api.snapshot();
  assert.equal(snapshot.executionActivity.coverageStartedAt, coverage.coverageStartedAt);
  assert.equal(snapshot.executionActivity.currentThrough, coverage.currentThrough);
  assert.equal(snapshot.executionActivity.entries.length, 1);

  coverage = markBrokerExecutionCoverageGap(coverage, {
    gapDetectedAt: "2026-09-02T14:00:03.000Z",
    reason: "poll failed",
  });
  api.setExecutionCoverage(coverage);
  snapshot = api.snapshot();
  assert.equal(snapshot.executionActivity.coverageStartedAt, null);
  assert.deepEqual(snapshot.executionActivity.entries, []);

  coverage = advanceBrokerExecutionCoverage(coverage, {
    observedThrough: "2026-09-02T14:00:05.000Z",
  });
  api.setExecutionCoverage(coverage);
  snapshot = api.snapshot();
  assert.equal(snapshot.executionActivity.coverageStartedAt, "2026-09-02T14:00:05.000Z");
  assert.equal(snapshot.executionActivity.currentThrough, "2026-09-02T14:00:05.000Z");
  assert.deepEqual(snapshot.executionActivity.entries, []);
});

test("bounded recent-execution UI list cannot evict the lossless safety watermark", () => {
  const api = createLiveStateApi();
  const coverage = establishBrokerExecutionCoverage(createBrokerExecutionCoverage(), {
    baselineCompletedAt: "2026-09-02T14:00:00.000Z",
  });
  api.setExecutionCoverage(coverage);

  api.recordExecution(execution({
    symbol: "KEEP",
    executionTime: "2026-09-02T14:00:00.100Z",
    detectedAt: "2026-09-02T14:00:00.100Z",
  }));
  for (let index = 0; index < 30; index += 1) {
    api.recordExecution(execution({
      symbol: `SYM${index}`,
      executionTime: `2026-09-02T14:00:00.${String(index + 200).padStart(3, "0")}Z`,
      detectedAt: `2026-09-02T14:00:00.${String(index + 200).padStart(3, "0")}Z`,
    }));
  }

  const snapshot = api.snapshot();
  assert.equal(snapshot.executions.length, 25);
  assert.equal(snapshot.executions.some((item) => item.symbol === "KEEP"), false);
  assert.equal(snapshot.executionActivity.entries.some((item) => item.symbol === "KEEP"), true);
});

test("invalid execution-time provenance creates a sticky live-state fault that cannot silently recover", () => {
  const api = createLiveStateApi();
  let coverage = establishBrokerExecutionCoverage(createBrokerExecutionCoverage(), {
    baselineCompletedAt: "2026-09-02T14:00:00.000Z",
  });
  api.setExecutionCoverage(coverage);

  assert.throws(
    () => api.recordExecution(execution({ executionTime: null })),
    (error) => error.code === "BROKER_EXECUTION_TIME_REQUIRED",
  );

  coverage = markBrokerExecutionCoverageGap(coverage, {
    gapDetectedAt: "2026-09-02T14:00:01.000Z",
    reason: "missing executionTime",
  });
  api.setExecutionCoverage(coverage);

  const recovered = advanceBrokerExecutionCoverage(coverage, {
    observedThrough: "2026-09-02T14:00:02.000Z",
  });
  assert.throws(
    () => api.setExecutionCoverage(recovered),
    (error) => error.code === "BROKER_EXECUTION_ACTIVITY_PROVENANCE_FAULT",
  );
});

test("execution activity contract remains valid after ordinary advancement", () => {
  const activity = advanceBrokerExecutionActivity(establishedActivity(), {
    observedThrough: "2026-09-02T14:00:06.000Z",
    executions: [execution()],
  });
  assert.deepEqual(validateBrokerExecutionActivity(activity), {
    valid: true,
    errors: Object.freeze([]),
  });
});
