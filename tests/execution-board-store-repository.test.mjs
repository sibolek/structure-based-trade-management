import test from "node:test";
import assert from "node:assert/strict";

import {
  EXECUTION_BOARD_STORE_KEY,
  EXECUTION_BOARD_STORE_WRITER_LOCK_NAME,
  normalizeExecutionBoardStore,
  readExecutionBoardStore,
  subscribeExecutionBoardStore,
  transactExecutionBoardStore,
  transactExecutionBoardStoreSerialized,
} from "../src/execution/execution-board-store-repository.js";

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    dump(key) { return data.get(key) ?? null; },
  };
}


function serialLockManager() {
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

test("canonical store preserves legacy, V2.4, and unknown forward-compatible namespaces", () => {
  const normalized = normalizeExecutionBoardStore({
    storeRevision: 7,
    draft: { phase: "PLAN" },
    candidates: [{ id: "manual-A" }],
    liveTrades: [{ id: "live-A" }],
    history: [{ id: "history-A" }],
    view: "HISTORY",
    notice: "hello",
    v24Installations: [{ handoffId: "h1" }],
    v24Retirements: [{ handoffId: "h2" }],
    v24Lifecycles: [{ handoffId: "h3" }],
    futureNamespace: { keep: true },
  });

  assert.equal(normalized.storeRevision, 7);
  assert.equal(normalized.candidates[0].id, "manual-A");
  assert.equal(normalized.v24Installations[0].handoffId, "h1");
  assert.equal(normalized.v24Retirements[0].handoffId, "h2");
  assert.equal(normalized.v24Lifecycles[0].handoffId, "h3");
  assert.deepEqual(normalized.futureNamespace, { keep: true });
  assert.ok(Object.isFrozen(normalized));
});

test("successful transactions read latest durable state and increment revision exactly once", () => {
  const storage = memoryStorage();
  const first = transactExecutionBoardStore({
    storage,
    mutate: (store) => ({ ...store, notice: "first" }),
  });
  const second = transactExecutionBoardStore({
    storage,
    mutate: (store) => ({ ...store, notice: "second" }),
  });

  assert.equal(first.storeRevision, 1);
  assert.equal(second.storeRevision, 2);
  assert.equal(readExecutionBoardStore({ storage }).notice, "second");
});


test("serialized canonical writer acquires the dedicated exclusive Web Lock and rereads latest state", async () => {
  const storage = memoryStorage();
  const lockManager = serialLockManager();

  const firstPromise = transactExecutionBoardStoreSerialized({
    storage,
    lockManager,
    mutate: (store) => ({ ...store, notice: "first" }),
  });

  const secondPromise = transactExecutionBoardStoreSerialized({
    storage,
    lockManager,
    mutate: (store) => ({
      ...store,
      candidates: [...store.candidates, { id: store.notice }],
      notice: "second",
    }),
  });

  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(first.storeRevision, 1);
  assert.equal(second.storeRevision, 2);
  assert.deepEqual(second.candidates, [{ id: "first" }]);
  assert.equal(readExecutionBoardStore({ storage }).notice, "second");

  assert.equal(lockManager.calls.length, 2);
  assert.deepEqual(lockManager.calls[0], {
    name: EXECUTION_BOARD_STORE_WRITER_LOCK_NAME,
    options: { mode: "exclusive" },
  });
  assert.deepEqual(lockManager.calls[1], {
    name: EXECUTION_BOARD_STORE_WRITER_LOCK_NAME,
    options: { mode: "exclusive" },
  });
});

test("serialized canonical writer fails closed when required Web Lock capability is unavailable", async () => {
  const storage = memoryStorage();

  await assert.rejects(
    () => transactExecutionBoardStoreSerialized({
      storage,
      lockManager: null,
      mutate: (store) => ({ ...store, notice: "must not write" }),
    }),
    (error) => error.code === "EXECUTION_BOARD_STORE_WRITER_LOCK_UNAVAILABLE",
  );

  assert.equal(storage.dump(EXECUTION_BOARD_STORE_KEY), null);
});

test("stale legacy projection cannot erase a newer V2.4 durable namespace", () => {
  const storage = memoryStorage();

  transactExecutionBoardStore({
    storage,
    mutate: (store) => ({
      ...store,
      draft: { phase: "PLAN" },
      candidates: [{ id: "manual-A" }],
    }),
  });
  const staleProjection = readExecutionBoardStore({ storage });

  transactExecutionBoardStore({
    storage,
    mutate: (store) => ({
      ...store,
      v24Installations: [{ handoffId: "handoff-NVDA", status: "LISTENING" }],
    }),
  });

  const committed = transactExecutionBoardStore({
    storage,
    mutate: (latest) => ({
      ...latest,
      draft: { ...staleProjection.draft, phase: "RISK" },
      notice: "legacy UI changed an unrelated field",
    }),
  });

  assert.equal(committed.storeRevision, 3);
  assert.equal(committed.draft.phase, "RISK");
  assert.equal(committed.v24Installations.length, 1);
  assert.equal(committed.v24Installations[0].handoffId, "handoff-NVDA");
});

test("a transaction preserves unknown latest fields even when caller only changes one legacy field", () => {
  const storage = memoryStorage({
    [EXECUTION_BOARD_STORE_KEY]: JSON.stringify({
      storeRevision: 11,
      candidates: [],
      v24Installations: [],
      futureNamespace: { version: 99 },
    }),
  });

  const committed = transactExecutionBoardStore({
    storage,
    mutate: (store) => ({ ...store, notice: "updated" }),
  });

  assert.equal(committed.storeRevision, 12);
  assert.deepEqual(committed.futureNamespace, { version: 99 });
});

test("repository publishes the exact committed snapshot to same-context subscribers", () => {
  const storage = memoryStorage();
  const observed = [];
  const unsubscribe = subscribeExecutionBoardStore({
    listener: (snapshot) => observed.push(snapshot),
  });
  try {
    const committed = transactExecutionBoardStore({
      storage,
      mutate: (store) => ({ ...store, notice: "published" }),
    });
    assert.equal(observed.length, 1);
    assert.equal(observed[0].storeRevision, committed.storeRevision);
    assert.equal(observed[0].notice, "published");
  } finally {
    unsubscribe();
  }
});

test("mutation errors do not write or advance durable revision", () => {
  const storage = memoryStorage();
  const before = readExecutionBoardStore({ storage });
  assert.throws(
    () => transactExecutionBoardStore({
      storage,
      mutate: () => { throw Object.assign(new Error("blocked"), { code: "BLOCKED_TEST" }); },
    }),
    (error) => error.code === "BLOCKED_TEST",
  );
  const after = readExecutionBoardStore({ storage });
  assert.equal(after.storeRevision, before.storeRevision);
  assert.equal(storage.dump(EXECUTION_BOARD_STORE_KEY), null);
});

test("exact readback mismatch fails closed and restores the prior durable store", () => {
  const prior = JSON.stringify({ storeRevision: 4, notice: "prior" });
  const data = new Map([[EXECUTION_BOARD_STORE_KEY, prior]]);
  let corruptNextWrite = true;
  const storage = {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) {
      if (corruptNextWrite) {
        corruptNextWrite = false;
        data.set(key, `${value} `);
      } else {
        data.set(key, String(value));
      }
    },
    removeItem(key) { data.delete(key); },
  };

  assert.throws(
    () => transactExecutionBoardStore({
      storage,
      mutate: (store) => ({ ...store, notice: "should not commit" }),
    }),
    (error) => error.code === "LOCAL_EXECUTION_PERSISTENCE_FAILED",
  );

  assert.equal(data.get(EXECUTION_BOARD_STORE_KEY), prior);
  assert.equal(readExecutionBoardStore({ storage }).storeRevision, 4);
  assert.equal(readExecutionBoardStore({ storage }).notice, "prior");
});

test("invalid durable JSON fails closed instead of inventing a replacement store", () => {
  const storage = memoryStorage({ [EXECUTION_BOARD_STORE_KEY]: "{broken" });
  assert.throws(
    () => readExecutionBoardStore({ storage }),
    (error) => error.code === "LOCAL_EXECUTION_PERSISTENCE_FAILED",
  );
});
