import test from "node:test";
import assert from "node:assert/strict";

import {
  appendBrokerExecutionOwnershipEvent,
  createBrokerExecutionOwnershipJournal,
  establishBrokerExecutionOwnershipJournal,
} from "../schwab-bridge/broker-execution-ownership-journal.mjs";
import {
  advanceBrokerExecutionCoverage,
  createBrokerExecutionCoverage,
  establishBrokerExecutionCoverage,
  markBrokerExecutionCoverageGap,
} from "../schwab-bridge/broker-execution-provenance.mjs";
import {
  bindV24ExecutionListeningAt,
  buildV24ExecutionCompatibilityEnvelope,
} from "../src/execution/execution-v23-compat.js";
import { evaluateV24InitialFillOwnership } from "../src/execution/execution-v24-initial-fill-matcher.js";

function handoff(overrides = {}) {
  return {
    handoffId: "handoff-001",
    sourceId: "SOD_A_PLUS",
    candidateId: "candidate-001",
    contractVersion: 3,
    candidateContentHash: "hash-001",
    symbol: "NVDA",
    direction: "LONG",
    setup: "H2 continuation",
    timeframe: "2m",
    thesis: "Continuation",
    trigger: { type: "BREAKOUT", level: 225.75 },
    targets: [227],
    managementPlan: "Manage against structure",
    structuralInvalidation: 224.8,
    effectiveStop: 224.65,
    currentExpectedEntry: 225.8,
    selectedQuantity: 20,
    authorizedExecutionAccountId: "opaque-A",
    dssEvaluationId: "dss-001",
    riskEvaluationId: "risk-001",
    authorizedAt: "2026-09-02T18:00:01.000Z",
    createdAt: "2026-09-02T18:00:02.000Z",
    ...overrides,
  };
}

function listeningInstallation(overrides = {}) {
  const source = handoff(overrides.handoff || {});
  const prepared = buildV24ExecutionCompatibilityEnvelope({ handoff: source, receiverId: "receiver-A" });
  const listeningAt = overrides.executionListeningAt || "2026-09-02T18:00:03.000Z";
  const compatibility = bindV24ExecutionListeningAt(prepared, listeningAt);
  return {
    status: "LISTENING",
    handoffId: source.handoffId,
    receiverId: "receiver-A",
    symbol: source.symbol,
    preparedAt: "2026-09-02T18:00:02.500Z",
    executionListeningAt: listeningAt,
    compatibility,
  };
}

function execution(overrides = {}) {
  return {
    accountId: "opaque-A",
    account: "••••8891",
    symbol: "NVDA",
    instruction: "BUY",
    positionEffect: "OPENING",
    quantity: 5,
    price: 225.9,
    executionTime: "2026-09-02T18:00:04.000Z",
    detectedAt: "2026-09-02T18:00:04.250Z",
    stateEvent: "ENTRY",
    previousSide: null,
    previousQuantity: 0,
    nextSide: "LONG",
    nextQuantity: 5,
    averagePrice: 225.9,
    ...overrides,
  };
}

function brokerState({ events = [], coverageStart = "2026-09-02T18:00:00.000Z", currentThrough = "2026-09-02T18:00:10.000Z", accounts = [{ accountId: "opaque-A" }], executions = [] } = {}) {
  let coverage = establishBrokerExecutionCoverage(createBrokerExecutionCoverage(), {
    baselineCompletedAt: coverageStart,
  });
  if (currentThrough !== coverageStart) {
    coverage = advanceBrokerExecutionCoverage(coverage, { observedThrough: currentThrough });
  }
  let journal = establishBrokerExecutionOwnershipJournal(createBrokerExecutionOwnershipJournal(), {
    coverageStartedAt: coverage.coverageStartedAt,
    currentThrough: coverage.currentThrough,
  });
  for (const event of events) journal = appendBrokerExecutionOwnershipEvent(journal, event);
  return {
    version: 2,
    status: "ARMED",
    readOnly: true,
    source: "SCHWAB",
    accounts,
    executions,
    executionCoverage: coverage,
    executionOwnershipJournal: journal,
    lastError: null,
  };
}

test("exact-account LONG opening fill matches from lossless journal", () => {
  const result = evaluateV24InitialFillOwnership({
    installation: listeningInstallation(),
    brokerState: brokerState({ events: [execution()] }),
  });
  assert.equal(result.status, "MATCHED");
  assert.equal(result.matchedExecution.accountId, "opaque-A");
  assert.equal(result.matchedExecution.instruction, "BUY");
});

test("exact-account SHORT requires SELL_SHORT opening", () => {
  const installation = listeningInstallation({
    handoff: { direction: "SHORT", currentExpectedEntry: 224, effectiveStop: 225, structuralInvalidation: 225.2 },
  });
  const result = evaluateV24InitialFillOwnership({
    installation,
    brokerState: brokerState({ events: [execution({ instruction: "SELL_SHORT", price: 224 })] }),
  });
  assert.equal(result.status, "MATCHED");
});

test("executionTime before listening does not match even when detected later", () => {
  const result = evaluateV24InitialFillOwnership({
    installation: listeningInstallation(),
    brokerState: brokerState({ events: [execution({
      executionTime: "2026-09-02T18:00:02.999Z",
      detectedAt: "2026-09-02T18:00:04.500Z",
    })] }),
  });
  assert.equal(result.status, "WAITING");
});

