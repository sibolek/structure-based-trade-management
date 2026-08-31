import assert from "node:assert/strict";
import test from "node:test";
import { DSS_POLICY_V1 } from "../schwab-bridge/dss-policy.mjs";
import {
  DSS_CALCULATOR_VERSION,
  DSS_STATUS,
  dssInputHash,
  evaluateDss,
} from "../schwab-bridge/dss-evaluator.mjs";

const RTH_NOW = Date.parse("2026-08-31T14:35:05Z");
const CURRENT_OPEN = Date.parse("2026-08-31T13:30:00Z");
const CURRENT_LATEST_EXPECTED = Date.parse("2026-08-31T14:32:00Z");

function priorTradingDays() {
  const days = [];
  for (let day = 3; day <= 28; day += 1) {
    const date = new Date(Date.UTC(2026, 7, day));
    if (![0, 6].includes(date.getUTCDay())) days.push(day);
  }
  return days.slice(0, 20);
}

function bar(timestamp, {
  symbol = "META",
  close = 100,
  complete = true,
} = {}) {
  return {
    symbol,
    timeframe: "2m",
    source: "SCHWAB",
    timestamp,
    time: new Date(timestamp).toISOString(),
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: 1000,
    complete,
  };
}

function reconstructionBars({ includeCurrent = true } = {}) {
  const bars = priorTradingDays().map((day) => bar(Date.UTC(2026, 7, day, 13, 30)));
  if (includeCurrent) {
    for (let timestamp = CURRENT_OPEN; timestamp <= CURRENT_LATEST_EXPECTED; timestamp += 120_000) {
      bars.push(bar(timestamp));
    }
  }
  return bars;
}

function compoundStructuralDefinition() {
  return {
    composition: "ALL_OF",
    conditions: [
      {
        rule: "FAILED_HOLD_OR_RECLAIM",
        referenceType: "PMH",
        sourceTimeframe: "2m",
        resolutionMode: "STATIC_PRICE",
        price: 100,
        reason: "Decisive failure back below PMH.",
      },
      {
        rule: "LOSS_OF_DYNAMIC_STRUCTURE",
        referenceType: "BREAKOUT_PULLBACK_LOW",
        sourceTimeframe: "2m",
        resolutionMode: "DYNAMIC_REFERENCE",
        reason: "Loss of the pullback low.",
      },
    ],
    narrative: "Compound structure remains preserved upstream.",
  };
}

function validInput() {
  return {
    candidate: {
      candidateId: "sod-2026-08-31-meta-long-01",
      sourceId: "SOD_A_PLUS",
      contractVersion: 1,
      candidateContentHash: "candidate-hash-001",
      symbol: "META",
      direction: "LONG",
      decisionTimeframe: "5m",
      entryTimeframe: "2m",
    },
    structuralInvalidationDefinition: compoundStructuralDefinition(),
    structureEvaluation: {
      status: "VALID",
      evaluatedAt: "2026-08-31T14:34:30.000Z",
      evaluationReference: "structure-eval-001",
      resolvedPrice: 100,
      evidenceReference: "market-snapshot-structure-001",
    },
    marketSnapshot: {
      snapshotId: "snapshot-001",
      provider: "SCHWAB",
      capturedAt: "2026-08-31T14:35:05.000Z",
      quote: {
        symbol: "META",
        source: "SCHWAB",
        bid: 101,
        ask: 101.02,
        last: 101.01,
        mark: 101.01,
        asOf: "2026-08-31T14:35:04.000Z",
      },
      executionBars: reconstructionBars(),
    },
    instrument: {
      instrumentType: "EQUITY",
      priceIncrement: 0.01,
      instrumentValueMetadata: { valuePerPoint: 1 },
    },
    dssPolicy: { ...DSS_POLICY_V1 },
    calculation: {
      calculatorVersion: DSS_CALCULATOR_VERSION,
    },
  };
}

function evaluate(input, {
  nowMs = RTH_NOW,
  id = "dss-eval-test-001",
} = {}) {
  return evaluateDss(input, {
    nowMs,
    idFactory: () => id,
  });
}

