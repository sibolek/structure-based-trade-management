import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildPreTradeReviewPackage } from "../schwab-bridge/pretrade-review.mjs";
import { PreTradeReviewRepository } from "../schwab-bridge/pretrade-review-repository.mjs";

const NOW = "2026-09-06T13:00:00.000Z";

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-review-")), "reviews.json");
}

function candidate(state = "READY") {
  return {
    candidateId: "review-NVDA-1",
    contractVersion: 1,
    contentHash: "candidate-hash",
    symbol: "NVDA",
    direction: "LONG",
    setup: "Breakout retest",
    timeframe: "2m",
    lifecycleState: state,
    currentPermissionOutcome: { permissionEvaluationId: "attempt-1" },
  };
}

function risk(overrides = {}) {
  const entryMode = overrides.entryMode || "MARKETABLE_NOW";
  return {
    riskEvaluationId: overrides.riskEvaluationId || "risk-1",
    status: "VALID",
    dss: {
      dssEvaluationId: overrides.dssEvaluationId || "dss-1",
      structuralInvalidation: 179.5,
      effectiveStop: 179.25,
    },
    entry: {
      entryMode,
      triggerPrice: entryMode === "STOP_TRIGGER" ? (overrides.triggerPrice ?? 180.5) : null,
      currentExpectedEntry: overrides.currentExpectedEntry ?? 180,
    },
    account: { accountId: "acct-1", maxDollarRisk: 67.5 },
    instrument: {
      assetType: "EQUITY",
      symbol: "NVDA",
      instrumentCurrency: "USD",
      minimumQuantity: 1,
      quantityIncrement: 1,
    },
    calculation: { finalQuantity: overrides.finalQuantity ?? 90 },
  };
}

function attempt({ id = "attempt-1", riskEvaluation = risk(), outcome = "READY", reasons = [] } = {}) {
  return {
    permissionAttemptId: id,
    candidate: {
      candidateId: "review-NVDA-1",
      contractVersion: 1,
      candidateContentHash: "candidate-hash",
    },
    structuralValidity: { structuralEvaluationId: `structure-${id}` },
    dss: { dssEvaluationId: riskEvaluation.dss.dssEvaluationId },
    phase4: { evaluation: riskEvaluation },
    permissionDecision: { permissionDecisionId: `decision-${id}` },
    result: { kind: "OUTCOME", outcome, reasonCodes: reasons },
  };
}

test("reviewPackageId ignores fresh evidence identities when authorization-material facts are equivalent", () => {
  const first = buildPreTradeReviewPackage({ candidate: candidate(), permissionAttempt: attempt(), generatedAt: NOW });
  const nextCandidate = candidate();
  nextCandidate.currentPermissionOutcome.permissionEvaluationId = "attempt-2";
  const second = buildPreTradeReviewPackage({
    candidate: nextCandidate,
    permissionAttempt: attempt({ id: "attempt-2", riskEvaluation: risk({ riskEvaluationId: "risk-2", dssEvaluationId: "dss-2" }) }),
    generatedAt: "2026-09-06T13:00:01.000Z",
  });
  assert.equal(first.reviewPackageId, second.reviewPackageId);
  assert.notEqual(first.evidence.permissionAttemptId, second.evidence.permissionAttemptId);
  assert.notEqual(first.evidence.riskEvaluationId, second.evidence.riskEvaluationId);
});

test("marketable expected-entry drift does not change review authorization identity when the fresh risk ceiling is unchanged", () => {
  const base = buildPreTradeReviewPackage({ candidate: candidate(), permissionAttempt: attempt(), generatedAt: NOW });
  const changed = buildPreTradeReviewPackage({
    candidate: candidate(),
    permissionAttempt: attempt({ riskEvaluation: risk({ currentExpectedEntry: 180.01 }) }),
    generatedAt: NOW,
  });
  assert.equal(base.reviewPackageId, changed.reviewPackageId);
  assert.notEqual(base.material.currentExpectedEntry, changed.material.currentExpectedEntry);
});

test("stop-trigger expected-entry drift remains review material", () => {
  const base = buildPreTradeReviewPackage({
    candidate: candidate(),
    permissionAttempt: attempt({ riskEvaluation: risk({ entryMode: "STOP_TRIGGER", triggerPrice: 180.5, currentExpectedEntry: 180.5 }) }),
    generatedAt: NOW,
  });
  const changed = buildPreTradeReviewPackage({
    candidate: candidate(),
    permissionAttempt: attempt({ riskEvaluation: risk({ entryMode: "STOP_TRIGGER", triggerPrice: 180.5, currentExpectedEntry: 180.75 }) }),
    generatedAt: NOW,
  });
  assert.notEqual(base.reviewPackageId, changed.reviewPackageId);
});

test("quantity-ceiling changes create a new reviewPackageId", () => {
  const base = buildPreTradeReviewPackage({ candidate: candidate(), permissionAttempt: attempt(), generatedAt: NOW });
  const changed = buildPreTradeReviewPackage({
    candidate: candidate(),
    permissionAttempt: attempt({ riskEvaluation: risk({ finalQuantity: 89 }) }),
    generatedAt: NOW,
  });
  assert.notEqual(base.reviewPackageId, changed.reviewPackageId);
});

