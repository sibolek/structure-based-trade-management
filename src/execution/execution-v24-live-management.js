import {
  EXECUTION_BOARD_STORE_KEY,
  readExecutionBoardStore,
  transactExecutionBoardStoreSerialized,
} from "./execution-board-store-repository.js";

export const V24_LIVE_MANAGEMENT_SCHEMA_VERSION = 1;
export const V24_LIVE_MANAGEMENT_MODES = Object.freeze([
  "FLEXIBLE_WITHIN_CEILING",
  "SINGLE_ENTRY",
  "LEGACY_COMPATIBILITY",
]);

const CRITICAL_EXCEPTION_CODES = new Set([
  "AUTHORIZED_QUANTITY_EXCEEDED",
  "LIVE_MANAGEMENT_CEILING_EXCEEDED",
  "LIFECYCLE_LOSS_BUDGET_EXCEEDED",
  "WRONG_ACCOUNT_EXECUTION_OBSERVED",
  "WRONG_DIRECTION_EXECUTION_OBSERVED",
  "LATE_OPENING_FILL",
  "MANAGEMENT_CONTRACT_VIOLATION",
  "LIVE_STOP_AUTHORITY_UNAVAILABLE",
  "LIVE_STOP_NOT_RISK_PROTECTIVE",
  "FILL_ATTRIBUTION_UNRESOLVED",
  "PROHIBITED_TERMINAL_REENTRY",
]);

function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function finite(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function positive(value) { const number = finite(value); return number !== null && number > 0 ? number : null; }
function iso(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return new Date(numeric).toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function clone(value) { return structuredClone(value); }
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function immutable(value) { return deepFreeze(clone(value)); }
function managementError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stable(value[key]);
      return result;
    }, {});
  }
  return value;
}
function operationFingerprint(action, payload) { return JSON.stringify(stable({ action, payload })); }
function sameIdentity(item, handoffId) { return text(item?.handoffId ?? item?.v24?.handoffId) === text(handoffId); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }

function contractFromInstallation(installation) {
  const v24 = installation?.compatibility?.v24 || {};
  const raw = v24.managementPlan && typeof v24.managementPlan === "object" && !Array.isArray(v24.managementPlan)
    ? v24.managementPlan
    : null;
  const strict = Boolean(v24.entryAuthorizationUntil || v24.candidateValidUntil || v24.instrumentEconomics);
  if (!raw) {
    return {
      mode: strict ? "SINGLE_ENTRY" : "LEGACY_COMPATIBILITY",
      allowReAdd: strict ? false : true,
      allowFlatReEntry: false,
      buildUntil: strict ? iso(v24.entryAuthorizationUntil ?? v24.candidateValidUntil) : null,
      source: strict ? "FROZEN_DEFAULT_FAIL_CLOSED" : "LEGACY_COMPATIBILITY",
    };
  }

  const requestedMode = upper(raw.mode || raw.entryBuildMode || "FLEXIBLE_WITHIN_CEILING");
  const mode = V24_LIVE_MANAGEMENT_MODES.includes(requestedMode) && requestedMode !== "LEGACY_COMPATIBILITY"
    ? requestedMode
    : "FLEXIBLE_WITHIN_CEILING";
  const buildUntil = iso(
    raw.positionBuildUntil
    ?? raw.buildUntil
    ?? raw.buildWindow?.validUntil
    ?? raw.buildWindow?.until
    ?? v24.entryAuthorizationUntil
    ?? v24.candidateValidUntil,
  );
  return {
    mode,
    allowReAdd: raw.allowReAdd === true || raw.reAddAllowed === true || upper(raw.reAddPolicy) === "ALLOWED",
    allowFlatReEntry: raw.allowFlatReEntry === true || upper(raw.flatReEntryPolicy) === "ALLOWED",
    buildUntil,
    source: "FROZEN_MANAGEMENT_CONTRACT",
  };
}

