import assert from "node:assert/strict";
import test from "node:test";
import { buildRiskEvaluation, validateRiskEvaluationContract } from "../schwab-bridge/risk-evaluation.mjs";

function candidate(overrides = {}) {
  return {
    candidateId: "cand-1",
    contractVersion: 1,
    contentHash: "hash-1",
    symbol: "NVDA",
    direction: "LONG",
    ...overrides,
  };
}

function dss(overrides = {}) {
  return {
    dssEvaluationId: "dss-1",
    evaluation: {
      dssEvaluationId: "dss-1",
      status: "VALID",
      candidateId: "cand-1",
      candidateContractVersion: 1,
      candidateContentHash: "hash-1",
      resolvedStructuralInvalidationPrice: 219,
      effectiveStop: 218.9,
      ...overrides,
    },
  };
}

function entry(overrides = {}) {
  return {
    status: "VALID",
    reasonCodes: [],
    entryMode: "MARKETABLE_NOW",
    currentExpectedEntry: 220,
    bid: 219.99,
    ask: 220,
    quoteObservedAt: "2026-09-01T17:00:00Z",
    quoteAgeMs: 100,
    quoteSource: "SCHWAB",
    expectedEntryRule: "ASK_MARKETABLE_LONG",
    ...overrides,
  };
}

function account(overrides = {}) {
  return {
    status: "VALID",
    reasonCodes: [],
    snapshot: {
      accountId: "acct",
      accountEquity: 13500,
      currency: "USD",
      observedAt: "2026-09-01T17:00:00Z",
      ageMs: 100,
      source: "SCHWAB",
      sourceSnapshotId: "snap",
    },
    ...overrides,
  };
}

function instrument(overrides = {}) {
  return {
    status: "VALID",
    reasonCodes: [],
    assetType: "EQUITY",
    symbol: "NVDA",
    currency: "USD",
    minimumQuantity: 1,
    quantityIncrement: 1,
    metadataSource: "SCHWAB_QUOTE",
    metadataVersion: "meta-1",
    ...overrides,
  };
}

function calc(overrides = {}) {
  return {
    status: "VALID",
    reasonCodes: [],
    riskFraction: 0.005,
    rawMaxDollarRisk: 67.5,
    maxDollarRisk: 67.5,
    budgetRoundingRule: "FLOOR_TO_CENT",
    riskDistance: 1.1,
    riskPerUnit: 1.1,
    rawQuantity: 61.36,
    finalQuantity: 61,
    quantityRoundingRule: "FLOOR_TO_VALID_INCREMENT",
    plannedDollarRisk: 67.1,
    plannedRiskFraction: 67.1 / 13500,
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildRiskEvaluation({
    riskEvaluationId: "risk-1",
    evaluatedAt: "2026-09-01T17:00:01Z",
    candidate: candidate(),
    dssHandoff: dss(),
    entryResult: entry(),
    accountResult: account(),
    instrumentResult: instrument(),
    calculationResult: calc(),
    ...overrides,
  });
}

test("builds immutable VALID evaluation with full provenance", () => {
  const result = build();
  assert.equal(result.status, "VALID");
  assert.equal(result.dss.dssEvaluationId, "dss-1");
  assert.equal(result.dss.structuralInvalidation, 219);
  assert.equal(result.dss.effectiveStop, 218.9);
  assert.equal(result.account.maxDollarRisk, 67.5);
  assert.equal(result.calculation.finalQuantity, 61);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.account), true);
});

test("input fingerprint ignores riskEvaluationId and evaluatedAt", () => {
  const a = build();
  const b = build({ riskEvaluationId: "risk-2", evaluatedAt: "2026-09-01T17:00:02Z" });
  assert.equal(a.inputFingerprint, b.inputFingerprint);
  assert.notEqual(a.riskEvaluationId, b.riskEvaluationId);
});

test("input fingerprint changes when sizing input changes", () => {
  const a = build();
  const b = build({ entryResult: entry({ currentExpectedEntry: 220.1, ask: 220.1 }) });
  assert.notEqual(a.inputFingerprint, b.inputFingerprint);
});

test("BLOCKED evaluation preserves blocking reason and permits partial calculation", () => {
  const result = buildRiskEvaluation({
    riskEvaluationId: "risk-b",
    evaluatedAt: "2026-09-01T17:00:01Z",
    candidate: candidate(),
    dssHandoff: dss(),
    entryResult: {
      status: "BLOCKED",
      reasonCodes: ["QUOTE_STALE"],
      entryMode: "MARKETABLE_NOW",
      bid: 219.9,
      ask: 220,
      quoteObservedAt: "2026-09-01T16:59:50Z",
      quoteAgeMs: 11000,
      quoteSource: "SCHWAB",
    },
  });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["QUOTE_STALE"]);
  assert.equal(result.calculation, null);
});

