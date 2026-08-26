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
function isOpeningFill(trade, fill) {
  const i = upper(fill?.instruction);
  return upper(trade?.direction) === "SHORT" ? i === "SELL_SHORT" : i === "BUY";
}
function isClosingFill(trade, fill) {
  const i = upper(fill?.instruction);
  return upper(trade?.direction) === "SHORT" ? i === "BUY_TO_COVER" || i === "BUY" : i === "SELL";
}
function positionAt(trade, timestamp) {
  const fills = [...(trade?.fills || [])]
    .filter((fill) => Number.isFinite(ms(fill?.time)) && ms(fill?.time) <= timestamp)
    .sort((a, b) => ms(a?.time) - ms(b?.time));
  let qty = 0;
  let avg = null;
  for (const fill of fills) {
    const q = Math.abs(Number(fill?.quantity));
    const px = Number(fill?.price);
    if (![q, px].every(Number.isFinite) || q <= 0) continue;
    if (isOpeningFill(trade, fill)) {
      const nextQty = qty + q;
      avg = qty > 0 && Number.isFinite(avg) ? ((avg * qty) + (px * q)) / nextQty : px;
      qty = nextQty;
    } else if (isClosingFill(trade, fill)) {
      qty = Math.max(0, qty - Math.min(qty, q));
      if (qty === 0) avg = null;
    }
  }
  return { qty, avg };
}
function lossSide(direction, basis, stopPrice) {
  const entry = Number(basis);
  const stop = Number(stopPrice);
  if (![entry, stop].every(Number.isFinite)) return false;
  return upper(direction) === "SHORT" ? stop > entry : stop < entry;
}
function acceptedStopsInEpisode(trade, snapshots) {
  const entryAt = ms(trade?.entryAt);
  const exitAt = ms(trade?.exitAt);
  if (![entryAt, exitAt].every(Number.isFinite)) return [];
  return snapshots
    .filter((order) => {
      if (String(order?.accountKey || "") !== String(trade?.accountKey || "")) return false;
      if (upper(order?.symbol) !== upper(trade?.symbol)) return false;
      if (upper(order?.positionEffect) !== "CLOSING") return false;
      if (!accepted(order) || !isStop(order) || !closingFor(trade, order)) return false;
      const entered = ms(order?.enteredTime);
      return Number.isFinite(entered) && entered >= entryAt && entered <= exitAt;
    })
    .sort((a, b) => ms(a?.enteredTime) - ms(b?.enteredTime));
}
function candidateFor(trade, snapshots, basisMode) {
  const stops = acceptedStopsInEpisode(trade, snapshots);
  const first = stops[0] || null;
  if (!first) return null;
  let basis;
  if (basisMode === "INITIAL") basis = Number(trade?.entryPrice ?? trade?.entryVWAP);
  else if (basisMode === "EPISODE") basis = Number(trade?.entryVWAP ?? trade?.entryPrice);
  else {
    const at = positionAt(trade, ms(first?.enteredTime));
    basis = at.avg;
  }
  if (!Number.isFinite(basis) || !lossSide(trade?.direction, basis, first?.stopPrice)) return null;
  return { trade, stop: first, basis };
}
function withPeakRisk(row) {
  const { trade, stop } = row;
  const entry = Number(trade?.entryPrice ?? trade?.entryVWAP);
  const stopPrice = Number(stop?.stopPrice);
  const quantity = Number(trade?.peakQuantity ?? trade?.initialQuantity);
  const risk = Math.abs(entry - stopPrice) * quantity;
  if (![entry, stopPrice, quantity, risk].every(Number.isFinite) || quantity <= 0 || risk <= 0) return null;
  return { ...trade, initialStop: stopPrice, initialRisk: risk };
}
function summarize(label, rows) {
  const trades = rows.map(withPeakRisk).filter(Boolean);
  const s = summarizeRMultiples(trades);
  const pct = (v) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
  const n = (v) => Number.isFinite(v) ? v.toFixed(2) : "—";
  console.log(
    `${label.padEnd(34)} N=${String(s.tradesWithInitialRisk).padStart(3)} W/L=${s.winners}/${s.losers} ` +
    `Med/Mean W=${n(s.winner.medianR)}/${n(s.winner.meanR)} ` +
    `L=${n(s.loser.medianR)}/${n(s.loser.meanR)} ` +
    `W<.5=${pct(s.pctWinnersBelowHalfR)} W<1=${pct(s.pctWinnersBelowOneR)} ` +
    `L<=-1=${pct(s.pctLosersAtOrBeyondMinusOneR)}`,
  );
  return { rows, trades, summary: s };
}
function key(row) {
  const t = row.trade;
  return `${t.tradingDay}|${t.symbol}|${t.direction}|${t.entryAt}`;
}
function fmtRow(row) {
  const t = row.trade;
  const stopTime = ms(row.stop?.enteredTime);
  const at = positionAt(t, stopTime);
  const initial = Number(t?.entryPrice ?? t?.entryVWAP);
  const episode = Number(t?.entryVWAP ?? t?.entryPrice);
  const stop = Number(row.stop?.stopPrice);
  const age = Number.isFinite(stopTime) && Number.isFinite(ms(t?.entryAt)) ? (stopTime - ms(t.entryAt)) / 1000 : null;
  return `${t.tradingDay} ${String(t.symbol).padEnd(6)} ${upper(t.direction).padEnd(5)} ${outcome(t)} ` +
    `stop=${Number.isFinite(stop) ? stop.toFixed(4) : "—"} age=${Number.isFinite(age) ? age.toFixed(1) : "—"}s ` +
    `initial=${Number.isFinite(initial) ? initial.toFixed(4) : "—"} episode=${Number.isFinite(episode) ? episode.toFixed(4) : "—"} ` +
    `atStop=${Number.isFinite(at.avg) ? at.avg.toFixed(4) : "—"} qtyAtStop=${at.qty} peakQty=${t.peakQuantity}`;
}

