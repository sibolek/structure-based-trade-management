import { canonicalLifecycleState } from "./pretrade-state.mjs";
import { mapRiskSizingToPermission } from "./risk-sizing-permission-handoff.mjs";

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

function preparationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function gcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1n;
}

function rat(n, d = 1n) {
  if (d === 0n) throw new Error("rational denominator may not be zero");
  let numerator = BigInt(n);
  let denominator = BigInt(d);
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const divisor = gcd(numerator, denominator);
  return { n: numerator / divisor, d: denominator / divisor };
}

function pow10(exp) {
  if (!Number.isInteger(exp) || exp < 0 || exp > 30) throw new Error("decimal scale is outside supported range");
  return 10n ** BigInt(exp);
}

function decimalRat(value) {
  if (value === null || value === undefined || typeof value === "boolean") throw new Error("invalid decimal");
  const source = typeof value === "bigint" ? value.toString() : String(value).trim();
  if (!source) throw new Error("invalid decimal");
  const match = source.toLowerCase().match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/);
  if (!match) throw new Error("invalid decimal");
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = match[2];
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 30) throw new Error("invalid decimal");
  let numerator = BigInt(`${whole}${fraction}` || "0") * sign;
  let scale = fraction.length - exponent;
  if (scale < 0) {
    numerator *= pow10(-scale);
    scale = 0;
  }
  return rat(numerator, pow10(scale));
}

