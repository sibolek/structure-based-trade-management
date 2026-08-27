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

function upper(value) {
  return String(value || "").toUpperCase();
}

function timeMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function isWinner(trade) {
  return Number(trade?.realizedPnl ?? trade?.realizedGrossPnl) > 1e-9;
}

function isLoser(trade) {
  return Number(trade?.realizedPnl ?? trade?.realizedGrossPnl) < -1e-9;
}

function isClosingInstruction(trade, order) {
  const instruction = upper(order?.instruction);
  if (upper(trade?.direction) === "SHORT") return instruction === "BUY_TO_COVER" || instruction === "BUY";
  return instruction === "SELL";
}

function isStopOrder(order) {
  return upper(order?.orderType).includes("STOP") && Number.isFinite(Number(order?.stopPrice));
}

function isProtectiveDirection(trade, previous, next) {
  if (![previous, next].every(Number.isFinite)) return false;
  return upper(trade?.direction) === "SHORT" ? next < previous : next > previous;
}

function isAtOrBeyondEntry(trade, stop) {
  const entry = Number(trade?.entryPrice ?? trade?.entryVWAP);
  if (![entry, stop].every(Number.isFinite)) return false;
  return upper(trade?.direction) === "SHORT" ? stop <= entry : stop >= entry;
}

function eventTime(order) {
  return timeMs(order?.enteredTime) ?? timeMs(order?.closeTime) ?? timeMs(order?.cancelTime);
}

function localEt(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(date);
}

function linkedStopsForTrade(trade, snapshots) {
  const entry = timeMs(trade.entryAt);
  const exit = timeMs(trade.exitAt);
  const parentIds = new Set((trade.fills || []).map((fill) => String(fill.orderId || "")).filter(Boolean));
  const candidates = snapshots.filter((order) => {
    if (String(order.accountKey || "") !== String(trade.accountKey || "")) return false;
    if (upper(order.symbol) !== upper(trade.symbol)) return false;
    if (upper(order.positionEffect) !== "CLOSING") return false;
    if (!isClosingInstruction(trade, order) || !isStopOrder(order)) return false;

    const t = eventTime(order);
    const parentMatch = order.parentOrderId != null && parentIds.has(String(order.parentOrderId));
    const timeMatch = Number.isFinite(t) && Number.isFinite(entry) && Number.isFinite(exit)
      && t >= entry - 120_000 && t <= exit + 60_000;
    return parentMatch || timeMatch;
  });

  const deduped = new Map();
  for (const order of candidates) {
    const key = `${order.orderId}|${order.legId}|${order.stopPrice}|${order.enteredTime || ""}|${order.status || ""}`;
    if (!deduped.has(key)) deduped.set(key, order);
  }
  return [...deduped.values()].sort((a, b) => (eventTime(a) ?? 0) - (eventTime(b) ?? 0));
}

function analyzeTrade(trade, stops) {
  const prices = stops.map((order) => Number(order.stopPrice)).filter(Number.isFinite);
  const uniquePrices = [...new Set(prices.map((price) => price.toFixed(8)))].map(Number);
  let firstTightening = null;
  let firstBeProfit = null;

  for (let i = 1; i < stops.length; i += 1) {
    const previous = Number(stops[i - 1]?.stopPrice);
    const next = Number(stops[i]?.stopPrice);
    if (!isProtectiveDirection(trade, previous, next)) continue;
    const at = eventTime(stops[i]);
    const entry = timeMs(trade.entryAt);
    const ageSec = Number.isFinite(at) && Number.isFinite(entry) ? (at - entry) / 1000 : null;
    if (!firstTightening) firstTightening = { previous, next, ageSec, order: stops[i] };
    if (!firstBeProfit && isAtOrBeyondEntry(trade, next)) firstBeProfit = { previous, next, ageSec, order: stops[i] };
  }

  const anyBeProfit = stops.some((order) => isAtOrBeyondEntry(trade, Number(order.stopPrice)));
  return { trade, stops, uniquePrices, firstTightening, firstBeProfit, anyBeProfit };
}

const raw = readJson(RAW_PATH);
const normalized = readJson(NORMALIZED_PATH);
const snapshots = Array.isArray(raw.orderSnapshots) ? raw.orderSnapshots : [];
const trades = (normalized.trades || []).filter((trade) => {
  const entry = timeMs(trade.entryAt);
  return Number.isFinite(entry) && entry >= START && entry < END;
});
const rows = trades.map((trade) => analyzeTrade(trade, linkedStopsForTrade(trade, snapshots)));
const winners = rows.filter((row) => isWinner(row.trade));
const losers = rows.filter((row) => isLoser(row.trade));

