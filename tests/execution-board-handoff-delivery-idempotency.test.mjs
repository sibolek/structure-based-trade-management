import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildExecutionBoardHandoff } from "../schwab-bridge/execution-board-handoff.mjs";
import { ExecutionBoardHandoffRepository } from "../schwab-bridge/execution-board-handoff-repository.mjs";
import { ExecutionBoardHandoffDeliveryRepository } from "../schwab-bridge/execution-board-handoff-delivery-repository.mjs";

function handoff() {
  return buildExecutionBoardHandoff({
    handoffId: "handoff-idempotency",
    createdAt: "2026-09-02T17:00:01.000Z",
    candidate: {
      candidateId: "candidate-idempotency",
      contractVersion: 1,
      contentHash: "candidate-idempotency-hash",
      source: "SOD_A_PLUS",
      symbol: "NVDA",
      direction: "LONG",
      setup: "Test",
      timeframe: "2m",
      thesis: "Test",
      trigger: { type: "BREAKOUT" },
      targets: [102],
      managementPlan: null,
      lifecycleState: "ARMED",
      authorizedDssEvaluationId: "dss-idempotency",
      authorizedRiskEvaluationId: "risk-idempotency",
      arm: {
        authorizedAt: "2026-09-02T17:00:00.000Z",
        candidateVersion: 1,
        dssEvaluationId: "dss-idempotency",
        riskEvaluationId: "risk-idempotency",
        selectedQuantity: 10,
      },
    },
    riskEvaluation: {
      status: "VALID",
      riskEvaluationId: "risk-idempotency",
      candidate: {
        candidateId: "candidate-idempotency",
        contractVersion: 1,
        candidateHash: "candidate-idempotency-hash",
        symbol: "NVDA",
        direction: "LONG",
      },
      dss: {
        dssEvaluationId: "dss-idempotency",
        structuralInvalidation: 99,
        effectiveStop: 98.8,
      },
      entry: { currentExpectedEntry: 100 },
      account: { accountId: "opaque-account-A" },
      calculation: { finalQuantity: 20 },
    },
  });
}

function repositories() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "executionos-handoff-idempotency-"));
  const handoffRepository = new ExecutionBoardHandoffRepository({
    filePath: path.join(dir, "handoffs.json"),
    clock: () => "2026-09-02T17:00:02.000Z",
  });
  handoffRepository.load();
  handoffRepository.record(handoff());

  let clockValue = "2026-09-02T17:00:03.000Z";
  const deliveryRepository = new ExecutionBoardHandoffDeliveryRepository({
    handoffRepository,
    filePath: path.join(dir, "deliveries.json"),
    clock: () => clockValue,
  });
  deliveryRepository.load();
  deliveryRepository.register("handoff-idempotency");

  return {
    deliveryRepository,
    setClock(value) {
      clockValue = value;
    },
  };
}

test("same-receiver claim retry does not consult a broken repository clock", () => {
  const { deliveryRepository, setClock } = repositories();
  const first = deliveryRepository.claim("handoff-idempotency", "receiver-A");
  setClock("not-a-time");
  const retry = deliveryRepository.claim("handoff-idempotency", "receiver-A");
  assert.deepEqual(retry, first);
});

test("identical delivered ACK retry does not consult a broken repository clock", () => {
  const { deliveryRepository, setClock } = repositories();
  const claimed = deliveryRepository.claim("handoff-idempotency", "receiver-A");
  const listeningAt = new Date(Date.parse(claimed.claimedAt) + 1000).toISOString();
  const delivered = deliveryRepository.deliver("handoff-idempotency", {
    receiverId: "receiver-A",
    executionListeningAt: listeningAt,
  });
  setClock("not-a-time");
  const retry = deliveryRepository.deliver("handoff-idempotency", {
    receiverId: "receiver-A",
    executionListeningAt: listeningAt,
  });
  assert.deepEqual(retry, delivered);
});

test("identical terminal block retry does not consult a broken repository clock", () => {
  const { deliveryRepository, setClock } = repositories();
  deliveryRepository.claim("handoff-idempotency", "receiver-A");
  const blocked = deliveryRepository.block("handoff-idempotency", {
    receiverId: "receiver-A",
    reason: "BROKER_STATE_UNAVAILABLE",
  });
  setClock("not-a-time");
  const retry = deliveryRepository.block("handoff-idempotency", {
    receiverId: "receiver-A",
    reason: "BROKER_STATE_UNAVAILABLE",
  });
  assert.deepEqual(retry, blocked);
});
