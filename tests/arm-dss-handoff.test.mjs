import assert from "node:assert/strict";
import test from "node:test";
import { currentDssEvaluationForArmHandoff } from "../schwab-bridge/arm-dss-handoff.mjs";

function candidate(overrides = {}) {
  return {
    candidateId: "arm-candidate-1",
    contractVersion: 1,
    source: "SOD_A_PLUS",
    contentHash: "candidate-hash-1",
    symbol: "NVDA",
    direction: "LONG",
    lifecycleState: "READY",
    currentDssEvaluationId: "dss-arm-1",
    currentDssEvaluationStale: false,
    authorizedDssEvaluationId: null,
    ...overrides,
  };
}

function evaluation(c = candidate(), overrides = {}) {
  return {
    dssEvaluationId: "dss-arm-1",
    status: "VALID",
    candidateId: c.candidateId,
    candidateContractVersion: c.contractVersion,
    candidateContentHash: c.contentHash,
    resolvedStructuralInvalidationPrice: 219.5,
    effectiveStop: 219.25,
    ...overrides,
  };
}

function store(c = candidate(), e = null) {
  const dss = e === null ? evaluation(c) : e;
  return {
    snapshot() {
      return {
        candidates: [structuredClone(c)],
        dssEvaluations: dss ? [structuredClone(dss)] : [],
      };
    },
  };
}

test("READY candidate returns exact immutable fresh VALID DSS for ARM", () => {
  const c = candidate();
  const result = currentDssEvaluationForArmHandoff(store(c), c.candidateId, c.contractVersion);
  assert.equal(result.dssEvaluationId, "dss-arm-1");
  assert.equal(result.evaluation.effectiveStop, 219.25);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.evaluation), true);
});

test("CAUTION candidate may use the ARM-time DSS handoff", () => {
  const c = candidate({ lifecycleState: "CAUTION" });
  const result = currentDssEvaluationForArmHandoff(store(c), c.candidateId, c.contractVersion);
  assert.equal(result.dssEvaluationId, "dss-arm-1");
});

test("ARM handoff rejects non READY or CAUTION lifecycle states", () => {
  for (const lifecycleState of ["WAITING", "PRETRADE_TRIGGER_EVALUATING", "PERMISSION_EVALUATING", "PASS", "ARMED"]) {
    const c = candidate({ lifecycleState });
    assert.throws(
      () => currentDssEvaluationForArmHandoff(store(c), c.candidateId, c.contractVersion),
      (error) => error.code === "DSS_ARM_HANDOFF_NOT_ALLOWED_IN_STATE",
    );
  }
});

test("ARM handoff rejects a stale DSS and requires permission reevaluation", () => {
  const c = candidate({ currentDssEvaluationStale: true });
  assert.throws(
    () => currentDssEvaluationForArmHandoff(store(c), c.candidateId, c.contractVersion),
    (error) => error.code === "STALE_DSS_EVALUATION",
  );
});

test("ARM handoff rejects missing or non-VALID current DSS", () => {
  const missing = candidate({ currentDssEvaluationId: null });
  assert.throws(
    () => currentDssEvaluationForArmHandoff(store(missing), missing.candidateId, missing.contractVersion),
    (error) => error.code === "NO_CURRENT_DSS_EVALUATION",
  );

  const blockedCandidate = candidate();
  const blockedEvaluation = evaluation(blockedCandidate, { status: "BLOCKED" });
  assert.throws(
    () => currentDssEvaluationForArmHandoff(store(blockedCandidate, blockedEvaluation), blockedCandidate.candidateId, blockedCandidate.contractVersion),
    (error) => error.code === "DSS_EVALUATION_NOT_VALID",
  );
});

test("ARM handoff fails closed if current DSS persistence is missing", () => {
  const c = candidate();
  assert.throws(
    () => currentDssEvaluationForArmHandoff(store(c, false), c.candidateId, c.contractVersion),
    (error) => error.code === "DSS_EVALUATION_NOT_FOUND",
  );
});

test("ARM handoff rejects DSS candidate identity mismatch", () => {
  const c = candidate();
  const mismatched = evaluation(c, { candidateContentHash: "different-hash" });
  assert.throws(
    () => currentDssEvaluationForArmHandoff(store(c, mismatched), c.candidateId, c.contractVersion),
    (error) => error.code === "DSS_EVALUATION_IDENTITY_MISMATCH",
  );
});

test("already authorized DSS identity is frozen and cannot start another ARM refresh", () => {
  const c = candidate({ authorizedDssEvaluationId: "dss-arm-1" });
  assert.throws(
    () => currentDssEvaluationForArmHandoff(store(c), c.candidateId, c.contractVersion),
    (error) => error.code === "DSS_ARM_HANDOFF_ALREADY_AUTHORIZED",
  );
});
