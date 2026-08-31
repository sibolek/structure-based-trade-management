import assert from "node:assert/strict";
import test from "node:test";
import {
  DSS_POLICY_ID,
  DSS_POLICY_V1,
  DSS_POLICY_VERSION,
  dssPolicyForVersion,
} from "../schwab-bridge/dss-policy.mjs";
import {
  calculateEffectiveStop,
  roundProtectively,
} from "../schwab-bridge/effective-stop.mjs";

test("DSS V1 policy locks the approved Phase 3 volatility parameters", () => {
  assert.equal(DSS_POLICY_ID, "EXECUTIONOS_DSS");
  assert.equal(DSS_POLICY_VERSION, 1);
  assert.equal(DSS_POLICY_V1.policyVersion, 1);
  assert.equal(DSS_POLICY_V1.volatilityMethod, "WILDER_RMA");
  assert.equal(DSS_POLICY_V1.volatilityPeriod, 14);
  assert.equal(DSS_POLICY_V1.volatilityTimeframe, "2m");
  assert.equal(DSS_POLICY_V1.bufferMultiplier, 0.30);
  assert.equal(DSS_POLICY_V1.quoteMaxAgeMs, 5_000);
  assert.equal(DSS_POLICY_V1.completedBarPublicationGraceMs, 10_000);
  assert.equal(DSS_POLICY_V1.atrReconstructionCompletedRthSessions, 20);
  assert.equal(Object.isFrozen(DSS_POLICY_V1), true);
});

test("DSS policy lookup rejects unsupported versions", () => {
  assert.equal(dssPolicyForVersion(1), DSS_POLICY_V1);
  assert.throws(() => dssPolicyForVersion(2), /unsupported DSS policy version/);
});

test("LONG effective stop subtracts 0.30 ATR buffer and rounds down protectively", () => {
  const result = calculateEffectiveStop({
    direction: "LONG",
    structuralInvalidationPrice: 100,
    atrValue: 0.55,
    priceIncrement: 0.01,
  });

  assert.ok(Math.abs(result.rawVolatilityBuffer - 0.165) < 1e-12);
  assert.ok(Math.abs(result.rawEffectiveStop - 99.835) < 1e-12);
  assert.equal(result.roundingDirection, "DOWN");
  assert.equal(result.effectiveStop, 99.83);
  assert.ok(result.roundingAdjustment <= 0);
  assert.ok(result.effectiveStop <= result.rawEffectiveStop);
  assert.ok(Math.abs(result.appliedBuffer - 0.17) < 1e-12);
});

test("SHORT effective stop adds 0.30 ATR buffer and rounds up protectively", () => {
  const result = calculateEffectiveStop({
    direction: "SHORT",
    structuralInvalidationPrice: 100,
    atrValue: 0.55,
    priceIncrement: 0.01,
  });

  assert.ok(Math.abs(result.rawVolatilityBuffer - 0.165) < 1e-12);
  assert.ok(Math.abs(result.rawEffectiveStop - 100.165) < 1e-12);
  assert.equal(result.roundingDirection, "UP");
  assert.equal(result.effectiveStop, 100.17);
  assert.ok(result.roundingAdjustment >= 0);
  assert.ok(result.effectiveStop >= result.rawEffectiveStop);
  assert.ok(Math.abs(result.appliedBuffer - 0.17) < 1e-12);
});

test("protective rounding supports non-penny price increments", () => {
  const long = calculateEffectiveStop({
    direction: "LONG",
    structuralInvalidationPrice: 100.30,
    atrValue: 0.40,
    priceIncrement: 0.05,
  });
  const short = calculateEffectiveStop({
    direction: "SHORT",
    structuralInvalidationPrice: 100.30,
    atrValue: 0.40,
    priceIncrement: 0.05,
  });

  assert.ok(Math.abs(long.rawEffectiveStop - 100.18) < 1e-12);
  assert.equal(long.effectiveStop, 100.15);
  assert.ok(Math.abs(short.rawEffectiveStop - 100.42) < 1e-12);
  assert.equal(short.effectiveStop, 100.45);
});

