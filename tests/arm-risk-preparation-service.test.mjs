import assert from "node:assert/strict";
import test from "node:test";
import {
  ArmRiskPreparationService,
  buildArmRiskHandoff,
} from "../schwab-bridge/arm-risk-preparation-service.mjs";

function candidate(overrides = {}) {
  return {
    candidateId: "candidate-001",
    contractVersion: 2,
    contentHash: "candidate-hash-001",
    symbol: "NVDA",
    direction: "LONG",
    lifecycleState: "READY",
    currentDssEvaluationId: "dss-eval-001",
    currentDssEvaluationStale: false,
    authorizedDssEvaluationId: null,
    ...overrides,
  };
}

function riskEvaluation(overrides = {}) {
  return {
    riskEvaluationId: "risk-eval-001",
    status: "VALID",
    candidate: {
      candidateId: "candidate-001",
      contractVersion: 2,
      candidateHash: "candidate-hash-001",
      symbol: "NVDA",
      direction: "LONG",
    },
    dss: {
      dssEvaluationId: "dss-eval-001",
      effectiveStop: 219.25,
    },
    instrument: {
      minimumQuantity: 1,
      quantityIncrement: 1,
    },
    calculation: {
      finalQuantity: 90,
    },
    ...overrides,
  };
}

function storeWith(candidateValue = candidate()) {
  return {
    snapshot() {
      return { candidates: [structuredClone(candidateValue)] };
    },
  };
}

function permissionResult(status = "VALID", overrides = {}) {
  return {
    riskEvaluationId: "risk-eval-001",
    dssEvaluationId: "dss-eval-001",
    status,
    maxAffordableQuantity: status === "VALID" ? 90 : status === "NO_AFFORDABLE_SIZE" ? 0 : null,
    plannedDollarRisk: status === "VALID" ? 67.5 : null,
    plannedRiskFraction: status === "VALID" ? 0.005 : null,
    reasonCodes: [],
    ...overrides,
  };
}

test("selected quantity exactly at the risk maximum is allowed", () => {
  const handoff = buildArmRiskHandoff({
    store: storeWith(),
    riskEvaluation: riskEvaluation(),
    selectedQuantity: 90,
  });
  assert.deepEqual(handoff, {
    candidateVersion: 2,
    dssEvaluationId: "dss-eval-001",
    riskEvaluationId: "risk-eval-001",
    selectedQuantity: 90,
  });
});

test("selected quantity below the maximum is allowed without changing the risk evaluation", () => {
  const evaluation = riskEvaluation();
  const handoff = buildArmRiskHandoff({
    store: storeWith(),
    riskEvaluation: evaluation,
    selectedQuantity: 50,
  });
  assert.equal(handoff.selectedQuantity, 50);
  assert.equal(handoff.riskEvaluationId, evaluation.riskEvaluationId);
  assert.equal(evaluation.calculation.finalQuantity, 90);
});

test("selected quantity above the maximum is prohibited", () => {
  assert.throws(
    () => buildArmRiskHandoff({
      store: storeWith(),
      riskEvaluation: riskEvaluation(),
      selectedQuantity: 91,
    }),
    (error) => error.code === "QUANTITY_EXCEEDS_RISK_LIMIT",
  );
});

test("fractional share selection is invalid when quantity increment is one", () => {
  assert.throws(
    () => buildArmRiskHandoff({
      store: storeWith(),
      riskEvaluation: riskEvaluation(),
      selectedQuantity: 50.5,
    }),
    (error) => error.code === "INVALID_SELECTED_QUANTITY",
  );
});

test("valid non-unit quantity increment is enforced exactly", () => {
  const evaluation = riskEvaluation({
    instrument: { minimumQuantity: 0.5, quantityIncrement: 0.25 },
    calculation: { finalQuantity: 3.75 },
  });
  const handoff = buildArmRiskHandoff({
    store: storeWith(),
    riskEvaluation: evaluation,
    selectedQuantity: 2.5,
  });
  assert.equal(handoff.selectedQuantity, 2.5);
  assert.throws(
    () => buildArmRiskHandoff({
      store: storeWith(),
      riskEvaluation: evaluation,
      selectedQuantity: 2.6,
    }),
    (error) => error.code === "INVALID_SELECTED_QUANTITY",
  );
});

test("stale current DSS prevents ARM risk handoff", () => {
  assert.throws(
    () => buildArmRiskHandoff({
      store: storeWith(candidate({ currentDssEvaluationStale: true })),
      riskEvaluation: riskEvaluation(),
      selectedQuantity: 50,
    }),
    (error) => error.code === "STALE_DSS_EVALUATION",
  );
});

test("risk evaluation must reference the candidate exact current DSS", () => {
  assert.throws(
    () => buildArmRiskHandoff({
      store: storeWith(),
      riskEvaluation: riskEvaluation({ dss: { dssEvaluationId: "dss-old", effectiveStop: 219.25 } }),
      selectedQuantity: 50,
    }),
    (error) => error.code === "ARM_RISK_HANDOFF_DSS_MISMATCH",
  );
});

