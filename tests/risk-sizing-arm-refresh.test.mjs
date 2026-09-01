import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RiskSizingPermissionService } from "../schwab-bridge/risk-sizing-permission-service.mjs";
import { RiskEvaluationRepository } from "../schwab-bridge/risk-evaluation-repository.mjs";

const NOW = Date.parse("2026-09-01T18:00:05.000Z");

function tempRiskPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-arm-risk-")), "risk.json");
}

function candidate(overrides = {}) {
  return {
    candidateId: "sod-2026-09-01-NVDA-arm",
    contractVersion: 1,
    source: "SOD_A_PLUS",
    contentHash: "candidate-arm-hash",
    symbol: "NVDA",
    direction: "LONG",
    lifecycleState: "READY",
    currentDssEvaluationId: "dss-arm-001",
    currentDssEvaluationStale: false,
    authorizedDssEvaluationId: null,
    ...overrides,
  };
}

function dss(c = candidate(), overrides = {}) {
  return {
    dssEvaluationId: "dss-arm-001",
    status: "VALID",
    reasonCodes: [],
    candidateId: c.candidateId,
    candidateContractVersion: c.contractVersion,
    candidateContentHash: c.contentHash,
    resolvedStructuralInvalidationPrice: 219.50,
    effectiveStop: 219.25,
    evaluatedAt: "2026-09-01T18:00:00.000Z",
    ...overrides,
  };
}

function quote(overrides = {}) {
  return {
    symbol: "NVDA",
    bid: 219.95,
    ask: 220.00,
    asOf: "2026-09-01T18:00:04.000Z",
    source: "SCHWAB",
    ...overrides,
  };
}

function account(overrides = {}) {
  return {
    status: "VALID",
    reasonCodes: [],
    snapshot: {
      accountId: "acct-arm-001",
      accountEquity: 13_500,
      currency: "USD",
      observedAt: "2026-09-01T18:00:04.000Z",
      ageMs: 0,
      source: "SCHWAB",
      sourceSnapshotId: "acct-arm-snapshot",
      ...overrides,
    },
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
    metadataObservedAt: "2026-09-01T18:00:04.000Z",
    metadataVersion: "instrument-arm-v1",
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    sourceId: "SOD_A_PLUS",
    candidateId: "sod-2026-09-01-NVDA-arm",
    contractVersion: 1,
    accountId: "acct-arm-001",
    entryMode: "MARKETABLE_NOW",
    ...overrides,
  };
}

function harness({
  c = candidate(),
  d = null,
  q = quote(),
  a = account(),
  i = instrument(),
} = {}) {
  const currentDss = d || dss(c);
  const calls = { quote: 0, account: 0, instrument: 0, permissionHandoff: 0 };
  const store = {
    snapshot() {
      return {
        candidates: [structuredClone(c)],
        dssEvaluations: [structuredClone(currentDss)],
      };
    },
    currentDssEvaluationForRiskHandoff() {
      calls.permissionHandoff += 1;
      throw new Error("permission DSS handoff must not be used by ARM refresh");
    },
  };
  const repository = new RiskEvaluationRepository({
    filePath: tempRiskPath(),
    clock: () => "2026-09-01T18:00:05.100Z",
  });
  repository.load();
  let nextId = 1;
  const service = new RiskSizingPermissionService({
    store,
    marketDataProvider: {
      async getQuote() {
        calls.quote += 1;
        return structuredClone(q);
      },
    },
    accountRiskProvider: {
      async getSnapshot() {
        calls.account += 1;
        return structuredClone(a);
      },
    },
    instrumentSizingMetadataProvider: {
      async getInstrumentSizingMetadata() {
        calls.instrument += 1;
        return structuredClone(i);
      },
    },
    riskEvaluationRepository: repository,
    now: () => NOW,
    idFactory: () => `arm-risk-${String(nextId++).padStart(3, "0")}`,
  });
  return { service, repository, calls };
}

