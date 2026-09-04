import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { buildExecutionBoardHandoff } from "../schwab-bridge/execution-board-handoff.mjs";
import { ExecutionBoardHandoffRepository } from "../schwab-bridge/execution-board-handoff-repository.mjs";
import { ExecutionBoardHandoffDeliveryRepository } from "../schwab-bridge/execution-board-handoff-delivery-repository.mjs";
import { createExecutionBoardHandoffApiHandler } from "../schwab-bridge/execution-board-handoff-api.mjs";
import {
  EXECUTION_BOARD_STORE_KEY,
  readExecutionBoardStore,
  transactExecutionBoardStoreSerialized,
} from "../src/execution/execution-board-store-repository.js";
import {
  executionOwnedSymbolsForHandoffAdmission,
  v24OwnershipView,
} from "../src/execution/execution-v24-active-ownership.js";
import { executionStop } from "../src/execution/execution-v23-compat.js";
import { createV24HandoffTransport } from "../src/execution/execution-v24-handoff-transport.js";
import { runV24ExecutionRouterCycle } from "../src/execution/execution-v24-runtime-router.js";

const HANDOFF_ID = "handoff-full-lifecycle-e2e";
const RECEIVER_ID = "receiver-full-lifecycle-e2e";
const ACCOUNT_ID = "opaque-account-A";
const SYMBOL = "NVDA";

const AUTHORIZED_AT = "2026-09-04T14:00:00.000Z";
const HANDOFF_CREATED_AT = "2026-09-04T14:00:01.000Z";
const DELIVERY_CREATED_AT = "2026-09-04T14:00:01.100Z";
const CLAIMED_AT = "2026-09-04T14:00:02.000Z";
const LISTENING_AT = "2026-09-04T14:00:03.000Z";
const DELIVERED_AT = "2026-09-04T14:00:03.600Z";
const FIRST_FILL_AT = "2026-09-04T14:00:04.000Z";
const PARTIAL_AT = "2026-09-04T14:00:05.000Z";
const FLAT_AT = "2026-09-04T14:00:06.000Z";
const COMPLETED_AT = "2026-09-04T14:00:07.000Z";
const COVERAGE_STARTED_AT = "2026-09-04T13:59:59.000Z";

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

function candidate() {
  return {
    candidateId: "sod-2026-09-04-NVDA-e2e",
    contractVersion: 3,
    contentHash: "candidate-full-lifecycle-e2e-hash",
    source: "SOD_A_PLUS",
    symbol: SYMBOL,
    direction: "LONG",
    setup: "Liquidity sweep reclaim continuation",
    timeframe: "2m",
    thesis: "Synthetic full downstream lifecycle E2E.",
    trigger: { type: "RECLAIM_AND_HOLD", level: 225.55 },
    targets: [226.5, 227.2],
    managementPlan: "Manage against structure.",
    lifecycleState: "ARMED",
    authorizedDssEvaluationId: "dss-full-lifecycle-e2e",
    authorizedRiskEvaluationId: "risk-full-lifecycle-e2e",
    arm: {
      authorizedAt: AUTHORIZED_AT,
      candidateVersion: 3,
      dssEvaluationId: "dss-full-lifecycle-e2e",
      riskEvaluationId: "risk-full-lifecycle-e2e",
      selectedQuantity: 20,
    },
  };
}

function riskEvaluation() {
  return {
    status: "VALID",
    riskEvaluationId: "risk-full-lifecycle-e2e",
    candidate: {
      candidateId: "sod-2026-09-04-NVDA-e2e",
      contractVersion: 3,
      candidateHash: "candidate-full-lifecycle-e2e-hash",
      symbol: SYMBOL,
      direction: "LONG",
    },
    dss: {
      dssEvaluationId: "dss-full-lifecycle-e2e",
      structuralInvalidation: 224.8,
      effectiveStop: 224.64,
    },
    entry: {
      currentExpectedEntry: 225.6,
    },
    account: {
      accountId: ACCOUNT_ID,
      maxDollarRisk: 70,
    },
    calculation: {
      finalQuantity: 30,
    },
  };
}

