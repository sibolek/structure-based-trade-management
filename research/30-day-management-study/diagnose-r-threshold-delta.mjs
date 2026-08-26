import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_PATH = path.join(HERE, "raw-schwab-history.json");
const STUDY_PATH = path.join(HERE, "historical-study-trades.json");

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing local research file: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function upper(value) { return String(value || "").toUpperCase(); }
function ms(value) { const n = Date.parse(value || ""); return Number.isFinite(n) ? n : null; }
function pnlFor(trade) { return Number(trade?.realizedPnl ?? trade?.realizedGrossPnl); }
function outcome(trade) { const p = pnlFor(trade); return p > 1e-9 ? "W" : p < -1e-9 ? "L" : "F"; }
function isStop(order) { return upper(order?.orderType).includes("STOP") && Number.isFinite(Number(order?.stopPrice)); }
function accepted(order) { return upper(order?.status) !== "REJECTED"; }
function closingFor(trade, order) {
  const i = upper(order?.instruction);
  return upper(trade?.direction) === "SHORT" ? i === "BUY_TO_COVER" || i === "BUY" : i === "SELL";
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
  return snapshots.filter((order) => {
    if (String(order?.accountKey || "") !== String(trade?.accountKey || "")) return false;
    if (upper(order?.symbol) !== upper(trade?.symbol)) return false;
    if (upper(order?.positionEffect) !== "CLOSING") return false;
    if (!accepted(order) || !isStop(order) || !closingFor(trade, order)) return false;
    const entered = ms(order?.enteredTime);
    return Number.isFinite(entered) && entered >= entryAt && entered <= exitAt;
  }).sort((a, b) => ms(a?.enteredTime) - ms(b?.enteredTime));
}
function openingFill(trade, fill) {
  const i = upper(fill?.instruction);
  return upper(trade?.direction) === "SHORT" ? i === "SELL_SHORT" : i === "BUY";
}
function closingFill(trade, fill) {
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
    if (openingFill(trade, fill)) {
      const next = qty + q;
      avg = qty > 0 && Number.isFinite(avg) ? ((avg * qty) + (px * q)) / next : px;
      qty = next;
    } else if (closingFill(trade, fill)) {
      qty = Math.max(0, qty - Math.min(qty, q));
      if (qty === 0) avg = null;
    }
  }
  return { qty, avg };
}
function rWith(entry, stopPrice, quantity, pnl) {
  const risk = Math.abs(Number(entry) - Number(stopPrice)) * Number(quantity);
  return Number.isFinite(risk) && risk > 0 && Number.isFinite(pnl) ? pnl / risk : null;
}
function fmtTime(value) {
  const t = ms(value);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toISOString().replace("T", " ").replace(".000Z", "Z");
}
function fmtR(v) { return Number.isFinite(v) ? v.toFixed(4) : "—"; }

const raw = readJson(RAW_PATH);
const study = readJson(STUDY_PATH);
const snapshots = Array.isArray(raw?.orderSnapshots) ? raw.orderSnapshots : [];
const trades = Array.isArray(study?.trades) ? study.trades : [];

// Freeze the recovered 83-trade population: first accepted stop in episode is loss-side
// relative to the episode blended entry VWAP.
const population = [];
for (const trade of trades) {
  const first = acceptedStopsInEpisode(trade, snapshots)[0] || null;
  const episode = Number(trade?.entryVWAP ?? trade?.entryPrice);
  if (!first || !lossSide(trade?.direction, episode, first?.stopPrice)) continue;
  population.push({ trade, stop: first });
}

const losers = population.filter(({ trade }) => outcome(trade) === "L").map(({ trade, stop }) => {
  const initial = Number(trade?.entryPrice ?? trade?.entryVWAP);
  const episode = Number(trade?.entryVWAP ?? trade?.entryPrice);
  const peakQty = Number(trade?.peakQuantity ?? trade?.initialQuantity);
  const stopPrice = Number(stop?.stopPrice);
  const pnl = pnlFor(trade);
  const rInitial = rWith(initial, stopPrice, peakQty, pnl);
  const rEpisode = rWith(episode, stopPrice, peakQty, pnl);
  const stopAt = ms(stop?.enteredTime);
  const atStop = positionAt(trade, stopAt);
  const addsAfterStop = (trade?.fills || []).filter((fill) => openingFill(trade, fill) && Number.isFinite(ms(fill?.time)) && ms(fill?.time) > stopAt);
  return { trade, stop, initial, episode, peakQty, stopPrice, pnl, rInitial, rEpisode, atStop, addsAfterStop };
});

