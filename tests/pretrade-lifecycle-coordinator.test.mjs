import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";

function tempStatePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-lifecycle-")), "state.json");
}

function candidate(overrides = {}) {
  return {
    candidateId: "slice1-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "SOD_A_PLUS",
    sourceDate: "2026-09-05",
    generatedAt: "2026-09-05T13:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "Breakout retest",
    timeframe: "2m",
    thesis: "Continuation if breakout structure holds",
    trigger: { type: "RECLAIM_AND_HOLD", level: 180 },
    structuralInvalidation: {
      price: 179.5,
      rule: "break below structural low",
      referenceType: "SWING_LOW",
      reason: "thesis invalid below structure",
    },
    plannedEntryReference: 180.1,
    targets: [181, 182],
    managementPlan: "Manage against structure",
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

function harness() {
  const filePath = tempStatePath();
  let time = "2026-09-05T13:05:00.000Z";
  let id = 0;
  const store = new PreTradeStore({ filePath, clock: () => time });
  store.load();
  store.importBundle({ source: "SOD_A_PLUS_TRADES", bundleId: "slice1", candidates: [candidate()] });
  const coordinator = new PreTradeLifecycleCoordinator({
    store,
    clock: () => time,
    idFactory: () => `event-${++id}`,
  });
  return {
    filePath,
    store,
    coordinator,
    setTime(next) { time = next; },
  };
}

function identity(overrides = {}) {
  return {
    candidateId: "slice1-NVDA-1",
    contractVersion: 1,
    ...overrides,
  };
}

test("candidate lifecycle mutation creates revision, event, operation, and survives reload", () => {
  const h = harness();
  assert.equal(h.coordinator.candidateSnapshot("slice1-NVDA-1", 1).stateRevision, 0);

  const command = identity({
    operationId: "op-activate-1",
    expectedState: "WAITING",
    expectedRevision: 0,
    activationMode: "MANUAL",
    source: "OPERATOR",
    reason: "START_MONITORING",
  });
  const result = h.coordinator.activateCandidate(command);

  assert.equal(result.lifecycleState, "PRETRADE_TRIGGER_EVALUATING");
  assert.equal(result.stateRevision, 1);
  assert.equal(h.coordinator.snapshot().lifecycleEvents.length, 1);
  assert.equal(h.coordinator.snapshot().lifecycleOperations.length, 1);

  const reloaded = new PreTradeStore({ filePath: h.filePath });
  reloaded.load();
  const recovered = new PreTradeLifecycleCoordinator({ store: reloaded });
  const recoveredCandidate = recovered.candidateSnapshot("slice1-NVDA-1", 1);
  assert.equal(recoveredCandidate.lifecycleState, "PRETRADE_TRIGGER_EVALUATING");
  assert.equal(recoveredCandidate.stateRevision, 1);
  assert.equal(recoveredCandidate.lifecycleJournal.events.length, 1);
  assert.equal(recoveredCandidate.lifecycleJournal.operations.length, 1);
  assert.equal(recovered.snapshot().lifecycleEvents[0].operationId, "op-activate-1");
});

test("duplicate operation is idempotent and operationId is bound to immutable command payload", () => {
  const h = harness();
  const command = identity({
    operationId: "op-idempotent",
    expectedState: "WAITING",
    expectedRevision: 0,
    activationMode: "AUTO",
    source: "AUTOMATION",
    reason: "RELEVANT",
    provenance: { evaluatorVersion: 1, evidenceId: "quote-1" },
  });

  const first = h.coordinator.activateCandidate(command);
  const second = h.coordinator.activateCandidate(command);
  assert.deepEqual(second, first);
  assert.equal(h.coordinator.snapshot().lifecycleEvents.length, 1);
  assert.equal(h.coordinator.candidateSnapshot("slice1-NVDA-1", 1).stateRevision, 1);

  assert.throws(
    () => h.coordinator.activateCandidate({
      ...command,
      provenance: { evaluatorVersion: 1, evidenceId: "quote-DIFFERENT" },
    }),
    (cause) => cause.code === "OPERATION_ID_CONFLICT",
  );
  assert.equal(h.coordinator.snapshot().lifecycleEvents.length, 1);
});

test("CAS guards reject stale revisions without emitting events", () => {
  const h = harness();
  h.coordinator.activateCandidate(identity({
    operationId: "op-activate",
    expectedState: "WAITING",
    expectedRevision: 0,
    activationMode: "AUTO",
  }));

  assert.throws(
    () => h.coordinator.returnToWaiting(identity({
      operationId: "op-stale",
      expectedState: "PRETRADE_TRIGGER_EVALUATING",
      expectedRevision: 0,
    })),
    (cause) => cause.code === "STALE_STATE_REVISION",
  );
  assert.equal(h.coordinator.snapshot().lifecycleEvents.length, 1);
  assert.equal(h.coordinator.candidateSnapshot("slice1-NVDA-1", 1).stateRevision, 1);
});

test("manual activation is pinned until explicit operator return", () => {
  const h = harness();
  h.coordinator.activateCandidate(identity({
    operationId: "op-manual-activate",
    expectedState: "WAITING",
    expectedRevision: 0,
    activationMode: "MANUAL",
    source: "OPERATOR",
  }));

  assert.throws(
    () => h.coordinator.returnToWaiting(identity({
      operationId: "op-auto-return",
      expectedState: "PRETRADE_TRIGGER_EVALUATING",
      expectedRevision: 1,
      operatorRequested: false,
    })),
    (cause) => cause.code === "MANUAL_ACTIVATION_PINNED",
  );

  const returned = h.coordinator.returnToWaiting(identity({
    operationId: "op-operator-return",
    expectedState: "PRETRADE_TRIGGER_EVALUATING",
    expectedRevision: 1,
    operatorRequested: true,
    source: "OPERATOR",
    reason: "STOP_MONITORING",
  }));
  assert.equal(returned.lifecycleState, "WAITING");
  assert.equal(returned.stateRevision, 2);
});

test("trigger satisfaction gates permission and permission outcome is explicitly published", () => {
  const h = harness();
  h.coordinator.activateCandidate(identity({
    operationId: "op-activate-permission",
    expectedState: "WAITING",
    expectedRevision: 0,
    activationMode: "AUTO",
  }));

  assert.throws(
    () => h.coordinator.beginPermission(identity({
      operationId: "op-no-trigger",
      expectedState: "PRETRADE_TRIGGER_EVALUATING",
      expectedRevision: 1,
    })),
    (cause) => cause.code === "TRIGGER_SATISFACTION_REQUIRED",
  );

  const evaluating = h.coordinator.beginPermission(identity({
    operationId: "op-trigger-satisfied",
    expectedState: "PRETRADE_TRIGGER_EVALUATING",
    expectedRevision: 1,
    source: "AUTOMATION",
    triggerSatisfaction: {
      evaluatorType: "LEVEL_RECLAIM",
      evaluatorVersion: 1,
      branchId: "trigger-1",
      evidenceId: "bar-1306",
      evidenceTimestamp: "2026-09-05T13:06:00.000Z",
    },
  }));
  assert.equal(evaluating.lifecycleState, "PERMISSION_EVALUATING");
  assert.equal(evaluating.stateRevision, 2);

  const ready = h.coordinator.publishPermissionOutcome(identity({
    operationId: "op-ready",
    expectedState: "PERMISSION_EVALUATING",
    expectedRevision: 2,
    outcome: "READY",
    permissionEvaluationId: "permission-1",
  }));
  assert.equal(ready.lifecycleState, "READY");
  assert.equal(ready.stateRevision, 3);

  const refreshed = h.coordinator.revalidatePermission(identity({
    operationId: "op-revalidate",
    expectedState: "READY",
    expectedRevision: 3,
    reason: "MATERIAL_EVIDENCE_STALE",
  }));
  assert.equal(refreshed.lifecycleState, "PERMISSION_EVALUATING");
  assert.equal(refreshed.stateRevision, 4);
});

test("prerequisites and retryable permission blockers remain structured non-lifecycle conditions", () => {
  const h = harness();
  const prereq = h.coordinator.setPrerequisites(identity({
    operationId: "op-prereq",
    expectedState: "WAITING",
    expectedRevision: 0,
    prerequisites: [
      { prerequisiteId: "ORH", status: "PENDING", reason: "OPENING_RANGE_FORMING" },
      { prerequisiteId: "SESSION", status: "RESOLVED", evidenceReference: "rth-open" },
    ],
  }));
  assert.equal(prereq.lifecycleState, "WAITING");
  assert.equal(prereq.stateRevision, 1);
  const candidateAfterPrereq = h.coordinator.candidateSnapshot("slice1-NVDA-1", 1);
  assert.equal(candidateAfterPrereq.prerequisiteStatus.allResolved, false);
  assert.equal(candidateAfterPrereq.prerequisiteStatus.items.length, 2);

  h.coordinator.activateCandidate(identity({
    operationId: "op-auto-active",
    expectedState: "WAITING",
    expectedRevision: 1,
    activationMode: "AUTO",
  }));
  h.coordinator.beginPermission(identity({
    operationId: "op-permission",
    expectedState: "PRETRADE_TRIGGER_EVALUATING",
    expectedRevision: 2,
    triggerSatisfaction: { evaluatorType: "TEST", evaluatorVersion: 1, evidenceId: "evidence-1" },
  }));

  const blocked = h.coordinator.setPermissionBlocker(identity({
    operationId: "op-block",
    expectedState: "PERMISSION_EVALUATING",
    expectedRevision: 3,
    blockerStatus: "BLOCKED_RETRYABLE",
    reasonCode: "ACCOUNT_SNAPSHOT_UNAVAILABLE",
  }));
  assert.equal(blocked.lifecycleState, "PERMISSION_EVALUATING");
  assert.equal(h.coordinator.candidateSnapshot("slice1-NVDA-1", 1).permissionEvaluationStatus, "BLOCKED_RETRYABLE");

  const resumed = h.coordinator.clearPermissionBlocker(identity({
    operationId: "op-resume",
    expectedState: "PERMISSION_EVALUATING",
    expectedRevision: 4,
  }));
  assert.equal(resumed.lifecycleState, "PERMISSION_EVALUATING");
  assert.equal(h.coordinator.candidateSnapshot("slice1-NVDA-1", 1).permissionEvaluationStatus, "RUNNING");
});

test("recovery gate fails closed for normal mutation until explicitly cleared", () => {
  const h = harness();
  const gated = h.coordinator.setRecoveryGate(identity({
    operationId: "op-gate",
    expectedState: "WAITING",
    expectedRevision: 0,
    reasonCode: "ARM_AUTHORITY_RECONCILIATION",
  }));
  assert.equal(gated.stateRevision, 1);

  assert.throws(
    () => h.coordinator.activateCandidate(identity({
      operationId: "op-blocked-activate",
      expectedState: "WAITING",
      expectedRevision: 1,
      activationMode: "MANUAL",
    })),
    (cause) => cause.code === "RECOVERY_RECONCILIATION_REQUIRED",
  );

  const cleared = h.coordinator.clearRecoveryGate(identity({
    operationId: "op-clear-gate",
    expectedState: "WAITING",
    expectedRevision: 1,
    reasonCode: "RECOVERY_RECONCILED",
  }));
  assert.equal(cleared.stateRevision, 2);

  const active = h.coordinator.activateCandidate(identity({
    operationId: "op-after-recovery",
    expectedState: "WAITING",
    expectedRevision: 2,
    activationMode: "MANUAL",
  }));
  assert.equal(active.lifecycleState, "PRETRADE_TRIGGER_EVALUATING");
});

test("terminal outcomes cannot be used to resurrect the same candidate version", () => {
  const h = harness();
  const declined = h.coordinator.declineCandidate(identity({
    operationId: "op-decline",
    expectedState: "WAITING",
    expectedRevision: 0,
    reasonCode: "OPERATOR_NO_LONGER_INTERESTED",
    note: "Setup quality deteriorated",
    source: "OPERATOR",
  }));
  assert.equal(declined.lifecycleState, "DECLINED");
  assert.equal(declined.stateRevision, 1);

  const terminal = h.coordinator.candidateSnapshot("slice1-NVDA-1", 1);
  assert.equal(terminal.terminalOutcome.reasonCode, "OPERATOR_NO_LONGER_INTERESTED");
  assert.equal(terminal.terminalOutcome.note, "Setup quality deteriorated");

  assert.throws(
    () => h.coordinator.activateCandidate(identity({
      operationId: "op-resurrect",
      expectedState: "DECLINED",
      expectedRevision: 1,
      activationMode: "MANUAL",
    })),
    (cause) => cause.code === "ILLEGAL_LIFECYCLE_ACTION",
  );
  assert.equal(h.coordinator.snapshot().lifecycleEvents.length, 1);
});

test("failed persistence rolls back candidate mutation, event, and operation", () => {
  const h = harness();
  const originalSave = h.store.save.bind(h.store);
  h.store.save = () => {
    throw Object.assign(new Error("simulated disk failure"), { code: "SIMULATED_SAVE_FAILURE" });
  };

  assert.throws(
    () => h.coordinator.activateCandidate(identity({
      operationId: "op-save-fail",
      expectedState: "WAITING",
      expectedRevision: 0,
      activationMode: "AUTO",
    })),
    (cause) => cause.code === "SIMULATED_SAVE_FAILURE",
  );

  h.store.save = originalSave;
  const candidateAfterFailure = h.coordinator.candidateSnapshot("slice1-NVDA-1", 1);
  assert.equal(candidateAfterFailure.lifecycleState, "WAITING");
  assert.equal(candidateAfterFailure.stateRevision, 0);
  assert.equal(candidateAfterFailure.lifecycleJournal.events.length, 0);
  assert.equal(candidateAfterFailure.lifecycleJournal.operations.length, 0);
});
