import test from "node:test";
import assert from "node:assert/strict";

import {
  EXECUTION_BOARD_STORE_WRITER_LOCK_NAME,
  readExecutionBoardStore,
} from "../src/execution/execution-board-store-repository.js";
import {
  executionOwnedSymbolsForHandoffAdmission,
  isV24InstallationReservationActive,
  isV24LifecycleReservationActive,
} from "../src/execution/execution-v24-active-ownership.js";
import {
  promoteV24FirstFillAtomically,
  runV24ExecutionRouterCycle,
} from "../src/execution/execution-v24-runtime-router.js";

const ACCOUNT = "opaque-account-A";
const START = "2026-09-02T20:00:00.000Z";
const LISTENING = "2026-09-02T20:00:01.000Z";

function writerLockManager() {
  const calls = [];
  return {
    calls,
    async request(name, options, callback) {
      calls.push({ name, options: structuredClone(options) });
      return callback({ name, mode: options?.mode });
    },
  };
}

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    removeItem: () => { value = null; },
  };
}

function installation(handoffId = "handoff-router-1") {
  return {
    schemaVersion: 1,
    status: "LISTENING",
    handoffId,
    receiverId: "receiver-A",
    symbol: "NVDA",
    preparedAt: START,
    executionListeningAt: LISTENING,
    compatibility: {
      origin: "V24_HANDOFF",
      v24: {
        handoffId,
        sourceId: "sod:test",
        candidateId: "candidate-1",
        contractVersion: 1,
        candidateContentHash: "hash-1",
        symbol: "NVDA",
        direction: "LONG",
        setup: "H2",
        timeframe: "2m",
        thesis: "test thesis",
        trigger: { type: "STOP_TRIGGER", price: 100 },
        targets: [102],
        managementPlan: "hold structure",
        structuralInvalidation: 98.5,
        effectiveStop: 99,
        currentExpectedEntry: 100,
        selectedQuantity: 20,
        authorizedMaxDollarRisk: 50,
        authorizedExecutionAccountId: ACCOUNT,
        dssEvaluationId: "dss-1",
        riskEvaluationId: "risk-1",
        authorizedAt: START,
        handoffCreatedAt: START,
        executionBoardReceiverId: "receiver-A",
        executionListeningAt: LISTENING,
      },
    },
  };
}

function firstFill() {
  return {
    sequence: 1,
    accountId: ACCOUNT,
    account: "••••8891",
    orderId: "entry-order",
    executionKey: "exec-1",
    symbol: "NVDA",
    instruction: "BUY",
    positionEffect: "OPENING",
    quantity: 5,
    price: 100,
    executionTime: "2026-09-02T20:00:02.000Z",
    detectedAt: "2026-09-02T20:00:02.200Z",
    stateEvent: "ENTRY",
    previousSide: "FLAT",
    previousQuantity: 0,
    nextSide: "LONG",
    nextQuantity: 5,
    averagePrice: 100,
  };
}

function broker(entries = [firstFill()]) {
  const through = "2026-09-02T20:00:10.000Z";
  return {
    status: "ARMED",
    readOnly: true,
    source: "SCHWAB",
    lastError: null,
    accounts: [{ accountId: ACCOUNT, account: "••••8891" }],
    positions: [],
    executionCoverage: {
      schemaVersion: 1,
      status: "CONTIGUOUS",
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: START,
      baselineCompletedAt: START,
      currentThrough: through,
      lastGapAt: null,
      lastGapReason: null,
    },
    executionOwnershipJournal: {
      schemaVersion: 1,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: START,
      currentThrough: through,
      entries,
    },
  };
}

function baseStore(overrides = {}) {
  return {
    storeSchemaVersion: 1,
    storeRevision: 1,
    draft: null,
    candidates: [],
    liveTrades: [],
    history: [],
    view: "TRADE",
    notice: "",
    v24Installations: [],
    v24Retirements: [],
    v24Lifecycles: [],
    ...overrides,
  };
}

test("PREPARED/LISTENING installation reserves only before a lifecycle exists", () => {
  const inst = installation();
  const prefill = baseStore({ v24Installations: [inst] });
  assert.equal(isV24InstallationReservationActive(prefill, inst), true);
  assert.deepEqual(executionOwnedSymbolsForHandoffAdmission(prefill), ["NVDA"]);

  const lifecycle = { handoffId: inst.handoffId, symbol: "NVDA", status: "LIVE" };
  const live = baseStore({ v24Installations: [inst], v24Lifecycles: [lifecycle] });
  assert.equal(isV24InstallationReservationActive(live, inst), false);
  assert.equal(isV24LifecycleReservationActive(live, lifecycle), true);
  assert.deepEqual(executionOwnedSymbolsForHandoffAdmission(live), ["NVDA"]);
});

