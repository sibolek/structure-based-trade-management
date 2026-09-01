import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RiskSizingPermissionService } from "../schwab-bridge/risk-sizing-permission-service.mjs";
import { RiskEvaluationRepository } from "../schwab-bridge/risk-evaluation-repository.mjs";

const NOW = Date.parse("2026-09-01T17:30:05.000Z");

function tempRiskPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-risk-service-")), "risk.json");
}

function baseCandidate(overrides = {}) {
  return {
    candidateId: "sod-2026-09-01-NVDA-1",
    contractVersion: 1,
    source: "SOD_A_PLUS",
    contentHash: "candidate-hash-001",
    symbol: "NVDA",
    direction: "LONG",
    lifecycleState: "PERMISSION_EVALUATING",
    ...overrides,
  };
}

function dssEvaluation(candidate, overrides = {}) {
  return {
    dssEvaluationId: "dss-eval-001",
    status: "VALID",
    reasonCodes: [],
    candidateId: candidate.candidateId,
    candidateContractVersion: candidate.contractVersion,
    candidateContentHash: candidate.contentHash,
    resolvedStructuralInvalidationPrice: 219.50,
    effectiveStop: 219.25,
    evaluatedAt: "2026-09-01T17:30:00.000Z",
    ...overrides,
  };
}

function validQuote(overrides = {}) {
  return {
    symbol: "NVDA",
    bid: 219.95,
    ask: 220.00,
    asOf: "2026-09-01T17:30:04.000Z",
    source: "SCHWAB",
    ...overrides,
  };
}

function validAccount(overrides = {}) {
  return {
    status: "VALID",
    reasonCodes: [],
    snapshot: {
      accountId: "acct-hash-001",
      accountEquity: 13_500,
      currency: "USD",
      observedAt: "2026-09-01T17:30:04.000Z",
      ageMs: 0,
      source: "SCHWAB",
      sourceSnapshotId: "acct-snapshot-001",
      ...overrides,
    },
  };
}

function validInstrument(overrides = {}) {
  return {
    status: "VALID",
    reasonCodes: [],
    assetType: "EQUITY",
    symbol: "NVDA",
    currency: "USD",
    minimumQuantity: 1,
    quantityIncrement: 1,
    metadataSource: "SCHWAB_QUOTE",
    metadataObservedAt: "2026-09-01T17:30:04.000Z",
    metadataVersion: "instrument-version-001",
    ...overrides,
  };
}

function blocked(reasonCode, partial = {}) {
  return {
    ...partial,
    status: "BLOCKED",
    reasonCodes: [reasonCode],
  };
}

function makeHarness({
  candidate = baseCandidate(),
  dss = null,
  quote = validQuote(),
  account = validAccount(),
  instrument = validInstrument(),
  quoteError = null,
  accountError = null,
  instrumentError = null,
  handoffError = null,
  repository = null,
  idFactory = null,
  now = () => NOW,
} = {}) {
  const calls = {
    quote: [],
    account: [],
    instrument: [],
    handoff: [],
  };
  const currentDss = dss || dssEvaluation(candidate);
  const store = {
    snapshot() {
      return { candidates: [structuredClone(candidate)] };
    },
    currentDssEvaluationForRiskHandoff(candidateId, contractVersion) {
      calls.handoff.push([candidateId, contractVersion]);
      if (handoffError) throw handoffError;
      return Object.freeze({
        dssEvaluationId: currentDss.dssEvaluationId,
        evaluation: Object.freeze(structuredClone(currentDss)),
      });
    },
  };
  const marketDataProvider = {
    async getQuote(symbol) {
      calls.quote.push(symbol);
      if (quoteError) throw quoteError;
      return structuredClone(quote);
    },
  };
  const accountRiskProvider = {
    async getSnapshot(accountId) {
      calls.account.push(accountId);
      if (accountError) throw accountError;
      return structuredClone(account);
    },
  };
  const instrumentSizingMetadataProvider = {
    async getInstrumentSizingMetadata(symbol) {
      calls.instrument.push(symbol);
      if (instrumentError) throw instrumentError;
      return structuredClone(instrument);
    },
  };

  const riskRepository = repository || new RiskEvaluationRepository({
    filePath: tempRiskPath(),
    clock: () => "2026-09-01T17:30:05.100Z",
  });
  if (typeof riskRepository.load === "function") riskRepository.load();

  let nextId = 1;
  const service = new RiskSizingPermissionService({
    store,
    marketDataProvider,
    accountRiskProvider,
    instrumentSizingMetadataProvider,
    riskEvaluationRepository: riskRepository,
    now,
    idFactory: idFactory || (() => `risk-eval-${String(nextId++).padStart(3, "0")}`),
  });

  return { service, repository: riskRepository, calls, candidate, currentDss };
}

