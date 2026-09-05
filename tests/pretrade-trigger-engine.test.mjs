import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";
import { PreTradeTriggerEngine } from "../schwab-bridge/pretrade-trigger-engine.mjs";

function tempStatePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-trigger-engine-")), "state.json");
}

function baseCandidate(overrides = {}) {
  return {
    candidateId: "trigger-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "AD_HOC_CHATGPT",
    sourceDate: "2026-09-05",
    generatedAt: "2026-09-05T13:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "Breakout confirmation",
    thesis: "Continuation after objective confirmation",
    trigger: {
      evaluatorVersion: 1,
      relevance: { type: "QUOTE_COMPARISON", side: "LAST", operator: "GTE", value: 99 },
      satisfaction: { type: "BAR_CLOSE_COMPARISON", timeframe: "2m", operator: "GTE", value: 100 },
      persistence: { type: "BAR_BOUND", timeframe: "2m" },
    },
    structuralInvalidation: {
      price: 98,
      rule: "break below setup structure",
      referenceType: "SWING_LOW",
      reason: "thesis invalid below structure",
    },
    managementContract: { mode: "FLEXIBLE_WITHIN_CEILING" },
    validity: {
      validFrom: "2026-09-05T13:30:00.000Z",
      validUntil: "2026-09-05T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
    },
    armPolicy: { requestedMode: "AUTO" },
    ...overrides,
  };
}

function harness(candidate = baseCandidate()) {
  const filePath = tempStatePath();
  let now = "2026-09-05T14:00:00.000Z";
  let id = 0;
  const clock = () => now;
  const store = new PreTradeStore({ filePath });
  store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock, idFactory: () => `ingress-${++id}` });
  const imported = ingress.importBundle({
    source: candidate.source,
    bundleId: "trigger-engine-test",
    candidates: [candidate],
  });
  assert.equal(imported.outcomes[0].status, "ACCEPTED");

  const lifecycleCoordinator = new PreTradeLifecycleCoordinator({ store, clock, idFactory: () => `lifecycle-${++id}` });
  const engine = new PreTradeTriggerEngine({ store, lifecycleCoordinator, clock, idFactory: () => `trigger-${++id}` });
  return {
    filePath,
    store,
    lifecycleCoordinator,
    engine,
    setNow(value) { now = value; },
  };
}

function quote(evidenceId, observedAt, last) {
  return { type: "QUOTE_EVENT", evidenceId, observedAt, symbol: "NVDA", bid: last - 0.01, ask: last + 0.01, last };
}

function bar(evidenceId, observedAt, barTimestamp, close, timeframe = "2m") {
  return { type: "BAR_CLOSE", evidenceId, observedAt, barTimestamp, symbol: "NVDA", timeframe, close, complete: true };
}

test("relevance is evaluated separately from satisfaction and auto-activates only when relevant", () => {
  const h = harness();

  const below = h.engine.processEvidence({
    candidateId: "trigger-NVDA-1",
    contractVersion: 1,
    expectedState: "WAITING",
    expectedRevision: 0,
    evidence: quote("q1", "2026-09-05T14:00:00.000Z", 98.5),
  });
  assert.equal(below.status, "PROGRESS_RECORDED");
  assert.equal(h.store.snapshot().candidates[0].lifecycleState, "WAITING");
  assert.equal(h.store.snapshot().candidates[0].stateRevision, 1);

  const relevant = h.engine.processEvidence({
    candidateId: "trigger-NVDA-1",
    contractVersion: 1,
    expectedState: "WAITING",
    expectedRevision: 1,
    evidence: quote("q2", "2026-09-05T14:00:01.000Z", 99.25),
  });
  assert.equal(relevant.status, "ACTIVATED");
  const candidate = h.store.snapshot().candidates[0];
  assert.equal(candidate.lifecycleState, "PRETRADE_TRIGGER_EVALUATING");
  assert.equal(candidate.activation.mode, "AUTO");
  assert.equal(candidate.activation.provenance.evidenceId, "q2");
  assert.equal(candidate.stateRevision, 3);
});

test("wrong observation type cannot satisfy and completed matching bar advances to permission", () => {
  const h = harness();
  h.engine.processEvidence({ candidateId: "trigger-NVDA-1", contractVersion: 1, evidence: quote("q1", "2026-09-05T14:00:00.000Z", 99.25) });

  const wrong = h.engine.processEvidence({
    candidateId: "trigger-NVDA-1",
    contractVersion: 1,
    expectedState: "PRETRADE_TRIGGER_EVALUATING",
    expectedRevision: 2,
    evidence: bar("b1", "2026-09-05T14:01:00.000Z", "2026-09-05T14:00:00.000Z", 101, "5m"),
  });
  assert.equal(wrong.status, "PROGRESS_RECORDED");
  assert.equal(h.store.snapshot().candidates[0].lifecycleState, "PRETRADE_TRIGGER_EVALUATING");

  const satisfied = h.engine.processEvidence({
    candidateId: "trigger-NVDA-1",
    contractVersion: 1,
    expectedState: "PRETRADE_TRIGGER_EVALUATING",
    expectedRevision: 3,
    evidence: bar("b2", "2026-09-05T14:02:01.000Z", "2026-09-05T14:02:00.000Z", 100.5),
  });
  assert.equal(satisfied.status, "SATISFIED");
  const candidate = h.store.snapshot().candidates[0];
  assert.equal(candidate.lifecycleState, "PERMISSION_EVALUATING");
  assert.equal(candidate.triggerSatisfaction.authority, "PRETRADE_TRIGGER_ENGINE");
  assert.equal(candidate.triggerSatisfaction.evidenceId, "b2");
  assert.equal(candidate.triggerSatisfaction.persistence.type, "BAR_BOUND");
  assert.equal(candidate.stateRevision, 5);
});