export function normalizeV24InstrumentEconomics(raw = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const assetType = upper(source.assetType);
  if (!assetType) return immutable({ assetType: "LEGACY_EQUITY_COMPATIBILITY", pricePointValue: 1, source: "LEGACY_COMPATIBILITY" });
  if (assetType === "EQUITY") return immutable({
    assetType,
    pricePointValue: 1,
    minimumQuantity: positive(source.minimumQuantity) ?? 1,
    quantityIncrement: positive(source.quantityIncrement) ?? 1,
    tickSize: positive(source.tickSize),
    tickValue: positive(source.tickValue),
    pointValue: positive(source.pointValue) ?? 1,
    metadataVersion: text(source.metadataVersion) || null,
    source: "ARM_PHASE4_INSTRUMENT",
  });
  if (assetType === "FUTURE") {
    const tickSize = positive(source.tickSize);
    const tickValue = positive(source.tickValue);
    const explicitPoint = positive(source.pointValue);
    const derivedPoint = tickSize && tickValue ? tickValue / tickSize : null;
    const pricePointValue = explicitPoint ?? derivedPoint;
    if (!pricePointValue) throw managementError("futures live management requires tick/point economics frozen at ARM", "LIVE_INSTRUMENT_ECONOMICS_UNAVAILABLE");
    if (explicitPoint && derivedPoint && Math.abs(explicitPoint - derivedPoint) > 1e-9) {
      throw managementError("futures live economics are internally inconsistent", "LIVE_INSTRUMENT_ECONOMICS_CONFLICT");
    }
    return immutable({
      assetType,
      pricePointValue,
      minimumQuantity: positive(source.minimumQuantity) ?? 1,
      quantityIncrement: positive(source.quantityIncrement) ?? 1,
      tickSize,
      tickValue,
      pointValue: pricePointValue,
      metadataVersion: text(source.metadataVersion) || null,
      source: "ARM_PHASE4_INSTRUMENT",
    });
  }
  throw managementError(`unsupported live-management asset type ${assetType}`, "LIVE_INSTRUMENT_ECONOMICS_UNSUPPORTED");
}

function armView(installation) {
  const v24 = installation?.compatibility?.v24 || {};
  const direction = upper(v24.direction);
  const selectedQuantity = positive(v24.selectedQuantity);
  const effectiveStop = positive(v24.effectiveStop);
  const authorizedMaxDollarRisk = positive(v24.authorizedMaxDollarRisk);
  if (!["LONG", "SHORT"].includes(direction) || !selectedQuantity || !effectiveStop) {
    throw managementError("V2.4 ARM quantity/direction/stop provenance is required", "INVALID_V24_EXECUTION_PROVENANCE");
  }
  return {
    handoffId: text(v24.handoffId),
    direction,
    selectedQuantity,
    armEffectiveStop: effectiveStop,
    authorizedMaxDollarRisk,
    managementContract: contractFromInstallation(installation),
    instrument: normalizeV24InstrumentEconomics(v24.instrumentEconomics),
    targets: Array.isArray(v24.targets) ? clone(v24.targets) : [],
    entryAuthorizationUntil: iso(v24.entryAuthorizationUntil),
    candidateValidUntil: iso(v24.candidateValidUntil),
  };
}

function stopProtective(direction, candidateStop, armStop) {
  if (!positive(candidateStop) || !positive(armStop)) return false;
  return direction === "LONG" ? candidateStop >= armStop : candidateStop <= armStop;
}

function dollarPnlFromPricePoints(points, instrument) {
  const value = finite(points);
  return value === null ? null : value * Number(instrument.pricePointValue || 1);
}

export function calculateV24OpenStopRisk({ direction, averagePrice, quantity, stopPrice, instrumentEconomics } = {}) {
  const avg = positive(averagePrice);
  const qty = positive(quantity);
  const stop = positive(stopPrice);
  const dir = upper(direction);
  if (!avg || !qty || !stop || !["LONG", "SHORT"].includes(dir)) return null;
  const instrument = normalizeV24InstrumentEconomics(instrumentEconomics);
  const distance = dir === "LONG" ? avg - stop : stop - avg;
  if (distance < 0) return 0;
  return distance * qty * instrument.pricePointValue;
}

function targetState(target, index) {
  const definition = clone(target);
  const targetId = text(target?.targetId ?? target?.id ?? target?.label ?? target?.name) || `target-${index + 1}`;
  return {
    targetId,
    definition,
    status: "PENDING",
    attainedAt: null,
    attainmentEvidence: null,
  };
}