test("multiple blockers are retained without duplicates", () => {
  const result = buildRiskEvaluation({
    riskEvaluationId: "risk-b2",
    evaluatedAt: "2026-09-01T17:00:01Z",
    candidate: candidate(),
    dssHandoff: dss(),
    entryResult: { status: "BLOCKED", reasonCodes: ["QUOTE_STALE"] },
    accountResult: { status: "BLOCKED", reasonCodes: ["ACCOUNT_SNAPSHOT_STALE", "QUOTE_STALE"] },
  });
  assert.deepEqual(result.reasonCodes, ["QUOTE_STALE", "ACCOUNT_SNAPSHOT_STALE"]);
});

test("NO_AFFORDABLE_SIZE preserves zero final quantity", () => {
  const result = build({
    calculationResult: calc({
      status: "NO_AFFORDABLE_SIZE",
      reasonCodes: ["MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET"],
      rawQuantity: 0.8,
      finalQuantity: 0,
      plannedDollarRisk: 0,
      plannedRiskFraction: 0,
    }),
  });
  assert.equal(result.status, "NO_AFFORDABLE_SIZE");
  assert.equal(result.calculation.finalQuantity, 0);
});

test("ERROR status outranks BLOCKED", () => {
  const result = buildRiskEvaluation({
    riskEvaluationId: "risk-e",
    evaluatedAt: "2026-09-01T17:00:01Z",
    candidate: candidate(),
    dssHandoff: dss(),
    entryResult: { status: "BLOCKED", reasonCodes: ["QUOTE_STALE"] },
    calculationResult: { status: "ERROR", reasonCodes: ["RISK_INVARIANT_VIOLATION"] },
  });
  assert.equal(result.status, "ERROR");
  assert.deepEqual(result.reasonCodes, ["QUOTE_STALE", "RISK_INVARIANT_VIOLATION"]);
});

test("rejects non-VALID DSS handoff", () => {
  assert.throws(() => build({ dssHandoff: dss({ status: "BLOCKED" }) }), /fresh VALID DSS/);
});

test("rejects DSS identity mismatch", () => {
  assert.throws(() => build({ candidate: candidate({ contentHash: "other" }) }), /identity does not match/);
});

test("contract rejects VALID evaluation exceeding 0.5 percent", () => {
  const changed = structuredClone(build());
  changed.calculation.plannedRiskFraction = 0.006;
  assert.equal(validateRiskEvaluationContract(changed).valid, false);
});

test("contract rejects VALID planned risk above budget", () => {
  const changed = structuredClone(build());
  changed.calculation.plannedDollarRisk = 70;
  assert.equal(validateRiskEvaluationContract(changed).valid, false);
});

test("contract rejects NO_AFFORDABLE_SIZE when raw quantity fits minimum", () => {
  const result = build({
    calculationResult: calc({
      status: "NO_AFFORDABLE_SIZE",
      reasonCodes: ["MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET"],
      rawQuantity: 0.8,
      finalQuantity: 0,
      plannedDollarRisk: 0,
      plannedRiskFraction: 0,
    }),
  });
  const changed = structuredClone(result);
  changed.calculation.rawQuantity = 1;
  assert.equal(validateRiskEvaluationContract(changed).valid, false);
});

test("contract rejects VALID quote older than 5 seconds", () => {
  const changed = structuredClone(build());
  changed.entry.quoteAgeMs = 5001;
  assert.equal(validateRiskEvaluationContract(changed).valid, false);
});

test("contract rejects VALID account snapshot older than 15 seconds", () => {
  const changed = structuredClone(build());
  changed.account.snapshotAgeMs = 15001;
  assert.equal(validateRiskEvaluationContract(changed).valid, false);
});

test("contract rejects VALID account/instrument currency mismatch", () => {
  const changed = structuredClone(build());
  changed.instrument.instrumentCurrency = "EUR";
  assert.equal(validateRiskEvaluationContract(changed).valid, false);
});

test("contract rejects VALID risk fraction other than 0.5 percent", () => {
  const changed = structuredClone(build());
  changed.account.riskFraction = 0.004;
  assert.equal(validateRiskEvaluationContract(changed).valid, false);
});

test("contract rejects VALID LONG entry at or below effective stop", () => {
  const changed = structuredClone(build());
  changed.entry.currentExpectedEntry = changed.dss.effectiveStop;
  assert.equal(validateRiskEvaluationContract(changed).valid, false);
});