test("price already on a valid increment is not moved by rounding", () => {
  const long = roundProtectively(99.82, { direction: "LONG", priceIncrement: 0.01 });
  const short = roundProtectively(100.18, { direction: "SHORT", priceIncrement: 0.01 });

  assert.equal(long.roundedPrice, 99.82);
  assert.ok(Math.abs(long.roundingAdjustment) < 1e-12);
  assert.equal(short.roundedPrice, 100.18);
  assert.ok(Math.abs(short.roundingAdjustment) < 1e-12);
});

test("candidate-like bufferMultiplier input cannot override trusted DSS policy", () => {
  const result = calculateEffectiveStop({
    direction: "LONG",
    structuralInvalidationPrice: 100,
    atrValue: 1,
    priceIncrement: 0.01,
    bufferMultiplier: 99,
  });

  assert.equal(result.bufferMultiplier, 0.30);
  assert.ok(Math.abs(result.rawVolatilityBuffer - 0.30) < 1e-12);
  assert.equal(result.effectiveStop, 99.70);
});

test("DSS applies no arbitrary minimum or maximum volatility clamps", () => {
  const tiny = calculateEffectiveStop({
    direction: "LONG",
    structuralInvalidationPrice: 10,
    atrValue: 0.0001,
    priceIncrement: 0.0001,
  });
  const large = calculateEffectiveStop({
    direction: "SHORT",
    structuralInvalidationPrice: 10,
    atrValue: 20,
    priceIncrement: 0.01,
  });

  assert.ok(Math.abs(tiny.rawVolatilityBuffer - 0.00003) < 1e-12);
  assert.equal(tiny.effectiveStop, 9.9999);
  assert.equal(large.rawVolatilityBuffer, 6);
  assert.equal(large.effectiveStop, 16);
});

test("effective-stop calculation fails closed on invalid direction or numeric inputs", () => {
  assert.throws(() => calculateEffectiveStop({
    direction: "SIDEWAYS",
    structuralInvalidationPrice: 100,
    atrValue: 1,
    priceIncrement: 0.01,
  }), /direction must be LONG or SHORT/);

  assert.throws(() => calculateEffectiveStop({
    direction: "LONG",
    structuralInvalidationPrice: "not-a-number",
    atrValue: 1,
    priceIncrement: 0.01,
  }), /structuralInvalidationPrice must be a finite number/);

  assert.throws(() => calculateEffectiveStop({
    direction: "LONG",
    structuralInvalidationPrice: 100,
    atrValue: -1,
    priceIncrement: 0.01,
  }), /atrValue must be >= 0/);

  assert.throws(() => calculateEffectiveStop({
    direction: "LONG",
    structuralInvalidationPrice: 100,
    atrValue: 1,
    priceIncrement: 0,
  }), /priceIncrement must be > 0/);
});

test("effective-stop result preserves policy and rounding provenance", () => {
  const result = calculateEffectiveStop({
    direction: "SHORT",
    structuralInvalidationPrice: 50,
    atrValue: 0.2,
    priceIncrement: 0.01,
  });

  assert.equal(result.policyId, DSS_POLICY_V1.policyId);
  assert.equal(result.policyVersion, DSS_POLICY_V1.policyVersion);
  assert.equal(result.direction, "SHORT");
  assert.equal(result.structuralInvalidationPrice, 50);
  assert.equal(result.atrValue, 0.2);
  assert.equal(result.priceIncrement, 0.01);
  assert.equal(result.roundingDirection, "UP");
  assert.equal(typeof result.roundingAdjustment, "number");
  assert.equal(typeof result.rawEffectiveStop, "number");
  assert.equal(typeof result.effectiveStop, "number");
});
