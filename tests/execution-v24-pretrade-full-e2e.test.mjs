import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";
import { buildPermissionAttempt } from "../schwab-bridge/pretrade-permission-attempt.mjs";
import { PreTradePermissionAttemptRepository } from "../schwab-bridge/pretrade-permission-attempt-repository.mjs";
import { PreTradeReviewRepository } from "../schwab-bridge/pretrade-review-repository.mjs";
import { PreTradeReviewService } from "../schwab-bridge/pretrade-review-service.mjs";
import { PreTradeOcoRepository } from "../schwab-bridge/pretrade-oco-repository.mjs";
import { PreTradeOcoService } from "../schwab-bridge/pretrade-oco-service.mjs";
import { PreTradeArmOperationRepository } from "../schwab-bridge/pretrade-arm-operation-repository.mjs";
import { PreTradeArmLifecycleAuthority } from "../schwab-bridge/pretrade-arm-lifecycle-authority.mjs";
import { PreTradeArmService } from "../schwab-bridge/pretrade-arm-service.mjs";
import { ExecutionBoardHandoffRepository } from "../schwab-bridge/execution-board-handoff-repository.mjs";
import { ExecutionBoardHandoffDeliveryRepository } from "../schwab-bridge/execution-board-handoff-delivery-repository.mjs";
import { createExecutionBoardHandoffApiHandler } from "../schwab-bridge/execution-board-handoff-api.mjs";
import {
  EXECUTION_BOARD_STORE_KEY,
  readExecutionBoardStore,
  transactExecutionBoardStoreSerialized,
} from "../src/execution/execution-board-store-repository.js";
import {
  executionOwnedSymbolsForHandoffAdmission,
  v24OwnershipView,
} from "../src/execution/execution-v24-active-ownership.js";
import { executionStop } from "../src/execution/execution-v23-compat.js";
import { createV24HandoffTransport } from "../src/execution/execution-v24-handoff-transport.js";
import { runV24ManagedExecutionRouterCycle } from "../src/execution/execution-v24-managed-runtime-router.js";

const CANDIDATE_ID = "pretrade-full-e2e-NVDA";
const RECEIVER_ID = "receiver-pretrade-full-e2e";
const ACCOUNT_ID = "acct-1";
const SYMBOL = "NVDA";

const ARM_AT = "2026-09-06T15:00:01.000Z";
const CLAIMED_AT = "2026-09-06T15:00:02.000Z";
const LISTENING_AT = "2026-09-06T15:00:03.000Z";
const DELIVERED_AT = "2026-09-06T15:00:03.600Z";
const FIRST_FILL_AT = "2026-09-06T15:00:04.000Z";
const PARTIAL_AT = "2026-09-06T15:00:05.000Z";
const FLAT_AT = "2026-09-06T15:00:06.000Z";
const COMPLETED_AT = "2026-09-06T15:00:07.000Z";
const COVERAGE_STARTED_AT = "2026-09-06T14:59:59.000Z";

