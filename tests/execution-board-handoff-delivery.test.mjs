import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildExecutionBoardHandoff } from "../schwab-bridge/execution-board-handoff.mjs";
import { ExecutionBoardHandoffRepository } from "../schwab-bridge/execution-board-handoff-repository.mjs";
import {
  blockExecutionBoardHandoffDelivery,
  claimExecutionBoardHandoffDelivery,
  createPendingExecutionBoardHandoffDelivery,
  deliverExecutionBoardHandoffDelivery,
  validateExecutionBoardHandoffDeliveryContract,
} from "../schwab-bridge/execution-board-handoff-delivery.mjs";
import {
  ExecutionBoardHandoffDeliveryRepository,
} from "../schwab-bridge/execution-board-handoff-delivery-repository.mjs";

function candidate() {
  return {
    candidateId: "sod-2026-09-02-NVDA-1",
    contractVersion: 3,
    contentHash: "candidate-hash-3",
    source: "SOD_A_PLUS",
    symbol: "NVDA",
    direction: "LONG",
    setup: "Liquidity sweep reclaim continuation",
    timeframe: "2m",
    thesis: "Sweep structural support and reclaim for continuation.",
    trigger: { type: "RECLAIM_AND_HOLD", level: 225.55 },
    targets: [226.5, 227.2],
    managementPlan: "Manage against structure.",
    lifecycleState: "ARMED",
    authorizedDssEvaluationId: "dss-003",
    authorizedRiskEvaluationId: "risk-003",
    arm: {
      authorizedAt: "2026-09-02T14:00:00.000Z",
      candidateVersion: 3,
      dssEvaluationId: "dss-003",
      riskEvaluationId: "risk-003",
      selectedQuantity: 20,
    },
  };
}

function riskEvaluation() {
  return {
    status: "VALID",
    riskEvaluationId: "risk-003",
    candidate: {
      candidateId: "sod-2026-09-02-NVDA-1",
      contractVersion: 3,
      candidateHash: "candidate-hash-3",
      symbol: "NVDA",
      direction: "LONG",
    },
    dss: {
      dssEvaluationId: "dss-003",
      structuralInvalidation: 224.8,
      effectiveStop: 224.64,
    },
    entry: { currentExpectedEntry: 225.6 },
    account: { accountId: "opaque-account-A" },
    calculation: { finalQuantity: 30 },
  };
}

function makeHandoff(handoffId = "handoff-003") {
  return buildExecutionBoardHandoff({
    handoffId,
    createdAt: "2026-09-02T14:00:01.000Z",
    candidate: candidate(),
    riskEvaluation: riskEvaluation(),
  });
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "executionos-handoff-delivery-"));
}

function repositories() {
  const dir = tempDir();
  const handoffRepository = new ExecutionBoardHandoffRepository({
    filePath: path.join(dir, "handoffs.json"),
    clock: () => "2026-09-02T14:00:02.000Z",
  });
  handoffRepository.load();
  handoffRepository.record(makeHandoff());

  const deliveryRepository = new ExecutionBoardHandoffDeliveryRepository({
    handoffRepository,
    filePath: path.join(dir, "deliveries.json"),
    clock: () => "2026-09-02T14:00:03.000Z",
  });
  deliveryRepository.load();
  return { dir, handoffRepository, deliveryRepository };
}

test("creates immutable PENDING delivery with no receiver or listening ownership", () => {
  const delivery = createPendingExecutionBoardHandoffDelivery({
    handoffId: "handoff-003",
    createdAt: "2026-09-02T14:00:02.000Z",
  });
  assert.equal(delivery.status, "PENDING");
  assert.equal(delivery.claimedBy, null);
  assert.equal(delivery.executionListeningAt, null);
  assert.ok(Object.isFrozen(delivery));
  assert.deepEqual(validateExecutionBoardHandoffDeliveryContract(delivery), {
    valid: true,
    errors: Object.freeze([]),
  });
});

