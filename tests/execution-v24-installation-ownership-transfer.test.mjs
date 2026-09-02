import test from "node:test";
import assert from "node:assert/strict";

import { readExecutionBoardStore } from "../src/execution/execution-board-store-repository.js";
import { persistPreparedV24LocalInstallation } from "../src/execution/execution-v24-local-installation.js";

function memoryStorage(initial) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    removeItem: () => { value = null; },
  };
}

function oldInstallation() {
  return {
    schemaVersion: 1,
    status: "LISTENING",
    handoffId: "old-handoff",
    receiverId: "receiver-A",
    symbol: "NVDA",
    preparedAt: "2026-09-02T20:00:00.000Z",
    executionListeningAt: "2026-09-02T20:00:01.000Z",
    compatibility: { origin: "V24_HANDOFF", v24: { handoffId: "old-handoff", symbol: "NVDA" } },
  };
}

function newPrepared() {
  return {
    schemaVersion: 1,
    status: "PREPARED",
    handoffId: "new-handoff",
    receiverId: "receiver-A",
    symbol: "NVDA",
    preparedAt: "2026-09-02T21:00:00.000Z",
    executionListeningAt: null,
    compatibility: { origin: "V24_HANDOFF", v24: { handoffId: "new-handoff", symbol: "NVDA" } },
  };
}

function store(overrides = {}) {
  return JSON.stringify({
    storeSchemaVersion: 1,
    storeRevision: 1,
    draft: null,
    candidates: [],
    liveTrades: [],
    history: [],
    view: "TRADE",
    notice: "",
    v24Installations: [oldInstallation()],
    v24Retirements: [],
    v24Lifecycles: [],
    ...overrides,
  });
}

test("old immutable LISTENING provenance no longer blocks same symbol after EXIT reaches History", () => {
  const storage = memoryStorage(store({
    v24Lifecycles: [{ handoffId: "old-handoff", symbol: "NVDA", status: "EXIT" }],
    history: [{ origin: "V24_HANDOFF", v24: { handoffId: "old-handoff" }, originalPlan: { symbol: "NVDA" } }],
  }));

  const installed = persistPreparedV24LocalInstallation({ storage, installation: newPrepared() });
  assert.equal(installed.handoffId, "new-handoff");
  assert.equal(readExecutionBoardStore({ storage }).v24Installations.length, 2);
});

test("same symbol remains blocked while prior V2.4 lifecycle is LIVE", () => {
  const storage = memoryStorage(store({
    v24Lifecycles: [{ handoffId: "old-handoff", symbol: "NVDA", status: "LIVE" }],
  }));

  assert.throws(
    () => persistPreparedV24LocalInstallation({ storage, installation: newPrepared() }),
    (error) => error.code === "EXECUTION_SYMBOL_OWNERSHIP_CONFLICT",
  );
});
