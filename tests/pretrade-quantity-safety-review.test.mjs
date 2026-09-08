import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluatePretradeQuantitySafety } from "../schwab-bridge/pretrade-quantity-safety.mjs";
import { buildPreTradeReviewPackage } from "../schwab-bridge/pretrade-review.mjs";
import { PreTradeReviewRepository } from "../schwab-bridge/pretrade-review-repository.mjs";
import { PreTradeReviewService } from "../schwab-bridge/pretrade-review-service.mjs";

const NOW = "2026-09-08T04:45:00.000Z";

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-quantity-review-")), "reviews.json");
}

function candidate() {
  return {
    candidateId: "quantity-safety-MES-1",
    contractVersion: 1,
    contentHash: "candidate-hash",
    symbol: "/MESU26",
    direction: "LONG",
    setup: "Acceptance test",
    timeframe: "2m",
    lifecycleState: "READY",
    currentPermissionOutcome: { permissionEvaluationId: "attempt-1" },
  };
}

function riskEvaluation({ finalQuantity = 11, maxDollarRisk = 70.06 } = {}) {
  return {
    riskEvaluationId: "risk-1",
    status: "VALID",
    dss: {
      dssEvaluationId: "dss-1",
      structuralInvalidation: 7713,
      effectiveStop: 7712.5,
    },
    entry: {
      entryMode: "MARKETABLE_NOW",
      triggerPrice: null,
      currentExpectedEntry: 7713.75,
    },
    account: {
      accountId: "acct-1",
      maxDollarRisk,
    },
    instrument: {
      assetType: "FUTURE",
      symbol: "/MESU26",
      instrumentCurrency: "USD",
      minimumQuantity: 1,
      quantityIncrement: 1,
      tickSize: 0.25,
      tickValue: 1.25,
      pointValue: 5,
    },
    calculation: {
      finalQuantity,
    },
  };
}

function dssEvaluation({ atrValue = 1.75 } = {}) {
  return {
    dssEvaluationId: "dss-1",
    status: "VALID",
    atrValue,
  };
}

function attempt({ risk = riskEvaluation(), dss = dssEvaluation() } = {}) {
  return {
    permissionAttemptId: "attempt-1",
    candidate: {
      candidateId: "quantity-safety-MES-1",
      contractVersion: 1,
      candidateContentHash: "candidate-hash",
    },
    structuralValidity: { structuralEvaluationId: "structure-1" },
    dss: {
      dssEvaluationId: "dss-1",
      evaluation: dss,
    },
    phase4: { evaluation: risk },
    permissionDecision: { permissionDecisionId: "decision-1" },
    result: { kind: "OUTCOME", outcome: "READY", reasonCodes: [] },
  };
}

function reviewPackage({ risk = riskEvaluation(), dss = dssEvaluation() } = {}) {
  return buildPreTradeReviewPackage({
    candidate: candidate(),
    permissionAttempt: attempt({ risk, dss }),
    generatedAt: NOW,
  });
}

function safety({ risk = riskEvaluation(), dss = dssEvaluation() } = {}) {
  return evaluatePretradeQuantitySafety({ riskEvaluation: risk, dssEvaluation: dss });
}

test("review quantity authority caps Phase 4 near-stop size at the 2-ATR safety maximum", () => {
  const repo = new PreTradeReviewRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const pkg = reviewPackage();
  const result = repo.syncPackage({
    operationId: "sync-1",
    reviewPackage: pkg,
    quantitySafety: safety(),
  });

  assert.equal(pkg.material.maxAffordableQuantity, 11);
  assert.equal(result.quantitySafety.phase4MaxQuantity, 11);
  assert.equal(result.quantitySafety.volatilityMaxQuantity, 4);
  assert.equal(result.quantitySafety.policyMaxQuantity, 4);
  assert.equal(result.maxAllowedQuantity, 4);
  assert.equal(result.reviewQuantityCeiling.value, 4);
  assert.equal(result.reviewQuantityCeiling.source, "EXPLICIT_REVIEW");
});

test("quantity selection is enforced against safety ceiling, not raw Phase 4 maximum", () => {
  const repo = new PreTradeReviewRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const pkg = reviewPackage();
  repo.syncPackage({ operationId: "sync-1", reviewPackage: pkg, quantitySafety: safety() });

  assert.throws(
    () => repo.selectQuantity({
      operationId: "qty-too-large",
      candidateId: pkg.candidateId,
      contractVersion: 1,
      reviewPackageId: pkg.reviewPackageId,
      selectedQuantity: 5,
    }),
    (error) => error.code === "INVALID_SELECTED_QUANTITY",
  );

  const selected = repo.selectQuantity({
    operationId: "qty-safe",
    candidateId: pkg.candidateId,
    contractVersion: 1,
    reviewPackageId: pkg.reviewPackageId,
    selectedQuantity: 4,
  });
  assert.equal(selected.selectedQuantity.value, 4);
});