function compare(a, b) {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactIncrement(value, increment) {
  const numerator = value.n * increment.d;
  const denominator = value.d * increment.n;
  return denominator !== 0n && numerator % denominator === 0n;
}

function findCandidate(store, riskEvaluation) {
  const state = store.snapshot();
  const candidateId = text(riskEvaluation?.candidate?.candidateId);
  const contractVersion = Number(riskEvaluation?.candidate?.contractVersion);
  const candidate = (Array.isArray(state?.candidates) ? state.candidates : []).find((item) => (
    text(item?.candidateId) === candidateId
    && Number(item?.contractVersion) === contractVersion
  ));
  if (!candidate) {
    throw preparationError(
      `candidate ${candidateId} v${contractVersion} was not found`,
      "ARM_RISK_HANDOFF_CANDIDATE_NOT_FOUND",
    );
  }
  return candidate;
}

export function buildArmRiskHandoff({ store, riskEvaluation, selectedQuantity } = {}) {
  if (!store || typeof store.snapshot !== "function") {
    throw new Error("ARM risk handoff requires a pre-trade store with snapshot()");
  }
  if (!riskEvaluation || typeof riskEvaluation !== "object") {
    throw preparationError("risk evaluation is required", "ARM_RISK_HANDOFF_EVALUATION_REQUIRED");
  }
  if (upper(riskEvaluation.status) !== "VALID") {
    throw preparationError(
      `risk evaluation status is ${upper(riskEvaluation.status) || "UNKNOWN"}`,
      "ARM_RISK_HANDOFF_EVALUATION_NOT_VALID",
    );
  }

  const candidate = findCandidate(store, riskEvaluation);
  const lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
  if (!["READY", "CAUTION"].includes(lifecycleState)) {
    throw preparationError(
      `ARM risk handoff is not allowed while candidate is ${lifecycleState}`,
      "ARM_RISK_HANDOFF_NOT_ALLOWED_IN_STATE",
    );
  }
  if (text(candidate.authorizedDssEvaluationId)) {
    throw preparationError(
      "candidate already has an authorized DSS evaluation",
      "ARM_RISK_HANDOFF_ALREADY_AUTHORIZED",
    );
  }
  if (candidate.currentDssEvaluationStale) {
    throw preparationError(
      "candidate DSS evaluation is stale",
      "STALE_DSS_EVALUATION",
    );
  }

  if (
    text(riskEvaluation.candidate?.candidateHash) !== text(candidate.contentHash)
    || upper(riskEvaluation.candidate?.symbol) !== upper(candidate.symbol)
    || upper(riskEvaluation.candidate?.direction) !== upper(candidate.direction)
  ) {
    throw preparationError(
      "risk evaluation candidate identity does not match current candidate",
      "ARM_RISK_HANDOFF_IDENTITY_MISMATCH",
    );
  }

  const dssEvaluationId = text(riskEvaluation.dss?.dssEvaluationId);
  if (!dssEvaluationId || dssEvaluationId !== text(candidate.currentDssEvaluationId)) {
    throw preparationError(
      "risk evaluation does not reference the candidate current DSS evaluation",
      "ARM_RISK_HANDOFF_DSS_MISMATCH",
    );
  }

  let selected;
  let minimum;
  let increment;
  let maximum;
  try {
    selected = decimalRat(selectedQuantity);
    minimum = decimalRat(riskEvaluation.instrument?.minimumQuantity);
    increment = decimalRat(riskEvaluation.instrument?.quantityIncrement);
    maximum = decimalRat(riskEvaluation.calculation?.finalQuantity);
  } catch {
    throw preparationError("selected quantity or quantity metadata is invalid", "INVALID_SELECTED_QUANTITY");
  }

  const zero = rat(0n);
  if (
    compare(selected, zero) <= 0
    || compare(minimum, zero) <= 0
    || compare(increment, zero) <= 0
    || compare(maximum, minimum) < 0
    || compare(selected, minimum) < 0
    || !exactIncrement(selected, increment)
  ) {
    throw preparationError(
      "selected quantity does not satisfy minimum/increment requirements",
      "INVALID_SELECTED_QUANTITY",
    );
  }

  if (compare(selected, maximum) > 0) {
    throw preparationError(
      "selected quantity exceeds the exact risk evaluation maximum",
      "QUANTITY_EXCEEDS_RISK_LIMIT",
    );
  }

  const normalizedSelectedQuantity = Number(selected.n) / Number(selected.d);
  if (!Number.isFinite(normalizedSelectedQuantity)) {
    throw preparationError("selected quantity is outside supported numeric range", "INVALID_SELECTED_QUANTITY");
  }

  return immutable({
    candidateVersion: Number(candidate.contractVersion),
    dssEvaluationId,
    riskEvaluationId: text(riskEvaluation.riskEvaluationId),
    selectedQuantity: normalizedSelectedQuantity,
  });
}

export class ArmRiskPreparationService {
  constructor({ store, riskSizingPermissionService, riskEvaluationRepository } = {}) {
    if (!store || typeof store.snapshot !== "function") {
      throw new Error("ArmRiskPreparationService requires a pre-trade store with snapshot()");
    }
    if (!riskSizingPermissionService || typeof riskSizingPermissionService.evaluateForArm !== "function") {
      throw new Error("ArmRiskPreparationService requires riskSizingPermissionService.evaluateForArm()");
    }
    if (!riskEvaluationRepository || typeof riskEvaluationRepository.getById !== "function") {
      throw new Error("ArmRiskPreparationService requires riskEvaluationRepository.getById()");
    }
    this.store = store;
    this.riskSizingPermissionService = riskSizingPermissionService;
    this.riskEvaluationRepository = riskEvaluationRepository;
  }

  async prepare({ selectedQuantity, ...riskRequest } = {}) {
    // Each preparation call is one ARM attempt and therefore always asks Slice 7
    // to create a brand-new Phase 4 evaluation from fresh live inputs.
    const riskSizingResult = await this.riskSizingPermissionService.evaluateForArm(riskRequest);
    const permission = mapRiskSizingToPermission(riskSizingResult);

    if (permission.consequence !== "CONTINUE") {
      return immutable({
        riskSizingResult,
        permission,
        armRiskHandoff: null,
      });
    }

    const riskEvaluation = this.riskEvaluationRepository.getById(riskSizingResult.riskEvaluationId);
    const armRiskHandoff = buildArmRiskHandoff({
      store: this.store,
      riskEvaluation,
      selectedQuantity,
    });

    return immutable({
      riskSizingResult,
      permission,
      armRiskHandoff,
    });
  }
}