function request(overrides = {}) {
  return {
    sourceId: "SOD_A_PLUS",
    candidateId: "sod-2026-09-01-NVDA-1",
    contractVersion: 1,
    accountId: "acct-hash-001",
    entryMode: "MARKETABLE_NOW",
    ...overrides,
  };
}

test("VALID equity permission sizing persists exact DSS-linked risk evaluation", async () => {
  const { service, repository } = makeHarness();
  const result = await service.evaluate(request());

  assert.deepEqual(result, {
    riskEvaluationId: "risk-eval-001",
    dssEvaluationId: "dss-eval-001",
    status: "VALID",
    maxAffordableQuantity: 90,
    plannedDollarRisk: 67.5,
    plannedRiskFraction: 0.005,
    reasonCodes: [],
  });

  const persisted = repository.getById(result.riskEvaluationId);
  assert.equal(persisted.dss.dssEvaluationId, "dss-eval-001");
  assert.equal(persisted.dss.structuralInvalidation, 219.5);
  assert.equal(persisted.dss.effectiveStop, 219.25);
  assert.equal(persisted.entry.currentExpectedEntry, 220);
  assert.equal(persisted.entry.expectedEntryRule, "ASK_MARKETABLE_LONG");
  assert.equal(persisted.account.accountId, "acct-hash-001");
  assert.equal(persisted.instrument.assetType, "EQUITY");
  assert.equal(persisted.calculation.finalQuantity, 90);
});

test("STOP_TRIGGER semantics flow through the end-to-end evaluation", async () => {
  const { service, repository } = makeHarness({
    dss: dssEvaluation(baseCandidate(), { effectiveStop: 219.20 }),
  });
  const result = await service.evaluate(request({
    entryMode: "STOP_TRIGGER",
    triggerPrice: 220.20,
  }));

  assert.equal(result.status, "VALID");
  assert.equal(result.maxAffordableQuantity, 67);
  const persisted = repository.getById(result.riskEvaluationId);
  assert.equal(persisted.entry.currentExpectedEntry, 220.2);
  assert.equal(persisted.entry.expectedEntryRule, "MAX_TRIGGER_ASK_STOP_LONG");
});

test("NO_AFFORDABLE_SIZE is persisted as a business result with zero maximum quantity", async () => {
  const candidate = baseCandidate();
  const { service, repository } = makeHarness({
    candidate,
    dss: dssEvaluation(candidate, {
      resolvedStructuralInvalidationPrice: 100.25,
      effectiveStop: 100,
    }),
  });
  const result = await service.evaluate(request());

  assert.equal(result.status, "NO_AFFORDABLE_SIZE");
  assert.equal(result.maxAffordableQuantity, 0);
  assert.deepEqual(result.reasonCodes, ["MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET"]);
  assert.equal(repository.getById(result.riskEvaluationId).calculation.finalQuantity, 0);
});

test("quote read failure becomes BLOCKED QUOTE_UNAVAILABLE rather than ERROR", async () => {
  const { service, repository } = makeHarness({ quoteError: new Error("feed unavailable") });
  const result = await service.evaluate(request());

  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["QUOTE_UNAVAILABLE"]);
  assert.equal(result.maxAffordableQuantity, null);
  assert.equal(repository.getById(result.riskEvaluationId).calculation, null);
});

test("service rechecks account freshness at the common evaluation time", async () => {
  const staleAccount = validAccount({ observedAt: "2026-09-01T17:29:49.999Z" });
  const { service, repository } = makeHarness({ account: staleAccount });
  const result = await service.evaluate(request());

  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["ACCOUNT_SNAPSHOT_STALE"]);
  const persisted = repository.getById(result.riskEvaluationId);
  assert.equal(persisted.account.snapshotAgeMs, 15_001);
});

test("independent prerequisite blockers are retained together without running sizing", async () => {
  const { service, repository } = makeHarness({
    quoteError: new Error("quote down"),
    account: blocked("ACCOUNT_SNAPSHOT_UNAVAILABLE"),
    instrument: blocked("INSTRUMENT_METADATA_UNAVAILABLE"),
  });
  const result = await service.evaluate(request());

  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, [
    "QUOTE_UNAVAILABLE",
    "ACCOUNT_SNAPSHOT_UNAVAILABLE",
    "INSTRUMENT_METADATA_UNAVAILABLE",
  ]);
  assert.equal(repository.getById(result.riskEvaluationId).calculation, null);
});

test("unexpected account provider exception is persisted as ERROR and fails closed", async () => {
  const { service, repository } = makeHarness({ accountError: new Error("unexpected adapter failure") });
  const result = await service.evaluate(request());

  assert.equal(result.status, "ERROR");
  assert.deepEqual(result.reasonCodes, ["INTERNAL_ERROR"]);
  assert.equal(repository.getById(result.riskEvaluationId).status, "ERROR");
});