function riskState({ authorizedMaxDollarRisk, cumulativeRealizedLosses, realizedPnl, openStopRisk }) {
  const budget = positive(authorizedMaxDollarRisk);
  const losses = Math.max(0, Number(cumulativeRealizedLosses || 0));
  const open = Math.max(0, Number(openStopRisk || 0));
  return {
    authorizedMaxDollarRisk: budget,
    realizedPnl: Number(realizedPnl || 0),
    cumulativeRealizedLosses: losses,
    openStopRisk: open,
    aggregateWorstCaseLoss: losses + open,
    remainingLossBudget: budget === null ? null : Math.max(0, budget - losses),
  };
}

function criticalOpen(management) {
  return (management.authorizationExceptions || []).some((item) => item.severity === "CRITICAL" && item.status !== "RECONCILED");
}

function appendException(management, code, at, evidence = null, severity = null) {
  const normalized = upper(code);
  const existing = (management.authorizationExceptions || []).find((item) => item.code === normalized && item.status !== "RECONCILED");
  if (existing) return management;
  management.authorizationExceptions.push({
    exceptionId: `exception:${management.handoffId}:${management.authorizationExceptions.length + 1}:${normalized}`,
    code: normalized,
    severity: severity || (CRITICAL_EXCEPTION_CODES.has(normalized) ? "CRITICAL" : "NONCRITICAL"),
    status: "OPEN",
    occurredAt: iso(at) || new Date().toISOString(),
    evidence: evidence ? clone(evidence) : null,
    reconciledAt: null,
    reconciliationOutcome: null,
    reconciliationNote: null,
  });
  return management;
}

function refreshDerived(management, { currentQuantity, currentAveragePrice } = {}) {
  const quantity = Math.max(0, Number(currentQuantity || 0));
  const average = positive(currentAveragePrice);
  const stop = positive(management.currentEffectiveStop?.price);
  const openStopRisk = quantity > 0 && average && stop
    ? calculateV24OpenStopRisk({
        direction: management.direction,
        averagePrice: average,
        quantity,
        stopPrice: stop,
        instrumentEconomics: management.instrumentEconomics,
      })
    : 0;
  management.risk = riskState({
    authorizedMaxDollarRisk: management.risk?.authorizedMaxDollarRisk,
    cumulativeRealizedLosses: management.risk?.cumulativeRealizedLosses,
    realizedPnl: management.risk?.realizedPnl,
    openStopRisk,
  });
  management.exposureIncreaseBlocked = Boolean(
    management.futureExposureIncreaseDisabled
    || criticalOpen(management)
    || management.risk.authorizedMaxDollarRisk === null
    || management.currentEffectiveStop?.price === null,
  );
  return management;
}

export function createV24LiveManagement({ installation, firstExecutionTime, currentQuantity, currentAveragePrice } = {}) {
  const arm = armView(installation);
  const at = iso(firstExecutionTime) || new Date().toISOString();
  const contract = arm.managementContract;
  const buildImmediatelyComplete = contract.mode === "SINGLE_ENTRY" && !contract.buildUntil;
  const peak = positive(currentQuantity) ?? 0;
  const liveCeiling = buildImmediatelyComplete ? peak : arm.selectedQuantity;
  const management = {
    schemaVersion: V24_LIVE_MANAGEMENT_SCHEMA_VERSION,
    handoffId: arm.handoffId,
    revision: 0,
    direction: arm.direction,
    armQuantityCeiling: arm.selectedQuantity,
    liveManagementCeiling: liveCeiling,
    establishedPeakQuantity: peak,
    managementContract: contract,
    build: {
      status: buildImmediatelyComplete ? "COMPLETE" : "OPEN",
      authorizedUntil: contract.buildUntil,
      completedAt: buildImmediatelyComplete ? at : null,
      completionReason: buildImmediatelyComplete ? "SINGLE_ENTRY_NO_BUILD_WINDOW" : null,
    },
    currentEffectiveStop: {
      price: arm.armEffectiveStop,
      source: "ARM_EFFECTIVE_STOP",
      updatedAt: at,
      reason: "ARM_BASELINE",
    },
    stopHistory: [],
    instrumentEconomics: arm.instrument,
    reAddAllowed: contract.allowReAdd,
    flatReEntryAllowed: contract.allowFlatReEntry,
    futureExposureIncreaseDisabled: false,
    targets: arm.targets.map(targetState),
    discretionaryActions: [],
    authorizationExceptions: [],
    operations: [],
    risk: riskState({
      authorizedMaxDollarRisk: arm.authorizedMaxDollarRisk,
      cumulativeRealizedLosses: 0,
      realizedPnl: 0,
      openStopRisk: 0,
    }),
    exposureIncreaseBlocked: false,
  };
  return immutable(refreshDerived(management, { currentQuantity, currentAveragePrice }));
}