test("atomic claim freezes one stable receiver without starting broker-fill ownership", () => {
  const pending = createPendingExecutionBoardHandoffDelivery({
    handoffId: "handoff-003",
    createdAt: "2026-09-02T14:00:02.000Z",
  });
  const claimed = claimExecutionBoardHandoffDelivery(pending, {
    receiverId: "receiver-A",
    claimedAt: "2026-09-02T14:00:03.000Z",
  });
  assert.equal(claimed.status, "CLAIMED");
  assert.equal(claimed.claimedBy, "receiver-A");
  assert.equal(claimed.executionListeningAt, null);
  assert.equal(claimed.deliveredAt, null);
});

test("same receiver claim retry is idempotent and preserves original claimedAt", () => {
  const pending = createPendingExecutionBoardHandoffDelivery({
    handoffId: "handoff-003",
    createdAt: "2026-09-02T14:00:02.000Z",
  });
  const first = claimExecutionBoardHandoffDelivery(pending, {
    receiverId: "receiver-A",
    claimedAt: "2026-09-02T14:00:03.000Z",
  });
  const retry = claimExecutionBoardHandoffDelivery(first, {
    receiverId: "receiver-A",
    claimedAt: "2026-09-02T14:05:00.000Z",
  });
  assert.deepEqual(retry, first);
  assert.equal(retry.claimedAt, "2026-09-02T14:00:03.000Z");
});

test("different receiver can never steal an existing claim", () => {
  const pending = createPendingExecutionBoardHandoffDelivery({ handoffId: "handoff-003", createdAt: "2026-09-02T14:00:02.000Z" });
  const claimed = claimExecutionBoardHandoffDelivery(pending, { receiverId: "receiver-A", claimedAt: "2026-09-02T14:00:03.000Z" });
  assert.throws(
    () => claimExecutionBoardHandoffDelivery(claimed, { receiverId: "receiver-B", claimedAt: "2026-09-02T14:00:04.000Z" }),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_ALREADY_CLAIMED",
  );
});

test("delivery requires the exact claiming receiver and freezes executionListeningAt", () => {
  const pending = createPendingExecutionBoardHandoffDelivery({ handoffId: "handoff-003", createdAt: "2026-09-02T14:00:02.000Z" });
  const claimed = claimExecutionBoardHandoffDelivery(pending, { receiverId: "receiver-A", claimedAt: "2026-09-02T14:00:03.000Z" });
  const delivered = deliverExecutionBoardHandoffDelivery(claimed, {
    receiverId: "receiver-A",
    executionListeningAt: "2026-09-02T14:00:04.000Z",
    deliveredAt: "2026-09-02T14:00:05.000Z",
  });
  assert.equal(delivered.status, "DELIVERED");
  assert.equal(delivered.claimedBy, "receiver-A");
  assert.equal(delivered.executionListeningAt, "2026-09-02T14:00:04.000Z");
  assert.equal(delivered.deliveredAt, "2026-09-02T14:00:05.000Z");
});

test("delivery cannot occur before a claim", () => {
  const pending = createPendingExecutionBoardHandoffDelivery({ handoffId: "handoff-003", createdAt: "2026-09-02T14:00:02.000Z" });
  assert.throws(
    () => deliverExecutionBoardHandoffDelivery(pending, {
      receiverId: "receiver-A",
      executionListeningAt: "2026-09-02T14:00:04.000Z",
      deliveredAt: "2026-09-02T14:00:05.000Z",
    }),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_NOT_CLAIMED",
  );
});

test("non-owner receiver cannot acknowledge a claim", () => {
  const pending = createPendingExecutionBoardHandoffDelivery({ handoffId: "handoff-003", createdAt: "2026-09-02T14:00:02.000Z" });
  const claimed = claimExecutionBoardHandoffDelivery(pending, { receiverId: "receiver-A", claimedAt: "2026-09-02T14:00:03.000Z" });
  assert.throws(
    () => deliverExecutionBoardHandoffDelivery(claimed, {
      receiverId: "receiver-B",
      executionListeningAt: "2026-09-02T14:00:04.000Z",
      deliveredAt: "2026-09-02T14:00:05.000Z",
    }),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_CLAIM_RECEIVER_MISMATCH",
  );
});

