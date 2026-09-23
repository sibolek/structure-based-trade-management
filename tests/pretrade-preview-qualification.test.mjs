import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPreTradePreviewQualificationAttempt,
  summarizePreTradePreviewQualification,
} from "../schwab-bridge/pretrade-preview-qualification.mjs";

const configuration = Object.freeze({
  buildSha: "abc1234",
  model: "test-model",
  reasoningEffort: "high",
  promptVersion: "prompt-1",
  outputSchemaVersion: "1",
  profileVersion: "intraday-shadow-1",
  policyId: "SHADOW_ONLY_UNAPPROVED",
  policyVersion: "1",
});

function attempt(index = 1, overrides = {}) {
  const second = String(index).padStart(2, "0");
  return {
    attemptId: `attempt-${index}`,
    configuration,
    runId: `run-${index}`,
    previewId: `preview-${index}`,
    operationId: `operation-${index}`,
    proposalHash: "a".repeat(64),
    chartReceivedAt: `2026-09-21T15:00:${second}.000Z`,
    providerStartedAt: `2026-09-21T15:00:${second}.100Z`,
    providerFinishedAt: `2026-09-21T15:00:${second}.500Z`,
    preflightStartedAt: `2026-09-21T15:00:${second}.500Z`,
    previewCreatedAt: `2026-09-21T15:00:${second}.600Z`,
    previewVisibleAt: `2026-09-21T15:00:${second}.800Z`,
    acceptanceRequestedAt: `2026-09-21T15:00:${second}.900Z`,
    receiptCommittedAt: `2026-09-21T15:00:${second}.950Z`,
    resultVisibleAt: `2026-09-21T15:00:${second}.990Z`,
    result: "ADMITTED",
    supportedAttempt: true,
    usefulResult: true,
    materialExtractionError: false,
    authorityViolation: false,
    activeReviewIntervals: [],
    timingUncertaintyMs: 0,
    ...overrides,
  };
}

test("qualification attempt separates generation, review, durable receipt and UI timing", () => {
  const record = buildPreTradePreviewQualificationAttempt(attempt());
  assert.equal(record.durations.providerMs, 400);
  assert.equal(record.durations.preflightMs, 100);
  assert.equal(record.durations.chartReceiptToPreviewVisibleMs, 800);
  assert.equal(record.durations.operatorReviewMs, 100);
  assert.equal(record.durations.acceptanceToDurableReceiptMs, 50);
  assert.equal(record.durations.receiptToReconciledVisibleMs, 40);
  assert.equal(record.durations.acceptanceToReconciledVisibleMs, 90);
  assert.equal(record.durations.combinedIncludingOperatorReviewMs, 990);
  assert.equal(record.durations.combinedExcludingOperatorReviewMs, 890);
  assert.equal(record.schemaVersion, 2);
  assert.equal(Object.isFrozen(record), true);
});

test("qualification attempt rejects raw or unbounded fields and out-of-order clocks", () => {
  assert.throws(
    () => buildPreTradePreviewQualificationAttempt({ ...attempt(), rawChart: "secret bytes" }),
    (error) => error.code === "INVALID_QUALIFICATION_ATTEMPT",
  );
  assert.throws(
    () => buildPreTradePreviewQualificationAttempt(attempt(1, {
      providerFinishedAt: "2026-09-21T15:00:01.050Z",
    })),
    (error) => error.code === "INVALID_QUALIFICATION_TIMING",
  );
});

test("qualification summary uses nearest-rank p95 and never asserts production qualification", () => {
  const attempts = Array.from({ length: 30 }, (_, index) => {
    const offset = index + 1;
    const base = attempt(offset);
    return index === 29
      ? { ...base, usefulResult: false, result: "NO_SETUP" }
      : base;
  });
  const summary = summarizePreTradePreviewQualification(attempts);
  assert.equal(summary.totalAttempts, 30);
  assert.equal(summary.preview.p95Ms, 800);
  assert.equal(summary.acceptance.p95Ms, 90);
  assert.equal(summary.checks.minimumPilotCohort, true);
  assert.equal(summary.checks.usefulResultRateMet, true);
  assert.equal(summary.checks.previewP95WithinTarget, true);
  assert.equal(summary.checks.acceptanceP95WithinTarget, true);
  assert.equal(summary.productionQualified, false);
});