const crossing = losers.filter((row) => (row.rInitial <= -1) !== (row.rEpisode <= -1));
const changed = losers.filter((row) => Number.isFinite(row.rInitial) && Number.isFinite(row.rEpisode) && Math.abs(row.rInitial - row.rEpisode) > 1e-9)
  .sort((a, b) => Math.abs(b.rEpisode - b.rInitial) - Math.abs(a.rEpisode - a.rInitial));

console.log("ExecutionOS final loser -1R threshold forensic diagnostic");
console.log("================================================================================");
console.log(`Frozen recovered population: ${population.length} trades (${population.filter(({trade}) => outcome(trade) === "W").length} winners / ${losers.length} losers)`);
console.log("Compare only: initial-order entry x peak qty vs episode blended VWAP x peak qty");
console.log("Historical threshold target: 26/48 losers <= -1R (54.2%)");
console.log(`Initial-entry variant: ${losers.filter((r) => r.rInitial <= -1).length}/48 <= -1R`);
console.log(`Episode-VWAP variant: ${losers.filter((r) => r.rEpisode <= -1).length}/48 <= -1R`);
console.log("");
console.log("LOSERS THAT CROSS THE -1R THRESHOLD");
console.log("================================================================================");
if (!crossing.length) console.log("None.");
for (const row of crossing) {
  const t = row.trade;
  console.log(`${t.tradingDay} ${String(t.symbol).padEnd(6)} ${upper(t.direction).padEnd(5)} pnl=${row.pnl.toFixed(2)} stop=${row.stopPrice.toFixed(4)} peakQty=${row.peakQty}`);
  console.log(`  initialEntry=${row.initial.toFixed(4)}  R(initial)=${fmtR(row.rInitial)}  <=-1=${row.rInitial <= -1 ? "Y" : "N"}`);
  console.log(`  episodeVWAP=${row.episode.toFixed(4)}  R(episode)=${fmtR(row.rEpisode)}  <=-1=${row.rEpisode <= -1 ? "Y" : "N"}`);
  console.log(`  stopEntered=${fmtTime(row.stop?.enteredTime)}  positionAtStop=${Number.isFinite(row.atStop.avg) ? row.atStop.avg.toFixed(4) : "—"} x ${row.atStop.qty}`);
  console.log(`  initialQty=${t.initialQuantity} peakQty=${t.peakQuantity} addsAfterStop=${row.addsAfterStop.length}`);
  for (const fill of [...(t.fills || [])].sort((a,b) => ms(a?.time) - ms(b?.time))) {
    console.log(`    fill ${fmtTime(fill?.time)} ${upper(fill?.instruction).padEnd(12)} qty=${fill?.quantity} px=${fill?.price}`);
  }
}

console.log("");
console.log("ALL LOSERS WHOSE R CHANGES BETWEEN THE TWO BASES");
console.log("================================================================================");
for (const row of changed) {
  const t = row.trade;
  console.log(`${t.tradingDay} ${String(t.symbol).padEnd(6)} ${upper(t.direction).padEnd(5)} Rinit=${fmtR(row.rInitial)} Repisode=${fmtR(row.rEpisode)} delta=${fmtR(row.rEpisode - row.rInitial)} atStopQty=${row.atStop.qty} peakQty=${row.peakQty} addsAfterStop=${row.addsAfterStop.length}`);
}
if (!changed.length) console.log("None.");

console.log("");
console.log("INTERPRETATION");
console.log("================================================================================");
console.log("Do not force a hybrid formula to hit 26/48. If the sole threshold-crossing loser had its first protective stop established before a later add, the later episode VWAP is not historically available at initial-risk time and initial-entry treatment may be defensible for that trade. If the full position was already established before the stop, episode VWAP remains the stronger basis and the preserved 54.2% value may reflect rounding/source-detail differences.");
