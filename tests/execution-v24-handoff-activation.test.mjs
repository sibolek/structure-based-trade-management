import test from "node:test";
import assert from "node:assert/strict";

import { advanceV24HandoffActivation } from "../src/execution/execution-v24-handoff-activation.js";
import { readV24LocalInstallation } from "../src/execution/execution-v24-local-installation.js";
import { readV24Retirement } from "../src/execution/execution-v24-retirement.js";

const STORE_KEY = "execution-v23-store";

function handoff(overrides = {}) {
  return {
    schemaVersion: 1,
    handoffId: "handoff-001",
    createdAt: "2026-09-02T18:00:01.000Z",
    authorizedAt: "2026-09-02T18:00:00.000Z",
    sourceId: "SOD_A_PLUS",
    candidateId: "candidate-001",
    contractVersion: 3,
    candidateContentHash: "hash-001",
    symbol: "NVDA",
    direction: "LONG",
    setup: "H2 continuation",
    timeframe: "2m",
    thesis: "Continuation after structural pullback",
    trigger: { type: "BREAKOUT", level: 225.75 },
    targets: [227, 228],
    managementPlan: "Manage against structure",
    structuralInvalidation: 224.8,
    effectiveStop: 224.65,
    currentExpectedEntry: 225.8,
    selectedQuantity: 20,
    authorizedExecutionAccountId: "opaque-account-A",
    dssEvaluationId: "dss-001",
    riskEvaluationId: "risk-001",
    ...overrides,
  };
}

function delivery(status = "CLAIMED", overrides = {}) {
  return {
    schemaVersion: 1,
    handoffId: "handoff-001",
    status,
    createdAt: "2026-09-02T18:00:01.100Z",
    claimedBy: status === "PENDING" ? null : "receiver-A",
    claimedAt: status === "PENDING" ? null : "2026-09-02T18:00:02.000Z",
    deliveredAt: status === "DELIVERED" ? "2026-09-02T18:00:05.000Z" : null,
    executionListeningAt: status === "DELIVERED" ? "2026-09-02T18:00:03.000Z" : null,
    blockedAt: null,
    blockReason: null,
    ...overrides,
  };
}

function brokerState({
  currentThrough = "2026-09-02T18:00:02.500Z",
  activityEntries = [],
  positions = [],
  status = "ARMED",
} = {}) {
  return {
    version: 2,
    status,
    readOnly: true,
    source: "SCHWAB",
    lastError: null,
    accounts: [{ accountId: "opaque-account-A", account: "••••8891", equity: 14000, maxRisk: 70 }],
    positions,
    executionCoverage: {
      schemaVersion: 1,
      status: "CONTIGUOUS",
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: "2026-09-02T17:59:59.000Z",
      baselineCompletedAt: "2026-09-02T17:59:59.000Z",
      currentThrough,
      lastGapAt: null,
      lastGapReason: null,
    },
    executionActivity: {
      schemaVersion: 1,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: "2026-09-02T17:59:59.000Z",
      currentThrough,
      entries: activityEntries,
    },
    executionOwnershipJournal: {
      schemaVersion: 1,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: "2026-09-02T17:59:59.000Z",
      currentThrough,
      entries: [],
    },
  };
}

function memoryStorage(initial = null) {
  const values = new Map();
  if (initial) values.set(STORE_KEY, JSON.stringify(initial));
  const storage = {
    failWrites: false,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (storage.failWrites) throw new Error("simulated persistence failure");
      values.set(key, String(value));
    },
  };
  return storage;
}