test("qualification summary refuses to combine different build or policy configurations", () => {
  const changed = attempt(2, { configuration: { ...configuration, model: "different-model" } });
  assert.throws(
    () => summarizePreTradePreviewQualification([attempt(1), changed]),
    (error) => error.code === "MIXED_QUALIFICATION_CONFIGURATION",
  );
});

test("partial response-loss attempts remain in cohorts and reduce timing coverage", () => {
  const partial = attempt(2, { receiptCommittedAt: null, resultVisibleAt: null, result: "OUTCOME_UNKNOWN", usefulResult: false });
  const summary = summarizePreTradePreviewQualification([attempt(), partial]);
  assert.equal(summary.supportedAttempts, 2);
  assert.equal(summary.acceptance.count, 1);
  assert.equal(summary.checks.completeAcceptanceTiming, false);
  assert.equal(summary.usefulResultRate, 0.5);
  assert.equal(summary.checks.combinedTargetDefined, true);
  assert.equal(summary.checks.combinedP95WithinTarget, false);
});

test("cohorts reject duplicate attempts and cross-stage timing reversals", () => {
  assert.throws(() => summarizePreTradePreviewQualification([attempt(), attempt()]), { code: "DUPLICATE_QUALIFICATION_ATTEMPT" });
  assert.throws(() => buildPreTradePreviewQualificationAttempt(attempt(1, { previewCreatedAt: "2026-09-21T15:00:02.000Z" })), { code: "INVALID_QUALIFICATION_TIMING" });
});

test("combined latency uses paired attempt intervals and reports the review convention explicitly", () => {
  const rows = [attempt(1, { acceptanceRequestedAt: "2026-09-21T15:02:00Z", receiptCommittedAt: "2026-09-21T15:02:01Z", resultVisibleAt: "2026-09-21T15:02:02Z" })];
  const excluding = summarizePreTradePreviewQualification(rows, { combinedTargetMs: 30_000, excludeOperatorReview: true });
  assert.equal(excluding.combinedExcludingOperatorReview.p95Ms, 2800);
  assert.equal(excluding.checks.combinedP95WithinTarget, true);
  const including = summarizePreTradePreviewQualification(rows, { combinedTargetMs: 30_000, excludeOperatorReview: false });
  assert.equal(including.combinedIncludingOperatorReview.p95Ms, 121000);
  assert.equal(including.checks.combinedP95WithinTarget, false);
  assert.equal(including.productionQualified, false);
});

test("an authority violation on an unsupported attempt cannot disappear from the report", () => {
  const summary = summarizePreTradePreviewQualification([attempt(1, { supportedAttempt: false, authorityViolation: true })]);
  assert.equal(summary.authorityViolations, 1);
  assert.equal(summary.checks.zeroAuthorityViolations, false);
});

test("approved targets reject separate passing stages whose combined time exceeds 30 seconds", () => {
  const row = attempt(1, {
    previewCreatedAt: "2026-09-21T15:00:28Z", previewVisibleAt: "2026-09-21T15:00:29Z",
    acceptanceRequestedAt: "2026-09-21T15:02:00Z", receiptCommittedAt: "2026-09-21T15:02:03Z",
    resultVisibleAt: "2026-09-21T15:02:04Z",
  });
  const summary = summarizePreTradePreviewQualification([row]);
  assert.equal(summary.checks.approvedTimingTargetsApplied, true);
  assert.equal(summary.checks.previewP95WithinTarget, true);
  assert.equal(summary.checks.acceptanceP95WithinTarget, true);
  assert.equal(summary.checks.combinedP95WithinTarget, false);
  assert.equal(summary.combinedExcludingOperatorReview.p95Ms, 32000);
});

