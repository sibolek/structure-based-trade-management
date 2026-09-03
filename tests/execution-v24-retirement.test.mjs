import test from "node:test";
import assert from "node:assert/strict";

import {
  EXECUTION_V23_STORE_KEY,
  bindAndPersistV24ExecutionListeningAt,
  buildPreparedV24LocalInstallation,
  persistPreparedV24LocalInstallation,
} from "../src/execution/execution-v24-local-installation.js";
import {
  assertV24HandoffRetirementAllowsActivation,
  bindAndPersistV24ExecutionListeningAtGuarded,
  buildV23CandidateFromActiveListeningInstallation,
  executionOwnedSymbolsFromV23StoreWithRetirement,
  persistPreparedV24LocalInstallationGuarded,
  readV24Retirement,
  requestV24Retirement,
  resolveV24Retirement,
} from "../src/execution/execution-v24-retirement.js";

function handoff(overrides = {}) {
  return {
    schemaVersion: 1,
    handoffId: "handoff-001",
    createdAt: "2026-09-02T18:00:01.000Z",
    authorizedAt: "2026-09-02T18:00:00.000Z",
    sourceId: "SOD_A_PLUS",
    candidateId: "candidate-001",
    contractVersion: 3,
    candidateContentHash: "hash-001",
    symbol: "NVDA",
    direction: "LONG",
    setup: "H2 continuation",
    timeframe: "2m",
    thesis: "Continuation after structural pullback",
    trigger: { type: "BREAKOUT", level: 225.75 },
    targets: [227, 228],
    managementPlan: "Manage against structure",
    structuralInvalidation: 224.8,
    effectiveStop: 224.65,
    currentExpectedEntry: 225.8,
    selectedQuantity: 20,
    authorizedExecutionAccountId: "opaque-account-A",
    dssEvaluationId: "dss-001",
    riskEvaluationId: "risk-001",
    ...overrides,
  };
}

