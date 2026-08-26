import test from "node:test";
import assert from "node:assert/strict";
import {
  captureEfficiency,
  computeLegacyWindowExcursions,
  computeScalingAwareExcursions,
  counterfactualPnlAtDuration,
  firstProtectiveStopMove,
  initialRiskDollars,
  realizedR,
  summarizeDurations,
  summarizeHistoricalStopActions,
  summarizeRMultiples,
  summarizeStopMovements,
} from "../analytics/index.mjs";

const base = "2026-08-26T14:00:00.000Z";
const plus = (seconds) => new Date(Date.parse(base) + seconds * 1000).toISOString();

test("winner/loser duration summary is deterministic", () => {
  const trades = [
    { entryAt: base, exitAt: plus(60), realizedPnl: 10 },
    { entryAt: base, exitAt: plus(120), realizedPnl: 20 },
    { entryAt: base, exitAt: plus(300), realizedPnl: -10 },
    { entryAt: base, exitAt: plus(0), realizedPnl: 0 },
  ];
  const result = summarizeDurations(trades);
  assert.equal(result.completedTrades, 4);
  assert.equal(result.winners, 2);
  assert.equal(result.losers, 1);
  assert.equal(result.flat, 1);
  assert.equal(result.winner.medianSeconds, 90);
  assert.equal(result.loser.medianSeconds, 300);
});

test("stop analysis distinguishes tightening from reaching breakeven/profit", () => {
  const trade = {
    direction: "LONG",
    entryAt: base,
    entryPrice: 100,
    realizedPnl: 12,
    managementEvents: [
      { type: "STOP_CHANGED", timestamp: plus(30), previousStop: 99, newStop: 99.5 },
      { type: "STOP_CHANGED", timestamp: plus(90), previousStop: 99.5, newStop: 100 },
    ],
  };
  assert.equal(firstProtectiveStopMove(trade, { mode: "TIGHTENING" }).entryAgeSec, 30);
  assert.equal(firstProtectiveStopMove(trade).entryAgeSec, 90);
  const result = summarizeStopMovements([trade]);
  assert.equal(result.winnersWithProtectiveMove, 1);
  assert.equal(result.winnersMovedWithin60Sec, 0);
  assert.equal(result.winnersMovedWithin120Sec, 1);
});

test("historical stop actions are summarized independently of STOP_CHANGED production events", () => {
  const trades = [
    {
      direction: "LONG",
      entryAt: base,
      entryPrice: 100,
      realizedPnl: 10,
      historicalManagementEvents: [
        { type: "STOP_ORDER_ACTION", timestamp: plus(45), newStop: 100, classification: "BE_OR_PROFIT", status: "REJECTED" },
      ],
      managementEvents: [],
    },
    {
      direction: "SHORT",
      entryAt: base,
      entryPrice: 50,
      realizedPnl: -5,
      historicalManagementEvents: [
        { type: "STOP_ORDER_ACTION", timestamp: plus(90), newStop: 49.9, classification: "BE_OR_PROFIT", status: "REPLACED" },
      ],
      managementEvents: [],
    },
  ];
  const historical = summarizeHistoricalStopActions(trades);
  assert.equal(historical.winnersWithProtectiveMove, 1);
  assert.equal(historical.losersWithProtectiveMove, 1);
  assert.equal(historical.medianWinnerMoveSec, 45);
  assert.equal(historical.winnersMovedWithin60Sec, 1);
  const production = summarizeStopMovements(trades);
  assert.equal(production.winnersWithProtectiveMove, 0);
  assert.equal(production.losersWithProtectiveMove, 0);
});

test("initial risk and realized R use structural stop and original size", () => {
  const winner = { entryPrice: 100, initialStop: 98, initialQuantity: 50, realizedPnl: 50 };
  const loser = { entryPrice: 100, initialStop: 98, initialQuantity: 50, realizedPnl: -100 };
  assert.equal(initialRiskDollars(winner), 100);
  assert.equal(realizedR(winner), 0.5);
  const summary = summarizeRMultiples([winner, loser]);
  assert.equal(summary.tradesWithInitialRisk, 2);
  assert.equal(summary.winner.medianR, 0.5);
  assert.equal(summary.loser.medianR, -1);
});

test("legacy MFE/MAE uses favorable/adverse prices by direction", () => {
  const trade = { direction: "LONG", entryAt: base, entryPrice: 100, initialQuantity: 10 };
  const samples = [
    { timestamp: plus(60), high: 102, low: 99.5, last: 101 },
    { timestamp: plus(120), high: 103, low: 100.5, last: 102 },
  ];
  const result = computeLegacyWindowExcursions(trade, samples, [300]);
  assert.equal(result[300].mfeDollars, 30);
  assert.equal(result[300].maeDollars, -5);
});

test("scaling-aware MFE/MAE uses realized plus unrealized value", () => {
  const trade = { initialRisk: 100 };
  const result = computeScalingAwareExcursions(trade, [
    { realizedPnl: 0, unrealizedPnl: -20 },
    { realizedPnl: 10, unrealizedPnl: 40 },
    { realizedPnl: 30, unrealizedPnl: 5 },
  ]);
  assert.equal(result.mfeDollars, 50);
  assert.equal(result.maeDollars, -20);
  assert.equal(result.mfeR, 0.5);
  assert.equal(result.maeR, -0.2);
});

test("capture efficiency is realized divided by favorable excursion", () => {
  assert.equal(captureEfficiency(25, 100), 0.25);
  assert.equal(captureEfficiency(25, 0), null);
});

test("fixed-duration counterfactual selects first sample at or after target", () => {
  const trade = { direction: "LONG", entryAt: base, entryPrice: 100, initialQuantity: 10 };
  const samples = [
    { timestamp: plus(50), last: 101 },
    { timestamp: plus(65), last: 102 },
  ];
  assert.equal(counterfactualPnlAtDuration(trade, samples, 60), 20);
});
