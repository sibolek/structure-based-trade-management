import { DSS_POLICY_V1 } from "./dss-policy.mjs";

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a finite number`);
  }
  return number;
}

function positiveNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number <= 0) throw new Error(`${label} must be > 0`);
  return number;
}

function nonNegativeNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number < 0) throw new Error(`${label} must be >= 0`);
  return number;
}

function normalizeDirection(value) {
  const direction = String(value || "").trim().toUpperCase();
  if (!["LONG", "SHORT"].includes(direction)) {
    throw new Error("direction must be LONG or SHORT");
  }
  return direction;
}

function decimalPlaces(value) {
  const text = String(value).toLowerCase();
  if (text.includes("e-")) {
    const [coefficient, exponentText] = text.split("e-");
    const coefficientDecimals = (coefficient.split(".")[1] || "").length;
    return Number(exponentText) + coefficientDecimals;
  }
  return (text.split(".")[1] || "").length;
}

function normalizeRoundedPrice(value, priceIncrement) {
  const places = Math.min(12, Math.max(0, decimalPlaces(priceIncrement)));
  return Number(value.toFixed(places));
}

export function roundProtectively(rawPrice, {
  direction,
  priceIncrement,
} = {}) {
  const normalizedDirection = normalizeDirection(direction);
  const raw = finiteNumber(rawPrice, "rawPrice");
  const increment = positiveNumber(priceIncrement, "priceIncrement");
  const ratio = raw / increment;
  const tolerance = 1e-12;
  const units = normalizedDirection === "LONG"
    ? Math.floor(ratio + tolerance)
    : Math.ceil(ratio - tolerance);
  let rounded = normalizeRoundedPrice(units * increment, increment);

  // Floating-point normalization may never move the stop toward structure.
  if (normalizedDirection === "LONG" && rounded > raw + tolerance) {
    rounded = normalizeRoundedPrice(rounded - increment, increment);
  }
  if (normalizedDirection === "SHORT" && rounded < raw - tolerance) {
    rounded = normalizeRoundedPrice(rounded + increment, increment);
  }

  return {
    rawPrice: raw,
    priceIncrement: increment,
    roundingDirection: normalizedDirection === "LONG" ? "DOWN" : "UP",
    roundingAdjustment: rounded - raw,
    roundedPrice: rounded,
  };
}

export function calculateEffectiveStop({
  direction,
  structuralInvalidationPrice,
  atrValue,
  priceIncrement,
  policy = DSS_POLICY_V1,
} = {}) {
  const normalizedDirection = normalizeDirection(direction);
  const structuralPrice = finiteNumber(structuralInvalidationPrice, "structuralInvalidationPrice");
  const atr = nonNegativeNumber(atrValue, "atrValue");
  const increment = positiveNumber(priceIncrement, "priceIncrement");

  if (!policy || typeof policy !== "object") throw new Error("policy is required");
  const bufferMultiplier = nonNegativeNumber(policy.bufferMultiplier, "policy.bufferMultiplier");
  const policyVersion = Number(policy.policyVersion);
  if (!policy.policyId || !Number.isInteger(policyVersion) || policyVersion < 1) {
    throw new Error("policy must include policyId and integer policyVersion >= 1");
  }

  const rawVolatilityBuffer = atr * bufferMultiplier;
  const rawEffectiveStop = normalizedDirection === "LONG"
    ? structuralPrice - rawVolatilityBuffer
    : structuralPrice + rawVolatilityBuffer;

  const rounding = roundProtectively(rawEffectiveStop, {
    direction: normalizedDirection,
    priceIncrement: increment,
  });

  const effectiveStop = rounding.roundedPrice;
  const appliedBuffer = Math.abs(structuralPrice - effectiveStop);

  if (normalizedDirection === "LONG" && effectiveStop > rawEffectiveStop + 1e-12) {
    throw new Error("LONG protective rounding reduced stop protection");
  }
  if (normalizedDirection === "SHORT" && effectiveStop < rawEffectiveStop - 1e-12) {
    throw new Error("SHORT protective rounding reduced stop protection");
  }

  return {
    policyId: policy.policyId,
    policyVersion,
    direction: normalizedDirection,
    structuralInvalidationPrice: structuralPrice,
    atrValue: atr,
    bufferMultiplier,
    rawVolatilityBuffer,
    rawEffectiveStop,
    priceIncrement: increment,
    roundingDirection: rounding.roundingDirection,
    roundingAdjustment: rounding.roundingAdjustment,
    effectiveStop,
    appliedBuffer,
  };
}