test("identical ACK retry is idempotent but conflicting listening provenance fails closed", () => {
  const pending = createPendingExecutionBoardHandoffDelivery({ handoffId: "handoff-003", createdAt: "2026-09-02T14:00:02.000Z" });
  const claimed = claimExecutionBoardHandoffDelivery(pending, { receiverId: "receiver-A", claimedAt: "2026-09-02T14:00:03.000Z" });
  const delivered = deliverExecutionBoardHandoffDelivery(claimed, {
    receiverId: "receiver-A",
    executionListeningAt: "2026-09-02T14:00:04.000Z",
    deliveredAt: "2026-09-02T14:00:05.000Z",
  });
  const retry = deliverExecutionBoardHandoffDelivery(delivered, {
    receiverId: "receiver-A",
    executionListeningAt: "2026-09-02T14:00:04.000Z",
    deliveredAt: "2026-09-02T14:10:00.000Z",
  });
  assert.deepEqual(retry, delivered);
  assert.throws(
    () => deliverExecutionBoardHandoffDelivery(delivered, {
      receiverId: "receiver-A",
      executionListeningAt: "2026-09-02T14:00:04.500Z",
      deliveredAt: "2026-09-02T14:10:00.000Z",
    }),
    (error) => error.code === "HANDOFF_ACK_CONTENT_CONFLICT",
  );
});

test("CLAIMED handoff can fail closed into terminal BLOCKED", () => {
  const pending = createPendingExecutionBoardHandoffDelivery({ handoffId: "handoff-003", createdAt: "2026-09-02T14:00:02.000Z" });
  const claimed = claimExecutionBoardHandoffDelivery(pending, { receiverId: "receiver-A", claimedAt: "2026-09-02T14:00:03.000Z" });
  const blocked = blockExecutionBoardHandoffDelivery(claimed, {
    receiverId: "receiver-A",
    reason: "broker_execution_coverage_gap",
    blockedAt: "2026-09-02T14:00:04.000Z",
  });
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.blockReason, "BROKER_EXECUTION_COVERAGE_GAP");
  assert.equal(blocked.executionListeningAt, null);
});

test("BLOCKED and DELIVERED are terminal and cannot cross into the other terminal state", () => {
  const pending = createPendingExecutionBoardHandoffDelivery({ handoffId: "handoff-003", createdAt: "2026-09-02T14:00:02.000Z" });
  const claimed = claimExecutionBoardHandoffDelivery(pending, { receiverId: "receiver-A", claimedAt: "2026-09-02T14:00:03.000Z" });
  const blocked = blockExecutionBoardHandoffDelivery(claimed, { receiverId: "receiver-A", reason: "BROKER_STATE_UNAVAILABLE", blockedAt: "2026-09-02T14:00:04.000Z" });
  assert.throws(
    () => deliverExecutionBoardHandoffDelivery(blocked, { receiverId: "receiver-A", executionListeningAt: "2026-09-02T14:00:05.000Z", deliveredAt: "2026-09-02T14:00:06.000Z" }),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_DELIVERY_TERMINAL",
  );

  const delivered = deliverExecutionBoardHandoffDelivery(claimed, { receiverId: "receiver-A", executionListeningAt: "2026-09-02T14:00:05.000Z", deliveredAt: "2026-09-02T14:00:06.000Z" });
  assert.throws(
    () => blockExecutionBoardHandoffDelivery(delivered, { receiverId: "receiver-A", reason: "BROKER_STATE_UNAVAILABLE", blockedAt: "2026-09-02T14:00:07.000Z" }),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_DELIVERY_TERMINAL",
  );
});

test("contract rejects listening ownership before claim time", () => {
  const invalid = {
    ...createPendingExecutionBoardHandoffDelivery({ handoffId: "handoff-003", createdAt: "2026-09-02T14:00:02.000Z" }),
    status: "DELIVERED",
    claimedBy: "receiver-A",
    claimedAt: "2026-09-02T14:00:05.000Z",
    executionListeningAt: "2026-09-02T14:00:04.000Z",
    deliveredAt: "2026-09-02T14:00:06.000Z",
  };
  const contract = validateExecutionBoardHandoffDeliveryContract(invalid);
  assert.equal(contract.valid, false);
  assert.ok(contract.errors.includes("executionListeningAt cannot precede claimedAt"));
});

