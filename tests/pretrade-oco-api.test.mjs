import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createPreTradeOcoApiHandler } from "../schwab-bridge/pretrade-oco-api.mjs";

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

function fixture({ recoveryBlocked = false } = {}) {
  const calls = [];
  const groups = [{ groupId: "oco-1", status: "ACTIVE", accountId: "acct-1" }];
  const ocoRepository = { list() { return structuredClone(groups); } };
  const ocoService = {
    createGroup(command) { calls.push(["create", structuredClone(command)]); return { groupId: command.groupId, status: "ACTIVE" }; },
    setAccount(command) { calls.push(["account", structuredClone(command)]); return { groupId: command.groupId, accountId: command.accountId }; },
    dissolve(command) { calls.push(["dissolve", structuredClone(command)]); return { groupId: command.groupId, status: "DISSOLVED" }; },
  };
  return {
    calls,
    handler: createPreTradeOcoApiHandler({ ocoService, ocoRepository, recoveryBlocked }),
  };
}

async function request(baseUrl, path, { method = "POST", body = {}, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test("OCO collection GET exposes groups read-only", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    const result = await request(server.baseUrl, "/api/oco-groups", { method: "GET" });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.groups[0].groupId, "oco-1");
    assert.equal(result.payload.brokerWriteAuthority, false);
  } finally { await server.stop(); }
});

test("OCO create account and dissolve routes are intent-specific", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    let result = await request(server.baseUrl, "/api/oco-groups", { body: { operationId: "create-1", groupId: "oco-new", accountId: "acct-1", members: [{ candidateId: "a", contractVersion: 1 }, { candidateId: "b", contractVersion: 1 }] } });
    assert.equal(result.response.status, 200);
    result = await request(server.baseUrl, "/api/oco-groups/oco-new/account", { body: { operationId: "account-1", accountId: "acct-2" } });
    assert.equal(result.response.status, 200);
    result = await request(server.baseUrl, "/api/oco-groups/oco-new/dissolve", { body: { operationId: "dissolve-1" } });
    assert.equal(result.response.status, 200);
    assert.deepEqual(f.calls.map(([name]) => name), ["create", "account", "dissolve"]);
    assert.equal(f.calls[1][1].groupId, "oco-new");
  } finally { await server.stop(); }
});

test("startup ARM recovery conflict blocks OCO mutations but not inspection", async () => {
  const f = fixture({ recoveryBlocked: true });
  const server = await startServer(f.handler);
  try {
    const get = await request(server.baseUrl, "/api/oco-groups", { method: "GET" });
    assert.equal(get.response.status, 200);
    const post = await request(server.baseUrl, "/api/oco-groups", { body: { operationId: "create-1" } });
    assert.equal(post.response.status, 409);
    assert.equal(post.payload.code, "ARM_RECOVERY_RECONCILIATION_REQUIRED");
    assert.equal(f.calls.length, 0);
  } finally { await server.stop(); }
});

test("cross-origin OCO mutation is rejected before authority invocation", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    const result = await request(server.baseUrl, "/api/oco-groups", { body: { operationId: "x" }, headers: { Origin: "https://example.com" } });
    assert.equal(result.response.status, 403);
    assert.equal(result.payload.code, "ORIGIN_NOT_ALLOWED");
    assert.equal(f.calls.length, 0);
  } finally { await server.stop(); }
});

test("no public OCO winner resolve or commit route exists", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    const result = await request(server.baseUrl, "/api/oco-groups/oco-1/resolve", { body: { winner: "forged" } });
    assert.equal(result.response.status, 404);
    assert.equal(f.calls.length, 0);
  } finally { await server.stop(); }
});
