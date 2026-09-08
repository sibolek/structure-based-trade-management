import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";
import { buildPermissionAttempt } from "../schwab-bridge/pretrade-permission-attempt.mjs";
import { PreTradePermissionAttemptRepository } from "../schwab-bridge/pretrade-permission-attempt-repository.mjs";
import { PreTradeReviewRepository } from "../schwab-bridge/pretrade-review-repository.mjs";
import { PreTradeReviewService } from "../schwab-bridge/pretrade-review-service.mjs";
import { PreTradeOcoRepository } from "../schwab-bridge/pretrade-oco-repository.mjs";
import { PreTradeOcoService } from "../schwab-bridge/pretrade-oco-service.mjs";
import { PreTradeArmOperationRepository } from "../schwab-bridge/pretrade-arm-operation-repository.mjs";
import { PreTradeArmLifecycleAuthority } from "../schwab-bridge/pretrade-arm-lifecycle-authority.mjs";
import { PreTradeArmService } from "../schwab-bridge/pretrade-arm-service.mjs";
import { ExecutionBoardHandoffRepository } from "../schwab-bridge/execution-board-handoff-repository.mjs";
import { ExecutionBoardHandoffDeliveryRepository } from "../schwab-bridge/execution-board-handoff-delivery-repository.mjs";

const NOW = "2026-09-06T15:00:01.000Z";

function tmp(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `executionos-${name}-`)), `${name}.json`);
}

function proposal() {
  return {
    candidateId: "arm-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "SOD_A_PLUS_TRADES",
    sourceDate: "2026-09-06",
    generatedAt: "2026-09-06T13:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "Breakout retest",
    timeframe: "2m",
    thesis: "Continuation if retest holds",
    trigger: { type: "MANUAL_CONFIRMATION", evaluatorVersion: 1 },
    structuralInvalidation: { price: 179.5, rule: "break below retest", referenceType: "SWING_LOW", reason: "thesis fails" },
    targets: [181, 182],
    managementContract: { mode: "FLEXIBLE_WITHIN_CEILING" },
    validity: { validFrom: "2026-09-06T14:00:00.000Z", validUntil: "2026-09-06T20:00:00.000Z", timezone: "America/New_York", session: "RTH" },
    armPolicy: { requestedMode: "MANUAL" },
  };
}

function risk(candidate, { id, dssId, expectedEntry = 180, quantity = 90 } = {}) {
  return {
    riskEvaluationId: id,
    status: "VALID",
    candidate: {
      sourceId: candidate.source,
      candidateId: candidate.candidateId,
      contractVersion: candidate.contractVersion,
      candidateHash: candidate.contentHash,
      symbol: candidate.symbol,
      direction: candidate.direction,
    },
    dss: {
      dssEvaluationId: dssId,
      structuralInvalidation: 179.5,
      effectiveStop: 179.25,
    },
    entry: {
      entryMode: "MARKETABLE_NOW",
      currentExpectedEntry: expectedEntry,
      bid: expectedEntry - 0.01,
      ask: expectedEntry,
      quoteObservedAt: "2026-09-06T15:00:00.500Z",
      quoteAgeMs: 500,
      quoteSource: "SCHWAB",
      expectedEntryRule: "ASK_MARKETABLE_LONG",
    },
    account: {
      accountId: "acct-1",
      accountEquity: 13500,
      accountCurrency: "USD",
      snapshotObservedAt: "2026-09-06T15:00:00.000Z",
      snapshotAgeMs: 1000,
      snapshotSource: "SCHWAB",
      sourceSnapshotId: `account-${id}`,
      maxDollarRisk: 67.5,
      riskFraction: 0.005,
    },
    instrument: {
      assetType: "EQUITY",
      symbol: "NVDA",
      instrumentCurrency: "USD",
      minimumQuantity: 1,
      quantityIncrement: 1,
    },
    calculation: {
      finalQuantity: quantity,
      plannedDollarRisk: 67.5,
      plannedRiskFraction: 0.005,
    },
  };
}

