import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";
import { PreTradeStructuralValidityService } from "../schwab-bridge/pretrade-structural-validity.mjs";
import { PreTradePermissionDecisionService } from "../schwab-bridge/pretrade-permission-decision.mjs";
import { PreTradePermissionAttemptRepository } from "../schwab-bridge/pretrade-permission-attempt-repository.mjs";
import { PreTradePermissionPipeline } from "../schwab-bridge/pretrade-permission-pipeline.mjs";

const NOW = "2026-09-05T15:00:00.000Z";

function tempPath(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `executionos-${name}-`)), `${name}.json`);
}

function proposal(overrides = {}) {
  return {
    candidateId: "permission-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "SOD_A_PLUS_TRADES",
    sourceDate: "2026-09-05",
    generatedAt: "2026-09-05T13:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "Breakout retest",
    thesis: "Continuation if the retest holds",
    trigger: { type: "MANUAL_CONFIRMATION", evaluatorVersion: 1 },
    structuralInvalidation: {
      price: 179.5,
      rule: "break below retest low",
      referenceType: "SWING_LOW",
      reason: "thesis fails below structure",
    },
    context: { regime: "TRENDING" },
    managementContract: { mode: "FLEXIBLE_WITHIN_CEILING" },
    targets: [181, 182],
    validity: {
      validFrom: "2026-09-05T14:00:00.000Z",
      validUntil: "2026-09-05T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
    },
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

function fullRiskEvaluation({ accountId = "acct-1", status = "VALID" } = {}) {
  return {
    riskEvaluationId: "risk-eval-1",
    status,
    dss: { dssEvaluationId: "dss-eval-1", effectiveStop: 179.25 },
    entry: {
      entryMode: "MARKETABLE_NOW",
      currentExpectedEntry: 180,
      bid: 179.99,
      ask: 180,
      quoteObservedAt: "2026-09-05T14:59:59.500Z",
      quoteAgeMs: 500,
      quoteSource: "SCHWAB",
      expectedEntryRule: "ASK_MARKETABLE_LONG",
    },
    account: {
      accountId,
      accountEquity: 13500,
      accountCurrency: "USD",
      snapshotObservedAt: "2026-09-05T14:59:59.500Z",
      snapshotAgeMs: 500,
      snapshotSource: "SCHWAB",
      sourceSnapshotId: "acct-snapshot-1",
      maxDollarRisk: 67.5,
      riskFraction: 0.005,
    },
    instrument: {
      assetType: "EQUITY",
      symbol: "NVDA",
      instrumentCurrency: "USD",
      minimumQuantity: 1,
      quantityIncrement: 1,
      metadataVersion: "instrument-v1",
    },
    calculation: {
      finalQuantity: 90,
      plannedDollarRisk: 67.5,
      plannedRiskFraction: 0.005,
    },
  };
}

function harness({
  dssStatus = "VALID",
  phase4Status = "VALID",
  riskRepositoryError = null,
  permissionEvaluator = null,
} = {}) {
  const stateFile = tempPath("permission-state");
  const attemptFile = tempPath("permission-attempts");
  const clock = () => NOW;
  const store = new PreTradeStore({ filePath: stateFile, clock });
  store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock, idFactory: () => "ingress-event-1" });
  ingress.importBundle({ source: "SOD_A_PLUS_TRADES", bundleId: "permission-bundle", candidates: [proposal()] });
  const persisted = store.state.candidates[0];
  persisted.lifecycleState = "PERMISSION_EVALUATING";
  persisted.stateRevision = 2;
  persisted.permissionEvaluationStatus = "RUNNING";
  persisted.triggerSatisfaction = {
    authority: "PRETRADE_TRIGGER_ENGINE",
    evaluatorVersion: 1,
    evidenceId: "trigger-evidence-1",
    evidenceTimestamp: "2026-09-05T14:59:00.000Z",
    satisfiedAt: "2026-09-05T14:59:00.000Z",
  };
  store.save();

  const coordinator = new PreTradeLifecycleCoordinator({
    store,
    clock,
    idFactory: (() => { let id = 0; return () => `lifecycle-${++id}`; })(),
  });
  const structuralValidityService = new PreTradeStructuralValidityService({
    clock,
    idFactory: () => "structure-eval-1",
  });
  const permissionDecisionService = new PreTradePermissionDecisionService({
    evaluator: permissionEvaluator,
    clock,
    idFactory: () => "permission-decision-1",
  });

  const calls = { dss: 0, risk: 0 };
  const dssPermissionService = {
    async evaluate() {
      calls.dss += 1;
      return {
        action: "EVALUATED",
        status: dssStatus,
        dssEvaluationId: dssStatus === "VALID" ? "dss-eval-1" : null,
        reasonCodes: dssStatus === "VALID" ? [] : [`DSS_${dssStatus}`],
        evaluation: {
          dssEvaluationId: dssStatus === "VALID" ? "dss-eval-1" : null,
          status: dssStatus,
          reasonCodes: dssStatus === "VALID" ? [] : [`DSS_${dssStatus}`],
          effectiveStop: dssStatus === "VALID" ? 179.25 : null,
          evaluatedAt: NOW,
        },
      };
    },
  };

  const riskEvaluation = fullRiskEvaluation();
  const riskSizingPermissionService = {
    async evaluate({ accountId }) {
      calls.risk += 1;
      if (phase4Status === "NO_AFFORDABLE_SIZE") {
        return {
          riskEvaluationId: null,
          dssEvaluationId: "dss-eval-1",
          status: "NO_AFFORDABLE_SIZE",
          maxAffordableQuantity: 0,
          plannedDollarRisk: 0,
          plannedRiskFraction: 0,
          reasonCodes: ["MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET"],
        };
      }
      if (phase4Status !== "VALID") {
        return {
          riskEvaluationId: null,
          dssEvaluationId: "dss-eval-1",
          status: phase4Status,
          maxAffordableQuantity: null,
          plannedDollarRisk: null,
          plannedRiskFraction: null,
          reasonCodes: [`PHASE4_${phase4Status}`],
        };
      }
      riskEvaluation.account.accountId = accountId;
      return {
        riskEvaluationId: riskEvaluation.riskEvaluationId,
        dssEvaluationId: "dss-eval-1",
        status: "VALID",
        maxAffordableQuantity: 90,
        plannedDollarRisk: 67.5,
        plannedRiskFraction: 0.005,
        reasonCodes: [],
      };
    },
  };
  const riskEvaluationRepository = {
    getById(id) {
      assert.equal(id, "risk-eval-1");
      if (riskRepositoryError) throw riskRepositoryError;
      return structuredClone(riskEvaluation);
    },
  };
  const attemptRepository = new PreTradePermissionAttemptRepository({ filePath: attemptFile, clock });
  attemptRepository.load();
  let id = 0;
  const pipeline = new PreTradePermissionPipeline({
    store,
    lifecycleCoordinator: coordinator,
    structuralValidityService,
    dssPermissionService,
    riskSizingPermissionService,
    riskEvaluationRepository,
    permissionDecisionService,
    attemptRepository,
    clock,
    idFactory: () => `permission-attempt-${++id}`,
  });

  return { store, coordinator, attemptRepository, pipeline, calls };
}