test("repository registers exactly one PENDING delivery for a known immutable handoff", () => {
  const { deliveryRepository } = repositories();
  const first = deliveryRepository.register("handoff-003");
  const second = deliveryRepository.register("handoff-003");
  assert.equal(first.status, "PENDING");
  assert.deepEqual(second, first);
  assert.equal(deliveryRepository.snapshot().deliveries.length, 1);
});

test("repository refuses an orphan delivery with no immutable handoff", () => {
  const { deliveryRepository } = repositories();
  assert.throws(
    () => deliveryRepository.register("handoff-missing"),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_DELIVERY_ORPHANED",
  );
});

test("repository claim is durable, same-receiver idempotent, and rejects a second receiver", () => {
  const { deliveryRepository } = repositories();
  deliveryRepository.register("handoff-003");
  const claimed = deliveryRepository.claim("handoff-003", "receiver-A");
  assert.equal(claimed.status, "CLAIMED");
  assert.equal(claimed.claimedBy, "receiver-A");
  assert.deepEqual(deliveryRepository.claim("handoff-003", "receiver-A"), claimed);
  assert.throws(
    () => deliveryRepository.claim("handoff-003", "receiver-B"),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_ALREADY_CLAIMED",
  );
});

test("repository DELIVERED state survives restart with exact listening provenance", () => {
  const { dir, handoffRepository, deliveryRepository } = repositories();
  deliveryRepository.register("handoff-003");
  deliveryRepository.claim("handoff-003", "receiver-A");
  const delivered = deliveryRepository.deliver("handoff-003", {
    receiverId: "receiver-A",
    executionListeningAt: "2026-09-02T14:00:03.000Z",
  });
  assert.equal(delivered.status, "DELIVERED");

  const reloaded = new ExecutionBoardHandoffDeliveryRepository({
    handoffRepository,
    filePath: path.join(dir, "deliveries.json"),
    clock: () => "2026-09-02T14:00:04.000Z",
  });
  reloaded.load();
  const stored = reloaded.getById("handoff-003");
  assert.equal(stored.status, "DELIVERED");
  assert.equal(stored.claimedBy, "receiver-A");
  assert.equal(stored.executionListeningAt, "2026-09-02T14:00:03.000Z");
});

test("repository rolls back a claim when durable persistence fails", () => {
  const { deliveryRepository } = repositories();
  deliveryRepository.register("handoff-003");
  deliveryRepository.save = () => {
    throw new Error("disk unavailable");
  };
  assert.throws(
    () => deliveryRepository.claim("handoff-003", "receiver-A"),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_DELIVERY_PERSISTENCE_ERROR",
  );
  assert.equal(deliveryRepository.getById("handoff-003").status, "PENDING");
});

test("repository detects corrupt or orphaned persisted delivery state on restart", () => {
  const { dir, handoffRepository } = repositories();
  const filePath = path.join(dir, "corrupt-deliveries.json");
  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 1,
    updatedAt: "2026-09-02T14:00:03.000Z",
    deliveries: [{
      schemaVersion: 1,
      handoffId: "handoff-003",
      status: "DELIVERED",
      createdAt: "2026-09-02T14:00:02.000Z",
      claimedBy: "receiver-A",
      claimedAt: "2026-09-02T14:00:03.000Z",
      executionListeningAt: null,
      deliveredAt: "2026-09-02T14:00:04.000Z",
      blockedAt: null,
      blockReason: null,
    }],
  }), "utf8");

  const repository = new ExecutionBoardHandoffDeliveryRepository({ handoffRepository, filePath });
  assert.throws(
    () => repository.load(),
    (error) => error.code === "CORRUPT_EXECUTION_BOARD_HANDOFF_DELIVERY_REPOSITORY",
  );
});