function decision(candidate, id, outcome = "READY") {
  return {
    authority: "PRETRADE_PERMISSION_DECISION",
    permissionDecisionId: `decision-${id}`,
    candidateId: candidate.candidateId,
    contractVersion: candidate.contractVersion,
    candidateContentHash: candidate.contentHash,
    kind: "OUTCOME",
    outcome,
    reasonCode: null,
    reasonCodes: [],
  };
}

function permissionAttempt(candidate, riskEvaluation, id, stateRevision) {
  return buildPermissionAttempt({
    permissionAttemptId: id,
    operationId: `permission-op-${id}`,
    operationHash: `hash-${id}`,
    candidate: { ...candidate, stateRevision },
    triggerSatisfaction: { authority: "PRETRADE_TRIGGER_ENGINE", evidenceId: "trigger-1", evidenceTimestamp: "2026-09-06T14:59:00.000Z" },
    structuralValidity: { authority: "PRETRADE_STRUCTURAL_VALIDITY", structuralEvaluationId: `structure-${id}`, status: "VALID", resolvedPrice: 179.5 },
    dssResult: { action: "EVALUATED", status: "VALID", dssEvaluationId: riskEvaluation.dss.dssEvaluationId, evaluation: { dssEvaluationId: riskEvaluation.dss.dssEvaluationId, status: "VALID", effectiveStop: 179.25 } },
    riskEvaluation,
    permissionDecision: decision(candidate, id),
    result: { kind: "OUTCOME", outcome: "READY", reasonCodes: [] },
    startedAt: "2026-09-06T15:00:00.000Z",
    completedAt: "2026-09-06T15:00:00.100Z",
  });
}

