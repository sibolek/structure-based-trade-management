import test from "node:test";
import assert from "node:assert/strict";

import { reconcileV24RetiredAuthorizationExceptionSerialized } from "../src/execution/execution-v24-retired-authorization-exceptions.js";

function memoryStorage() {
  let value = JSON.stringify({
    storeSchemaVersion: 1,
    storeRevision: 1,
    liveTrades: [],
    candidates: [],
    history: [],
    v24Installations: [],
    v24Retirements: [],
    v24Lifecycles: [],
    v24AuthorizationExceptions: [{
      schemaVersion: 1,
      exceptionId: "exception-1",
      handoffId: "expired-handoff",
      code: "FILL_ATTRIBUTION_UNRESOLVED",
      severity: "CRITICAL",
      status: "OPEN",
      plausibleLaterHandoffIds: ["later-A", "later-B"],
      reconciledAt: null,
      reconciliationOutcome: null,
      reconciliationAssignedHandoffId: null,
      reconciliationNote: null,
    }],
  });
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = String(next); },
  };
}

function locks() {
  return { request: async (_name, _options, callback) => callback({ mode: "exclusive" }) };
}

test("reassignment requires an exact plausible later handoff and freezes that attribution", async () => {
  const missingStorage = memoryStorage();
  await assert.rejects(
    reconcileV24RetiredAuthorizationExceptionSerialized({
      storage: missingStorage,
      lockManager: locks(),
      exceptionId: "exception-1",
      outcome: "ASSIGNED_TO_OTHER_AUTHORIZATION",
      at: "2026-09-06T14:12:00.000Z",
    }),
    (error) => error.code === "AUTHORIZATION_EXCEPTION_RECONCILIATION_INVALID",
  );

  const wrongStorage = memoryStorage();
  await assert.rejects(
    reconcileV24RetiredAuthorizationExceptionSerialized({
      storage: wrongStorage,
      lockManager: locks(),
      exceptionId: "exception-1",
      outcome: "ASSIGNED_TO_OTHER_AUTHORIZATION",
      assignedHandoffId: "not-plausible",
      at: "2026-09-06T14:12:00.000Z",
    }),
    (error) => error.code === "AUTHORIZATION_EXCEPTION_RECONCILIATION_INVALID",
  );

  const storage = memoryStorage();
  const result = await reconcileV24RetiredAuthorizationExceptionSerialized({
    storage,
    lockManager: locks(),
    exceptionId: "exception-1",
    outcome: "ASSIGNED_TO_OTHER_AUTHORIZATION",
    assignedHandoffId: "later-B",
    note: "Exact later authorization selected after broker-truth review.",
    at: "2026-09-06T14:12:00.000Z",
  });
  assert.equal(result.exception.status, "RECONCILED");
  assert.equal(result.exception.reconciliationAssignedHandoffId, "later-B");
  assert.equal(result.brokerWriteAuthority, false);
});
