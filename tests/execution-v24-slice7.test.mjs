import test from "node:test";
import assert from "node:assert/strict";

import { buildExecutionBoardHandoff } from "../schwab-bridge/execution-board-handoff.mjs";
import {
  advanceV24ManagedLiveLifecycle,
  createV24ManagedLiveLifecycle,
} from "../src/execution/execution-v24-managed-lifecycle.js";
import { runV24ExecutionRouterCycle } from "../src/execution/execution-v24-runtime-router.js";

function canonicalCandidate(overrides = {}) {
  return {
    candidateId: "slice7-NVDA-1",
    contractVersion: 1,
    contentHash: "slice7-hash-1",
    source: "SOD_A_PLUS_TRADES",
    symbol: "NVDA",
    direction: "LONG",
    setup: "Breakout continuation",
    timeframe: "2m",
    thesis: "Continue while structure holds.",
    trigger: { type: "MANUAL_CONFIRMATION", nodeId: "go" },
    targets: [{ id: "T1", price: 103 }],
    managementContract: {
      mode: "FLEXIBLE_WITHIN_CEILING",
      positionBuildUntil: "2026-09-06T14:10:00.000Z",
      allowReAdd: true,
    },
    validity: {
      validFrom: "2026-09-06T13:30:00.000Z",
      validUntil: "2026-09-06T14:10:00.000Z",
      timezone: "America/New_York",
    },
    lifecycleState: "ARMED",
    authorizedDssEvaluationId: "dss-slice7",
    authorizedRiskEvaluationId: "risk-slice7",
    arm: {
      authorizedAt: "2026-09-06T14:00:00.000Z",
      candidateVersion: 1,
      dssEvaluationId: "dss-slice7",
      riskEvaluationId: "risk-slice7",
      selectedQuantity: 10,
    },
    ...overrides,
  };
}

function riskEvaluation(overrides = {}) {
  return {
    status: "VALID",
    riskEvaluationId: "risk-slice7",
    candidate: {
      candidateId: "slice7-NVDA-1",
      contractVersion: 1,
      candidateHash: "slice7-hash-1",
      symbol: "NVDA",
      direction: "LONG",
    },
    dss: {
      dssEvaluationId: "dss-slice7",
      structuralInvalidation: 98.8,
      effectiveStop: 99,
    },
    entry: { currentExpectedEntry: 100 },
    account: { accountId: "acct-A", maxDollarRisk: 50 },
    instrument: {
      assetType: "EQUITY",
      symbol: "NVDA",
      instrumentCurrency: "USD",
      minimumQuantity: 1,
      quantityIncrement: 1,
      tickSize: 0.01,
      tickValue: 0.01,
      pointValue: 1,
      metadataSource: "SCHWAB",
      metadataObservedAt: "2026-09-06T14:00:00.000Z",
      metadataVersion: "equity-v1",
    },
    calculation: { finalQuantity: 20 },
    ...overrides,
  };
}

function handoff() {
  return buildExecutionBoardHandoff({
    handoffId: "handoff-slice7",
    createdAt: "2026-09-06T14:00:01.000Z",
    candidate: canonicalCandidate(),
    riskEvaluation: riskEvaluation(),
  });
}

function installation() {
  const frozen = handoff();
  return {
    handoffId: frozen.handoffId,
    status: "LISTENING",
    symbol: frozen.symbol,
    preparedAt: "2026-09-06T14:00:02.000Z",
    compatibility: {
      origin: "V24_HANDOFF",
      v24: {
        ...structuredClone(frozen),
        executionBoardReceiverId: "receiver-A",
        executionListeningAt: "2026-09-06T14:00:03.000Z",
      },
    },
  };
}

function brokerState(entries, currentThrough = "2026-09-06T14:01:00.000Z") {
  return {
    status: "ARMED",
    readOnly: true,
    source: "SCHWAB",
    lastError: null,
    brokerWriteAuthority: false,
    accounts: [{ accountId: "acct-A" }],
    executionCoverage: {
      schemaVersion: 1,
      status: "CONTIGUOUS",
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: "2026-09-06T13:59:00.000Z",
      baselineCompletedAt: "2026-09-06T13:59:00.000Z",
      currentThrough,
      lastGapAt: null,
      lastGapReason: null,
    },
    executionOwnershipJournal: {
      schemaVersion: 1,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: "2026-09-06T13:59:00.000Z",
      currentThrough,
      entries,
    },
  };
}

function entry(sequence = 1, quantity = 5, price = 100, time = "2026-09-06T14:00:10.000Z") {
  return {
    sequence,
    executionKey: `exec-${sequence}`,
    orderId: "order-entry",
    accountId: "acct-A",
    symbol: "NVDA",
    instruction: "BUY",
    positionEffect: "OPENING",
    quantity,
    price,
    executionTime: time,
    detectedAt: time,
    stateEvent: sequence === 1 ? "ENTRY" : "ADD",
    previousQuantity: sequence === 1 ? 0 : 5,
    nextQuantity: sequence === 1 ? quantity : 5 + quantity,
    previousSide: sequence === 1 ? "FLAT" : "LONG",
    nextSide: "LONG",
    averagePrice: price,
  };
}

