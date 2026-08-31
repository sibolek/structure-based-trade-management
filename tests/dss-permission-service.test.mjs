import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DssPermissionService } from "../schwab-bridge/dss-permission-service.mjs";
import { DssRuntime } from "../schwab-bridge/dss-runtime.mjs";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";

function tempStatePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-dss-permission-")), "state.json");
}

function candidate(overrides = {}) {
  return {
    candidateId: "sod-2026-08-31-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "SOD_A_PLUS",
    sourceDate: "2026-08-31",
    generatedAt: "2026-08-31T12:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "PMH breakout retest",
    timeframe: "2m",
    thesis: "Breakout acceptance holds above PMH",
    trigger: { type: "RETEST_HOLD" },
    structuralInvalidation: {
      price: 216.25,
      rule: "LOSS_OF_PULLBACK_LOW",
      referenceType: "BREAKOUT_PULLBACK_LOW",
      reason: "breakout/retest thesis fails below pullback structure",
    },
    plannedEntryReference: 217.10,
    targets: [218, 219],
    managementPlan: "Manage against structure",
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

function setCandidateState(filePath, lifecycleState, extra = {}) {
  const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
  Object.assign(state.candidates[0], { lifecycleState, ...extra });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function makeStore({ lifecycleState = "PERMISSION_EVALUATING" } = {}) {
  const filePath = tempStatePath();
  let clock = "2026-08-31T18:52:38.253Z";
  const store = new PreTradeStore({ filePath, clock: () => clock });
  store.load();
  store.importBundle({ candidates: [candidate()] });
  setCandidateState(filePath, lifecycleState);
  store.load();
  return {
    filePath,
    store,
    setClock(value) { clock = value; },
  };
}

function structureDefinition() {
  return {
    type: "ANY_OF",
    rules: [
      { type: "STATIC_PRICE", price: 216.25 },
      { type: "DYNAMIC_REFERENCE", reference: "BREAKOUT_PULLBACK_LOW" },
    ],
  };
}

function structureEvaluation(overrides = {}) {
  return {
    status: "VALID",
    evaluatedAt: "2026-08-31T18:52:37.900Z",
    evaluationReference: "structure-eval-1",
    resolvedPrice: 216.25,
    evidenceReference: "5m-breakout-retest-evidence",
    ...overrides,
  };
}

function fakeEvaluator(statuses = ["VALID"]) {
  let calls = 0;
  return {
    evaluator(input, { nowMs }) {
      calls += 1;
      const status = statuses[Math.min(calls - 1, statuses.length - 1)];
      const latestCompletedBar = input.marketSnapshot.executionBars.at(-1);
      return Object.freeze({
        dssEvaluationId: `permission-eval-${calls}`,
        status,
        reasonCodes: status === "VALID" ? [] : [`TEST_${status}`],
        candidateId: input.candidate.candidateId,
        sourceId: input.candidate.sourceId,
        candidateContractVersion: input.candidate.contractVersion,
        candidateContentHash: input.candidate.candidateContentHash,
        structuralInvalidationDefinition: structuredClone(input.structuralInvalidationDefinition),
        structureEvaluation: structuredClone(input.structureEvaluation),
        latestCompletedBar: structuredClone(latestCompletedBar),
        effectiveStop: status === "VALID" ? 216.17 - (calls - 1) * 0.01 : null,
        evaluatedAt: new Date(nowMs).toISOString(),
      });
    },
    calls: () => calls,
  };
}

function inputAssembler({ latestBarTimestamp = Date.parse("2026-08-31T18:50:00.000Z") } = {}) {
  let calls = 0;
  const captured = [];
  return {
    async assemble(args) {
      calls += 1;
      captured.push(structuredClone(args));
      return Object.freeze({
        candidate: Object.freeze(structuredClone(args.candidate)),
        structuralInvalidationDefinition: Object.freeze(structuredClone(args.structuralInvalidationDefinition)),
        structureEvaluation: Object.freeze(structuredClone(args.structureEvaluation)),
        marketSnapshot: Object.freeze({
          snapshotId: `permission-snapshot-${calls}`,
          executionBars: Object.freeze([Object.freeze({
            timestamp: latestBarTimestamp + (calls - 1) * 120_000,
            timeframe: "2m",
            complete: true,
          })]),
        }),
      });
    },
    calls: () => calls,
    captured: () => structuredClone(captured),
  };
}

function makeService({ lifecycleState = "PERMISSION_EVALUATING", statuses = ["VALID"] } = {}) {
  const { filePath, store } = makeStore({ lifecycleState });
  const fake = fakeEvaluator(statuses);
  const assembler = inputAssembler();
  const runtime = new DssRuntime({
    store,
    evaluator: fake.evaluator,
    now: () => Date.parse("2026-08-31T18:52:38.300Z"),
  });
  const service = new DssPermissionService({ store, inputAssembler: assembler, runtime });
  return { filePath, store, fake, assembler, runtime, service };
}

function request(overrides = {}) {
  return {
    sourceId: "SOD_A_PLUS",
    candidateId: "sod-2026-08-31-NVDA-1",
    contractVersion: 1,
    structuralInvalidationDefinition: structureDefinition(),
    structureEvaluation: structureEvaluation(),
    ...overrides,
  };
}

test("permission service assembles from persisted candidate identity and preserves upstream structure objects", async () => {
  const { store, assembler, service } = makeService();
  const persisted = store.snapshot().candidates[0];
  const definition = structureDefinition();
  const evaluation = structureEvaluation();

  const result = await service.evaluate(request({
    structuralInvalidationDefinition: definition,
    structureEvaluation: evaluation,
  }));

  assert.equal(result.action, "EVALUATED");
  assert.equal(result.status, "VALID");
  assert.equal(assembler.calls(), 1);
  const assembled = assembler.captured()[0];
  assert.equal(assembled.candidate.candidateId, persisted.candidateId);
  assert.equal(assembled.candidate.sourceId, persisted.source);
  assert.equal(assembled.candidate.contractVersion, persisted.contractVersion);
  assert.equal(assembled.candidate.candidateContentHash, persisted.contentHash);
  assert.equal(assembled.candidate.symbol, persisted.symbol);
  assert.equal(assembled.candidate.direction, persisted.direction);
  assert.deepEqual(assembled.structuralInvalidationDefinition, definition);
  assert.deepEqual(assembled.structureEvaluation, evaluation);
  assert.deepEqual(result.evaluation.structuralInvalidationDefinition, definition);
  assert.deepEqual(result.evaluation.structureEvaluation, evaluation);
});

test("permission service fails before market-data assembly outside PERMISSION_EVALUATING", async () => {
  const { assembler, service } = makeService({ lifecycleState: "WAITING" });

  await assert.rejects(
    () => service.evaluate(request()),
    (error) => error.code === "DSS_PERMISSION_NOT_ALLOWED_IN_STATE",
  );
  assert.equal(assembler.calls(), 0);
});

test("source-scoped identity mismatch fails before market-data assembly", async () => {
  const { assembler, service } = makeService();

  await assert.rejects(
    () => service.evaluate(request({ sourceId: "MANUAL" })),
    (error) => error.code === "DSS_PERMISSION_SOURCE_MISMATCH",
  );
  assert.equal(assembler.calls(), 0);
});

test("fresh VALID DSS is reused without structure reevaluation or market-data assembly", async () => {
  const { assembler, service, fake } = makeService();
  const first = await service.evaluate(request());
  const second = await service.evaluate({
    sourceId: "SOD_A_PLUS",
    candidateId: "sod-2026-08-31-NVDA-1",
    contractVersion: 1,
  });

  assert.equal(first.action, "EVALUATED");
  assert.equal(second.action, "REUSED");
  assert.equal(second.dssEvaluationId, first.dssEvaluationId);
  assert.equal(assembler.calls(), 1);
  assert.equal(fake.calls(), 1);
});

test("new completed 2m bar makes the next permission cycle assemble and persist a new DSS evaluation", async () => {
  const { store, assembler, service, runtime, fake } = makeService();
  const first = await service.evaluate(request());
  const stale = runtime.observeCompletedBar({
    candidateId: "sod-2026-08-31-NVDA-1",
    contractVersion: 1,
    bar: {
      timestamp: Date.parse("2026-08-31T18:52:00.000Z"),
      timeframe: "2m",
      complete: true,
    },
    observedAt: "2026-08-31T18:54:01.000Z",
  });
  const second = await service.evaluate(request({
    structureEvaluation: structureEvaluation({
      evaluatedAt: "2026-08-31T18:54:01.100Z",
      evaluationReference: "structure-eval-2",
    }),
  }));

  assert.equal(stale.status, "STALE");
  assert.equal(first.dssEvaluationId, "permission-eval-1");
  assert.equal(second.dssEvaluationId, "permission-eval-2");
  assert.equal(assembler.calls(), 2);
  assert.equal(fake.calls(), 2);
  assert.equal(store.snapshot().dssEvaluations.length, 2);
});

test("BLOCKED and ERROR DSS outcomes remain retryable through fresh live assembly", async () => {
  for (const status of ["BLOCKED", "ERROR"]) {
    const { assembler, service, fake } = makeService({ statuses: [status, "VALID"] });
    const first = await service.evaluate(request());
    const second = await service.evaluate(request());

    assert.equal(first.status, status);
    assert.equal(second.status, "VALID");
    assert.equal(assembler.calls(), 2);
    assert.equal(fake.calls(), 2);
  }
});

test("authorized DSS identity freezes the service without structure or market-data work", async () => {
  const { filePath, store, assembler, service } = makeService();
  const first = await service.evaluate(request());
  setCandidateState(filePath, "ARMED", { authorizedDssEvaluationId: first.dssEvaluationId });
  store.load();

  const frozen = await service.evaluate({
    sourceId: "SOD_A_PLUS",
    candidateId: "sod-2026-08-31-NVDA-1",
    contractVersion: 1,
  });

  assert.equal(frozen.action, "FROZEN");
  assert.equal(frozen.dssEvaluationId, first.dssEvaluationId);
  assert.equal(assembler.calls(), 1);
});

test("risk handoff returns the exact immutable VALID DSS evaluation produced by the permission service", async () => {
  const { service } = makeService();
  const evaluated = await service.evaluate(request());
  const handoff = service.riskHandoff("sod-2026-08-31-NVDA-1", 1);

  assert.equal(handoff.dssEvaluationId, evaluated.dssEvaluationId);
  assert.equal(handoff.evaluation.status, "VALID");
  assert.equal(handoff.evaluation.effectiveStop, 216.17);
  assert.equal(Object.isFrozen(handoff), true);
  assert.equal(Object.isFrozen(handoff.evaluation), true);
});