test("VALID evaluation preserves compound structure and complete Phase 3 provenance", () => {
  const input = validInput();
  const result = evaluate(input);

  assert.equal(result.status, DSS_STATUS.VALID);
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.dssEvaluationId, "dss-eval-test-001");
  assert.equal(result.candidateId, input.candidate.candidateId);
  assert.equal(result.sourceId, "SOD_A_PLUS");
  assert.equal(result.candidateContractVersion, 1);
  assert.equal(result.candidateContentHash, "candidate-hash-001");
  assert.deepEqual(result.structuralInvalidationDefinition, input.structuralInvalidationDefinition);
  assert.equal(result.structuralInvalidationDefinition.composition, "ALL_OF");
  assert.equal(result.resolvedStructuralInvalidationPrice, 100);
  assert.equal(result.atrMethod, "WILDER_RMA");
  assert.equal(result.atrPeriod, 14);
  assert.equal(result.atrTimeframe, "2m");
  assert.equal(result.atrSourceSession, "RTH");
  assert.equal(result.atrReconstructionWindow.requiredCompletedRthSessions, 20);
  assert.equal(result.atrReconstructionWindow.completedRthSessionsObserved, 20);
  assert.equal(result.latestCompletedBar.timestamp, CURRENT_LATEST_EXPECTED);
  assert.equal(result.snapshotId, "snapshot-001");
  assert.equal(result.provider, "SCHWAB");
  assert.equal(result.quoteAgeMs, 1000);
  assert.equal(result.policyId, DSS_POLICY_V1.policyId);
  assert.equal(result.policyVersion, DSS_POLICY_V1.policyVersion);
  assert.equal(result.calculatorVersion, DSS_CALCULATOR_VERSION);
  assert.equal(typeof result.priorAtrValue, "number");
  assert.equal(typeof result.currentTrueRange, "number");
  assert.equal(typeof result.atrValue, "number");
  assert.equal(typeof result.rawVolatilityBuffer, "number");
  assert.equal(typeof result.rawEffectiveStop, "number");
  assert.equal(typeof result.roundingAdjustment, "number");
  assert.equal(typeof result.effectiveStop, "number");
  assert.equal(typeof result.appliedBuffer, "number");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.structureEvaluation), true);
  assert.equal(Object.isFrozen(result.structuralInvalidationDefinition), true);
});