function transportMock({ ackFails = false, blockFails = false } = {}) {
  const calls = [];
  return {
    calls,
    async claim(handoffId, receiverId) {
      calls.push(["claim", handoffId, receiverId]);
      return { handoff: handoff(), delivery: delivery("CLAIMED") };
    },
    async acknowledge(handoffId, receiverId, executionListeningAt) {
      calls.push(["ack", handoffId, receiverId, executionListeningAt]);
      if (ackFails) {
        const error = new Error("pretrade unavailable");
        error.code = "V24_HANDOFF_TRANSPORT_UNAVAILABLE";
        throw error;
      }
      return {
        handoff: handoff(),
        delivery: delivery("DELIVERED", { executionListeningAt, deliveredAt: "2026-09-02T18:00:05.000Z" }),
      };
    },
    async block(handoffId, receiverId, reason) {
      calls.push(["block", handoffId, receiverId, reason]);
      if (blockFails) throw new Error("block unavailable");
      return {
        handoff: handoff(),
        delivery: delivery("BLOCKED", {
          blockedAt: "2026-09-02T18:00:05.000Z",
          blockReason: reason,
        }),
      };
    },
  };
}

const envelope = () => ({ handoff: handoff(), delivery: delivery("CLAIMED") });

test("PENDING delivery is claimed before any local installation is prepared", async () => {
  const storage = memoryStorage();
  const transport = transportMock();
  const result = await advanceV24HandoffActivation({
    envelope: { handoff: handoff(), delivery: delivery("PENDING") },
    brokerState: brokerState(),
    receiverId: "receiver-A",
    storage,
    transport,
    now: () => "2026-09-02T18:00:03.000Z",
  });

  assert.equal(transport.calls[0][0], "claim");
  assert.equal(result.status, "WAITING_FOR_BROKER_PROOF");
  assert.equal(result.proposedExecutionListeningAt, "2026-09-02T18:00:03.000Z");
  assert.equal(readV24LocalInstallation({ storage, handoffId: "handoff-001" }).status, "PREPARED");
});

test("PREPARED holds one proposed boundary while broker coverage catches up", async () => {
  const storage = memoryStorage();
  const transport = transportMock();
  const first = await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState(), receiverId: "receiver-A", storage, transport,
    now: () => "2026-09-02T18:00:03.000Z",
  });
  const second = await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState({ currentThrough: "2026-09-02T18:00:02.900Z" }),
    receiverId: "receiver-A", storage, transport,
    proposedExecutionListeningAt: first.proposedExecutionListeningAt,
    now: () => "2026-09-02T18:00:04.000Z",
  });

  assert.equal(second.status, "WAITING_FOR_BROKER_PROOF");
  assert.equal(second.proposedExecutionListeningAt, "2026-09-02T18:00:03.000Z");
});

test("final proof through exact T persists LISTENING before ACK and delivers exact T", async () => {
  const storage = memoryStorage();
  const transport = transportMock();
  await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState(), receiverId: "receiver-A", storage, transport,
    now: () => "2026-09-02T18:00:03.000Z",
  });

  const result = await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState({ currentThrough: "2026-09-02T18:00:03.500Z" }),
    receiverId: "receiver-A", storage, transport,
    proposedExecutionListeningAt: "2026-09-02T18:00:03.000Z",
  });

  const local = readV24LocalInstallation({ storage, handoffId: "handoff-001" });
  assert.equal(local.status, "LISTENING");
  assert.equal(local.executionListeningAt, "2026-09-02T18:00:03.000Z");
  assert.equal(result.status, "DELIVERED");
  assert.deepEqual(transport.calls.at(-1), ["ack", "handoff-001", "receiver-A", "2026-09-02T18:00:03.000Z"]);
});

test("ACK outage leaves durable LISTENING authoritative and reports retryable ACK pending", async () => {
  const storage = memoryStorage();
  const setupTransport = transportMock();
  await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState(), receiverId: "receiver-A", storage, transport: setupTransport,
    now: () => "2026-09-02T18:00:03.000Z",
  });

  const transport = transportMock({ ackFails: true });
  const result = await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState({ currentThrough: "2026-09-02T18:00:03.500Z" }),
    receiverId: "receiver-A", storage, transport,
    proposedExecutionListeningAt: "2026-09-02T18:00:03.000Z",
  });

  assert.equal(result.status, "LISTENING_ACK_PENDING");
  assert.equal(readV24LocalInstallation({ storage, handoffId: "handoff-001" }).executionListeningAt, "2026-09-02T18:00:03.000Z");
});

