import crypto from "node:crypto";
import { canonicalJson } from "./canonical-json.mjs";
import { timestampIso, timestampMs } from "./clock-freshness.mjs";

export const PRETRADE_PREVIEW_QUALIFICATION_SCHEMA_VERSION = 2;

export const APPROVED_PREVIEW_TIMING_TARGETS = Object.freeze({
  previewTargetMs: 30_000,
  acceptanceTargetMs: 5_000,
  combinedTargetMs: 30_000,
  excludeOperatorReview: true,
});

const CONFIGURATION_FIELDS = Object.freeze([
  "buildSha",
  "model",
  "reasoningEffort",
  "promptVersion",
  "outputSchemaVersion",
  "profileVersion",
  "policyId",
  "policyVersion",
]);

const ATTEMPT_FIELDS = new Set([
  "attemptId",
  "configuration",
  "runId",
  "previewId",
  "operationId",
  "proposalHash",
  "chartReceivedAt",
  "providerStartedAt",
  "providerFinishedAt",
  "preflightStartedAt",
  "previewCreatedAt",
  "previewVisibleAt",
  "acceptanceRequestedAt",
  "receiptCommittedAt",
  "resultVisibleAt",
  "result",
  "reason",
  "supportedAttempt",
  "usefulResult",
  "materialExtractionError",
  "authorityViolation",
  "acceptanceApplicable",
  "activeReviewIntervals",
  "timingUncertaintyMs",
]);

function text(value) {
  return String(value ?? "").trim();
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalJson(value))).digest("hex");
}

function immutable(value) {
  const clone = structuredClone(value);
  const freeze = (item) => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return item;
    for (const child of Object.values(item)) freeze(child);
    return Object.freeze(item);
  };
  return freeze(clone);
}

function qualificationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredText(value, field) {
  const normalized = text(value);
  if (!normalized) throw qualificationError(`${field} is required`, "INVALID_QUALIFICATION_ATTEMPT");
  return normalized;
}

function optionalText(value) {
  return text(value) || null;
}

function time(value, field, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) throw qualificationError(`${field} is required`, "INVALID_QUALIFICATION_TIMING");
    return null;
  }
  const normalized = timestampIso(value);
  if (!normalized) throw qualificationError(`${field} is invalid`, "INVALID_QUALIFICATION_TIMING");
  return normalized;
}

function elapsed(start, end, field) {
  if (!start || !end) return null;
  const duration = timestampMs(end) - timestampMs(start);
  if (!Number.isFinite(duration) || duration < 0) {
    throw qualificationError(`${field} timing is out of order`, "INVALID_QUALIFICATION_TIMING");
  }
  return duration;
}

function activeReviewTime(input, previewVisibleAt, acceptanceRequestedAt) {
  if (input === undefined) return { intervals: [], durationMs: 0, complete: false };
  if (!Array.isArray(input) || input.length > 128) {
    throw qualificationError("active review intervals must be a bounded array", "INVALID_QUALIFICATION_TIMING");
  }
  let complete = true;
  const intervals = input.map((interval) => {
    if (!interval || typeof interval !== "object" || Array.isArray(interval)
      || Object.keys(interval).some(key => !["startedAt", "finishedAt"].includes(key))) {
      throw qualificationError("invalid active review interval", "INVALID_QUALIFICATION_TIMING");
    }
    const startedAt = time(interval.startedAt, "active review start", { required: true });
    const finishedAt = time(interval.finishedAt, "active review finish");
    if (!previewVisibleAt || timestampMs(startedAt) < timestampMs(previewVisibleAt)) {
      throw qualificationError("active review work must start after preview visibility", "INVALID_QUALIFICATION_TIMING");
    }
    if (finishedAt) elapsed(startedAt, finishedAt, "active review work");
    else complete = false;
    return { startedAt, finishedAt };
  });
  // Work after the click is already in the acceptance interval; only add the
  // union during review, including waits for required refresh/recovery work.
  if (!acceptanceRequestedAt) return { intervals, durationMs: 0, complete };
  const end = timestampMs(acceptanceRequestedAt);
  const ranges = intervals.filter(item => item.finishedAt).map(item => [
    timestampMs(item.startedAt), Math.min(timestampMs(item.finishedAt), end),
  ]).filter(([start, finish]) => finish > start).sort((a, b) => a[0] - b[0]);
  let durationMs = 0;
  let previousEnd = -Infinity;
  for (const [start, finish] of ranges) {
    durationMs += Math.max(0, finish - Math.max(start, previousEnd));
    previousEnd = Math.max(previousEnd, finish);
  }
  return { intervals, durationMs, complete };
}