test("wrong-account same-symbol execution before a correct fill suspends auto ownership", () => {
  const result = evaluateV24InitialFillOwnership({
    installation: listeningInstallation(),
    brokerState: brokerState({ events: [
      execution({ accountId: "opaque-B", executionTime: "2026-09-02T18:00:03.500Z" }),
      execution({ executionTime: "2026-09-02T18:00:04.000Z" }),
    ] }),
  });
  assert.equal(result.status, "SUSPENDED");
  assert.equal(result.reason, "WRONG_ACCOUNT_EXECUTION_OBSERVED");
});

test("wrong-account execution after an already eligible first fill does not erase that first ownership", () => {
  const result = evaluateV24InitialFillOwnership({
    installation: listeningInstallation(),
    brokerState: brokerState({ events: [
      execution({ executionTime: "2026-09-02T18:00:04.000Z" }),
      execution({ accountId: "opaque-B", executionTime: "2026-09-02T18:00:05.000Z" }),
    ] }),
  });
  assert.equal(result.status, "MATCHED");
  assert.equal(result.matchedExecution.executionTime, "2026-09-02T18:00:04.000Z");
});

test("wrong-account execution at same authoritative time fails closed", () => {
  const result = evaluateV24InitialFillOwnership({
    installation: listeningInstallation(),
    brokerState: brokerState({ events: [
      execution({ accountId: "opaque-B" }),
      execution(),
    ] }),
  });
  assert.equal(result.status, "SUSPENDED");
  assert.equal(result.reason, "WRONG_ACCOUNT_EXECUTION_OBSERVED");
});

test("unexpected authorized-account same-symbol activity before opening fill suspends", () => {
  const result = evaluateV24InitialFillOwnership({
    installation: listeningInstallation(),
    brokerState: brokerState({ events: [
      execution({ instruction: "SELL", positionEffect: "CLOSING", executionTime: "2026-09-02T18:00:03.500Z" }),
      execution({ executionTime: "2026-09-02T18:00:04.000Z" }),
    ] }),
  });
  assert.equal(result.status, "SUSPENDED");
  assert.equal(result.reason, "UNEXPECTED_AUTHORIZED_ACCOUNT_EXECUTION");
});

test("coverage GAP suspends initial fill ownership", () => {
  const state = brokerState();
  state.executionCoverage = markBrokerExecutionCoverageGap(state.executionCoverage, {
    gapDetectedAt: "2026-09-02T18:00:11.000Z",
    reason: "poll failed",
  });
  state.executionOwnershipJournal = createBrokerExecutionOwnershipJournal();
  const result = evaluateV24InitialFillOwnership({ installation: listeningInstallation(), brokerState: state });
  assert.equal(result.status, "SUSPENDED");
  assert.equal(result.reason, "BROKER_EXECUTION_COVERAGE_GAP");
});

test("recovered coverage beginning after executionListeningAt does not silently reactivate matching", () => {
  const result = evaluateV24InitialFillOwnership({
    installation: listeningInstallation(),
    brokerState: brokerState({
      coverageStart: "2026-09-02T18:00:06.000Z",
      currentThrough: "2026-09-02T18:00:10.000Z",
      events: [execution({ executionTime: "2026-09-02T18:00:07.000Z" })],
    }),
  });
  assert.equal(result.status, "SUSPENDED");
  assert.equal(result.reason, "BROKER_EXECUTION_COVERAGE_GAP");
});

test("coverage/journal interval mismatch suspends", () => {
  const state = brokerState();
  state.executionOwnershipJournal = establishBrokerExecutionOwnershipJournal(createBrokerExecutionOwnershipJournal(), {
    coverageStartedAt: "2026-09-02T17:59:59.000Z",
    currentThrough: state.executionCoverage.currentThrough,
  });
  const result = evaluateV24InitialFillOwnership({ installation: listeningInstallation(), brokerState: state });
  assert.equal(result.status, "SUSPENDED");
  assert.equal(result.reason, "BROKER_EXECUTION_COVERAGE_GAP");
});

test("bounded UI executions array is ignored for ownership", () => {
  const matching = execution();
  const result = evaluateV24InitialFillOwnership({
    installation: listeningInstallation(),
    brokerState: brokerState({ events: [], executions: [matching] }),
  });
  assert.equal(result.status, "WAITING");
});

test("missing exact authorized account suspends", () => {
  const result = evaluateV24InitialFillOwnership({
    installation: listeningInstallation(),
    brokerState: brokerState({ accounts: [{ accountId: "opaque-B" }] }),
  });
  assert.equal(result.status, "SUSPENDED");
  assert.equal(result.reason, "AUTHORIZED_EXECUTION_ACCOUNT_UNAVAILABLE");
});

test("partial first fill immediately qualifies for ownership", () => {
  const result = evaluateV24InitialFillOwnership({
    installation: listeningInstallation(),
    brokerState: brokerState({ events: [execution({ quantity: 1 })] }),
  });
  assert.equal(result.status, "MATCHED");
  assert.equal(result.matchedExecution.quantity, 1);
  assert.deepEqual(result.warnings, []);
});

test("oversized first fill is still owned but reports authorized quantity exceeded", () => {
  const result = evaluateV24InitialFillOwnership({
    installation: listeningInstallation(),
    brokerState: brokerState({ events: [execution({ quantity: 25 })] }),
  });
  assert.equal(result.status, "MATCHED");
  assert.deepEqual(result.warnings, ["AUTHORIZED_QUANTITY_EXCEEDED"]);
});

test("journal event beyond proven currentThrough is not owned yet", () => {
  const result = evaluateV24InitialFillOwnership({
    installation: listeningInstallation(),
    brokerState: brokerState({
      currentThrough: "2026-09-02T18:00:03.500Z",
      events: [execution({ executionTime: "2026-09-02T18:00:04.000Z" })],
    }),
  });
  assert.equal(result.status, "WAITING");
});