test("review repository preserves selection across evidence and marketable-quote refreshes but clears it on authorization-material change", () => {
  const repo = new PreTradeReviewRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const base = buildPreTradeReviewPackage({ candidate: candidate(), permissionAttempt: attempt(), generatedAt: NOW });
  repo.syncPackage({ operationId: "sync-1", reviewPackage: base });
  repo.selectQuantity({ operationId: "qty-1", candidateId: base.candidateId, contractVersion: 1, reviewPackageId: base.reviewPackageId, selectedQuantity: 25 });

  const nextCandidate = candidate();
  nextCandidate.currentPermissionOutcome.permissionEvaluationId = "attempt-2";
  const equivalent = buildPreTradeReviewPackage({
    candidate: nextCandidate,
    permissionAttempt: attempt({ id: "attempt-2", riskEvaluation: risk({ riskEvaluationId: "risk-2", dssEvaluationId: "dss-2", currentExpectedEntry: 180.02 }) }),
    generatedAt: "2026-09-06T13:00:01.000Z",
  });
  const refreshed = repo.syncPackage({ operationId: "sync-2", reviewPackage: equivalent });
  assert.equal(refreshed.selectedQuantity.value, 25);
  assert.equal(refreshed.currentPackage.material.currentExpectedEntry, 180.02);

  const changedCandidate = candidate();
  changedCandidate.currentPermissionOutcome.permissionEvaluationId = "attempt-3";
  const changed = buildPreTradeReviewPackage({
    candidate: changedCandidate,
    permissionAttempt: attempt({ id: "attempt-3", riskEvaluation: risk({ riskEvaluationId: "risk-3", currentExpectedEntry: 180.03, finalQuantity: 24 }) }),
    generatedAt: "2026-09-06T13:00:02.000Z",
  });
  const replaced = repo.syncPackage({ operationId: "sync-3", reviewPackage: changed });
  assert.equal(replaced.selectedQuantity, null);
  assert.equal(replaced.cautionAcknowledgment, null);
});

test("review repository reload keeps persisted review records mutable", () => {
  const filePath = tempFile();
  const first = new PreTradeReviewRepository({ filePath, clock: () => NOW });
  first.load();
  const base = buildPreTradeReviewPackage({ candidate: candidate(), permissionAttempt: attempt(), generatedAt: NOW });
  first.syncPackage({ operationId: "sync-before-restart", reviewPackage: base });

  const reloaded = new PreTradeReviewRepository({ filePath, clock: () => "2026-09-06T13:00:01.000Z" });
  reloaded.load();
  const nextCandidate = candidate();
  nextCandidate.currentPermissionOutcome.permissionEvaluationId = "attempt-2";
  const equivalent = buildPreTradeReviewPackage({
    candidate: nextCandidate,
    permissionAttempt: attempt({ id: "attempt-2", riskEvaluation: risk({ riskEvaluationId: "risk-2", dssEvaluationId: "dss-2" }) }),
    generatedAt: "2026-09-06T13:00:01.000Z",
  });
  const refreshed = reloaded.syncPackage({ operationId: "sync-after-restart", reviewPackage: equivalent });
  assert.equal(refreshed.currentPackage.evidence.permissionAttemptId, "attempt-2");

  const selected = reloaded.selectQuantity({
    operationId: "qty-after-restart",
    candidateId: equivalent.candidateId,
    contractVersion: 1,
    reviewPackageId: equivalent.reviewPackageId,
    selectedQuantity: 25,
  });
  assert.equal(selected.selectedQuantity.value, 25);
});

test("CAUTION acknowledgment is required and remains bound to the exact caution package", () => {
  const repo = new PreTradeReviewRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const cautionCandidate = candidate("CAUTION");
  const review = buildPreTradeReviewPackage({
    candidate: cautionCandidate,
    permissionAttempt: attempt({ outcome: "CAUTION", reasons: ["ELEVATED_CONTEXT_RISK"] }),
    generatedAt: NOW,
  });
  repo.syncPackage({ operationId: "sync-caution", reviewPackage: review });
  const acked = repo.acknowledgeCaution({ operationId: "ack-1", candidateId: review.candidateId, contractVersion: 1, reviewPackageId: review.reviewPackageId, acknowledged: true });
  assert.deepEqual(acked.cautionAcknowledgment.reasonCodes, ["ELEVATED_CONTEXT_RISK"]);
});

test("quantity selection enforces native increment and current maximum", () => {
  const repo = new PreTradeReviewRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const review = buildPreTradeReviewPackage({ candidate: candidate(), permissionAttempt: attempt(), generatedAt: NOW });
  repo.syncPackage({ operationId: "sync-qty", reviewPackage: review });
  assert.throws(
    () => repo.selectQuantity({ operationId: "qty-fraction", candidateId: review.candidateId, contractVersion: 1, reviewPackageId: review.reviewPackageId, selectedQuantity: 1.5 }),
    (error) => error.code === "INVALID_SELECTED_QUANTITY",
  );
  assert.throws(
    () => repo.selectQuantity({ operationId: "qty-large", candidateId: review.candidateId, contractVersion: 1, reviewPackageId: review.reviewPackageId, selectedQuantity: 91 }),
    (error) => error.code === "INVALID_SELECTED_QUANTITY",
  );
});