test("restart with local LISTENING retries ACK using original T and never creates a replacement boundary", async () => {
  const storage = memoryStorage();
  const firstTransport = transportMock({ ackFails: true });
  await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState(), receiverId: "receiver-A", storage, transport: firstTransport,
    now: () => "2026-09-02T18:00:03.000Z",
  });
  await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState({ currentThrough: "2026-09-02T18:00:03.500Z" }),
    receiverId: "receiver-A", storage, transport: firstTransport,
    proposedExecutionListeningAt: "2026-09-02T18:00:03.000Z",
  });

  const retryTransport = transportMock();
  const retry = await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState({ currentThrough: "2026-09-02T18:00:10.000Z" }),
    receiverId: "receiver-A", storage, transport: retryTransport,
    now: () => "2026-09-02T18:00:09.000Z",
  });

  assert.equal(retry.status, "DELIVERED");
  assert.deepEqual(retryTransport.calls[0], ["ack", "handoff-001", "receiver-A", "2026-09-02T18:00:03.000Z"]);
});

test("LISTENING persistence failure leaves PREPARED authoritative and proposed T ineffective", async () => {
  const storage = memoryStorage();
  const transport = transportMock();
  await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState(), receiverId: "receiver-A", storage, transport,
    now: () => "2026-09-02T18:00:03.000Z",
  });
  storage.failWrites = true;

  await assert.rejects(
    () => advanceV24HandoffActivation({
      envelope: envelope(), brokerState: brokerState({ currentThrough: "2026-09-02T18:00:03.500Z" }),
      receiverId: "receiver-A", storage, transport,
      proposedExecutionListeningAt: "2026-09-02T18:00:03.000Z",
    }),
    (error) => error.code === "LOCAL_EXECUTION_PERSISTENCE_FAILED",
  );
  storage.failWrites = false;
  assert.equal(readV24LocalInstallation({ storage, handoffId: "handoff-001" }).status, "PREPARED");
});

test("final intervening broker activity retires PREPARED reservation and blocks delivery", async () => {
  const storage = memoryStorage();
  const transport = transportMock();
  await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState(), receiverId: "receiver-A", storage, transport,
    now: () => "2026-09-02T18:00:03.000Z",
  });

  const result = await advanceV24HandoffActivation({
    envelope: envelope(),
    brokerState: brokerState({
      currentThrough: "2026-09-02T18:00:03.500Z",
      activityEntries: [{
        accountId: "opaque-account-A",
        symbol: "NVDA",
        latestExecutionTime: "2026-09-02T18:00:02.800Z",
        latestDetectedAt: "2026-09-02T18:00:03.100Z",
      }],
    }),
    receiverId: "receiver-A", storage, transport,
    proposedExecutionListeningAt: "2026-09-02T18:00:03.000Z",
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "INTERVENING_BROKER_ACTIVITY");
  assert.equal(readV24Retirement({ storage, handoffId: "handoff-001" }).status, "RETIRED");
});

test("existing broker position blocks before PREPARED is created", async () => {
  const storage = memoryStorage();
  const transport = transportMock();
  const result = await advanceV24HandoffActivation({
    envelope: envelope(),
    brokerState: brokerState({ positions: [{ accountId: "opaque-account-A", symbol: "NVDA", quantity: 1 }] }),
    receiverId: "receiver-A", storage, transport,
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "EXISTING_POSITION_AT_HANDOFF");
  assert.equal(readV24LocalInstallation({ storage, handoffId: "handoff-001" }), null);
});

test("existing local symbol owner blocks before PREPARED is created", async () => {
  const storage = memoryStorage({
    candidates: [{ originalPlan: { symbol: "NVDA" } }],
    liveTrades: [], history: [], v24Installations: [], v24Retirements: [],
  });
  const result = await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState(), receiverId: "receiver-A", storage, transport: transportMock(),
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "EXECUTION_SYMBOL_OWNERSHIP_CONFLICT");
});