export function reconcileV24BuildWindow(management, { at, currentQuantity, currentAveragePrice } = {}) {
  const next = clone(management);
  const now = iso(at);
  if (!now || next.build?.status !== "OPEN" || !iso(next.build?.authorizedUntil)) {
    return immutable(refreshDerived(next, { currentQuantity, currentAveragePrice }));
  }
  if (Date.parse(now) < Date.parse(next.build.authorizedUntil)) {
    return immutable(refreshDerived(next, { currentQuantity, currentAveragePrice }));
  }
  next.build.status = "COMPLETE";
  next.build.completedAt = next.build.authorizedUntil;
  next.build.completionReason = "BUILD_WINDOW_EXPIRED";
  next.liveManagementCeiling = Math.min(Number(next.armQuantityCeiling), Number(next.establishedPeakQuantity || currentQuantity || 0));
  return immutable(refreshDerived(next, { currentQuantity, currentAveragePrice }));
}

export function evaluateV24ExposureIncrease({
  management,
  currentQuantity,
  currentAveragePrice,
  proposedAddQuantity,
  proposedFillPrice,
  at,
  kind = "ADD",
} = {}) {
  const reconciled = reconcileV24BuildWindow(management, { at, currentQuantity, currentAveragePrice });
  const addQty = positive(proposedAddQuantity);
  const fillPrice = positive(proposedFillPrice);
  const currentQty = Math.max(0, Number(currentQuantity || 0));
  const currentAvg = positive(currentAveragePrice);
  if (!addQty || !fillPrice) return immutable({ allowed: false, reasonCodes: ["INVALID_EXPOSURE_INCREASE_REQUEST"], maxPermittedResultingQuantity: currentQty, management: reconciled });

  const reasons = [];
  const resultingQuantity = currentQty + addQty;
  const resultingAveragePrice = currentQty > 0 && currentAvg
    ? ((currentAvg * currentQty) + (fillPrice * addQty)) / resultingQuantity
    : fillPrice;

  if (reconciled.futureExposureIncreaseDisabled) reasons.push("FUTURE_EXPOSURE_INCREASE_DISABLED");
  if (criticalOpen(reconciled)) reasons.push("CRITICAL_AUTHORIZATION_EXCEPTION_OPEN");
  if (resultingQuantity > Number(reconciled.armQuantityCeiling) + 1e-9) reasons.push("AUTHORIZED_QUANTITY_EXCEEDED");
  if (resultingQuantity > Number(reconciled.liveManagementCeiling) + 1e-9) reasons.push("LIVE_MANAGEMENT_CEILING_EXCEEDED");

  const buildOpen = reconciled.build?.status === "OPEN";
  const normalizedKind = upper(kind);
  if (normalizedKind === "ADD") {
    if (buildOpen && reconciled.managementContract?.mode === "SINGLE_ENTRY") reasons.push("MANAGEMENT_CONTRACT_VIOLATION");
    if (!buildOpen && !reconciled.reAddAllowed) reasons.push("READD_NOT_AUTHORIZED");
  }

  const stop = positive(reconciled.currentEffectiveStop?.price);
  if (!stop) reasons.push("LIVE_STOP_AUTHORITY_UNAVAILABLE");
  else if (!stopProtective(reconciled.direction, stop, management.currentEffectiveStop?.source === "ARM_EFFECTIVE_STOP" ? stop : null)) {
    // Protection relative to ARM is validated using the frozen baseline carried below.
  }
  const armStop = positive(management.stopHistory?.[0]?.priorStop) ?? (management.currentEffectiveStop?.source === "ARM_EFFECTIVE_STOP" ? positive(management.currentEffectiveStop?.price) : null);
  if (stop && armStop && !stopProtective(reconciled.direction, stop, armStop)) reasons.push("LIVE_STOP_NOT_RISK_PROTECTIVE");

  let aggregateWorstCaseLoss = null;
  if (stop) {
    const openRisk = calculateV24OpenStopRisk({
      direction: reconciled.direction,
      averagePrice: resultingAveragePrice,
      quantity: resultingQuantity,
      stopPrice: stop,
      instrumentEconomics: reconciled.instrumentEconomics,
    });
    aggregateWorstCaseLoss = Number(reconciled.risk?.cumulativeRealizedLosses || 0) + Number(openRisk || 0);
    const budget = positive(reconciled.risk?.authorizedMaxDollarRisk);
    if (!budget) reasons.push("LIFECYCLE_LOSS_BUDGET_UNAVAILABLE");
    else if (aggregateWorstCaseLoss > budget + 1e-9) reasons.push("LIFECYCLE_LOSS_BUDGET_EXCEEDED");
  }

  let maxPermittedResultingQuantity = Math.min(Number(reconciled.armQuantityCeiling), Number(reconciled.liveManagementCeiling));
  const budget = positive(reconciled.risk?.authorizedMaxDollarRisk);
  const losses = Math.max(0, Number(reconciled.risk?.cumulativeRealizedLosses || 0));
  if (budget && stop && resultingAveragePrice) {
    const remainingForOpenRisk = Math.max(0, budget - losses);
    const perUnit = calculateV24OpenStopRisk({
      direction: reconciled.direction,
      averagePrice: resultingAveragePrice,
      quantity: 1,
      stopPrice: stop,
      instrumentEconomics: reconciled.instrumentEconomics,
    });
    if (perUnit && perUnit > 0) maxPermittedResultingQuantity = Math.min(maxPermittedResultingQuantity, Math.floor((remainingForOpenRisk + 1e-9) / perUnit));
  }

  return immutable({
    allowed: reasons.length === 0,
    reasonCodes: unique(reasons),
    proposedAddQuantity: addQty,
    resultingQuantity,
    resultingAveragePrice,
    aggregateWorstCaseLoss,
    maxPermittedResultingQuantity: Math.max(0, maxPermittedResultingQuantity),
    management: reconciled,
  });
}

