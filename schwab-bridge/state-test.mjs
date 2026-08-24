import assert from "node:assert/strict";
import { applyExecution, createSymbolState } from "./trade-state.mjs";

const EPSILON = 1e-9;

function closeTo(actual, expected, message) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= EPSILON, `${message}: expected ${expected}, got ${actual}`);
}

function runCase({ name, initial = {}, fill, expected }) {
  const state = createSymbolState("TEST", initial);
  const result = applyExecution(state, fill);

  assert.equal(result.event, expected.event, `${name}: event`);
  assert.equal(result.previousQuantity, expected.previousQuantity, `${name}: previous quantity`);
  assert.equal(result.nextQuantity, expected.nextQuantity, `${name}: next quantity`);
  assert.equal(result.previousSide, expected.previousSide, `${name}: previous side`);
  assert.equal(result.nextSide, expected.nextSide, `${name}: next side`);

  if (expected.averagePrice != null) closeTo(result.state.averagePrice, expected.averagePrice, `${name}: average price`);
  if (expected.realizedGrossPnl != null) closeTo(result.realizedGrossPnl, expected.realizedGrossPnl, `${name}: realized P/L`);
  if (expected.completedTrades != null) assert.equal(result.state.completedTrades, expected.completedTrades, `${name}: completed trades`);

  console.log(`PASS  ${name}`);
}

const cases = [
  {
    name: "flat -> long entry",
    fill: { instruction: "BUY", quantity: 25, price: 10 },
    expected: { event: "ENTRY", previousQuantity: 0, nextQuantity: 25, previousSide: "FLAT", nextSide: "LONG", averagePrice: 10, realizedGrossPnl: 0, completedTrades: 0 },
  },
  {
    name: "existing long -> add",
    initial: { quantity: 20, averagePrice: 10 },
    fill: { instruction: "BUY", quantity: 10, price: 13 },
    expected: { event: "ADD", previousQuantity: 20, nextQuantity: 30, previousSide: "LONG", nextSide: "LONG", averagePrice: 11, realizedGrossPnl: 0, completedTrades: 0 },
  },
  {
    name: "existing long -> partial",
    initial: { quantity: 20, averagePrice: 10 },
    fill: { instruction: "SELL", quantity: 10, price: 12 },
    expected: { event: "PARTIAL", previousQuantity: 20, nextQuantity: 10, previousSide: "LONG", nextSide: "LONG", averagePrice: 10, realizedGrossPnl: 20, completedTrades: 0 },
  },
  {
    name: "existing long -> flat",
    initial: { quantity: 20, averagePrice: 10 },
    fill: { instruction: "SELL", quantity: 20, price: 12 },
    expected: { event: "FLAT", previousQuantity: 20, nextQuantity: 0, previousSide: "LONG", nextSide: "FLAT", averagePrice: 0, realizedGrossPnl: 40, completedTrades: 1 },
  },
  {
    name: "existing long -> short reversal",
    initial: { quantity: 20, averagePrice: 10 },
    fill: { instruction: "SELL", quantity: 30, price: 9 },
    expected: { event: "REVERSAL", previousQuantity: 20, nextQuantity: -10, previousSide: "LONG", nextSide: "SHORT", averagePrice: 9, realizedGrossPnl: -20, completedTrades: 1 },
  },
  {
    name: "flat -> short entry",
    fill: { instruction: "SELL_SHORT", quantity: 50, price: 20 },
    expected: { event: "ENTRY", previousQuantity: 0, nextQuantity: -50, previousSide: "FLAT", nextSide: "SHORT", averagePrice: 20, realizedGrossPnl: 0, completedTrades: 0 },
  },
  {
    name: "existing short -> add",
    initial: { quantity: -50, averagePrice: 20 },
    fill: { instruction: "SELL_SHORT", quantity: 50, price: 18 },
    expected: { event: "ADD", previousQuantity: -50, nextQuantity: -100, previousSide: "SHORT", nextSide: "SHORT", averagePrice: 19, realizedGrossPnl: 0, completedTrades: 0 },
  },
  {
    name: "existing short -> partial cover",
    initial: { quantity: -100, averagePrice: 20 },
    fill: { instruction: "BUY_TO_COVER", quantity: 25, price: 18 },
    expected: { event: "PARTIAL", previousQuantity: -100, nextQuantity: -75, previousSide: "SHORT", nextSide: "SHORT", averagePrice: 20, realizedGrossPnl: 50, completedTrades: 0 },
  },
  {
    name: "existing short -> flat",
    initial: { quantity: -100, averagePrice: 20 },
    fill: { instruction: "BUY_TO_COVER", quantity: 100, price: 18 },
    expected: { event: "FLAT", previousQuantity: -100, nextQuantity: 0, previousSide: "SHORT", nextSide: "FLAT", averagePrice: 0, realizedGrossPnl: 200, completedTrades: 1 },
  },
  {
    name: "existing short -> long reversal",
    initial: { quantity: -100, averagePrice: 20 },
    fill: { instruction: "BUY_TO_COVER", quantity: 125, price: 21 },
    expected: { event: "REVERSAL", previousQuantity: -100, nextQuantity: 25, previousSide: "SHORT", nextSide: "LONG", averagePrice: 21, realizedGrossPnl: -100, completedTrades: 1 },
  },
];

console.log("\nEXECUTIONOS DETERMINISTIC TRADE-STATE TEST\n");
for (const testCase of cases) runCase(testCase);
console.log(`\nPASS ✓ ${cases.length}/${cases.length} deterministic trade-state cases passed.\n`);
