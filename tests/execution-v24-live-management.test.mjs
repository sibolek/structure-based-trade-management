import test from "node:test";
import assert from "node:assert/strict";

import {
  applyV24ExecutionToManagement,
  applyV24LiveManagementCommand,
  calculateV24OpenStopRisk,
  createV24LiveManagement,
  evaluateV24ExposureIncrease,
  reconcileV24BuildWindow,
  recordV24AuthorizationException,
} from "../src/execution/execution-v24-live-management.js";

const START = "2026-09-06T14:00:00.000Z";
const BUILD_END = "2026-09-06T14:05:00.000Z";

function installation(overrides = {}) {
  return {
    status: "LISTENING",
    compatibility: {
      origin: "V24_HANDOFF",
      v24: {
        handoffId: "handoff-mgmt-1",
        symbol: "NVDA",
        direction: "LONG",
        selectedQuantity: 20,
        effectiveStop: 99,
        authorizedMaxDollarRisk: 50,
        entryAuthorizationUntil: BUILD_END,
        candidateValidUntil: BUILD_END,
        managementPlan: {
          mode: "FLEXIBLE_WITHIN_CEILING",
          positionBuildUntil: BUILD_END,
          allowReAdd: true,
        },
        instrumentEconomics: {
          assetType: "EQUITY",
          minimumQuantity: 1,
          quantityIncrement: 1,
          pointValue: 1,
        },
        targets: [{ id: "T1", price: 103 }, { id: "T2", rMultiple: 2 }],
        ...overrides,
      },
    },
  };
}

function management(options = {}) {
  return createV24LiveManagement({
    installation: installation(options.installation),
    firstExecutionTime: START,
    currentQuantity: options.currentQuantity ?? 5,
    currentAveragePrice: options.currentAveragePrice ?? 100,
  });
}

function command(state, action, payload = {}, operationId = `op-${action}`) {
  return {
    operationId,
    expectedRevision: state.revision,
    action,
    at: "2026-09-06T14:02:00.000Z",
    payload,
  };
}

test("live management freezes immutable ARM ceiling while build remains open", () => {
  const state = management();
  assert.equal(state.armQuantityCeiling, 20);
  assert.equal(state.liveManagementCeiling, 20);
  assert.equal(state.establishedPeakQuantity, 5);
  assert.equal(state.build.status, "OPEN");
  assert.equal(state.build.authorizedUntil, BUILD_END);
  assert.equal(state.currentEffectiveStop.price, 99);
});

test("automatic position-build expiry permanently relinquishes never-used capacity", () => {
  const expired = reconcileV24BuildWindow(management(), {
    at: BUILD_END,
    currentQuantity: 5,
    currentAveragePrice: 100,
  });
  assert.equal(expired.build.status, "COMPLETE");
  assert.equal(expired.build.completionReason, "BUILD_WINDOW_EXPIRED");
  assert.equal(expired.armQuantityCeiling, 20);
  assert.equal(expired.liveManagementCeiling, 5);
});

test("Complete Position Build ratchets live ceiling but never rewrites ARM ceiling", () => {
  const state = management({ currentQuantity: 8 });
  const applied = applyV24LiveManagementCommand({
    management: state,
    command: command(state, "COMPLETE_POSITION_BUILD"),
    currentQuantity: 8,
    currentAveragePrice: 100,
  });
  assert.equal(applied.management.armQuantityCeiling, 20);
  assert.equal(applied.management.liveManagementCeiling, 8);
  assert.equal(applied.management.build.status, "COMPLETE");
  assert.equal(applied.result.revision, 1);
});