test("DSS input hash is stable across object key ordering", () => {
  assert.equal(
    dssInputHash({ b: 2, a: { d: 4, c: 3 } }),
    dssInputHash({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test("stale quote BLOCKS evaluation without producing an effective stop", () => {
  const input = validInput();
  input.marketSnapshot.quote.asOf = "2026-08-31T14:34:00.000Z";

  const result = evaluate(input);
  assert.equal(result.status, DSS_STATUS.BLOCKED);
  assert.ok(result.reasonCodes.includes("STALE_OR_INVALID_QUOTE"));
  assert.equal(result.effectiveStop, null);
});

test("previous completed bar remains usable only inside the 10-second publication grace", () => {
  const input = validInput();
  input.marketSnapshot.executionBars = input.marketSnapshot.executionBars
    .filter((item) => item.timestamp !== Date.parse("2026-08-31T14:32:00Z"));
  input.marketSnapshot.quote.asOf = "2026-08-31T14:34:04.000Z";

  const result = evaluate(input, {
    nowMs: Date.parse("2026-08-31T14:34:05.000Z"),
  });

  assert.equal(result.status, DSS_STATUS.VALID);
  assert.equal(result.latestCompletedBar.timestamp, Date.parse("2026-08-31T14:30:00Z"));
});

test("missing expected completed bar BLOCKS after publication grace expires", () => {
  const input = validInput();
  input.marketSnapshot.executionBars = input.marketSnapshot.executionBars
    .filter((item) => item.timestamp !== Date.parse("2026-08-31T14:32:00Z"));
  input.marketSnapshot.quote.asOf = "2026-08-31T14:34:10.000Z";

  const result = evaluate(input, {
    nowMs: Date.parse("2026-08-31T14:34:11.000Z"),
  });

  assert.equal(result.status, DSS_STATUS.BLOCKED);
  assert.ok(result.reasonCodes.includes("EXPECTED_COMPLETED_BAR_MISSING"));
});

test("invalid or unresolved structure BLOCKS instead of being guessed by DSS", () => {
  const input = validInput();
  input.structureEvaluation.status = "BLOCKED";
  input.structureEvaluation.resolvedPrice = null;

  const result = evaluate(input);
  assert.equal(result.status, DSS_STATUS.BLOCKED);
  assert.ok(result.reasonCodes.includes("STRUCTURE_EVALUATION_NOT_VALID"));
  assert.ok(result.reasonCodes.includes("INVALID_RESOLVED_STRUCTURAL_PRICE"));
  assert.equal(result.effectiveStop, null);
});

test("invalid price increment BLOCKS before stop calculation", () => {
  const input = validInput();
  input.instrument.priceIncrement = 0;

  const result = evaluate(input);
  assert.equal(result.status, DSS_STATUS.BLOCKED);
  assert.ok(result.reasonCodes.includes("INVALID_PRICE_INCREMENT"));
  assert.equal(result.effectiveStop, null);
});

test("insufficient 20-session ATR reconstruction history BLOCKS", () => {
  const input = validInput();
  const allowedPriorDates = new Set(priorTradingDays().slice(0, 10));
  input.marketSnapshot.executionBars = input.marketSnapshot.executionBars.filter((item) => {
    const date = new Date(item.timestamp);
    return date.getUTCDate() === 31 || allowedPriorDates.has(date.getUTCDate());
  });

  const result = evaluate(input);
  assert.equal(result.status, DSS_STATUS.BLOCKED);
  assert.ok(result.reasonCodes.includes("INSUFFICIENT_ATR_RECONSTRUCTION_SESSIONS"));
});

test("missing internal 2-minute interval and duplicate interval both fail closed", () => {
  const missing = validInput();
  missing.marketSnapshot.executionBars = missing.marketSnapshot.executionBars
    .filter((item) => item.timestamp !== Date.parse("2026-08-31T14:00:00Z"));
  const missingResult = evaluate(missing);
  assert.equal(missingResult.status, DSS_STATUS.BLOCKED);
  assert.ok(missingResult.reasonCodes.includes("MISSING_OR_MISALIGNED_EXECUTION_BAR"));

  const duplicate = validInput();
  duplicate.marketSnapshot.executionBars.push(
    structuredClone(duplicate.marketSnapshot.executionBars.at(-1)),
  );
  const duplicateResult = evaluate(duplicate);
  assert.equal(duplicateResult.status, DSS_STATUS.BLOCKED);
  assert.ok(duplicateResult.reasonCodes.includes("DUPLICATE_EXECUTION_BAR"));
});

test("forming or incomplete bars never enter DSS ATR", () => {
  const input = validInput();
  input.marketSnapshot.executionBars.at(-1).complete = false;

  const result = evaluate(input);
  assert.equal(result.status, DSS_STATUS.BLOCKED);
  assert.ok(result.reasonCodes.includes("INCOMPLETE_EXECUTION_BAR"));
});

test("current RTH reconstruction must begin at the 09:30 ET bar", () => {
  const input = validInput();
  input.marketSnapshot.executionBars = input.marketSnapshot.executionBars
    .filter((item) => item.timestamp !== CURRENT_OPEN);

  const result = evaluate(input);
  assert.equal(result.status, DSS_STATUS.BLOCKED);
  assert.ok(result.reasonCodes.includes("CURRENT_SESSION_OPEN_BAR_MISSING"));
});

test("premarket evaluation uses the most recent valid RTH ATR without PM bars", () => {
  const input = validInput();
  input.marketSnapshot.executionBars = reconstructionBars({ includeCurrent: false });
  input.marketSnapshot.capturedAt = "2026-08-31T12:00:05.000Z";
  input.marketSnapshot.quote.asOf = "2026-08-31T12:00:04.000Z";

  const result = evaluate(input, {
    nowMs: Date.parse("2026-08-31T12:00:05.000Z"),
  });

  assert.equal(result.status, DSS_STATUS.VALID);
  assert.equal(result.evaluationSession, "PREMARKET");
  assert.equal(result.atrSourceSession, "RTH");
});

test("after-hours evaluation blocks if today's supplied RTH session is truncated", () => {
  const input = validInput();
  input.marketSnapshot.capturedAt = "2026-08-31T20:05:05.000Z";
  input.marketSnapshot.quote.asOf = "2026-08-31T20:05:04.000Z";

  const result = evaluate(input, {
    nowMs: Date.parse("2026-08-31T20:05:05.000Z"),
  });

  assert.equal(result.status, DSS_STATUS.BLOCKED);
  assert.ok(result.reasonCodes.includes("CURRENT_SESSION_RTH_INCOMPLETE"));
});

test("tampered trusted policy and calculator contracts return ERROR", () => {
  const badPolicy = validInput();
  badPolicy.dssPolicy.bufferMultiplier = 0.99;
  const policyResult = evaluate(badPolicy);
  assert.equal(policyResult.status, DSS_STATUS.ERROR);
  assert.deepEqual(policyResult.reasonCodes, ["DSS_POLICY_CONTRACT_ERROR"]);

  const badCalculator = validInput();
  badCalculator.calculation.calculatorVersion = "UNTRUSTED";
  const calculatorResult = evaluate(badCalculator);
  assert.equal(calculatorResult.status, DSS_STATUS.ERROR);
  assert.deepEqual(calculatorResult.reasonCodes, ["DSS_CALCULATOR_CONTRACT_ERROR"]);
});
