import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { buildExecutionBoardHandoff } from "../schwab-bridge/execution-board-handoff.mjs";
import { ExecutionBoardHandoffRepository } from "../schwab-bridge/execution-board-handoff-repository.mjs";
import { ExecutionBoardHandoffDeliveryRepository } from "../schwab-bridge/execution-board-handoff-delivery-repository.mjs";
import {
  ExecutionBoardHandoffApiService,
  createExecutionBoardHandoffApiHandler,
} from "../schwab-bridge/execution-board-handoff-api.mjs";

function candidate({ candidateId = "candidate-1", riskEvaluationId = "risk-1", dssEvaluationId = "dss-1" } = {}) {
  return {
    candidateId,
    contractVersion: 1,
    contentHash: `${candidateId}-hash`,
    source: "SOD_A_PLUS",
    symbol: candidateId === "candidate-2" ? "AMD" : "NVDA",
    direction: "LONG",
    setup: "Test setup",
    timeframe: "2m",
    thesis: "Test thesis",
    trigger: { type: "BREAKOUT" },
    targets: [102],
    managementPlan: "Manage against structure.",
    lifecycleState: "ARMED",
    authorizedDssEvaluationId: dssEvaluationId,
    authorizedRiskEvaluationId: riskEvaluationId,
    arm: {
      authorizedAt: "2026-09-02T16:00:00.000Z",
      candidateVersion: 1,
      dssEvaluationId,
      riskEvaluationId,
      selectedQuantity: 10,
    },
  };
}

function riskEvaluation({ candidateId = "candidate-1", riskEvaluationId = "risk-1", dssEvaluationId = "dss-1" } = {}) {
  const symbol = candidateId === "candidate-2" ? "AMD" : "NVDA";
  return {
    status: "VALID",
    riskEvaluationId,
    candidate: {
      candidateId,
      contractVersion: 1,
      candidateHash: `${candidateId}-hash`,
      symbol,
      direction: "LONG",
    },
    dss: {
      dssEvaluationId,
      structuralInvalidation: 99,
      effectiveStop: 98.8,
    },
    entry: { currentExpectedEntry: 100 },
    account: { accountId: "opaque-account-A" },
    calculation: { finalQuantity: 20 },
  };
}

function makeHandoff({ handoffId = "handoff-1", candidateId = "candidate-1", riskEvaluationId = "risk-1", dssEvaluationId = "dss-1" } = {}) {
  return buildExecutionBoardHandoff({
    handoffId,
    createdAt: "2026-09-02T16:00:01.000Z",
    candidate: candidate({ candidateId, riskEvaluationId, dssEvaluationId }),
    riskEvaluation: riskEvaluation({ candidateId, riskEvaluationId, dssEvaluationId }),
  });
}

function plusMs(timestamp, milliseconds) {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "executionos-handoff-api-"));
  let tick = 0;
  const base = Date.parse("2026-09-02T16:00:02.000Z");
  const clock = () => new Date(base + (tick++ * 1000)).toISOString();

  const handoffRepository = new ExecutionBoardHandoffRepository({
    filePath: path.join(dir, "handoffs.json"),
    clock,
  });
  handoffRepository.load();
  handoffRepository.record(makeHandoff());
  handoffRepository.record(makeHandoff({
    handoffId: "handoff-2",
    candidateId: "candidate-2",
    riskEvaluationId: "risk-2",
    dssEvaluationId: "dss-2",
  }));

  const deliveryRepository = new ExecutionBoardHandoffDeliveryRepository({
    handoffRepository,
    filePath: path.join(dir, "deliveries.json"),
    clock,
  });
  deliveryRepository.load();
  deliveryRepository.register("handoff-1");
  deliveryRepository.register("handoff-2");

  return { handoffRepository, deliveryRepository };
}

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
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function jsonResponse(response) {
  const payload = await response.json();
  return { response, payload };
}

test("service discovery returns PENDING plus only this receiver's CLAIMED handoffs", () => {
  const { handoffRepository, deliveryRepository } = fixture();
  const service = new ExecutionBoardHandoffApiService({ handoffRepository, deliveryRepository });

  service.claim("handoff-2", "receiver-B");
  const receiverA = service.discover("receiver-A");
  assert.deepEqual(receiverA.map((item) => item.handoff.handoffId), ["handoff-1"]);

  const receiverB = service.discover("receiver-B");
  assert.deepEqual(receiverB.map((item) => item.handoff.handoffId), ["handoff-1", "handoff-2"]);
  assert.equal(receiverB[1].delivery.status, "CLAIMED");
  assert.equal(receiverB[1].delivery.claimedBy, "receiver-B");
});

test("HTTP discovery requires receiver identity and declares no broker-write authority", async () => {
  const { handoffRepository, deliveryRepository } = fixture();
  const server = await startServer(createExecutionBoardHandoffApiHandler({ handoffRepository, deliveryRepository }));
  try {
    let result = await jsonResponse(await fetch(`${server.baseUrl}/api/handoffs`));
    assert.equal(result.response.status, 400);
    assert.equal(result.payload.code, "EXECUTION_BOARD_RECEIVER_ID_REQUIRED");

    result = await jsonResponse(await fetch(`${server.baseUrl}/api/handoffs?receiverId=receiver-A`));
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.handoffs.length, 2);
    assert.equal(result.payload.brokerWriteAuthority, false);
  } finally {
    await server.stop();
  }
});