test("unexpected instrument provider exception is persisted as ERROR", async () => {
  const { service, repository } = makeHarness({ instrumentError: new Error("unexpected metadata failure") });
  const result = await service.evaluate(request());

  assert.equal(result.status, "ERROR");
  assert.deepEqual(result.reasonCodes, ["INTERNAL_ERROR"]);
  assert.equal(repository.getById(result.riskEvaluationId).status, "ERROR");
});

test("unsupported entry mode is a persisted BLOCKED evaluation", async () => {
  const { service, repository } = makeHarness();
  const result = await service.evaluate(request({ entryMode: "LIMIT" }));

  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["UNSUPPORTED_ENTRY_MODE"]);
  assert.equal(repository.getById(result.riskEvaluationId).entry.entryMode, "LIMIT");
});

test("calculator currency mismatch remains BLOCKED rather than being converted to a service error", async () => {
  const { service, repository } = makeHarness({
    instrument: validInstrument({ currency: "EUR" }),
  });
  const result = await service.evaluate(request());

  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["CURRENCY_CONVERSION_UNSUPPORTED"]);
  assert.equal(repository.getById(result.riskEvaluationId).status, "BLOCKED");
});

test("exact execution account id is passed to AccountRiskProvider", async () => {
  const { service, calls } = makeHarness();
  await service.evaluate(request({ accountId: "encrypted-exact-account" }));
  assert.deepEqual(calls.account, ["encrypted-exact-account"]);
});

test("source mismatch fails before DSS handoff or any Phase 4 live reads", async () => {
  const { service, calls } = makeHarness();
  await assert.rejects(
    service.evaluate(request({ sourceId: "OTHER_SOURCE" })),
    (error) => error.code === "RISK_SIZING_PERMISSION_SOURCE_MISMATCH",
  );
  assert.deepEqual(calls.handoff, []);
  assert.deepEqual(calls.quote, []);
  assert.deepEqual(calls.account, []);
  assert.deepEqual(calls.instrument, []);
});

test("non-permission lifecycle fails before DSS handoff or live reads", async () => {
  const { service, calls } = makeHarness({ candidate: baseCandidate({ lifecycleState: "WAITING" }) });
  await assert.rejects(
    service.evaluate(request()),
    (error) => error.code === "RISK_SIZING_PERMISSION_NOT_ALLOWED_IN_STATE",
  );
  assert.deepEqual(calls.handoff, []);
  assert.deepEqual(calls.quote, []);
});

test("stale DSS handoff fails before Phase 4 live reads and creates no risk evaluation", async () => {
  const handoffError = new Error("stale DSS");
  handoffError.code = "STALE_DSS_EVALUATION";
  const { service, repository, calls } = makeHarness({ handoffError });

  await assert.rejects(service.evaluate(request()), (error) => error.code === "STALE_DSS_EVALUATION");
  assert.deepEqual(calls.quote, []);
  assert.deepEqual(calls.account, []);
  assert.deepEqual(calls.instrument, []);
  assert.deepEqual(repository.snapshot().evaluations, []);
});

test("same inputs on separate permission cycles create separate ids with the same fingerprint", async () => {
  const { service, repository } = makeHarness();
  const first = await service.evaluate(request());
  const second = await service.evaluate(request());

  assert.notEqual(first.riskEvaluationId, second.riskEvaluationId);
  const one = repository.getById(first.riskEvaluationId);
  const two = repository.getById(second.riskEvaluationId);
  assert.equal(one.inputFingerprint, two.inputFingerprint);
  assert.equal(repository.listForCandidate(first.riskEvaluationId).length, 0);
  assert.equal(repository.listForCandidate("sod-2026-09-01-NVDA-1", 1).length, 2);
});

test("permission result is immutable and exposes no READY CAUTION PASS or ARM authority", async () => {
  const { service } = makeHarness();
  const result = await service.evaluate(request());

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.reasonCodes), true);
  assert.equal("lifecycleState" in result, false);
  assert.equal("permissionStatus" in result, false);
  assert.equal("arm" in result, false);
  assert.throws(() => { result.status = "READY"; }, TypeError);
});

test("repository failure prevents a successful permission handoff", async () => {
  const repository = {
    load() {},
    record() { throw new Error("disk failure"); },
  };
  const { service } = makeHarness({ repository });

  await assert.rejects(
    service.evaluate(request()),
    (error) => error.code === "RISK_SIZING_PERMISSION_PERSISTENCE_ERROR",
  );
});

test("invalid service identity fails before any Phase 4 activity", async () => {
  const { service, calls } = makeHarness();
  await assert.rejects(
    service.evaluate(request({ candidateId: "" })),
    (error) => error.code === "INVALID_RISK_SIZING_PERMISSION_CANDIDATE_IDENTITY",
  );
  assert.deepEqual(calls.handoff, []);
  assert.deepEqual(calls.quote, []);
});