function harness({ expectedEntryChange = false, quantityChange = false, freshQuantity = null, ownershipStatus = "FREE" } = {}) {
  const clock = () => NOW;
  const store = new PreTradeStore({ filePath: tmp("arm-state"), clock });
  store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock, idFactory: () => "ingress-1" });
  ingress.importBundle({ source: "SOD_A_PLUS_TRADES", bundleId: "arm-bundle", candidates: [proposal()] });
  const persisted = store.state.candidates[0];
  persisted.lifecycleState = "READY";
  persisted.stateRevision = 3;
  persisted.triggerSatisfaction = { authority: "PRETRADE_TRIGGER_ENGINE", evidenceId: "trigger-1", evidenceTimestamp: "2026-09-06T14:59:00.000Z" };
  persisted.permissionEvaluationStatus = "COMPLETE";
  persisted.currentDssEvaluationId = "dss-1";
  persisted.currentDssEvaluationStale = false;
  persisted.currentPermissionOutcome = { outcome: "READY", permissionEvaluationId: "permission-1", publishedAt: "2026-09-06T15:00:00.100Z" };
  store.save();

  const coordinator = new PreTradeLifecycleCoordinator({ store, clock, idFactory: (() => { let i = 0; return () => `life-${++i}`; })() });
  const attemptRepository = new PreTradePermissionAttemptRepository({ filePath: tmp("permission-attempts"), clock });
  attemptRepository.load();
  const riskMap = new Map();
  const initialCandidate = coordinator.candidateSnapshot("arm-NVDA-1", 1);
  const risk1 = risk(initialCandidate, { id: "risk-1", dssId: "dss-1" });
  riskMap.set("risk-1", risk1);
  attemptRepository.record(permissionAttempt(initialCandidate, risk1, "permission-1", 2));

  const reviewRepository = new PreTradeReviewRepository({ filePath: tmp("reviews"), clock });
  reviewRepository.load();
  const reviewService = new PreTradeReviewService({ lifecycleCoordinator: coordinator, permissionAttemptRepository: attemptRepository, reviewRepository, clock });
  const initialReview = reviewService.refresh({ operationId: "initial-review", candidateId: "arm-NVDA-1", contractVersion: 1 }).review;
  reviewService.selectQuantity({ operationId: "initial-quantity", candidateId: "arm-NVDA-1", contractVersion: 1, reviewPackageId: initialReview.currentPackage.reviewPackageId, selectedQuantity: 25 });

  let permissionCalls = 0;
  let lastPermissionCommand = null;
  const permissionPipeline = {
    async evaluate(command) {
      const { candidateId, contractVersion, operationId, expectedRevision, operatorPermissionAssessment } = command;
      permissionCalls += 1;
      lastPermissionCommand = structuredClone(command);
      assert.equal(operatorPermissionAssessment?.outcome, "READY");
      const candidate = coordinator.candidateSnapshot(candidateId, contractVersion);
      assert.equal(candidate.lifecycleState, "PERMISSION_EVALUATING");
      assert.equal(candidate.stateRevision, expectedRevision);
      const risk2 = risk(candidate, {
        id: "risk-2",
        dssId: "dss-2",
        expectedEntry: expectedEntryChange ? 180.01 : 180,
        quantity: freshQuantity ?? (quantityChange ? 24 : 90),
      });
      riskMap.set("risk-2", risk2);
      const attempt2 = permissionAttempt(candidate, risk2, "permission-2", expectedRevision);
      attemptRepository.record(attempt2);
      const mutable = store.state.candidates[0];
      mutable.currentDssEvaluationId = "dss-2";
      mutable.currentDssEvaluationStale = false;
      store.save();
      const transition = coordinator.publishPermissionOutcome({
        operationId: `${operationId}:OUTCOME`,
        candidateId,
        contractVersion,
        expectedState: "PERMISSION_EVALUATING",
        expectedRevision,
        outcome: "READY",
        permissionEvaluationId: "permission-2",
        source: "PRETRADE_PERMISSION_PIPELINE",
        provenance: { permissionAttemptId: "permission-2", riskEvaluationId: "risk-2" },
      });
      return { status: "COMPLETED", permissionAttempt: attempt2, transition };
    },
  };

  const riskEvaluationRepository = { getById(id) { const found = riskMap.get(id); if (!found) { const error = new Error("missing risk"); error.code = "RISK_EVALUATION_NOT_FOUND"; throw error; } return structuredClone(found); } };
  const armOperationRepository = new PreTradeArmOperationRepository({ filePath: tmp("arm-ops"), clock });
  armOperationRepository.load();
  const armLifecycleAuthority = new PreTradeArmLifecycleAuthority({ store, clock, idFactory: (() => { let i = 0; return () => `arm-life-${++i}`; })() });
  const ocoRepository = new PreTradeOcoRepository({ filePath: tmp("oco"), clock });
  ocoRepository.load();
  const ocoService = new PreTradeOcoService({
    lifecycleCoordinator: coordinator,
    ocoRepository,
    armLifecycleAuthority,
    executionOwnershipProvider: { async checkSymbol(symbol) { return { status: ownershipStatus, symbol, source: "TEST_EXECUTION_OWNERSHIP", revision: 9, authoritative: true }; } },
  });
  const handoffRepository = new ExecutionBoardHandoffRepository({ filePath: tmp("handoffs"), clock });
  handoffRepository.load();
  const deliveryRepository = new ExecutionBoardHandoffDeliveryRepository({ handoffRepository, filePath: tmp("deliveries"), clock });
  deliveryRepository.load();
  const armService = new PreTradeArmService({
    lifecycleCoordinator: coordinator,
    permissionPipeline,
    reviewService,
    reviewRepository,
    permissionAttemptRepository: attemptRepository,
    riskEvaluationRepository,
    armOperationRepository,
    armLifecycleAuthority,
    handoffRepository,
    deliveryRepository,
    ocoService,
    clock,
  });
  return {
    coordinator,
    store,
    reviewService,
    reviewRepository,
    armOperationRepository,
    handoffRepository,
    deliveryRepository,
    armService,
    initialReview,
    permissionCalls: () => permissionCalls,
    lastPermissionCommand: () => structuredClone(lastPermissionCommand),
  };
}

function command(h) {
  return {
    operationId: "arm-op-1",
    candidateId: "arm-NVDA-1",
    contractVersion: 1,
    reviewPackageId: h.initialReview.currentPackage.reviewPackageId,
    selectedQuantity: 25,
    confirmedDirection: "LONG",
    accountId: "acct-1",
    entryMode: "MARKETABLE_NOW",
    operatorStructuralAssessment: { status: "VALID", actor: "OPERATOR", evidenceReference: "chart-now" },
    operatorPermissionAssessment: { outcome: "READY", actor: "OPERATOR", evidenceReference: "context-now" },
  };
}