test("EXIT lifecycle remains owned until V2.4 History exists", () => {
  const inst = installation();
  const lifecycle = { handoffId: inst.handoffId, symbol: "NVDA", status: "EXIT" };
  const awaiting = baseStore({ v24Installations: [inst], v24Lifecycles: [lifecycle] });
  assert.equal(isV24LifecycleReservationActive(awaiting, lifecycle), true);
  assert.deepEqual(executionOwnedSymbolsForHandoffAdmission(awaiting), ["NVDA"]);

  const completed = baseStore({
    v24Installations: [inst],
    v24Lifecycles: [lifecycle],
    history: [{ origin: "V24_HANDOFF", v24: { handoffId: inst.handoffId }, originalPlan: { symbol: "NVDA" } }],
  });
  assert.equal(isV24LifecycleReservationActive(completed, lifecycle), false);
  assert.deepEqual(executionOwnedSymbolsForHandoffAdmission(completed), []);
});

test("atomic first-fill promotion creates lifecycle and visible V24 LIVE trade in one serialized revision", async () => {
  const inst = installation();
  const storage = memoryStorage(JSON.stringify(baseStore({ v24Installations: [inst] })));
  const fill = firstFill();
  const lockManager = writerLockManager();
  const result = await promoteV24FirstFillAtomically({
    storage,
    handoffId: inst.handoffId,
    matchedExecution: fill,
    brokerState: broker([fill]),
    lockManager,
  });
  assert.equal(result.status, "PROMOTED_LIVE");
  assert.equal(result.lifecycle.status, "LIVE");
  assert.equal(result.trade.origin, "V24_HANDOFF");
  assert.equal(result.trade.phase, "LIVE");
  assert.equal(result.trade.broker.accountId, ACCOUNT);
  assert.equal(result.trade.broker.lifecycleStatus, "LIVE");
  assert.deepEqual(lockManager.calls, [{
    name: EXECUTION_BOARD_STORE_WRITER_LOCK_NAME,
    options: { mode: "exclusive" },
  }]);

  const durable = readExecutionBoardStore({ storage });
  assert.equal(durable.storeRevision, 2);
  assert.equal(durable.v24Installations.length, 1);
  assert.equal(durable.v24Installations[0].status, "LISTENING");
  assert.equal(durable.v24Lifecycles.length, 1);
  assert.equal(durable.liveTrades.filter((item) => item.origin === "V24_HANDOFF").length, 1);
  assert.equal(isV24InstallationReservationActive(durable, durable.v24Installations[0]), false);
});

test("identical first-fill promotion retry is idempotent", async () => {
  const inst = installation();
  const storage = memoryStorage(JSON.stringify(baseStore({ v24Installations: [inst] })));
  const fill = firstFill();
  const lockManager = writerLockManager();
  await promoteV24FirstFillAtomically({
    storage,
    handoffId: inst.handoffId,
    matchedExecution: fill,
    brokerState: broker([fill]),
    lockManager,
  });
  const before = readExecutionBoardStore({ storage }).storeRevision;
  const retry = await promoteV24FirstFillAtomically({
    storage,
    handoffId: inst.handoffId,
    matchedExecution: fill,
    brokerState: broker([fill]),
    lockManager,
  });
  assert.equal(retry.status, "ALREADY_PROMOTED");
  assert.equal(readExecutionBoardStore({ storage }).storeRevision, before);
});

test("router holds one proposed Decision-17 boundary across broker-proof cycles", async () => {
  const proposals = [];
  const proposedBoundaries = new Map();
  const envelope = { handoff: { handoffId: "h-proposal" }, delivery: { status: "CLAIMED" } };
  const transport = { discover: async () => [envelope] };
  const empty = baseStore();
  const dependencies = {
    readStore: () => empty,
    advanceActivation: async ({ proposedExecutionListeningAt }) => {
      proposals.push(proposedExecutionListeningAt);
      return {
        status: "WAITING_FOR_BROKER_PROOF",
        proposedExecutionListeningAt: proposedExecutionListeningAt || "2026-09-02T20:00:05.000Z",
      };
    },
  };

  await runV24ExecutionRouterCycle({ transport, receiverId: "receiver-A", brokerState: {}, proposedBoundaries, dependencies });
  await runV24ExecutionRouterCycle({ transport, receiverId: "receiver-A", brokerState: {}, proposedBoundaries, dependencies });
  assert.deepEqual(proposals, [null, "2026-09-02T20:00:05.000Z"]);
  assert.equal(proposedBoundaries.get("h-proposal"), "2026-09-02T20:00:05.000Z");
});