function normalizedConfiguration(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw qualificationError("configuration is required", "INVALID_QUALIFICATION_CONFIGURATION");
  }
  const unexpected = Object.keys(input).filter((field) => !CONFIGURATION_FIELDS.includes(field));
  if (unexpected.length) {
    throw qualificationError(`configuration has unexpected fields: ${unexpected.join(", ")}`, "INVALID_QUALIFICATION_CONFIGURATION");
  }
  return Object.fromEntries(CONFIGURATION_FIELDS.map((field) => [field, requiredText(input[field], `configuration.${field}`)]));
}

export function buildPreTradePreviewQualificationAttempt(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw qualificationError("qualification attempt must be an object", "INVALID_QUALIFICATION_ATTEMPT");
  }
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > 64 * 1024) {
    throw qualificationError("qualification attempt exceeds 64 KiB", "INVALID_QUALIFICATION_ATTEMPT");
  }
  const unexpected = Object.keys(input).filter((field) => !ATTEMPT_FIELDS.has(field));
  if (unexpected.length) {
    throw qualificationError(`qualification attempt has unexpected fields: ${unexpected.join(", ")}`, "INVALID_QUALIFICATION_ATTEMPT");
  }
  const configuration = normalizedConfiguration(input.configuration);
  const chartReceivedAt = time(input.chartReceivedAt, "chartReceivedAt", { required: true });
  const providerStartedAt = time(input.providerStartedAt, "providerStartedAt");
  const providerFinishedAt = time(input.providerFinishedAt, "providerFinishedAt");
  const preflightStartedAt = time(input.preflightStartedAt, "preflightStartedAt");
  const previewCreatedAt = time(input.previewCreatedAt, "previewCreatedAt");
  const previewVisibleAt = time(input.previewVisibleAt, "previewVisibleAt");
  const acceptanceRequestedAt = time(input.acceptanceRequestedAt, "acceptanceRequestedAt");
  const receiptCommittedAt = time(input.receiptCommittedAt, "receiptCommittedAt");
  const resultVisibleAt = time(input.resultVisibleAt, "resultVisibleAt");
  // Partial attempts (timeouts, response loss, discard) remain in the denominator.
  const orderedTimes = [chartReceivedAt, providerStartedAt, providerFinishedAt,
    preflightStartedAt, previewCreatedAt, previewVisibleAt, acceptanceRequestedAt,
    receiptCommittedAt, resultVisibleAt].filter(Boolean);
  for (let index = 1; index < orderedTimes.length; index += 1) {
    elapsed(orderedTimes[index - 1], orderedTimes[index], "workflow");
  }
  if (providerFinishedAt && !providerStartedAt) {
    throw qualificationError("provider finish requires start", "INVALID_QUALIFICATION_TIMING");
  }
  if ((receiptCommittedAt || resultVisibleAt) && !acceptanceRequestedAt) {
    throw qualificationError("admission result requires original acceptance time", "INVALID_QUALIFICATION_TIMING");
  }
  const result = requiredText(input.result, "result").toUpperCase();
  const hasAcceptance = Boolean(acceptanceRequestedAt || receiptCommittedAt || resultVisibleAt)
    || ["ADMITTED", "ALREADY_PRESENT", "NOT_ADMITTED", "ACCEPTING", "OUTCOME_UNKNOWN"].includes(result);
  if (input.acceptanceApplicable !== undefined && typeof input.acceptanceApplicable !== "boolean") {
    throw qualificationError("acceptance applicability must be boolean", "INVALID_QUALIFICATION_ATTEMPT");
  }
  if (hasAcceptance && input.acceptanceApplicable === false) {
    throw qualificationError("attempted acceptance cannot be excluded", "INVALID_QUALIFICATION_ATTEMPT");
  }
  const knownWithoutAcceptance = ["NO_SETUP", "NEEDS_CONTEXT", "UNSUPPORTED", "DISCARDED", "PREVIEW_READY", "BLOCKED"].includes(result);
  // Ambiguous errors with missing click telemetry must not silently disappear
  // from the admission denominator. A collector may explicitly identify a
  // pre-acceptance failure, but cannot override actual acceptance evidence.
  const acceptanceApplicable = hasAcceptance || input.acceptanceApplicable === true
    || (input.acceptanceApplicable === undefined && !knownWithoutAcceptance);
  const reviewWork = activeReviewTime(input.activeReviewIntervals, previewVisibleAt, acceptanceRequestedAt);
  const timingUncertaintyMs = input.timingUncertaintyMs ?? null;
  if (timingUncertaintyMs !== null && (typeof timingUncertaintyMs !== "number"
    || !Number.isFinite(timingUncertaintyMs) || timingUncertaintyMs < 0)) {
    throw qualificationError("timing uncertainty must be nonnegative milliseconds", "INVALID_QUALIFICATION_TIMING");
  }
  const durations = {
    providerMs: elapsed(providerStartedAt, providerFinishedAt, "provider"),
    preflightMs: elapsed(preflightStartedAt, previewCreatedAt, "preflight"),
    chartReceiptToPreviewVisibleMs: elapsed(chartReceivedAt, previewVisibleAt, "chart receipt to preview visibility"),
    operatorReviewMs: elapsed(previewVisibleAt, acceptanceRequestedAt, "operator review"),
    acceptanceToDurableReceiptMs: elapsed(acceptanceRequestedAt, receiptCommittedAt, "acceptance to durable receipt"),
    receiptToReconciledVisibleMs: elapsed(receiptCommittedAt, resultVisibleAt, "receipt to reconciled visibility"),
    acceptanceToReconciledVisibleMs: elapsed(acceptanceRequestedAt, resultVisibleAt, "acceptance to reconciled visibility"),
    combinedIncludingOperatorReviewMs: elapsed(chartReceivedAt, resultVisibleAt, "combined workflow"),
  };
  durations.combinedExcludingOperatorReviewMs = durations.chartReceiptToPreviewVisibleMs === null
    || durations.acceptanceToReconciledVisibleMs === null
    || !reviewWork.complete
    ? null
    : durations.chartReceiptToPreviewVisibleMs + durations.acceptanceToReconciledVisibleMs + reviewWork.durationMs;
  durations.activeSystemWorkDuringReviewMs = reviewWork.complete ? reviewWork.durationMs : null;
  durations.humanReviewMs = durations.operatorReviewMs === null || !reviewWork.complete
    ? null : Math.max(0, durations.operatorReviewMs - reviewWork.durationMs);

  return immutable({
    schemaVersion: PRETRADE_PREVIEW_QUALIFICATION_SCHEMA_VERSION,
    attemptId: requiredText(input.attemptId, "attemptId"),
    configuration,
    configurationHash: digest(configuration),
    runId: optionalText(input.runId),
    previewId: optionalText(input.previewId),
    operationId: optionalText(input.operationId),
    proposalHash: optionalText(input.proposalHash),
    stageTimes: {
      chartReceivedAt,
      providerStartedAt,
      providerFinishedAt,
      preflightStartedAt,
      previewCreatedAt,
      previewVisibleAt,
      acceptanceRequestedAt,
      receiptCommittedAt,
      resultVisibleAt,
    },
    durations,
    result,
    acceptanceApplicable,
    activeReviewIntervals: reviewWork.intervals,
    activeReviewTimingComplete: reviewWork.complete,
    timingUncertaintyMs,
    reason: optionalText(input.reason),
    supportedAttempt: input.supportedAttempt === true,
    usefulResult: input.usefulResult === true,
    materialExtractionError: input.materialExtractionError === true,
    authorityViolation: input.authorityViolation === true,
  });
}

