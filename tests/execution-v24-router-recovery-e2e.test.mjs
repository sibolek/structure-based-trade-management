import test from "node:test";
import assert from "node:assert/strict";

import {
  EXECUTION_BOARD_STORE_KEY,
  readExecutionBoardStore,
} from "../src/execution/execution-board-store-repository.js";
import {
  executionOwnedSymbolsForHandoffAdmission,
  v24OwnershipView,
} from "../src/execution/execution-v24-active-ownership.js";
import {
  runV24ExecutionRouterCycle,
} from "../src/execution/execution-v24-runtime-router.js";
import {
  requestV24RetirementSerialized,
} from "../src/execution/execution-v24-retirement.js";

const HANDOFF_ID = "handoff-recovery-e2e";
const RECEIVER_ID = "receiver-recovery-e2e";
const ACCOUNT_ID = "opaque-account-A";
const LISTENING_AT = "2026-09-02T18:00:03.000Z";
const CUTOFF_AT = "2026-09-02T18:00:04.000Z";

function memoryStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function serialLockManager() {
  let tail = Promise.resolve();

  return {
    request(_name, _options, callback) {
      const run = tail.then(() => callback());
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

function handoff() {
  return {
    schemaVersion: 1,
    handoffId: HANDOFF_ID,
    createdAt: "2026-09-02T18:00:01.000Z",
    authorizedAt: "2026-09-02T18:00:00.000Z",
    sourceId: "SOD_A_PLUS",
    candidateId: "candidate-recovery-e2e",
    contractVersion: 3,
    candidateContentHash: "hash-recovery-e2e",
    symbol: "NVDA",
    direction: "LONG",
    setup: "H2 continuation",
    timeframe: "2m",
    thesis: "Decision 22 synthetic read-only recovery E2E",
    trigger: { type: "BREAKOUT", level: 100 },
    targets: [102, 104],
    managementPlan: "Manage against structure",
    structuralInvalidation: 98.5,
    effectiveStop: 99,
    currentExpectedEntry: 100,
    selectedQuantity: 5,
    authorizedMaxDollarRisk: 5,
    authorizedExecutionAccountId: ACCOUNT_ID,
    dssEvaluationId: "dss-recovery-e2e",
    riskEvaluationId: "risk-recovery-e2e",
  };
}

function delivery(status, overrides = {}) {
  return {
    schemaVersion: 1,
    handoffId: HANDOFF_ID,
    status,
    createdAt: "2026-09-02T18:00:01.100Z",
    claimedBy: status === "PENDING" ? null : RECEIVER_ID,
    claimedAt: status === "PENDING"
      ? null
      : "2026-09-02T18:00:02.000Z",
    deliveredAt: status === "DELIVERED"
      ? "2026-09-02T18:00:03.600Z"
      : null,
    executionListeningAt: status === "DELIVERED"
      ? LISTENING_AT
      : null,
    blockedAt: null,
    blockReason: null,
    ...overrides,
  };
}

function brokerState(currentThrough) {
  return {
    version: 2,
    status: "ARMED",
    source: "SCHWAB",
    readOnly: true,
    brokerWriteAuthority: false,
    lastError: null,

    accounts: [{
      accountId: ACCOUNT_ID,
      account: "••••8891",
      equity: 14000,
      maxRisk: 70,
    }],

    positions: [],

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
      entries: [],
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

function pretradeTransport() {
  let serverStatus = "PENDING";
  const calls = [];

  return {
    calls,

    async discover(receiverId) {
      calls.push(["discover", receiverId]);

      return [{
        handoff: handoff(),
        delivery: delivery(serverStatus),
      }];
    },

    async claim(handoffId, receiverId) {
      calls.push(["claim", handoffId, receiverId]);
      serverStatus = "CLAIMED";

      return {
        handoff: handoff(),
        delivery: delivery("CLAIMED"),
      };
    },

    async acknowledge(handoffId, receiverId, executionListeningAt) {
      calls.push([
        "ack",
        handoffId,
        receiverId,
        executionListeningAt,
      ]);

      serverStatus = "DELIVERED";

      return {
        handoff: handoff(),
        delivery: delivery("DELIVERED", {
          executionListeningAt,
        }),
      };
    },

    async block(handoffId, receiverId, reason) {
      calls.push(["block", handoffId, receiverId, reason]);
      serverStatus = "BLOCKED";

      return {
        handoff: handoff(),
        delivery: delivery("BLOCKED", {
          blockedAt: "2026-09-02T18:00:03.600Z",
          blockReason: reason,
        }),
      };
    },
  };
}

function findStage(cycle, stage) {
  return cycle.results.find((item) => item.stage === stage);
}

test("Decision 22J synthetic read-only E2E recovers REQUESTED retirement after pretrade loss without refresh", async () => {
  const storage = memoryStorage();
  const lockManager = serialLockManager();
  const transport = pretradeTransport();

  // Epoch 1: PENDING -> claim -> durable PREPARED.
  let proposedBoundaries = new Map();

  const prepared = await runV24ExecutionRouterCycle({
    transport,
    receiverId: RECEIVER_ID,
    brokerState: brokerState("2026-09-02T18:00:02.500Z"),
    storage,
    proposedBoundaries,
    now: () => LISTENING_AT,
    lockManager,
  });

  assert.equal(
    findStage(prepared, "ACTIVATION").status,
    "WAITING_FOR_BROKER_PROOF",
  );

  let store = readExecutionBoardStore({ storage });
  let ownership = v24OwnershipView(store, HANDOFF_ID);

  assert.equal(ownership.installation.status, "PREPARED");
  assert.equal(ownership.installation.executionListeningAt, null);
  assert.deepEqual(
    executionOwnedSymbolsForHandoffAdmission(store),
    ["NVDA"],
  );

  // Broker proof catches up through T: durable LISTENING is written
  // before the ACK, and the server receives that exact immutable T.
  const delivered = await runV24ExecutionRouterCycle({
    transport,
    receiverId: RECEIVER_ID,
    brokerState: brokerState("2026-09-02T18:00:03.500Z"),
    storage,
    proposedBoundaries,
    now: () => "2026-09-02T18:00:03.600Z",
    lockManager,
  });

  assert.equal(findStage(delivered, "ACTIVATION").status, "DELIVERED");

  const ack = transport.calls.find((call) => call[0] === "ack");
  assert.deepEqual(
    ack,
    ["ack", HANDOFF_ID, RECEIVER_ID, LISTENING_AT],
  );

  store = readExecutionBoardStore({ storage });
  ownership = v24OwnershipView(store, HANDOFF_ID);

  assert.equal(ownership.installation.status, "LISTENING");
  assert.equal(
    ownership.installation.executionListeningAt,
    LISTENING_AT,
  );

  // Operator DISCARD freezes the exact cutoff.
  const retirement = await requestV24RetirementSerialized({
    storage,
    storeKey: EXECUTION_BOARD_STORE_KEY,
    handoffId: HANDOFF_ID,
    receiverId: RECEIVER_ID,
    requestedAt: CUTOFF_AT,
    lockManager,
  });

  assert.equal(retirement.status, "REQUESTED");
  assert.equal(retirement.cutoffAt, CUTOFF_AT);
  assert.equal(retirement.finalizedAt, null);

  // Simulate restart/HMR: the transient proposed-boundary map disappears.
  proposedBoundaries = new Map();

  // Pretrade is now unavailable. Broker proof is healthy/CONTIGUOUS
  // but still behind the frozen discard cutoff. This MUST remain
  // REQUESTED — never false reconciliation, never symbol release.
  const behind = await runV24ExecutionRouterCycle({
    transport: null,
    receiverId: RECEIVER_ID,
    brokerState: brokerState("2026-09-02T18:00:03.750Z"),
    storage,
    proposedBoundaries,
    now: () => "2026-09-02T18:00:05.000Z",
    lockManager,
  });

  assert.equal(
    findStage(behind, "TRANSPORT").status,
    "WAITING_FOR_PRETRADE",
  );
  assert.equal(
    findStage(behind, "RETIREMENT").status,
    "REQUESTED",
  );

  store = readExecutionBoardStore({ storage });
  ownership = v24OwnershipView(store, HANDOFF_ID);

  assert.equal(ownership.retirement.status, "REQUESTED");
  assert.equal(ownership.retirement.finalizedAt, null);
  assert.deepEqual(
    executionOwnedSymbolsForHandoffAdmission(store),
    ["NVDA"],
  );

  // No refresh, no pretrade recovery. Only broker coverage advances.
  // Durable ownership lane must resolve retirement automatically.
  const recovered = await runV24ExecutionRouterCycle({
    transport: null,
    receiverId: RECEIVER_ID,
    brokerState: brokerState("2026-09-02T18:00:04.500Z"),
    storage,
    proposedBoundaries,
    now: () => "2026-09-02T18:00:05.500Z",
    lockManager,
  });

  assert.equal(
    findStage(recovered, "TRANSPORT").status,
    "WAITING_FOR_PRETRADE",
  );
  assert.equal(
    findStage(recovered, "RETIREMENT").status,
    "RETIRED",
  );
  assert.equal(
    findStage(recovered, "FIRST_FILL").status,
    "RETIRED",
  );

  store = readExecutionBoardStore({ storage });
  ownership = v24OwnershipView(store, HANDOFF_ID);

  assert.equal(ownership.retirement.status, "RETIRED");
  assert.equal(ownership.retirement.cutoffAt, CUTOFF_AT);
  assert.ok(ownership.retirement.finalizedAt);

  // Installation remains as immutable provenance/audit,
  // but ownership is released only after RETIRED.
  assert.equal(ownership.installation.status, "LISTENING");
  assert.equal(ownership.installationReservesSymbol, false);
  assert.equal(ownership.lifecycle, null);
  assert.deepEqual(
    executionOwnedSymbolsForHandoffAdmission(store),
    [],
  );

  // Hard safety evidence: the synthetic broker is observation-only.
  const finalBroker = brokerState("2026-09-02T18:00:04.500Z");
  assert.equal(finalBroker.readOnly, true);
  assert.equal(finalBroker.brokerWriteAuthority, false);

  // Only pretrade handoff operations occurred; there is no broker
  // order/cancel/replace/stop/reduction/flatten mutation interface here.
  assert.deepEqual(
    [...new Set(transport.calls.map((call) => call[0]))].sort(),
    ["ack", "claim", "discover"],
  );
});
