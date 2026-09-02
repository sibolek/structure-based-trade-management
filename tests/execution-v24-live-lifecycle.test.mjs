import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceV24LiveLifecycle,
  createV24LiveLifecycle,
  persistV24LiveLifecycle,
  readV24LiveLifecycle,
} from "../src/execution/execution-v24-live-lifecycle.js";

const ACCOUNT_A = "opaque-A";
const ACCOUNT_B = "opaque-B";
const START = "2026-09-02T14:00:00.000Z";
const LISTENING = "2026-09-02T14:00:01.000Z";

function installation({ selectedQuantity = 20, maxRisk = 50 } = {}) {
  return {
    status: "LISTENING",
    executionListeningAt: LISTENING,
    compatibility: {
      origin: "V24_HANDOFF",
      v24: {
        handoffId: "handoff-live-1",
        symbol: "NVDA",
        direction: "LONG",
        selectedQuantity,
        effectiveStop: 99,
        authorizedMaxDollarRisk: maxRisk,
        authorizedExecutionAccountId: ACCOUNT_A,
        executionListeningAt: LISTENING,
      },
    },
  };
}

function evt({
  sequence,
  accountId = ACCOUNT_A,
  orderId = "entry-order",
  executionKey = `exec-${sequence}`,
  executionTime = `2026-09-02T14:00:0${sequence}.000Z`,
  instruction = "BUY",
  positionEffect = "OPENING",
  quantity = 5,
  price = 100,
  stateEvent = "ENTRY",
  previousSide = "FLAT",
  previousQuantity = 0,
  nextSide = "LONG",
  nextQuantity = 5,
  averagePrice = price,
} = {}) {
  return {
    sequence,
    accountId,
    account: "••••8891",
    orderId,
    executionKey,
    symbol: "NVDA",
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

function broker(entries, {
  coverageStartedAt = START,
  currentThrough = "2026-09-02T14:00:20.000Z",
  coverageStatus = "CONTIGUOUS",
  journalStartedAt = coverageStartedAt,
} = {}) {
  return {
    status: "ARMED",
    readOnly: true,
    source: "SCHWAB",
    lastError: null,
    accounts: [{ accountId: ACCOUNT_A }, { accountId: ACCOUNT_B }],
    positions: [],
    executionCoverage: {
      schemaVersion: 1,
      status: coverageStatus,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: coverageStatus === "CONTIGUOUS" ? coverageStartedAt : null,
      baselineCompletedAt: START,
      currentThrough: coverageStatus === "CONTIGUOUS" ? currentThrough : null,
      lastGapAt: coverageStatus === "GAP" ? currentThrough : null,
      lastGapReason: coverageStatus === "GAP" ? "poll failed" : null,
    },
    executionOwnershipJournal: {
      schemaVersion: 1,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: coverageStatus === "CONTIGUOUS" ? journalStartedAt : null,
      currentThrough: coverageStatus === "CONTIGUOUS" ? currentThrough : null,
      entries: coverageStatus === "CONTIGUOUS" ? entries : [],
    },
  };
}

function firstEvent(overrides = {}) {
  return evt({ sequence: 2, executionTime: "2026-09-02T14:00:02.000Z", ...overrides });
}

function initialLifecycle(options = {}) {
  const first = firstEvent(options.first || {});
  return {
    installation: installation(options.installation),
    first,
    lifecycle: createV24LiveLifecycle({
      installation: installation(options.installation),
      matchedExecution: first,
      brokerState: broker([first]),
    }),
  };
}

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
  };
}

test("first exact-account fill freezes account, order identity, coverage interval, and durable cursor", () => {
  const { lifecycle } = initialLifecycle();
  assert.equal(lifecycle.status, "LIVE");
  assert.equal(lifecycle.executionAccountId, ACCOUNT_A);
  assert.equal(lifecycle.entryOrderId, "entry-order");
  assert.equal(lifecycle.coverageStartedAt, START);
  assert.equal(lifecycle.firstOwnedSequence, 2);
  assert.equal(lifecycle.lastProcessedSequence, 2);
  assert.equal(lifecycle.entryQuantity, 5);
  assert.equal(lifecycle.entryVwap, 100);
});

