import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeRMultiples } from "../../analytics/r-metrics.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_PATH = path.join(HERE, "raw-schwab-history.json");
const STUDY_PATH = path.join(HERE, "historical-study-trades.json");

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing local research file: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function upper(value) { return String(value || "").toUpperCase(); }
function ms(value) { const n = Date.parse(value || ""); return Number.isFinite(n) ? n : null; }
function outcome(trade) {
  const pnl = Number(trade?.realizedPnl ?? trade?.realizedGrossPnl);
  return pnl > 1e-9 ? "W" : pnl < -1e-9 ? "L" : "F";
}
function isStop(order) { return upper(order?.orderType).includes("STOP") && Number.isFinite(Number(order?.stopPrice)); }
function accepted(order) { return upper(order?.status) !== "REJECTED"; }
function closingFor(trade, order) {
  const i = upper(order?.instruction);
  return upper(trade?.direction) === "SHORT" ? i === "BUY_TO_COVER" || i === "BUY" : i === "SELL";
}
function lossSide(trade, stopPrice) {
  const entry = Number(trade?.entryPrice ?? trade?.entryVWAP);
  const stop = Number(stopPrice);
  if (![entry, stop].every(Number.isFinite)) return false;
  return upper(trade?.direction) === "SHORT" ? stop > entry : stop < entry;
}
function terminalMs(order) {
  const times = [ms(order?.closeTime), ms(order?.cancelTime)].filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}
function baseStops(trade, snapshots) {
  return snapshots.filter((order) =>
    String(order?.accountKey || "") === String(trade?.accountKey || "") &&
    upper(order?.symbol) === upper(trade?.symbol) &&
    upper(order?.positionEffect) === "CLOSING" &&
    isStop(order) && closingFor(trade, order) && accepted(order)
  );
}
function activeAtEntry(trade, snapshots, lookbackSec) {
  const entry = ms(trade?.entryAt);
  if (!Number.isFinite(entry)) return null;
  const rows = baseStops(trade, snapshots)
    .filter((order) => {
      const entered = ms(order?.enteredTime);
      const terminal = terminalMs(order);
      if (!Number.isFinite(entered) || !lossSide(trade, order?.stopPrice)) return false;
      if (entered > entry || entered < entry - lookbackSec * 1000) return false;
      // The order must still have existed at the entry fill. This excludes stops from a prior episode.
      if (Number.isFinite(terminal) && terminal < entry) return false;
      return true;
    })
    .sort((a, b) => ms(b?.enteredTime) - ms(a?.enteredTime));
  return rows[0] || null;
}
function firstPostEntryClean(trade, snapshots, includeRejectedForProvenance = false) {
  const entry = ms(trade?.entryAt);
  const exit = ms(trade?.exitAt);
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) return null;

  const all = snapshots
    .filter((order) => {
      if (String(order?.accountKey || "") !== String(trade?.accountKey || "")) return false;
      if (upper(order?.symbol) !== upper(trade?.symbol)) return false;
      if (upper(order?.positionEffect) !== "CLOSING" || !isStop(order) || !closingFor(trade, order)) return false;
      const entered = ms(order?.enteredTime);
      return Number.isFinite(entered) && entered >= entry && entered <= exit;
    })
    .sort((a, b) => ms(a?.enteredTime) - ms(b?.enteredTime));

  const firstAcceptedLoss = all.find((order) => accepted(order) && lossSide(trade, order?.stopPrice));
  if (!firstAcceptedLoss) return null;
  const firstLossAt = ms(firstAcceptedLoss?.enteredTime);
  const prior = all.filter((order) => ms(order?.enteredTime) < firstLossAt && (includeRejectedForProvenance || accepted(order)));
  return prior.length ? null : firstAcceptedLoss;
}
function enrich(trade, stop, source) {
  if (!stop) return null;
  const entry = Number(trade?.entryPrice ?? trade?.entryVWAP);
  const initialStop = Number(stop?.stopPrice);
  const qty = Number(trade?.initialQuantity);
  const risk = Math.abs(entry - initialStop) * qty;
  if (![entry, initialStop, qty, risk].every(Number.isFinite) || qty <= 0 || risk <= 0) return null;
  return { ...trade, initialStop, initialRisk: risk, initialStopSource: source };
}
function summarize(label, rows) {
  const s = summarizeRMultiples(rows);
  const w = rows.filter((t) => outcome(t) === "W").length;
  const l = rows.filter((t) => outcome(t) === "L").length;
  const f = rows.filter((t) => outcome(t) === "F").length;
  const pct = (v) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
  const n = (v) => Number.isFinite(v) ? v.toFixed(2) : "—";
  console.log(`${label.padEnd(34)} N=${String(rows.length).padStart(3)} W/L/F=${w}/${l}/${f}  Med/Mean W=${n(s.winner.medianR)}/${n(s.winner.meanR)}  L=${n(s.loser.medianR)}/${n(s.loser.meanR)}  W<.5=${pct(s.pctWinnersBelowHalfR)} W<1=${pct(s.pctWinnersBelowOneR)} L<=-1=${pct(s.pctLosersAtOrBeyondMinusOneR)}`);
  return s;
}

