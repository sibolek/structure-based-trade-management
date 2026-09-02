import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildExecutionBoardHandoff,
  validateExecutionBoardHandoffContract,
} from "../schwab-bridge/execution-board-handoff.mjs";
import {
  ExecutionBoardHandoffRepository,
} from "../schwab-bridge/execution-board-handoff-repository.mjs";

function candidate(overrides = {}) {
  return {
    candidateId: "sod-2026-09-02-NVDA-1",
    contractVersion: 3,
    contentHash: "candidate-hash-3",
    source: "SOD_A_PLUS",
    symbol: "NVDA",
    direction: "LONG",
    setup: "Liquidity sweep reclaim continuation",
    timeframe: "2m",
    thesis: "Sweep structural support and reclaim for continuation.",
    trigger: { type: "RECLAIM_AND_HOLD", level: 225.55 },
    targets: [226.5, 227.2],
    managementPlan: "Manage against structure.",
    lifecycleState: "ARMED",
    arm: {
      authorizedAt: "2026-09-02T14:00:00.000Z",
      candidateVersion: 3,
      dssEvaluationId: "dss-003",
      riskEvaluationId: "risk-003",
      selectedQuantity: 20,
    },
    ...overrides,
  };
}

function riskEvaluation(overrides = {}) {
  return {
    status: "VALID",
    riskEvaluationId: "risk-003",
    candidate: {
      candidateId: "sod-2026-09-02-NVDA-1",
      contractVersion: 3,
      candidateHash: "candidate-hash-3",
      symbol: "NVDA",
      direction: "LONG",
    },
    dss: {
      dssEvaluationId: "dss-003",
      structuralInvalidation: 224.8,
      effectiveStop: 224.64,
    },
    entry: {
      currentExpectedEntry: 225.6,
    },
    account: {
      accountId: "opaque-account-A",
    },
    calculation: {
      finalQuantity: 30,
    },
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildExecutionBoardHandoff({
    handoffId: overrides.handoffId || "handoff-003",
    createdAt: overrides.createdAt || "2026-09-02T14:00:01.000Z",
    candidate: overrides.candidate || candidate(),
    riskEvaluation: overrides.riskEvaluation || riskEvaluation(),
  });
}

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "executionos-handoff-"));
  return path.join(dir, "handoffs.json");
}

test("builds an immutable handoff from exact ARMED and risk provenance", () => {
  const handoff = build();

  assert.equal(handoff.handoffId, "handoff-003");
  assert.equal(handoff.candidateId, "sod-2026-09-02-NVDA-1");
  assert.equal(handoff.contractVersion, 3);
  assert.equal(handoff.structuralInvalidation, 224.8);
  assert.equal(handoff.effectiveStop, 224.64);
  assert.equal(handoff.currentExpectedEntry, 225.6);
  assert.equal(handoff.selectedQuantity, 20);
  assert.equal(handoff.authorizedExecutionAccountId, "opaque-account-A");
  assert.equal(handoff.dssEvaluationId, "dss-003");
  assert.equal(handoff.riskEvaluationId, "risk-003");
  assert.ok(Object.isFrozen(handoff));
  assert.ok(Object.isFrozen(handoff.trigger));
  assert.ok(Object.isFrozen(handoff.targets));

  const contract = validateExecutionBoardHandoffContract(handoff);
  assert.deepEqual(contract, { valid: true, errors: Object.freeze([]) });
});

test("preserves structural invalidation separately from effective stop", () => {
  const handoff = build();
  assert.notEqual(handoff.structuralInvalidation, handoff.effectiveStop);
  assert.equal(handoff.structuralInvalidation, 224.8);
  assert.equal(handoff.effectiveStop, 224.64);
});

test("requires internal ARMED state before creating a handoff", () => {
  assert.throws(
    () => build({ candidate: candidate({ lifecycleState: "READY" }) }),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_CANDIDATE_NOT_ARMED",
  );
});

test("rejects mismatched immutable risk identity", () => {
  const risk = riskEvaluation({
    candidate: {
      ...riskEvaluation().candidate,
      candidateHash: "wrong-hash",
    },
  });
  assert.throws(
    () => build({ riskEvaluation: risk }),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_RISK_IDENTITY_MISMATCH",
  );
});

test("rejects ARM provenance that does not match the risk evaluation", () => {
  const altered = candidate({
    arm: {
      ...candidate().arm,
      riskEvaluationId: "risk-other",
    },
  });
  assert.throws(
    () => build({ candidate: altered }),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_ARM_RISK_MISMATCH",
  );
});

test("rejects selected quantity above the Phase 4 affordable quantity", () => {
  const altered = candidate({
    arm: {
      ...candidate().arm,
      selectedQuantity: 31,
    },
  });
  assert.throws(
    () => build({ candidate: altered }),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_QUANTITY_INVALID",
  );
});

test("requires exact execution-account provenance", () => {
  const risk = riskEvaluation({ account: { accountId: "" } });
  assert.throws(
    () => build({ riskEvaluation: risk }),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_ACCOUNT_REQUIRED",
  );
});

test("contract rejects retrograde createdAt before authorizedAt", () => {
  assert.throws(
    () => build({ createdAt: "2026-09-02T13:59:59.000Z" }),
    (error) => error.code === "INVALID_EXECUTION_BOARD_HANDOFF",
  );
});

test("repository records, reloads, and returns immutable handoffs", () => {
  const filePath = tempFile();
  const repository = new ExecutionBoardHandoffRepository({
    filePath,
    clock: () => "2026-09-02T14:00:02.000Z",
  });
  repository.load();

  const result = repository.record(build());
  assert.equal(result.handoffId, "handoff-003");
  assert.equal(result.riskEvaluationId, "risk-003");

  const reloaded = new ExecutionBoardHandoffRepository({ filePath });
  const snapshot = reloaded.load();
  assert.equal(snapshot.handoffs.length, 1);

  const stored = reloaded.getById("handoff-003");
  assert.equal(stored.authorizedExecutionAccountId, "opaque-account-A");
  assert.equal(stored.effectiveStop, 224.64);
  assert.ok(Object.isFrozen(stored));
});

test("repository rejects duplicate handoffId", () => {
  const repository = new ExecutionBoardHandoffRepository({ filePath: tempFile() });
  repository.load();
  repository.record(build());

  assert.throws(
    () => repository.record(build()),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_ID_CONFLICT",
  );
});

test("repository permits only one handoff per ARM risk authorization", () => {
  const repository = new ExecutionBoardHandoffRepository({ filePath: tempFile() });
  repository.load();
  repository.record(build());

  assert.throws(
    () => repository.record(build({ handoffId: "handoff-other" })),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_AUTHORIZATION_CONFLICT",
  );
});

test("repository detects corrupted persisted contracts on restart", () => {
  const filePath = tempFile();
  const corrupted = {
    schemaVersion: 1,
    updatedAt: "2026-09-02T14:00:02.000Z",
    handoffs: [{ ...build(), effectiveStop: null }],
  };
  fs.writeFileSync(filePath, JSON.stringify(corrupted), "utf8");

  const repository = new ExecutionBoardHandoffRepository({ filePath });
  assert.throws(
    () => repository.load(),
    (error) => error.code === "CORRUPT_EXECUTION_BOARD_HANDOFF_REPOSITORY",
  );
});
