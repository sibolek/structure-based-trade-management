import test from "node:test";
import assert from "node:assert/strict";

import {
  readExecutionBoardStore,
  transactExecutionBoardStore,
} from "../src/execution/execution-board-store-repository.js";
import {
  readV23ExecutionProjection,
  subscribeV23ExecutionProjection,
  transactV23ExecutionProjection,
} from "../src/execution/execution-v23-store-authority.js";

function serialWriterLockManager() {
  let tail = Promise.resolve();
  const calls = [];

  return {
    calls,
    request(name, options, callback) {
      calls.push({ name, options: structuredClone(options) });
      const run = tail.then(() => callback({ name, mode: options?.mode }));
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test("V2.3 projection reads only UI namespaces while canonical store retains V2.4 namespaces", () => {
  const storage = memoryStorage();
  transactExecutionBoardStore({ storage, mutate: (store) => ({
    ...store,
    candidates: [{ id: "legacy-1" }],
    v24Installations: [{ handoffId: "h1", status: "LISTENING" }],
    v24Lifecycles: [{ handoffId: "h1", status: "LIVE" }],
  }) });

  const projection = readV23ExecutionProjection({ storage });
  assert.deepEqual(projection.candidates, [{ id: "legacy-1" }]);
  assert.equal(Object.prototype.hasOwnProperty.call(projection, "v24Installations"), false);

  const canonical = readExecutionBoardStore({ storage });
  assert.equal(canonical.v24Installations.length, 1);
  assert.equal(canonical.v24Lifecycles.length, 1);
});

test("V2.3 transaction starts from latest durable store and cannot erase newer V2.4 state", async () => {
  const storage = memoryStorage();
  transactExecutionBoardStore({ storage, mutate: (store) => ({ ...store, notice: "old" }) });
  const staleProjection = readV23ExecutionProjection({ storage });

  transactExecutionBoardStore({ storage, mutate: (store) => ({
    ...store,
    v24Installations: [{ handoffId: "h1", status: "LISTENING" }],
    v24Retirements: [{ handoffId: "h2", status: "RETIRED" }],
  }) });

  const committedProjection = await transactV23ExecutionProjection({
    storage,
    lockManager: serialWriterLockManager(),
    updater: (latest) => ({ ...latest, notice: `${staleProjection.notice}-updated` }),
  });

  assert.equal(committedProjection.notice, "old-updated");
  const canonical = readExecutionBoardStore({ storage });
  assert.deepEqual(canonical.v24Installations, [{ handoffId: "h1", status: "LISTENING" }]);
  assert.deepEqual(canonical.v24Retirements, [{ handoffId: "h2", status: "RETIRED" }]);
});

test("concurrent V2.3 projection writes serialize against the latest canonical revision", async () => {
  const storage = memoryStorage();
  const lockManager = serialWriterLockManager();

  const first = transactV23ExecutionProjection({
    storage,
    lockManager,
    updater: (current) => ({
      ...current,
      notice: "first",
    }),
  });

  const second = transactV23ExecutionProjection({
    storage,
    lockManager,
    updater: (current) => ({
      ...current,
      view: "HISTORY",
    }),
  });

  await Promise.all([first, second]);

  const projection = readV23ExecutionProjection({ storage });
  assert.equal(projection.notice, "first");
  assert.equal(projection.view, "HISTORY");

  const canonical = readExecutionBoardStore({ storage });
  assert.equal(canonical.notice, "first");
  assert.equal(canonical.view, "HISTORY");
  assert.equal(canonical.storeRevision, 2);
  assert.equal(lockManager.calls.length, 2);
});

test("V2.3 projection subscriber receives canonical same-context commits", () => {
  const storage = memoryStorage();
  const seen = [];
  const unsubscribe = subscribeV23ExecutionProjection({ listener: (projection) => seen.push(projection.notice) });
  try {
    transactExecutionBoardStore({ storage, mutate: (store) => ({ ...store, notice: "external-v24-commit" }) });
    assert.deepEqual(seen, ["external-v24-commit"]);
  } finally {
    unsubscribe();
  }
});

test("V2.3 projection transaction preserves unknown forward-compatible namespaces", async () => {
  const storage = memoryStorage();
  transactExecutionBoardStore({ storage, mutate: (store) => ({
    ...store,
    futureExecutionNamespace: { token: "keep-me" },
  }) });

  await transactV23ExecutionProjection({
    storage,
    lockManager: serialWriterLockManager(),
    updater: (current) => ({ ...current, view: "HISTORY" }),
  });

  const canonical = readExecutionBoardStore({ storage });
  assert.deepEqual(canonical.futureExecutionNamespace, { token: "keep-me" });
  assert.equal(canonical.view, "HISTORY");
});
