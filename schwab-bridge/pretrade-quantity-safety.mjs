export const PRETRADE_QUANTITY_SAFETY_POLICY_VERSION = 1;

const POLICIES = Object.freeze({
  1: Object.freeze({
    policyId: "V24_PRETRADE_QUANTITY_SAFETY",
    policyVersion: 1,
    stressAtrMultiple: 2,
    quantityRoundingRule: "FLOOR_TO_VALID_INCREMENT",
  }),
});

export function pretradeQuantitySafetyPolicyForVersion(
  version = PRETRADE_QUANTITY_SAFETY_POLICY_VERSION,
) {
  const normalized = Number(version);
  const policy = POLICIES[normalized];
  if (!policy) throw new Error(`unsupported quantity safety policy version: ${version}`);
  return policy;
}

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function text(value) {
  return String(value ?? "").trim();
}

function gcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
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
  if (!Number.isInteger(exp) || exp < 0 || exp > 30) {
    throw new Error("decimal scale is outside supported range");
  }
  return 10n ** BigInt(exp);
}

function decimalRat(value, label) {
  if (value === null || value === undefined || typeof value === "boolean") {
    throw new Error(`${label} must be decimal-compatible`);
  }

  const source = typeof value === "bigint" ? value.toString() : String(value).trim();
  if (!source) throw new Error(`${label} must be decimal-compatible`);

  const match = source.toLowerCase().match(
    /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/,
  );
  if (!match) throw new Error(`${label} must be decimal-compatible`);

  const sign = match[1] === "-" ? -1n : 1n;
  const whole = match[2];
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 30) {
    throw new Error(`${label} exponent is outside supported range`);
  }

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

function mul(a, b) {
  return rat(a.n * b.n, a.d * b.d);
}

function div(a, b) {
  if (b.n === 0n) throw new Error("division by zero");
  return rat(a.n * b.d, a.d * b.n);
}

function floorPositive(value) {
  if (value.n < 0n) throw new Error("expected non-negative rational");
  return value.n / value.d;
}

function ceilPositive(value) {
  if (value.n < 0n) throw new Error("expected non-negative rational");
  return (value.n + value.d - 1n) / value.d;
}

function floorToIncrement(value, increment) {
  const units = floorPositive(div(value, increment));
  return mul(increment, rat(units));
}

function toNumber(value) {
  const result = Number(value.n) / Number(value.d);
  if (!Number.isFinite(result)) throw new Error("result outside numeric range");
  return result;
}

function positive(value, label) {
  const parsed = decimalRat(value, label);
  if (compare(parsed, rat(0n)) <= 0) throw new Error(`${label} must be > 0`);
  return parsed;
}

function blocked(reasonCode, partial = {}) {
  return {
    ...partial,
    status: "BLOCKED",
    reasonCodes: [reasonCode],
  };
}

