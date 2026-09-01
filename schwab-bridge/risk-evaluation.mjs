import crypto from "node:crypto";

export const RISK_EVALUATION_SCHEMA_VERSION = 1;
export const RISK_EVALUATION_STATUSES = Object.freeze([
  "VALID",
  "NO_AFFORDABLE_SIZE",
  "BLOCKED",
  "ERROR",
]);

const STATUS_SET = new Set(RISK_EVALUATION_STATUSES);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function finiteNumber(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function timestampIso(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (Number.isFinite(number)) return new Date(number).toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function unique(values) {
  return [...new Set((values || []).map(upper).filter(Boolean))];
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function componentReasons(component) {
  const status = upper(component?.status);
  if (!["BLOCKED", "ERROR", "NO_AFFORDABLE_SIZE"].includes(status)) return [];
  return unique(component?.reasonCodes);
}

function componentStatus(component) {
  return upper(component?.status);
}

function candidateSnapshot(candidate) {
  return {
    candidateId: text(candidate?.candidateId) || null,
    contractVersion: Number(candidate?.contractVersion),
    candidateHash: text(candidate?.contentHash ?? candidate?.candidateHash) || null,
    symbol: upper(candidate?.symbol) || null,
    direction: upper(candidate?.direction) || null,
  };
}

function dssSnapshot(dssHandoff) {
  const evaluation = dssHandoff?.evaluation && typeof dssHandoff.evaluation === "object"
    ? dssHandoff.evaluation
    : dssHandoff;
  return {
    dssEvaluationId: text(dssHandoff?.dssEvaluationId ?? evaluation?.dssEvaluationId) || null,
    structuralInvalidation: finiteNumber(
      evaluation?.resolvedStructuralInvalidationPrice
      ?? evaluation?.structuralInvalidation
      ?? evaluation?.structuralInvalidationPrice,
    ),
    effectiveStop: finiteNumber(evaluation?.effectiveStop),
  };
}

function entrySnapshot(entryResult) {
  if (!entryResult || typeof entryResult !== "object") return null;
  return {
    entryMode: upper(entryResult.entryMode) || null,
    triggerPrice: finiteNumber(entryResult.triggerPrice),
    currentExpectedEntry: finiteNumber(entryResult.currentExpectedEntry),
    bid: finiteNumber(entryResult.bid),
    ask: finiteNumber(entryResult.ask),
    quoteObservedAt: timestampIso(entryResult.quoteObservedAt),
    quoteAgeMs: finiteNumber(entryResult.quoteAgeMs),
    quoteSource: upper(entryResult.quoteSource) || null,
    expectedEntryRule: upper(entryResult.expectedEntryRule) || null,
  };
}

function accountSnapshot(accountResult) {
  if (!accountResult || typeof accountResult !== "object") return null;
  const source = accountResult.snapshot && typeof accountResult.snapshot === "object"
    ? accountResult.snapshot
    : accountResult;
  return {
    accountId: text(source.accountId) || null,
    accountEquity: finiteNumber(source.accountEquity),
    accountCurrency: upper(source.currency ?? source.accountCurrency) || null,
    snapshotObservedAt: timestampIso(source.observedAt ?? source.snapshotObservedAt),
    snapshotAgeMs: finiteNumber(source.ageMs ?? source.snapshotAgeMs),
    snapshotSource: upper(source.source ?? source.snapshotSource) || null,
    sourceSnapshotId: text(source.sourceSnapshotId) || null,
  };
}

function instrumentSnapshot(instrumentResult) {
  if (!instrumentResult || typeof instrumentResult !== "object") return null;
  return {
    assetType: upper(instrumentResult.assetType) || null,
    symbol: upper(instrumentResult.symbol) || null,
    instrumentCurrency: upper(instrumentResult.currency ?? instrumentResult.instrumentCurrency) || null,
    minimumQuantity: finiteNumber(instrumentResult.minimumQuantity),
    quantityIncrement: finiteNumber(instrumentResult.quantityIncrement),
    tickSize: finiteNumber(instrumentResult.tickSize),
    tickValue: finiteNumber(instrumentResult.tickValue),
    pointValue: finiteNumber(instrumentResult.pointValue),
    metadataSource: upper(instrumentResult.metadataSource) || null,
    metadataObservedAt: timestampIso(instrumentResult.metadataObservedAt),
    metadataVersion: text(instrumentResult.metadataVersion) || null,
  };
}

function calculationSnapshot(calculationResult) {
  if (!calculationResult || typeof calculationResult !== "object") return null;
  return {
    riskDistance: finiteNumber(calculationResult.riskDistance),
    riskTicks: finiteNumber(calculationResult.riskTicks),
    riskPerUnit: finiteNumber(calculationResult.riskPerUnit),
    rawQuantity: finiteNumber(calculationResult.rawQuantity),
    finalQuantity: finiteNumber(calculationResult.finalQuantity),
    quantityRoundingRule: text(calculationResult.quantityRoundingRule) || null,
    plannedDollarRisk: finiteNumber(calculationResult.plannedDollarRisk),
    plannedRiskFraction: finiteNumber(calculationResult.plannedRiskFraction),
  };
}

function accountPolicySnapshot(accountResult, calculationResult) {
  const source = accountResult?.snapshot && typeof accountResult.snapshot === "object"
    ? accountResult.snapshot
    : accountResult;
  return {
    riskFraction: finiteNumber(calculationResult?.riskFraction),
    rawMaxDollarRisk: finiteNumber(calculationResult?.rawMaxDollarRisk),
    maxDollarRisk: finiteNumber(calculationResult?.maxDollarRisk),
    budgetRoundingRule: text(calculationResult?.budgetRoundingRule) || null,
    accountEquity: finiteNumber(source?.accountEquity),
  };
}

function deriveStatus({ entryResult, accountResult, instrumentResult, calculationResult }) {
  const components = [entryResult, accountResult, instrumentResult, calculationResult].filter(Boolean);
  const statuses = components.map(componentStatus);
  if (statuses.includes("ERROR")) return "ERROR";
  if (statuses.includes("BLOCKED")) return "BLOCKED";
  if (componentStatus(calculationResult) === "NO_AFFORDABLE_SIZE") return "NO_AFFORDABLE_SIZE";
  if (
    componentStatus(entryResult) === "VALID"
    && componentStatus(accountResult) === "VALID"
    && componentStatus(instrumentResult) === "VALID"
    && componentStatus(calculationResult) === "VALID"
  ) return "VALID";
  return "ERROR";
}

function validateIdentity(candidate, dssHandoff) {
  const candidateView = candidateSnapshot(candidate);
  const dssView = dssSnapshot(dssHandoff);
  const evaluation = dssHandoff?.evaluation && typeof dssHandoff.evaluation === "object"
    ? dssHandoff.evaluation
    : dssHandoff;

  if (!candidateView.candidateId || !Number.isInteger(candidateView.contractVersion) || candidateView.contractVersion < 1) {
    throw new Error("candidate identity is invalid");
  }
  if (!candidateView.candidateHash || !candidateView.symbol || !["LONG", "SHORT"].includes(candidateView.direction)) {
    throw new Error("candidate identity is incomplete");
  }
  if (!dssView.dssEvaluationId || upper(evaluation?.status) !== "VALID" || dssView.effectiveStop === null) {
    throw new Error("fresh VALID DSS handoff is required");
  }
  if (
    text(evaluation?.candidateId) !== candidateView.candidateId
    || Number(evaluation?.candidateContractVersion) !== candidateView.contractVersion
    || text(evaluation?.candidateContentHash) !== candidateView.candidateHash
  ) {
    throw new Error("DSS handoff candidate identity does not match candidate");
  }
  return { candidateView, dssView };
}

export function validateRiskEvaluationContract(evaluation) {
  const value = evaluation && typeof evaluation === "object" ? evaluation : {};
  const errors = [];
  const status = upper(value.status);

  if (Number(value.schemaVersion) !== RISK_EVALUATION_SCHEMA_VERSION) errors.push("unsupported schemaVersion");
  if (!Number.isInteger(Number(value.riskPolicyVersion)) || Number(value.riskPolicyVersion) < 1) errors.push("riskPolicyVersion is invalid");
  if (!text(value.riskEvaluationId)) errors.push("riskEvaluationId is required");
  if (!timestampIso(value.evaluatedAt)) errors.push("evaluatedAt is invalid");
  if (!STATUS_SET.has(status)) errors.push("status is invalid");
  if (!text(value.inputFingerprint)) errors.push("inputFingerprint is required");
  if (!text(value.candidate?.candidateId)) errors.push("candidateId is required");
  if (!Number.isInteger(Number(value.candidate?.contractVersion)) || Number(value.candidate?.contractVersion) < 1) errors.push("contractVersion is invalid");
  if (!text(value.candidate?.candidateHash)) errors.push("candidateHash is required");
  if (!text(value.dss?.dssEvaluationId)) errors.push("dssEvaluationId is required");
  if (finiteNumber(value.dss?.effectiveStop) === null) errors.push("effectiveStop is required");

  const reasonCodes = unique(value.reasonCodes);
  if (status === "VALID") {
    if (reasonCodes.length) errors.push("VALID reasonCodes must be empty");
    if (positiveNumber(value.entry?.currentExpectedEntry) === null) errors.push("VALID currentExpectedEntry is required");
    const quoteAgeMs = finiteNumber(value.entry?.quoteAgeMs);
    if (quoteAgeMs === null || quoteAgeMs < 0 || quoteAgeMs > 5_000) errors.push("VALID quoteAgeMs exceeds 5 seconds");
    if (positiveNumber(value.account?.accountEquity) === null) errors.push("VALID accountEquity is required");
    const snapshotAgeMs = finiteNumber(value.account?.snapshotAgeMs);
    if (snapshotAgeMs === null || snapshotAgeMs < 0 || snapshotAgeMs > 15_000) errors.push("VALID snapshotAgeMs exceeds 15 seconds");
    if (upper(value.account?.accountCurrency) !== upper(value.instrument?.instrumentCurrency)) errors.push("VALID account and instrument currencies must match");
    if (positiveNumber(value.account?.maxDollarRisk) === null) errors.push("VALID maxDollarRisk is required");
    if (finiteNumber(value.account?.riskFraction) !== 0.005) errors.push("VALID riskFraction must equal 0.005");
    if (positiveNumber(value.calculation?.riskDistance) === null) errors.push("VALID riskDistance is required");
    if (positiveNumber(value.calculation?.riskPerUnit) === null) errors.push("VALID riskPerUnit is required");
    if (positiveNumber(value.calculation?.finalQuantity) === null) errors.push("VALID finalQuantity is required");
    const rawQuantity = finiteNumber(value.calculation?.rawQuantity);
    const finalQuantity = finiteNumber(value.calculation?.finalQuantity);
    const minimumQuantity = finiteNumber(value.instrument?.minimumQuantity);
    const plannedDollarRisk = finiteNumber(value.calculation?.plannedDollarRisk);
    const maxDollarRisk = finiteNumber(value.account?.maxDollarRisk);
    const plannedRiskFraction = finiteNumber(value.calculation?.plannedRiskFraction);
    if (rawQuantity === null || finalQuantity === null || rawQuantity < finalQuantity) errors.push("VALID rawQuantity must be >= finalQuantity");
    if (minimumQuantity === null || finalQuantity === null || finalQuantity < minimumQuantity) errors.push("VALID finalQuantity must meet minimumQuantity");
    if (plannedDollarRisk === null || maxDollarRisk === null || plannedDollarRisk > maxDollarRisk + 1e-9) errors.push("VALID plannedDollarRisk exceeds maxDollarRisk");
    if (plannedRiskFraction === null || plannedRiskFraction > 0.005 + 1e-12) errors.push("VALID plannedRiskFraction exceeds 0.5%");
    const expectedEntry = finiteNumber(value.entry?.currentExpectedEntry);
    const effectiveStop = finiteNumber(value.dss?.effectiveStop);
    if (upper(value.candidate?.direction) === "LONG" && !(expectedEntry > effectiveStop)) errors.push("VALID LONG entry/stop geometry is invalid");
    if (upper(value.candidate?.direction) === "SHORT" && !(expectedEntry < effectiveStop)) errors.push("VALID SHORT entry/stop geometry is invalid");
  }

  if (status === "NO_AFFORDABLE_SIZE") {
    if (!reasonCodes.includes("MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET")) errors.push("NO_AFFORDABLE_SIZE reason is required");
    if (finiteNumber(value.calculation?.finalQuantity) !== 0) errors.push("NO_AFFORDABLE_SIZE finalQuantity must be 0");
    const rawQuantity = finiteNumber(value.calculation?.rawQuantity);
    const minimumQuantity = finiteNumber(value.instrument?.minimumQuantity);
    if (rawQuantity === null || minimumQuantity === null || rawQuantity >= minimumQuantity) errors.push("NO_AFFORDABLE_SIZE rawQuantity must be below minimumQuantity");
  }

  if (["BLOCKED", "ERROR", "NO_AFFORDABLE_SIZE"].includes(status) && !reasonCodes.length) {
    errors.push(`${status} requires reasonCodes`);
  }

  return { valid: errors.length === 0, errors: Object.freeze(errors) };
}

export function buildRiskEvaluation({
  riskEvaluationId,
  evaluatedAt = Date.now(),
  candidate,
  dssHandoff,
  entryResult = null,
  accountResult = null,
  instrumentResult = null,
  calculationResult = null,
  policyVersion = 1,
} = {}) {
  const normalizedId = text(riskEvaluationId);
  if (!normalizedId) throw new Error("riskEvaluationId is required");
  const normalizedEvaluatedAt = timestampIso(evaluatedAt);
  if (!normalizedEvaluatedAt) throw new Error("evaluatedAt must be an ISO-compatible or epoch-millisecond timestamp");

  const { candidateView, dssView } = validateIdentity(candidate, dssHandoff);
  const status = deriveStatus({ entryResult, accountResult, instrumentResult, calculationResult });
  const reasons = unique([
    ...componentReasons(entryResult),
    ...componentReasons(accountResult),
    ...componentReasons(instrumentResult),
    ...componentReasons(calculationResult),
  ]);
  if (status === "ERROR" && reasons.length === 0) reasons.push("INTERNAL_ERROR");

  const entry = entrySnapshot(entryResult);
  const accountCore = accountSnapshot(accountResult);
  const accountPolicy = accountPolicySnapshot(accountResult, calculationResult);
  const account = accountCore ? { ...accountCore, ...accountPolicy } : null;
  const instrument = instrumentSnapshot(instrumentResult);
  const calculation = calculationSnapshot(calculationResult);

  const fingerprintInputs = {
    policyVersion: Number(policyVersion),
    candidate: candidateView,
    dss: dssView,
    entry,
    account,
    instrument,
  };

  const evaluation = {
    schemaVersion: RISK_EVALUATION_SCHEMA_VERSION,
    riskPolicyVersion: Number(policyVersion),
    riskEvaluationId: normalizedId,
    evaluatedAt: normalizedEvaluatedAt,
    candidate: candidateView,
    dss: dssView,
    entry,
    account,
    instrument,
    calculation,
    status,
    reasonCodes: reasons,
    inputFingerprint: hash(fingerprintInputs),
  };

  const contract = validateRiskEvaluationContract(evaluation);
  if (!contract.valid) {
    throw new Error(`risk evaluation contract invalid: ${contract.errors.join("; ")}`);
  }
  return immutable(evaluation);
}