test("same broker order OPENING increase is ENTRY_FRAGMENT rather than ADD", () => {
  const { lifecycle, installation: inst, first } = initialLifecycle();
  const fragment = evt({
    sequence: 3,
    executionTime: "2026-09-02T14:00:03.000Z",
    orderId: "entry-order",
    quantity: 5,
    price: 102,
    stateEvent: "ADD",
    previousSide: "LONG",
    previousQuantity: 5,
    nextSide: "LONG",
    nextQuantity: 10,
    averagePrice: 101,
  });
  const next = advanceV24LiveLifecycle({ lifecycle, installation: inst, brokerState: broker([first, fragment]) });
  assert.equal(next.events.at(-1).type, "ENTRY_FRAGMENT");
  assert.equal(next.entryQuantity, 10);
  assert.equal(next.entryVwap, 101);
  assert.equal(next.currentQuantity, 10);
});

test("different broker order OPENING increase is a genuine ADD", () => {
  const { lifecycle, installation: inst, first } = initialLifecycle();
  const add = evt({
    sequence: 3,
    executionTime: "2026-09-02T14:00:03.000Z",
    orderId: "add-order",
    quantity: 5,
    price: 104,
    stateEvent: "ADD",
    previousSide: "LONG",
    previousQuantity: 5,
    nextSide: "LONG",
    nextQuantity: 10,
    averagePrice: 102,
  });
  const next = advanceV24LiveLifecycle({ lifecycle, installation: inst, brokerState: broker([first, add]) });
  assert.equal(next.events.at(-1).type, "ADD");
  assert.equal(next.entryQuantity, 5);
  assert.equal(next.currentQuantity, 10);
});

test("PARTIAL remains LIVE and updates exact-account quantity and exit VWAP", () => {
  const { lifecycle, installation: inst, first } = initialLifecycle();
  const partial = evt({
    sequence: 3,
    executionTime: "2026-09-02T14:00:03.000Z",
    orderId: "exit-order",
    instruction: "SELL",
    positionEffect: "CLOSING",
    quantity: 2,
    price: 105,
    stateEvent: "PARTIAL",
    previousSide: "LONG",
    previousQuantity: 5,
    nextSide: "LONG",
    nextQuantity: 3,
    averagePrice: 100,
  });
  const next = advanceV24LiveLifecycle({ lifecycle, installation: inst, brokerState: broker([first, partial]) });
  assert.equal(next.status, "LIVE");
  assert.equal(next.events.at(-1).type, "PARTIAL");
  assert.equal(next.currentQuantity, 3);
  assert.equal(next.closingQuantity, 2);
  assert.equal(next.exitVwap, 105);
});

test("FLAT transitions original V2.4 trade to EXIT", () => {
  const { lifecycle, installation: inst, first } = initialLifecycle();
  const flat = evt({
    sequence: 3,
    executionTime: "2026-09-02T14:00:03.000Z",
    orderId: "exit-order",
    instruction: "SELL",
    positionEffect: "CLOSING",
    quantity: 5,
    price: 106,
    stateEvent: "FLAT",
    previousSide: "LONG",
    previousQuantity: 5,
    nextSide: "FLAT",
    nextQuantity: 0,
    averagePrice: 0,
  });
  const next = advanceV24LiveLifecycle({ lifecycle, installation: inst, brokerState: broker([first, flat]) });
  assert.equal(next.status, "EXIT");
  assert.equal(next.terminalEvent, "FLAT");
  assert.equal(next.currentQuantity, 0);
  assert.equal(next.exitVwap, 106);
});

