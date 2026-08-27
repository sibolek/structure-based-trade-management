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
function stopQty(order) {
  for (const value of [order?.quantity, order?.remainingQuantity, order?.filledQuantity]) {
    const n = Math.abs(Number(value));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
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
function recoveredCandidate(trade, snapshots) {
  const first = acceptedStopsInEpisode(trade, snapshots)[0] || null;
  if (!first) return null;
  const episodeBasis = Number(trade?.entryVWAP ?? trade?.entryPrice);
  if (!Number.isFinite(episodeBasis) || !lossSide(trade?.direction, episodeBasis, first?.stopPrice)) return null;
  return { trade, stop: first };
}
function withRisk(row, entry, quantity, label) {
  const stopPrice = Number(row?.stop?.stopPrice);
  const e = Number(entry);
  const q = Number(quantity);
  const risk = Math.abs(e - stopPrice) * q;
  if (![stopPrice, e, q, risk].every(Number.isFinite) || q <= 0 || risk <= 0) return null;
  return { ...row.trade, initialStop: stopPrice, initialRisk: risk, riskBasis: label };
}
function summarize(label, rows) {
  const s = summarizeRMultiples(rows);
  const pct = (v) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
  const n = (v) => Number.isFinite(v) ? v.toFixed(2) : "—";
  console.log(
    `${label.padEnd(40)} N=${String(s.tradesWithInitialRisk).padStart(3)} W/L=${s.winners}/${s.losers} ` +
    `Med/Mean W=${n(s.winner.medianR)}/${n(s.winner.meanR)} ` +
    `L=${n(s.loser.medianR)}/${n(s.loser.meanR)} ` +
    `W<.5=${pct(s.pctWinnersBelowHalfR)} W<1=${pct(s.pctWinnersBelowOneR)} ` +
    `L<=-1=${pct(s.pctLosersAtOrBeyondMinusOneR)}`,
  );
  return s;
}

const raw = readJson(RAW_PATH);
const study = readJson(STUDY_PATH);
const snapshots = Array.isArray(raw?.orderSnapshots) ? raw.orderSnapshots : [];
const trades = Array.isArray(study?.trades) ? study.trades : [];
const recovered = trades.map((trade) => recoveredCandidate(trade, snapshots)).filter(Boolean);

const variants = [
  {
    name: "initial price x initial qty",
    rows: recovered.map((row) => withRisk(row, Number(row.trade?.entryPrice), Number(row.trade?.initialQuantity), "initial price x initial qty")).filter(Boolean),
  },
  {
    name: "episode VWAP x initial qty",
    rows: recovered.map((row) => withRisk(row, Number(row.trade?.entryVWAP), Number(row.trade?.initialQuantity), "episode VWAP x initial qty")).filter(Boolean),
  },
  {
    name: "initial price x peak qty",
    rows: recovered.map((row) => withRisk(row, Number(row.trade?.entryPrice), Number(row.trade?.peakQuantity), "initial price x peak qty")).filter(Boolean),
  },
  {
    name: "episode VWAP x peak qty",
    rows: recovered.map((row) => withRisk(row, Number(row.trade?.entryVWAP), Number(row.trade?.peakQuantity), "episode VWAP x peak qty")).filter(Boolean),
  },
  {
    name: "initial price x stop qty",
    rows: recovered.map((row) => withRisk(row, Number(row.trade?.entryPrice), stopQty(row.stop), "initial price x stop qty")).filter(Boolean),
  },
  {
    name: "episode VWAP x stop qty",
    rows: recovered.map((row) => withRisk(row, Number(row.trade?.entryVWAP), stopQty(row.stop), "episode VWAP x stop qty")).filter(Boolean),
  },
  {
    name: "position-at-stop avg x open qty",
    rows: recovered.map((row) => {
      const at = positionAt(row.trade, ms(row.stop?.enteredTime));
      return withRisk(row, at.avg, at.qty, "position-at-stop avg x open qty");
    }).filter(Boolean),
  },
  {
    name: "position-at-stop avg x peak qty",
    rows: recovered.map((row) => {
      const at = positionAt(row.trade, ms(row.stop?.enteredTime));
      return withRisk(row, at.avg, Number(row.trade?.peakQuantity), "position-at-stop avg x peak qty");
    }).filter(Boolean),
  },
];

console.log("ExecutionOS final historical R-basis diagnostic");
console.log("================================================================================");
console.log("Population frozen: first accepted stop must be loss-side relative to episode blended VWAP");
console.log(`Recovered population: ${recovered.length} trades (${recovered.filter((r) => outcome(r.trade) === "W").length} winners / ${recovered.filter((r) => outcome(r.trade) === "L").length} losers)`);
console.log("Historical target: 83 trades / 35 winners / 48 losers");
console.log("Target R: W med/mean 0.31/0.60; L med/mean -1.00/-1.01; W<.5 68.6%; W<1 82.9%; L<=-1 54.2%");
console.log("");
console.log("DENOMINATOR COMPARISON ON FIXED 83-TRADE POPULATION");
console.log("================================================================================");
for (const variant of variants) summarize(variant.name, variant.rows);

console.log("");
console.log("SCALED WINNERS IN RECOVERED POPULATION");
console.log("================================================================================");
for (const { trade, stop } of recovered.filter(({ trade }) => outcome(trade) === "W" && Number(trade?.peakQuantity) > Number(trade?.initialQuantity) + 1e-9)) {
  const at = positionAt(trade, ms(stop?.enteredTime));
  console.log(
    `${trade.tradingDay} ${String(trade.symbol).padEnd(6)} ${upper(trade.direction).padEnd(5)} ` +
    `entry=${Number(trade.entryPrice).toFixed(4)} episodeVWAP=${Number(trade.entryVWAP).toFixed(4)} ` +
    `stop=${Number(stop.stopPrice).toFixed(4)} initQty=${trade.initialQuantity} peakQty=${trade.peakQuantity} ` +
    `atStopAvg=${Number.isFinite(at.avg) ? at.avg.toFixed(4) : "—"} atStopQty=${at.qty} realized=${Number(trade.realizedPnl ?? trade.realizedGrossPnl).toFixed(2)}`,
  );
}

console.log("");
console.log("INTERPRETATION");
console.log("================================================================================");
console.log("If one denominator reproduces both winner and loser fingerprints on this exact 83-trade population, Gate 5 can be enriched and regression-tested. If the loser fingerprint stays exact but winner mean remains low under every defensible denominator, the remaining issue is winner-side original-stop provenance rather than population membership or size basis.");
