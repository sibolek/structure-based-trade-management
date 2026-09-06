import test from "node:test";
import assert from "node:assert/strict";

import { createV24ManagedLiveLifecycle } from "../src/execution/execution-v24-managed-lifecycle.js";

function installation() {
  return {
    handoffId: "legacy-handoff",
    status: "LISTENING",
    symbol: "NVDA",
    compatibility: {
      origin: "V24_HANDOFF",
      v24: {
        handoffId: "legacy-handoff",
        symbol: "NVDA",
        direction: "LONG",
        selectedQuantity: 20,
        effectiveStop: 224.64,
        structuralInvalidation: 224.8,
        currentExpectedEntry: 225.6,
        authorizedMaxDollarRisk: 70,
        authorizedExecutionAccountId: "acct-A",
        managementPlan: "Manage against structure.",
        targets: [226.5],
        executionListeningAt: "2026-09-04T14:00:03.000Z",
        instrumentEconomics: null,
      },
    },
  };
}

function firstFill() {
  return {
    sequence: 1,
    executionKey: "legacy-exec-1",
    orderId: "legacy-order-1",
    accountId: "acct-A",
    symbol: "NVDA",
    instruction: "BUY",
    positionEffect: "OPENING",
    quantity: 5,
    price: 225.6,
    executionTime: "2026-09-04T14:00:04.000Z",
    detectedAt: "2026-09-04T14:00:04.200Z",
    stateEvent: "ENTRY",
    previousSide: "FLAT",
    previousQuantity: 0,
    nextSide: "LONG",
    nextQuantity: 5,
    averagePrice: 225.6,
  };
}

function brokerState(event) {
  return {
    status: "ARMED",
    readOnly: true,
    source: "SCHWAB",
    lastError: null,
    executionCoverage: {
      status: "CONTIGUOUS",
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: "2026-09-04T13:59:59.000Z",
      currentThrough: "2026-09-04T14:00:04.500Z",
    },
    executionOwnershipJournal: {
      schemaVersion: 1,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: "2026-09-04T13:59:59.000Z",
      currentThrough: "2026-09-04T14:00:04.500Z",
      entries: [event],
    },
  };
}

test("legacy V2.4 handoff without Phase4 instrument metadata still establishes managed LIVE using explicit compatibility economics", () => {
  const event = firstFill();
  const lifecycle = createV24ManagedLiveLifecycle({
    installation: installation(),
    matchedExecution: event,
    brokerState: brokerState(event),
  });

  assert.equal(lifecycle.status, "LIVE");
  assert.equal(lifecycle.currentQuantity, 5);
  assert.equal(lifecycle.management.managementContract.mode, "LEGACY_COMPATIBILITY");
  assert.equal(lifecycle.management.managementContract.source, "LEGACY_COMPATIBILITY");
  assert.equal(lifecycle.management.instrumentEconomics.assetType, "EQUITY");
  assert.equal(lifecycle.management.instrumentEconomics.pricePointValue, 1);
  assert.equal(lifecycle.management.instrumentEconomics.source, "LEGACY_COMPATIBILITY");
  assert.ok(Math.abs(lifecycle.management.risk.openStopRisk - 4.8) < 1e-9);
});
