import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildPermissionAttempt, permissionAttemptHash } from "../schwab-bridge/pretrade-permission-attempt.mjs";
import { PreTradePermissionAttemptRepository } from "../schwab-bridge/pretrade-permission-attempt-repository.mjs";

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-permission-attempt-")), "attempts.json");
}

function riskEvaluation() {
  return {
    riskEvaluationId: "risk-1",
    status: "VALID",
    dss: { dssEvaluationId: "dss-1" },
    entry: {
      entryMode: "MARKETABLE_NOW",
      currentExpectedEntry: 180,
      bid: 179.99,
      ask: 180,
      quoteObservedAt: "2026-09-05T15:00:00.000Z",
      quoteAgeMs: 100,
      quoteSource: "SCHWAB",
      expectedEntryRule: "ASK_MARKETABLE_LONG",
    },
    account: {
      accountId: "acct-1",
      accountEquity: 13500,
      accountCurrency: "USD",
      snapshotObservedAt: "2026-09-05T15:00:00.000Z",
      snapshotAgeMs: 100,
      snapshotSource: "SCHWAB",
      sourceSnapshotId: "acct-snap-1",
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
      finalQuantity: 90,
      plannedDollarRisk: 67.5,
      plannedRiskFraction: 0.005,
    },
  };
}

function permissionDecision(outcome = "READY", reasonCodes = []) {
  return {
    authority: "PRETRADE_PERMISSION_DECISION",
    permissionDecisionId: "decision-1",
    candidateId: "candidate-1",
    contractVersion: 1,
    candidateContentHash: "candidate-hash-1",
    kind: "OUTCOME",
    outcome,
    reasonCode: reasonCodes[0] || null,
    reasonCodes,
  };
}

function attempt(overrides = {}) {
  const operationId = overrides.operationId || "permission-op-1";
  const operationHash = overrides.operationHash || permissionAttemptHash({ candidateId: "candidate-1", accountId: "acct-1" });
  return buildPermissionAttempt({
    permissionAttemptId: overrides.permissionAttemptId || "permission-attempt-1",
    operationId,
    operationHash,
    candidate: {
      candidateId: "candidate-1",
      contractVersion: 1,
      contentHash: "candidate-hash-1",
      source: "SOD_A_PLUS_TRADES",
      symbol: "NVDA",
      direction: "LONG",
      stateRevision: 2,
    },
    triggerSatisfaction: {
      authority: "PRETRADE_TRIGGER_ENGINE",
      evidenceId: "trigger-evidence-1",
      evidenceTimestamp: "2026-09-05T14:59:00.000Z",
    },
    structuralValidity: {
      authority: "PRETRADE_STRUCTURAL_VALIDITY",
      structuralEvaluationId: "structure-1",
      status: "VALID",
      resolvedPrice: 179.5,
    },
    dssResult: {
      action: "EVALUATED",
      status: "VALID",
      dssEvaluationId: "dss-1",
      evaluation: { dssEvaluationId: "dss-1", status: "VALID", effectiveStop: 179.25 },
    },
    riskEvaluation: riskEvaluation(),
    permissionDecision: permissionDecision(),
    result: { kind: "OUTCOME", outcome: "READY", reasonCodes: [] },
    startedAt: "2026-09-05T15:00:00.000Z",
    completedAt: "2026-09-05T15:00:01.000Z",
    ...overrides.build,
  });
}

