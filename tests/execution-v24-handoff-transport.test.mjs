import test from "node:test";
import assert from "node:assert/strict";

import { createV24HandoffTransport } from "../src/execution/execution-v24-handoff-transport.js";

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

test("discovery sends stable receiver identity in query string", async () => {
  const calls = [];
  const transport = createV24HandoffTransport({
    pretradeUrl: "http://127.0.0.1:8788/",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, { handoffs: [{ handoff: { handoffId: "h1" } }] });
    },
  });

  const handoffs = await transport.discover("receiver A");
  assert.equal(calls[0].url, "http://127.0.0.1:8788/api/handoffs?receiverId=receiver%20A");
  assert.equal(handoffs.length, 1);
});

test("claim POST carries exact receiver identity", async () => {
  let captured;
  const transport = createV24HandoffTransport({
    pretradeUrl: "http://127.0.0.1:8788",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response(200, { handoff: {}, delivery: {} });
    },
  });
  await transport.claim("handoff/1", "receiver-A");
  assert.equal(captured.url, "http://127.0.0.1:8788/api/handoffs/handoff%2F1/claim");
  assert.deepEqual(JSON.parse(captured.options.body), { receiverId: "receiver-A" });
});

test("ACK POST carries exact persisted listening boundary", async () => {
  let body;
  const transport = createV24HandoffTransport({
    pretradeUrl: "http://127.0.0.1:8788",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return response(200, { handoff: {}, delivery: {} });
    },
  });
  await transport.acknowledge("h1", "receiver-A", "2026-09-02T18:00:03.000Z");
  assert.deepEqual(body, {
    receiverId: "receiver-A",
    executionListeningAt: "2026-09-02T18:00:03.000Z",
  });
});

test("block POST preserves exact failure reason", async () => {
  let body;
  const transport = createV24HandoffTransport({
    pretradeUrl: "http://127.0.0.1:8788",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return response(200, { handoff: {}, delivery: {} });
    },
  });
  await transport.block("h1", "receiver-A", "INTERVENING_BROKER_ACTIVITY");
  assert.deepEqual(body, { receiverId: "receiver-A", reason: "INTERVENING_BROKER_ACTIVITY" });
});

test("server error code is preserved for fail-closed orchestration", async () => {
  const transport = createV24HandoffTransport({
    pretradeUrl: "http://127.0.0.1:8788",
    fetchImpl: async () => response(409, {
      error: "claimed by another receiver",
      code: "EXECUTION_BOARD_HANDOFF_ALREADY_CLAIMED",
    }),
  });
  await assert.rejects(
    () => transport.claim("h1", "receiver-A"),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_ALREADY_CLAIMED" && error.status === 409,
  );
});

test("network failure is normalized without inventing delivery state", async () => {
  const transport = createV24HandoffTransport({
    pretradeUrl: "http://127.0.0.1:8788",
    fetchImpl: async () => { throw new Error("connection refused"); },
  });
  await assert.rejects(
    () => transport.discover("receiver-A"),
    (error) => error.code === "V24_HANDOFF_TRANSPORT_UNAVAILABLE",
  );
});
