import { RISK_SIZING_POLICY_VERSION, riskSizingPolicyForVersion } from "./risk-sizing-policy.mjs";

const RISK_FRACTION = { n: 1n, d: 200n }; // 0.005
const CENT = { n: 1n, d: 100n };

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
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
  if (!Number.isInteger(exp) || exp < 0 || exp > 30) {
    throw new Error("decimal scale is outside supported range");
  }
  return 10n ** BigInt(exp);
}

function decimalRat(value, label) {
  if (value === null || value === undefined || typeof value === "boolean") {
    throw new Error(`${label} must be a decimal-compatible value`);
  }
  const source = typeof value === "bigint" ? value.toString() : String(value).trim();
  if (!source) throw new Error(`${label} must be a decimal-compatible value`);

  const match = source.toLowerCase().match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/);
  if (!match) throw new Error(`${label} must be a decimal-compatible value`);

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

function sub(a, b) {
  return rat(a.n * b.d - b.n * a.d, a.d * b.d);
}

function mul(a, b) {
  return rat(a.n * b.n, a.d * b.d);
}

function div(a, b) {
  if (b.n === 0n) throw new Error("division by zero");
  return rat(a.n * b.d, a.d * b.n);
}

function compare(a, b) {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
}

function floorPositive(value) {
  if (value.n < 0n) throw new Error("floorPositive requires a non-negative rational");
  return value.n / value.d;
}

function ceilPositive(value) {
  if (value.n < 0n) throw new Error("ceilPositive requires a non-negative rational");
  return (value.n + value.d - 1n) / value.d;
}

function isInteger(value) {
  return value.n % value.d === 0n;
}

function toNumber(value) {
  const result = Number(value.n) / Number(value.d);
  if (!Number.isFinite(result)) throw new Error("rational result is outside numeric output range");
  return result;
}

function floorToIncrement(value, increment) {
  if (compare(value, rat(0n)) < 0 || compare(increment, rat(0n)) <= 0) {
    throw new Error("floorToIncrement requires non-negative value and positive increment");
  }
  const units = floorPositive(div(value, increment));
  return mul(increment, rat(units));
}

function blocked(reasonCode, partial = {}) {
  return {
    ...partial,
    status: "BLOCKED",
    reasonCodes: [reasonCode],
  };
}

function noAffordable(partial) {
  return {
    ...partial,
    status: "NO_AFFORDABLE_SIZE",
    reasonCodes: ["MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET"],
    finalQuantity: 0,
    plannedDollarRisk: 0,
    plannedRiskFraction: 0,
  };
}

function errorResult(reasonCode, partial = {}) {
  return {
    ...partial,
    status: "ERROR",
    reasonCodes: [reasonCode],
  };
}

function parsePositive(value, label) {
  const parsed = decimalRat(value, label);
  if (compare(parsed, rat(0n)) <= 0) throw new Error(`${label} must be > 0`);
  return parsed;
}

function validQuantityMetadata(instrument) {
  try {
    const minimumQuantity = parsePositive(instrument?.minimumQuantity, "minimumQuantity");
    const quantityIncrement = parsePositive(instrument?.quantityIncrement, "quantityIncrement");
    if (!isInteger(div(minimumQuantity, quantityIncrement))) return null;
    return { minimumQuantity, quantityIncrement };
  } catch {
    return null;
  }
}

function commonBase({
  direction,
  assetType,
  policy,
  riskDistance,
  accountEquity,
  rawMaxDollarRisk,
  maxDollarRisk,
  riskPerUnit,
  riskTicks = null,
}) {
  return {
    direction,
    assetType,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    riskFraction: policy.riskFraction,
    rawMaxDollarRisk: toNumber(rawMaxDollarRisk),
    maxDollarRisk: toNumber(maxDollarRisk),
    budgetRoundingRule: "FLOOR_TO_CENT",
    riskDistance: toNumber(riskDistance),
    riskTicks: riskTicks === null ? null : Number(riskTicks),
    riskPerUnit: toNumber(riskPerUnit),
    accountEquity: toNumber(accountEquity),
    quantityRoundingRule: "FLOOR_TO_VALID_INCREMENT",
  };
}