test("router processes discovered activation envelopes serially in server order", async () => {
  const order = [];
  const transport = {
    discover: async () => [
      { handoff: { handoffId: "h1" }, delivery: { status: "CLAIMED" } },
      { handoff: { handoffId: "h2" }, delivery: { status: "CLAIMED" } },
      { handoff: { handoffId: "h3" }, delivery: { status: "CLAIMED" } },
    ],
  };
  await runV24ExecutionRouterCycle({
    transport,
    receiverId: "receiver-A",
    brokerState: {},
    dependencies: {
      readStore: () => baseStore(),
      advanceActivation: async ({ envelope }) => {
        order.push(envelope.handoff.handoffId);
        return { status: "DELIVERED" };
      },
    },
  });
  assert.deepEqual(order, ["h1", "h2", "h3"]);
});

test("delivered LISTENING installation is processed locally even when discovery is empty", async () => {
  const inst = installation("h-local");
  const transport = { discover: async () => [] };
  let matched = 0;
  const result = await runV24ExecutionRouterCycle({
    transport,
    receiverId: "receiver-A",
    brokerState: {},
    dependencies: {
      readStore: () => baseStore({ v24Installations: [inst] }),
      evaluateInitialFill: () => { matched += 1; return { status: "WAITING", reason: null }; },
    },
  });
  assert.equal(matched, 1);
  assert.ok(result.results.some((item) => item.stage === "FIRST_FILL" && item.handoffId === "h-local" && item.status === "WAITING"));
});

test("retirement resolution has priority over ordinary first-fill matching", async () => {
  const inst = installation("h-retire");
  let current = baseStore({
    v24Installations: [inst],
    v24Retirements: [{ handoffId: "h-retire", status: "REQUESTED" }],
  });
  let matcherCalls = 0;
  const result = await runV24ExecutionRouterCycle({
    transport: { discover: async () => [] },
    receiverId: "receiver-A",
    brokerState: {},
    dependencies: {
      readStore: () => current,
      resolveRetirement: () => {
        current = baseStore({
          v24Installations: [inst],
          v24Retirements: [{ handoffId: "h-retire", status: "RETIRED" }],
        });
        return { handoffId: "h-retire", status: "RETIRED" };
      },
      evaluateInitialFill: () => { matcherCalls += 1; return { status: "MATCHED", matchedExecution: firstFill() }; },
    },
  });
  assert.equal(matcherCalls, 0);
  assert.ok(result.results.some((item) => item.stage === "RETIREMENT" && item.status === "RETIRED"));
});

test("LIVE lifecycle advancement runs independently of transport discovery", async () => {
  const lifecycle = { handoffId: "h-live", symbol: "NVDA", status: "LIVE" };
  let calls = 0;
  const result = await runV24ExecutionRouterCycle({
    transport: { discover: async () => [] },
    receiverId: "receiver-A",
    brokerState: {},
    dependencies: {
      readStore: () => baseStore({ v24Lifecycles: [lifecycle] }),
      advanceLifecycle: ({ handoffId }) => { calls += 1; return { status: "UNCHANGED", handoffId }; },
    },
  });
  assert.equal(calls, 1);
  assert.ok(result.results.some((item) => item.stage === "LIFECYCLE" && item.handoffId === "h-live"));
});


test("durable ownership continues when pretrade transport is unavailable", async () => {
  const inst = installation("h-no-pretrade");
  let matched = 0;

  const result = await runV24ExecutionRouterCycle({
    transport: null,
    receiverId: "receiver-A",
    brokerState: {},
    dependencies: {
      readStore: () => baseStore({ v24Installations: [inst] }),
      evaluateInitialFill: () => {
        matched += 1;
        return { status: "WAITING", reason: null };
      },
    },
  });

  assert.equal(matched, 1);
  assert.ok(result.results.some(
    (item) => item.stage === "TRANSPORT" && item.status === "WAITING_FOR_PRETRADE"
  ));
  assert.ok(result.results.some(
    (item) => item.stage === "FIRST_FILL"
      && item.handoffId === "h-no-pretrade"
      && item.status === "WAITING"
  ));
});

test("pretrade discovery failure does not block durable ownership processing", async () => {
  const inst = installation("h-pretrade-error");
  let matched = 0;

  const result = await runV24ExecutionRouterCycle({
    transport: {
      discover: async () => {
        const error = new Error("pretrade unavailable");
        error.code = "PRETRADE_DISCOVERY_FAILED";
        throw error;
      },
    },
    receiverId: "receiver-A",
    brokerState: {},
    dependencies: {
      readStore: () => baseStore({ v24Installations: [inst] }),
      evaluateInitialFill: () => {
        matched += 1;
        return { status: "WAITING", reason: null };
      },
    },
  });

  assert.equal(matched, 1);
  assert.ok(result.results.some(
    (item) => item.stage === "TRANSPORT"
      && item.status === "ERROR"
      && item.reason === "PRETRADE_DISCOVERY_FAILED"
  ));
  assert.ok(result.results.some(
    (item) => item.stage === "FIRST_FILL"
      && item.handoffId === "h-pretrade-error"
      && item.status === "WAITING"
  ));
});