export function applyV24ExecutionToManagement({ management, event, reducerResult, eventType } = {}) {
  let next = clone(reconcileV24BuildWindow(management, {
    at: event?.executionTime,
    currentQuantity: Math.abs(Number(reducerResult?.previousQuantity || 0)),
    currentAveragePrice: reducerResult?.state?.averagePrice ?? null,
  }));
  const type = upper(eventType ?? reducerResult?.event);
  const resultingQuantity = Math.abs(Number(reducerResult?.nextQuantity || 0));
  const resultingAveragePrice = resultingQuantity > 0 ? positive(reducerResult?.nextAveragePrice) : null;

  if (["ENTRY_FRAGMENT", "ADD"].includes(type)) {
    const check = evaluateV24ExposureIncrease({
      management: next,
      currentQuantity: Math.abs(Number(reducerResult?.previousQuantity || 0)),
      currentAveragePrice: positive(reducerResult?.state?.averagePrice) ?? positive(event?.price),
      proposedAddQuantity: positive(event?.quantity),
      proposedFillPrice: positive(event?.price),
      at: event?.executionTime,
      kind: type === "ENTRY_FRAGMENT" ? "ENTRY_FRAGMENT" : "ADD",
    });
    next = clone(check.management);
    for (const reason of check.reasonCodes) {
      if (["INVALID_EXPOSURE_INCREASE_REQUEST", "FUTURE_EXPOSURE_INCREASE_DISABLED", "CRITICAL_AUTHORIZATION_EXCEPTION_OPEN", "READD_NOT_AUTHORIZED"].includes(reason)) {
        if (reason === "READD_NOT_AUTHORIZED") appendException(next, "MANAGEMENT_CONTRACT_VIOLATION", event?.executionTime, { reason, event });
        else if (reason === "FUTURE_EXPOSURE_INCREASE_DISABLED") appendException(next, "MANAGEMENT_CONTRACT_VIOLATION", event?.executionTime, { reason, event });
        continue;
      }
      appendException(next, reason, event?.executionTime, { event, exposureCheck: check });
    }
    next.establishedPeakQuantity = Math.max(Number(next.establishedPeakQuantity || 0), resultingQuantity);
  }

  const realizedPoints = finite(reducerResult?.realizedGrossPnl) ?? 0;
  const realizedDollars = dollarPnlFromPricePoints(realizedPoints, next.instrumentEconomics) ?? 0;
  next.risk.realizedPnl = Number(next.risk.realizedPnl || 0) + realizedDollars;
  if (realizedDollars < 0) next.risk.cumulativeRealizedLosses = Number(next.risk.cumulativeRealizedLosses || 0) + Math.abs(realizedDollars);

  if (type === "REVERSAL") appendException(next, "WRONG_DIRECTION_EXECUTION_OBSERVED", event?.executionTime, { event });
  next.establishedPeakQuantity = Math.max(Number(next.establishedPeakQuantity || 0), resultingQuantity);
  return immutable(refreshDerived(next, { currentQuantity: resultingQuantity, currentAveragePrice: resultingAveragePrice }));
}