test("ARM-style refresh may not expand the previously reviewed quantity ceiling", () => {
  const repo = new PreTradeReviewRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const pkg = reviewPackage();
  repo.syncPackage({ operationId: "sync-initial", reviewPackage: pkg, quantitySafety: safety() });

  const moreFavorable = safety({ dss: dssEvaluation({ atrValue: 0.875 }) });
  assert.equal(moreFavorable.policyMaxQuantity, 8);

  const preserved = repo.syncPackage({
    operationId: "sync-arm",
    reviewPackage: pkg,
    quantitySafety: moreFavorable,
    preserveQuantityCeiling: true,
  });

  assert.equal(preserved.quantitySafety.policyMaxQuantity, 8);
  assert.equal(preserved.reviewQuantityCeiling.policyMaxQuantity, 8);
  assert.equal(preserved.reviewQuantityCeiling.value, 4);
  assert.equal(preserved.maxAllowedQuantity, 4);
  assert.equal(preserved.reviewQuantityCeiling.source, "ARM_REVALIDATION_NON_EXPANDING");
});

test("ARM-style refresh may decrease the ceiling and clears a now-unsafe selection", () => {
  const repo = new PreTradeReviewRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const pkg = reviewPackage();
  repo.syncPackage({ operationId: "sync-initial", reviewPackage: pkg, quantitySafety: safety() });
  repo.selectQuantity({
    operationId: "qty-4",
    candidateId: pkg.candidateId,
    contractVersion: 1,
    reviewPackageId: pkg.reviewPackageId,
    selectedQuantity: 4,
  });

  const lessFavorable = safety({ dss: dssEvaluation({ atrValue: 3.5 }) });
  assert.equal(lessFavorable.policyMaxQuantity, 2);
  const reduced = repo.syncPackage({
    operationId: "sync-arm-reduced",
    reviewPackage: pkg,
    quantitySafety: lessFavorable,
    preserveQuantityCeiling: true,
  });

  assert.equal(reduced.maxAllowedQuantity, 2);
  assert.equal(reduced.reviewQuantityCeiling.value, 2);
  assert.equal(reduced.selectedQuantity, null);
  assert.equal(reduced.events.at(-1).quantitySelectionCleared, true);
});

test("an explicit review refresh may establish a higher ceiling", () => {
  const repo = new PreTradeReviewRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const pkg = reviewPackage();
  repo.syncPackage({ operationId: "sync-initial", reviewPackage: pkg, quantitySafety: safety() });

  const moreFavorable = safety({ dss: dssEvaluation({ atrValue: 0.875 }) });
  const refreshed = repo.syncPackage({
    operationId: "sync-explicit-review",
    reviewPackage: pkg,
    quantitySafety: moreFavorable,
    preserveQuantityCeiling: false,
  });

  assert.equal(refreshed.maxAllowedQuantity, 8);
  assert.equal(refreshed.reviewQuantityCeiling.value, 8);
  assert.equal(refreshed.reviewQuantityCeiling.source, "EXPLICIT_REVIEW");
});

test("review service derives the safety ceiling from exact DSS and Phase 4 evidence", () => {
  const repo = new PreTradeReviewRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const currentCandidate = candidate();
  const currentAttempt = attempt();
  const service = new PreTradeReviewService({
    lifecycleCoordinator: {
      candidateSnapshot(candidateId, contractVersion) {
        assert.equal(candidateId, currentCandidate.candidateId);
        assert.equal(contractVersion, 1);
        return structuredClone(currentCandidate);
      },
    },
    permissionAttemptRepository: {
      getById(id) {
        assert.equal(id, "attempt-1");
        return structuredClone(currentAttempt);
      },
    },
    reviewRepository: repo,
    clock: () => NOW,
  });

  const refreshed = service.refresh({
    operationId: "service-refresh",
    candidateId: currentCandidate.candidateId,
    contractVersion: 1,
  });
  assert.equal(refreshed.review.maxAllowedQuantity, 4);
  assert.equal(refreshed.review.quantitySafety.bindingConstraint, "VOLATILITY_STRESS");

  service.selectQuantity({
    operationId: "service-select",
    candidateId: currentCandidate.candidateId,
    contractVersion: 1,
    reviewPackageId: refreshed.review.currentPackage.reviewPackageId,
    selectedQuantity: 4,
  });
  const readiness = service.readiness(currentCandidate.candidateId, 1, refreshed.review.currentPackage.reviewPackageId);
  assert.equal(readiness.armEligible, true);
});

test("no volatility-safe size remains fail-closed and cannot become ARM eligible", () => {
  const repo = new PreTradeReviewRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const currentCandidate = candidate();
  const currentAttempt = attempt({ dss: dssEvaluation({ atrValue: 10 }) });
  const service = new PreTradeReviewService({
    lifecycleCoordinator: {
      candidateSnapshot() { return structuredClone(currentCandidate); },
    },
    permissionAttemptRepository: {
      getById() { return structuredClone(currentAttempt); },
    },
    reviewRepository: repo,
    clock: () => NOW,
  });

  const refreshed = service.refresh({
    operationId: "service-no-size",
    candidateId: currentCandidate.candidateId,
    contractVersion: 1,
  });
  assert.equal(refreshed.review.quantitySafety.status, "NO_AFFORDABLE_SIZE");
  assert.equal(refreshed.review.maxAllowedQuantity, 0);
  assert.equal(service.readiness(currentCandidate.candidateId, 1).reasonCode, "NO_SAFE_QUANTITY");
});
