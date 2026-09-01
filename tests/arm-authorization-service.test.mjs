import assert from "node:assert/strict";
import test from "node:test";
import { ArmAuthorizationService } from "../schwab-bridge/arm-authorization-service.mjs";
import { authorizeArmState } from "../schwab-bridge/arm-authorization-state.mjs";

const NOW = Date.parse("2026-09-01T18:00:05.000Z");

function candidate(overrides = {}) {
  return {
    candidateId: "sod-2026-09-01-NVDA-1",
    contractVersion: 1,
    source: "SOD_A_PLUS",
    contentHash: "candidate-hash-001",
    symbol: "NVDA",
    direction: "LONG",
    lifecycleState: "READY",
    currentDssEvaluationId: "dss-eval-001",
    authorizedDssEvaluationId: null,
    authorizedRiskEvaluationId: null,
    currentDssEvaluationStale: false,
    arm: null,
    ...overrides,
  };
}

function dss(overrides = {}) {
  return {
    dssEvaluationId: "dss-eval-001",
    status: "VALID",
    candidateId: "sod-2026-09-01-NVDA-1",
    candidateContractVersion: 1,
    candidateContentHash: "candidate-hash-001",
    effectiveStop: 219.25,
    ...overrides,
  };
}

function riskEvaluation(overrides = {}) {
  return {
    riskEvaluationId: "risk-eval-001",
    status: "VALID",
    candidate: {
      candidateId: "sod-2026-09-01-NVDA-1",
      contractVersion: 1,
      candidateHash: "candidate-hash-001",
      symbol: "NVDA",
      direction: "LONG",
    },
    dss: {
      dssEvaluationId: "dss-eval-001",
      effectiveStop: 219.25,
    },
    entry: {
      quoteObservedAt: "2026-09-01T18:00:04.000Z",
    },
    account: {
      snapshotObservedAt: "2026-09-01T18:00:04.000Z",
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

function handoff(overrides = {}) {
  return {
    candidateVersion: 1,
    dssEvaluationId: "dss-eval-001",
    riskEvaluationId: "risk-eval-001",
    selectedQuantity: 50,
    ...overrides,
  };
}

function makeStore({ candidateValue = candidate(), dssValue = dss(), saveError = null } = {}) {
  let saves = 0;
  const store = {
    state: {
      schemaVersion: 1,
      updatedAt: null,
      candidates: [structuredClone(candidateValue)],
      dssEvaluations: [structuredClone(dssValue)],
      importLog: [],
    },
    clock: () => "2026-09-01T18:00:05.000Z",
    snapshot() { return structuredClone(this.state); },
    save() {
      saves += 1;
      if (saveError) throw saveError;
    },
    get saveCount() { return saves; },
  };
  return store;
}

function makeService({
  store = makeStore(),
  evaluation = riskEvaluation(),
  now = () => NOW,
} = {}) {
  const repository = {
    getById(id) {
      if (id !== evaluation.riskEvaluationId) {
        const error = new Error("not found");
        error.code = "RISK_EVALUATION_NOT_FOUND";
        throw error;
      }
      return structuredClone(evaluation);
    },
  };
  return { service: new ArmAuthorizationService({ store, riskEvaluationRepository: repository, now }), store };
}

function request(overrides = {}) {
  return {
    sourceId: "SOD_A_PLUS",
    candidateId: "sod-2026-09-01-NVDA-1",
    contractVersion: 1,
    armRiskHandoff: handoff(),
    ...overrides,
  };
}

test("READY authorization atomically freezes exact provenance and transitions to ARMED", () => {
  const { service, store } = makeService();
  const result = service.authorize(request());

  assert.equal(result.lifecycleState, "ARMED");
  assert.deepEqual(result.arm, {
    authorizedAt: "2026-09-01T18:00:05.000Z",
    candidateVersion: 1,
    dssEvaluationId: "dss-eval-001",
    riskEvaluationId: "risk-eval-001",
    selectedQuantity: 50,
  });
  const persisted = store.state.candidates[0];
  assert.equal(persisted.lifecycleState, "ARMED");
  assert.equal(persisted.authorizedDssEvaluationId, "dss-eval-001");
  assert.equal(persisted.authorizedRiskEvaluationId, "risk-eval-001");
  assert.deepEqual(persisted.arm, result.arm);
  assert.equal(store.saveCount, 1);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.arm), true);
});

test("CAUTION candidate may be authorized", () => {
  const store = makeStore({ candidateValue: candidate({ lifecycleState: "CAUTION" }) });
  const { service } = makeService({ store });
  assert.equal(service.authorize(request()).lifecycleState, "ARMED");
});

test("smaller selected quantity freezes same risk evaluation without modifying DSS stop", () => {
  const { service, store } = makeService();
  service.authorize(request({ armRiskHandoff: handoff({ selectedQuantity: 25 }) }));
  assert.equal(store.state.candidates[0].arm.selectedQuantity, 25);
  assert.equal(store.state.candidates[0].arm.riskEvaluationId, "risk-eval-001");
  assert.equal(store.state.dssEvaluations[0].effectiveStop, 219.25);
});

test("quantity above maximum is rejected before state transition", () => {
  const { service, store } = makeService();
  assert.throws(
    () => service.authorize(request({ armRiskHandoff: handoff({ selectedQuantity: 91 }) })),
    (error) => error.code === "QUANTITY_EXCEEDS_RISK_LIMIT",
  );
  assert.equal(store.state.candidates[0].lifecycleState, "READY");
  assert.equal(store.saveCount, 0);
});

test("tampered DSS provenance is rejected", () => {
  const { service, store } = makeService();
  assert.throws(
    () => service.authorize(request({ armRiskHandoff: handoff({ dssEvaluationId: "dss-tampered" }) })),
    (error) => error.code === "ARM_AUTHORIZATION_HANDOFF_MISMATCH",
  );
  assert.equal(store.saveCount, 0);
});

test("unknown risk evaluation id fails closed", () => {
  const { service, store } = makeService();
  assert.throws(
    () => service.authorize(request({ armRiskHandoff: handoff({ riskEvaluationId: "missing" }) })),
    (error) => error.code === "RISK_EVALUATION_NOT_FOUND",
  );
  assert.equal(store.saveCount, 0);
});

test("non-VALID risk evaluation cannot authorize", () => {
  const { service, store } = makeService({ evaluation: riskEvaluation({ status: "BLOCKED" }) });
  assert.throws(
    () => service.authorize(request()),
    (error) => error.code === "ARM_AUTHORIZATION_RISK_EVALUATION_NOT_VALID",
  );
  assert.equal(store.saveCount, 0);
});

test("source mismatch is rejected at final state boundary", () => {
  const { service, store } = makeService();
  assert.throws(
    () => service.authorize(request({ sourceId: "OTHER_SOURCE" })),
    (error) => error.code === "ARM_AUTHORIZATION_SOURCE_MISMATCH",
  );
  assert.equal(store.state.candidates[0].lifecycleState, "READY");
});

test("DSS becoming stale after preparation blocks authorization", () => {
  const store = makeStore({ candidateValue: candidate({ currentDssEvaluationStale: true }) });
  const { service } = makeService({ store });
  assert.throws(
    () => service.authorize(request()),
    (error) => error.code === "STALE_DSS_EVALUATION",
  );
  assert.equal(store.saveCount, 0);
});

test("DSS identity changing after preparation blocks authorization", () => {
  const store = makeStore({
    candidateValue: candidate({ currentDssEvaluationId: "dss-eval-002" }),
    dssValue: dss({ dssEvaluationId: "dss-eval-002" }),
  });
  const { service } = makeService({ store });
  assert.throws(
    () => service.authorize(request()),
    (error) => error.code === "ARM_RISK_HANDOFF_DSS_MISMATCH",
  );
  assert.equal(store.saveCount, 0);
});

test("WAITING and ARMED candidates cannot pass final authorization", () => {
  for (const lifecycleState of ["WAITING", "PERMISSION_EVALUATING", "PASS", "ARMED"]) {
    const store = makeStore({ candidateValue: candidate({ lifecycleState }) });
    const { service } = makeService({ store });
    assert.throws(
      () => service.authorize(request()),
      (error) => ["ARM_RISK_HANDOFF_NOT_ALLOWED_IN_STATE", "ARM_AUTHORIZATION_ALREADY_FROZEN"].includes(error.code),
    );
    assert.equal(store.saveCount, 0);
  }
});

test("already frozen candidate cannot be authorized twice", () => {
  const { service, store } = makeService();
  service.authorize(request());
  assert.throws(
    () => service.authorize(request()),
    (error) => ["ARM_RISK_HANDOFF_NOT_ALLOWED_IN_STATE", "ARM_RISK_HANDOFF_ALREADY_AUTHORIZED"].includes(error.code),
  );
  assert.equal(store.saveCount, 1);
});

test("quote older than 5 seconds at authorization requires a new ARM preparation", () => {
  const evaluation = riskEvaluation({ entry: { quoteObservedAt: "2026-09-01T17:59:59.999Z" } });
  const { service, store } = makeService({ evaluation });
  assert.throws(() => service.authorize(request()), (error) => error.code === "ARM_RISK_EVALUATION_STALE");
  assert.equal(store.saveCount, 0);
});

test("account snapshot older than 15 seconds at authorization requires a new ARM preparation", () => {
  const evaluation = riskEvaluation({ account: { snapshotObservedAt: "2026-09-01T17:59:49.999Z" } });
  const { service, store } = makeService({ evaluation });
  assert.throws(() => service.authorize(request()), (error) => error.code === "ARM_RISK_EVALUATION_STALE");
  assert.equal(store.saveCount, 0);
});

test("exact 5-second quote and 15-second account boundaries remain authorizable", () => {
  const evaluation = riskEvaluation({
    entry: { quoteObservedAt: "2026-09-01T18:00:00.000Z" },
    account: { snapshotObservedAt: "2026-09-01T17:59:50.000Z" },
  });
  const { service } = makeService({ evaluation });
  assert.equal(service.authorize(request()).lifecycleState, "ARMED");
});

test("invalid authorization clock fails before mutation", () => {
  const { service, store } = makeService({ now: () => "bad-time" });
  assert.throws(() => service.authorize(request()), (error) => error.code === "ARM_AUTHORIZATION_CLOCK_INVALID");
  assert.equal(store.state.candidates[0].lifecycleState, "READY");
  assert.equal(store.saveCount, 0);
});

test("persistence failure rolls back the entire in-memory ARM transition", () => {
  const store = makeStore({ saveError: new Error("disk full") });
  const before = structuredClone(store.state);
  assert.throws(
    () => authorizeArmState({
      store,
      sourceId: "SOD_A_PLUS",
      candidateId: "sod-2026-09-01-NVDA-1",
      contractVersion: 1,
      candidateContentHash: "candidate-hash-001",
      dssEvaluationId: "dss-eval-001",
      riskEvaluationId: "risk-eval-001",
      selectedQuantity: 50,
    }),
    (error) => error.code === "ARM_AUTHORIZATION_PERSISTENCE_ERROR",
  );
  assert.deepEqual(store.state, before);
  assert.equal(store.saveCount, 1);
});

test("authorization result contains provenance only and no broker-order authority", () => {
  const { service } = makeService();
  const result = service.authorize(request());
  assert.equal("order" in result, false);
  assert.equal("brokerOrder" in result, false);
  assert.equal("effectiveStop" in result.arm, false);
  assert.deepEqual(Object.keys(result.arm).sort(), [
    "authorizedAt",
    "candidateVersion",
    "dssEvaluationId",
    "riskEvaluationId",
    "selectedQuantity",
  ]);
});
