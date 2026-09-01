import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRiskEvaluation } from "../schwab-bridge/risk-evaluation.mjs";
import { RiskEvaluationRepository } from "../schwab-bridge/risk-evaluation-repository.mjs";

function tempPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "risk-eval-repo-")), "risk.json");
}

function evaluation(id = "risk-1", candidateId = "cand-1", version = 1) {
  const candidate = {
    candidateId,
    contractVersion: version,
    contentHash: `hash-${candidateId}-${version}`,
    symbol: "NVDA",
    direction: "LONG",
  };
  const dssHandoff = {
    dssEvaluationId: `dss-${candidateId}-${version}`,
    evaluation: {
      dssEvaluationId: `dss-${candidateId}-${version}`,
      status: "VALID",
      candidateId,
      candidateContractVersion: version,
      candidateContentHash: candidate.contentHash,
      resolvedStructuralInvalidationPrice: 219,
      effectiveStop: 218.9,
    },
  };
  return buildRiskEvaluation({
    riskEvaluationId: id,
    evaluatedAt: "2026-09-01T17:00:01Z",
    candidate,
    dssHandoff,
    entryResult: {
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
    },
    accountResult: {
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
    },
    instrumentResult: {
      status: "VALID",
      reasonCodes: [],
      assetType: "EQUITY",
      symbol: "NVDA",
      currency: "USD",
      minimumQuantity: 1,
      quantityIncrement: 1,
      metadataSource: "SCHWAB_QUOTE",
      metadataVersion: "meta-1",
    },
    calculationResult: {
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
    },
  });
}

test("records and reloads immutable risk evaluation", () => {
  const filePath = tempPath();
  const repo = new RiskEvaluationRepository({
    filePath,
    clock: () => "2026-09-01T17:00:02Z",
  });
  repo.load();
  const input = evaluation();
  repo.record(input);

  const reloaded = new RiskEvaluationRepository({ filePath });
  const state = reloaded.load();
  assert.equal(state.evaluations.length, 1);
  assert.deepEqual(state.evaluations[0], input);
});

test("evaluation ids are append-only and may not be reused", () => {
  const repo = new RiskEvaluationRepository({ filePath: tempPath() });
  repo.load();
  repo.record(evaluation("risk-1"));
  assert.throws(
    () => repo.record(evaluation("risk-1")),
    (error) => error.code === "RISK_EVALUATION_ID_CONFLICT",
  );
});

test("same inputs may be recorded under different ids", () => {
  const repo = new RiskEvaluationRepository({ filePath: tempPath() });
  repo.load();
  const a = evaluation("risk-a");
  const b = evaluation("risk-b");
  repo.record(a);
  repo.record(b);
  assert.equal(a.inputFingerprint, b.inputFingerprint);
  assert.equal(repo.snapshot().evaluations.length, 2);
});

test("getById returns immutable clone", () => {
  const repo = new RiskEvaluationRepository({ filePath: tempPath() });
  repo.load();
  repo.record(evaluation());
  const found = repo.getById("risk-1");
  assert.equal(Object.isFrozen(found), true);
  assert.equal(Object.isFrozen(found.candidate), true);
});

test("getById fails closed for missing id", () => {
  const repo = new RiskEvaluationRepository({ filePath: tempPath() });
  repo.load();
  assert.throws(
    () => repo.getById("missing"),
    (error) => error.code === "RISK_EVALUATION_NOT_FOUND",
  );
});

test("listForCandidate scopes by candidate and optional contract version", () => {
  const repo = new RiskEvaluationRepository({ filePath: tempPath() });
  repo.load();
  repo.record(evaluation("r1", "cand-1", 1));
  repo.record(evaluation("r2", "cand-1", 2));
  repo.record(evaluation("r3", "cand-2", 1));

  assert.equal(repo.listForCandidate("cand-1").length, 2);
  assert.equal(repo.listForCandidate("cand-1", 2).length, 1);
  assert.equal(repo.listForCandidate("cand-1", 2)[0].riskEvaluationId, "r2");
});

test("repository rejects hand-constructed invalid evaluation", () => {
  const repo = new RiskEvaluationRepository({ filePath: tempPath() });
  repo.load();
  const bad = structuredClone(evaluation());
  bad.calculation.plannedRiskFraction = 0.01;
  assert.throws(
    () => repo.record(bad),
    (error) => error.code === "INVALID_RISK_EVALUATION",
  );
});

test("repository load fails closed on corrupted persisted contract", () => {
  const filePath = tempPath();
  const bad = structuredClone(evaluation());
  bad.calculation.plannedDollarRisk = 999;
  fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, evaluations: [bad] }));
  assert.throws(
    () => new RiskEvaluationRepository({ filePath }).load(),
    (error) => error.code === "CORRUPT_RISK_EVALUATION_REPOSITORY",
  );
});

test("repository load fails closed on duplicate persisted ids", () => {
  const filePath = tempPath();
  const ev = evaluation();
  fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, evaluations: [ev, ev] }));
  assert.throws(
    () => new RiskEvaluationRepository({ filePath }).load(),
    (error) => error.code === "CORRUPT_RISK_EVALUATION_REPOSITORY",
  );
});
