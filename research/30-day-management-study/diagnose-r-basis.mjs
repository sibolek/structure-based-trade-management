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
function lossSideForEntry(direction, entry, stopPrice) {
  const stop = Number(stopPrice);
  if (![entry, stop].every(Number.isFinite)) return false;
  return upper(direction) === "SHORT" ? stop > entry : stop < entry;
}
function stopQty(order) {
  for (const value of [order?.quantity, order?.remainingQuantity, order?.filledQuantity]) {
    const n = Math.abs(Number(value));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
function firstCleanLossStop(trade, snapshots) {
  const entryAt = ms(trade?.entryAt);
  const exitAt = ms(trade?.exitAt);
  const entryBasis = Number(trade?.entryPrice ?? trade?.entryVWAP);
  if (![entryAt, exitAt, entryBasis].every(Number.isFinite)) return null;

  const acceptedStops = snapshots
    .filter((order) => {
      if (String(order?.accountKey || "") !== String(trade?.accountKey || "")) return false;
      if (upper(order?.symbol) !== upper(trade?.symbol)) return false;
      if (upper(order?.positionEffect) !== "CLOSING") return false;
      if (!accepted(order) || !isStop(order) || !closingFor(trade, order)) return false;
      const entered = ms(order?.enteredTime);
      return Number.isFinite(entered) && entered >= entryAt && entered <= exitAt;
    })
    .sort((a, b) => ms(a?.enteredTime) - ms(b?.enteredTime));

  // Defensible original-risk provenance: the first accepted stop observed in the episode
  // must itself be loss-side. This excludes later loss-side management stops such as JLHL.
  const first = acceptedStops[0] || null;
  if (!first || !lossSideForEntry(trade?.direction, entryBasis, first?.stopPrice)) return null;
  return first;
}
function isOpeningFill(trade, fill) {
  const instruction = upper(fill?.instruction);
  if (upper(trade?.direction) === "SHORT") return instruction === "SELL_SHORT";
  return instruction === "BUY";
}
function isClosingFill(trade, fill) {
  const instruction = upper(fill?.instruction);
  if (upper(trade?.direction) === "SHORT") return instruction === "BUY_TO_COVER" || instruction === "BUY";
  return instruction === "SELL";
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
      const newQty = qty + q;
      avg = qty > 0 && Number.isFinite(avg) ? ((avg * qty) + (px * q)) / newQty : px;
      qty = newQty;
    } else if (isClosingFill(trade, fill)) {
      qty = Math.max(0, qty - Math.min(qty, q));
      if (qty === 0) avg = null;
    }
  }
  return { qty, avg };
}
function withRisk(trade, stop, entry, quantity, label) {
  const stopPrice = Number(stop?.stopPrice);
  const q = Number(quantity);
  const e = Number(entry);
  const risk = Math.abs(e - stopPrice) * q;
  if (![stopPrice, q, e, risk].every(Number.isFinite) || q <= 0 || risk <= 0) return null;
  return {
    ...trade,
    initialStop: stopPrice,
    initialRisk: risk,
    riskBasis: label,
  };
}
function summarize(label, rows) {
  const s = summarizeRMultiples(rows);
  const pct = (v) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
  const n = (v) => Number.isFinite(v) ? v.toFixed(2) : "—";
  console.log(
    `${label.padEnd(38)} N=${String(s.tradesWithInitialRisk).padStart(3)} W/L=${s.winners}/${s.losers} ` +
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

const clean = trades.map((trade) => {
  const stop = firstCleanLossStop(trade, snapshots);
  return stop ? { trade, stop } : null;
}).filter(Boolean);

function variant(name, resolver) {
  return {
    name,
    rows: clean.map(({ trade, stop }) => {
      const basis = resolver(trade, stop);
      return basis ? withRisk(trade, stop, basis.entry, basis.quantity, name) : null;
    }).filter(Boolean),
  };
}

const variants = [
  variant("initial price x initial qty", (trade) => ({ entry: Number(trade?.entryPrice), quantity: Number(trade?.initialQuantity) })),
  variant("episode VWAP x initial qty", (trade) => ({ entry: Number(trade?.entryVWAP), quantity: Number(trade?.initialQuantity) })),
  variant("initial price x stop qty", (trade, stop) => ({ entry: Number(trade?.entryPrice), quantity: stopQty(stop) })),
  variant("episode VWAP x stop qty", (trade, stop) => ({ entry: Number(trade?.entryVWAP), quantity: stopQty(stop) })),
  variant("initial price x peak qty", (trade) => ({ entry: Number(trade?.entryPrice), quantity: Number(trade?.peakQuantity) })),
  variant("episode VWAP x peak qty", (trade) => ({ entry: Number(trade?.entryVWAP), quantity: Number(trade?.peakQuantity) })),
  variant("position-at-stop avg x open qty", (trade, stop) => {
    const at = positionAt(trade, ms(stop?.enteredTime));
    return { entry: at.avg, quantity: at.qty };
  }),
  variant("position-at-stop avg x stop qty", (trade, stop) => {
    const at = positionAt(trade, ms(stop?.enteredTime));
    return { entry: at.avg, quantity: stopQty(stop) };
  }),
];

console.log("ExecutionOS historical R-basis diagnostic");
console.log("================================================================================");
console.log("Population rule: first accepted stop observed in episode must already be loss-side");
console.log(`Clean stop-evidence population: ${clean.length} trades`);
console.log("Historical target: 83 trades / 35 winners / 48 losers");
console.log("Target R: W med/mean 0.31/0.60; L med/mean -1.00/-1.01; W<.5 68.6%; W<1 82.9%; L<=-1 54.2%");
console.log("");
console.log("R DENOMINATOR VARIANTS");
console.log("================================================================================");
for (const v of variants) summarize(v.name, v.rows);

const scaled = clean.filter(({ trade }) => Number(trade?.peakQuantity) > Number(trade?.initialQuantity) + 1e-9);
const stopQtyDiff = clean.filter(({ trade, stop }) => {
  const sq = stopQty(stop);
  return Number.isFinite(sq) && Number.isFinite(Number(trade?.initialQuantity)) && Math.abs(sq - Number(trade.initialQuantity)) > 1e-9;
});
const entryVwapDiff = clean.filter(({ trade }) => {
  const a = Number(trade?.entryPrice);
  const b = Number(trade?.entryVWAP);
  return [a, b].every(Number.isFinite) && Math.abs(a - b) > 1e-9;
});

console.log("");
console.log("SCALING / BASIS DIFFERENCE COUNTS");
console.log("================================================================================");
console.log(`Trades with peakQuantity > initialQuantity: ${scaled.length}`);
console.log(`Trades where stop quantity differs from initial quantity: ${stopQtyDiff.length}`);
console.log(`Trades where episode entryVWAP differs from initial-order entryPrice: ${entryVwapDiff.length}`);

console.log("");
console.log("SCALED TRADE EXAMPLES");
console.log("================================================================================");
for (const { trade, stop } of scaled.slice(0, 20)) {
  const at = positionAt(trade, ms(stop?.enteredTime));
  console.log(
    `${trade.tradingDay} ${String(trade.symbol).padEnd(6)} ${upper(trade.direction).padEnd(5)} ${outcome(trade)} ` +
    `entry=${Number(trade.entryPrice).toFixed(4)} episodeVWAP=${Number(trade.entryVWAP).toFixed(4)} ` +
    `initQty=${trade.initialQuantity} peakQty=${trade.peakQuantity} stopQty=${stopQty(stop) ?? "—"} ` +
    `atStopAvg=${Number.isFinite(at.avg) ? at.avg.toFixed(4) : "—"} atStopQty=${at.qty} stop=${Number(stop.stopPrice).toFixed(4)}`,
  );
}
if (!scaled.length) console.log("None.");

console.log("");
console.log("Interpretation: do not select the closest numerical variant by score alone. Prefer the denominator convention that is both broker-history defensible and consistently reproduces the preserved R distribution. If none does, the remaining problem is stop provenance/membership rather than entry/quantity basis.");
