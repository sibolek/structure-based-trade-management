import test from "node:test";
import assert from "node:assert/strict";
import { reconstructSameDayEpisodes } from "../analytics/trade-episodes.mjs";

function fill(overrides = {}) {
  return {
    accountKey: "A1",
    symbol: "NVDA",
    assetType: "EQUITY",
    instruction: "BUY",
    positionEffect: "OPENING",
    quantity: 10,
    price: 100,
    time: "2026-08-20T13:30:00.000Z",
    orderId: "1",
    ...overrides,
  };
}

test("fragmented entry and partial exits reconstruct one flat-to-flat episode", () => {
  const rows = [
    fill({ quantity: 40, price: 100, orderId: "entry" }),
    fill({ quantity: 60, price: 100.1, orderId: "entry", time: "2026-08-20T13:30:00.100Z" }),
    fill({ instruction: "SELL", positionEffect: "CLOSING", quantity: 50, price: 101, orderId: "exit1", time: "2026-08-20T13:31:00.000Z" }),
    fill({ instruction: "SELL", positionEffect: "CLOSING", quantity: 50, price: 102, orderId: "exit2", time: "2026-08-20T13:32:00.000Z" }),
  ];
  const result = reconstructSameDayEpisodes(rows);
  assert.equal(result.trades.length, 1);
  const trade = result.trades[0];
  assert.equal(trade.initialQuantity, 100);
  assert.ok(Math.abs(trade.entryPrice - 100.06) < 1e-9);
  assert.ok(Math.abs(trade.realizedPnl - 144) < 1e-9);
  assert.equal(trade.peakQuantity, 100);
});

test("a closing fill with no same-day opening position is treated as carry-in and ignored", () => {
  const rows = [
    fill({ instruction: "SELL", positionEffect: "CLOSING", quantity: 20, price: 99, orderId: "overnight-close", time: "2026-08-20T13:29:00.000Z" }),
    fill({ instruction: "BUY", positionEffect: "OPENING", quantity: 10, price: 100, orderId: "entry", time: "2026-08-20T13:30:00.000Z" }),
    fill({ instruction: "SELL", positionEffect: "CLOSING", quantity: 10, price: 101, orderId: "exit", time: "2026-08-20T13:31:00.000Z" }),
  ];
  const result = reconstructSameDayEpisodes(rows);
  assert.equal(result.diagnostics.carryInClosuresIgnored, 1);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].realizedPnl, 10);
});

test("same-timestamp closing is processed before a new opposite-side opening", () => {
  const time = "2026-08-20T13:31:00.000Z";
  const rows = [
    fill({ instruction: "BUY", positionEffect: "OPENING", quantity: 10, price: 100, orderId: "long-entry", time: "2026-08-20T13:30:00.000Z" }),
    fill({ instruction: "SELL_SHORT", positionEffect: "OPENING", quantity: 10, price: 101, orderId: "short-entry", time }),
    fill({ instruction: "SELL", positionEffect: "CLOSING", quantity: 10, price: 101, orderId: "long-exit", time }),
    fill({ instruction: "BUY_TO_COVER", positionEffect: "CLOSING", quantity: 10, price: 99, orderId: "short-exit", time: "2026-08-20T13:32:00.000Z" }),
  ];
  const result = reconstructSameDayEpisodes(rows);
  assert.equal(result.trades.length, 2);
  assert.equal(result.trades[0].direction, "LONG");
  assert.equal(result.trades[0].realizedPnl, 10);
  assert.equal(result.trades[1].direction, "SHORT");
  assert.equal(result.trades[1].realizedPnl, 20);
});

test("option executions are excluded from the equity episode study", () => {
  const rows = [
    fill({ symbol: "NVDA  260820C00200000", assetType: "OPTION", orderId: "o1" }),
    fill({ symbol: "NVDA  260820C00200000", assetType: "OPTION", instruction: "SELL_TO_CLOSE", positionEffect: "CLOSING", orderId: "o2", time: "2026-08-20T13:31:00.000Z" }),
  ];
  const result = reconstructSameDayEpisodes(rows);
  assert.equal(result.trades.length, 0);
  assert.equal(result.diagnostics.eligibleExecutionLegs, 0);
});
