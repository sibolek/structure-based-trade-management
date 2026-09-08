import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";
import { PreTradeArmLifecycleAuthority } from "../schwab-bridge/pretrade-arm-lifecycle-authority.mjs";
import { PreTradeOcoRepository } from "../schwab-bridge/pretrade-oco-repository.mjs";
import { PreTradeOcoService } from "../schwab-bridge/pretrade-oco-service.mjs";
import {
  createPendingExecutionBoardHandoffDelivery,
  claimExecutionBoardHandoffDelivery,
  blockExecutionBoardHandoffDelivery,
} from "../schwab-bridge/execution-board-handoff-delivery.mjs";
import { projectPretradeWorkspace } from "../src/pretrade/pretrade-ui-projection.js";

const NOW = "2026-09-08T03:40:00.000Z";
const CLAIMED_AT = "2026-09-08T03:40:00.010Z";
const BLOCKED_AT = "2026-09-08T03:40:00.020Z";

function tempFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-blocked-retire-")), name);
}

function proposal(candidateId) {
  return {
    candidateId,
    contractVersion: 1,
    schemaVersion: 1,
    source: "SOD_A_PLUS_TRADES",
    sourceDate: "2026-09-07",
    generatedAt: "2026-09-08T03:30:00.000Z",
    symbol: "/MESU26",
    direction: "LONG",
    setup: "Acceptance breakout-pullback",
    thesis: "Synthetic acceptance candidate for blocked-handoff retirement testing",
    trigger: { type: "MANUAL_CONFIRMATION", evaluatorVersion: 1 },
    structuralInvalidation: {
      price: 7713,
      rule: "acceptance below structural stop",
      referenceType: "STRUCTURAL_STOP",
      reason: "acceptance setup invalidated",
    },
    targets: [7722, 7725],
    managementContract: { mode: "FLEXIBLE_WITHIN_CEILING" },
    validity: {
      validFrom: "2026-09-08T03:00:00.000Z",
      validUntil: "2026-09-08T05:30:00.000Z",
      timezone: "America/Denver",
      session: "GLOBEX",
    },
    armPolicy: { requestedMode: "MANUAL" },
  };
}

function buildHarness({ blocked = true } = {}) {
  let eventCounter = 0;
  const clock = () => NOW;
  const store = new PreTradeStore({ filePath: tempFile("state.json"), clock });
  store.load();
  const ingress = new PreTradeCandidateIngress({
    store,
    clock,
    idFactory: () => `ingress-event-${++eventCounter}`,
  });
  const imported = ingress.importBundle({
    source: "SOD_A_PLUS_TRADES",
    bundleId: "blocked-handoff-retirement-test",
    candidates: [proposal("mes-old"), proposal("mes-new")],
  });
  assert.equal(imported.outcomes.every((item) => item.status === "ACCEPTED"), true);

  const old = store.state.candidates.find((item) => item.candidateId === "mes-old");
  const next = store.state.candidates.find((item) => item.candidateId === "mes-new");
  old.lifecycleState = "READY";
  old.stateRevision = 3;
  old.currentDssEvaluationId = "dss-old";
  old.currentDssEvaluationStale = false;
  old.currentPermissionOutcome = { outcome: "READY", permissionEvaluationId: "permission-old" };
  next.lifecycleState = "READY";
  next.stateRevision = 3;
  store.save();

  const lifecycleCoordinator = new PreTradeLifecycleCoordinator({ store, clock });
  const armLifecycleAuthority = new PreTradeArmLifecycleAuthority({
    store,
    clock,
    idFactory: () => `arm-event-${++eventCounter}`,
  });

  const armProof = {
    authority: "PRETRADE_ARM_OPERATION",
    status: "AUTHORIZED",
    operationId: "arm-old",
    candidateId: "mes-old",
    contractVersion: 1,
    candidateContentHash: old.contentHash,
    symbol: "/MESU26",
    direction: "LONG",
    reviewPackageId: "review-old",
    permissionAttemptId: "permission-old",
    permissionState: "READY",
    permissionStateRevision: 3,
    dssEvaluationId: "dss-old",
    riskEvaluationId: "risk-old",
    accountId: "acct-1",
    selectedQuantity: 1,
    authorizedAt: NOW,
    handoffId: "handoff-old",
  };
  armLifecycleAuthority.authorizeFromCommit({
    operationId: "arm-old:CANDIDATE_ARM",
    candidateId: "mes-old",
    contractVersion: 1,
    expectedState: "READY",
    expectedRevision: 3,
    armCommit: armProof,
  });

  const pending = createPendingExecutionBoardHandoffDelivery({ handoffId: "handoff-old", createdAt: NOW });
  const claimed = claimExecutionBoardHandoffDelivery(pending, {
    receiverId: "exec-router-1",
    claimedAt: CLAIMED_AT,
  });
  const delivery = blocked
    ? blockExecutionBoardHandoffDelivery(claimed, {
        receiverId: "exec-router-1",
        reason: "BROKER_EXECUTION_COVERAGE_GAP",
        blockedAt: BLOCKED_AT,
      })
    : claimed;

  const deliveryRepository = {
    getById(handoffId) {
      if (handoffId === "handoff-old") return structuredClone(delivery);
      const error = new Error("delivery not found");
      error.code = "EXECUTION_BOARD_HANDOFF_DELIVERY_NOT_FOUND";
      throw error;
    },
  };

  const ocoRepository = new PreTradeOcoRepository({ filePath: tempFile("oco.json"), clock });
  ocoRepository.load();
  const ocoService = new PreTradeOcoService({
    lifecycleCoordinator,
    ocoRepository,
    armLifecycleAuthority,
    deliveryRepository,
    executionOwnershipProvider: {
      async checkSymbol() {
        return { status: "FREE", source: "TEST" };
      },
    },
  });

  return { lifecycleCoordinator, ocoService };
}