export function evaluatePretradeQuantitySafety({
  riskEvaluation,
  dssEvaluation,
  policyVersion = PRETRADE_QUANTITY_SAFETY_POLICY_VERSION,
} = {}) {
  const policy = pretradeQuantitySafetyPolicyForVersion(policyVersion);

  if (upper(riskEvaluation?.status) !== "VALID") {
    return blocked("QUANTITY_SAFETY_REQUIRES_VALID_PHASE4");
  }
  if (upper(dssEvaluation?.status) !== "VALID") {
    return blocked("QUANTITY_SAFETY_REQUIRES_VALID_DSS");
  }

  const phase4DssId = text(riskEvaluation?.dss?.dssEvaluationId);
  const dssId = text(dssEvaluation?.dssEvaluationId);
  if (!phase4DssId || !dssId || phase4DssId !== dssId) {
    return blocked("QUANTITY_SAFETY_DSS_IDENTITY_MISMATCH");
  }

  let phase4MaxQuantity;
  let maxDollarRisk;
  let atrValue;
  let minimumQuantity;
  let quantityIncrement;

  try {
    phase4MaxQuantity = positive(
      riskEvaluation?.calculation?.finalQuantity,
      "phase4MaxQuantity",
    );
    maxDollarRisk = positive(
      riskEvaluation?.account?.maxDollarRisk,
      "maxDollarRisk",
    );
    atrValue = positive(dssEvaluation?.atrValue, "atrValue");
    minimumQuantity = positive(
      riskEvaluation?.instrument?.minimumQuantity,
      "minimumQuantity",
    );
    quantityIncrement = positive(
      riskEvaluation?.instrument?.quantityIncrement,
      "quantityIncrement",
    );
  } catch {
    return blocked("QUANTITY_SAFETY_INPUT_INVALID");
  }

  const stressDistance = mul(
    atrValue,
    decimalRat(policy.stressAtrMultiple, "stressAtrMultiple"),
  );

  const assetType = upper(riskEvaluation?.instrument?.assetType);
  let stressRiskPerUnit;
  let stressTicks = null;

  if (assetType === "EQUITY") {
    stressRiskPerUnit = stressDistance;
  } else if (assetType === "FUTURE") {
    let tickSize;
    let tickValue;
    try {
      tickSize = positive(riskEvaluation?.instrument?.tickSize, "tickSize");
      tickValue = positive(riskEvaluation?.instrument?.tickValue, "tickValue");
    } catch {
      return blocked("QUANTITY_SAFETY_INSTRUMENT_METADATA_INVALID");
    }

    stressTicks = ceilPositive(div(stressDistance, tickSize));
    stressRiskPerUnit = mul(tickValue, rat(stressTicks));
  } else {
    return blocked("QUANTITY_SAFETY_UNSUPPORTED_ASSET_TYPE");
  }

  const rawVolatilityQuantity = div(maxDollarRisk, stressRiskPerUnit);
  const roundedVolatilityQuantity = floorToIncrement(
    rawVolatilityQuantity,
    quantityIncrement,
  );

  const volatilityMaxQuantity = compare(
    roundedVolatilityQuantity,
    minimumQuantity,
  ) < 0
    ? rat(0n)
    : roundedVolatilityQuantity;

  if (compare(volatilityMaxQuantity, rat(0n)) === 0) {
    return {
      status: "NO_AFFORDABLE_SIZE",
      reasonCodes: ["MINIMUM_QUANTITY_EXCEEDS_VOLATILITY_SAFETY_BUDGET"],
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      stressAtrMultiple: policy.stressAtrMultiple,
      atrValue: toNumber(atrValue),
      stressDistance: toNumber(stressDistance),
      stressTicks: stressTicks === null ? null : Number(stressTicks),
      stressRiskPerUnit: toNumber(stressRiskPerUnit),
      maxDollarRisk: toNumber(maxDollarRisk),
      phase4MaxQuantity: toNumber(phase4MaxQuantity),
      rawVolatilityQuantity: toNumber(rawVolatilityQuantity),
      volatilityMaxQuantity: 0,
      policyMaxQuantity: 0,
      bindingConstraint: "VOLATILITY_STRESS",
      quantityRoundingRule: policy.quantityRoundingRule,
    };
  }

  const policyMaxQuantity = compare(
    phase4MaxQuantity,
    volatilityMaxQuantity,
  ) <= 0
    ? phase4MaxQuantity
    : volatilityMaxQuantity;

  const bindingConstraint = compare(
    phase4MaxQuantity,
    volatilityMaxQuantity,
  ) <= 0
    ? "PHASE4_STOP_RISK"
    : "VOLATILITY_STRESS";

  return {
    status: "VALID",
    reasonCodes: [],
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    stressAtrMultiple: policy.stressAtrMultiple,
    atrValue: toNumber(atrValue),
    stressDistance: toNumber(stressDistance),
    stressTicks: stressTicks === null ? null : Number(stressTicks),
    stressRiskPerUnit: toNumber(stressRiskPerUnit),
    maxDollarRisk: toNumber(maxDollarRisk),
    phase4MaxQuantity: toNumber(phase4MaxQuantity),
    rawVolatilityQuantity: toNumber(rawVolatilityQuantity),
    volatilityMaxQuantity: toNumber(volatilityMaxQuantity),
    policyMaxQuantity: toNumber(policyMaxQuantity),
    bindingConstraint,
    quantityRoundingRule: policy.quantityRoundingRule,
  };
}