test("HTTP claim is durable and competing receiver receives conflict", async () => {
  const { handoffRepository, deliveryRepository } = fixture();
  const server = await startServer(createExecutionBoardHandoffApiHandler({ handoffRepository, deliveryRepository }));
  try {
    const claimA = await jsonResponse(await fetch(`${server.baseUrl}/api/handoffs/handoff-1/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: "http://localhost:5173" },
      body: JSON.stringify({ receiverId: "receiver-A" }),
    }));
    assert.equal(claimA.response.status, 200);
    assert.equal(claimA.payload.delivery.status, "CLAIMED");
    assert.equal(claimA.payload.delivery.claimedBy, "receiver-A");
    assert.equal(claimA.payload.brokerWriteAuthority, false);

    const claimB = await jsonResponse(await fetch(`${server.baseUrl}/api/handoffs/handoff-1/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: "http://localhost:5173" },
      body: JSON.stringify({ receiverId: "receiver-B" }),
    }));
    assert.equal(claimB.response.status, 409);
    assert.equal(claimB.payload.code, "EXECUTION_BOARD_HANDOFF_ALREADY_CLAIMED");
  } finally {
    await server.stop();
  }
});

test("HTTP ACK freezes executionListeningAt and identical retry is idempotent", async () => {
  const { handoffRepository, deliveryRepository } = fixture();
  const server = await startServer(createExecutionBoardHandoffApiHandler({ handoffRepository, deliveryRepository }));
  try {
    const claim = await jsonResponse(await fetch(`${server.baseUrl}/api/handoffs/handoff-1/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receiverId: "receiver-A" }),
    }));
    const body = {
      receiverId: "receiver-A",
      executionListeningAt: plusMs(claim.payload.delivery.claimedAt, 1000),
    };

    const first = await jsonResponse(await fetch(`${server.baseUrl}/api/handoffs/handoff-1/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    assert.equal(first.response.status, 200);
    assert.equal(first.payload.delivery.status, "DELIVERED");
    assert.equal(first.payload.delivery.executionListeningAt, body.executionListeningAt);

    const retry = await jsonResponse(await fetch(`${server.baseUrl}/api/handoffs/handoff-1/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    assert.equal(retry.response.status, 200);
    assert.deepEqual(retry.payload.delivery, first.payload.delivery);

    const conflict = await jsonResponse(await fetch(`${server.baseUrl}/api/handoffs/handoff-1/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, executionListeningAt: plusMs(body.executionListeningAt, 1000) }),
    }));
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.payload.code, "HANDOFF_ACK_CONTENT_CONFLICT");
  } finally {
    await server.stop();
  }
});

test("HTTP block records terminal reason and delivered handoff cannot be blocked", async () => {
  const { handoffRepository, deliveryRepository } = fixture();
  const server = await startServer(createExecutionBoardHandoffApiHandler({ handoffRepository, deliveryRepository }));
  try {
    await fetch(`${server.baseUrl}/api/handoffs/handoff-1/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receiverId: "receiver-A" }),
    });
    const blocked = await jsonResponse(await fetch(`${server.baseUrl}/api/handoffs/handoff-1/block`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receiverId: "receiver-A", reason: "BROKER_EXECUTION_COVERAGE_GAP" }),
    }));
    assert.equal(blocked.response.status, 200);
    assert.equal(blocked.payload.delivery.status, "BLOCKED");
    assert.equal(blocked.payload.delivery.blockReason, "BROKER_EXECUTION_COVERAGE_GAP");

    const claim2 = await jsonResponse(await fetch(`${server.baseUrl}/api/handoffs/handoff-2/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receiverId: "receiver-A" }),
    }));
    const listeningAt = plusMs(claim2.payload.delivery.claimedAt, 1000);
    await fetch(`${server.baseUrl}/api/handoffs/handoff-2/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receiverId: "receiver-A", executionListeningAt: listeningAt }),
    });
    const terminal = await jsonResponse(await fetch(`${server.baseUrl}/api/handoffs/handoff-2/block`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receiverId: "receiver-A", reason: "BROKER_STATE_UNAVAILABLE" }),
    }));
    assert.equal(terminal.response.status, 409);
    assert.equal(terminal.payload.code, "EXECUTION_BOARD_HANDOFF_DELIVERY_TERMINAL");
  } finally {
    await server.stop();
  }
});

test("cross-origin mutation is rejected before delivery state changes", async () => {
  const { handoffRepository, deliveryRepository } = fixture();
  const server = await startServer(createExecutionBoardHandoffApiHandler({ handoffRepository, deliveryRepository }));
  try {
    const rejected = await jsonResponse(await fetch(`${server.baseUrl}/api/handoffs/handoff-1/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: "https://example.com" },
      body: JSON.stringify({ receiverId: "receiver-A" }),
    }));
    assert.equal(rejected.response.status, 403);
    assert.equal(rejected.payload.code, "ORIGIN_NOT_ALLOWED");
    assert.equal(deliveryRepository.getById("handoff-1").status, "PENDING");
  } finally {
    await server.stop();
  }
});

test("handler exposes no browser route that can create or register a handoff", async () => {
  const { handoffRepository, deliveryRepository } = fixture();
  const server = await startServer(createExecutionBoardHandoffApiHandler({ handoffRepository, deliveryRepository }));
  try {
    const response = await fetch(`${server.baseUrl}/api/handoffs/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoffId: "forged" }),
    });
    assert.equal(response.status, 404);
  } finally {
    await server.stop();
  }
});