function command(overrides = {}) {
  return {
    operationId: "permission-op-1",
    candidateId: "permission-NVDA-1",
    contractVersion: 1,
    expectedState: "PERMISSION_EVALUATING",
    expectedRevision: 2,
    accountId: "acct-1",
    entryMode: "MARKETABLE_NOW",
    operatorStructuralAssessment: {
      status: "VALID",
      actor: "OPERATOR",
      evidenceReference: "chart-observation-1",
    },
    operatorPermissionAssessment: {
      outcome: "READY",
      actor: "OPERATOR",
      note: "macro/setup context remains acceptable",
    },
    ...overrides,
  };
}

test("complete VALID permission attempt publishes READY with immutable DSS/account/entry/Phase4/context provenance", async () => {
  const h = harness();
  const result = await h.pipeline.evaluate(command());
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.transition.lifecycleState, "READY");
  assert.equal(h.calls.dss, 1);
  assert.equal(h.calls.risk, 1);

  const attempts = h.attemptRepository.snapshot().attempts;
  assert.equal(attempts.length, 1);
  const attempt = attempts[0];
  assert.equal(attempt.result.outcome, "READY");
  assert.equal(attempt.candidate.permissionStateRevision, 2);
  assert.equal(attempt.dss.dssEvaluationId, "dss-eval-1");
  assert.equal(attempt.phase4.riskEvaluationId, "risk-eval-1");
  assert.equal(attempt.account.accountId, "acct-1");
  assert.equal(attempt.expectedEntry.currentExpectedEntry, 180);
  assert.equal(attempt.market.quoteSource, "SCHWAB");
  assert.equal(attempt.permissionDecision.outcome, "READY");
  assert.equal(attempt.permissionDecision.source, "OPERATOR");

  const candidate = h.coordinator.candidateSnapshot("permission-NVDA-1", 1);
  assert.equal(candidate.lifecycleState, "READY");
  assert.equal(candidate.currentPermissionOutcome.permissionEvaluationId, attempt.permissionAttemptId);
  assert.equal(candidate.currentPermissionOutcome.provenance.permissionDecisionId, "permission-decision-1");
});

