import test from "node:test";
import assert from "node:assert/strict";
import {
  enrichWithExecutionOs,
  localDateKey,
  reconstructDailyTrades,
  summarizeReport,
} from "../schwab-bridge/eod-report-core.mjs";

const t = (minute) => `2026-08-27T15:${String(minute).padStart(2, "0")}:00.000Z`;
const date = localDateKey(t(0));

function row({ time, symbol = "NVDA", instruction, effect, quantity, price, accountKey = "A1", orderId }) {
  return {
    accountKey,
    orderId: orderId || `${symbol}-${time}`,
    symbol,
    instruction,
    positionEffect: effect,
    quantity,
    price,
    time,
  };
}

test("reconstructs scaled long with partial exit and realized gross P/L", () => {
  const rows = [
    row({ time: t(0), instruction: "BUY", effect: "OPENING", quantity: 10, price: 100 }),
    row({ time: t(1), instruction: "BUY", effect: "OPENING", quantity: 10, price: 102 }),
    row({ time: t(2), instruction: "SELL", effect: "CLOSING", quantity: 5, price: 103 }),
    row({ time: t(3), instruction: "SELL", effect: "CLOSING", quantity: 15, price: 104 }),
  ];

  const out = reconstructDailyTrades(rows, { date });
  assert.equal(out.completedTrades.length, 1);
  const trade = out.completedTrades[0];
  assert.equal(trade.direction, "LONG");
  assert.equal(trade.peakQuantity, 20);
  assert.equal(trade.entryVwap, 101);
  assert.equal(trade.exitVwap, 103.75);
  assert.equal(trade.grossPnl, 55);
  assert.equal(trade.adds, 1);
  assert.equal(trade.partialExits, 1);
});

test("reconstructs short cycle", () => {
  const rows = [
    row({ time: t(4), symbol: "AMD", instruction: "SELL_SHORT", effect: "OPENING", quantity: 10, price: 50 }),
    row({ time: t(5), symbol: "AMD", instruction: "BUY_TO_COVER", effect: "CLOSING", quantity: 10, price: 48 }),
  ];

  const out = reconstructDailyTrades(rows, { date });
  assert.equal(out.completedTrades[0].direction, "SHORT");
  assert.equal(out.completedTrades[0].grossPnl, 20);
});

test("flags closing-first activity instead of inventing P/L", () => {
  const rows = [
    row({ time: t(6), symbol: "AS", instruction: "SELL", effect: "CLOSING", quantity: 5, price: 35 }),
    row({ time: t(7), symbol: "AS", instruction: "BUY", effect: "OPENING", quantity: 5, price: 34 }),
    row({ time: t(8), symbol: "AS", instruction: "SELL", effect: "CLOSING", quantity: 5, price: 35 }),
  ];

  const out = reconstructDailyTrades(rows, { date });
  assert.equal(out.incompleteActivity.length, 1);
  assert.equal(out.completedTrades.length, 1);
  assert.equal(out.completedTrades[0].grossPnl, 5);
});

test("calculates average winner / average loser factor separately from gross profit factor", () => {
  const summary = summarizeReport({
    completedTrades: [
      { grossPnl: 10, executionOs: null },
      { grossPnl: 20, executionOs: null },
      { grossPnl: -5, executionOs: null },
    ],
    openTrades: [],
    incompleteActivity: [],
    executionExportLoaded: false,
  });

  assert.equal(summary.averageWinner, 15);
  assert.equal(summary.averageLoser, -5);
  assert.equal(summary.profitFactor, 6);
  assert.equal(summary.averageWinLossFactor, 3);
});

test("joins ExecutionOS history and calculates planned risk, R and process stats", () => {
  const rows = [
    row({ time: t(10), instruction: "BUY", effect: "OPENING", quantity: 10, price: 100 }),
    row({ time: t(11), instruction: "SELL", effect: "CLOSING", quantity: 10, price: 102 }),
  ];
  const reconstructed = reconstructDailyTrades(rows, { date });
  const payload = {
    history: [{
      id: "x",
      completedAt: t(12),
      originalPlan: {
        symbol: "NVDA",
        direction: "LONG",
        setup: "H2",
        timeframe: "2m",
        structuralStop: "99",
        thesis: "t",
        trigger: "tr",
        invalidation: "inv",
        target: "103",
        management: "hold",
      },
      risk: { expectedEntry: "100", intendedSize: "10" },
      broker: { entryDetectedAt: t(10) },
      exit: { classification: "STRUCTURAL / PLANNED", reason: "Planned target" },
      decisions: [{ state: "THREATENED" }, { state: "VALID" }, { state: "INVALID" }],
    }],
  };

  const enriched = enrichWithExecutionOs(reconstructed.completedTrades, payload, { date });
  assert.equal(enriched.matched, 1);
  assert.equal(enriched.trades[0].executionOs.plannedRisk, 10);
  assert.equal(enriched.trades[0].executionOs.actualEntryRisk, 10);
  assert.equal(enriched.trades[0].executionOs.rMultiple, 2);
  assert.deepEqual(enriched.trades[0].executionOs.stateStats, { threatened: 1, invalid: 1, validAfterThreat: 1 });

  const summary = summarizeReport({
    completedTrades: enriched.trades,
    openTrades: [],
    incompleteActivity: [],
    executionExportLoaded: true,
  });
  assert.equal(summary.totalR, 2);
  assert.equal(summary.executionOwnedTrades, 1);
});