test("server DELIVERED with missing local LISTENING fails into explicit reconciliation", async () => {
  const result = await advanceV24HandoffActivation({
    envelope: { handoff: handoff(), delivery: delivery("DELIVERED") },
    brokerState: brokerState(), receiverId: "receiver-A", storage: memoryStorage(), transport: transportMock(),
  });
  assert.equal(result.status, "RECONCILIATION_REQUIRED");
  assert.equal(result.reason, "DELIVERED_HANDOFF_MISSING_LOCALLY");
});

test("server DELIVERED with conflicting local boundary fails closed", async () => {
  const storage = memoryStorage();
  const transport = transportMock({ ackFails: true });
  await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState(), receiverId: "receiver-A", storage, transport,
    now: () => "2026-09-02T18:00:03.000Z",
  });
  await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState({ currentThrough: "2026-09-02T18:00:03.500Z" }),
    receiverId: "receiver-A", storage, transport,
    proposedExecutionListeningAt: "2026-09-02T18:00:03.000Z",
  });

  await assert.rejects(
    () => advanceV24HandoffActivation({
      envelope: { handoff: handoff(), delivery: delivery("DELIVERED", { executionListeningAt: "2026-09-02T18:00:04.000Z" }) },
      brokerState: brokerState(), receiverId: "receiver-A", storage, transport: transportMock(),
    }),
    (error) => error.code === "HANDOFF_ACK_CONTENT_CONFLICT",
  );
});

test("PREPARED restart may choose a fresh proposal because no earlier proposal became authoritative", async () => {
  const storage = memoryStorage();
  const transport = transportMock();
  const first = await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState(), receiverId: "receiver-A", storage, transport,
    now: () => "2026-09-02T18:00:03.000Z",
  });
  assert.equal(first.proposedExecutionListeningAt, "2026-09-02T18:00:03.000Z");

  const restarted = await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState({ currentThrough: "2026-09-02T18:00:03.500Z" }),
    receiverId: "receiver-A", storage, transport,
    now: () => "2026-09-02T18:00:04.000Z",
  });
  assert.equal(restarted.status, "WAITING_FOR_BROKER_PROOF");
  assert.equal(restarted.proposedExecutionListeningAt, "2026-09-02T18:00:04.000Z");
});

test("proposed listening boundary may never precede sticky claim time", async () => {
  const storage = memoryStorage();
  await assert.rejects(
    () => advanceV24HandoffActivation({
      envelope: envelope(), brokerState: brokerState({ currentThrough: "2026-09-02T18:00:05.000Z" }),
      receiverId: "receiver-A", storage, transport: transportMock(),
      proposedExecutionListeningAt: "2026-09-02T18:00:01.500Z",
    }),
    (error) => error.code === "V24_EXECUTION_LISTENING_AT_INVALID",
  );
});

test("retired local handoff cannot reactivate and is driven to server BLOCKED", async () => {
  const storage = memoryStorage();
  const transport = transportMock();
  const prepared = await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState(), receiverId: "receiver-A", storage, transport,
    now: () => "2026-09-02T18:00:03.000Z",
  });
  assert.equal(prepared.status, "WAITING_FOR_BROKER_PROOF");

  const { requestV24Retirement } = await import("../src/execution/execution-v24-retirement.js");
  requestV24Retirement({
    storage,
    handoffId: "handoff-001",
    receiverId: "receiver-A",
    requestedAt: "2026-09-02T18:00:03.100Z",
  });

  const retry = await advanceV24HandoffActivation({
    envelope: envelope(), brokerState: brokerState(), receiverId: "receiver-A", storage, transport,
  });
  assert.equal(retry.status, "BLOCKED");
  assert.equal(retry.reason, "V24_HANDOFF_RETIRED");
});
