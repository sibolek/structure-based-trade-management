import assert from "node:assert/strict";
import test from "node:test";

import { PreTradeStructuralValidityService } from "../schwab-bridge/pretrade-structural-validity.mjs";

function candidate(overrides = {}) {
  return {
    candidateId: "structure-NVDA-1",
    contractVersion: 1,
    contentHash: "candidate-hash-1",
    symbol: "NVDA",
    direction: "LONG",
    structuralInvalidation: {
      price: 179.5,
      rule: "break below retest low",
      referenceType: "SWING_LOW",
      reason: "thesis invalid below structure",
    },
    ...overrides,
  };
}

function service(overrides = {}) {
  return new PreTradeStructuralValidityService({
    clock: () => "2026-09-05T15:00:00.000Z",
    idFactory: () => "structure-eval-1",
    ...overrides,
  });
}

test("unsupported or discretionary structure blocks until operator or trusted evaluator supplies evidence", async () => {
  const result = await service().evaluate({ candidate: candidate() });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["STRUCTURAL_VALIDITY_REQUIRES_OPERATOR_OR_TRUSTED_EVALUATOR"]);
  assert.equal(result.source, "SYSTEM");
  assert.equal(result.resolvedPrice, 179.5);
});

test("explicit operator structural assessment is authoritative and provenance-bound", async () => {
  const result = await service().evaluate({
    candidate: candidate(),
    operatorAssessment: {
      status: "VALID",
      actor: "steven",
      note: "retest structure remains intact",
      evidenceReference: "chart-observation-1",
    },
  });
  assert.equal(result.status, "VALID");
  assert.equal(result.source, "OPERATOR");
  assert.equal(result.resolvedPrice, 179.5);
  assert.equal(result.provenance.actor, "steven");
  assert.equal(result.provenance.note, "retest structure remains intact");
  assert.equal(result.evidenceReference, "chart-observation-1");
});

test("VALID dynamic structure without a resolved price fails closed as BLOCKED", async () => {
  const result = await service().evaluate({
    candidate: candidate({
      structuralInvalidation: {
        price: null,
        rule: "break below resolved ORL",
        referenceType: "ORL",
        reference: { type: "OPENING_RANGE_LOW", durationMinutes: 5 },
      },
    }),
    operatorAssessment: { status: "VALID", evidenceReference: "operator-saw-orl" },
  });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["STRUCTURAL_REFERENCE_UNRESOLVED"]);
});

test("trusted evaluator may return INVALID without invoking operator discretion", async () => {
  const result = await service({
    evaluator: async () => ({
      status: "INVALID",
      reasonCodes: ["STRUCTURAL_BREAK_CONFIRMED"],
      resolvedPrice: 179.5,
      evidenceReference: "trusted-structure-event-1",
      provenance: { evaluatorVersion: 1 },
    }),
  }).evaluate({ candidate: candidate() });
  assert.equal(result.status, "INVALID");
  assert.equal(result.source, "TRUSTED_EVALUATOR");
  assert.deepEqual(result.reasonCodes, ["STRUCTURAL_BREAK_CONFIRMED"]);
});

test("DSS inputs are produced only from authoritative VALID resolved structure", async () => {
  const s = service();
  const valid = await s.evaluate({ candidate: candidate(), operatorAssessment: { status: "VALID" } });
  const inputs = s.dssInputs(candidate(), valid);
  assert.equal(inputs.structureEvaluation.status, "VALID");
  assert.equal(inputs.structureEvaluation.resolvedPrice, 179.5);
  assert.equal(inputs.structureEvaluation.evaluationReference, "structure-eval-1");
  assert.equal(inputs.structuralInvalidationDefinition.rule, "break below retest low");

  const blocked = await s.evaluate({ candidate: candidate() });
  assert.throws(
    () => s.dssInputs(candidate(), blocked),
    (error) => error.code === "STRUCTURAL_VALIDITY_NOT_READY_FOR_DSS",
  );
});
