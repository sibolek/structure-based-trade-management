import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceBrokerExecutionOwnershipJournal,
  appendBrokerExecutionOwnershipEvent,
  createBrokerExecutionOwnershipJournal,
  establishBrokerExecutionOwnershipJournal,
  validateBrokerExecutionOwnershipJournal,
} from "../schwab-bridge/broker-execution-ownership-journal.mjs";
import {
  advanceBrokerExecutionCoverage,
  createBrokerExecutionCoverage,
  establishBrokerExecutionCoverage,
  markBrokerExecutionCoverageGap,
} from "../schwab-bridge/broker-execution-provenance.mjs";
import { createLiveStateApi } from "../schwab-bridge/live-state-api.mjs";

function execution(overrides = {}) {
  return {
    accountId: "opaque-A",
    account: "••••8891",
    symbol: "NVDA",
    instruction: "BUY",
    positionEffect: "OPENING",
    quantity: 5,
    price: 225.9,
    executionTime: "2026-09-02T18:00:01.000Z",
    detectedAt: "2026-09-02T18:00:01.250Z",
    stateEvent: "ENTRY",
    previousSide: null,
    previousQuantity: 0,
    nextSide: "LONG",
    nextQuantity: 5,
    averagePrice: 225.9,
    ...overrides,
  };
}

function establishedJournal() {
  return establishBrokerExecutionOwnershipJournal(createBrokerExecutionOwnershipJournal(), {
    coverageStartedAt: "2026-09-02T18:00:00.000Z",
    currentThrough: "2026-09-02T18:00:00.500Z",
  });
}

test("ownership journal begins unestablished and immutable", () => {
  const journal = createBrokerExecutionOwnershipJournal();
  assert.equal(journal.coverageStartedAt, null);
  assert.equal(journal.currentThrough, null);
  assert.deepEqual(journal.entries, []);
  assert.ok(Object.isFrozen(journal));
});

test("ownership journal establishes one contiguous interval", () => {
  const journal = establishedJournal();
  assert.equal(journal.coverageStartedAt, "2026-09-02T18:00:00.000Z");
  assert.equal(journal.currentThrough, "2026-09-02T18:00:00.500Z");
  assert.throws(
    () => establishBrokerExecutionOwnershipJournal(journal, {
      coverageStartedAt: "2026-09-02T18:00:02.000Z",
    }),
    (error) => error.code === "BROKER_EXECUTION_OWNERSHIP_JOURNAL_ALREADY_ESTABLISHED",
  );
});

test("journal retains every current-interval execution in observation order", () => {
  let journal = establishedJournal();
  journal = appendBrokerExecutionOwnershipEvent(journal, execution({ symbol: "NVDA" }));
  journal = appendBrokerExecutionOwnershipEvent(journal, execution({
    symbol: "AMD",
    executionTime: "2026-09-02T18:00:01.100Z",
    detectedAt: "2026-09-02T18:00:01.350Z",
  }));
  assert.equal(journal.entries.length, 2);
  assert.deepEqual(journal.entries.map((entry) => entry.sequence), [1, 2]);
  assert.deepEqual(journal.entries.map((entry) => entry.symbol), ["NVDA", "AMD"]);
});

test("baseline execution before current interval is not retained as ownership evidence", () => {
  const journal = appendBrokerExecutionOwnershipEvent(establishedJournal(), execution({
    executionTime: "2026-09-02T17:59:59.999Z",
  }));
  assert.deepEqual(journal.entries, []);
});

test("journal rejects missing authoritative executionTime", () => {
  assert.throws(
    () => appendBrokerExecutionOwnershipEvent(establishedJournal(), execution({ executionTime: null })),
    (error) => error.code === "BROKER_EXECUTION_TIME_REQUIRED",
  );
});

test("journal currentThrough advances but never regresses", () => {
  const advanced = advanceBrokerExecutionOwnershipJournal(establishedJournal(), {
    observedThrough: "2026-09-02T18:00:03.000Z",
  });
  assert.equal(advanced.currentThrough, "2026-09-02T18:00:03.000Z");
  assert.throws(
    () => advanceBrokerExecutionOwnershipJournal(advanced, {
      observedThrough: "2026-09-02T18:00:02.999Z",
    }),
    (error) => error.code === "BROKER_EXECUTION_OWNERSHIP_JOURNAL_TIME_REGRESSION",
  );
});

test("live state journal remains lossless when 25-item UI execution list evicts old fills", () => {
  const api = createLiveStateApi();
  let coverage = establishBrokerExecutionCoverage(createBrokerExecutionCoverage(), {
    baselineCompletedAt: "2026-09-02T18:00:00.000Z",
  });
  api.setExecutionCoverage(coverage);

  api.recordExecution(execution({ symbol: "KEEP", executionTime: "2026-09-02T18:00:00.100Z" }));
  for (let index = 0; index < 30; index += 1) {
    api.recordExecution(execution({
      symbol: `SYM${index}`,
      executionTime: `2026-09-02T18:00:00.${String(index + 200).padStart(3, "0")}Z`,
      detectedAt: `2026-09-02T18:00:00.${String(index + 300).padStart(3, "0")}Z`,
    }));
  }
  coverage = advanceBrokerExecutionCoverage(coverage, {
    observedThrough: "2026-09-02T18:00:02.000Z",
  });
  api.setExecutionCoverage(coverage);

  const snapshot = api.snapshot();
  assert.equal(snapshot.executions.length, 25);
  assert.equal(snapshot.executions.some((item) => item.symbol === "KEEP"), false);
  assert.equal(snapshot.executionOwnershipJournal.entries.length, 31);
  assert.equal(snapshot.executionOwnershipJournal.entries.some((item) => item.symbol === "KEEP"), true);
  assert.equal(snapshot.executionOwnershipJournal.currentThrough, coverage.currentThrough);
});

test("coverage GAP erases ownership evidence and recovery starts a new journal interval", () => {
  const api = createLiveStateApi();
  let coverage = establishBrokerExecutionCoverage(createBrokerExecutionCoverage(), {
    baselineCompletedAt: "2026-09-02T18:00:00.000Z",
  });
  api.setExecutionCoverage(coverage);
  api.recordExecution(execution());

  coverage = markBrokerExecutionCoverageGap(coverage, {
    gapDetectedAt: "2026-09-02T18:00:02.000Z",
    reason: "poll failed",
  });
  api.setExecutionCoverage(coverage);
  let snapshot = api.snapshot();
  assert.equal(snapshot.executionOwnershipJournal.coverageStartedAt, null);
  assert.deepEqual(snapshot.executionOwnershipJournal.entries, []);

  coverage = advanceBrokerExecutionCoverage(coverage, {
    observedThrough: "2026-09-02T18:00:04.000Z",
  });
  api.setExecutionCoverage(coverage);
  snapshot = api.snapshot();
  assert.equal(snapshot.executionOwnershipJournal.coverageStartedAt, "2026-09-02T18:00:04.000Z");
  assert.equal(snapshot.executionOwnershipJournal.currentThrough, "2026-09-02T18:00:04.000Z");
  assert.deepEqual(snapshot.executionOwnershipJournal.entries, []);
});

test("journal contract validates after ordinary recording", () => {
  const journal = appendBrokerExecutionOwnershipEvent(establishedJournal(), execution());
  assert.deepEqual(validateBrokerExecutionOwnershipJournal(journal), {
    valid: true,
    errors: Object.freeze([]),
  });
});
