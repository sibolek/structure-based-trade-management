import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createPreTradeExecutionOwnershipApiHandler } from "../schwab-bridge/pretrade-execution-ownership-api.mjs";

async function startServer(handler) {
  const server = http.createServer(async (req, res) => {
    const handled = await handler(req, res);
    if (!handled) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

function fixture() {
  const publications = [];
  const authority = {
    publish(payload) {
      publications.push(structuredClone(payload));
      return { storeRevision: Number(payload.store?.storeRevision ?? payload.storeRevision ?? 0), storeHash: "a".repeat(64), receivedAt: "2026-09-06T20:00:00.000Z" };
    },
    health() {
      return { connected: publications.length > 0, reasonCode: publications.length ? null : "EXECUTION_OWNERSHIP_AUTHORITY_UNAVAILABLE" };
    },
  };
  return { publications, handler: createPreTradeExecutionOwnershipApiHandler({ authority }) };
}

async function request(baseUrl, { method = "POST", body = {}, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}/api/execution-ownership/snapshot`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test("ownership publication requires allowed local browser origin and canonical source header", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    let result = await request(server.baseUrl, {
      body: { kind: "SNAPSHOT" },
      headers: { Origin: "https://example.com", "x-executionos-source": "EXECUTION_CANONICAL_STORE" },
    });
    assert.equal(result.response.status, 403);
    assert.equal(f.publications.length, 0);

    result = await request(server.baseUrl, {
      body: { kind: "SNAPSHOT" },
      headers: { Origin: "http://localhost:5173" },
    });
    assert.equal(result.response.status, 403);
    assert.equal(result.payload.code, "EXECUTION_OWNERSHIP_SOURCE_HEADER_REQUIRED");
    assert.equal(f.publications.length, 0);
  } finally { await server.stop(); }
});

test("allowed local browser may publish canonical store evidence and broker-write authority remains false", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    const result = await request(server.baseUrl, {
      body: { kind: "SNAPSHOT", store: { storeRevision: 11 } },
      headers: {
        Origin: "http://127.0.0.1:5173",
        "x-executionos-source": "EXECUTION_CANONICAL_STORE",
      },
    });
    assert.equal(result.response.status, 200);
    assert.equal(f.publications.length, 1);
    assert.equal(f.publications[0].kind, "SNAPSHOT");
    assert.equal(result.payload.result.storeRevision, 11);
    assert.equal(result.payload.brokerWriteAuthority, false);
  } finally { await server.stop(); }
});

test("ownership endpoint has no route that lets browser assign a symbol status directly", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    const response = await fetch(`${server.baseUrl}/api/execution-ownership/NVDA/free`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: "http://localhost:5173",
        "x-executionos-source": "EXECUTION_CANONICAL_STORE",
      },
      body: JSON.stringify({ status: "FREE" }),
    });
    assert.equal(response.status, 404);
    assert.equal(f.publications.length, 0);
  } finally { await server.stop(); }
});