test("canonical handoff freezes finite first-entry deadline and Phase4 instrument economics", () => {
  const frozen = handoff();
  assert.equal(frozen.candidateValidUntil, "2026-09-06T14:10:00.000Z");
  assert.equal(frozen.entryAuthorizationUntil, "2026-09-06T14:10:00.000Z");
  assert.equal(frozen.entryAuthorizationSource, "CANDIDATE_VALIDITY");
  assert.equal(frozen.entryAuthorizationExtendsCandidateValidity, false);
  assert.equal(frozen.instrumentEconomics.assetType, "EQUITY");
  assert.equal(frozen.instrumentEconomics.pointValue, 1);
  assert.equal(frozen.managementPlan.mode, "FLEXIBLE_WITHIN_CEILING");
});

test("explicit immutable management deadline may cross candidate validUntil and is auditable", () => {
  const candidate = canonicalCandidate({
    managementContract: {
      mode: "FLEXIBLE_WITHIN_CEILING",
      entryAuthorizationUntil: "2026-09-06T14:15:00.000Z",
      positionBuildUntil: "2026-09-06T14:15:00.000Z",
      allowReAdd: true,
    },
  });
  const frozen = buildExecutionBoardHandoff({
    handoffId: "handoff-cross-validity",
    createdAt: "2026-09-06T14:00:01.000Z",
    candidate,
    riskEvaluation: riskEvaluation(),
  });
  assert.equal(frozen.entryAuthorizationUntil, "2026-09-06T14:15:00.000Z");
  assert.equal(frozen.entryAuthorizationSource, "MANAGEMENT_CONTRACT");
  assert.equal(frozen.entryAuthorizationExtendsCandidateValidity, true);
});

test("managed first fill preserves trusted LIVE lifecycle and initializes separate management authority", () => {
  const install = installation();
  const first = entry();
  const lifecycle = createV24ManagedLiveLifecycle({
    installation: install,
    matchedExecution: first,
    brokerState: brokerState([first]),
  });
  assert.equal(lifecycle.status, "LIVE");
  assert.equal(lifecycle.currentQuantity, 5);
  assert.equal(lifecycle.management.armQuantityCeiling, 10);
  assert.equal(lifecycle.management.liveManagementCeiling, 10);
  assert.equal(lifecycle.management.currentEffectiveStop.price, 99);
  assert.equal(lifecycle.management.risk.authorizedMaxDollarRisk, 50);
});

test("managed lifecycle records actual over-ceiling ADD as critical exception without rewriting broker truth", () => {
  const install = installation();
  const first = entry();
  let lifecycle = createV24ManagedLiveLifecycle({
    installation: install,
    matchedExecution: first,
    brokerState: brokerState([first]),
  });
  const add = {
    ...entry(2, 10, 100, "2026-09-06T14:00:20.000Z"),
    orderId: "order-add",
    previousQuantity: 5,
    nextQuantity: 15,
    stateEvent: "ADD",
  };
  lifecycle = advanceV24ManagedLiveLifecycle({
    lifecycle,
    installation: install,
    brokerState: brokerState([first, add]),
    now: "2026-09-06T14:00:30.000Z",
  });
  assert.equal(lifecycle.status, "LIVE");
  assert.equal(lifecycle.currentQuantity, 15);
  assert.ok(lifecycle.management.authorizationExceptions.some((item) => item.code === "AUTHORIZED_QUANTITY_EXCEEDED" && item.severity === "CRITICAL"));
  assert.equal(lifecycle.management.exposureIncreaseBlocked, true);
});

test("router expires unfilled authorization at immutable deadline without invoking first-fill matcher", async () => {
  const install = installation();
  let store = {
    storeRevision: 4,
    v24Installations: [install],
    v24Retirements: [],
    v24Lifecycles: [],
    liveTrades: [],
    history: [],
  };
  let matchCalls = 0;
  const results = await runV24ExecutionRouterCycle({
    transport: null,
    receiverId: "receiver-A",
    brokerState: brokerState([], "2026-09-06T14:11:00.000Z"),
    now: () => "2026-09-06T14:11:00.000Z",
    dependencies: {
      readStore: () => structuredClone(store),
      requestRetirement: async ({ requestedAt, reason }) => {
        assert.equal(requestedAt, "2026-09-06T14:10:00.000Z");
        assert.equal(reason, "ENTRY_AUTHORIZATION_EXPIRED");
        const retirement = { handoffId: install.handoffId, status: "REQUESTED", cutoffAt: requestedAt, reason };
        store = { ...store, v24Retirements: [retirement] };
        return retirement;
      },
      resolveRetirement: async () => {
        const retirement = { handoffId: install.handoffId, status: "RETIRED", cutoffAt: "2026-09-06T14:10:00.000Z", reason: "ENTRY_AUTHORIZATION_EXPIRED" };
        store = { ...store, v24Retirements: [retirement] };
        return retirement;
      },
      evaluateInitialFill: () => { matchCalls += 1; return { status: "WAITING" }; },
      advanceLifecycle: async () => ({ status: "NO_LIFECYCLE" }),
    },
  });
  assert.equal(matchCalls, 0);
  assert.ok(results.results.some((item) => item.stage === "ENTRY_AUTHORIZATION" && item.reason === "ENTRY_AUTHORIZATION_EXPIRED"));
  assert.ok(results.results.some((item) => item.stage === "FIRST_FILL" && item.status === "RETIRED"));
});
