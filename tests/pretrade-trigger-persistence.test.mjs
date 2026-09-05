import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";
import { PreTradeTriggerEngine } from "../schwab-bridge/pretrade-trigger-engine.mjs";
import { PreTradeTriggerPersistenceAuthority } from "../schwab-bridge/pretrade-trigger-persistence-authority.mjs";
import { PreTradeTriggerPersistenceMonitor } from "../schwab-bridge/pretrade-trigger-persistence-monitor.mjs";

function candidate(trigger) {
  return {
    candidateId: "persist-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "AD_HOC_CHATGPT",
    sourceDate: "2026-09-05",
    generatedAt: "2026-09-05T13:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "Persistence test",
    thesis: "Trigger remains valid only under frozen persistence semantics",
    trigger,
    structuralInvalidation: {
      price: 98,
      rule: "break below structure",
      referenceType: "SWING_LOW",
      reason: "thesis invalid",
    },
    managementContract: { mode: "FLEXIBLE_WITHIN_CEILING" },
    validity: {
      validFrom: "2026-09-05T13:30:00.000Z",
      validUntil: "2026-09-05T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
    },
    armPolicy: { requestedMode: "MANUAL" },
  };
}

function harness(trigger) {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-trigger-persist-")), "state.json");
  let now = "2026-09-05T14:00:00.000Z";
  let id = 0;
  const clock = () => now;
  const store = new PreTradeStore({ filePath });
  store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock, idFactory: () => `ingress-${++id}` });
  const imported = ingress.importBundle({ source: "AD_HOC_CHATGPT", bundleId: "persistence-test", candidates: [candidate(trigger)] });
  assert.equal(imported.outcomes[0].status, "ACCEPTED");
  const lifecycle = new PreTradeLifecycleCoordinator({ store, clock, idFactory: () => `lifecycle-${++id}` });
  const engine = new PreTradeTriggerEngine({ store, lifecycleCoordinator: lifecycle, clock, idFactory: () => `trigger-${++id}` });
  const authority = new PreTradeTriggerPersistenceAuthority({ store, clock, idFactory: () => `persist-${++id}` });
  const monitor = new PreTradeTriggerPersistenceMonitor({ store, persistenceAuthority: authority, clock });
  return { store, lifecycle, engine, authority, monitor, setNow(value) { now = value; } };
}

function activate(h) {
  return h.lifecycle.activateCandidate({
    operationId: "operator-activate",
    candidateId: "persist-NVDA-1",
    contractVersion: 1,
    expectedState: "WAITING",
    expectedRevision: 0,
    activationMode: "MANUAL",
    source: "OPERATOR",
  });
}

test("CONDITION_HELD quote satisfaction remains valid while condition holds and returns to trigger evaluation when it fails", () => {
  const h = harness({
    evaluatorVersion: 1,
    type: "QUOTE_COMPARISON",
    side: "LAST",
    operator: "GTE",
    value: 100,
  });
  activate(h);
  const satisfied = h.engine.processEvidence({
    candidateId: "persist-NVDA-1",
    contractVersion: 1,
    evidence: { type: "QUOTE_EVENT", evidenceId: "q-satisfy", observedAt: "2026-09-05T14:00:00.000Z", symbol: "NVDA", last: 100.25 },
  });
  assert.equal(satisfied.status, "SATISFIED");
  assert.equal(h.store.snapshot().candidates[0].stateRevision, 3);

  const held = h.monitor.processEvidence({
    candidateId: "persist-NVDA-1",
    contractVersion: 1,
    expectedState: "PERMISSION_EVALUATING",
    expectedRevision: 3,
    evidence: { type: "QUOTE_EVENT", evidenceId: "q-held", observedAt: "2026-09-05T14:00:01.000Z", symbol: "NVDA", last: 100.1 },
  });
  assert.equal(held.status, "STILL_VALID");
  assert.equal(h.store.snapshot().candidates[0].stateRevision, 3);

  h.store.state.candidates[0].currentDssEvaluationId = "dss-placeholder";
  h.store.save();
  const expired = h.monitor.processEvidence({
    candidateId: "persist-NVDA-1",
    contractVersion: 1,
    expectedState: "PERMISSION_EVALUATING",
    expectedRevision: 3,
    evidence: { type: "QUOTE_EVENT", evidenceId: "q-fail", observedAt: "2026-09-05T14:00:02.000Z", symbol: "NVDA", last: 99.9 },
  });
  assert.equal(expired.status, "EXPIRED_TO_TRIGGER_EVALUATING");
  const candidateAfter = h.store.snapshot().candidates[0];
  assert.equal(candidateAfter.lifecycleState, "PRETRADE_TRIGGER_EVALUATING");
  assert.equal(candidateAfter.stateRevision, 4);
  assert.equal(candidateAfter.triggerSatisfaction, null);
  assert.equal(candidateAfter.currentDssEvaluationStale, true);
  assert.equal(candidateAfter.currentDssEvaluationStaleReason, "TRIGGER_SATISFACTION_EXPIRED");
  assert.ok(candidateAfter.triggerRuntime.persistenceConsumedEvidence["q-fail"]);
});