test("terminal BLOCKED handoff retires stale ARMED authority before same-symbol ARM gate", async () => {
  const h = buildHarness({ blocked: true });

  const gate = await h.ocoService.armGate({
    candidateId: "mes-new",
    contractVersion: 1,
    review: null,
  });

  assert.equal(gate.allowed, true);
  assert.equal(gate.reasonCode, null);
  assert.equal(gate.executionOwnership.status, "FREE");

  const retired = h.lifecycleCoordinator.candidateSnapshot("mes-old", 1);
  assert.equal(retired.lifecycleState, "RETIRED");
  assert.equal(retired.arm.handoffId, "handoff-old");
  assert.equal(retired.armRetirement.handoffId, "handoff-old");
  assert.equal(retired.armRetirement.blockReason, "BROKER_EXECUTION_COVERAGE_GAP");
  assert.equal(retired.terminalOutcome.reasonCode, "EXECUTION_HANDOFF_BLOCKED_BEFORE_LISTENING");
  assert.equal(retired.lifecycleJournal.events.at(-1).eventType, "ARM_RETIRED_AFTER_BLOCKED_HANDOFF");

  const projection = projectPretradeWorkspace({
    ...h.lifecycleCoordinator.snapshot(),
    reviews: [],
    ocoGroups: [],
  });
  assert.equal(projection.history.some((item) => item.candidate.candidateId === "mes-old"), true);
  assert.equal(projection.authorizedExecution.some((item) => item.candidate.candidateId === "mes-old"), false);
});

test("CLAIMED handoff remains ARMED and continues to block a same-symbol ARM", async () => {
  const h = buildHarness({ blocked: false });

  const gate = await h.ocoService.armGate({
    candidateId: "mes-new",
    contractVersion: 1,
    review: null,
  });

  assert.equal(gate.allowed, false);
  assert.equal(gate.reasonCode, "SAME_SYMBOL_PRETRADE_CONFLICT");
  assert.equal(gate.conflicts.length, 1);
  assert.equal(gate.conflicts[0].candidateId, "mes-old");
  assert.equal(gate.conflicts[0].lifecycleState, "ARMED");
  assert.equal(h.lifecycleCoordinator.candidateSnapshot("mes-old", 1).lifecycleState, "ARMED");
});