export function calculateRiskSizing({
  direction,
  currentExpectedEntry,
  effectiveStop,
  accountEquity,
  accountCurrency,
  instrument,
  policyVersion = RISK_SIZING_POLICY_VERSION,
} = {}) {
  const policy = riskSizingPolicyForVersion(policyVersion);
  if (policy.riskFraction !== 0.005 || policy.budgetIncrement !== 0.01) {
    throw new Error("risk sizing policy arithmetic constants are unsupported");
  }
  const normalizedDirection = upper(direction);
  if (!["LONG", "SHORT"].includes(normalizedDirection)) {
    throw new Error("direction must be LONG or SHORT");
  }

  let entry;
  let stop;
  try {
    entry = decimalRat(currentExpectedEntry, "currentExpectedEntry");
    stop = decimalRat(effectiveStop, "effectiveStop");
  } catch {
    return blocked("INVALID_ENTRY_STOP_GEOMETRY");
  }

  const riskDistance = normalizedDirection === "LONG" ? sub(entry, stop) : sub(stop, entry);
  if (compare(riskDistance, rat(0n)) <= 0) {
    return blocked("INVALID_ENTRY_STOP_GEOMETRY", {
      direction: normalizedDirection,
      currentExpectedEntry: toNumber(entry),
      effectiveStop: toNumber(stop),
    });
  }

  let equity;
  try {
    equity = parsePositive(accountEquity, "accountEquity");
  } catch {
    return blocked("ACCOUNT_EQUITY_INVALID", {
      direction: normalizedDirection,
      riskDistance: toNumber(riskDistance),
    });
  }

  const normalizedAccountCurrency = upper(accountCurrency);
  if (!normalizedAccountCurrency) {
    return blocked("ACCOUNT_CURRENCY_UNSUPPORTED", {
      direction: normalizedDirection,
      riskDistance: toNumber(riskDistance),
      accountEquity: toNumber(equity),
    });
  }

  const assetType = upper(instrument?.assetType);
  if (!["EQUITY", "FUTURE"].includes(assetType)) {
    return blocked("UNSUPPORTED_ASSET_TYPE", {
      direction: normalizedDirection,
      riskDistance: toNumber(riskDistance),
      accountEquity: toNumber(equity),
    });
  }

  const instrumentCurrency = upper(instrument?.currency ?? instrument?.instrumentCurrency);
  if (!instrumentCurrency) {
    return blocked("INSTRUMENT_METADATA_INVALID", {
      direction: normalizedDirection,
      assetType,
      riskDistance: toNumber(riskDistance),
      accountEquity: toNumber(equity),
    });
  }
  if (instrumentCurrency !== normalizedAccountCurrency) {
    return blocked("CURRENCY_CONVERSION_UNSUPPORTED", {
      direction: normalizedDirection,
      assetType,
      riskDistance: toNumber(riskDistance),
      accountEquity: toNumber(equity),
    });
  }

  const quantityMetadata = validQuantityMetadata(instrument);
  if (!quantityMetadata) {
    return blocked("INVALID_QUANTITY_METADATA", {
      direction: normalizedDirection,
      assetType,
      riskDistance: toNumber(riskDistance),
      accountEquity: toNumber(equity),
    });
  }

  const rawMaxDollarRisk = mul(equity, RISK_FRACTION);
  const maxDollarRisk = floorToIncrement(rawMaxDollarRisk, CENT);

  let riskPerUnit;
  let riskTicks = null;

  if (assetType === "EQUITY") {
    riskPerUnit = riskDistance;
  } else {
    let tickSize;
    let tickValue;
    try {
      tickSize = parsePositive(instrument?.tickSize, "tickSize");
      tickValue = parsePositive(instrument?.tickValue, "tickValue");
    } catch {
      return blocked("INSTRUMENT_METADATA_INVALID", {
        direction: normalizedDirection,
        assetType,
        riskDistance: toNumber(riskDistance),
        accountEquity: toNumber(equity),
        rawMaxDollarRisk: toNumber(rawMaxDollarRisk),
        maxDollarRisk: toNumber(maxDollarRisk),
      });
    }

    if (instrument?.pointValue !== undefined && instrument?.pointValue !== null && String(instrument.pointValue).trim() !== "") {
      let pointValue;
      try {
        pointValue = parsePositive(instrument.pointValue, "pointValue");
      } catch {
        return blocked("INSTRUMENT_METADATA_INVALID", {
          direction: normalizedDirection,
          assetType,
          riskDistance: toNumber(riskDistance),
          accountEquity: toNumber(equity),
          rawMaxDollarRisk: toNumber(rawMaxDollarRisk),
          maxDollarRisk: toNumber(maxDollarRisk),
        });
      }
      const expectedTickValue = mul(tickSize, pointValue);
      if (compare(expectedTickValue, tickValue) !== 0) {
        return blocked("INSTRUMENT_METADATA_INCONSISTENT", {
          direction: normalizedDirection,
          assetType,
          riskDistance: toNumber(riskDistance),
          accountEquity: toNumber(equity),
          rawMaxDollarRisk: toNumber(rawMaxDollarRisk),
          maxDollarRisk: toNumber(maxDollarRisk),
        });
      }
    }

    riskTicks = ceilPositive(div(riskDistance, tickSize));
    riskPerUnit = mul(tickValue, rat(riskTicks));
  }

  if (compare(riskPerUnit, rat(0n)) <= 0) {
    return blocked("INSTRUMENT_METADATA_INVALID", {
      direction: normalizedDirection,
      assetType,
      riskDistance: toNumber(riskDistance),
      accountEquity: toNumber(equity),
      rawMaxDollarRisk: toNumber(rawMaxDollarRisk),
      maxDollarRisk: toNumber(maxDollarRisk),
    });
  }

  const base = commonBase({
    direction: normalizedDirection,
    policy,
    assetType,
    riskDistance,
    accountEquity: equity,
    rawMaxDollarRisk,
    maxDollarRisk,
    riskPerUnit,
    riskTicks,
  });

  const rawQuantity = div(maxDollarRisk, riskPerUnit);
  const roundedQuantity = floorToIncrement(rawQuantity, quantityMetadata.quantityIncrement);

  if (compare(roundedQuantity, quantityMetadata.minimumQuantity) < 0) {
    return noAffordable({
      ...base,
      rawQuantity: toNumber(rawQuantity),
      minimumQuantity: toNumber(quantityMetadata.minimumQuantity),
      quantityIncrement: toNumber(quantityMetadata.quantityIncrement),
    });
  }

  const plannedDollarRisk = mul(roundedQuantity, riskPerUnit);
  if (compare(plannedDollarRisk, maxDollarRisk) > 0) {
    return errorResult("RISK_INVARIANT_VIOLATION", {
      ...base,
      rawQuantity: toNumber(rawQuantity),
      finalQuantity: toNumber(roundedQuantity),
      minimumQuantity: toNumber(quantityMetadata.minimumQuantity),
      quantityIncrement: toNumber(quantityMetadata.quantityIncrement),
    });
  }

  const plannedRiskFraction = div(plannedDollarRisk, equity);
  if (compare(plannedRiskFraction, RISK_FRACTION) > 0) {
    return errorResult("RISK_INVARIANT_VIOLATION", {
      ...base,
      rawQuantity: toNumber(rawQuantity),
      finalQuantity: toNumber(roundedQuantity),
      minimumQuantity: toNumber(quantityMetadata.minimumQuantity),
      quantityIncrement: toNumber(quantityMetadata.quantityIncrement),
      plannedDollarRisk: toNumber(plannedDollarRisk),
      plannedRiskFraction: toNumber(plannedRiskFraction),
    });
  }

  return {
    ...base,
    rawQuantity: toNumber(rawQuantity),
    finalQuantity: toNumber(roundedQuantity),
    minimumQuantity: toNumber(quantityMetadata.minimumQuantity),
    quantityIncrement: toNumber(quantityMetadata.quantityIncrement),
    plannedDollarRisk: toNumber(plannedDollarRisk),
    plannedRiskFraction: toNumber(plannedRiskFraction),
    status: "VALID",
    reasonCodes: [],
  };
}
