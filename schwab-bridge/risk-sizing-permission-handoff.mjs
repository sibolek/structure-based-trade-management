function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function handoffError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function mapRiskSizingToPermission(result) {
  const status = upper(result?.status);
  if (!["VALID", "NO_AFFORDABLE_SIZE", "BLOCKED", "ERROR"].includes(status)) {
    throw handoffError(
      `unsupported Phase 4 status: ${status || "<empty>"}`,
      "INVALID_RISK_SIZING_PERMISSION_STATUS",
    );
  }

  const base = {
    phase4Status: status,
    riskEvaluationId: text(result?.riskEvaluationId) || null,
    dssEvaluationId: text(result?.dssEvaluationId) || null,
    maxAffordableQuantity: result?.maxAffordableQuantity ?? null,
    plannedDollarRisk: result?.plannedDollarRisk ?? null,
    plannedRiskFraction: result?.plannedRiskFraction ?? null,
    reasonCodes: Array.isArray(result?.reasonCodes) ? [...result.reasonCodes] : [],
  };

  if (status === "VALID") {
    return immutable({
      ...base,
      consequence: "CONTINUE",
      permissionStatus: null,
      permissionReason: null,
      failClosed: false,
    });
  }

  if (status === "NO_AFFORDABLE_SIZE") {
    return immutable({
      ...base,
      consequence: "PASS",
      permissionStatus: "PASS",
      permissionReason: "STOP_RISK_CONFLICT",
      failClosed: false,
    });
  }

  if (status === "BLOCKED") {
    return immutable({
      ...base,
      consequence: "BLOCKED",
      permissionStatus: null,
      permissionReason: null,
      failClosed: true,
    });
  }

  return immutable({
    ...base,
    consequence: "ERROR",
    permissionStatus: null,
    permissionReason: null,
    failClosed: true,
  });
}