test("CAUTION comes from explicit context decision and carries warning reasons", async () => {
  const h = harness();
  const result = await h.pipeline.evaluate(command({
    operatorPermissionAssessment: {
      outcome: "CAUTION",
      reasonCodes: ["ELEVATED_CONTEXT_RISK"],
      actor: "OPERATOR",
    },
  }));
  assert.equal(result.transition.lifecycleState, "CAUTION");
  assert.deepEqual(result.permissionAttempt.result.reasonCodes, ["ELEVATED_CONTEXT_RISK"]);
  assert.equal(result.permissionAttempt.permissionDecision.outcome, "CAUTION");
});

test("VALID Phase 4 does not silently grant READY when macro/setup context is unresolved", async () => {
  const h = harness();
  const result = await h.pipeline.evaluate(command({ operatorPermissionAssessment: null }));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.permissionAttempt.result.kind, "BLOCKED_RETRYABLE");
  assert.equal(result.permissionAttempt.result.reasonCode, "PERMISSION_CONTEXT_ASSESSMENT_REQUIRED");
  assert.equal(result.permissionAttempt.permissionDecision.kind, "BLOCKED_RETRYABLE");
  const candidate = h.coordinator.candidateSnapshot("permission-NVDA-1", 1);
  assert.equal(candidate.lifecycleState, "PERMISSION_EVALUATING");
  assert.equal(candidate.permissionBlocker.status, "BLOCKED_RETRYABLE");
});

test("trusted permission evaluator may publish PASS after all earlier permission evidence is valid", async () => {
  const h = harness({
    permissionEvaluator: async () => ({
      outcome: "PASS",
      reasonCode: "BROAD_MARKET_DISQUALIFIER",
      reasonCodes: ["BROAD_MARKET_DISQUALIFIER"],
      provenance: { evaluatorVersion: 1 },
    }),
  });
  const result = await h.pipeline.evaluate(command({ operatorPermissionAssessment: null }));
  assert.equal(result.transition.lifecycleState, "PASS");
  assert.equal(result.permissionAttempt.result.reasonCode, "BROAD_MARKET_DISQUALIFIER");
  assert.equal(result.permissionAttempt.permissionDecision.source, "TRUSTED_EVALUATOR");
});

test("affirmative structural INVALID becomes terminal PASS before DSS or Phase 4", async () => {
  const h = harness();
  const result = await h.pipeline.evaluate(command({
    operatorStructuralAssessment: {
      status: "INVALID",
      reasonCodes: ["STRUCTURAL_BREAK_CONFIRMED"],
      actor: "OPERATOR",
    },
  }));
  assert.equal(result.transition.lifecycleState, "PASS");
  assert.equal(result.permissionAttempt.result.reasonCode, "STRUCTURAL_INVALID");
  assert.equal(result.permissionAttempt.permissionDecision, null);
  assert.equal(h.calls.dss, 0);
  assert.equal(h.calls.risk, 0);
});

test("unresolved structural validity is a retryable blocker and never PASS", async () => {
  const h = harness();
  const result = await h.pipeline.evaluate(command({ operatorStructuralAssessment: null }));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.transition.lifecycleState, "PERMISSION_EVALUATING");
  assert.equal(result.transition.stateRevision, 3);
  const candidate = h.coordinator.candidateSnapshot("permission-NVDA-1", 1);
  assert.equal(candidate.permissionBlocker.status, "BLOCKED_RETRYABLE");
  assert.equal(h.calls.dss, 0);
  assert.equal(h.calls.risk, 0);
});

test("DSS BLOCKED is retryable and Phase 4 is not called", async () => {
  const h = harness({ dssStatus: "BLOCKED" });
  const result = await h.pipeline.evaluate(command());
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.transition.lifecycleState, "PERMISSION_EVALUATING");
  assert.equal(result.transition.candidateId, "permission-NVDA-1");
  assert.equal(h.calls.dss, 1);
  assert.equal(h.calls.risk, 0);
});

test("NO_AFFORDABLE_SIZE maps to terminal PASS STOP_RISK_CONFLICT", async () => {
  const h = harness({ phase4Status: "NO_AFFORDABLE_SIZE" });
  const result = await h.pipeline.evaluate(command());
  assert.equal(result.transition.lifecycleState, "PASS");
  assert.equal(result.permissionAttempt.result.reasonCode, "STOP_RISK_CONFLICT");
  assert.equal(result.permissionAttempt.permissionDecision, null);
  assert.equal(h.calls.risk, 1);
});

