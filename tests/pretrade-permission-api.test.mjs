import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createPreTradePermissionApiHandler } from "../schwab-bridge/pretrade-permission-api.mjs";

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
  const calls = [];
  const permissionPipeline = {
    async evaluate(command) {
      calls.push(structuredClone(command));
      return {
        status: "COMPLETED",
        permissionAttempt: { permissionAttemptId: "attempt-1", result: { outcome: "READY" } },
        transition: { lifecycleState: "READY", stateRevision: 3 },
      };
    },
  };
  const lifecycleCoordinator = {
    candidateSnapshot(candidateId, contractVersion) {
      return { candidateId, contractVersion, lifecycleState: "READY", stateRevision: 3 };
    },
  };
  return {
    calls,
    handler: createPreTradePermissionApiHandler({ permissionPipeline, lifecycleCoordinator }),
  };
}

async function post(baseUrl, body, headers = {}) {
  const response = await fetch(`${baseUrl}/api/candidates/permission-NVDA-1/versions/1/permission/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test("permission API sends intent to server pipeline and exposes no broker-write authority", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    const result = await post(server.baseUrl, {
      operationId: "permission-op-1",
      expectedState: "PERMISSION_EVALUATING",
      expectedRevision: 2,
      accountId: "acct-1",
      entryMode: "MARKETABLE_NOW",
      operatorStructuralAssessment: { status: "VALID" },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.result.transition.lifecycleState, "READY");
    assert.equal(result.payload.brokerWriteAuthority, false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].candidateId, "permission-NVDA-1");
    assert.equal(f.calls[0].contractVersion, 1);
    assert.equal(f.calls[0].accountId, "acct-1");
  } finally {
    await server.stop();
  }
});

test("permission API path identity is authoritative", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    const result = await post(server.baseUrl, {
      candidateId: "forged",
      contractVersion: 1,
      operationId: "permission-op-forged",
      accountId: "acct-1",
      entryMode: "MARKETABLE_NOW",
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.payload.code, "CANDIDATE_IDENTITY_CONFLICT");
    assert.equal(f.calls.length, 0);
  } finally {
    await server.stop();
  }
});

test("permission API rejects cross-origin mutation before pipeline invocation", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    const result = await post(server.baseUrl, {
      operationId: "permission-op-cross-origin",
      accountId: "acct-1",
      entryMode: "MARKETABLE_NOW",
    }, { Origin: "https://example.com" });
    assert.equal(result.response.status, 403);
    assert.equal(result.payload.code, "ORIGIN_NOT_ALLOWED");
    assert.equal(f.calls.length, 0);
  } finally {
    await server.stop();
  }
});
