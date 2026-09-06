import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  findV24RetiredAuthorizationExceptions,
  readV24RetiredAuthorizationExceptions,
  reconcileV24RetiredAuthorizationExceptionSerialized,
  recordV24RetiredAuthorizationExceptionsSerialized,
} from "../src/execution/execution-v24-retired-authorization-exceptions.js";
import { runV24ManagedExecutionRouterCycle } from "../src/execution/execution-v24-managed-runtime-router.js";

function installation({ handoffId = "expired-handoff", listeningAt = "2026-09-06T14:00:00.000Z" } = {}) {
  return {
    handoffId,
    status: "LISTENING",
    symbol: "NVDA",
    compatibility: {
      origin: "V24_HANDOFF",
      v24: {
        handoffId,
        symbol: "NVDA",
        direction: "LONG",
        authorizedExecutionAccountId: "acct-A",
        executionListeningAt: listeningAt,
      },
    },
  };
}

function retirement() {
  return {
    handoffId: "expired-handoff",
    status: "RETIRED",
    reason: "ENTRY_AUTHORIZATION_EXPIRED",
    cutoffAt: "2026-09-06T14:10:00.000Z",
  };
}

function execution({
  sequence = 1,
  executionTime = "2026-09-06T14:10:01.000Z",
  executionKey = `exec-${sequence}`,
} = {}) {
  return {
    sequence,
    executionKey,
    orderId: "order-late",
    accountId: "acct-A",
    symbol: "NVDA",
    instruction: "BUY",
    positionEffect: "OPENING",
    quantity: 5,
    price: 100,
    executionTime,
    detectedAt: executionTime,
    stateEvent: "ENTRY",
    previousSide: "FLAT",
    previousQuantity: 0,
    nextSide: "LONG",
    nextQuantity: 5,
    averagePrice: 100,
  };
}

function broker(entries, { status = "CONTIGUOUS", currentThrough = "2026-09-06T14:11:00.000Z" } = {}) {
  return {
    status: "ARMED",
    readOnly: true,
    source: "SCHWAB",
    lastError: null,
    accounts: [{ accountId: "acct-A" }],
    executionCoverage: {
      status,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: status === "CONTIGUOUS" ? "2026-09-06T13:59:00.000Z" : null,
      currentThrough: status === "CONTIGUOUS" ? currentThrough : null,
    },
    executionOwnershipJournal: {
      schemaVersion: 1,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: status === "CONTIGUOUS" ? "2026-09-06T13:59:00.000Z" : null,
      currentThrough: status === "CONTIGUOUS" ? currentThrough : null,
      entries: status === "CONTIGUOUS" ? entries : [],
    },
  };
}

function baseStore(overrides = {}) {
  return {
    storeRevision: 5,
    v24Installations: [installation()],
    v24Retirements: [retirement()],
    v24Lifecycles: [],
    liveTrades: [],
    history: [],
    v24AuthorizationExceptions: [],
    ...overrides,
  };
}

function memoryStorage(initialStore = {}) {
  let value = JSON.stringify(initialStore);
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = String(next); },
    removeItem: () => { value = null; },
  };
}

function lockManager() {
  return { request: async (_name, _options, callback) => callback({ mode: "exclusive" }) };
}

test("post-cutoff opening fill becomes CRITICAL LATE_OPENING_FILL without reviving expired authorization", () => {
  const store = baseStore();
  const exceptions = findV24RetiredAuthorizationExceptions({
    store,
    installation: store.v24Installations[0],
    retirement: store.v24Retirements[0],
    brokerState: broker([execution()]),
  });
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].code, "LATE_OPENING_FILL");
  assert.equal(exceptions[0].severity, "CRITICAL");
  assert.equal(exceptions[0].status, "OPEN");
  assert.equal(exceptions[0].handoffId, "expired-handoff");
});

test("fill exactly at immutable cutoff is late because qualifying first fill must precede the boundary", () => {
  const store = baseStore();
  const exceptions = findV24RetiredAuthorizationExceptions({
    store,
    installation: store.v24Installations[0],
    retirement: store.v24Retirements[0],
    brokerState: broker([execution({ executionTime: "2026-09-06T14:10:00.000Z" })]),
  });
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].code, "LATE_OPENING_FILL");
});

test("timely pre-cutoff fill is not reclassified as retired authorization exception", () => {
  const store = baseStore();
  const exceptions = findV24RetiredAuthorizationExceptions({
    store,
    installation: store.v24Installations[0],
    retirement: store.v24Retirements[0],
    brokerState: broker([execution({ executionTime: "2026-09-06T14:09:59.999Z" })]),
  });
  assert.deepEqual(exceptions, []);
});

test("plausible later same-account authorization makes post-cutoff attribution fail closed", () => {
  const later = installation({ handoffId: "later-handoff", listeningAt: "2026-09-06T14:10:00.500Z" });
  const store = baseStore({ v24Installations: [installation(), later] });
  const exceptions = findV24RetiredAuthorizationExceptions({
    store,
    installation: store.v24Installations[0],
    retirement: store.v24Retirements[0],
    brokerState: broker([execution({ executionTime: "2026-09-06T14:10:01.000Z" })]),
  });
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].code, "FILL_ATTRIBUTION_UNRESOLVED");
  assert.deepEqual(exceptions[0].plausibleLaterHandoffIds, ["later-handoff"]);
});