test("missing persisted Phase 4 evaluation becomes a durable integrity blocker", async () => {
  const missing = new Error("risk evaluation missing after Phase 4 returned its id");
  missing.code = "RISK_EVALUATION_NOT_FOUND";
  const h = harness({ riskRepositoryError: missing });
  const result = await h.pipeline.evaluate(command());
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.permissionAttempt.result.kind, "BLOCKED_INTEGRITY");
  assert.equal(result.permissionAttempt.result.reasonCode, "RISK_EVALUATION_NOT_FOUND");
  assert.equal(result.permissionAttempt.phase4, null);
  const candidate = h.coordinator.candidateSnapshot("permission-NVDA-1", 1);
  assert.equal(candidate.lifecycleState, "PERMISSION_EVALUATING");
  assert.equal(candidate.permissionBlocker.status, "BLOCKED_INTEGRITY");
  assert.equal(h.attemptRepository.snapshot().attempts.length, 1);
});

test("identical operation retry after READY returns established result without reevaluation", async () => {
  const h = harness();
  const first = await h.pipeline.evaluate(command());
  const retry = await h.pipeline.evaluate(command({ expectedState: "READY", expectedRevision: 3 }));
  assert.equal(first.permissionAttempt.permissionAttemptId, retry.permissionAttempt.permissionAttemptId);
  assert.equal(retry.status, "ESTABLISHED");
  assert.equal(retry.duplicateOperation, true);
  assert.equal(h.calls.dss, 1);
  assert.equal(h.calls.risk, 1);
  assert.equal(h.attemptRepository.snapshot().attempts.length, 1);
});

test("same operationId with different account fails closed without new evaluation", async () => {
  const h = harness();
  await h.pipeline.evaluate(command());
  await assert.rejects(
    h.pipeline.evaluate(command({ accountId: "acct-2", expectedState: "READY", expectedRevision: 3 })),
    (error) => error.code === "PERMISSION_OPERATION_ID_CONFLICT",
  );
  assert.equal(h.calls.dss, 1);
  assert.equal(h.calls.risk, 1);
});

test("persisted permission attempt forward-completes after lifecycle publication outage without reevaluating", async () => {
  const h = harness();
  const original = h.coordinator.publishPermissionOutcome.bind(h.coordinator);
  let fail = true;
  h.coordinator.publishPermissionOutcome = (args) => {
    if (fail) {
      fail = false;
      const error = new Error("simulated lifecycle persistence outage");
      error.code = "EIO";
      throw error;
    }
    return original(args);
  };

  await assert.rejects(h.pipeline.evaluate(command()), /simulated lifecycle persistence outage/);
  assert.equal(h.attemptRepository.snapshot().attempts.length, 1);
  assert.equal(h.coordinator.candidateSnapshot("permission-NVDA-1", 1).lifecycleState, "PERMISSION_EVALUATING");
  assert.equal(h.calls.dss, 1);
  assert.equal(h.calls.risk, 1);

  const recovery = h.pipeline.recoverAll();
  assert.equal(recovery[0].status, "RECOVERED");
  assert.equal(h.coordinator.candidateSnapshot("permission-NVDA-1", 1).lifecycleState, "READY");
  assert.equal(h.calls.dss, 1);
  assert.equal(h.calls.risk, 1);
});

test("old persisted attempt is not replayed onto a later trigger satisfaction cycle", async () => {
  const h = harness();
  h.coordinator.publishPermissionOutcome = () => {
    const error = new Error("simulated outage before lifecycle publication");
    error.code = "EIO";
    throw error;
  };
  await assert.rejects(h.pipeline.evaluate(command()), /simulated outage/);
  assert.equal(h.attemptRepository.snapshot().attempts.length, 1);

  const candidate = h.store.state.candidates[0];
  candidate.lifecycleState = "PERMISSION_EVALUATING";
  candidate.stateRevision = 5;
  candidate.triggerSatisfaction = {
    authority: "PRETRADE_TRIGGER_ENGINE",
    evaluatorVersion: 1,
    evidenceId: "trigger-evidence-2",
    evidenceTimestamp: "2026-09-05T15:05:00.000Z",
    satisfiedAt: "2026-09-05T15:05:00.000Z",
  };
  h.store.save();

  const recovery = h.pipeline.recoverAll();
  assert.equal(recovery[0].status, "STALE_NOT_APPLIED");
  assert.equal(recovery[0].code, "PERMISSION_ATTEMPT_STALE");
  const after = h.coordinator.candidateSnapshot("permission-NVDA-1", 1);
  assert.equal(after.lifecycleState, "PERMISSION_EVALUATING");
  assert.equal(after.stateRevision, 5);
  assert.equal(after.triggerSatisfaction.evidenceId, "trigger-evidence-2");
});