test("READY ARM attempt creates a brand-new VALID risk evaluation from fresh inputs", async () => {
  const { service, repository, calls } = harness();
  const result = await service.evaluateForArm(request());

  assert.equal(result.status, "VALID");
  assert.equal(result.riskEvaluationId, "arm-risk-001");
  assert.equal(result.dssEvaluationId, "dss-arm-001");
  assert.equal(result.maxAffordableQuantity, 90);
  assert.equal(calls.permissionHandoff, 0);
  assert.equal(calls.quote, 1);
  assert.equal(calls.account, 1);
  assert.equal(calls.instrument, 1);
  assert.equal(repository.getById(result.riskEvaluationId).calculation.finalQuantity, 90);
});

test("CAUTION may perform the same fresh ARM-time risk evaluation", async () => {
  const { service } = harness({ c: candidate({ lifecycleState: "CAUTION" }) });
  const result = await service.evaluateForArm(request());
  assert.equal(result.status, "VALID");
});

test("each ARM attempt creates a new riskEvaluationId even when inputs are unchanged", async () => {
  const { service, repository } = harness();
  const first = await service.evaluateForArm(request());
  const second = await service.evaluateForArm(request());

  assert.notEqual(first.riskEvaluationId, second.riskEvaluationId);
  const one = repository.getById(first.riskEvaluationId);
  const two = repository.getById(second.riskEvaluationId);
  assert.equal(one.inputFingerprint, two.inputFingerprint);
  assert.equal(repository.snapshot().evaluations.length, 2);
});

test("stale DSS blocks ARM before all live Phase 4 reads and persistence", async () => {
  const { service, repository, calls } = harness({
    c: candidate({ currentDssEvaluationStale: true }),
  });

  await assert.rejects(
    service.evaluateForArm(request()),
    (error) => error.code === "STALE_DSS_EVALUATION",
  );
  assert.equal(calls.quote, 0);
  assert.equal(calls.account, 0);
  assert.equal(calls.instrument, 0);
  assert.equal(repository.snapshot().evaluations.length, 0);
});

test("ARMED candidate cannot recalculate Phase 4", async () => {
  const { service, repository, calls } = harness({
    c: candidate({ lifecycleState: "ARMED" }),
  });

  await assert.rejects(
    service.evaluateForArm(request()),
    (error) => error.code === "RISK_SIZING_ARM_REFRESH_NOT_ALLOWED_IN_STATE",
  );
  assert.equal(calls.quote, 0);
  assert.equal(repository.snapshot().evaluations.length, 0);
});

test("already authorized DSS identity cannot start another ARM refresh", async () => {
  const { service, repository, calls } = harness({
    c: candidate({ authorizedDssEvaluationId: "dss-arm-001" }),
  });

  await assert.rejects(
    service.evaluateForArm(request()),
    (error) => error.code === "DSS_ARM_HANDOFF_ALREADY_AUTHORIZED",
  );
  assert.equal(calls.quote, 0);
  assert.equal(repository.snapshot().evaluations.length, 0);
});

test("ARM-time NO_AFFORDABLE_SIZE is persisted but grants no ARM authority", async () => {
  const c = candidate();
  const { service, repository } = harness({
    c,
    d: dss(c, {
      resolvedStructuralInvalidationPrice: 100.25,
      effectiveStop: 100,
    }),
  });
  const result = await service.evaluateForArm(request());

  assert.equal(result.status, "NO_AFFORDABLE_SIZE");
  assert.equal(result.maxAffordableQuantity, 0);
  assert.deepEqual(result.reasonCodes, ["MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET"]);
  assert.equal("arm" in result, false);
  assert.equal("lifecycleState" in result, false);
  assert.equal(repository.getById(result.riskEvaluationId).status, "NO_AFFORDABLE_SIZE");
});

test("ordinary permission evaluation remains prohibited from READY", async () => {
  const { service, calls } = harness();
  await assert.rejects(
    service.evaluate(request()),
    (error) => error.code === "RISK_SIZING_PERMISSION_NOT_ALLOWED_IN_STATE",
  );
  assert.equal(calls.permissionHandoff, 0);
  assert.equal(calls.quote, 0);
});
