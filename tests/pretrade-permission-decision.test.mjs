import assert from "node:assert/strict";
import test from "node:test";

import { PreTradePermissionDecisionService } from "../schwab-bridge/pretrade-permission-decision.mjs";

function inputs(overrides = {}) {
  return {
    candidate: {
      candidateId: "decision-NVDA-1",
      contractVersion: 1,
      contentHash: "candidate-hash-1",
      setup: "Breakout retest",
      thesis: "Continuation if retest holds",
      context: { marketRegime: "TRENDING" },
      disqualifiers: [{ type: "MANUAL", rule: "avoid broad market failure" }],
    },
    structuralValidity: { status: "VALID" },
    dssResult: { status: "VALID", dssEvaluationId: "dss-1" },
    riskEvaluation: { status: "VALID", riskEvaluationId: "risk-1" },
    ...overrides,
  };
}

function service(overrides = {}) {
  return new PreTradePermissionDecisionService({
    clock: () => "2026-09-05T15:00:00.000Z",
    idFactory: () => "decision-1",
    ...overrides,
  });
}

test("without trusted macro/setup evaluator or operator assessment permission remains blocked", async () => {
  const result = await service().evaluate(inputs());
  assert.equal(result.kind, "BLOCKED_RETRYABLE");
  assert.equal(result.outcome, null);
  assert.equal(result.reasonCode, "PERMISSION_CONTEXT_ASSESSMENT_REQUIRED");
  assert.equal(result.source, "SYSTEM");
});

test("operator macro/setup assessment may explicitly establish READY", async () => {
  const result = await service().evaluate(inputs({
    operatorAssessment: { outcome: "READY", actor: "OPERATOR", note: "context remains supportive" },
  }));
  assert.equal(result.kind, "OUTCOME");
  assert.equal(result.outcome, "READY");
  assert.equal(result.source, "OPERATOR");
  assert.equal(result.provenance.actor, "OPERATOR");
  assert.equal(result.context.setup, "Breakout retest");
  assert.ok(result.contextHash);
});

test("CAUTION requires explicit warning reasons and PASS requires reason provenance", async () => {
  await assert.rejects(
    service().evaluate(inputs({ operatorAssessment: { outcome: "CAUTION" } })),
    (error) => error.code === "INVALID_PERMISSION_DECISION",
  );
  await assert.rejects(
    service().evaluate(inputs({ operatorAssessment: { outcome: "PASS" } })),
    (error) => error.code === "INVALID_PERMISSION_DECISION",
  );

  const caution = await service().evaluate(inputs({
    operatorAssessment: { outcome: "CAUTION", reasonCodes: ["ELEVATED_CONTEXT_RISK"] },
  }));
  assert.equal(caution.outcome, "CAUTION");
  assert.deepEqual(caution.reasonCodes, ["ELEVATED_CONTEXT_RISK"]);
});

test("trusted deterministic evaluator may establish context outcome with provenance", async () => {
  const result = await service({
    evaluator: async ({ context }) => ({
      outcome: "PASS",
      reasonCode: "BROAD_MARKET_DISQUALIFIER",
      reasonCodes: ["BROAD_MARKET_DISQUALIFIER"],
      provenance: { evaluatorVersion: 1, contextHashSeen: Boolean(context) },
    }),
  }).evaluate(inputs());
  assert.equal(result.outcome, "PASS");
  assert.equal(result.source, "TRUSTED_EVALUATOR");
  assert.equal(result.provenance.evaluatorVersion, 1);
});
