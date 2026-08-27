import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeDurations } from "../../analytics/execution-metrics.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NORMALIZED_PATH = path.join(HERE, "normalized-trades.json");
const RAW_PATH = path.join(HERE, "raw-schwab-history.json");
const EXPECTED_PATH = path.join(HERE, "expected-results.json");

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Required local file not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function round(value, digits = 3) {
  return value == null || !Number.isFinite(Number(value)) ? null : Number(Number(value).toFixed(digits));
}

function summaryRow(trades) {
  const s = summarizeDurations(trades);
  return {
    trades: s.completedTrades,
    winners: s.winners,
    losers: s.losers,
    flat: s.flat,
    medianWinnerMin: round(s.winner.medianMinutes),
    medianLoserMin: round(s.loser.medianMinutes),
    meanWinnerMin: round(s.winner.meanMinutes),
    meanLoserMin: round(s.loser.meanMinutes),
  };
}

function targetFrom(expected) {
  return {
    trades: expected.duration.completedTrades,
    winners: expected.duration.winners,
    losers: expected.duration.losers,
    flat: expected.duration.flat,
    medianWinnerMin: expected.duration.medianWinnerMinutes,
    medianLoserMin: expected.duration.medianLoserMinutes,
    meanWinnerMin: expected.duration.meanWinnerMinutes,
    meanLoserMin: expected.duration.meanLoserMinutes,
  };
}

function countDistance(row, target) {
  return Math.abs(row.trades - target.trades) +
    Math.abs(row.winners - target.winners) +
    Math.abs(row.losers - target.losers) +
    Math.abs(row.flat - target.flat);
}

const raw = readJson(RAW_PATH);
const normalized = readJson(NORMALIZED_PATH);
const expected = readJson(EXPECTED_PATH);
const trades = Array.isArray(normalized.trades) ? normalized.trades : [];
const target = targetFrom(expected);

const byDay = new Map();
for (const trade of trades) {
  const day = trade.tradingDay || String(trade.entryAt || "").slice(0, 10);
  if (!byDay.has(day)) byDay.set(day, []);
  byDay.get(day).push(trade);
}
const days = [...byDay.keys()].sort();

console.log("ExecutionOS historical window diagnostic");
console.log("================================================================================");
console.log(`Raw API window start: ${raw?.window?.start || "—"}`);
console.log(`Raw API window end:   ${raw?.window?.end || "—"}`);
console.log(`Trading days present: ${days.length}`);
console.log(`All reconstructed:    ${trades.length}`);
console.log(`Historical benchmark: ${target.trades} (${target.winners}/${target.losers}/${target.flat})`);

console.log("\nBY TRADING DAY");
console.log("================================================================================");
console.log("Day          Trades   W    L   F");
for (const day of days) {
  const s = summaryRow(byDay.get(day));
  console.log(`${day}  ${String(s.trades).padStart(6)}  ${String(s.winners).padStart(3)}  ${String(s.losers).padStart(3)}  ${String(s.flat).padStart(2)}`);
}

const candidates = [];
for (let i = 0; i < days.length; i += 1) {
  const subset = [];
  for (let j = i; j < days.length; j += 1) {
    subset.push(...byDay.get(days[j]));
    // Avoid tiny windows that happen to match ratios by accident.
    if (j - i + 1 < 5) continue;
    const row = summaryRow(subset);
    candidates.push({
      start: days[i],
      end: days[j],
      tradingDays: j - i + 1,
      ...row,
      countDistance: countDistance(row, target),
      tradeCountDifference: row.trades - target.trades,
    });
  }
}

candidates.sort((a, b) =>
  Math.abs(a.tradeCountDifference) - Math.abs(b.tradeCountDifference) ||
  a.countDistance - b.countDistance ||
  b.tradingDays - a.tradingDays,
);

console.log("\nCONTIGUOUS WINDOWS CLOSEST TO 384 COMPLETED EPISODES");
console.log("================================================================================");
for (const row of candidates.slice(0, 12)) {
  console.log(`${row.start} -> ${row.end}  days=${String(row.tradingDays).padStart(2)}  trades=${String(row.trades).padStart(3)}  W/L/F=${row.winners}/${row.losers}/${row.flat}  Δtrades=${row.tradeCountDifference >= 0 ? "+" : ""}${row.tradeCountDifference}`);
  console.log(`  med W/L ${row.medianWinnerMin ?? "—"}/${row.medianLoserMin ?? "—"} min | mean W/L ${row.meanWinnerMin ?? "—"}/${row.meanLoserMin ?? "—"} min`);
}

console.log("\nBENCHMARK DURATION TARGET");
console.log("================================================================================");
console.log(`Median W/L: ${target.medianWinnerMin} / ${target.medianLoserMin} min`);
console.log(`Mean W/L:   ${target.meanWinnerMin} / ${target.meanLoserMin} min`);
console.log("\nInterpretation: use candidate windows only as clues to recover the original statement period. Do not choose a window merely because it hits 384; the historical source period must remain defensible.");
