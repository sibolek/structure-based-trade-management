import test from "node:test";
import assert from "node:assert/strict";

import { calculateRiskSizing } from "../schwab-bridge/risk-sizing-calculator.mjs";

const equity = (overrides = {}) => ({
  assetType: "EQUITY",
  currency: "USD",
  minimumQuantity: 1,
  quantityIncrement: 1,
  ...overrides,
});

const mes = (overrides = {}) => ({
  assetType: "FUTURE",
  currency: "USD",
  minimumQuantity: 1,
  quantityIncrement: 1,
  tickSize: 0.25,
  tickValue: 1.25,
  pointValue: 5,
  ...overrides,
});

function run(overrides = {}) {
  return calculateRiskSizing({
    direction: "LONG",
    currentExpectedEntry: 220,
    effectiveStop: 219.25,
    accountEquity: 13500,
    accountCurrency: "USD",
    instrument: equity(),
    ...overrides,
  });
}

test("sizes an equity LONG from the effective stop", () => {
  const result = run();
  assert.equal(result.policyId, "V24_EFFECTIVE_STOP_RISK_SIZING");
  assert.equal(result.policyVersion, 1);
  assert.equal(result.status, "VALID");
  assert.equal(result.riskPerUnit, 0.75);
  assert.equal(result.maxDollarRisk, 67.5);
  assert.equal(result.rawQuantity, 90);
  assert.equal(result.finalQuantity, 90);
  assert.equal(result.plannedDollarRisk, 67.5);
  assert.equal(result.plannedRiskFraction, 0.005);
});

test("sizes an equity SHORT with direction-aware risk geometry", () => {
  const result = run({
    direction: "SHORT",
    currentExpectedEntry: 219.25,
    effectiveStop: 220,
  });
  assert.equal(result.status, "VALID");
  assert.equal(result.riskDistance, 0.75);
  assert.equal(result.finalQuantity, 90);
});

test("blocks LONG geometry after price has crossed below the effective stop", () => {
  const result = run({ currentExpectedEntry: 219, effectiveStop: 220 });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["INVALID_ENTRY_STOP_GEOMETRY"]);
});

test("blocks SHORT geometry after price has crossed above the effective stop", () => {
  const result = run({ direction: "SHORT", currentExpectedEntry: 221, effectiveStop: 220 });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["INVALID_ENTRY_STOP_GEOMETRY"]);
});

test("floors the 0.5% risk budget to the nearest cent", () => {
  const result = run({ accountEquity: 13537.37 });
  assert.equal(result.rawMaxDollarRisk, 67.68685);
  assert.equal(result.maxDollarRisk, 67.68);
  assert.equal(result.budgetRoundingRule, "FLOOR_TO_CENT");
});

test("allows equity notional to exceed account equity when stop risk fits", () => {
  const result = run({
    currentExpectedEntry: 200,
    effectiveStop: 199.5,
    accountEquity: 13500,
  });
  assert.equal(result.status, "VALID");
  assert.equal(result.finalQuantity, 135);
  assert.ok(result.finalQuantity * 200 > 13500);
  assert.equal(result.plannedDollarRisk, 67.5);
});

test("floors equity quantity and permits odd lots", () => {
  const result = run({
    accountEquity: 10000,
    currentExpectedEntry: 100,
    effectiveStop: 98.68,
  });
  assert.equal(result.status, "VALID");
  assert.equal(result.rawQuantity, 37.878787878787875);
  assert.equal(result.finalQuantity, 37);
  assert.equal(result.quantityRoundingRule, "FLOOR_TO_VALID_INCREMENT");
  assert.ok(result.plannedDollarRisk <= result.maxDollarRisk);
});

test("returns NO_AFFORDABLE_SIZE when one share cannot fit", () => {
  const result = run({
    accountEquity: 10000,
    currentExpectedEntry: 100,
    effectiveStop: 40,
  });
  assert.equal(result.status, "NO_AFFORDABLE_SIZE");
  assert.deepEqual(result.reasonCodes, ["MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET"]);
  assert.equal(result.finalQuantity, 0);
});

test("sizes MES using explicit tick size and tick value", () => {
  const result = run({
    currentExpectedEntry: 7800,
    effectiveStop: 7796,
    accountEquity: 13500,
    instrument: mes(),
  });
  assert.equal(result.status, "VALID");
  assert.equal(result.riskTicks, 16);
  assert.equal(result.riskPerUnit, 20);
  assert.equal(result.rawQuantity, 3.375);
  assert.equal(result.finalQuantity, 3);
  assert.equal(result.plannedDollarRisk, 60);
});

test("rounds futures risk ticks protectively upward", () => {
  const result = run({
    currentExpectedEntry: 7800,
    effectiveStop: 7795.99,
    accountEquity: 13500,
    instrument: mes(),
  });
  assert.equal(result.status, "VALID");
  assert.equal(result.riskTicks, 17);
  assert.equal(result.riskPerUnit, 21.25);
});

test("returns NO_AFFORDABLE_SIZE when one futures contract exceeds budget", () => {
  const result = run({
    currentExpectedEntry: 7800,
    effectiveStop: 7783.5,
    accountEquity: 13500,
    instrument: mes(),
  });
  assert.equal(result.riskTicks, 66);
  assert.equal(result.riskPerUnit, 82.5);
  assert.equal(result.status, "NO_AFFORDABLE_SIZE");
});

test("blocks inconsistent futures metadata", () => {
  const result = run({
    currentExpectedEntry: 7800,
    effectiveStop: 7796,
    instrument: mes({ tickValue: 2.5 }),
  });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["INSTRUMENT_METADATA_INCONSISTENT"]);
});

test("blocks invalid futures metadata", () => {
  const result = run({
    currentExpectedEntry: 7800,
    effectiveStop: 7796,
    instrument: mes({ tickSize: 0 }),
  });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["INSTRUMENT_METADATA_INVALID"]);
});

test("blocks unsupported asset types", () => {
  const result = run({ instrument: equity({ assetType: "OPTION" }) });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["UNSUPPORTED_ASSET_TYPE"]);
});

test("blocks currency conversion", () => {
  const result = run({ instrument: equity({ currency: "CAD" }) });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["CURRENCY_CONVERSION_UNSUPPORTED"]);
});

test("blocks invalid quantity metadata", () => {
  const result = run({ instrument: equity({ minimumQuantity: 1, quantityIncrement: 2 }) });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["INVALID_QUANTITY_METADATA"]);
});

test("blocks invalid account equity", () => {
  const result = run({ accountEquity: 0 });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["ACCOUNT_EQUITY_INVALID"]);
});

test("preserves exact integer quantity boundaries without binary floating-point under-sizing", () => {
  const result = run({
    accountEquity: "2000",
    currentExpectedEntry: "100.30",
    effectiveStop: "99.30",
  });
  assert.equal(result.maxDollarRisk, 10);
  assert.equal(result.rawQuantity, 10);
  assert.equal(result.finalQuantity, 10);
  assert.equal(result.plannedDollarRisk, 10);
  assert.equal(result.plannedRiskFraction, 0.005);
});

test("supports valid non-unit quantity increments without rounding upward", () => {
  const result = run({
    accountEquity: 10000,
    currentExpectedEntry: 100,
    effectiveStop: 99,
    instrument: equity({ minimumQuantity: 1, quantityIncrement: 0.5 }),
  });
  assert.equal(result.status, "VALID");
  assert.equal(result.rawQuantity, 50);
  assert.equal(result.finalQuantity, 50);
});