function brokerExecution({
  sequence,
  executionTime,
  instruction,
  positionEffect,
  quantity,
  price,
  stateEvent,
  previousSide,
  previousQuantity,
  nextSide,
  nextQuantity,
  averagePrice,
  orderId,
} = {}) {
  return {
    sequence,
    accountId: ACCOUNT_ID,
    account: "••••8891",
    orderId,
    executionKey: `exec-full-lifecycle-${sequence}`,
    symbol: SYMBOL,
    instruction,
    positionEffect,
    quantity,
    price,
    executionTime,
    detectedAt: new Date(Date.parse(executionTime) + 200).toISOString(),
    stateEvent,
    previousSide,
    previousQuantity,
    nextSide,
    nextQuantity,
    averagePrice,
  };
}

function firstFill() {
  return brokerExecution({
    sequence: 1,
    executionTime: FIRST_FILL_AT,
    instruction: "BUY",
    positionEffect: "OPENING",
    quantity: 5,
    price: 225.6,
    stateEvent: "ENTRY",
    previousSide: "FLAT",
    previousQuantity: 0,
    nextSide: "LONG",
    nextQuantity: 5,
    averagePrice: 225.6,
    orderId: "entry-order-e2e",
  });
}

function partialExit() {
  return brokerExecution({
    sequence: 2,
    executionTime: PARTIAL_AT,
    instruction: "SELL",
    positionEffect: "CLOSING",
    quantity: 2,
    price: 226.1,
    stateEvent: "PARTIAL",
    previousSide: "LONG",
    previousQuantity: 5,
    nextSide: "LONG",
    nextQuantity: 3,
    averagePrice: 225.6,
    orderId: "exit-order-e2e-1",
  });
}

function flatExit() {
  return brokerExecution({
    sequence: 3,
    executionTime: FLAT_AT,
    instruction: "SELL",
    positionEffect: "CLOSING",
    quantity: 3,
    price: 226.5,
    stateEvent: "FLAT",
    previousSide: "LONG",
    previousQuantity: 3,
    nextSide: "FLAT",
    nextQuantity: 0,
    averagePrice: 0,
    orderId: "exit-order-e2e-2",
  });
}

function brokerState(currentThrough, journalEntries = []) {
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
      coverageStartedAt: COVERAGE_STARTED_AT,
      baselineCompletedAt: COVERAGE_STARTED_AT,
      currentThrough,
      lastGapAt: null,
      lastGapReason: null,
    },
    executionActivity: {
      schemaVersion: 1,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: COVERAGE_STARTED_AT,
      currentThrough,
      entries: [],
    },
    executionOwnershipJournal: {
      schemaVersion: 1,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: COVERAGE_STARTED_AT,
      currentThrough,
      entries: structuredClone(journalEntries),
    },
  };
}

function findStage(cycle, stage) {
  return cycle.results.find((item) => item.stage === stage);
}