function memoryStorage(initialStore = null) {
  const values = new Map();
  if (initialStore) values.set(EXECUTION_V23_STORE_KEY, JSON.stringify(initialStore));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function installListening(storage, overrides = {}) {
  const prepared = persistPreparedV24LocalInstallation({
    storage,
    installation: buildPreparedV24LocalInstallation({
      handoff: handoff(overrides),
      receiverId: "receiver-A",
      preparedAt: "2026-09-02T18:00:02.000Z",
    }),
  });
  return bindAndPersistV24ExecutionListeningAt({
    storage,
    handoffId: prepared.handoffId,
    executionListeningAt: "2026-09-02T18:00:03.000Z",
  });
}

function execution({
  accountId = "opaque-account-A",
  symbol = "NVDA",
  instruction = "BUY",
  positionEffect = "OPENING",
  quantity = 5,
  price = 225.9,
  executionTime = "2026-09-02T18:00:03.500Z",
  detectedAt = "2026-09-02T18:00:04.500Z",
  sequence = 1,
} = {}) {
  return {
    sequence,
    accountId,
    account: "••••8891",
    symbol,
    instruction,
    positionEffect,
    quantity,
    price,
    executionTime,
    detectedAt,
    stateEvent: "ENTRY",
    previousSide: null,
    previousQuantity: 0,
    nextSide: instruction === "SELL_SHORT" ? "SHORT" : "LONG",
    nextQuantity: quantity,
    averagePrice: price,
  };
}

function brokerState({
  coverageStartedAt = "2026-09-02T18:00:02.500Z",
  currentThrough = "2026-09-02T18:00:05.000Z",
  entries = [],
  status = "CONTIGUOUS",
  lastError = null,
} = {}) {
  return {
    status: "ARMED",
    readOnly: true,
    source: "SCHWAB",
    lastError,
    accounts: [{ accountId: "opaque-account-A" }],
    executionCoverage: {
      schemaVersion: 1,
      status,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: status === "CONTIGUOUS" ? coverageStartedAt : coverageStartedAt,
      baselineCompletedAt: coverageStartedAt,
      currentThrough,
      lastGapAt: status === "GAP" ? currentThrough : null,
      lastGapReason: status === "GAP" ? "poll failed" : null,
    },
    executionOwnershipJournal: {
      schemaVersion: 1,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: status === "CONTIGUOUS" ? coverageStartedAt : null,
      currentThrough: status === "CONTIGUOUS" ? currentThrough : null,
      entries: status === "CONTIGUOUS" ? entries : [],
    },
  };
}

function stored(storage) {
  return JSON.parse(storage.getItem(EXECUTION_V23_STORE_KEY));
}

test("PREPARED discard finalizes immediately because listening ownership never began", () => {
  const storage = memoryStorage();
  const prepared = persistPreparedV24LocalInstallation({
    storage,
    installation: buildPreparedV24LocalInstallation({ handoff: handoff(), receiverId: "receiver-A" }),
  });

  const retirement = requestV24Retirement({
    storage,
    handoffId: prepared.handoffId,
    receiverId: "receiver-A",
    requestedAt: "2026-09-02T18:00:02.500Z",
  });

  assert.equal(retirement.status, "RETIRED");
  assert.equal(retirement.executionListeningAt, null);
  assert.equal(retirement.cutoffAt, "2026-09-02T18:00:02.500Z");
  assert.equal(retirement.finalizedAt, retirement.requestedAt);
});

test("LISTENING discard freezes one immutable REQUESTED cutoff", () => {
  const storage = memoryStorage();
  const listening = installListening(storage);
  const first = requestV24Retirement({
    storage,
    handoffId: listening.handoffId,
    receiverId: "receiver-A",
    requestedAt: "2026-09-02T18:00:04.000Z",
  });
  const retry = requestV24Retirement({
    storage,
    handoffId: listening.handoffId,
    receiverId: "receiver-A",
    requestedAt: "2026-09-02T18:00:04.900Z",
  });

  assert.equal(first.status, "REQUESTED");
  assert.equal(first.cutoffAt, "2026-09-02T18:00:04.000Z");
  assert.deepEqual(retry, first);
});

test("eligible fill executed before discard wins even when detected after discard", () => {
  const storage = memoryStorage();
  const listening = installListening(storage);
  requestV24Retirement({
    storage,
    handoffId: listening.handoffId,
    requestedAt: "2026-09-02T18:00:04.000Z",
  });

  const resolved = resolveV24Retirement({
    storage,
    handoffId: listening.handoffId,
    brokerState: brokerState({
      entries: [execution({
        executionTime: "2026-09-02T18:00:03.500Z",
        detectedAt: "2026-09-02T18:00:04.500Z",
      })],
    }),
    finalizedAt: "2026-09-02T18:00:05.100Z",
  });

  assert.equal(resolved.status, "SUPERSEDED_BY_PRIOR_FILL");
  assert.equal(resolved.priorFill.executionTime, "2026-09-02T18:00:03.500Z");
  assert.equal(resolved.priorFill.detectedAt, "2026-09-02T18:00:04.500Z");
});

test("execution exactly at discard cutoff is ineligible and retirement succeeds", () => {
  const storage = memoryStorage();
  const listening = installListening(storage);
  requestV24Retirement({
    storage,
    handoffId: listening.handoffId,
    requestedAt: "2026-09-02T18:00:04.000Z",
  });

  const resolved = resolveV24Retirement({
    storage,
    handoffId: listening.handoffId,
    brokerState: brokerState({
      entries: [execution({ executionTime: "2026-09-02T18:00:04.000Z" })],
    }),
  });

  assert.equal(resolved.status, "RETIRED");
  assert.equal(resolved.priorFill, null);
});

test("execution after discard cutoff cannot resurrect listener", () => {
  const storage = memoryStorage();
  const listening = installListening(storage);
  requestV24Retirement({ storage, handoffId: listening.handoffId, requestedAt: "2026-09-02T18:00:04.000Z" });
  const resolved = resolveV24Retirement({
    storage,
    handoffId: listening.handoffId,
    brokerState: brokerState({ entries: [execution({ executionTime: "2026-09-02T18:00:04.500Z" })] }),
  });
  assert.equal(resolved.status, "RETIRED");
});

test("complete clean listening interval through cutoff finalizes RETIRED", () => {
  const storage = memoryStorage();
  const listening = installListening(storage);
  requestV24Retirement({ storage, handoffId: listening.handoffId, requestedAt: "2026-09-02T18:00:04.000Z" });
  const resolved = resolveV24Retirement({ storage, handoffId: listening.handoffId, brokerState: brokerState() });
  assert.equal(resolved.status, "RETIRED");
  assert.ok(resolved.finalizedAt);
});

test("coverage gap after listening requires reconciliation and retains ownership", () => {
  const storage = memoryStorage();
  const listening = installListening(storage);
  requestV24Retirement({ storage, handoffId: listening.handoffId, requestedAt: "2026-09-02T18:00:04.000Z" });
  const resolved = resolveV24Retirement({
    storage,
    handoffId: listening.handoffId,
    brokerState: brokerState({ status: "GAP", currentThrough: "2026-09-02T18:00:03.500Z" }),
  });
  assert.equal(resolved.status, "RECONCILIATION_REQUIRED");
  assert.deepEqual(executionOwnedSymbolsFromV23StoreWithRetirement(stored(storage)), ["NVDA"]);
});

test("recovered coverage beginning after executionListeningAt cannot finalize clean retirement", () => {
  const storage = memoryStorage();
  const listening = installListening(storage);
  requestV24Retirement({ storage, handoffId: listening.handoffId, requestedAt: "2026-09-02T18:00:04.000Z" });
  const resolved = resolveV24Retirement({
    storage,
    handoffId: listening.handoffId,
    brokerState: brokerState({ coverageStartedAt: "2026-09-02T18:00:03.500Z" }),
  });
  assert.equal(resolved.status, "RECONCILIATION_REQUIRED");
});

test("wrong-account activity before cutoff does not become owned and discard can retire after complete proof", () => {
  const storage = memoryStorage();
  const listening = installListening(storage);
  requestV24Retirement({ storage, handoffId: listening.handoffId, requestedAt: "2026-09-02T18:00:04.000Z" });
  const resolved = resolveV24Retirement({
    storage,
    handoffId: listening.handoffId,
    brokerState: brokerState({ entries: [execution({ accountId: "opaque-account-B" })] }),
  });
  assert.equal(resolved.status, "RETIRED");
});

test("RETIRED releases V2.4 installation symbol ownership but preserves audit record", () => {
  const storage = memoryStorage();
  const listening = installListening(storage);
  requestV24Retirement({ storage, handoffId: listening.handoffId, requestedAt: "2026-09-02T18:00:04.000Z" });
  resolveV24Retirement({ storage, handoffId: listening.handoffId, brokerState: brokerState() });

  const store = stored(storage);
  assert.equal(store.v24Installations.length, 1);
  assert.equal(store.v24Retirements.length, 1);
  assert.deepEqual(executionOwnedSymbolsFromV23StoreWithRetirement(store), []);
});

test("SUPERSEDED_BY_PRIOR_FILL retains symbol ownership for downstream LIVE promotion", () => {
  const storage = memoryStorage();
  const listening = installListening(storage);
  requestV24Retirement({ storage, handoffId: listening.handoffId, requestedAt: "2026-09-02T18:00:04.000Z" });
  resolveV24Retirement({
    storage,
    handoffId: listening.handoffId,
    brokerState: brokerState({ entries: [execution()] }),
  });
  assert.deepEqual(executionOwnedSymbolsFromV23StoreWithRetirement(stored(storage)), ["NVDA"]);
});

test("retired handoff cannot be prepared, rebound, or activated after reload", () => {
  const storage = memoryStorage();
  const listening = installListening(storage);
  requestV24Retirement({ storage, handoffId: listening.handoffId, requestedAt: "2026-09-02T18:00:04.000Z" });
  const retired = resolveV24Retirement({ storage, handoffId: listening.handoffId, brokerState: brokerState() });

  assert.equal(readV24Retirement({ storage, handoffId: listening.handoffId }).status, "RETIRED");
  assert.throws(
    () => assertV24HandoffRetirementAllowsActivation({ storage, handoffId: listening.handoffId }),
    (error) => error.code === "V24_HANDOFF_RETIRED",
  );
  assert.throws(
    () => persistPreparedV24LocalInstallationGuarded({
      storage,
      installation: buildPreparedV24LocalInstallation({ handoff: handoff(), receiverId: "receiver-A" }),
    }),
    (error) => error.code === "V24_HANDOFF_RETIRED",
  );
  assert.throws(
    () => bindAndPersistV24ExecutionListeningAtGuarded({
      storage,
      handoffId: listening.handoffId,
      executionListeningAt: "2026-09-02T18:00:06.000Z",
    }),
    (error) => error.code === "V24_HANDOFF_RETIRED",
  );
  assert.throws(
    () => buildV23CandidateFromActiveListeningInstallation({ installation: listening, retirement: retired }),
    (error) => error.code === "V24_HANDOFF_RETIRED",
  );
});

test("retirement request is receiver-bound", () => {
  const storage = memoryStorage();
  const listening = installListening(storage);
  assert.throws(
    () => requestV24Retirement({
      storage,
      handoffId: listening.handoffId,
      receiverId: "receiver-B",
      requestedAt: "2026-09-02T18:00:04.000Z",
    }),
    (error) => error.code === "EXECUTION_BOARD_HANDOFF_CLAIM_RECEIVER_MISMATCH",
  );
});

test("retirement persistence failure is fail-closed", () => {
  const base = memoryStorage();
  installListening(base);
  const raw = base.getItem(EXECUTION_V23_STORE_KEY);
  const storage = {
    getItem(key) {
      return key === EXECUTION_V23_STORE_KEY ? raw : null;
    },
    setItem() {
      throw new Error("quota failure");
    },
  };
  assert.throws(
    () => requestV24Retirement({ storage, handoffId: "handoff-001", requestedAt: "2026-09-02T18:00:04.000Z" }),
    (error) => error.code === "LOCAL_EXECUTION_PERSISTENCE_FAILED",
  );
});


test("contiguous broker coverage still behind retirement cutoff remains REQUESTED", () => {
  const storage = memoryStorage();
  const listening = installListening(storage);

  requestV24Retirement({
    storage,
    handoffId: listening.handoffId,
    requestedAt: "2026-09-02T18:00:04.000Z",
  });

  const resolved = resolveV24Retirement({
    storage,
    handoffId: listening.handoffId,
    brokerState: brokerState({
      currentThrough: "2026-09-02T18:00:03.750Z",
    }),
    finalizedAt: "2026-09-02T18:00:05.000Z",
  });

  assert.equal(resolved.status, "REQUESTED");
  assert.equal(resolved.cutoffAt, "2026-09-02T18:00:04.000Z");
  assert.equal(resolved.finalizedAt, null);

  const durable = readV24Retirement({
    storage,
    handoffId: listening.handoffId,
  });

  assert.equal(durable.status, "REQUESTED");
  assert.equal(durable.cutoffAt, "2026-09-02T18:00:04.000Z");
  assert.equal(durable.finalizedAt, null);
  assert.deepEqual(
    executionOwnedSymbolsFromV23StoreWithRetirement(stored(storage)),
    ["NVDA"],
  );
});