function fileIn(tempDir, name) {
  return path.join(tempDir, `${name}.json`);
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function serialLockManager() {
  let tail = Promise.resolve();
  return {
    request(_name, _options, callback) {
      const run = tail.then(() => callback());
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}

function proposal() {
  return {
    candidateId: CANDIDATE_ID,
    contractVersion: 1,
    schemaVersion: 1,
    source: "SOD_A_PLUS_TRADES",
    sourceDate: "2026-09-06",
    generatedAt: "2026-09-06T13:00:00.000Z",
    symbol: SYMBOL,
    direction: "LONG",
    setup: "Breakout retest",
    timeframe: "2m",
    thesis: "Continuation if retest holds.",
    trigger: { type: "MANUAL_CONFIRMATION", evaluatorVersion: 1 },
    structuralInvalidation: {
      price: 179.5,
      rule: "break below retest",
      referenceType: "SWING_LOW",
      reason: "thesis fails",
    },
    targets: [181, 182],
    managementContract: {
      mode: "FLEXIBLE_WITHIN_CEILING",
      allowReAdd: true,
    },
    validity: {
      validFrom: "2026-09-06T14:00:00.000Z",
      validUntil: "2026-09-06T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
    },
    armPolicy: { requestedMode: "MANUAL" },
  };
}

function risk(candidate, { id, dssId } = {}) {
  return {
    riskEvaluationId: id,
    status: "VALID",
    candidate: {
      sourceId: candidate.source,
      candidateId: candidate.candidateId,
      contractVersion: candidate.contractVersion,
      candidateHash: candidate.contentHash,
      symbol: candidate.symbol,
      direction: candidate.direction,
    },
    dss: {
      dssEvaluationId: dssId,
      structuralInvalidation: 179.5,
      effectiveStop: 179.25,
    },
    entry: {
      entryMode: "MARKETABLE_NOW",
      currentExpectedEntry: 180,
      bid: 179.99,
      ask: 180,
      quoteObservedAt: "2026-09-06T15:00:00.500Z",
      quoteAgeMs: 500,
      quoteSource: "SCHWAB",
      expectedEntryRule: "ASK_MARKETABLE_LONG",
    },
    account: {
      accountId: ACCOUNT_ID,
      accountEquity: 13500,
      accountCurrency: "USD",
      snapshotObservedAt: "2026-09-06T15:00:00.000Z",
      snapshotAgeMs: 1000,
      snapshotSource: "SCHWAB",
      sourceSnapshotId: `account-${id}`,
      maxDollarRisk: 67.5,
      riskFraction: 0.005,
    },
    instrument: {
      assetType: "EQUITY",
      symbol: SYMBOL,
      instrumentCurrency: "USD",
      minimumQuantity: 1,
      quantityIncrement: 1,
      tickSize: 0.01,
      tickValue: 0.01,
      pointValue: 1,
      metadataSource: "SCHWAB",
      metadataObservedAt: "2026-09-06T15:00:00.000Z",
      metadataVersion: "equity-e2e-v1",
    },
    calculation: {
      finalQuantity: 90,
      plannedDollarRisk: 67.5,
      plannedRiskFraction: 0.005,
    },
  };
}

function permissionDecision(candidate, id) {
  return {
    authority: "PRETRADE_PERMISSION_DECISION",
    permissionDecisionId: `decision-${id}`,
    candidateId: candidate.candidateId,
    contractVersion: candidate.contractVersion,
    candidateContentHash: candidate.contentHash,
    kind: "OUTCOME",
    outcome: "READY",
    reasonCode: null,
    reasonCodes: [],
  };
}

function permissionAttempt(candidate, riskEvaluation, id, stateRevision) {
  return buildPermissionAttempt({
    permissionAttemptId: id,
    operationId: `permission-op-${id}`,
    operationHash: `hash-${id}`,
    candidate: { ...candidate, stateRevision },
    triggerSatisfaction: {
      authority: "PRETRADE_TRIGGER_ENGINE",
      evidenceId: "trigger-e2e",
      evidenceTimestamp: "2026-09-06T14:59:00.000Z",
    },
    structuralValidity: {
      authority: "PRETRADE_STRUCTURAL_VALIDITY",
      structuralEvaluationId: `structure-${id}`,
      status: "VALID",
      resolvedPrice: 179.5,
    },
    dssResult: {
      action: "EVALUATED",
      status: "VALID",
      dssEvaluationId: riskEvaluation.dss.dssEvaluationId,
      evaluation: {
        dssEvaluationId: riskEvaluation.dss.dssEvaluationId,
        status: "VALID",
        effectiveStop: 179.25,
      },
    },
    riskEvaluation,
    permissionDecision: permissionDecision(candidate, id),
    result: { kind: "OUTCOME", outcome: "READY", reasonCodes: [] },
    startedAt: "2026-09-06T15:00:00.000Z",
    completedAt: "2026-09-06T15:00:00.100Z",
  });
}

function buildPretradeHarness({ tempDir, clock }) {
  const store = new PreTradeStore({ filePath: fileIn(tempDir, "pretrade-state"), clock });
  store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock, idFactory: () => "ingress-e2e" });
  ingress.importBundle({
    source: "SOD_A_PLUS_TRADES",
    bundleId: "pretrade-full-e2e-bundle",
    candidates: [proposal()],
  });

  const coordinator = new PreTradeLifecycleCoordinator({
    store,
    clock,
    idFactory: (() => { let i = 0; return () => `life-e2e-${++i}`; })(),
  });

  let candidate = coordinator.candidateSnapshot(CANDIDATE_ID, 1);
  assert.equal(candidate.lifecycleState, "WAITING");
  coordinator.activateCandidate({
    operationId: "activate-e2e",
    candidateId: CANDIDATE_ID,
    contractVersion: 1,
    expectedState: "WAITING",
    expectedRevision: candidate.stateRevision,
    activationMode: "MANUAL",
    source: "OPERATOR",
    reason: "SYNTHETIC_E2E",
  });

  candidate = coordinator.candidateSnapshot(CANDIDATE_ID, 1);
  coordinator.beginPermission({
    operationId: "trigger-e2e",
    candidateId: CANDIDATE_ID,
    contractVersion: 1,
    expectedState: "PRETRADE_TRIGGER_EVALUATING",
    expectedRevision: candidate.stateRevision,
    triggerSatisfaction: {
      authority: "PRETRADE_TRIGGER_ENGINE",
      evidenceId: "trigger-e2e",
      evidenceTimestamp: "2026-09-06T14:59:00.000Z",
      mode: "ONE_SHOT",
    },
  });

  const attemptRepository = new PreTradePermissionAttemptRepository({
    filePath: fileIn(tempDir, "permission-attempts"),
    clock,
  });
  attemptRepository.load();
  const riskMap = new Map();

  candidate = coordinator.candidateSnapshot(CANDIDATE_ID, 1);
  assert.equal(candidate.lifecycleState, "PERMISSION_EVALUATING");
  const risk1 = risk(candidate, { id: "risk-e2e-1", dssId: "dss-e2e-1" });
  riskMap.set(risk1.riskEvaluationId, risk1);
  attemptRepository.record(permissionAttempt(candidate, risk1, "permission-e2e-1", candidate.stateRevision));

  const mutableCandidate = store.state.candidates.find((item) => item.candidateId === CANDIDATE_ID && Number(item.contractVersion) === 1);
  mutableCandidate.currentDssEvaluationId = "dss-e2e-1";
  mutableCandidate.currentDssEvaluationStale = false;
  store.save();

  coordinator.publishPermissionOutcome({
    operationId: "permission-ready-e2e",
    candidateId: CANDIDATE_ID,
    contractVersion: 1,
    expectedState: "PERMISSION_EVALUATING",
    expectedRevision: candidate.stateRevision,
    outcome: "READY",
    permissionEvaluationId: "permission-e2e-1",
    source: "PRETRADE_PERMISSION_PIPELINE",
    provenance: {
      permissionAttemptId: "permission-e2e-1",
      riskEvaluationId: "risk-e2e-1",
    },
  });

  const reviewRepository = new PreTradeReviewRepository({
    filePath: fileIn(tempDir, "reviews"),
    clock,
  });
  reviewRepository.load();
  const reviewService = new PreTradeReviewService({
    lifecycleCoordinator: coordinator,
    permissionAttemptRepository: attemptRepository,
    reviewRepository,
    clock,
  });
  const initialReview = reviewService.refresh({
    operationId: "review-e2e",
    candidateId: CANDIDATE_ID,
    contractVersion: 1,
  }).review;
  reviewService.selectQuantity({
    operationId: "quantity-e2e",
    candidateId: CANDIDATE_ID,
    contractVersion: 1,
    reviewPackageId: initialReview.currentPackage.reviewPackageId,
    selectedQuantity: 25,
  });

  const permissionPipeline = {
    async evaluate(command) {
      const current = coordinator.candidateSnapshot(command.candidateId, command.contractVersion);
      assert.equal(current.lifecycleState, "PERMISSION_EVALUATING");
      assert.equal(current.stateRevision, command.expectedRevision);
      assert.equal(command.operatorPermissionAssessment?.outcome, "READY");

      const risk2 = risk(current, { id: "risk-e2e-2", dssId: "dss-e2e-2" });
      riskMap.set(risk2.riskEvaluationId, risk2);
      const attempt2 = permissionAttempt(current, risk2, "permission-e2e-2", command.expectedRevision);
      attemptRepository.record(attempt2);

      const mutable = store.state.candidates.find((item) => item.candidateId === CANDIDATE_ID && Number(item.contractVersion) === 1);
      mutable.currentDssEvaluationId = "dss-e2e-2";
      mutable.currentDssEvaluationStale = false;
      store.save();

      const transition = coordinator.publishPermissionOutcome({
        operationId: `${command.operationId}:OUTCOME`,
        candidateId: command.candidateId,
        contractVersion: command.contractVersion,
        expectedState: "PERMISSION_EVALUATING",
        expectedRevision: command.expectedRevision,
        outcome: "READY",
        permissionEvaluationId: "permission-e2e-2",
        source: "PRETRADE_PERMISSION_PIPELINE",
        provenance: {
          permissionAttemptId: "permission-e2e-2",
          riskEvaluationId: "risk-e2e-2",
        },
      });
      return { status: "COMPLETED", permissionAttempt: attempt2, transition };
    },
  };

  const riskEvaluationRepository = {
    getById(id) {
      const found = riskMap.get(id);
      if (!found) {
        const error = new Error("missing risk");
        error.code = "RISK_EVALUATION_NOT_FOUND";
        throw error;
      }
      return structuredClone(found);
    },
  };

  const armOperationRepository = new PreTradeArmOperationRepository({
    filePath: fileIn(tempDir, "arm-operations"),
    clock,
  });
  armOperationRepository.load();
  const armLifecycleAuthority = new PreTradeArmLifecycleAuthority({
    store,
    clock,
    idFactory: (() => { let i = 0; return () => `arm-life-e2e-${++i}`; })(),
  });
  const ocoRepository = new PreTradeOcoRepository({ filePath: fileIn(tempDir, "oco"), clock });
  ocoRepository.load();
  const ocoService = new PreTradeOcoService({
    lifecycleCoordinator: coordinator,
    ocoRepository,
    armLifecycleAuthority,
    executionOwnershipProvider: {
      async checkSymbol(symbol) {
        return {
          status: "FREE",
          symbol,
          source: "SYNTHETIC_EXECUTION_OWNERSHIP",
          revision: 1,
          authoritative: true,
        };
      },
    },
  });

  const handoffRepository = new ExecutionBoardHandoffRepository({
    filePath: fileIn(tempDir, "handoffs"),
    clock,
  });
  handoffRepository.load();
  const deliveryRepository = new ExecutionBoardHandoffDeliveryRepository({
    handoffRepository,
    filePath: fileIn(tempDir, "deliveries"),
    clock,
  });
  deliveryRepository.load();

  const armService = new PreTradeArmService({
    lifecycleCoordinator: coordinator,
    permissionPipeline,
    reviewService,
    reviewRepository,
    permissionAttemptRepository: attemptRepository,
    riskEvaluationRepository,
    armOperationRepository,
    armLifecycleAuthority,
    handoffRepository,
    deliveryRepository,
    ocoService,
    clock,
  });

  return {
    store,
    coordinator,
    armService,
    initialReview,
    handoffRepository,
    deliveryRepository,
  };
}

function armCommand(harness) {
  return {
    operationId: "arm-e2e",
    candidateId: CANDIDATE_ID,
    contractVersion: 1,
    reviewPackageId: harness.initialReview.currentPackage.reviewPackageId,
    selectedQuantity: 25,
    confirmedDirection: "LONG",
    accountId: ACCOUNT_ID,
    entryMode: "MARKETABLE_NOW",
    operatorStructuralAssessment: {
      status: "VALID",
      actor: "OPERATOR",
      evidenceReference: "synthetic-chart-e2e",
    },
    operatorPermissionAssessment: {
      outcome: "READY",
      actor: "OPERATOR",
      evidenceReference: "synthetic-context-e2e",
    },
  };
}

function brokerExecution({
  sequence,
  executionTime,
  instruction,
  positionEffect,
  quantity,
  price,
  stateEvent,
  previousSide,
  previousQuantity,
  nextSide,
  nextQuantity,
  averagePrice,
  orderId,
}) {
  return {
    sequence,
    accountId: ACCOUNT_ID,
    account: "••••0001",
    orderId,
    executionKey: `pretrade-full-e2e-exec-${sequence}`,
    symbol: SYMBOL,
    instruction,
    positionEffect,
    quantity,
    price,
    executionTime,
    detectedAt: new Date(Date.parse(executionTime) + 200).toISOString(),
    stateEvent,
    previousSide,
    previousQuantity,
    nextSide,
    nextQuantity,
    averagePrice,
  };
}

function firstFill() {
  return brokerExecution({
    sequence: 1,
    executionTime: FIRST_FILL_AT,
    instruction: "BUY",
    positionEffect: "OPENING",
    quantity: 5,
    price: 180,
    stateEvent: "ENTRY",
    previousSide: "FLAT",
    previousQuantity: 0,
    nextSide: "LONG",
    nextQuantity: 5,
    averagePrice: 180,
    orderId: "entry-order-pretrade-e2e",
  });
}

function partialExit() {
  return brokerExecution({
    sequence: 2,
    executionTime: PARTIAL_AT,
    instruction: "SELL",
    positionEffect: "CLOSING",
    quantity: 2,
    price: 180.5,
    stateEvent: "PARTIAL",
    previousSide: "LONG",
    previousQuantity: 5,
    nextSide: "LONG",
    nextQuantity: 3,
    averagePrice: 180,
    orderId: "exit-order-pretrade-e2e-1",
  });
}

function flatExit() {
  return brokerExecution({
    sequence: 3,
    executionTime: FLAT_AT,
    instruction: "SELL",
    positionEffect: "CLOSING",
    quantity: 3,
    price: 181,
    stateEvent: "FLAT",
    previousSide: "LONG",
    previousQuantity: 3,
    nextSide: "FLAT",
    nextQuantity: 0,
    averagePrice: 0,
    orderId: "exit-order-pretrade-e2e-2",
  });
}

function brokerState(currentThrough, journalEntries = []) {
  return {
    version: 2,
    status: "ARMED",
    source: "SCHWAB",
    readOnly: true,
    brokerWriteAuthority: false,
    lastError: null,
    accounts: [{
      accountId: ACCOUNT_ID,
      account: "••••0001",
      equity: 13500,
      maxRisk: 67.5,
    }],
    positions: [],
    executionCoverage: {
      schemaVersion: 1,
      status: "CONTIGUOUS",
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: COVERAGE_STARTED_AT,
      baselineCompletedAt: COVERAGE_STARTED_AT,
      currentThrough,
      lastGapAt: null,
      lastGapReason: null,
    },
    executionActivity: {
      schemaVersion: 1,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: COVERAGE_STARTED_AT,
      currentThrough,
      entries: [],
    },
    executionOwnershipJournal: {
      schemaVersion: 1,
      source: "SCHWAB_ORDER_API_POLL",
      coverageStartedAt: COVERAGE_STARTED_AT,
      currentThrough,
      entries: structuredClone(journalEntries),
    },
  };
}

function findStage(cycle, stage) {
  return cycle.results.find((item) => item.stage === stage);
}

async function startApiServer({ handoffRepository, deliveryRepository, requests }) {
  const handler = createExecutionBoardHandoffApiHandler({ handoffRepository, deliveryRepository });
  const server = http.createServer(async (req, res) => {
    requests.push({ method: req.method, url: req.url });
    try {
      const handled = await handler(req, res);
      if (!handled) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
      }
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error.message, code: error.code || "TEST_SERVER_ERROR" }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, pretradeUrl: `http://127.0.0.1:${address.port}` };
}

async function completeExitClassification({ storage, lockManager, handoffId }) {
  return transactExecutionBoardStoreSerialized({
    storage,
    storeKey: EXECUTION_BOARD_STORE_KEY,
    lockManager,
    mutate: (latest) => {
      const trade = latest.liveTrades.find((item) => (
        item?.origin === "V24_HANDOFF" && item?.v24?.handoffId === handoffId
      ));
      if (!trade || trade.phase !== "EXIT") return latest;
      const completed = {
        ...structuredClone(trade),
        phase: "REVIEW",
        completedAt: COMPLETED_AT,
        exit: {
          reason: "TARGET / STRUCTURAL EXIT",
          classification: "PLANNED",
          time: COMPLETED_AT,
        },
      };
      return {
        ...latest,
        liveTrades: latest.liveTrades.filter((item) => item.id !== trade.id),
        history: [completed, ...latest.history],
      };
    },
  });
}

test("V2.4 synthetic canonical PRETRADE ARM through read-only Execution reaches History and releases ownership", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-pretrade-full-e2e-"));
  let serverNow = ARM_AT;
  const clock = () => serverNow;
  const pretrade = buildPretradeHarness({ tempDir, clock });

  const beforeArm = pretrade.coordinator.candidateSnapshot(CANDIDATE_ID, 1);
  assert.equal(beforeArm.lifecycleState, "READY");
  assert.equal(beforeArm.stateRevision, 3);

  const armed = await pretrade.armService.arm(armCommand(pretrade));
  assert.equal(armed.status, "COMPLETED");
  assert.equal(armed.brokerWriteAuthority, false);
  assert.equal(armed.candidate.lifecycleState, "ARMED");
  assert.equal(armed.candidate.arm.selectedQuantity, 25);
  assert.equal(armed.handoff.authorizedExecutionAccountId, ACCOUNT_ID);
  assert.equal(armed.handoff.structuralInvalidation, 179.5);
  assert.equal(armed.handoff.effectiveStop, 179.25);
  assert.equal(armed.handoff.instrumentEconomics.assetType, "EQUITY");
  assert.equal(armed.delivery.status, "PENDING");
  assert.equal(armed.candidate.arm.handoffId, armed.handoff.handoffId);

  const handoffId = armed.handoff.handoffId;
  const requests = [];
  const { server, pretradeUrl } = await startApiServer({
    handoffRepository: pretrade.handoffRepository,
    deliveryRepository: pretrade.deliveryRepository,
    requests,
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const transport = createV24HandoffTransport({ pretradeUrl });
  const storage = memoryStorage();
  const lockManager = serialLockManager();
  const proposedBoundaries = new Map();
  const brokerSnapshots = [];

  serverNow = CLAIMED_AT;
  let broker = brokerState("2026-09-06T15:00:02.500Z");
  brokerSnapshots.push(broker);
  const prepared = await runV24ManagedExecutionRouterCycle({
    transport,
    receiverId: RECEIVER_ID,
    brokerState: broker,
    storage,
    proposedBoundaries,
    now: () => LISTENING_AT,
    lockManager,
  });
  assert.equal(findStage(prepared, "ACTIVATION").status, "WAITING_FOR_BROKER_PROOF");
  assert.equal(pretrade.deliveryRepository.getById(handoffId).status, "CLAIMED");

  let store = readExecutionBoardStore({ storage });
  let ownership = v24OwnershipView(store, handoffId);
  assert.equal(ownership.installation.status, "PREPARED");
  assert.equal(ownership.installation.compatibility.v24.selectedQuantity, 25);
  assert.equal(ownership.installation.compatibility.v24.effectiveStop, 179.25);
  assert.deepEqual(executionOwnedSymbolsForHandoffAdmission(store), [SYMBOL]);

  serverNow = DELIVERED_AT;
  broker = brokerState("2026-09-06T15:00:03.500Z");
  brokerSnapshots.push(broker);
  const delivered = await runV24ManagedExecutionRouterCycle({
    transport,
    receiverId: RECEIVER_ID,
    brokerState: broker,
    storage,
    proposedBoundaries,
    now: () => DELIVERED_AT,
    lockManager,
  });
  assert.equal(findStage(delivered, "ACTIVATION").status, "DELIVERED");
  assert.equal(pretrade.deliveryRepository.getById(handoffId).executionListeningAt, LISTENING_AT);

  store = readExecutionBoardStore({ storage });
  ownership = v24OwnershipView(store, handoffId);
  assert.equal(ownership.installation.status, "LISTENING");
  assert.equal(ownership.lifecycle, null);

  const first = firstFill();
  broker = brokerState("2026-09-06T15:00:04.500Z", [first]);
  brokerSnapshots.push(broker);
  const promoted = await runV24ManagedExecutionRouterCycle({
    transport,
    receiverId: RECEIVER_ID,
    brokerState: broker,
    storage,
    proposedBoundaries,
    now: () => "2026-09-06T15:00:04.600Z",
    lockManager,
  });
  assert.equal(findStage(promoted, "FIRST_FILL").status, "PROMOTED_LIVE");

  store = readExecutionBoardStore({ storage });
  ownership = v24OwnershipView(store, handoffId);
  assert.equal(ownership.lifecycle.status, "LIVE");
  assert.equal(ownership.lifecycle.currentQuantity, 5);
  assert.equal(ownership.lifecycle.management.armQuantityCeiling, 25);
  assert.equal(ownership.lifecycle.management.currentEffectiveStop.price, 179.25);
  assert.equal(ownership.lifecycle.management.risk.authorizedMaxDollarRisk, 67.5);

  let trade = store.liveTrades.find((item) => item?.v24?.handoffId === handoffId);
  assert.ok(trade);
  assert.equal(trade.origin, "V24_HANDOFF");
  assert.equal(trade.phase, "LIVE");
  assert.equal(trade.broker.accountId, ACCOUNT_ID);
  assert.equal(executionStop(trade), 179.25);

  const partial = partialExit();
  broker = brokerState("2026-09-06T15:00:05.500Z", [first, partial]);
  brokerSnapshots.push(broker);
  const partialCycle = await runV24ManagedExecutionRouterCycle({
    transport,
    receiverId: RECEIVER_ID,
    brokerState: broker,
    storage,
    proposedBoundaries,
    now: () => "2026-09-06T15:00:05.600Z",
    lockManager,
  });
  assert.equal(findStage(partialCycle, "LIFECYCLE").status, "LIVE");

  store = readExecutionBoardStore({ storage });
  ownership = v24OwnershipView(store, handoffId);
  assert.equal(ownership.lifecycle.currentQuantity, 3);
  assert.equal(ownership.lifecycle.closingQuantity, 2);
  assert.deepEqual(executionOwnedSymbolsForHandoffAdmission(store), [SYMBOL]);

  const flat = flatExit();
  broker = brokerState("2026-09-06T15:00:06.500Z", [first, partial, flat]);
  brokerSnapshots.push(broker);
  const exitCycle = await runV24ManagedExecutionRouterCycle({
    transport,
    receiverId: RECEIVER_ID,
    brokerState: broker,
    storage,
    proposedBoundaries,
    now: () => "2026-09-06T15:00:06.600Z",
    lockManager,
  });
  assert.equal(findStage(exitCycle, "LIFECYCLE").status, "EXIT");

  store = readExecutionBoardStore({ storage });
  ownership = v24OwnershipView(store, handoffId);
  assert.equal(ownership.lifecycle.status, "EXIT");
  assert.equal(ownership.lifecycle.currentQuantity, 0);
  assert.equal(ownership.lifecycleReservesSymbol, true);

  await completeExitClassification({ storage, lockManager, handoffId });
  store = readExecutionBoardStore({ storage });
  ownership = v24OwnershipView(store, handoffId);
  assert.equal(ownership.lifecycle.status, "EXIT");
  assert.equal(ownership.lifecycleReservesSymbol, false);
  assert.equal(store.liveTrades.some((item) => item?.v24?.handoffId === handoffId), false);

  const history = store.history.find((item) => item?.v24?.handoffId === handoffId);
  assert.ok(history);
  assert.equal(history.origin, "V24_HANDOFF");
  assert.equal(history.phase, "REVIEW");
  assert.equal(history.completedAt, COMPLETED_AT);
  assert.equal(executionStop(history), 179.25);
  assert.deepEqual(executionOwnedSymbolsForHandoffAdmission(store), []);

  const finalCycle = await runV24ManagedExecutionRouterCycle({
    transport: null,
    receiverId: RECEIVER_ID,
    brokerState: broker,
    storage,
    proposedBoundaries: new Map(),
    now: () => "2026-09-06T15:00:07.500Z",
    lockManager,
  });
  assert.equal(findStage(finalCycle, "TRANSPORT").status, "WAITING_FOR_PRETRADE");
  assert.equal(findStage(finalCycle, "LIFECYCLE").status, "HISTORY_COMPLETE");

  const finalPretrade = pretrade.coordinator.candidateSnapshot(CANDIDATE_ID, 1);
  assert.equal(finalPretrade.lifecycleState, "ARMED");
  assert.equal(finalPretrade.arm.handoffId, handoffId);

  for (const snapshot of brokerSnapshots) {
    assert.equal(snapshot.readOnly, true);
    assert.equal(snapshot.brokerWriteAuthority, false);
    assert.equal(typeof snapshot.placeOrder, "undefined");
    assert.equal(typeof snapshot.cancelOrder, "undefined");
    assert.equal(typeof snapshot.replaceOrder, "undefined");
    assert.equal(typeof snapshot.flatten, "undefined");
  }

  assert.ok(requests.some((item) => item.method === "GET" && item.url.startsWith("/api/handoffs?receiverId=")));
  assert.ok(requests.some((item) => item.method === "POST" && item.url === `/api/handoffs/${handoffId}/claim`));
  assert.ok(requests.some((item) => item.method === "POST" && item.url === `/api/handoffs/${handoffId}/ack`));
  assert.equal(requests.some((item) => /order|cancel|replace|flatten|stop/i.test(item.url)), false);
});
