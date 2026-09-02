import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  readExecutionBoardStore,
  transactExecutionBoardStore,
} from "../src/execution/execution-board-store-repository.js";
import {
  persistV24LiveLifecycle,
  readV24LiveLifecycle,
} from "../src/execution/execution-v24-live-lifecycle.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test("ExecutionV23 has no direct full-store localStorage writer", () => {
  const source = fs.readFileSync(new URL("../src/pages/ExecutionV23.jsx", import.meta.url), "utf8");
  assert.equal(source.includes("localStorage.setItem"), false);
  assert.equal(source.includes("transactV23ExecutionProjection"), true);
  assert.equal(source.includes("subscribeV23ExecutionProjection"), true);
});

test("ExecutionV23 explicitly excludes V2.4 origin from legacy fill and lifecycle matchers", () => {
  const source = fs.readFileSync(new URL("../src/pages/ExecutionV23.jsx", import.meta.url), "utf8");
  assert.equal(source.includes('candidate?.origin === "V24_HANDOFF"'), true);
  assert.equal(source.includes('trade?.origin === "V24_HANDOFF"'), true);
});

test("V2.4 LIVE lifecycle persistence increments canonical revision and preserves other namespaces", () => {
  const storage = memoryStorage();
  transactExecutionBoardStore({ storage, mutate: (store) => ({
    ...store,
    candidates: [{ id: "legacy-candidate" }],
    v24Installations: [{ handoffId: "h1", status: "LISTENING" }],
    futureNamespace: { keep: true },
  }) });
  const before = readExecutionBoardStore({ storage });

  const lifecycle = {
    schemaVersion: 1,
    status: "LIVE",
    handoffId: "h1",
    executionAccountId: "opaque-A",
    symbol: "NVDA",
    entryOrderId: "12345",
  };
  const persisted = persistV24LiveLifecycle({ storage, lifecycle });

  assert.equal(persisted.handoffId, "h1");
  const after = readExecutionBoardStore({ storage });
  assert.equal(after.storeRevision, before.storeRevision + 1);
  assert.deepEqual(after.candidates, [{ id: "legacy-candidate" }]);
  assert.deepEqual(after.v24Installations, [{ handoffId: "h1", status: "LISTENING" }]);
  assert.deepEqual(after.futureNamespace, { keep: true });
  assert.deepEqual(readV24LiveLifecycle({ storage, handoffId: "h1" }), lifecycle);
});
