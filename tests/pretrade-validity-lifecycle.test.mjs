import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";

function candidate(overrides = {}) {
  return {
    candidateId: "validity-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "SOD_A_PLUS_TRADES",
    sourceDate: "2026-09-05",
    generatedAt: "2026-09-05T13:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "Breakout retest",
    thesis: "Continuation while validity window remains open",
    trigger: { type: "MANUAL_CONFIRMATION" },
    structuralInvalidation: {
      price: 179.5,
      rule: "break below retest low",
      referenceType: "SWING_LOW",
      reason: "thesis invalid below structure",
    },
    managementContract: { mode: "FLEXIBLE_WITHIN_CEILING" },
    targets: [181, 182],
    validity: {
      validFrom: "2026-09-05T14:00:00.000Z",
      validUntil: "2026-09-05T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
    },
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

function harness({ start = "2026-09-05T13:59:00.000Z", candidateOverrides = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "executionos-validity-"));
  const filePath = path.join(dir, "state.json");
  let now = start;
  let id = 0;
  const clock = () => now;
  const store = new PreTradeStore({ filePath });
  store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock, idFactory: () => `ingress-${++id}` });
  const imported = ingress.importBundle({
    source: "SOD_A_PLUS_TRADES",
    bundleId: "validity-bundle",
    candidates: [candidate(candidateOverrides)],
  });
  assert.equal(imported.outcomes[0].status, "ACCEPTED");
  const coordinator = new PreTradeLifecycleCoordinator({ store, clock, idFactory: () => `lifecycle-${++id}` });
  return {
    store,
    coordinator,
    setTime(value) { now = value; },
  };
}

function activation(overrides = {}) {
  return {
    operationId: "validity-activate",
    candidateId: "validity-NVDA-1",
    contractVersion: 1,
    expectedState: "WAITING",
    expectedRevision: 0,
    activationMode: "MANUAL",
    source: "OPERATOR",
    ...overrides,
  };
}

test("canonical candidate cannot progress before validFrom and can progress exactly at validFrom", () => {
  const h = harness();
  assert.throws(
    () => h.coordinator.activateCandidate(activation()),
    (error) => error.code === "CANDIDATE_NOT_YET_VALID",
  );
  assert.equal(h.coordinator.candidateSnapshot("validity-NVDA-1", 1).stateRevision, 0);

  h.setTime("2026-09-05T14:00:00.000Z");
  const active = h.coordinator.activateCandidate(activation());
  assert.equal(active.lifecycleState, "PRETRADE_TRIGGER_EVALUATING");
  assert.equal(active.stateRevision, 1);
});

test("canonical candidate cannot progress at validUntil even before explicit reconciliation", () => {
  const h = harness({ start: "2026-09-05T20:00:00.000Z" });
  assert.throws(
    () => h.coordinator.activateCandidate(activation()),
    (error) => error.code === "CANDIDATE_VALIDITY_EXPIRED",
  );
  const candidateAfter = h.coordinator.candidateSnapshot("validity-NVDA-1", 1);
  assert.equal(candidateAfter.lifecycleState, "WAITING");
  assert.equal(candidateAfter.stateRevision, 0);
});

test("validity reconciliation expires active unarmed candidate durably and idempotently at validUntil", () => {
  const h = harness({ start: "2026-09-05T19:59:59.999Z" });
  let status = h.coordinator.reconcileCandidateValidity({ candidateId: "validity-NVDA-1", contractVersion: 1 });
  assert.equal(status.status, "VALID");
  assert.equal(h.coordinator.candidateSnapshot("validity-NVDA-1", 1).lifecycleState, "WAITING");

  h.setTime("2026-09-05T20:00:00.000Z");
  status = h.coordinator.reconcileCandidateValidity({ candidateId: "validity-NVDA-1", contractVersion: 1 });
  assert.equal(status.status, "EXPIRED");
  assert.equal(status.lifecycleState, "EXPIRED");
  assert.equal(status.stateRevision, 1);
  let expired = h.coordinator.candidateSnapshot("validity-NVDA-1", 1);
  assert.equal(expired.lifecycleJournal.events.length, 2);
  assert.equal(expired.lifecycleJournal.events[1].eventType, "CANDIDATE_EXPIRED");
  assert.equal(expired.terminalOutcome.reasonCode, "VALIDITY_ENDED");

  status = h.coordinator.reconcileCandidateValidity({ candidateId: "validity-NVDA-1", contractVersion: 1 });
  assert.equal(status.status, "TERMINAL_UNARMED");
  expired = h.coordinator.candidateSnapshot("validity-NVDA-1", 1);
  assert.equal(expired.lifecycleJournal.events.length, 2);
});

test("reconcileAllValidity leaves future candidates WAITING and expires only due canonical candidates", () => {
  const h = harness({ start: "2026-09-05T13:59:00.000Z" });
  let results = h.coordinator.reconcileAllValidity();
  assert.equal(results[0].status, "NOT_YET_VALID");
  assert.equal(h.coordinator.candidateSnapshot("validity-NVDA-1", 1).lifecycleState, "WAITING");

  h.setTime("2026-09-05T20:00:00.000Z");
  results = h.coordinator.reconcileAllValidity();
  assert.equal(results[0].status, "EXPIRED");
  assert.equal(h.coordinator.candidateSnapshot("validity-NVDA-1", 1).lifecycleState, "EXPIRED");
});

test("ARMED candidate is never retroactively revoked when validity later ends", () => {
  const h = harness({ start: "2026-09-05T19:00:00.000Z" });
  const stored = h.store.state.candidates[0];
  stored.lifecycleState = "ARMED";
  stored.stateRevision = 1;
  stored.armAuthorized = true;
  h.store.save();

  h.setTime("2026-09-05T20:00:00.000Z");
  const status = h.coordinator.reconcileCandidateValidity({ candidateId: "validity-NVDA-1", contractVersion: 1 });
  assert.equal(status.status, "ARMED_NOT_REVOKED");
  const armed = h.coordinator.candidateSnapshot("validity-NVDA-1", 1);
  assert.equal(armed.lifecycleState, "ARMED");
  assert.equal(armed.stateRevision, 1);
});

test("material canonical contract tampering blocks lifecycle authority before mutation", () => {
  const h = harness({ start: "2026-09-05T14:01:00.000Z" });
  h.store.state.candidates[0].validity.validUntil = "2026-09-05T21:00:00.000Z";
  h.store.save();

  assert.throws(
    () => h.coordinator.activateCandidate(activation()),
    (error) => error.code === "CANDIDATE_CONTRACT_INTEGRITY_ERROR",
  );
  assert.equal(h.store.snapshot().candidates[0].stateRevision, 0);
});
