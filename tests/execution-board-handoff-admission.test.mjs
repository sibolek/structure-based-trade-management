import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceBrokerExecutionActivity,
  createBrokerExecutionActivity,
  establishBrokerExecutionActivity,
} from "../schwab-bridge/broker-execution-activity.mjs";
import {
  advanceBrokerExecutionCoverage,
  createBrokerExecutionCoverage,
  establishBrokerExecutionCoverage,
} from "../schwab-bridge/broker-execution-provenance.mjs";
import { evaluateExecutionBoardHandoffAdmission } from "../schwab-bridge/execution-board-handoff-admission.mjs";

function handoff(overrides = {}) {
  return {
    schemaVersion: 1,
    handoffId: "handoff-001",
    createdAt: "2026-09-02T14:00:10.000Z",
    authorizedAt: "2026-09-02T14:00:05.000Z",
    sourceId: "SOD",
    candidateId: "candidate-001",
    contractVersion: 1,
    candidateContentHash: "hash-001",
    symbol: "NVDA",
    direction: "LONG",
    setup: "H2",
    timeframe: "2m",
    thesis: "Synthetic admission test",
    trigger: { type: "BREAKOUT", level: 100 },
    targets: [102],
    managementPlan: "Synthetic only",
    structuralInvalidation: 99,
    effectiveStop: 98.8,
    currentExpectedEntry: 100,
    selectedQuantity: 10,
    authorizedExecutionAccountId: "opaque-A",
    dssEvaluationId: "dss-001",
    riskEvaluationId: "risk-001",
    ...overrides,
  };
}

function coverage({
  startedAt = "2026-09-02T14:00:00.000Z",
  currentThrough = "2026-09-02T14:00:12.000Z",
} = {}) {
  let value = establishBrokerExecutionCoverage(createBrokerExecutionCoverage(), {
    baselineCompletedAt: startedAt,
  });
  if (currentThrough !== startedAt) {
    value = advanceBrokerExecutionCoverage(value, { observedThrough: currentThrough });
  }
  return value;
}

function activity({
  startedAt = "2026-09-02T14:00:00.000Z",
  currentThrough = "2026-09-02T14:00:12.000Z",
  executions = [],
} = {}) {
  let value = establishBrokerExecutionActivity(createBrokerExecutionActivity(), {
    coverageStartedAt: startedAt,
    currentThrough: startedAt,
  });
  value = advanceBrokerExecutionActivity(value, {
    observedThrough: currentThrough,
    executions,
  });
  return value;
}

function brokerState(overrides = {}) {
  return {
    version: 2,
    status: "ARMED",
    readOnly: true,
    source: "SCHWAB",
    updatedAt: "2026-09-02T14:00:12.100Z",
    accounts: [
      { accountId: "opaque-A", account: "••••1111" },
      { accountId: "opaque-B", account: "••••2222" },
    ],
    positions: [],
    executions: [],
    executionCoverage: coverage(),
    executionActivity: activity(),
    lastError: null,
    ...overrides,
  };
}

function execution({
  accountId = "opaque-A",
  symbol = "NVDA",
  executionTime = "2026-09-02T14:00:06.000Z",
  detectedAt = "2026-09-02T14:00:06.200Z",
} = {}) {
  return { accountId, symbol, executionTime, detectedAt };
}

test("clean exact-account handoff is admitted with immutable proof evidence", () => {
  const result = evaluateExecutionBoardHandoffAdmission({
    handoff: handoff(),
    brokerState: brokerState(),
  });
  assert.equal(result.status, "ADMITTED");
  assert.equal(result.admitted, true);
  assert.equal(result.reason, null);
  assert.equal(result.evidence.authorizedAccountId, "opaque-A");
  assert.ok(Object.isFrozen(result));
});

test("missing broker state fails closed", () => {
  const result = evaluateExecutionBoardHandoffAdmission({ handoff: handoff(), brokerState: null });
  assert.equal(result.reason, "BROKER_STATE_UNAVAILABLE");
});

test("exact authorized account must be present", () => {
  const state = brokerState({ accounts: [{ accountId: "opaque-B" }] });
  const result = evaluateExecutionBoardHandoffAdmission({ handoff: handoff(), brokerState: state });
  assert.equal(result.reason, "AUTHORIZED_EXECUTION_ACCOUNT_UNAVAILABLE");
});

test("broker monitor must be healthy and read-only", () => {
  const state = brokerState({ status: "ERROR", lastError: "poll failed" });
  const result = evaluateExecutionBoardHandoffAdmission({ handoff: handoff(), brokerState: state });
  assert.equal(result.reason, "BROKER_STATE_UNAVAILABLE");
});

test("coverage that starts after authorization cannot prove the clean interval", () => {
  const state = brokerState({
    executionCoverage: coverage({
      startedAt: "2026-09-02T14:00:06.000Z",
      currentThrough: "2026-09-02T14:00:12.000Z",
    }),
    executionActivity: activity({
      startedAt: "2026-09-02T14:00:06.000Z",
      currentThrough: "2026-09-02T14:00:12.000Z",
    }),
  });
  const result = evaluateExecutionBoardHandoffAdmission({ handoff: handoff(), brokerState: state });
  assert.equal(result.reason, "BROKER_EXECUTION_COVERAGE_GAP");
});