export function recordV24AuthorizationException(management, { code, occurredAt, evidence = null, severity = null } = {}) {
  const next = clone(management);
  appendException(next, code, occurredAt, evidence, severity);
  return immutable(refreshDerived(next, {}));
}

function targetThreshold(target, management, entryPrice) {
  if (typeof target === "number") return { type: "FIXED_PRICE", price: positive(target) };
  if (!target || typeof target !== "object") return null;
  const fixed = positive(target.price ?? target.level ?? target.value);
  if (fixed) return { type: "FIXED_PRICE", price: fixed };
  const lower = positive(target.lower ?? target.min ?? target.zoneLow);
  const upperBound = positive(target.upper ?? target.max ?? target.zoneHigh);
  if (lower && upperBound && upperBound >= lower) return { type: "PRICE_ZONE", lower, upper: upperBound };
  const rMultiple = positive(target.rMultiple ?? target.r ?? target.multiple);
  const armStop = positive(management.stopHistory?.[0]?.priorStop) ?? positive(management.currentEffectiveStop?.price);
  const entry = positive(entryPrice);
  if (rMultiple && armStop && entry) {
    const distance = Math.abs(entry - armStop);
    return { type: "R_MULTIPLE", price: management.direction === "LONG" ? entry + (distance * rMultiple) : entry - (distance * rMultiple), rMultiple };
  }
  return null;
}

function targetSatisfied({ direction, threshold, observation }) {
  const price = positive(observation?.price ?? observation?.close);
  if (!threshold || !price) return false;
  if (threshold.type === "PRICE_ZONE") return price >= threshold.lower && price <= threshold.upper;
  return direction === "LONG" ? price >= threshold.price : price <= threshold.price;
}

