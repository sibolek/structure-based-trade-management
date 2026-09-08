import test from "node:test";
import assert from "node:assert/strict";

import { advanceV24HandoffActivation } from "../src/execution/execution-v24-handoff-activation.js";
import { readV24LocalInstallation } from "../src/execution/execution-v24-local-installation.js";

const STORE_KEY = "execution-v23-store";

function handoff(overrides = {}) {
  return {
    schemaVersion: 1,
    handoffId: "handoff-lag-001",
    createdAt: "2026-09-02T18:00:00.100Z",
    authorizedAt: "2026-09-02T18:00:00.000Z",
    sourceId: "SOD_A_PLUS",
    candidateId: "candidate-lag-001",
    contractVersion: 3,
    candidateContentHash: "hash-lag-001",
    symbol: "MES",
    direction: "LONG",
    setup: "breakout pullback",
    timeframe: "2m",
    thesis: "Synthetic initial broker-watermark lag regression",
    trigger: { type: "BREAKOUT", level: 7715.25 },
    targets: [7719.5, 7722],
    managementPlan: "Synthetic only",
    structuralInvalidation: 7713,
    effectiveStop: 7712.5,
    currentExpectedEntry: 7713.75,
    selectedQuantity: 2,
    authorizedExecutionAccountId: "opaque-account-A",
    dssEvaluationId: "dss-lag-001",
    riskEvaluationId: "risk-lag-001",
    ...overrides,
  };
}

function delivery(overrides = {}) {
  return {
    schemaVersion: 1,
    handoffId: "handoff-lag-001",
    status: "CLAIMED",
    createdAt: "2026-09-02T18:00:00.110Z",
    claimedBy: "receiver-A",
    claimedAt: "2026-09-02T18:00:00.120Z",
    executionListeningAt: null,
    deliveredAt: null,
    blockedAt: null,
    blockReason: null,
    ...overrides,
  };
}

function brokerState({
  coverageStartedAt = "2026-09-02T17:59:50.000Z",
  currentThrough = "2026-09-02T17:59:59.900Z",
} = {}) {
  return {
    version: 2,
    status: "ARMED",
    readOnly: true,
    source: "SCHWAB",
    updatedAt: currentThrough,
    lastError: null,
    accounts: [{ accountId: "opaque-account-A", account: "••••8891", equity: 14000, maxRisk: 70 }],
    positions: [],
    executionCoverage: {
      schemaVersion: 1,
      status: "CONTIGUOUS",
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt,
      baselineCompletedAt: coverageStartedAt,
      currentThrough,
      lastGapAt: null,
      lastGapReason: null,
    },
    executionActivity: {
      schemaVersion: 1,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt,
      currentThrough,
      entries: [],
    },
    executionOwnershipJournal: {
      schemaVersion: 1,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt,
      currentThrough,
      entries: [],
    },
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function writerLockManager() {
  return {
    async request(name, options, callback) {
      return callback({ name, mode: options?.mode });
    },
  };
}

function transportMock() {
  const calls = [];
  return {
    calls,
    async claim() {
      throw new Error("claim should not be called for already-claimed delivery");
    },
    async acknowledge() {
      throw new Error("acknowledge should not be reached in these tests");
    },
    async block(handoffId, receiverId, reason) {
      calls.push(["block", handoffId, receiverId, reason]);
      return {
        handoff: handoff(),
        delivery: delivery({
          status: "BLOCKED",
          blockedAt: "2026-09-02T18:00:00.500Z",
          blockReason: reason,
        }),
      };
    },
  };
}

function activate({ storage, transport, broker, now = "2026-09-02T18:00:01.000Z" }) {
  return advanceV24HandoffActivation({
    envelope: { handoff: handoff(), delivery: delivery() },
    brokerState: broker,
    receiverId: "receiver-A",
    storage,
    storeKey: STORE_KEY,
    transport,
    now: () => now,
    lockManager: writerLockManager(),
  });
}

test("initial contiguous broker watermark lag waits instead of terminally blocking the handoff", async () => {
  const storage = memoryStorage();
  const transport = transportMock();
  const result = await activate({
    storage,
    transport,
    broker: brokerState(),
  });

  assert.equal(result.status, "WAITING_FOR_BROKER_PROOF");
  assert.equal(result.waitReason, "BROKER_EXECUTION_COVERAGE_LAG");
  assert.equal(result.brokerCurrentThrough, "2026-09-02T17:59:59.900Z");
  assert.equal(result.requiredThrough, "2026-09-02T18:00:00.000Z");
  assert.equal(transport.calls.length, 0);
  assert.equal(readV24LocalInstallation({ storage, storeKey: STORE_KEY, handoffId: "handoff-lag-001" }), null);
});

test("once initial coverage catches authorization, activation can prepare and wait on the listening boundary", async () => {
  const storage = memoryStorage();
  const transport = transportMock();

  const lagged = await activate({ storage, transport, broker: brokerState() });
  assert.equal(lagged.status, "WAITING_FOR_BROKER_PROOF");

  const caughtUp = await activate({
    storage,
    transport,
    broker: brokerState({ currentThrough: "2026-09-02T18:00:00.500Z" }),
    now: "2026-09-02T18:00:01.000Z",
  });

  assert.equal(caughtUp.status, "WAITING_FOR_BROKER_PROOF");
  assert.equal(caughtUp.proposedExecutionListeningAt, "2026-09-02T18:00:01.000Z");
  assert.equal(transport.calls.length, 0);
  assert.equal(
    readV24LocalInstallation({ storage, storeKey: STORE_KEY, handoffId: "handoff-lag-001" })?.status,
    "PREPARED",
  );
});

test("coverage that starts after authorization remains a terminal admission block", async () => {
  const storage = memoryStorage();
  const transport = transportMock();
  const result = await activate({
    storage,
    transport,
    broker: brokerState({
      coverageStartedAt: "2026-09-02T18:00:00.050Z",
      currentThrough: "2026-09-02T18:00:01.000Z",
    }),
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "BROKER_EXECUTION_COVERAGE_GAP");
  assert.deepEqual(transport.calls, [[
    "block",
    "handoff-lag-001",
    "receiver-A",
    "BROKER_EXECUTION_COVERAGE_GAP",
  ]]);
});