test("identical evidence retry after lifecycle transition is idempotent", () => {
  const h = harness();
  const evidence = quote("q-retry", "2026-09-05T14:00:00.000Z", 99.5);
  const first = h.engine.processEvidence({ candidateId: "trigger-NVDA-1", contractVersion: 1, evidence });
  assert.equal(first.status, "ACTIVATED");
  const afterFirst = h.store.snapshot().candidates[0];
  const eventCount = afterFirst.lifecycleJournal.events.length;
  const revision = afterFirst.stateRevision;

  const retry = h.engine.processEvidence({ candidateId: "trigger-NVDA-1", contractVersion: 1, evidence });
  assert.equal(retry.status, "ACTIVATED");
  assert.equal(retry.duplicateEvidence, true);
  const afterRetry = h.store.snapshot().candidates[0];
  assert.equal(afterRetry.stateRevision, revision);
  assert.equal(afterRetry.lifecycleJournal.events.length, eventCount);
});

test("stale or conflicting evidence fails closed without mutating durable progress", () => {
  const h = harness();
  h.engine.processEvidence({ candidateId: "trigger-NVDA-1", contractVersion: 1, evidence: quote("q1", "2026-09-05T14:00:10.000Z", 98) });
  const before = h.store.snapshot();

  assert.throws(
    () => h.engine.processEvidence({ candidateId: "trigger-NVDA-1", contractVersion: 1, evidence: quote("q-old", "2026-09-05T14:00:09.000Z", 98) }),
    (cause) => cause.code === "STALE_TRIGGER_EVIDENCE",
  );
  assert.deepEqual(h.store.snapshot(), before);

  assert.throws(
    () => h.engine.processEvidence({ candidateId: "trigger-NVDA-1", contractVersion: 1, evidence: quote("q1", "2026-09-05T14:00:10.000Z", 101) }),
    (cause) => cause.code === "TRIGGER_EVIDENCE_ID_CONFLICT",
  );
  assert.deepEqual(h.store.snapshot(), before);
});

test("pure manual trigger requires operator activation and exact manual node confirmation", () => {
  const h = harness(baseCandidate({
    trigger: { evaluatorVersion: 1, type: "MANUAL_CONFIRMATION", prompt: "Confirm H2" },
  }));

  const premature = h.engine.processEvidence({
    candidateId: "trigger-NVDA-1",
    contractVersion: 1,
    evidence: {
      type: "MANUAL_EVENT",
      evidenceId: "m0",
      observedAt: "2026-09-05T14:00:00.000Z",
      nodeId: "satisfaction",
      confirmed: true,
    },
  });
  assert.equal(premature.status, "MANUAL_ACTIVATION_REQUIRED");
  assert.equal(h.store.snapshot().candidates[0].lifecycleState, "WAITING");

  h.lifecycleCoordinator.activateCandidate({
    operationId: "operator-activate",
    candidateId: "trigger-NVDA-1",
    contractVersion: 1,
    expectedState: "WAITING",
    expectedRevision: 1,
    activationMode: "MANUAL",
    source: "OPERATOR",
  });

  const satisfied = h.engine.processEvidence({
    candidateId: "trigger-NVDA-1",
    contractVersion: 1,
    evidence: {
      type: "MANUAL_EVENT",
      evidenceId: "m1",
      observedAt: "2026-09-05T14:00:01.000Z",
      candidateId: "trigger-NVDA-1",
      contractVersion: 1,
      nodeId: "satisfaction",
      confirmed: true,
      actor: "OPERATOR",
    },
  });
  assert.equal(satisfied.status, "SATISFIED");
  assert.equal(h.store.snapshot().candidates[0].lifecycleState, "PERMISSION_EVALUATING");
});

test("durable trigger progress survives restart and recovery forward-completes a missed activation", () => {
  const h = harness();
  const originalActivate = h.lifecycleCoordinator.activateCandidate.bind(h.lifecycleCoordinator);
  h.lifecycleCoordinator.activateCandidate = () => {
    throw Object.assign(new Error("simulated transition outage"), { code: "SIMULATED_TRANSITION_OUTAGE" });
  };

  assert.throws(
    () => h.engine.processEvidence({
      candidateId: "trigger-NVDA-1",
      contractVersion: 1,
      evidence: quote("q-recover", "2026-09-05T14:00:00.000Z", 99.5),
    }),
    (cause) => cause.code === "SIMULATED_TRANSITION_OUTAGE",
  );
  h.lifecycleCoordinator.activateCandidate = originalActivate;

  const persisted = new PreTradeStore({ filePath: h.filePath });
  persisted.load();
  const lifecycle = new PreTradeLifecycleCoordinator({ store: persisted, clock: () => "2026-09-05T14:00:01.000Z" });
  const recovered = new PreTradeTriggerEngine({ store: persisted, lifecycleCoordinator: lifecycle, clock: () => "2026-09-05T14:00:01.000Z" });
  const result = recovered.recoverCandidate("trigger-NVDA-1", 1);
  assert.equal(result.status, "ACTIVATED");
  assert.equal(persisted.snapshot().candidates[0].lifecycleState, "PRETRADE_TRIGGER_EVALUATING");
});