const raw = readJson(RAW_PATH);
const study = readJson(STUDY_PATH);
const snapshots = Array.isArray(raw?.orderSnapshots) ? raw.orderSnapshots : [];
const trades = Array.isArray(study?.trades) ? study.trades : [];

const variants = {
  INITIAL: trades.map((t) => candidateFor(t, snapshots, "INITIAL")).filter(Boolean),
  EPISODE: trades.map((t) => candidateFor(t, snapshots, "EPISODE")).filter(Boolean),
  POSITION: trades.map((t) => candidateFor(t, snapshots, "POSITION")).filter(Boolean),
};

console.log("ExecutionOS R-subset stop-side classification diagnostic");
console.log("================================================================================");
console.log("R denominator held fixed: initial-order entry price x peak position quantity");
console.log("Only the definition of whether the first accepted stop is loss-side changes.");
console.log("Historical target: 83 trades / 35 winners / 48 losers");
console.log("Target R: W med/mean 0.31/0.60; L med/mean -1.00/-1.01; W<.5 68.6%; W<1 82.9%; L<=-1 54.2%");
console.log("");
console.log("POPULATION COMPARISON");
console.log("================================================================================");
const a = summarize("initial-order entry basis", variants.INITIAL);
const b = summarize("episode blended VWAP basis", variants.EPISODE);
const c = summarize("position avg at stop basis", variants.POSITION);

const initialMap = new Map(variants.INITIAL.map((r) => [key(r), r]));
const positionMap = new Map(variants.POSITION.map((r) => [key(r), r]));
const leaves = [...initialMap].filter(([k]) => !positionMap.has(k)).map(([, r]) => r);
const enters = [...positionMap].filter(([k]) => !initialMap.has(k)).map(([, r]) => r);

console.log("");
console.log("MEMBERSHIP CHANGES: INITIAL-ENTRY BASIS -> POSITION-AT-STOP BASIS");
console.log("================================================================================");
console.log(`Leaves subset: ${leaves.length}`);
for (const row of leaves) console.log(`  - ${fmtRow(row)}`);
if (!leaves.length) console.log("  None.");
console.log(`Enters subset: ${enters.length}`);
for (const row of enters) console.log(`  + ${fmtRow(row)}`);
if (!enters.length) console.log("  None.");

console.log("");
console.log("SCALED TRADES WHOSE FIRST-STOP CLASSIFICATION CHANGES BY BASIS");
console.log("================================================================================");
let changed = 0;
for (const trade of trades) {
  if (!(Number(trade?.peakQuantity) > Number(trade?.initialQuantity) + 1e-9)) continue;
  const stops = acceptedStopsInEpisode(trade, snapshots);
  const first = stops[0] || null;
  if (!first) continue;
  const at = positionAt(trade, ms(first?.enteredTime));
  const initial = Number(trade?.entryPrice ?? trade?.entryVWAP);
  const episode = Number(trade?.entryVWAP ?? trade?.entryPrice);
  const flags = {
    initial: lossSide(trade?.direction, initial, first?.stopPrice),
    episode: lossSide(trade?.direction, episode, first?.stopPrice),
    position: lossSide(trade?.direction, at.avg, first?.stopPrice),
  };
  if (flags.initial === flags.episode && flags.initial === flags.position) continue;
  changed += 1;
  console.log(`  ${fmtRow({ trade, stop: first })} | loss-side initial=${flags.initial ? "Y" : "N"} episode=${flags.episode ? "Y" : "N"} atStop=${flags.position ? "Y" : "N"}`);
}
if (!changed) console.log("None.");

console.log("");
console.log("INTERPRETATION");
console.log("================================================================================");
console.log("Do not select a population merely because it hits 83. A stop placed after scaling should be classified against the position basis that actually existed when the stop was submitted. The fixed peak-quantity denominator is held constant here only to isolate population membership from denominator effects.");
