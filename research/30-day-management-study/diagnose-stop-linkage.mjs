import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_PATH = path.join(HERE, "raw-schwab-history.json");
const NORMALIZED_PATH = path.join(HERE, "normalized-trades.json");
const START = Date.parse("2026-07-22T13:30:00.000Z"); // inferred historical boundary: 09:30 ET
const END = Date.parse("2026-08-22T04:00:00.000Z");   // end of Aug 21 ET

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing local research file: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function upper(value) { return String(value || "").toUpperCase(); }
function timeMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}
function isWinner(trade) { return Number(trade?.realizedPnl ?? trade?.realizedGrossPnl) > 1e-9; }
function isLoser(trade) { return Number(trade?.realizedPnl ?? trade?.realizedGrossPnl) < -1e-9; }

function isClosingInstruction(trade, order) {
  const instruction = upper(order?.instruction);
  if (upper(trade?.direction) === "SHORT") return instruction === "BUY_TO_COVER" || instruction === "BUY";
  return instruction === "SELL";
}

function isStopOrder(order) {
  return upper(order?.orderType).includes("STOP") && Number.isFinite(Number(order?.stopPrice));
}

function isAcceptedHistoricalStop(order) {
  return upper(order?.status) !== "REJECTED";
}

function isAtOrBeyondEntry(trade, stop) {
  const entry = Number(trade?.entryPrice ?? trade?.entryVWAP);
  if (![entry, stop].every(Number.isFinite)) return false;
  return upper(trade?.direction) === "SHORT" ? stop <= entry : stop >= entry;
}

function isProtectiveDirection(trade, previous, next) {
  if (![previous, next].every(Number.isFinite)) return false;
  return upper(trade?.direction) === "SHORT" ? next < previous : next > previous;
}

function eventTime(order) {
  return timeMs(order?.enteredTime) ?? timeMs(order?.closeTime) ?? timeMs(order?.cancelTime);
}

function ageSec(trade, order) {
  const entry = timeMs(trade.entryAt);
  const at = eventTime(order);
  return Number.isFinite(entry) && Number.isFinite(at) ? (at - entry) / 1000 : null;
}