test("risk evaluation candidate identity must match current candidate", () => {
  const evaluation = riskEvaluation({
    candidate: {
      candidateId: "candidate-001",
      contractVersion: 2,
      candidateHash: "different-hash",
      symbol: "NVDA",
      direction: "LONG",
    },
  });
  assert.throws(
    () => buildArmRiskHandoff({ store: storeWith(), riskEvaluation: evaluation, selectedQuantity: 50 }),
    (error) => error.code === "ARM_RISK_HANDOFF_IDENTITY_MISMATCH",
  );
});

test("only VALID risk evaluation may produce an ARM risk handoff", () => {
  assert.throws(
    () => buildArmRiskHandoff({
      store: storeWith(),
      riskEvaluation: riskEvaluation({ status: "NO_AFFORDABLE_SIZE" }),
      selectedQuantity: 1,
    }),
    (error) => error.code === "ARM_RISK_HANDOFF_EVALUATION_NOT_VALID",
  );
});

test("already authorized candidate cannot produce another ARM risk handoff", () => {
  assert.throws(
    () => buildArmRiskHandoff({
      store: storeWith(candidate({ authorizedDssEvaluationId: "dss-eval-001" })),
      riskEvaluation: riskEvaluation(),
      selectedQuantity: 50,
    }),
    (error) => error.code === "ARM_RISK_HANDOFF_ALREADY_AUTHORIZED",
  );
});

test("ARM risk provenance bundle is exact and deeply immutable", () => {
  const handoff = buildArmRiskHandoff({
    store: storeWith(),
    riskEvaluation: riskEvaluation(),
    selectedQuantity: 25,
  });
  assert.deepEqual(Object.keys(handoff).sort(), [
    "candidateVersion",
    "dssEvaluationId",
    "riskEvaluationId",
    "selectedQuantity",
  ]);
  assert.equal(Object.isFrozen(handoff), true);
  assert.throws(() => { handoff.selectedQuantity = 90; }, TypeError);
});

test("ARM preparation always uses fresh evaluateForArm result before quantity validation", async () => {
  let evaluations = 0;
  const service = new ArmRiskPreparationService({
    store: storeWith(),
    riskSizingPermissionService: {
      async evaluateForArm() {
        evaluations += 1;
        return permissionResult("VALID");
      },
    },
    riskEvaluationRepository: {
      getById(id) {
        assert.equal(id, "risk-eval-001");
        return riskEvaluation();
      },
    },
  });
  const prepared = await service.prepare({
    sourceId: "SOD_A_PLUS",
    candidateId: "candidate-001",
    contractVersion: 2,
    selectedQuantity: 40,
  });
  assert.equal(evaluations, 1);
  assert.equal(prepared.permission.consequence, "CONTINUE");
  assert.equal(prepared.armRiskHandoff.selectedQuantity, 40);
});

test("NO_AFFORDABLE_SIZE becomes PASS STOP_RISK_CONFLICT with no ARM handoff", async () => {
  let repositoryReads = 0;
  const service = new ArmRiskPreparationService({
    store: storeWith(),
    riskSizingPermissionService: {
      async evaluateForArm() {
        return permissionResult("NO_AFFORDABLE_SIZE", {
          reasonCodes: ["MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET"],
        });
      },
    },
    riskEvaluationRepository: {
      getById() {
        repositoryReads += 1;
        return riskEvaluation();
      },
    },
  });
  const prepared = await service.prepare({ selectedQuantity: 1 });
  assert.equal(prepared.permission.permissionStatus, "PASS");
  assert.equal(prepared.permission.permissionReason, "STOP_RISK_CONFLICT");
  assert.equal(prepared.armRiskHandoff, null);
  assert.equal(repositoryReads, 0);
});

test("BLOCKED and ERROR remain non-advancing and never produce ARM handoff", async () => {
  for (const status of ["BLOCKED", "ERROR"]) {
    const service = new ArmRiskPreparationService({
      store: storeWith(),
      riskSizingPermissionService: {
        async evaluateForArm() {
          return permissionResult(status, { reasonCodes: [status === "BLOCKED" ? "QUOTE_STALE" : "INTERNAL_ERROR"] });
        },
      },
      riskEvaluationRepository: {
        getById() {
          throw new Error("repository must not be read for non-advancing status");
        },
      },
    });
    const prepared = await service.prepare({ selectedQuantity: 1 });
    assert.equal(prepared.armRiskHandoff, null);
    assert.equal(prepared.permission.permissionStatus, null);
    assert.equal(prepared.permission.failClosed, true);
  }
});

test("each ARM preparation invokes a new ARM-time Phase 4 evaluation", async () => {
  let next = 0;
  const evaluations = new Map();
  const riskSizingPermissionService = {
    async evaluateForArm() {
      next += 1;
      const id = `risk-eval-${next}`;
      evaluations.set(id, riskEvaluation({ riskEvaluationId: id }));
      return permissionResult("VALID", { riskEvaluationId: id });
    },
  };
  const service = new ArmRiskPreparationService({
    store: storeWith(),
    riskSizingPermissionService,
    riskEvaluationRepository: {
      getById(id) {
        return structuredClone(evaluations.get(id));
      },
    },
  });

  const first = await service.prepare({ selectedQuantity: 10 });
  const second = await service.prepare({ selectedQuantity: 10 });
  assert.equal(next, 2);
  assert.notEqual(first.armRiskHandoff.riskEvaluationId, second.armRiskHandoff.riskEvaluationId);
});