function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return Object.freeze({ count: 0, medianMs: null, p95Ms: null, maxMs: null });
  const midpoint = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  return Object.freeze({
    count: sorted.length,
    medianMs,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
  });
}

export function summarizePreTradePreviewQualification(attempts, {
  previewTargetMs = APPROVED_PREVIEW_TIMING_TARGETS.previewTargetMs,
  acceptanceTargetMs = APPROVED_PREVIEW_TIMING_TARGETS.acceptanceTargetMs,
  minimumPilotAttempts = 30,
  minimumUsefulResultRate = 0.95,
  combinedTargetMs = APPROVED_PREVIEW_TIMING_TARGETS.combinedTargetMs,
  excludeOperatorReview = APPROVED_PREVIEW_TIMING_TARGETS.excludeOperatorReview,
} = {}) {
  if (!Array.isArray(attempts) || !attempts.length) {
    throw qualificationError("at least one qualification attempt is required", "INVALID_QUALIFICATION_COHORT");
  }
  const records = attempts.map((attempt) => buildPreTradePreviewQualificationAttempt(attempt));
  for (const field of ["attemptId", "operationId"]) {
    const ids = records.map((record) => record[field]).filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      throw qualificationError(`qualification cohort repeats ${field}`, "DUPLICATE_QUALIFICATION_ATTEMPT");
    }
  }
  const configurationHash = records[0].configurationHash;
  if (records.some((record) => record.configurationHash !== configurationHash)) {
    throw qualificationError("qualification cohort mixes different configurations", "MIXED_QUALIFICATION_CONFIGURATION");
  }
  const supported = records.filter((record) => record.supportedAttempt);
  const admissionAttempts = supported.filter(record => record.acceptanceApplicable);
  const preview = distribution(supported.map((record) => record.durations.chartReceiptToPreviewVisibleMs));
  const acceptance = distribution(admissionAttempts.map((record) => record.durations.acceptanceToReconciledVisibleMs));
  const supportedCount = supported.length;
  const usefulCount = supported.filter((record) => record.usefulResult).length;
  const materialExtractionErrors = supported.filter((record) => record.materialExtractionError).length;
  const authorityViolations = records.filter((record) => record.authorityViolation).length;
  const operatorReview = distribution(supported.map((record) => record.durations.operatorReviewMs));
  const durableReceipt = distribution(supported.map((record) => record.durations.acceptanceToDurableReceiptMs));
  const reconciliation = distribution(supported.map((record) => record.durations.receiptToReconciledVisibleMs));
  const combinedIncludingOperatorReview = distribution(admissionAttempts.map((record) => record.durations.combinedIncludingOperatorReviewMs));
  const combinedExcludingOperatorReview = distribution(admissionAttempts.map((record) => record.durations.combinedExcludingOperatorReviewMs));
  const combinedTargetDefined = typeof excludeOperatorReview === "boolean" && Number.isFinite(combinedTargetMs) && combinedTargetMs > 0;
  const upperBound = (rows, key) => distribution(rows.map(record => (
    record.durations[key] === null || record.timingUncertaintyMs === null ? null
      : record.durations[key] + record.timingUncertaintyMs
  )));
  const previewUpperBound = upperBound(supported, "chartReceiptToPreviewVisibleMs");
  const acceptanceUpperBound = upperBound(admissionAttempts, "acceptanceToReconciledVisibleMs");
  const combinedUpperBound = upperBound(admissionAttempts, excludeOperatorReview
    ? "combinedExcludingOperatorReviewMs" : "combinedIncludingOperatorReviewMs");
  // A missing/late/failed attempt cannot be hidden by a percentile over only
  // successful timings. N/A is reserved for runs where acceptance was not attempted.
  const within = (rows, key, limit) => rows.filter(record => record.durations[key] !== null
    && !["ERROR", "TIMEOUT", "OUTCOME_UNKNOWN", "ACCEPTING"].includes(record.result)
    && record.timingUncertaintyMs !== null && record.durations[key] + record.timingUncertaintyMs <= limit).length;
  const previewWithin = within(supported, "chartReceiptToPreviewVisibleMs", previewTargetMs);
  const acceptanceWithin = within(admissionAttempts, "acceptanceToReconciledVisibleMs", acceptanceTargetMs);
  const combinedWithin = within(admissionAttempts, excludeOperatorReview
    ? "combinedExcludingOperatorReviewMs" : "combinedIncludingOperatorReviewMs", combinedTargetMs);
  const meets95 = (count, population) => population > 0 && count >= Math.ceil(population * 0.95);
  const resultCounts = Object.fromEntries([...new Set(records.map((record) => record.result))]
    .sort()
    .map((result) => [result, records.filter((record) => record.result === result).length]));
  const usefulResultRate = supportedCount ? usefulCount / supportedCount : null;
  return immutable({
    schemaVersion: PRETRADE_PREVIEW_QUALIFICATION_SCHEMA_VERSION,
    configuration: records[0].configuration,
    configurationHash,
    totalAttempts: records.length,
    supportedAttempts: supportedCount,
    acceptanceAttempts: admissionAttempts.length,
    acceptanceNotApplicable: supportedCount - admissionAttempts.length,
    usefulResults: usefulCount,
    usefulResultRate,
    materialExtractionErrors,
    authorityViolations,
    resultCounts,
    preview,
    acceptance,
    operatorReview,
    durableReceipt,
    reconciliation,
    combinedIncludingOperatorReview,
    combinedExcludingOperatorReview,
    conservativeUpperBounds: { preview: previewUpperBound, acceptance: acceptanceUpperBound, combined: combinedUpperBound },
    withinTargetCounts: { preview: previewWithin, acceptance: acceptanceWithin, combined: combinedWithin },
    targets: { previewTargetMs, acceptanceTargetMs, minimumPilotAttempts, minimumUsefulResultRate, combinedTargetMs, excludeOperatorReview },
    checks: {
      fixedConfiguration: true,
      combinedTargetDefined,
      approvedTimingTargetsApplied: previewTargetMs === 30_000 && acceptanceTargetMs === 5_000
        && combinedTargetMs === 30_000 && excludeOperatorReview === true,
      completeCombinedTiming: admissionAttempts.length > 0 && combinedUpperBound.count === admissionAttempts.length,
      combinedP95WithinTarget: combinedTargetDefined && meets95(combinedWithin, admissionAttempts.length),
      minimumPilotCohort: supportedCount >= minimumPilotAttempts,
      completePreviewTiming: supportedCount > 0 && previewUpperBound.count === supportedCount,
      previewP95WithinTarget: meets95(previewWithin, supportedCount),
      completeAcceptanceTiming: admissionAttempts.length > 0 && acceptanceUpperBound.count === admissionAttempts.length,
      acceptanceP95WithinTarget: meets95(acceptanceWithin, admissionAttempts.length),
      usefulResultRateMet: usefulResultRate !== null && usefulResultRate >= minimumUsefulResultRate,
      zeroMaterialExtractionErrors: materialExtractionErrors === 0,
      zeroAuthorityViolations: authorityViolations === 0,
    },
    productionQualified: false,
  });
}