function durableRequestFromCommand(value) {
  return {
    candidateId: value.candidateId,
    contractVersion: value.contractVersion,
    reviewPackageId: value.reviewPackageId,
    selectedQuantity: value.selectedQuantity,
    confirmedDirection: value.confirmedDirection,
    accountId: value.accountId,
    entryMode: value.entryMode,
    triggerPrice: value.triggerPrice ?? null,
    operatorStructuralAssessment: value.operatorStructuralAssessment ?? null,
    operatorPermissionAssessment: value.operatorPermissionAssessment ?? null,
  };
}

test("explicit ARM performs fresh permission revalidation then atomically forward-completes ARMED handoff and PENDING delivery", async () => {
  const h = harness();
  const result = await h.armService.arm(command(h));
  assert.equal(result.status, "COMPLETED");
  assert.equal(h.permissionCalls(), 1);
  assert.equal(h.lastPermissionCommand().operatorPermissionAssessment.outcome, "READY");
  assert.equal(result.candidate.lifecycleState, "ARMED");
  assert.equal(result.candidate.arm.selectedQuantity, 25);
  assert.equal(result.handoff.authorizedExecutionAccountId, "acct-1");
  assert.equal(result.delivery.status, "PENDING");
  assert.equal(h.armOperationRepository.getByOperationId("arm-op-1").status, "COMPLETED");
  assert.equal(h.handoffRepository.snapshot().handoffs.length, 1);
  assert.equal(h.deliveryRepository.snapshot().deliveries.length, 1);
});

test("marketable quote drift with unchanged fresh risk ceiling completes ARM without a review loop", async () => {
  const h = harness({ expectedEntryChange: true });
  const result = await h.armService.arm(command(h));
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.candidate.lifecycleState, "ARMED");
  assert.equal(result.candidate.arm.selectedQuantity, 25);
  assert.equal(h.permissionCalls(), 1);
  const refreshedReview = h.reviewRepository.get("arm-NVDA-1", 1);
  assert.equal(refreshedReview.currentPackage.material.currentExpectedEntry, 180.01);
  assert.equal(refreshedReview.currentPackage.evidence.riskEvaluationId, "risk-2");
  assert.equal(refreshedReview.selectedQuantity.value, 25);
  assert.equal(h.armOperationRepository.getByOperationId("arm-op-1").status, "COMPLETED");
  assert.equal(h.handoffRepository.snapshot().handoffs.length, 1);
  assert.equal(h.deliveryRepository.snapshot().deliveries.length, 1);
});

test("marketable ceiling increase carries the explicit selected quantity forward and completes ARM", async () => {
  const h = harness({ expectedEntryChange: true, freshQuantity: 120 });
  const result = await h.armService.arm(command(h));
  assert.equal(result.status, "COMPLETED");
  const refreshedReview = h.reviewRepository.get("arm-NVDA-1", 1);
  assert.equal(refreshedReview.currentPackage.material.maxAffordableQuantity, 120);
  assert.notEqual(refreshedReview.currentPackage.reviewPackageId, h.initialReview.currentPackage.reviewPackageId);
  assert.equal(refreshedReview.selectedQuantity.value, 25);
  assert.equal(refreshedReview.selectedQuantity.reviewPackageId, refreshedReview.currentPackage.reviewPackageId);
  assert.equal(result.candidate.arm.selectedQuantity, 25);
  assert.equal(result.candidate.arm.reviewPackageId, refreshedReview.currentPackage.reviewPackageId);
});

test("marketable ceiling decrease that still permits the explicit selected quantity completes ARM", async () => {
  const h = harness({ expectedEntryChange: true, freshQuantity: 30 });
  const result = await h.armService.arm(command(h));
  assert.equal(result.status, "COMPLETED");
  const refreshedReview = h.reviewRepository.get("arm-NVDA-1", 1);
  assert.equal(refreshedReview.currentPackage.material.maxAffordableQuantity, 30);
  assert.equal(refreshedReview.selectedQuantity.value, 25);
  assert.equal(result.candidate.arm.selectedQuantity, 25);
});