test("REVERSAL ends original trade without adopting opposite-side exposure", () => {
  const { lifecycle, installation: inst, first } = initialLifecycle();
  const reversal = evt({
    sequence: 3,
    executionTime: "2026-09-02T14:00:03.000Z",
    orderId: "reverse-order",
    instruction: "SELL",
    positionEffect: "CLOSING",
    quantity: 8,
    price: 98,
    stateEvent: "REVERSAL",
    previousSide: "LONG",
    previousQuantity: 5,
    nextSide: "SHORT",
    nextQuantity: -3,
    averagePrice: 98,
  });
  const next = advanceV24LiveLifecycle({ lifecycle, installation: inst, brokerState: broker([first, reversal]) });
  assert.equal(next.status, "EXIT");
  assert.equal(next.terminalEvent, "REVERSAL");
  assert.equal(next.reversalSide, "SHORT");
  assert.equal(next.reversalQuantity, 3);
});

test("wrong-account same-symbol execution after LIVE is diagnostic only", () => {
  const { lifecycle, installation: inst, first } = initialLifecycle();
  const wrong = evt({ sequence: 3, accountId: ACCOUNT_B, orderId: "other-account", executionTime: "2026-09-02T14:00:03.000Z" });
  const next = advanceV24LiveLifecycle({ lifecycle, installation: inst, brokerState: broker([first, wrong]) });
  assert.equal(next.status, "LIVE");
  assert.equal(next.currentQuantity, 5);
  assert.equal(next.diagnostics.at(-1).code, "WRONG_ACCOUNT_EXECUTION_OBSERVED");
  assert.equal(next.lastProcessedSequence, 3);
});

test("post-LIVE coverage GAP requires reconciliation and retains ownership", () => {
  const { lifecycle, installation: inst } = initialLifecycle();
  const next = advanceV24LiveLifecycle({ lifecycle, installation: inst, brokerState: broker([], { coverageStatus: "GAP", currentThrough: "2026-09-02T14:00:04.000Z" }) });
  assert.equal(next.status, "LIVE_RECONCILIATION_REQUIRED");
  assert.equal(next.reconciliationReason, "BROKER_EXECUTION_COVERAGE_GAP");
  assert.equal(next.currentQuantity, 5);
  assert.equal(next.executionAccountId, ACCOUNT_A);
});

test("recovered broker interval cannot silently resume old LIVE cursor", () => {
  const { lifecycle, installation: inst } = initialLifecycle();
  const next = advanceV24LiveLifecycle({
    lifecycle,
    installation: inst,
    brokerState: broker([], {
      coverageStartedAt: "2026-09-02T14:00:10.000Z",
      journalStartedAt: "2026-09-02T14:00:10.000Z",
      currentThrough: "2026-09-02T14:00:12.000Z",
    }),
  });
  assert.equal(next.status, "LIVE_RECONCILIATION_REQUIRED");
  assert.equal(next.reconciliationReason, "BROKER_EXECUTION_COVERAGE_GAP");
});

test("later-observed exact-account execution with retrograde authoritative time fails closed", () => {
  const { lifecycle, installation: inst, first } = initialLifecycle();
  const retrograde = evt({
    sequence: 3,
    executionTime: "2026-09-02T14:00:01.500Z",
    orderId: "add-order",
    stateEvent: "ADD",
    previousSide: "LONG",
    previousQuantity: 5,
    nextSide: "LONG",
    nextQuantity: 10,
    averagePrice: 100,
  });
  const next = advanceV24LiveLifecycle({ lifecycle, installation: inst, brokerState: broker([first, retrograde]) });
  assert.equal(next.status, "LIVE_RECONCILIATION_REQUIRED");
  assert.equal(next.reconciliationReason, "LIVE_EXECUTION_TIME_REGRESSION");
});

test("missing broker order identity after LIVE fails closed instead of using a timing heuristic", () => {
  const { lifecycle, installation: inst, first } = initialLifecycle();
  const ambiguous = evt({
    sequence: 3,
    executionTime: "2026-09-02T14:00:03.000Z",
    orderId: null,
    executionKey: null,
    stateEvent: "ADD",
    previousSide: "LONG",
    previousQuantity: 5,
    nextSide: "LONG",
    nextQuantity: 10,
    averagePrice: 100,
  });
  const next = advanceV24LiveLifecycle({ lifecycle, installation: inst, brokerState: broker([first, ambiguous]) });
  assert.equal(next.status, "LIVE_RECONCILIATION_REQUIRED");
  assert.equal(next.reconciliationReason, "V24_BROKER_ORDER_PROVENANCE_REQUIRED");
});

