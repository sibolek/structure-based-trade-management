import test from "node:test";
import assert from "node:assert/strict";

import {
  EXECUTION_V23_STORE_KEY,
  bindAndPersistV24ExecutionListeningAt,
  buildPreparedV24LocalInstallation,
  buildV23CandidateFromListeningInstallation,
  executionOwnedSymbolsFromV23Store,
  persistPreparedV24LocalInstallation,
  readV24LocalInstallation,
} from "../src/execution/execution-v24-local-installation.js";
import { executionStop } from "../src/execution/execution-v23-compat.js";

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
    symbol: "NVDA",
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

function memoryStorage(initialStore = null) {
  const values = new Map();
  if (initialStore) values.set(EXECUTION_V23_STORE_KEY, JSON.stringify(initialStore));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("PREPARED install persists exact V2.4 provenance without starting listening", () => {
  const storage = memoryStorage({ candidates: [], liveTrades: [], history: [] });
  const prepared = buildPreparedV24LocalInstallation({
    handoff: handoff(),
    receiverId: "receiver-A",
    preparedAt: "2026-09-02T18:00:02.000Z",
  });
  const persisted = persistPreparedV24LocalInstallation({ storage, installation: prepared });

  assert.equal(persisted.status, "PREPARED");
  assert.equal(persisted.executionListeningAt, null);
  assert.equal(persisted.compatibility.v24.effectiveStop, 224.65);
  assert.equal(persisted.compatibility.v24.structuralInvalidation, 224.8);
  assert.equal(persisted.compatibility.v24.executionBoardReceiverId, "receiver-A");
});

test("identical PREPARED install retry is idempotent", () => {
  const storage = memoryStorage();
  const prepared = buildPreparedV24LocalInstallation({ handoff: handoff(), receiverId: "receiver-A" });
  const first = persistPreparedV24LocalInstallation({ storage, installation: prepared });
  const second = persistPreparedV24LocalInstallation({ storage, installation: prepared });
  assert.deepEqual(second, first);
});

test("same handoffId with different immutable content fails closed", () => {
  const storage = memoryStorage();
  const first = buildPreparedV24LocalInstallation({ handoff: handoff(), receiverId: "receiver-A" });
  persistPreparedV24LocalInstallation({ storage, installation: first });
  const conflicting = buildPreparedV24LocalInstallation({
    handoff: handoff({ effectiveStop: 224.6 }),
    receiverId: "receiver-A",
  });
  assert.throws(
    () => persistPreparedV24LocalInstallation({ storage, installation: conflicting }),
    (error) => error.code === "HANDOFF_ID_CONTENT_CONFLICT",
  );
});

test("second V2.4 local installation cannot reserve the same symbol", () => {
  const storage = memoryStorage();
  persistPreparedV24LocalInstallation({
    storage,
    installation: buildPreparedV24LocalInstallation({ handoff: handoff(), receiverId: "receiver-A" }),
  });
  const second = buildPreparedV24LocalInstallation({
    handoff: handoff({ handoffId: "handoff-002", candidateId: "candidate-002", riskEvaluationId: "risk-002" }),
    receiverId: "receiver-A",
  });
  assert.throws(
    () => persistPreparedV24LocalInstallation({ storage, installation: second }),
    (error) => error.code === "EXECUTION_SYMBOL_OWNERSHIP_CONFLICT",
  );
});

test("LISTENING transition freezes executionListeningAt durably exactly once", () => {
  const storage = memoryStorage();
  const prepared = persistPreparedV24LocalInstallation({
    storage,
    installation: buildPreparedV24LocalInstallation({ handoff: handoff(), receiverId: "receiver-A" }),
  });
  const listening = bindAndPersistV24ExecutionListeningAt({
    storage,
    handoffId: prepared.handoffId,
    executionListeningAt: "2026-09-02T18:00:03.000Z",
  });

  assert.equal(listening.status, "LISTENING");
  assert.equal(listening.executionListeningAt, "2026-09-02T18:00:03.000Z");
  assert.equal(listening.compatibility.v24.executionListeningAt, "2026-09-02T18:00:03.000Z");
  assert.deepEqual(
    bindAndPersistV24ExecutionListeningAt({
      storage,
      handoffId: prepared.handoffId,
      executionListeningAt: "2026-09-02T18:00:03.000Z",
    }),
    listening,
  );
  assert.throws(
    () => bindAndPersistV24ExecutionListeningAt({
      storage,
      handoffId: prepared.handoffId,
      executionListeningAt: "2026-09-02T18:00:04.000Z",
    }),
    (error) => error.code === "HANDOFF_ID_CONTENT_CONFLICT",
  );
});

test("local readback returns the exact persisted installation", () => {
  const storage = memoryStorage();
  const prepared = persistPreparedV24LocalInstallation({
    storage,
    installation: buildPreparedV24LocalInstallation({ handoff: handoff(), receiverId: "receiver-A" }),
  });
  assert.deepEqual(readV24LocalInstallation({ storage, handoffId: prepared.handoffId }), prepared);
});

test("ownership adapter includes manual, live, editing, PREPARED, and LISTENING symbols", () => {
  const symbols = executionOwnedSymbolsFromV23Store({
    candidates: [{ originalPlan: { symbol: "AMD" } }],
    liveTrades: [{ originalPlan: { symbol: "META" } }],
    draft: { mode: "EDIT", originalPlan: { symbol: "MU" } },
    v24Installations: [
      { handoffId: "h1", symbol: "NVDA", status: "PREPARED" },
      { handoffId: "h2", symbol: "PLTR", status: "LISTENING" },
    ],
  });
  assert.deepEqual(symbols, ["AMD", "META", "MU", "NVDA", "PLTR"]);
});

test("ownership adapter can exclude the installation currently being final-revalidated", () => {
  const symbols = executionOwnedSymbolsFromV23Store({
    candidates: [{ originalPlan: { symbol: "AMD" } }],
    v24Installations: [{ handoffId: "h1", symbol: "NVDA", status: "PREPARED" }],
  }, { excludeHandoffId: "h1" });
  assert.deepEqual(symbols, ["AMD"]);
});

test("LISTENING installation builds a V2.3-shaped candidate without losing effective-stop authority", () => {
  const storage = memoryStorage();
  const prepared = persistPreparedV24LocalInstallation({
    storage,
    installation: buildPreparedV24LocalInstallation({ handoff: handoff(), receiverId: "receiver-A" }),
  });
  const listening = bindAndPersistV24ExecutionListeningAt({
    storage,
    handoffId: prepared.handoffId,
    executionListeningAt: "2026-09-02T18:00:03.000Z",
  });
  const candidate = buildV23CandidateFromListeningInstallation(listening);

  assert.equal(candidate.originalPlan.structuralStop, 224.8);
  assert.equal(executionStop(candidate), 224.65);
  assert.equal(candidate.risk.expectedEntry, 225.8);
  assert.equal(candidate.risk.intendedSize, 20);
  assert.equal(candidate.v24.authorizedExecutionAccountId, "opaque-account-A");
});

test("local persistence failure is fail-closed", () => {
  const storage = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error("quota failure");
    },
  };
  const prepared = buildPreparedV24LocalInstallation({ handoff: handoff(), receiverId: "receiver-A" });
  assert.throws(
    () => persistPreparedV24LocalInstallation({ storage, installation: prepared }),
    (error) => error.code === "LOCAL_EXECUTION_PERSISTENCE_FAILED",
  );
});
