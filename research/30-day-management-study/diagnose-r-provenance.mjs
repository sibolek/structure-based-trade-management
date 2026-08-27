import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strictStopSnapshotsForTrade, stopAtOrBeyondEntry } from "../../analytics/stop-history.mjs";
import { summarizeRMultiples } from "../../analytics/r-metrics.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_PATH = path.join(HERE, "raw-schwab-history.json");
const STUDY_PATH = path.join(HERE, "historical-study-trades.json");

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing local research file: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function upper(value) { return String(value || "").toUpperCase(); }
function timeMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}
function outcome(trade) {
  const pnl = Number(trade?.realizedPnl ?? trade?.realizedGrossPnl);
  return pnl > 1e-9 ? "W" : pnl < -1e-9 ? "L" : "F";
}
function isLossSide(trade, stopPrice) {
  const entry = Number(trade?.entryPrice ?? trade?.entryVWAP);
  const stop = Number(stopPrice);
  if (![entry, stop].every(Number.isFinite)) return false;
  return upper(trade?.direction) === "SHORT" ? stop > entry : stop < entry;
}
function stopAgeSec(trade, stop) {
  const entry = timeMs(trade?.entryAt);
  const at = timeMs(stop?.enteredTime) ?? timeMs(stop?.closeTime) ?? timeMs(stop?.cancelTime);
  return Number.isFinite(entry) && Number.isFinite(at) ? (at - entry) / 1000 : null;
}
function enrichWithInitialStop(trade, stop) {
  const initialStop = Number(stop?.stopPrice);
  const entry = Number(trade?.entryPrice ?? trade?.entryVWAP);
  const qty = Number(trade?.initialQuantity);
  const initialRisk = Math.abs(entry - initialStop) * qty;
  if (![initialStop, entry, qty, initialRisk].every(Number.isFinite) || qty <= 0 || initialRisk <= 0) return null;
  return { ...trade, initialStop, initialRisk };
}
function fmt(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
}
function summaryLine(label, rows) {
  const s = summarizeRMultiples(rows);
  const w = rows.filter((t) => outcome(t) === "W").length;
  const l = rows.filter((t) => outcome(t) === "L").length;
  const f = rows.filter((t) => outcome(t) === "F").length;
  const pct = (value) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
  console.log(`${label}`);
  console.log(`  N/W/L/F: ${rows.length}/${w}/${l}/${f}`);
  console.log(`  Winner median/mean: ${fmt(s?.winner?.medianR)}/${fmt(s?.winner?.meanR)}R`);
  console.log(`  Loser median/mean:  ${fmt(s?.loser?.medianR)}/${fmt(s?.loser?.meanR)}R`);
  console.log(`  W<0.5R / W<1R:     ${pct(s?.pctWinnersBelowHalfR)} / ${pct(s?.pctWinnersBelowOneR)}`);
  console.log(`  L<=-1R:             ${pct(s?.pctLosersAtOrBeyondMinusOneR)}`);
}

const raw = readJson(RAW_PATH);
const study = readJson(STUDY_PATH);
const snapshots = Array.isArray(raw?.orderSnapshots) ? raw.orderSnapshots : [];
const trades = Array.isArray(study?.trades) ? study.trades : [];

const candidates = [];
const contaminated = [];
const clean = [];

for (const trade of trades) {
  const stops = strictStopSnapshotsForTrade(trade, snapshots, { includeRejected: false });
  const firstLossIndex = stops.findIndex((stop) => isLossSide(trade, stop?.stopPrice));
  if (firstLossIndex < 0) continue;

  const firstLoss = stops[firstLossIndex];
  const enriched = enrichWithInitialStop(trade, firstLoss);
  if (!enriched) continue;

  const priorAcceptedStops = stops.slice(0, firstLossIndex);
  const priorBeProfitStops = priorAcceptedStops.filter((stop) => stopAtOrBeyondEntry(trade, stop?.stopPrice));
  const row = {
    trade,
    enriched,
    stops,
    firstLoss,
    firstLossIndex,
    priorAcceptedStops,
    priorBeProfitStops,
  };
  candidates.push(row);
  if (priorAcceptedStops.length > 0) contaminated.push(row);
  else clean.push(row);
}

console.log("ExecutionOS initial-risk provenance diagnostic");
console.log("================================================================================");
console.log("Question: can the first observed loss-side stop be treated as original risk only when no earlier accepted stop exists in the episode?");
console.log("Historical target: 83 trades / 35 winners / 48 losers");
console.log("");

summaryLine("BASE: first accepted loss-side stop anytime", candidates.map((row) => row.enriched));
console.log("");
summaryLine("CLEAN: first accepted stop is already loss-side", clean.map((row) => row.enriched));
console.log("");

const contaminatedW = contaminated.filter((row) => outcome(row.trade) === "W");
const contaminatedL = contaminated.filter((row) => outcome(row.trade) === "L");
const contaminatedF = contaminated.filter((row) => outcome(row.trade) === "F");
console.log("PRIOR-STOP PROVENANCE FAILURES");
console.log("================================================================================");
console.log(`Trades whose first loss-side stop was preceded by another accepted stop: ${contaminated.length}`);
console.log(`W/L/F among provenance failures: ${contaminatedW.length}/${contaminatedL.length}/${contaminatedF.length}`);
console.log("");

if (!contaminated.length) console.log("None.");
for (const row of contaminated) {
  const t = row.trade;
  const e = row.enriched;
  const riskR = Number(t.realizedPnl ?? t.realizedGrossPnl) / Number(e.initialRisk);
  const priorText = row.priorAcceptedStops
    .map((stop) => `${Number(stop.stopPrice)}(${upper(stop.status)},age=${fmt(stopAgeSec(t, stop), 1)}s,${stopAtOrBeyondEntry(t, stop.stopPrice) ? "BE+" : "LOSS"})`)
    .join(" -> ");
  console.log(`${t.tradingDay} ${String(t.symbol).padEnd(6)} ${upper(t.direction).padEnd(5)} ${outcome(t)}  reconstructedR=${fmt(riskR, 2)}  firstLoss=${Number(row.firstLoss.stopPrice)} age=${fmt(stopAgeSec(t, row.firstLoss), 1)}s`);
  console.log(`  prior accepted stops: ${priorText || "none"}`);
}

console.log("");
console.log("INTERPRETATION");
console.log("================================================================================");
console.log("If CLEAN reproduces 83/35/48, the provenance rule is independently defensible: once an accepted BE/profit stop was already observed, a later loss-side stop cannot represent the original risk-bearing stop.");
console.log("If CLEAN removes losers or more than two winners, do not force the rule; inspect the listed sequences before enriching the R study.");