test("trusted reducer mismatch fails closed rather than accepting journal state labels blindly", () => {
  const { lifecycle, installation: inst, first } = initialLifecycle();
  const contradictory = evt({
    sequence: 3,
    executionTime: "2026-09-02T14:00:03.000Z",
    orderId: "exit-order",
    instruction: "SELL",
    positionEffect: "CLOSING",
    quantity: 2,
    price: 105,
    stateEvent: "FLAT",
    previousSide: "LONG",
    previousQuantity: 5,
    nextSide: "FLAT",
    nextQuantity: 0,
    averagePrice: 0,
  });
  const next = advanceV24LiveLifecycle({ lifecycle, installation: inst, brokerState: broker([first, contradictory]) });
  assert.equal(next.status, "LIVE_RECONCILIATION_REQUIRED");
  assert.equal(next.reconciliationReason, "LIVE_EXECUTION_STATE_CONFLICT");
});

test("actual exposure above selected quantity and frozen risk budget produces warnings without changing stop", () => {
  const { lifecycle, installation: inst, first } = initialLifecycle({ installation: { selectedQuantity: 5, maxRisk: 10 } });
  const add = evt({
    sequence: 3,
    executionTime: "2026-09-02T14:00:03.000Z",
    orderId: "add-order",
    quantity: 5,
    price: 103,
    stateEvent: "ADD",
    previousSide: "LONG",
    previousQuantity: 5,
    nextSide: "LONG",
    nextQuantity: 10,
    averagePrice: 101.5,
  });
  const next = advanceV24LiveLifecycle({ lifecycle, installation: inst, brokerState: broker([first, add]) });
  assert.ok(next.warnings.includes("AUTHORIZED_QUANTITY_EXCEEDED"));
  assert.ok(next.warnings.includes("ACTUAL_STOP_RISK_EXCEEDS_AUTHORIZED_BUDGET"));
  assert.equal(inst.compatibility.v24.effectiveStop, 99);
});

test("durable lifecycle cursor survives reload and prevents duplicate event processing", () => {
  const { lifecycle, installation: inst, first } = initialLifecycle();
  const fragment = evt({
    sequence: 3,
    executionTime: "2026-09-02T14:00:03.000Z",
    orderId: "entry-order",
    quantity: 5,
    price: 102,
    stateEvent: "ADD",
    previousSide: "LONG",
    previousQuantity: 5,
    nextSide: "LONG",
    nextQuantity: 10,
    averagePrice: 101,
  });
  const advanced = advanceV24LiveLifecycle({ lifecycle, installation: inst, brokerState: broker([first, fragment]) });
  const storage = memoryStorage();
  persistV24LiveLifecycle({ storage, lifecycle: advanced });
  const loaded = readV24LiveLifecycle({ storage, handoffId: advanced.handoffId });
  const replay = advanceV24LiveLifecycle({ lifecycle: loaded, installation: inst, brokerState: broker([first, fragment]) });
  assert.equal(replay.lastProcessedSequence, 3);
  assert.equal(replay.events.length, 2);
  assert.equal(replay.entryQuantity, 10);
});

test("unrelated executions may advance durable journal cursor without mutating owned trade", () => {
  const { lifecycle, installation: inst, first } = initialLifecycle();
  const unrelated = { ...evt({ sequence: 3, executionTime: "2026-09-02T14:00:03.000Z" }), symbol: "AMD", orderId: "amd-order", executionKey: "amd-exec" };
  const next = advanceV24LiveLifecycle({ lifecycle, installation: inst, brokerState: broker([first, unrelated]) });
  assert.equal(next.lastProcessedSequence, 3);
  assert.equal(next.currentQuantity, 5);
  assert.equal(next.events.length, 1);
});
