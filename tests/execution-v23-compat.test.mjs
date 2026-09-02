import test from "node:test";
import assert from "node:assert/strict";

import {
  EXECUTION_ORIGINS,
  assertV24AuthorizationImmutable,
  bindV24ExecutionListeningAt,
  buildV24ExecutionCompatibilityEnvelope,
  executionAuthorizedAccountId,
  executionAuthorizedQuantity,
  executionExpectedEntry,
  executionOrigin,
  executionStop,
  executionStructuralInvalidation,
  isV24Origin,
  plannedExecutionRisk,
} from "../src/execution/execution-v23-compat.js";

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
    symbol: "nvda",
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

function legacyTrade(overrides = {}) {
  return {
    originalPlan: {
      symbol: "AMD",
      structuralStop: 100,
    },
    risk: {
      expectedEntry: 102,
      intendedSize: 10,
    },
    ...overrides,
  };
}

test("builds an immutable V2.4 compatibility envelope without starting listening ownership", () => {
  const envelope = buildV24ExecutionCompatibilityEnvelope({
    handoff: handoff(),
    receiverId: "receiver-A",
  });

  assert.equal(envelope.origin, EXECUTION_ORIGINS.V24_HANDOFF);
  assert.equal(envelope.v24.symbol, "NVDA");
  assert.equal(envelope.v24.structuralInvalidation, 224.8);
  assert.equal(envelope.v24.effectiveStop, 224.65);
  assert.equal(envelope.v24.selectedQuantity, 20);
  assert.equal(envelope.v24.authorizedExecutionAccountId, "opaque-account-A");
  assert.equal(envelope.v24.executionBoardReceiverId, "receiver-A");
  assert.equal(envelope.v24.executionListeningAt, null);
  assert.ok(Object.isFrozen(envelope));
  assert.ok(Object.isFrozen(envelope.v24));
});

test("V2.4 execution stop authority is effectiveStop while structural invalidation remains separate", () => {
  const envelope = buildV24ExecutionCompatibilityEnvelope({ handoff: handoff(), receiverId: "receiver-A" });
  assert.equal(executionStop(envelope), 224.65);
  assert.equal(executionStructuralInvalidation(envelope), 224.8);
  assert.notEqual(executionStop(envelope), executionStructuralInvalidation(envelope));
});

test("legacy/manual V2.3 stop behavior remains structuralStop", () => {
  const trade = legacyTrade();
  assert.equal(executionOrigin(trade), EXECUTION_ORIGINS.LEGACY_MANUAL_V23);
  assert.equal(isV24Origin(trade), false);
  assert.equal(executionStop(trade), 100);
  assert.equal(executionStructuralInvalidation(trade), 100);
  assert.equal(executionExpectedEntry(trade), 102);
  assert.equal(executionAuthorizedQuantity(trade), 10);
  assert.equal(executionAuthorizedAccountId(trade), null);
});

test("planned risk uses V2.4 effective stop and selected quantity", () => {
  const envelope = buildV24ExecutionCompatibilityEnvelope({ handoff: handoff(), receiverId: "receiver-A" });
  assert.equal(plannedExecutionRisk(envelope), (225.8 - 224.65) * 20);
});

test("planned risk preserves legacy/manual V2.3 calculation", () => {
  assert.equal(plannedExecutionRisk(legacyTrade()), 20);
});

test("exact V2.4 account, candidate, DSS, and risk provenance are preserved", () => {
  const envelope = buildV24ExecutionCompatibilityEnvelope({ handoff: handoff(), receiverId: "receiver-A" });
  assert.equal(envelope.v24.candidateId, "candidate-001");
  assert.equal(envelope.v24.contractVersion, 3);
  assert.equal(envelope.v24.candidateContentHash, "hash-001");
  assert.equal(envelope.v24.dssEvaluationId, "dss-001");
  assert.equal(envelope.v24.riskEvaluationId, "risk-001");
  assert.equal(executionAuthorizedAccountId(envelope), "opaque-account-A");
});

test("binding executionListeningAt is a one-time immutable provenance transition", () => {
  const envelope = buildV24ExecutionCompatibilityEnvelope({ handoff: handoff(), receiverId: "receiver-A" });
  const listening = bindV24ExecutionListeningAt(envelope, "2026-09-02T18:00:03.000Z");

  assert.equal(envelope.v24.executionListeningAt, null);
  assert.equal(listening.v24.executionListeningAt, "2026-09-02T18:00:03.000Z");
  assert.ok(Object.isFrozen(listening));
  assert.throws(
    () => bindV24ExecutionListeningAt(listening, "2026-09-02T18:00:04.000Z"),
    (error) => error.code === "V24_EXECUTION_LISTENING_AT_ALREADY_BOUND",
  );
});

test("executionListeningAt cannot precede V2.4 authorization", () => {
  const envelope = buildV24ExecutionCompatibilityEnvelope({ handoff: handoff(), receiverId: "receiver-A" });
  assert.throws(
    () => bindV24ExecutionListeningAt(envelope, "2026-09-02T17:59:59.999Z"),
    (error) => error.code === "V24_EXECUTION_LISTENING_AT_INVALID",
  );
});

test("V2.4 authorization mutation fails closed with the approved code", () => {
  const before = buildV24ExecutionCompatibilityEnvelope({ handoff: handoff(), receiverId: "receiver-A" });
  const after = {
    ...before,
    v24: {
      ...before.v24,
      effectiveStop: 225.1,
    },
  };

  assert.throws(
    () => assertV24AuthorizationImmutable(before, after),
    (error) => error.code === "V24_AUTHORIZATION_IMMUTABLE",
  );
});

test("identical V2.4 authorization provenance passes the immutability guard", () => {
  const before = buildV24ExecutionCompatibilityEnvelope({ handoff: handoff(), receiverId: "receiver-A" });
  const identical = structuredClone(before);
  assert.equal(assertV24AuthorizationImmutable(before, identical), identical);
});

test("legacy/manual records are not subjected to the V2.4 provenance guard", () => {
  const before = legacyTrade();
  const after = legacyTrade({ originalPlan: { symbol: "AMD", structuralStop: 101 } });
  assert.equal(assertV24AuthorizationImmutable(before, after), after);
});

test("compatibility envelope rejects invalid V2.4 geometry rather than normalizing it", () => {
  assert.throws(
    () => buildV24ExecutionCompatibilityEnvelope({
      handoff: handoff({ currentExpectedEntry: 224.5, effectiveStop: 224.65 }),
      receiverId: "receiver-A",
    }),
    (error) => error.code === "INVALID_V24_EXECUTION_PROVENANCE",
  );
});

test("compatibility envelope requires stable receiver identity", () => {
  assert.throws(
    () => buildV24ExecutionCompatibilityEnvelope({ handoff: handoff(), receiverId: "" }),
    (error) => error.code === "EXECUTION_BOARD_RECEIVER_ID_REQUIRED",
  );
});