function median(values) {
  const xs = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function mean(values) {
  const xs = values.map(Number).filter(Number.isFinite);
  return xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null;
}

function baseStopCandidate(trade, order) {
  if (String(order.accountKey || "") !== String(trade.accountKey || "")) return false;
  if (upper(order.symbol) !== upper(trade.symbol)) return false;
  if (upper(order.positionEffect) !== "CLOSING") return false;
  if (!isClosingInstruction(trade, order) || !isStopOrder(order)) return false;
  return true;
}

function dedupeAndSort(rows) {
  const deduped = new Map();
  for (const order of rows) {
    const key = `${order.orderId}|${order.legId}|${order.stopPrice}|${order.enteredTime || ""}|${order.status || ""}`;
    if (!deduped.has(key)) deduped.set(key, order);
  }
  return [...deduped.values()].sort((a, b) => (eventTime(a) ?? 0) - (eventTime(b) ?? 0));
}

function broadStopsForTrade(trade, snapshots, { includeRejected = true } = {}) {
  const entry = timeMs(trade.entryAt);
  const exit = timeMs(trade.exitAt);
  const parentIds = new Set((trade.fills || []).map((fill) => String(fill.orderId || "")).filter(Boolean));
  return dedupeAndSort(snapshots.filter((order) => {
    if (!baseStopCandidate(trade, order)) return false;
    if (!includeRejected && !isAcceptedHistoricalStop(order)) return false;
    const t = eventTime(order);
    const parentMatch = order.parentOrderId != null && parentIds.has(String(order.parentOrderId));
    const timeMatch = Number.isFinite(t) && Number.isFinite(entry) && Number.isFinite(exit)
      && t >= entry - 120_000 && t <= exit + 60_000;
    return parentMatch || timeMatch;
  }));
}

function strictStopsForTrade(trade, snapshots, { includeRejected = false } = {}) {
  const entry = timeMs(trade.entryAt);
  const exit = timeMs(trade.exitAt);
  const parentIds = new Set((trade.fills || []).map((fill) => String(fill.orderId || "")).filter(Boolean));
  return dedupeAndSort(snapshots.filter((order) => {
    if (!baseStopCandidate(trade, order)) return false;
    if (!includeRejected && !isAcceptedHistoricalStop(order)) return false;
    const t = eventTime(order);
    if (!Number.isFinite(t) || !Number.isFinite(entry) || !Number.isFinite(exit)) return false;

    // Ordinary attribution requires the stop order to be entered while this episode is live.
    if (t >= entry && t <= exit) return true;

    // A native bracket child can legitimately be submitted just before the entry fill.
    // Only explicit parent lineage is allowed to cross the entry boundary, and only narrowly.
    const parentMatch = order.parentOrderId != null && parentIds.has(String(order.parentOrderId));
    return parentMatch && t >= entry - 10_000 && t < entry;
  }));
}

function analyzeTrade(trade, stops) {
  const firstObservedBeProfit = stops.find((order) => {
    const age = ageSec(trade, order);
    return Number.isFinite(age) && age >= 0 && isAtOrBeyondEntry(trade, Number(order.stopPrice));
  }) || null;

  let firstTightening = null;
  let firstDetectedBeProfitMove = null;
  for (let i = 1; i < stops.length; i += 1) {
    const previous = Number(stops[i - 1]?.stopPrice);
    const next = Number(stops[i]?.stopPrice);
    if (!isProtectiveDirection(trade, previous, next)) continue;
    const age = ageSec(trade, stops[i]);
    if (!Number.isFinite(age) || age < 0) continue;
    if (!firstTightening) firstTightening = stops[i];
    if (!firstDetectedBeProfitMove && isAtOrBeyondEntry(trade, next)) firstDetectedBeProfitMove = stops[i];
  }

  return {
    trade,
    stops,
    firstObservedBeProfit,
    firstObservedBeProfitAgeSec: firstObservedBeProfit ? ageSec(trade, firstObservedBeProfit) : null,
    firstTightening,
    firstDetectedBeProfitMove,
  };
}

function summarize(name, trades, snapshots, linker, options = {}) {
  const rows = trades.map((trade) => analyzeTrade(trade, linker(trade, snapshots, options)));
  const winners = rows.filter((row) => isWinner(row.trade));
  const losers = rows.filter((row) => isLoser(row.trade));
  const winnerObserved = winners.filter((row) => row.firstObservedBeProfit);
  const loserObserved = losers.filter((row) => row.firstObservedBeProfit);
  const winnerAges = winnerObserved.map((row) => row.firstObservedBeProfitAgeSec).filter(Number.isFinite);
  const within60 = winnerAges.filter((value) => value <= 60).length;
  const within120 = winnerAges.filter((value) => value <= 120).length;

  return {
    name,
    rows,
    winners,
    losers,
    linked: rows.filter((row) => row.stops.length).length,
    winnerObserved: winnerObserved.length,
    loserObserved: loserObserved.length,
    winnerDetectedMove: winners.filter((row) => row.firstDetectedBeProfitMove).length,
    loserDetectedMove: losers.filter((row) => row.firstDetectedBeProfitMove).length,
    medianWinnerAge: median(winnerAges),
    meanWinnerAge: mean(winnerAges),
    within60,
    within120,
    pct60: winnerAges.length ? within60 / winnerAges.length : null,
    pct120: winnerAges.length ? within120 / winnerAges.length : null,
  };
}

function fmt(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
}

const raw = readJson(RAW_PATH);
const normalized = readJson(NORMALIZED_PATH);
const snapshots = Array.isArray(raw.orderSnapshots) ? raw.orderSnapshots : [];
const trades = (normalized.trades || []).filter((trade) => {
  const entry = timeMs(trade.entryAt);
  return Number.isFinite(entry) && entry >= START && entry < END;
});

const variants = [
  summarize("BROAD / includes rejected", trades, snapshots, broadStopsForTrade, { includeRejected: true }),
  summarize("BROAD / accepted only", trades, snapshots, broadStopsForTrade, { includeRejected: false }),
  summarize("STRICT / includes rejected", trades, snapshots, strictStopsForTrade, { includeRejected: true }),
  summarize("STRICT / accepted only", trades, snapshots, strictStopsForTrade, { includeRejected: false }),
];

console.log("ExecutionOS strict stop-linkage comparison");
console.log("================================================================================");
console.log("Recovered duration population: 384 trades (265 winners / 118 losers / 1 flat)");
console.log("Historical stop target: 135 winner BE/profit moves; 3 loser BE/profit moves");
console.log("Historical timing target: median ~77 sec; ~43% within 60 sec; ~63% within 120 sec");
console.log("");
console.log("VARIANT COMPARISON");
console.log("================================================================================");
console.log("Variant                       Linked  W_BE  L_BE  W_Detected  L_Detected  MedSec  <=60%  <=120%");
for (const result of variants) {
  console.log(
    `${result.name.padEnd(29)} ${String(result.linked).padStart(6)}  ${String(result.winnerObserved).padStart(4)}  ${String(result.loserObserved).padStart(4)}  ` +
    `${String(result.winnerDetectedMove).padStart(10)}  ${String(result.loserDetectedMove).padStart(10)}  ${fmt(result.medianWinnerAge, 1).padStart(6)}  ` +
    `${(result.pct60 == null ? "—" : `${(result.pct60 * 100).toFixed(1)}%`).padStart(6)}  ${(result.pct120 == null ? "—" : `${(result.pct120 * 100).toFixed(1)}%`).padStart(7)}`,
  );
}

const strict = variants[3];
console.log("");
console.log("STRICT / ACCEPTED-ONLY DETAILS");
console.log("================================================================================");
console.log(`Winners with first observed BE/profit stop: ${strict.winnerObserved} (target 135)`);
console.log(`Losers with first observed BE/profit stop:  ${strict.loserObserved} (target 3)`);
console.log(`Median winner first BE/profit age:          ${fmt(strict.medianWinnerAge, 3)} sec (target ~77)`);
console.log(`Mean winner first BE/profit age:            ${fmt(strict.meanWinnerAge, 3)} sec`);
console.log(`Winner first BE/profit <=60 sec:            ${strict.within60}/${strict.winnerObserved} = ${strict.pct60 == null ? "—" : `${(strict.pct60 * 100).toFixed(2)}%`} (target ~43%)`);
console.log(`Winner first BE/profit <=120 sec:           ${strict.within120}/${strict.winnerObserved} = ${strict.pct120 == null ? "—" : `${(strict.pct120 * 100).toFixed(2)}%`} (target ~63%)`);

console.log("");
console.log("PRE-ENTRY / POST-EXIT CONTAMINATION REMOVED BY STRICT LINKING");
console.log("================================================================================");
const broadAccepted = variants[1];
let shown = 0;
for (const broadRow of broadAccepted.rows) {
  const strictRow = strict.rows.find((row) => row.trade.id === broadRow.trade.id);
  if (!strictRow) continue;
  const strictKeys = new Set(strictRow.stops.map((s) => `${s.orderId}|${s.stopPrice}|${s.enteredTime || ""}`));
  const removed = broadRow.stops.filter((s) => !strictKeys.has(`${s.orderId}|${s.stopPrice}|${s.enteredTime || ""}`));
  if (!removed.length) continue;
  const t = broadRow.trade;
  console.log(`${t.tradingDay} ${String(t.symbol).padEnd(6)} ${upper(t.direction).padEnd(5)} ${isWinner(t) ? "W" : isLoser(t) ? "L" : "F"} entry=${t.entryAt} exit=${t.exitAt}`);
  for (const stop of removed.slice(0, 5)) {
    console.log(`  removed stop=${Number(stop.stopPrice)} status=${upper(stop.status)} entered=${stop.enteredTime || "—"} age=${fmt(ageSec(t, stop), 1)}s`);
  }
  shown += 1;
  if (shown >= 12) break;
}
if (!shown) console.log("None.");

console.log("");
console.log("Interpretation: first observed BE/profit stop is the primary historical-reproduction candidate because an exported episode may not contain the original below-entry stop snapshot. Detected transition is retained as a stricter production/event definition. Rejected modifications are never treated as an active protective stop in the accepted-only variants.");
