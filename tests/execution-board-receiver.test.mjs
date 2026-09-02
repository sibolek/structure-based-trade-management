import test from "node:test";
import assert from "node:assert/strict";

import {
  EXECUTION_BOARD_RECEIVER_ID_STORAGE_KEY,
  getOrCreateExecutionBoardReceiverId,
  readExecutionBoardReceiverId,
} from "../src/execution/execution-board-receiver.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("receiver identity is generated once, persisted separately, and reused", () => {
  const storage = memoryStorage();
  let calls = 0;
  const uuidFactory = () => {
    calls += 1;
    return "receiver-A";
  };

  const first = getOrCreateExecutionBoardReceiverId({ storage, uuidFactory });
  const second = getOrCreateExecutionBoardReceiverId({ storage, uuidFactory });

  assert.equal(first, "receiver-A");
  assert.equal(second, "receiver-A");
  assert.equal(calls, 1);
  assert.equal(storage.getItem(EXECUTION_BOARD_RECEIVER_ID_STORAGE_KEY), "receiver-A");
});

test("existing receiver identity is reused without consulting UUID generation", () => {
  const storage = memoryStorage({ [EXECUTION_BOARD_RECEIVER_ID_STORAGE_KEY]: "stable-existing" });
  const receiverId = getOrCreateExecutionBoardReceiverId({
    storage,
    uuidFactory: () => {
      throw new Error("must not generate");
    },
  });
  assert.equal(receiverId, "stable-existing");
});

test("receiver identity read helper returns null before first creation", () => {
  assert.equal(readExecutionBoardReceiverId({ storage: memoryStorage() }), null);
});

test("receiver identity fails closed when durable storage is unavailable", () => {
  assert.throws(
    () => getOrCreateExecutionBoardReceiverId({ storage: null, uuidFactory: () => "receiver-A" }),
    (error) => error.code === "EXECUTION_BOARD_RECEIVER_STORAGE_UNAVAILABLE",
  );
});

test("receiver identity fails closed when generated identity is empty", () => {
  assert.throws(
    () => getOrCreateExecutionBoardReceiverId({ storage: memoryStorage(), uuidFactory: () => "" }),
    (error) => error.code === "EXECUTION_BOARD_RECEIVER_ID_INVALID",
  );
});

test("receiver identity requires exact durable readback", () => {
  const storage = {
    getItem() {
      return null;
    },
    setItem() {},
  };
  assert.throws(
    () => getOrCreateExecutionBoardReceiverId({ storage, uuidFactory: () => "receiver-A" }),
    (error) => error.code === "EXECUTION_BOARD_RECEIVER_PERSISTENCE_FAILED",
  );
});