test("active refresh work during review counts once even when intervals overlap the click", () => {
  const row = attempt(1, {
    acceptanceRequestedAt: "2026-09-21T15:01:00Z", receiptCommittedAt: "2026-09-21T15:01:01Z",
    resultVisibleAt: "2026-09-21T15:01:02Z",
    activeReviewIntervals: [
      { startedAt: "2026-09-21T15:00:10Z", finishedAt: "2026-09-21T15:00:30Z" },
      { startedAt: "2026-09-21T15:00:20Z", finishedAt: "2026-09-21T15:00:40Z" },
      { startedAt: "2026-09-21T15:00:59Z", finishedAt: "2026-09-21T15:01:01Z" },
    ],
  });
  const summary = summarizePreTradePreviewQualification([row]);
  const record = buildPreTradePreviewQualificationAttempt(row);
  assert.equal(record.durations.activeSystemWorkDuringReviewMs, 31000);
  assert.equal(record.durations.combinedExcludingOperatorReviewMs, 33800);
  assert.equal(record.durations.humanReviewMs, 27200);
  assert.equal(summary.checks.combinedP95WithinTarget, false);
});

test("unmeasured refresh work or clock uncertainty cannot pass combined qualification", () => {
  for (const changes of [
    { activeReviewIntervals: undefined },
    { activeReviewIntervals: [{ startedAt: "2026-09-21T15:00:01.850Z", finishedAt: null }] },
    { timingUncertaintyMs: null },
  ]) {
    const summary = summarizePreTradePreviewQualification([attempt(1, changes)]);
    assert.equal(summary.checks.completeCombinedTiming, false);
    assert.equal(summary.checks.combinedP95WithinTarget, false);
  }
  const uncertain = summarizePreTradePreviewQualification([attempt(1, { timingUncertaintyMs: 29500 })]);
  assert.equal(uncertain.combinedExcludingOperatorReview.p95Ms, 890);
  assert.equal(uncertain.conservativeUpperBounds.combined.p95Ms, 30390);
  assert.equal(uncertain.checks.combinedP95WithinTarget, false);
});

test("no-setup outcomes are N/A for acceptance; unknown attempted outcomes remain failures", () => {
  const noSetup = attempt(2, { acceptanceRequestedAt: null, receiptCommittedAt: null, resultVisibleAt: null, result: "NO_SETUP" });
  const summary = summarizePreTradePreviewQualification([attempt(), noSetup]);
  assert.equal(summary.supportedAttempts, 2);
  assert.equal(summary.acceptanceAttempts, 1);
  assert.equal(summary.acceptanceNotApplicable, 1);
  assert.equal(summary.checks.completeAcceptanceTiming, true);
  assert.equal(summary.checks.combinedP95WithinTarget, true);
  const onlyNoSetup = summarizePreTradePreviewQualification([noSetup]);
  assert.equal(onlyNoSetup.checks.acceptanceP95WithinTarget, false);
  assert.equal(onlyNoSetup.checks.combinedP95WithinTarget, false);
  const lost = { ...noSetup, result: "OUTCOME_UNKNOWN", usefulResult: false };
  const incomplete = summarizePreTradePreviewQualification([attempt(), lost]);
  assert.equal(incomplete.acceptanceAttempts, 2);
  assert.equal(incomplete.checks.completeAcceptanceTiming, false);
  assert.equal(incomplete.checks.combinedP95WithinTarget, false);
  assert.throws(() => buildPreTradePreviewQualificationAttempt({ ...lost, acceptanceApplicable: false }), { code: "INVALID_QUALIFICATION_ATTEMPT" });
  const ambiguousError = { ...noSetup, result: "ERROR", usefulResult: false };
  assert.equal(summarizePreTradePreviewQualification([ambiguousError]).acceptanceAttempts, 1);
  assert.equal(summarizePreTradePreviewQualification([{ ...ambiguousError, acceptanceApplicable: false }]).acceptanceAttempts, 0);
});

test("failed attempts with quick error responses do not count as meeting the latency target", () => {
  const summary = summarizePreTradePreviewQualification([attempt(1, { result: "ERROR", usefulResult: false })]);
  assert.equal(summary.withinTargetCounts.preview, 0);
  assert.equal(summary.checks.combinedP95WithinTarget, false);
});
