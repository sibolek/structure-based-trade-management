import test from "node:test";
import assert from "node:assert/strict";

import {
  V24_ROUTER_FAILURE_SCOPES,
  V24_ROUTER_FAILURE_STAGES,
  createV24RouterFailure,
  failuresFromV24RouterCycleResult,
  isV24RouterGlobalStoreFailure,
} from "../src/execution/execution-v24-router-telemetry.js";

const OCCURRED = "2026-09-03T23:30:00.000Z";

test("Decision 22I publishes the frozen failure stage vocabulary", () => {
  assert.deepEqual(V24_ROUTER_FAILURE_STAGES, [
    "ACTIVATION",
    "RETIREMENT",
    "FIRST_FILL",
    "LIFECYCLE",
    "ROUTER_SERVICE",
    "STORE",
    "TRANSPORT",
  ]);

  assert.deepEqual(V24_ROUTER_FAILURE_SCOPES, [
    "HANDOFF",
    "SERVICE",
    "STORE",
  ]);
});

test("structured handoff failure preserves stage code message identity and recoverability", () => {
  const failure = createV24RouterFailure({
    occurredAt: OCCURRED,
    stage: "ACTIVATION",
    code: "ACTIVATION_FAILED",
    message: "activation failed",
    handoffId: "handoff-1",
    symbol: "nvda",
  });

  assert.deepEqual(failure, {
    occurredAt: OCCURRED,
    stage: "ACTIVATION",
    code: "ACTIVATION_FAILED",
    message: "activation failed",
    handoffId: "handoff-1",
    symbol: "NVDA",
    scope: "HANDOFF",
    recoverable: true,
  });
});

test("canonical store integrity and writer capability failures normalize to global STORE scope", () => {
  for (const code of [
    "LOCAL_EXECUTION_PERSISTENCE_FAILED",
    "EXECUTION_BOARD_STORE_WRITER_LOCK_UNAVAILABLE",
  ]) {
    const failure = createV24RouterFailure({
      occurredAt: OCCURRED,
      stage: "LIFECYCLE",
      code,
      message: "store unavailable",
      handoffId: "handoff-2",
    });

    assert.equal(failure.stage, "STORE");
    assert.equal(failure.scope, "STORE");
    assert.equal(failure.recoverable, false);
  }
});

test("cycle telemetry records ERROR results but not WAITING BLOCKED or reconciliation classifications", () => {
  const failures = failuresFromV24RouterCycleResult({
    processedAt: OCCURRED,
    results: [
      { stage: "TRANSPORT", status: "WAITING_FOR_PRETRADE", reason: "V24_HANDOFF_TRANSPORT_UNAVAILABLE" },
      { stage: "ACTIVATION", handoffId: "h-blocked", status: "BLOCKED", reason: "SYMBOL_CONFLICT" },
      { stage: "FIRST_FILL", handoffId: "h-recon", status: "RECONCILIATION_REQUIRED", reason: "JOURNAL_GAP" },
      { stage: "TRANSPORT", status: "ERROR", reason: "PRETRADE_DISCOVERY_FAILED" },
    ],
  });

  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0], {
    occurredAt: OCCURRED,
    stage: "TRANSPORT",
    code: "PRETRADE_DISCOVERY_FAILED",
    message: "PRETRADE_DISCOVERY_FAILED",
    handoffId: null,
    symbol: null,
    scope: "SERVICE",
    recoverable: true,
  });
});

test("non-stable free-text reason receives a stable stage error code while preserving message", () => {
  const [failure] = failuresFromV24RouterCycleResult({
    processedAt: OCCURRED,
    results: [{
      stage: "TRANSPORT",
      status: "ERROR",
      reason: "pretrade connection reset",
    }],
  });

  assert.equal(failure.code, "TRANSPORT_ERROR");
  assert.equal(failure.message, "pretrade connection reset");
});

test("Decision 22I distinguishes global store blockers from handoff failures", () => {
  assert.equal(isV24RouterGlobalStoreFailure({
    code: "EXECUTION_BOARD_STORE_WRITER_LOCK_UNAVAILABLE",
  }), true);
  assert.equal(isV24RouterGlobalStoreFailure({
    code: "LOCAL_EXECUTION_PERSISTENCE_FAILED",
  }), true);
  assert.equal(isV24RouterGlobalStoreFailure({
    code: "ACTIVATION_HANDOFF_FAILURE",
  }), false);
});