const raw = readJson(RAW_PATH);
const study = readJson(STUDY_PATH);
const snapshots = Array.isArray(raw?.orderSnapshots) ? raw.orderSnapshots : [];
const trades = Array.isArray(study?.trades) ? study.trades : [];

function rowsFor({ lookbackSec = null, rejectedProvenance = false } = {}) {
  const rows = [];
  for (const trade of trades) {
    let stop = null;
    let source = null;
    if (Number.isFinite(lookbackSec)) {
      stop = activeAtEntry(trade, snapshots, lookbackSec);
      if (stop) source = `ACTIVE_AT_ENTRY_${lookbackSec}s`;
    }
    if (!stop) {
      stop = firstPostEntryClean(trade, snapshots, rejectedProvenance);
      if (stop) source = rejectedProvenance ? "POST_ENTRY_CLEAN_ALL_ACTIONS" : "POST_ENTRY_CLEAN_ACCEPTED";
    }
    const row = enrich(trade, stop, source);
    if (row) rows.push(row);
  }
  return rows;
}

console.log("ExecutionOS initial-risk stop lifecycle diagnostic");
console.log("================================================================================");
console.log("Historical target: 83 trades / 35 winners / 48 losers");
console.log("Target R: W med/mean 0.31/0.60; L med/mean -1.00/-1.01; W<.5 68.6%; W<1 82.9%; L<=-1 54.2%");
console.log("");
console.log("LIFECYCLE VARIANTS");
console.log("================================================================================");
summarize("post-entry clean / accepted", rowsFor());
summarize("post-entry clean / all actions", rowsFor({ rejectedProvenance: true }));
for (const lookbackSec of [15, 30, 60, 120, 300]) {
  summarize(`active-at-entry <=${lookbackSec}s + clean`, rowsFor({ lookbackSec }));
  summarize(`active<=${lookbackSec}s + clean/all-actions`, rowsFor({ lookbackSec, rejectedProvenance: true }));
}

console.log("");
console.log("ACTIVE-AT-ENTRY EXAMPLES (<=120s)");
console.log("================================================================================");
let shown = 0;
for (const trade of trades) {
  const stop = activeAtEntry(trade, snapshots, 120);
  if (!stop) continue;
  const entered = ms(stop.enteredTime);
  const terminal = terminalMs(stop);
  console.log(`${trade.tradingDay} ${String(trade.symbol).padEnd(6)} ${upper(trade.direction).padEnd(5)} ${outcome(trade)} entry=${trade.entryAt} stop=${Number(stop.stopPrice)} enteredAge=${((entered - ms(trade.entryAt))/1000).toFixed(1)}s terminalAfterEntry=${Number.isFinite(terminal) ? ((terminal - ms(trade.entryAt))/1000).toFixed(1)+"s" : "open/unknown"}`);
  shown += 1;
  if (shown >= 20) break;
}
if (!shown) console.log("None found.");

console.log("");
console.log("Interpretation: a pre-fill stop is only a valid original-risk candidate if its lifecycle overlaps the entry fill. Do not use an order that was already terminal before the trade began. Rejected orders can invalidate provenance but are never used as the active risk-bearing stop.");