export function applyV24LiveManagementCommand({ management, command, currentQuantity, currentAveragePrice, entryPrice = null } = {}) {
  if (!management || Number(management.schemaVersion) !== V24_LIVE_MANAGEMENT_SCHEMA_VERSION) throw managementError("valid V2.4 live management state is required", "INVALID_V24_LIVE_MANAGEMENT");
  const operationId = text(command?.operationId);
  const expectedRevision = Number(command?.expectedRevision);
  const action = upper(command?.action);
  if (!operationId || !Number.isInteger(expectedRevision) || expectedRevision < 0 || !action) throw managementError("operationId, action, and expectedRevision are required", "LIVE_MANAGEMENT_COMMAND_INVALID");
  const payload = clone(command?.payload ?? {});
  const fingerprint = operationFingerprint(action, payload);
  const prior = (management.operations || []).find((item) => item.operationId === operationId);
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw managementError("operationId conflicts with prior live-management action", "LIVE_MANAGEMENT_OPERATION_CONFLICT");
    return immutable({ management, result: prior.result });
  }
  if (Number(management.revision) !== expectedRevision) throw managementError("live-management revision is stale", "STALE_LIVE_MANAGEMENT_REVISION", { expectedRevision, actualRevision: management.revision });

  const at = iso(command?.at) || new Date().toISOString();
  let next = clone(reconcileV24BuildWindow(management, { at, currentQuantity, currentAveragePrice }));
  let result = null;

  if (action === "COMPLETE_POSITION_BUILD") {
    if (next.build.status !== "COMPLETE") {
      next.build.status = "COMPLETE";
      next.build.completedAt = at;
      next.build.completionReason = "OPERATOR_COMPLETE_POSITION_BUILD";
      next.liveManagementCeiling = Math.min(Number(next.armQuantityCeiling), Number(next.establishedPeakQuantity || currentQuantity || 0));
    }
    result = { action, liveManagementCeiling: next.liveManagementCeiling, buildStatus: next.build.status };
  } else if (action === "CLOSE_FURTHER_EXPOSURE") {
    next.futureExposureIncreaseDisabled = true;
    result = { action, futureExposureIncreaseDisabled: true };
  } else if (action === "SET_EFFECTIVE_STOP") {
    const newStop = positive(payload.newStop);
    if (!newStop) throw managementError("newStop must be positive", "LIVE_STOP_INVALID");
    const priorStop = positive(next.currentEffectiveStop?.price);
    next.stopHistory.push({
      priorStop,
      newStop,
      changedAt: at,
      source: upper(payload.source || "OPERATOR"),
      reason: text(payload.reason) || null,
    });
    next.currentEffectiveStop = {
      price: newStop,
      source: upper(payload.source || "OPERATOR"),
      updatedAt: at,
      reason: text(payload.reason) || null,
    };
    result = { action, priorStop, newStop, protectiveForAdds: stopProtective(next.direction, newStop, priorStop) };
  } else if (action === "CHECK_EXPOSURE_INCREASE") {
    const check = evaluateV24ExposureIncrease({
      management: next,
      currentQuantity,
      currentAveragePrice,
      proposedAddQuantity: payload.quantity,
      proposedFillPrice: payload.expectedPrice,
      at,
      kind: payload.kind || "ADD",
    });
    next = clone(check.management);
    result = { action, ...clone(check), management: undefined };
  } else if (action === "RECORD_TARGET_OBSERVATION") {
    const targetId = text(payload.targetId);
    const target = next.targets.find((item) => item.targetId === targetId);
    if (!target) throw managementError("authorized target was not found", "LIVE_TARGET_NOT_FOUND");
    const threshold = targetThreshold(target.definition, next, entryPrice);
    if (!threshold) throw managementError("target cannot be evaluated deterministically from supplied evidence", "LIVE_TARGET_EVALUATION_UNSUPPORTED");
    const attained = targetSatisfied({ direction: next.direction, threshold, observation: payload.observation });
    if (attained && target.status !== "ATTAINED") {
      target.status = "ATTAINED";
      target.attainedAt = iso(payload.observation?.observedAt) || at;
      target.attainmentEvidence = clone({ threshold, observation: payload.observation });
    }
    result = { action, targetId, attained: target.status === "ATTAINED", threshold };
  } else if (action === "RECORD_DISCRETIONARY_NOTE") {
    const note = text(payload.note);
    if (!note) throw managementError("discretionary note is required", "LIVE_MANAGEMENT_NOTE_REQUIRED");
    next.discretionaryActions.push({ actionId: operationId, action: "NOTE", occurredAt: at, note, authority: false });
    result = { action, recorded: true };
  } else if (action === "RECONCILE_EXCEPTION") {
    const exceptionId = text(payload.exceptionId);
    const exception = next.authorizationExceptions.find((item) => item.exceptionId === exceptionId);
    if (!exception) throw managementError("authorization exception was not found", "AUTHORIZATION_EXCEPTION_NOT_FOUND");
    if (exception.status === "RECONCILED") result = { action, exceptionId, outcome: exception.reconciliationOutcome };
    else {
      const outcome = upper(payload.outcome);
      if (!["CONTINUE_AFTER_REVIEW", "CLOSE_TO_NEW_EXPOSURE"].includes(outcome)) throw managementError("reconciliation outcome is invalid", "AUTHORIZATION_EXCEPTION_RECONCILIATION_INVALID");
      if (outcome === "CONTINUE_AFTER_REVIEW") {
        const refreshed = refreshDerived(next, { currentQuantity, currentAveragePrice });
        if (Number(currentQuantity || 0) > Number(refreshed.liveManagementCeiling) + 1e-9) throw managementError("current quantity remains above live-management ceiling", "AUTHORIZATION_EXCEPTION_STILL_NONCOMPLIANT");
        if (refreshed.risk.authorizedMaxDollarRisk === null || refreshed.risk.aggregateWorstCaseLoss > refreshed.risk.authorizedMaxDollarRisk + 1e-9) throw managementError("current lifecycle risk remains above authorized budget", "AUTHORIZATION_EXCEPTION_STILL_NONCOMPLIANT");
        if (!positive(refreshed.currentEffectiveStop?.price)) throw managementError("current live stop authority remains unavailable", "AUTHORIZATION_EXCEPTION_STILL_NONCOMPLIANT");
      } else {
        next.futureExposureIncreaseDisabled = true;
      }
      exception.status = "RECONCILED";
      exception.reconciledAt = at;
      exception.reconciliationOutcome = outcome;
      exception.reconciliationNote = text(payload.note) || null;
      result = { action, exceptionId, outcome };
    }
  } else {
    throw managementError(`unsupported live-management action ${action}`, "LIVE_MANAGEMENT_ACTION_UNSUPPORTED");
  }

  next.revision += 1;
  next = refreshDerived(next, { currentQuantity, currentAveragePrice });
  const committedResult = { ...result, revision: next.revision, handoffId: next.handoffId };
  next.operations.push({ operationId, fingerprint, action, committedAt: at, result: clone(committedResult) });
  return immutable({ management: next, result: committedResult });
}

