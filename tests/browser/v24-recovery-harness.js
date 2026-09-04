import {
  readExecutionBoardStore,
} from "../../src/execution/execution-board-store-repository.js";
import {
  executionOwnedSymbolsForHandoffAdmission,
  v24OwnershipView,
} from "../../src/execution/execution-v24-active-ownership.js";
import {
  runV24ExecutionRouterCycle,
} from "../../src/execution/execution-v24-runtime-router.js";
import {
  requestV24RetirementSerialized,
  resolveV24RetirementSerialized,
} from "../../src/execution/execution-v24-retirement.js";

const ROUTER_LOCK_NAME = "executionos-v24-runtime-router";
const RECEIVER_ID = "receiver-A";
const HANDOFF_ID = "handoff-browser-recovery";
const ACCOUNT_ID = "opaque-account-A";

let proposedBoundaries = new Map();

function handoff() {
  return {
    schemaVersion: 1,
    handoffId: HANDOFF_ID,
    createdAt: "2026-09-02T18:00:01.000Z",
    authorizedAt: "2026-09-02T18:00:00.000Z",
    sourceId: "SOD_A_PLUS",
    candidateId: "candidate-browser-recovery",
    contractVersion: 3,
    candidateContentHash: "hash-browser-recovery",
    symbol: "NVDA",
    direction: "LONG",
    setup: "H2 continuation",
    timeframe: "2m",
    thesis: "Synthetic read-only browser recovery test",
    trigger: { type: "BREAKOUT", level: 100 },
    targets: [102, 104],
    managementPlan: "Manage against structure",
    structuralInvalidation: 98.5,
    effectiveStop: 99,
    currentExpectedEntry: 100,
    selectedQuantity: 5,
    authorizedMaxDollarRisk: 5,
    authorizedExecutionAccountId: ACCOUNT_ID,
    dssEvaluationId: "dss-browser-recovery",
    riskEvaluationId: "risk-browser-recovery",
  };
}

function delivery(status = "CLAIMED", overrides = {}) {
  return {
    schemaVersion: 1,
    handoffId: HANDOFF_ID,
    status,
    createdAt: "2026-09-02T18:00:01.100Z",
    claimedBy: status === "PENDING" ? null : RECEIVER_ID,
    claimedAt: status === "PENDING" ? null : "2026-09-02T18:00:02.000Z",
    deliveredAt: status === "DELIVERED"
      ? "2026-09-02T18:00:05.000Z"
      : null,
    executionListeningAt: status === "DELIVERED"
      ? "2026-09-02T18:00:03.000Z"
      : null,
    blockedAt: null,
    blockReason: null,
    ...overrides,
  };
}

function entryEvent() {
  return {
    sequence: 1,
    accountId: ACCOUNT_ID,
    account: "••••8891",
    orderId: "entry-order",
    executionKey: "exec-entry",
    symbol: "NVDA",
    instruction: "BUY",
    positionEffect: "OPENING",
    quantity: 5,
    price: 100,
    executionTime: "2026-09-02T18:00:03.500Z",
    detectedAt: "2026-09-02T18:00:03.700Z",
    stateEvent: "ENTRY",
    previousSide: "FLAT",
    previousQuantity: 0,
    nextSide: "LONG",
    nextQuantity: 5,
    averagePrice: 100,
  };
}

function partialEvent() {
  return {
    sequence: 2,
    accountId: ACCOUNT_ID,
    account: "••••8891",
    orderId: "exit-partial",
    executionKey: "exec-partial",
    symbol: "NVDA",
    instruction: "SELL",
    positionEffect: "CLOSING",
    quantity: 2,
    price: 103,
    executionTime: "2026-09-02T18:00:05.500Z",
    detectedAt: "2026-09-02T18:00:05.700Z",
    stateEvent: "PARTIAL",
    previousSide: "LONG",
    previousQuantity: 5,
    nextSide: "LONG",
    nextQuantity: 3,
    averagePrice: 100,
  };
}

function flatEvent() {
  return {
    sequence: 2,
    accountId: ACCOUNT_ID,
    account: "••••8891",
    orderId: "exit-flat",
    executionKey: "exec-flat",
    symbol: "NVDA",
    instruction: "SELL",
    positionEffect: "CLOSING",
    quantity: 5,
    price: 104,
    executionTime: "2026-09-02T18:00:05.500Z",
    detectedAt: "2026-09-02T18:00:05.700Z",
    stateEvent: "FLAT",
    previousSide: "LONG",
    previousQuantity: 5,
    nextSide: "FLAT",
    nextQuantity: 0,
    averagePrice: 0,
  };
}