test("BAR_BOUND satisfaction expires on the next completed bar of the same timeframe, not on stale or wrong-timeframe evidence", () => {
  const h = harness({
    evaluatorVersion: 1,
    type: "BAR_CLOSE_COMPARISON",
    timeframe: "2m",
    operator: "GTE",
    value: 100,
  });
  activate(h);
  h.engine.processEvidence({
    candidateId: "persist-NVDA-1",
    contractVersion: 1,
    evidence: {
      type: "BAR_CLOSE",
      evidenceId: "b-satisfy",
      observedAt: "2026-09-05T14:02:01.000Z",
      barTimestamp: "2026-09-05T14:02:00.000Z",
      timeframe: "2m",
      symbol: "NVDA",
      close: 100.5,
      complete: true,
    },
  });

  let result = h.monitor.processEvidence({
    candidateId: "persist-NVDA-1",
    contractVersion: 1,
    evidence: {
      type: "BAR_CLOSE",
      evidenceId: "b-same",
      observedAt: "2026-09-05T14:02:02.000Z",
      barTimestamp: "2026-09-05T14:02:00.000Z",
      timeframe: "2m",
      symbol: "NVDA",
      close: 101,
      complete: true,
    },
  });
  assert.equal(result.status, "IGNORED_STALE");

  result = h.monitor.processEvidence({
    candidateId: "persist-NVDA-1",
    contractVersion: 1,
    evidence: {
      type: "BAR_CLOSE",
      evidenceId: "b-wrong-tf",
      observedAt: "2026-09-05T14:05:01.000Z",
      barTimestamp: "2026-09-05T14:05:00.000Z",
      timeframe: "5m",
      symbol: "NVDA",
      close: 101,
      complete: true,
    },
  });
  assert.equal(result.status, "IGNORED_WRONG_OBSERVATION");

  result = h.monitor.processEvidence({
    candidateId: "persist-NVDA-1",
    contractVersion: 1,
    evidence: {
      type: "BAR_CLOSE",
      evidenceId: "b-next",
      observedAt: "2026-09-05T14:04:01.000Z",
      barTimestamp: "2026-09-05T14:04:00.000Z",
      timeframe: "2m",
      symbol: "NVDA",
      close: 101,
      complete: true,
    },
  });
  assert.equal(result.status, "EXPIRED_TO_TRIGGER_EVALUATING");
  assert.equal(h.store.snapshot().candidates[0].lifecycleState, "PRETRADE_TRIGGER_EVALUATING");
});

test("ONE_SHOT manual satisfaction is not invalidated by later market evidence", () => {
  const h = harness({ evaluatorVersion: 1, type: "MANUAL_CONFIRMATION", prompt: "Confirm" });
  activate(h);
  h.engine.processEvidence({
    candidateId: "persist-NVDA-1",
    contractVersion: 1,
    evidence: { type: "MANUAL_EVENT", evidenceId: "m1", observedAt: "2026-09-05T14:00:00.000Z", nodeId: "satisfaction", confirmed: true },
  });
  const before = h.store.snapshot().candidates[0];
  const result = h.monitor.processEvidence({
    candidateId: "persist-NVDA-1",
    contractVersion: 1,
    evidence: { type: "QUOTE_EVENT", evidenceId: "q-later", observedAt: "2026-09-05T14:00:10.000Z", symbol: "NVDA", last: 1 },
  });
  assert.equal(result.status, "STILL_VALID");
  assert.equal(result.reason, "ONE_SHOT");
  const after = h.store.snapshot().candidates[0];
  assert.equal(after.lifecycleState, "PERMISSION_EVALUATING");
  assert.equal(after.stateRevision, before.stateRevision);
});

test("persistence expiration operation is idempotent after lifecycle has returned to trigger evaluation", () => {
  const h = harness({ evaluatorVersion: 1, type: "QUOTE_COMPARISON", side: "LAST", operator: "GTE", value: 100 });
  activate(h);
  h.engine.processEvidence({
    candidateId: "persist-NVDA-1",
    contractVersion: 1,
    evidence: { type: "QUOTE_EVENT", evidenceId: "q1", observedAt: "2026-09-05T14:00:00.000Z", symbol: "NVDA", last: 100.5 },
  });
  const first = h.monitor.processEvidence({
    candidateId: "persist-NVDA-1",
    contractVersion: 1,
    evidence: { type: "QUOTE_EVENT", evidenceId: "q-expire", observedAt: "2026-09-05T14:00:01.000Z", symbol: "NVDA", last: 99 },
  });
  const snapshot = h.store.snapshot().candidates[0];
  const retry = h.authority.expireSatisfaction({
    candidateId: "persist-NVDA-1",
    contractVersion: 1,
    expectedState: "PERMISSION_EVALUATING",
    expectedRevision: 3,
    evidenceId: "q-expire",
    evidenceTimestamp: "2026-09-05T14:00:01.000Z",
    evidenceHash: snapshot.triggerRuntime.persistenceConsumedEvidence["q-expire"].evidenceHash,
    reasonCode: "CONDITION_NO_LONGER_HELD",
  });
  assert.deepEqual(retry, first.transition);
  assert.equal(h.store.snapshot().candidates[0].stateRevision, snapshot.stateRevision);
});
