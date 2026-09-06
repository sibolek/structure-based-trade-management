import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createPreTradeReviewArmApiHandler } from "../schwab-bridge/pretrade-review-arm-api.mjs";

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
  const review = {
    candidateId: "candidate-1",
    contractVersion: 1,
    currentPackage: { reviewPackageId: "review-1", material: { accountId: "acct-1" } },
  };
  const reviewRepository = { get() { return structuredClone(review); } };
  const reviewService = {
    readiness(candidateId, contractVersion) {
      return { armEligible: true, candidate: { candidateId, contractVersion, lifecycleState: "READY" }, review: structuredClone(review) };
    },
    refresh(command) { calls.push(["refresh", structuredClone(command)]); return { review: structuredClone(review) }; },
    selectQuantity(command) { calls.push(["quantity", structuredClone(command)]); return { selectedQuantity: command.selectedQuantity }; },
    acknowledgeCaution(command) { calls.push(["caution", structuredClone(command)]); return { acknowledged: command.acknowledged !== false }; },
  };
  const armService = {
    async arm(command) { calls.push(["arm", structuredClone(command)]); return { status: "COMPLETED", operation: { operationId: command.operationId } }; },
  };
  const lifecycleCoordinator = {
    candidateSnapshot(candidateId, contractVersion) { return { candidateId, contractVersion, lifecycleState: "READY", stateRevision: 5 }; },
  };
  return {
    calls,
    handler: createPreTradeReviewArmApiHandler({ reviewService, reviewRepository, armService, lifecycleCoordinator, recoveryBlocked }),
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

const basePath = "/api/candidates/candidate-1/versions/1";

test("review GET exposes authoritative review/readiness and no broker-write authority", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    const result = await request(server.baseUrl, `${basePath}/review`, { method: "GET" });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.review.currentPackage.reviewPackageId, "review-1");
    assert.equal(result.payload.readiness.armEligible, true);
    assert.equal(result.payload.brokerWriteAuthority, false);
  } finally { await server.stop(); }
});

test("review mutation routes preserve path identity and exact operator intent", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    let result = await request(server.baseUrl, `${basePath}/review/refresh`, { body: { operationId: "review-refresh-1" } });
    assert.equal(result.response.status, 200);
    result = await request(server.baseUrl, `${basePath}/review/quantity`, { body: { operationId: "quantity-1", reviewPackageId: "review-1", selectedQuantity: 25 } });
    assert.equal(result.response.status, 200);
    result = await request(server.baseUrl, `${basePath}/review/caution-ack`, { body: { operationId: "ack-1", reviewPackageId: "review-1", acknowledged: true } });
    assert.equal(result.response.status, 200);
    assert.deepEqual(f.calls.map(([name]) => name), ["refresh", "quantity", "caution"]);
    assert.equal(f.calls[1][1].candidateId, "candidate-1");
    assert.equal(f.calls[1][1].contractVersion, 1);
  } finally { await server.stop(); }
});

test("final ARM requires explicit confirmation and forwards exact path identity only after confirmation", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    let result = await request(server.baseUrl, `${basePath}/arm`, {
      body: { operationId: "arm-1", reviewPackageId: "review-1", selectedQuantity: 25, confirmedDirection: "LONG" },
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.payload.code, "ARM_EXPLICIT_CONFIRMATION_REQUIRED");
    assert.equal(f.calls.length, 0);

    result = await request(server.baseUrl, `${basePath}/arm`, {
      body: { operationId: "arm-1", confirmArm: true, reviewPackageId: "review-1", selectedQuantity: 25, confirmedDirection: "LONG" },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.result.status, "COMPLETED");
    assert.equal(result.payload.brokerWriteAuthority, false);
    assert.equal(f.calls[0][0], "arm");
    assert.equal(f.calls[0][1].candidateId, "candidate-1");
    assert.equal(f.calls[0][1].contractVersion, 1);
  } finally { await server.stop(); }
});

test("startup recovery conflict blocks ARM but not review inspection", async () => {
  const f = fixture({ recoveryBlocked: true });
  const server = await startServer(f.handler);
  try {
    const review = await request(server.baseUrl, `${basePath}/review`, { method: "GET" });
    assert.equal(review.response.status, 200);
    const arm = await request(server.baseUrl, `${basePath}/arm`, { body: { confirmArm: true, operationId: "arm-1" } });
    assert.equal(arm.response.status, 409);
    assert.equal(arm.payload.code, "ARM_RECOVERY_RECONCILIATION_REQUIRED");
    assert.equal(f.calls.length, 0);
  } finally { await server.stop(); }
});

test("path identity conflict and cross-origin mutation fail before authority invocation", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    let result = await request(server.baseUrl, `${basePath}/review/refresh`, { body: { operationId: "x", candidateId: "forged" } });
    assert.equal(result.response.status, 400);
    assert.equal(result.payload.code, "CANDIDATE_IDENTITY_CONFLICT");
    result = await request(server.baseUrl, `${basePath}/review/refresh`, { body: { operationId: "x" }, headers: { Origin: "https://example.com" } });
    assert.equal(result.response.status, 403);
    assert.equal(result.payload.code, "ORIGIN_NOT_ALLOWED");
    assert.equal(f.calls.length, 0);
  } finally { await server.stop(); }
});