export async function applyV24LiveManagementCommandSerialized({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
  handoffId,
  command,
  lockManager = globalThis?.navigator?.locks,
} = {}) {
  const id = text(handoffId);
  if (!id) throw managementError("handoffId is required", "LIVE_MANAGEMENT_HANDOFF_REQUIRED");
  let authoritativeResult = null;
  const committed = await transactExecutionBoardStoreSerialized({
    storage,
    storeKey,
    lockManager,
    mutate: (store) => {
      const lifecycleIndex = store.v24Lifecycles.findIndex((item) => sameIdentity(item, id));
      if (lifecycleIndex < 0) throw managementError("V2.4 LIVE lifecycle was not found", "V24_LIVE_LIFECYCLE_NOT_FOUND");
      const lifecycle = clone(store.v24Lifecycles[lifecycleIndex]);
      if (!lifecycle.management) throw managementError("V2.4 live-management authority is unavailable", "V24_LIVE_MANAGEMENT_UNAVAILABLE");
      if (!["LIVE", "LIVE_RECONCILIATION_REQUIRED"].includes(upper(lifecycle.status))) throw managementError("live-management action requires active lifecycle", "V24_LIVE_MANAGEMENT_NOT_ACTIVE");
      const applied = applyV24LiveManagementCommand({
        management: lifecycle.management,
        command,
        currentQuantity: lifecycle.currentQuantity,
        currentAveragePrice: lifecycle.currentAveragePrice,
        entryPrice: lifecycle.entryVwap,
      });
      lifecycle.management = clone(applied.management);
      authoritativeResult = clone(applied.result);
      store.v24Lifecycles[lifecycleIndex] = lifecycle;
      const tradeIndex = store.liveTrades.findIndex((item) => sameIdentity(item, id));
      if (tradeIndex >= 0) {
        const trade = clone(store.liveTrades[tradeIndex]);
        trade.broker = { ...(trade.broker || {}), liveManagement: clone(applied.management) };
        store.liveTrades[tradeIndex] = trade;
      }
      return store;
    },
  });
  const lifecycle = committed.v24Lifecycles.find((item) => sameIdentity(item, id));
  return immutable({ result: authoritativeResult, lifecycle, storeRevision: committed.storeRevision, brokerWriteAuthority: false });
}

export function readV24LiveManagement({ storage = globalThis?.localStorage, storeKey = EXECUTION_BOARD_STORE_KEY, handoffId } = {}) {
  const lifecycle = readExecutionBoardStore({ storage, storeKey }).v24Lifecycles.find((item) => sameIdentity(item, handoffId));
  return lifecycle?.management ? immutable(lifecycle.management) : null;
}