test("ARM-time fresh ceiling below selected quantity returns REVIEW_REQUIRED and never creates authorization", async () => {
  const h = harness({ quantityChange: true });
  const result = await h.armService.arm(command(h));
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(h.coordinator.candidateSnapshot("arm-NVDA-1", 1).lifecycleState, "READY");
  assert.equal(h.armOperationRepository.getByOperationId("arm-op-1").status, "REVIEW_REQUIRED");
  assert.equal(h.handoffRepository.snapshot().handoffs.length, 0);
  assert.equal(h.deliveryRepository.snapshot().deliveries.length, 0);
  assert.equal(h.reviewRepository.get("arm-NVDA-1", 1).selectedQuantity, null);
});

test("unknown Execution ownership fails closed before permission revalidation", async () => {
  const h = harness({ ownershipStatus: "UNKNOWN" });
  const result = await h.armService.arm(command(h));
  assert.equal(result.status, "REJECTED");
  assert.equal(result.operation.reasonCode, "EXECUTION_OWNERSHIP_UNKNOWN");
  assert.equal(h.permissionCalls(), 0);
  assert.equal(h.coordinator.candidateSnapshot("arm-NVDA-1", 1).lifecycleState, "READY");
});

test("durable AUTHORIZED proof forward-completes after handoff persistence outage without reevaluating permission", async () => {
  const h = harness();
  const originalRecord = h.handoffRepository.record.bind(h.handoffRepository);
  let fail = true;
  h.handoffRepository.record = (handoff) => {
    if (fail) {
      fail = false;
      const error = new Error("simulated handoff persistence outage");
      error.code = "EIO";
      throw error;
    }
    return originalRecord(handoff);
  };

  await assert.rejects(h.armService.arm(command(h)), /simulated handoff persistence outage/);
  assert.equal(h.permissionCalls(), 1);
  assert.equal(h.armOperationRepository.getByOperationId("arm-op-1").status, "AUTHORIZED");
  assert.equal(h.coordinator.candidateSnapshot("arm-NVDA-1", 1).lifecycleState, "ARMED");
  assert.equal(h.handoffRepository.snapshot().handoffs.length, 0);

  const recovery = h.armService.recoverAll();
  assert.equal(recovery.operations[0].status, "RECOVERED");
  assert.equal(recovery.operations[0].result.armTransition.recoveredExistingAuthorization, true);
  assert.equal(h.permissionCalls(), 1);
  assert.equal(h.armOperationRepository.getByOperationId("arm-op-1").status, "COMPLETED");
  assert.equal(h.handoffRepository.snapshot().handoffs.length, 1);
  assert.equal(h.deliveryRepository.snapshot().deliveries[0].status, "PENDING");
});

test("startup recovery retires unproven REQUESTED ARM and requires a new operator operation", async () => {
  const h = harness();
  const original = command(h);
  h.armOperationRepository.beginRequest({
    operationId: "orphan-arm",
    request: durableRequestFromCommand({ ...original, operationId: "orphan-arm" }),
  });
  assert.equal(h.armOperationRepository.getByOperationId("orphan-arm").status, "REQUESTED");

  const recovery = h.armService.recoverAll();
  assert.equal(recovery.requestRecovery.length, 1);
  assert.equal(recovery.requestRecovery[0].status, "REJECTED_UNPROVEN_REQUEST");
  assert.equal(h.armOperationRepository.getByOperationId("orphan-arm").status, "REJECTED");
  assert.equal(h.armOperationRepository.getByOperationId("orphan-arm").reasonCode, "ARM_AUTHORIZATION_NOT_PROVEN_AFTER_RESTART");
  assert.equal(h.permissionCalls(), 0);

  const sameOldOperation = await h.armService.arm({ ...original, operationId: "orphan-arm" });
  assert.equal(sameOldOperation.status, "REJECTED");
  assert.equal(h.permissionCalls(), 0);
  assert.equal(h.coordinator.candidateSnapshot("arm-NVDA-1", 1).lifecycleState, "READY");
});