test("coverage gap cannot manufacture a late-fill authorization exception", () => {
  const store = baseStore();
  const exceptions = findV24RetiredAuthorizationExceptions({
    store,
    installation: store.v24Installations[0],
    retirement: store.v24Retirements[0],
    brokerState: broker([execution()], { status: "GAP" }),
  });
  assert.deepEqual(exceptions, []);
});

test("retired authorization exception journal deduplicates exact broker truth and reconciles explicitly", async () => {
  const store = baseStore({ storeSchemaVersion: 1 });
  const candidate = findV24RetiredAuthorizationExceptions({
    store,
    installation: store.v24Installations[0],
    retirement: store.v24Retirements[0],
    brokerState: broker([execution()]),
  });
  const storage = memoryStorage(store);
  const locks = lockManager();

  const first = await recordV24RetiredAuthorizationExceptionsSerialized({ storage, handoffId: "expired-handoff", exceptions: candidate, lockManager: locks });
  const second = await recordV24RetiredAuthorizationExceptionsSerialized({ storage, handoffId: "expired-handoff", exceptions: candidate, lockManager: locks });
  assert.equal(first.recorded.length, 1);
  assert.equal(second.recorded.length, 0);
  assert.equal(readV24RetiredAuthorizationExceptions({ storage }).length, 1);

  const reconciled = await reconcileV24RetiredAuthorizationExceptionSerialized({
    storage,
    exceptionId: candidate[0].exceptionId,
    outcome: "BROKER_TRUTH_REVIEWED",
    note: "Reviewed outside expired authorization.",
    at: "2026-09-06T14:12:00.000Z",
    lockManager: locks,
  });
  assert.equal(reconciled.exception.status, "RECONCILED");
  assert.equal(reconciled.exception.reconciliationOutcome, "BROKER_TRUTH_REVIEWED");
  assert.equal(reconciled.brokerWriteAuthority, false);
});

test("managed production router records late-fill exception but never calls first-fill matcher or promotion", async () => {
  let store = baseStore();
  let firstFillCalls = 0;
  let promotionCalls = 0;
  let recorded = [];

  const result = await runV24ManagedExecutionRouterCycle({
    transport: null,
    receiverId: "receiver-A",
    brokerState: broker([execution()]),
    now: () => "2026-09-06T14:11:00.000Z",
    dependencies: {
      readStore: () => structuredClone(store),
      evaluateInitialFill: () => { firstFillCalls += 1; return { status: "MATCHED" }; },
      promoteFirstFill: async () => { promotionCalls += 1; return { status: "PROMOTED_LIVE" }; },
      advanceLifecycle: async () => ({ status: "NO_LIFECYCLE" }),
    },
    retiredExceptionDependencies: {
      readStore: () => structuredClone(store),
      recordExceptions: async ({ exceptions }) => {
        recorded = exceptions.map((item) => structuredClone(item));
        store = { ...store, storeRevision: store.storeRevision + 1, v24AuthorizationExceptions: recorded };
        return { recorded, storeRevision: store.storeRevision };
      },
    },
  });

  assert.equal(firstFillCalls, 0);
  assert.equal(promotionCalls, 0);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].code, "LATE_OPENING_FILL");
  assert.ok(result.results.some((item) => item.stage === "FIRST_FILL" && item.status === "RETIRED"));
  assert.ok(result.results.some((item) => item.stage === "AUTHORIZATION_EXCEPTION" && item.status === "RECORDED"));
});

test("Slice 7 UI emits only explicit canonical management intents and exposes exception recovery", () => {
  const board = fs.readFileSync(new URL("../src/components/V24LiveExecutionBoard.jsx", import.meta.url), "utf8");
  const panel = fs.readFileSync(new URL("../src/components/V24LiveManagementPanel.jsx", import.meta.url), "utf8");
  const card = fs.readFileSync(new URL("../src/components/V24LiveTradeCard.jsx", import.meta.url), "utf8");
  const hook = fs.readFileSync(new URL("../src/hooks/useV24ExecutionRouter.js", import.meta.url), "utf8");

  assert.match(board, /applyV24LiveManagementCommandSerialized/);
  assert.match(board, /reconcileV24RetiredAuthorizationExceptionSerialized/);
  assert.match(board, /v24AuthorizationExceptions/);
  assert.match(card, /liveManagement/);
  assert.match(card, /V24LiveManagementPanel/);
  for (const action of [
    "COMPLETE_POSITION_BUILD",
    "CLOSE_FURTHER_EXPOSURE",
    "SET_EFFECTIVE_STOP",
    "CHECK_EXPOSURE_INCREASE",
    "RECORD_TARGET_OBSERVATION",
    "RECORD_DISCRETIONARY_NOTE",
    "RECONCILE_EXCEPTION",
  ]) assert.match(panel, new RegExp(action));
  assert.match(hook, /runV24ManagedExecutionRouterCycle/);
  assert.doesNotMatch(panel, /placeOrder|cancelOrder|replaceOrder|flattenPosition/);
  assert.doesNotMatch(board, /brokerWriteAuthority\s*:\s*true/);
});