async function startApiServer({ handoffRepository, deliveryRepository, requests }) {
  const handler = createExecutionBoardHandoffApiHandler({
    handoffRepository,
    deliveryRepository,
  });

  const server = http.createServer(async (req, res) => {
    requests.push({ method: req.method, url: req.url });
    try {
      const handled = await handler(req, res);
      if (!handled) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
      }
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error.message, code: error.code || "TEST_SERVER_ERROR" }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    server,
    pretradeUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function completeExitClassification({ storage, lockManager, handoffId }) {
  return transactExecutionBoardStoreSerialized({
    storage,
    storeKey: EXECUTION_BOARD_STORE_KEY,
    lockManager,
    mutate: (latest) => {
      const trade = latest.liveTrades.find((item) => (
        item?.origin === "V24_HANDOFF"
        && item?.v24?.handoffId === handoffId
      ));
      if (!trade || trade.phase !== "EXIT") return latest;

      const completed = {
        ...structuredClone(trade),
        phase: "REVIEW",
        completedAt: COMPLETED_AT,
        exit: {
          reason: "TARGET / STRUCTURAL EXIT",
          classification: "PLANNED",
          time: COMPLETED_AT,
        },
        decisions: [
          ...(Array.isArray(trade.decisions) ? trade.decisions : []),
          {
            id: `v24-e2e:${handoffId}:classification`,
            timestamp: COMPLETED_AT,
            time: COMPLETED_AT,
            stage: "EXIT",
            state: trade.currentState,
            action: "TARGET / STRUCTURAL EXIT",
            note: "PLANNED",
          },
        ],
      };

      return {
        ...latest,
        liveTrades: latest.liveTrades.filter((item) => item.id !== trade.id),
        history: [completed, ...latest.history],
      };
    },
  });
}

test("V2.4 synthetic read-only full downstream lifecycle reaches History and releases ownership", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-full-e2e-"));
  const handoffFile = path.join(tempDir, "handoffs.json");
  const deliveryFile = path.join(tempDir, "deliveries.json");
  let serverNow = HANDOFF_CREATED_AT;

  const handoffRepository = new ExecutionBoardHandoffRepository({
    filePath: handoffFile,
    clock: () => serverNow,
  });
  handoffRepository.load();

  const handoff = buildExecutionBoardHandoff({
    handoffId: HANDOFF_ID,
    createdAt: HANDOFF_CREATED_AT,
    candidate: candidate(),
    riskEvaluation: riskEvaluation(),
  });
  handoffRepository.record(handoff);

  assert.equal(handoff.structuralInvalidation, 224.8);
  assert.equal(handoff.effectiveStop, 224.64);
  assert.notEqual(handoff.structuralInvalidation, handoff.effectiveStop);
  assert.equal(handoff.authorizedExecutionAccountId, ACCOUNT_ID);

  const deliveryRepository = new ExecutionBoardHandoffDeliveryRepository({
    handoffRepository,
    filePath: deliveryFile,
    clock: () => serverNow,
  });
  deliveryRepository.load();
  serverNow = DELIVERY_CREATED_AT;
  deliveryRepository.register(HANDOFF_ID);
  assert.equal(deliveryRepository.getById(HANDOFF_ID).status, "PENDING");

  const requests = [];
  const { server, pretradeUrl } = await startApiServer({
    handoffRepository,
    deliveryRepository,
    requests,
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const transport = createV24HandoffTransport({ pretradeUrl });
  const storage = memoryStorage();
  const lockManager = serialLockManager();
  const proposedBoundaries = new Map();
  const brokerSnapshots = [];

  // PENDING -> CLAIMED -> PREPARED, with broker proof still behind T.
  serverNow = CLAIMED_AT;
  let broker = brokerState("2026-09-04T14:00:02.500Z");
  brokerSnapshots.push(broker);
  const prepared = await runV24ExecutionRouterCycle({
    transport,
    receiverId: RECEIVER_ID,
    brokerState: broker,
    storage,
    proposedBoundaries,
    now: () => LISTENING_AT,
    lockManager,
  });

  assert.equal(findStage(prepared, "ACTIVATION").status, "WAITING_FOR_BROKER_PROOF");
  assert.equal(deliveryRepository.getById(HANDOFF_ID).status, "CLAIMED");

  let store = readExecutionBoardStore({ storage });
  let ownership = v24OwnershipView(store, HANDOFF_ID);
  assert.equal(ownership.installation.status, "PREPARED");
  assert.equal(ownership.installation.executionListeningAt, null);
  assert.equal(ownership.installation.compatibility.v24.structuralInvalidation, 224.8);
  assert.equal(ownership.installation.compatibility.v24.effectiveStop, 224.64);
  assert.deepEqual(executionOwnedSymbolsForHandoffAdmission(store), [SYMBOL]);

  // Broker proof catches up through exact T; LISTENING is durable before ACK.
  serverNow = DELIVERED_AT;
  broker = brokerState("2026-09-04T14:00:03.500Z");
  brokerSnapshots.push(broker);
  const delivered = await runV24ExecutionRouterCycle({
    transport,
    receiverId: RECEIVER_ID,
    brokerState: broker,
    storage,
    proposedBoundaries,
    now: () => DELIVERED_AT,
    lockManager,
  });

  assert.equal(findStage(delivered, "ACTIVATION").status, "DELIVERED");
  const deliveredState = deliveryRepository.getById(HANDOFF_ID);
  assert.equal(deliveredState.status, "DELIVERED");
  assert.equal(deliveredState.executionListeningAt, LISTENING_AT);

  store = readExecutionBoardStore({ storage });
  ownership = v24OwnershipView(store, HANDOFF_ID);
  assert.equal(ownership.installation.status, "LISTENING");
  assert.equal(ownership.installation.executionListeningAt, LISTENING_AT);
  assert.equal(ownership.lifecycle, null);
  assert.deepEqual(executionOwnedSymbolsForHandoffAdmission(store), [SYMBOL]);

  // Exact-account eligible opening fill transfers ownership atomically into LIVE.
  const first = firstFill();
  broker = brokerState("2026-09-04T14:00:04.500Z", [first]);
  brokerSnapshots.push(broker);
  const promoted = await runV24ExecutionRouterCycle({
    transport,
    receiverId: RECEIVER_ID,
    brokerState: broker,
    storage,
    proposedBoundaries,
    now: () => "2026-09-04T14:00:04.600Z",
    lockManager,
  });

  assert.equal(findStage(promoted, "FIRST_FILL").status, "PROMOTED_LIVE");
  store = readExecutionBoardStore({ storage });
  ownership = v24OwnershipView(store, HANDOFF_ID);
  assert.equal(ownership.lifecycle.status, "LIVE");
  assert.equal(ownership.lifecycle.executionAccountId, ACCOUNT_ID);
  assert.equal(ownership.lifecycle.currentQuantity, 5);
  assert.equal(ownership.installationReservesSymbol, false);
  assert.equal(ownership.lifecycleReservesSymbol, true);

  let trade = store.liveTrades.find((item) => item?.v24?.handoffId === HANDOFF_ID);
  assert.ok(trade);
  assert.equal(trade.origin, "V24_HANDOFF");
  assert.equal(trade.phase, "LIVE");
  assert.equal(trade.broker.accountId, ACCOUNT_ID);
  assert.equal(trade.v24.structuralInvalidation, 224.8);
  assert.equal(trade.v24.effectiveStop, 224.64);
  assert.equal(trade.originalPlan.structuralStop, 224.8);
  assert.equal(executionStop(trade), 224.64);
  assert.deepEqual(executionOwnedSymbolsForHandoffAdmission(store), [SYMBOL]);

  // Partial exit remains LIVE and advances exact-account lifecycle quantity.
  const partial = partialExit();
  broker = brokerState("2026-09-04T14:00:05.500Z", [first, partial]);
  brokerSnapshots.push(broker);
  const partialCycle = await runV24ExecutionRouterCycle({
    transport,
    receiverId: RECEIVER_ID,
    brokerState: broker,
    storage,
    proposedBoundaries,
    now: () => "2026-09-04T14:00:05.600Z",
    lockManager,
  });

  assert.equal(findStage(partialCycle, "LIFECYCLE").status, "LIVE");
  store = readExecutionBoardStore({ storage });
  ownership = v24OwnershipView(store, HANDOFF_ID);
  assert.equal(ownership.lifecycle.status, "LIVE");
  assert.equal(ownership.lifecycle.currentQuantity, 3);
  assert.equal(ownership.lifecycle.closingQuantity, 2);
  assert.deepEqual(executionOwnedSymbolsForHandoffAdmission(store), [SYMBOL]);

  // FLAT moves the broker-owned lifecycle to EXIT but MUST retain ownership
  // until explicit operator exit classification creates V2.4 History.
  const flat = flatExit();
  broker = brokerState("2026-09-04T14:00:06.500Z", [first, partial, flat]);
  brokerSnapshots.push(broker);
  const exitCycle = await runV24ExecutionRouterCycle({
    transport,
    receiverId: RECEIVER_ID,
    brokerState: broker,
    storage,
    proposedBoundaries,
    now: () => "2026-09-04T14:00:06.600Z",
    lockManager,
  });

  assert.equal(findStage(exitCycle, "LIFECYCLE").status, "EXIT");
  store = readExecutionBoardStore({ storage });
  ownership = v24OwnershipView(store, HANDOFF_ID);
  assert.equal(ownership.lifecycle.status, "EXIT");
  assert.equal(ownership.lifecycle.currentQuantity, 0);
  assert.equal(ownership.lifecycleReservesSymbol, true);
  trade = store.liveTrades.find((item) => item?.v24?.handoffId === HANDOFF_ID);
  assert.equal(trade.phase, "EXIT");
  assert.deepEqual(executionOwnedSymbolsForHandoffAdmission(store), [SYMBOL]);

  // Mirror the V2.4 board's explicit operator classification through the
  // canonical serialized writer. History is the ownership-release boundary.
  await completeExitClassification({
    storage,
    lockManager,
    handoffId: HANDOFF_ID,
  });

  store = readExecutionBoardStore({ storage });
  ownership = v24OwnershipView(store, HANDOFF_ID);
  assert.equal(ownership.lifecycle.status, "EXIT");
  assert.equal(ownership.lifecycleReservesSymbol, false);
  assert.equal(store.liveTrades.some((item) => item?.v24?.handoffId === HANDOFF_ID), false);

  const history = store.history.find((item) => item?.v24?.handoffId === HANDOFF_ID);
  assert.ok(history);
  assert.equal(history.origin, "V24_HANDOFF");
  assert.equal(history.phase, "REVIEW");
  assert.equal(history.completedAt, COMPLETED_AT);
  assert.equal(history.v24.structuralInvalidation, 224.8);
  assert.equal(history.v24.effectiveStop, 224.64);
  assert.equal(executionStop(history), 224.64);
  assert.deepEqual(executionOwnedSymbolsForHandoffAdmission(store), []);

  // Router restart after History is idempotent and recognizes completion.
  const finalCycle = await runV24ExecutionRouterCycle({
    transport: null,
    receiverId: RECEIVER_ID,
    brokerState: broker,
    storage,
    proposedBoundaries: new Map(),
    now: () => "2026-09-04T14:00:07.500Z",
    lockManager,
  });
  assert.equal(findStage(finalCycle, "TRANSPORT").status, "WAITING_FOR_PRETRADE");
  assert.equal(findStage(finalCycle, "LIFECYCLE").status, "HISTORY_COMPLETE");

  // Hard no-write evidence across every synthetic broker snapshot.
  for (const snapshot of brokerSnapshots) {
    assert.equal(snapshot.readOnly, true);
    assert.equal(snapshot.brokerWriteAuthority, false);
    assert.equal(typeof snapshot.placeOrder, "undefined");
    assert.equal(typeof snapshot.cancelOrder, "undefined");
    assert.equal(typeof snapshot.replaceOrder, "undefined");
  }

  // Network traffic is confined to the read-only handoff transport surface.
  assert.ok(requests.some((item) => item.method === "GET" && item.url.startsWith("/api/handoffs?receiverId=")));
  assert.ok(requests.some((item) => item.method === "POST" && item.url === `/api/handoffs/${HANDOFF_ID}/claim`));
  assert.ok(requests.some((item) => item.method === "POST" && item.url === `/api/handoffs/${HANDOFF_ID}/ack`));
  assert.equal(requests.some((item) => /order|cancel|replace|flatten|stop/i.test(item.url)), false);
});