function eventsFromNames(names = []) {
  return names.map((name) => {
    switch (String(name).toUpperCase()) {
      case "ENTRY":
        return entryEvent();
      case "PARTIAL":
        return partialEvent();
      case "FLAT":
        return flatEvent();
      default:
        throw new Error(`unknown synthetic recovery event: ${name}`);
    }
  });
}

function brokerState({
  currentThrough = "2026-09-02T18:00:10.000Z",
  events = [],
} = {}) {
  const entries = eventsFromNames(events);

  const activityEntries = entries.length
    ? [{
        accountId: ACCOUNT_ID,
        symbol: "NVDA",
        latestExecutionTime: entries.at(-1).executionTime,
        latestDetectedAt: entries.at(-1).detectedAt,
      }]
    : [];

  return {
    version: 2,
    status: "ARMED",
    readOnly: true,
    brokerWriteAuthority: false,
    source: "SCHWAB",
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
      entries: activityEntries,
    },
    executionOwnershipJournal: {
      schemaVersion: 1,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: "2026-09-02T17:59:59.000Z",
      currentThrough,
      entries,
    },
  };
}

function transport({
  emptyDiscovery = false,
  deliveryStatus = "CLAIMED",
  ackFails = false,
} = {}) {
  const calls = [];

  return {
    calls,

    async discover(receiverId) {
      calls.push(["discover", receiverId]);
      if (emptyDiscovery) return [];
      return [{
        handoff: handoff(),
        delivery: delivery(deliveryStatus),
      }];
    },

    async claim(handoffId, receiverId) {
      calls.push(["claim", handoffId, receiverId]);
      return {
        handoff: handoff(),
        delivery: delivery("CLAIMED"),
      };
    },

    async acknowledge(handoffId, receiverId, executionListeningAt) {
      calls.push(["ack", handoffId, receiverId, executionListeningAt]);

      if (ackFails) {
        const error = new Error("synthetic pretrade ACK outage");
        error.code = "V24_HANDOFF_TRANSPORT_UNAVAILABLE";
        throw error;
      }

      return {
        handoff: handoff(),
        delivery: delivery("DELIVERED", {
          executionListeningAt,
          deliveredAt: "2026-09-02T18:00:05.000Z",
        }),
      };
    },

    async block(handoffId, receiverId, reason) {
      calls.push(["block", handoffId, receiverId, reason]);
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

function snapshot() {
  const store = readExecutionBoardStore();
  return {
    store,
    ownership: v24OwnershipView(store, HANDOFF_ID),
    ownedSymbols: executionOwnedSymbolsForHandoffAdmission(store),
  };
}

async function withRouterLock(operation) {
  return navigator.locks.request(
    ROUTER_LOCK_NAME,
    { mode: "exclusive" },
    operation,
  );
}

async function runCycle({
  currentThrough,
  events = [],
  now = "2026-09-02T18:00:10.000Z",
  emptyDiscovery = false,
  deliveryStatus = "CLAIMED",
  ackFails = false,
} = {}) {
  const syntheticTransport = transport({
    emptyDiscovery,
    deliveryStatus,
    ackFails,
  });

  const result = await withRouterLock(() => runV24ExecutionRouterCycle({
    transport: syntheticTransport,
    receiverId: RECEIVER_ID,
    brokerState: brokerState({ currentThrough, events }),
    proposedBoundaries,
    now: () => now,
    lockManager: navigator.locks,
  }));

  return {
    result,
    transportCalls: syntheticTransport.calls,
    ...snapshot(),
  };
}

async function requestRetirement(requestedAt) {
  const retirement = await requestV24RetirementSerialized({
    handoffId: HANDOFF_ID,
    receiverId: RECEIVER_ID,
    requestedAt,
    lockManager: navigator.locks,
  });

  return {
    retirement,
    ...snapshot(),
  };
}

async function resolveRetirement({
  currentThrough,
  events = [],
  finalizedAt = "2026-09-02T18:00:10.000Z",
} = {}) {
  const retirement = await resolveV24RetirementSerialized({
    handoffId: HANDOFF_ID,
    brokerState: brokerState({ currentThrough, events }),
    finalizedAt,
    lockManager: navigator.locks,
  });

  return {
    retirement,
    ...snapshot(),
  };
}

window.__V24_RECOVERY_TEST__ = {
  handoffId: HANDOFF_ID,
  receiverId: RECEIVER_ID,
  routerLockName: ROUTER_LOCK_NAME,

  clear() {
    localStorage.clear();
    proposedBoundaries = new Map();
    return snapshot();
  },

  state() {
    return snapshot();
  },

  runCycle,
  requestRetirement,
  resolveRetirement,

  safety() {
    return {
      brokerReadOnly: true,
      brokerWriteAuthority: false,
      externalBrokerWrites: 0,
    };
  },
};