test("permission attempt repository records and reloads immutable complete evidence package", () => {
  const filePath = tempFile();
  const repo = new PreTradePermissionAttemptRepository({
    filePath,
    clock: () => "2026-09-05T15:00:02.000Z",
  });
  repo.load();
  const recorded = repo.record(attempt());
  assert.equal(recorded.permissionAttemptId, "permission-attempt-1");
  assert.equal(recorded.candidate.permissionStateRevision, 2);
  assert.equal(recorded.account.accountId, "acct-1");
  assert.equal(recorded.expectedEntry.currentExpectedEntry, 180);
  assert.equal(recorded.phase4.riskEvaluationId, "risk-1");
  assert.equal(recorded.permissionDecision.outcome, "READY");
  assert.equal(Object.isFrozen(recorded), true);

  const reloaded = new PreTradePermissionAttemptRepository({ filePath });
  reloaded.load();
  const persisted = reloaded.getById("permission-attempt-1");
  assert.equal(persisted.result.outcome, "READY");
  assert.equal(persisted.dss.dssEvaluationId, "dss-1");
});

test("operationId is idempotent only for the same immutable permission inputs", () => {
  const repo = new PreTradePermissionAttemptRepository({ filePath: tempFile() });
  repo.load();
  const first = repo.record(attempt());
  const retry = repo.record(attempt({ permissionAttemptId: "permission-attempt-retry" }));
  assert.equal(retry.permissionAttemptId, first.permissionAttemptId);

  assert.throws(
    () => repo.record(attempt({
      permissionAttemptId: "permission-attempt-conflict",
      operationHash: permissionAttemptHash({ candidateId: "candidate-1", accountId: "acct-2" }),
    })),
    (error) => error.code === "PERMISSION_OPERATION_ID_CONFLICT",
  );
});

test("CAUTION requires explicit reason provenance", () => {
  assert.throws(
    () => attempt({
      build: {
        permissionDecision: permissionDecision("CAUTION", []),
        result: { kind: "OUTCOME", outcome: "CAUTION", reasonCodes: [] },
      },
    }),
    (error) => error.code === "INVALID_PERMISSION_ATTEMPT",
  );
});

test("permissionStateRevision is required so recovery cannot cross permission cycles", () => {
  assert.throws(
    () => attempt({
      build: {
        candidate: {
          candidateId: "candidate-1",
          contractVersion: 1,
          contentHash: "candidate-hash-1",
          source: "SOD_A_PLUS_TRADES",
          symbol: "NVDA",
          direction: "LONG",
        },
      },
    }),
    (error) => error.code === "INVALID_PERMISSION_ATTEMPT",
  );
});

test("READY requires an authoritative matching permission context decision", () => {
  assert.throws(
    () => attempt({ build: { permissionDecision: null } }),
    (error) => error.code === "INVALID_PERMISSION_ATTEMPT",
  );
  assert.throws(
    () => attempt({ build: { permissionDecision: permissionDecision("CAUTION", ["ELEVATED_CONTEXT_RISK"]) } }),
    (error) => error.code === "INVALID_PERMISSION_ATTEMPT",
  );
});

test("READY cannot be recorded without exact account and expected-entry evidence", () => {
  const brokenRisk = riskEvaluation();
  brokenRisk.account.accountId = null;
  assert.throws(
    () => buildPermissionAttempt({
      permissionAttemptId: "broken-ready",
      operationId: "broken-op",
      operationHash: "broken-hash",
      candidate: {
        candidateId: "candidate-1",
        contractVersion: 1,
        contentHash: "candidate-hash-1",
        source: "SOD_A_PLUS_TRADES",
        symbol: "NVDA",
        direction: "LONG",
        stateRevision: 2,
      },
      triggerSatisfaction: { authority: "PRETRADE_TRIGGER_ENGINE" },
      structuralValidity: { authority: "PRETRADE_STRUCTURAL_VALIDITY", status: "VALID" },
      dssResult: { status: "VALID", dssEvaluationId: "dss-1" },
      riskEvaluation: brokenRisk,
      permissionDecision: permissionDecision(),
      result: { kind: "OUTCOME", outcome: "READY" },
      startedAt: "2026-09-05T15:00:00.000Z",
      completedAt: "2026-09-05T15:00:01.000Z",
    }),
    (error) => error.code === "INVALID_PERMISSION_ATTEMPT",
  );
});
