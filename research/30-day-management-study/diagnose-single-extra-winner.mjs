import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { durationSeconds, outcomeFor, summarizeDurations } from "../../analytics/execution-metrics.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.join(HERE, "normalized-trades.json");
const START_DAY = "2026-07-22";
const END_DAY = "2026-08-21";
const TARGET = {
  completedTrades: 384,
  winners: 265,
  losers: 118,
  flat: 1,
  medianWinnerMinutes: 1.35,
  meanWinnerMinutes: 5.04,
  medianLoserMinutes: 3.49,
  meanLoserMinutes: 14.03,
};

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Input file not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function inWindow(trade) {
  return trade?.tradingDay >= START_DAY && trade?.tradingDay <= END_DAY;
}

function fmt(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
}

function easternClock(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function sessionFor(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "UNKNOWN";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = Number(map.hour) * 60 + Number(map.minute);
  if (minutes < 570) return "PRE";
  if (minutes >= 960) return "POST";
  return "RTH";
}

function durationError(summary) {
  const wm = summary?.winner?.meanMinutes;
  const wmed = summary?.winner?.medianMinutes;
  if (![wm, wmed].every(Number.isFinite)) return Infinity;
  // Normalize by the target values so mean and median contribute comparably.
  return Math.abs(wm - TARGET.meanWinnerMinutes) / TARGET.meanWinnerMinutes
    + Math.abs(wmed - TARGET.medianWinnerMinutes) / TARGET.medianWinnerMinutes;
}

function fingerprint(trade) {
  return [
    trade.symbol,
    trade.direction,
    trade.entryAt,
    trade.exitAt,
    trade.initialQuantity,
    trade.entryVWAP,
    trade.exitVWAP,
  ].join("|");
}

const dataset = readJson(INPUT);
const trades = (dataset.trades || []).filter(inWindow);
const base = summarizeDurations(trades);
const winners = trades.filter((trade) => outcomeFor(trade) === "WIN");

const fingerprintCounts = new Map();
for (const trade of trades) {
  const key = fingerprint(trade);
  fingerprintCounts.set(key, (fingerprintCounts.get(key) || 0) + 1);
}

const initialOrderCounts = new Map();
for (const trade of trades) {
  const key = String(trade.initialOrderId || "");
  if (!key) continue;
  initialOrderCounts.set(key, (initialOrderCounts.get(key) || 0) + 1);
}

const candidates = winners.map((candidate) => {
  const remaining = trades.filter((trade) => trade.id !== candidate.id);
  const summary = summarizeDurations(remaining);
  const durationMin = durationSeconds(candidate) / 60;
  return {
    trade: candidate,
    summary,
    score: durationError(summary),
    durationMin,
    duplicateFingerprint: (fingerprintCounts.get(fingerprint(candidate)) || 0) > 1,
    sharedInitialOrderId: candidate.initialOrderId
      ? (initialOrderCounts.get(String(candidate.initialOrderId)) || 0) > 1
      : false,
  };
}).sort((a, b) => a.score - b.score || Math.abs(a.durationMin - 2.9) - Math.abs(b.durationMin - 2.9));

console.log("ExecutionOS single-extra-winner diagnostic");
console.log("================================================================================");
console.log(`Window:              ${START_DAY} -> ${END_DAY}`);
console.log(`Current W/L/F:       ${base.winners}/${base.losers}/${base.flat} (${base.completedTrades} trades)`);
console.log(`Historical W/L/F:    ${TARGET.winners}/${TARGET.losers}/${TARGET.flat} (${TARGET.completedTrades} trades)`);
console.log(`Current winner med:  ${fmt(base.winner.medianMinutes)} min`);
console.log(`Target winner med:   ${fmt(TARGET.medianWinnerMinutes)} min`);
console.log(`Current winner mean: ${fmt(base.winner.meanMinutes)} min`);
console.log(`Target winner mean:  ${fmt(TARGET.meanWinnerMinutes)} min`);
console.log("\nThe count delta is exactly one winner. The rows below rank single-winner removals only as investigative clues.");
console.log("Do NOT exclude a trade unless a source/methodology reason independently justifies it.\n");

console.log("TOP SINGLE-WINNER CANDIDATES");
console.log("================================================================================");
console.log("Rank Day        Symbol Dir   EntryET  Sess HoldMin   PnL       NewMedW NewMeanW DupFill SharedOrder");
for (const [index, row] of candidates.slice(0, 20).entries()) {
  const t = row.trade;
  console.log(
    `${String(index + 1).padStart(4)} ` +
    `${String(t.tradingDay || "—").padEnd(10)} ` +
    `${String(t.symbol || "—").padEnd(6)} ` +
    `${String(t.direction || "—").padEnd(5)} ` +
    `${String(easternClock(t.entryAt)).padEnd(8)} ` +
    `${String(sessionFor(t.entryAt)).padEnd(4)} ` +
    `${fmt(row.durationMin).padStart(7)} ` +
    `${fmt(Number(t.realizedPnl), 2).padStart(9)} ` +
    `${fmt(row.summary.winner.medianMinutes).padStart(7)} ` +
    `${fmt(row.summary.winner.meanMinutes).padStart(8)} ` +
    `${String(row.duplicateFingerprint ? "YES" : "no").padStart(7)} ` +
    `${String(row.sharedInitialOrderId ? "YES" : "no").padStart(11)}`,
  );
}

const exactCountCandidates = candidates.filter((row) =>
  row.summary.completedTrades === TARGET.completedTrades
  && row.summary.winners === TARGET.winners
  && row.summary.losers === TARGET.losers
  && row.summary.flat === TARGET.flat
);

console.log("\nSTRUCTURAL CLUES");
console.log("================================================================================");
console.log(`Every single winning exclusion yields the exact target W/L/F count: ${exactCountCandidates.length === winners.length ? "yes" : "no"}`);
console.log(`Duplicate episode fingerprints in window: ${[...fingerprintCounts.values()].filter((count) => count > 1).length}`);
console.log(`Initial order IDs shared by multiple episodes: ${[...initialOrderCounts.values()].filter((count) => count > 1).length}`);
console.log("\nNext step: inspect the top-ranked rows for a defensible exclusion rule (boundary timing, duplicate, non-stock instrument, incomplete source coverage, or original study filter). Do not choose solely from the duration score.");