const statusCounts = new Map();
for (const snapshot of snapshots.filter(isStopOrder)) {
  const status = upper(snapshot.status) || "UNKNOWN";
  statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
}

function count(rowsToUse, predicate) {
  return rowsToUse.filter(predicate).length;
}

console.log("ExecutionOS historical stop-order diagnostic");
console.log("================================================================================");
console.log("Recovered duration window: 2026-07-22 09:30 ET -> 2026-08-21 inclusive");
console.log(`Trades in window:          ${trades.length}`);
console.log(`Winners / losers:          ${winners.length} / ${losers.length}`);
console.log(`Exported order snapshots:  ${snapshots.length}`);
console.log(`Stop-like snapshots:       ${snapshots.filter(isStopOrder).length}`);
console.log("");
console.log("STOP COVERAGE BY TRADE");
console.log("================================================================================");
console.log(`Any linked stop:                 ${count(rows, (r) => r.stops.length > 0)}`);
console.log(`>=2 linked stop snapshots:       ${count(rows, (r) => r.stops.length >= 2)}`);
console.log(`>=2 distinct stop prices:        ${count(rows, (r) => r.uniquePrices.length >= 2)}`);
console.log(`Detected protective tightening:  ${count(rows, (r) => Boolean(r.firstTightening))}`);
console.log(`Detected move to BE/profit:      ${count(rows, (r) => Boolean(r.firstBeProfit))}`);
console.log(`Any BE/profit stop observed:     ${count(rows, (r) => r.anyBeProfit)}`);
console.log("");
console.log("WINNERS");
console.log("================================================================================");
console.log(`Winners with any linked stop:            ${count(winners, (r) => r.stops.length > 0)}`);
console.log(`Winners with >=2 distinct stop prices:   ${count(winners, (r) => r.uniquePrices.length >= 2)}`);
console.log(`Winners with detected BE/profit move:    ${count(winners, (r) => Boolean(r.firstBeProfit))}`);
console.log(`Winners with any BE/profit stop seen:    ${count(winners, (r) => r.anyBeProfit)}`);
console.log("Historical target:                        135 winners with move to BE/profit");
console.log("");
console.log("LOSERS");
console.log("================================================================================");
console.log(`Losers with any linked stop:              ${count(losers, (r) => r.stops.length > 0)}`);
console.log(`Losers with detected BE/profit move:      ${count(losers, (r) => Boolean(r.firstBeProfit))}`);
console.log(`Losers with any BE/profit stop seen:      ${count(losers, (r) => r.anyBeProfit)}`);
console.log("Historical target:                         3 losers with move to BE/profit");
console.log("");
console.log("STOP SNAPSHOT STATUS DISTRIBUTION");
console.log("================================================================================");
for (const [status, value] of [...statusCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${status.padEnd(18)} ${value}`);
}

const examples = rows
  .filter((row) => row.uniquePrices.length >= 2)
  .sort((a, b) => (b.uniquePrices.length - a.uniquePrices.length) || (timeMs(a.trade.entryAt) - timeMs(b.trade.entryAt)))
  .slice(0, 20);

console.log("");
console.log("EXAMPLES WITH MULTIPLE DISTINCT STOP PRICES");
console.log("================================================================================");
if (!examples.length) console.log("None detected from historical order snapshots.");
for (const row of examples) {
  const t = row.trade;
  const outcome = isWinner(t) ? "W" : isLoser(t) ? "L" : "F";
  const stopsText = row.stops.map((s) => `${Number(s.stopPrice)}(${upper(s.status)},${localEt(s.enteredTime || s.closeTime)})`).join(" -> ");
  console.log(`${t.tradingDay} ${String(t.symbol).padEnd(6)} ${upper(t.direction).padEnd(5)} ${outcome} entry=${Number(t.entryPrice).toFixed(4)}  ${stopsText}`);
}

console.log("");
console.log("INTERPRETATION");
console.log("================================================================================");
console.log("If the historical endpoint exposes replaced/cancelled stop orders as separate snapshots, multiple stop prices should appear here and can be converted into STOP_CHANGED events.");
console.log("If most trades show only one final stop price, the endpoint is collapsing in-place modifications and the original stop-movement study will require another preserved source or a different reconstruction route.");
