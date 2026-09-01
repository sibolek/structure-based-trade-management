import assert from "node:assert/strict";
import test from "node:test";
import { mapRiskSizingToPermission } from "../schwab-bridge/risk-sizing-permission-handoff.mjs";

function result(status, overrides = {}) {
  return {
    riskEvaluationId: "risk-eval-001",
    dssEvaluationId: "dss-eval-001",
    status,
    maxAffordableQuantity: status === "VALID" ? 90 : status === "NO_AFFORDABLE_SIZE" ? 0 : null,
    plannedDollarRisk: status === "VALID" ? 67.5 : 0,
    plannedRiskFraction: status === "VALID" ? 0.005 : 0,
    reasonCodes: [],
    ...overrides,
  };
}

test("VALID Phase 4 result continues permission without granting READY or CAUTION", () => {
  const mapped = mapRiskSizingToPermission(result("VALID"));
  assert.equal(mapped.consequence, "CONTINUE");
  assert.equal(mapped.permissionStatus, null);
  assert.equal(mapped.permissionReason, null);
  assert.equal(mapped.phase4Status, "VALID");
  assert.equal(mapped.failClosed, false);
});

test("NO_AFFORDABLE_SIZE maps deterministically to PASS STOP_RISK_CONFLICT", () => {
  const mapped = mapRiskSizingToPermission(result("NO_AFFORDABLE_SIZE", {
    reasonCodes: ["MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET"],
  }));
  assert.equal(mapped.consequence, "PASS");
  assert.equal(mapped.permissionStatus, "PASS");
  assert.equal(mapped.permissionReason, "STOP_RISK_CONFLICT");
  assert.equal(mapped.maxAffordableQuantity, 0);
  assert.deepEqual(mapped.reasonCodes, ["MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET"]);
});

test("BLOCKED prevents permission from advancing without being mislabeled PASS", () => {
  const mapped = mapRiskSizingToPermission(result("BLOCKED", {
    reasonCodes: ["QUOTE_STALE"],
  }));
  assert.equal(mapped.consequence, "BLOCKED");
  assert.equal(mapped.permissionStatus, null);
  assert.equal(mapped.permissionReason, null);
  assert.equal(mapped.failClosed, true);
});

test("ERROR fails closed without being mislabeled as a trading rejection", () => {
  const mapped = mapRiskSizingToPermission(result("ERROR", {
    reasonCodes: ["INTERNAL_ERROR"],
  }));
  assert.equal(mapped.consequence, "ERROR");
  assert.equal(mapped.permissionStatus, null);
  assert.equal(mapped.permissionReason, null);
  assert.equal(mapped.failClosed, true);
});

test("Phase 4 mapping never produces CAUTION", () => {
  for (const status of ["VALID", "NO_AFFORDABLE_SIZE", "BLOCKED", "ERROR"]) {
    const mapped = mapRiskSizingToPermission(result(status, {
      reasonCodes: status === "VALID" ? [] : [status === "NO_AFFORDABLE_SIZE" ? "MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET" : "TEST_REASON"],
    }));
    assert.notEqual(mapped.permissionStatus, "CAUTION");
    assert.notEqual(mapped.consequence, "CAUTION");
  }
});

test("unsupported Phase 4 status fails closed", () => {
  assert.throws(
    () => mapRiskSizingToPermission(result("READY")),
    (error) => error.code === "INVALID_RISK_SIZING_PERMISSION_STATUS",
  );
});

test("permission handoff result is deeply immutable", () => {
  const mapped = mapRiskSizingToPermission(result("VALID"));
  assert.equal(Object.isFrozen(mapped), true);
  assert.equal(Object.isFrozen(mapped.reasonCodes), true);
  assert.throws(() => { mapped.consequence = "PASS"; }, TypeError);
});