test("coverage must extend through the required pre-install proof point", () => {
  const state = brokerState({
    executionCoverage: coverage({ currentThrough: "2026-09-02T14:00:09.999Z" }),
    executionActivity: activity({ currentThrough: "2026-09-02T14:00:09.999Z" }),
  });
  const result = evaluateExecutionBoardHandoffAdmission({ handoff: handoff(), brokerState: state });
  assert.equal(result.reason, "BROKER_EXECUTION_COVERAGE_GAP");
});

test("coverage and activity watermark intervals must align exactly", () => {
  const state = brokerState({
    executionActivity: activity({
      startedAt: "2026-09-02T14:00:01.000Z",
      currentThrough: "2026-09-02T14:00:12.000Z",
    }),
  });
  const result = evaluateExecutionBoardHandoffAdmission({ handoff: handoff(), brokerState: state });
  assert.equal(result.reason, "BROKER_EXECUTION_COVERAGE_GAP");
});

test("same-symbol position in the authorized account blocks installation", () => {
  const state = brokerState({
    positions: [{ accountId: "opaque-A", symbol: "NVDA", quantity: 10 }],
  });
  const result = evaluateExecutionBoardHandoffAdmission({ handoff: handoff(), brokerState: state });
  assert.equal(result.reason, "EXISTING_POSITION_AT_HANDOFF");
});

test("same-symbol position in another account also blocks installation", () => {
  const state = brokerState({
    positions: [{ accountId: "opaque-B", symbol: "NVDA", quantity: -5 }],
  });
  const result = evaluateExecutionBoardHandoffAdmission({ handoff: handoff(), brokerState: state });
  assert.equal(result.reason, "EXISTING_POSITION_AT_HANDOFF");
  assert.equal(result.evidence.positionAccountId, "opaque-B");
});

test("authorized-account execution at or after authorizedAt blocks as intervening activity", () => {
  const state = brokerState({
    executionActivity: activity({
      executions: [execution({
        accountId: "opaque-A",
        executionTime: "2026-09-02T14:00:05.000Z",
      })],
    }),
  });
  const result = evaluateExecutionBoardHandoffAdmission({ handoff: handoff(), brokerState: state });
  assert.equal(result.reason, "INTERVENING_BROKER_ACTIVITY");
});

test("same-symbol execution in another account blocks as wrong-account activity", () => {
  const state = brokerState({
    executionActivity: activity({
      executions: [execution({ accountId: "opaque-B" })],
    }),
  });
  const result = evaluateExecutionBoardHandoffAdmission({ handoff: handoff(), brokerState: state });
  assert.equal(result.reason, "WRONG_ACCOUNT_EXECUTION_OBSERVED");
  assert.equal(result.evidence.executionAccountId, "opaque-B");
});

test("executionTime before authorizedAt does not block even if detected after authorization", () => {
  const state = brokerState({
    executionActivity: activity({
      executions: [execution({
        accountId: "opaque-A",
        executionTime: "2026-09-02T14:00:04.999Z",
        detectedAt: "2026-09-02T14:00:06.000Z",
      })],
    }),
  });
  const result = evaluateExecutionBoardHandoffAdmission({ handoff: handoff(), brokerState: state });
  assert.equal(result.status, "ADMITTED");
});

test("bounded recent-executions UI list is never used as completeness proof", () => {
  const state = brokerState({
    executions: [{
      accountId: "opaque-A",
      symbol: "NVDA",
      executionTime: "2026-09-02T14:00:06.000Z",
    }],
    executionActivity: activity({ executions: [] }),
  });
  const result = evaluateExecutionBoardHandoffAdmission({ handoff: handoff(), brokerState: state });
  assert.equal(result.status, "ADMITTED");
});

test("wrong-account activity takes diagnostic precedence when both accounts traded the symbol", () => {
  const state = brokerState({
    executionActivity: activity({
      executions: [
        execution({ accountId: "opaque-A", executionTime: "2026-09-02T14:00:06.000Z" }),
        execution({ accountId: "opaque-B", executionTime: "2026-09-02T14:00:07.000Z" }),
      ],
    }),
  });
  const result = evaluateExecutionBoardHandoffAdmission({ handoff: handoff(), brokerState: state });
  assert.equal(result.reason, "WRONG_ACCOUNT_EXECUTION_OBSERVED");
});

test("existing local V2.3 symbol ownership blocks only after broker cleanliness passes", () => {
  const result = evaluateExecutionBoardHandoffAdmission({
    handoff: handoff(),
    brokerState: brokerState(),
    executionOwnedSymbols: ["AMD", { symbol: "nvda" }],
  });
  assert.equal(result.reason, "EXECUTION_SYMBOL_OWNERSHIP_CONFLICT");
});

test("caller may require coverage through a later final-install revalidation point", () => {
  const result = evaluateExecutionBoardHandoffAdmission({
    handoff: handoff(),
    brokerState: brokerState(),
    requiredThrough: "2026-09-02T14:00:13.000Z",
  });
  assert.equal(result.reason, "BROKER_EXECUTION_COVERAGE_GAP");
});