test("re-add after build completion requires explicit contract permission and established ceiling", () => {
  let state = management({ currentQuantity: 8 });
  state = applyV24LiveManagementCommand({
    management: state,
    command: command(state, "COMPLETE_POSITION_BUILD"),
    currentQuantity: 8,
    currentAveragePrice: 100,
  }).management;

  const allowed = evaluateV24ExposureIncrease({
    management: state,
    currentQuantity: 5,
    currentAveragePrice: 100,
    proposedAddQuantity: 3,
    proposedFillPrice: 100,
    at: "2026-09-06T14:03:00.000Z",
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.resultingQuantity, 8);

  const tooLarge = evaluateV24ExposureIncrease({
    management: state,
    currentQuantity: 5,
    currentAveragePrice: 100,
    proposedAddQuantity: 4,
    proposedFillPrice: 100,
    at: "2026-09-06T14:03:00.000Z",
  });
  assert.equal(tooLarge.allowed, false);
  assert.ok(tooLarge.reasonCodes.includes("LIVE_MANAGEMENT_CEILING_EXCEEDED"));
});

test("realized losses consume finite lifecycle budget and profits do not replenish it", () => {
  let state = management({ installation: { authorizedMaxDollarRisk: 20 }, currentQuantity: 5 });
  const partialLoss = {
    event: "PARTIAL",
    previousQuantity: 5,
    nextQuantity: 3,
    nextAveragePrice: 100,
    realizedGrossPnl: -4,
    state: { averagePrice: 100 },
  };
  state = applyV24ExecutionToManagement({
    management: state,
    event: { executionTime: "2026-09-06T14:01:00.000Z", price: 98, quantity: 2 },
    reducerResult: partialLoss,
    eventType: "PARTIAL",
  });
  assert.equal(state.risk.cumulativeRealizedLosses, 4);

  const partialWin = {
    event: "PARTIAL",
    previousQuantity: 3,
    nextQuantity: 2,
    nextAveragePrice: 100,
    realizedGrossPnl: 5,
    state: { averagePrice: 100 },
  };
  state = applyV24ExecutionToManagement({
    management: state,
    event: { executionTime: "2026-09-06T14:02:00.000Z", price: 105, quantity: 1 },
    reducerResult: partialWin,
    eventType: "PARTIAL",
  });
  assert.equal(state.risk.realizedPnl, 1);
  assert.equal(state.risk.cumulativeRealizedLosses, 4);
  assert.equal(state.risk.remainingLossBudget, 16);
});

test("futures live risk uses ARM-frozen tick/point economics rather than equity math", () => {
  const risk = calculateV24OpenStopRisk({
    direction: "LONG",
    averagePrice: 6000,
    quantity: 2,
    stopPrice: 5999,
    instrumentEconomics: {
      assetType: "FUTURE",
      tickSize: 0.25,
      tickValue: 1.25,
      pointValue: 5,
    },
  });
  assert.equal(risk, 10);
});

test("more-protective operator stop can free add capacity while wider stop cannot manufacture it", () => {
  let state = management({ installation: { authorizedMaxDollarRisk: 20 }, currentQuantity: 5 });
  let applied = applyV24LiveManagementCommand({
    management: state,
    command: command(state, "SET_EFFECTIVE_STOP", { newStop: 99.5, reason: "structure trail" }, "stop-tighten"),
    currentQuantity: 5,
    currentAveragePrice: 100,
  });
  state = applied.management;
  let check = evaluateV24ExposureIncrease({
    management: state,
    currentQuantity: 5,
    currentAveragePrice: 100,
    proposedAddQuantity: 5,
    proposedFillPrice: 100,
    at: "2026-09-06T14:03:00.000Z",
  });
  assert.equal(check.allowed, true);

  applied = applyV24LiveManagementCommand({
    management: state,
    command: command(state, "SET_EFFECTIVE_STOP", { newStop: 98.5, reason: "wider discretion" }, "stop-widen"),
    currentQuantity: 5,
    currentAveragePrice: 100,
  });
  state = applied.management;
  check = evaluateV24ExposureIncrease({
    management: state,
    currentQuantity: 5,
    currentAveragePrice: 100,
    proposedAddQuantity: 1,
    proposedFillPrice: 100,
    at: "2026-09-06T14:04:00.000Z",
  });
  assert.equal(check.allowed, false);
  assert.ok(check.reasonCodes.includes("LIVE_STOP_NOT_RISK_PROTECTIVE"));
});

test("actual exposure beyond ceiling is preserved as broker truth and creates CRITICAL exception", () => {
  const state = management({ currentQuantity: 5 });
  const added = applyV24ExecutionToManagement({
    management: state,
    event: { executionTime: "2026-09-06T14:01:00.000Z", price: 100, quantity: 20 },
    reducerResult: {
      event: "ADD",
      previousQuantity: 5,
      nextQuantity: 25,
      nextAveragePrice: 100,
      realizedGrossPnl: 0,
      state: { averagePrice: 100 },
    },
    eventType: "ADD",
  });
  assert.equal(added.establishedPeakQuantity, 25);
  assert.ok(added.authorizationExceptions.some((item) => item.code === "AUTHORIZED_QUANTITY_EXCEEDED" && item.severity === "CRITICAL"));
  assert.equal(added.exposureIncreaseBlocked, true);
});

test("CRITICAL exception does not self-clear and requires explicit reconciliation", () => {
  let state = recordV24AuthorizationException(management(), {
    code: "AUTHORIZED_QUANTITY_EXCEEDED",
    occurredAt: "2026-09-06T14:01:00.000Z",
  });
  const exception = state.authorizationExceptions[0];
  assert.equal(state.exposureIncreaseBlocked, true);

  const applied = applyV24LiveManagementCommand({
    management: state,
    command: command(state, "RECONCILE_EXCEPTION", {
      exceptionId: exception.exceptionId,
      outcome: "CLOSE_TO_NEW_EXPOSURE",
      note: "retain reduction/exit only",
    }),
    currentQuantity: 5,
    currentAveragePrice: 100,
  });
  state = applied.management;
  assert.equal(state.authorizationExceptions[0].status, "RECONCILED");
  assert.equal(state.futureExposureIncreaseDisabled, true);
  assert.equal(state.exposureIncreaseBlocked, true);
});

test("authorized target attainment is durable management state and never broker authority", () => {
  const state = management();
  const applied = applyV24LiveManagementCommand({
    management: state,
    command: command(state, "RECORD_TARGET_OBSERVATION", {
      targetId: "T1",
      observation: { price: 103.1, observedAt: "2026-09-06T14:02:00.000Z", source: "OPERATOR" },
    }),
    currentQuantity: 5,
    currentAveragePrice: 100,
    entryPrice: 100,
  });
  assert.equal(applied.management.targets[0].status, "ATTAINED");
  assert.equal(applied.result.attained, true);
  assert.equal(applied.result.brokerWriteAuthority, undefined);
});

test("live-management command operation is idempotent only for identical payload", () => {
  const state = management();
  const firstCommand = command(state, "RECORD_DISCRETIONARY_NOTE", { note: "holding against structure" }, "same-op");
  const first = applyV24LiveManagementCommand({ management: state, command: firstCommand, currentQuantity: 5, currentAveragePrice: 100 });
  const retry = applyV24LiveManagementCommand({ management: first.management, command: firstCommand, currentQuantity: 5, currentAveragePrice: 100 });
  assert.equal(retry.result.revision, first.result.revision);
  assert.throws(
    () => applyV24LiveManagementCommand({
      management: first.management,
      command: { ...firstCommand, payload: { note: "different" } },
      currentQuantity: 5,
      currentAveragePrice: 100,
    }),
    (error) => error.code === "LIVE_MANAGEMENT_OPERATION_CONFLICT",
  );
});
