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
function timeMs(value) { const ms = Date.parse(value || ""); return Number.isFinite(ms) ? ms : null; }
function eventTime(order) { return timeMs(order?.enteredTime) ?? timeMs(order?.closeTime) ?? timeMs(order?.cancelTime); }
function isStopOrder(order) { return upper(order?.orderType).includes("STOP") && Number.isFinite(Number(order?.stopPrice)); }
function isAccepted(order) { return upper(order?.status) !== "REJECTED"; }
function isWinner(trade) { return Number(trade?.realizedPnl ?? trade?.realizedGrossPnl) > 1e-9; }
function isClosingInstruction(trade, order) {
  const instruction = upper(order?.instruction);
  return upper(trade?.direction) === "SHORT"
    ? instruction === "BUY_TO_COVER" || instruction === "BUY"
    : instruction === "SELL";
}
function isLossSide(trade, stopPrice) {
  const entry = Number(trade?.entryPrice ?? trade?.entryVWAP);
  const stop = Number(stopPrice);
  if (![entry, stop].every(Number.isFinite)) return false;
  return upper(trade?.direction) === "SHORT" ? stop > entry : stop < entry;
}
function stopQuantity(order) {
  const qty = Number(order?.quantity ?? order?.remainingQuantity ?? order?.filledQuantity);
  return Number.isFinite(qty) ? Math.abs(qty) : null;
}
function fullCover(trade, order) {
  const required = Number(trade?.initialQuantity);
  const offered = stopQuantity(order);
  return Number.isFinite(required) && required > 0 && Number.isFinite(offered) && offered + 1e-9 >= required;
}
function firstLossSideStop(trade, snapshots) {
  const entry = timeMs(trade?.entryAt);
  const exit = timeMs(trade?.exitAt);
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) return null;
  return snapshots
    .filter((order) => {
      if (String(order?.accountKey || "") !== String(trade?.accountKey || "")) return false;
      if (upper(order?.symbol) !== upper(trade?.symbol)) return false;
      if (upper(order?.positionEffect) !== "CLOSING") return false;
      if (!isClosingInstruction(trade, order) || !isStopOrder(order) || !isAccepted(order)) return false;
      if (!isLossSide(trade, order?.stopPrice)) return false;
      const t = eventTime(order);
      return Number.isFinite(t) && t >= entry && t <= exit;
    })
    .sort((a, b) => eventTime(a) - eventTime(b))[0] || null;
}
function enrich(trade, stop) {
  const entry = Number(trade?.entryPrice ?? trade?.entryVWAP);
  const initialStop = Number(stop?.stopPrice);
  const qty = Number(trade?.initialQuantity);
  const risk = Math.abs(entry - initialStop) * qty;
  const pnl = Number(trade?.realizedPnl ?? trade?.realizedGrossPnl);
  return {
    ...trade,
    initialStop,
    initialRisk: risk,
    reconstructedR: Number.isFinite(risk) && risk > 0 ? pnl / risk : null,
    initialStopEvidence: {
      orderId: stop?.orderId ?? null,
      enteredTime: stop?.enteredTime ?? null,
      status: upper(stop?.status),
      quantity: stopQuantity(stop),
      fullCover: fullCover(trade, stop),
      ageSec: (eventTime(stop) - timeMs(trade?.entryAt)) / 1000,
    },
  };
}
function fmt(value, digits = 2) { return Number.isFinite(value) ? Number(value).toFixed(digits) : "—"; }
function pct(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—"; }
function score(summary) {
  let s = 0;
  const terms = [
    [summary?.winner?.medianR, 0.31, 12],
    [summary?.winner?.meanR, 0.60, 12],
    [summary?.pctWinnersBelowHalfR, 0.686, 30],
    [summary?.pctWinnersBelowOneR, 0.829, 30],
  ];
  for (const [actual, target, weight] of terms) if (Number.isFinite(actual)) s += Math.abs(actual - target) * weight;
  return s;
}

const raw = readJson(RAW_PATH);
const study = readJson(STUDY_PATH);
const snapshots = Array.isArray(raw?.orderSnapshots) ? raw.orderSnapshots : [];
const trades = Array.isArray(study?.trades) ? study.trades : [];
const enriched = trades.map((trade) => {
  const stop = firstLossSideStop(trade, snapshots);
  return stop ? enrich(trade, stop) : null;
}).filter(Boolean);
const winners = enriched.filter(isWinner);
const losers = enriched.filter((trade) => Number(trade?.realizedPnl ?? trade?.realizedGrossPnl) < -1e-9);

console.log("ExecutionOS R-subset two-winner forensic diagnostic");
console.log("================================================================================");
console.log(`Base first-loss-side-anytime subset: ${enriched.length} trades / ${winners.length} winners / ${losers.length} losers`);
console.log("Historical target:                   83 trades / 35 winners / 48 losers");
console.log("");
console.log("WINNERS — SORTED BY RECONSTRUCTED R (highest first)");
console.log("================================================================================");
console.log("Day        Symbol Dir    R      PnL      StopAge  StopPx    Qty/Cover  HoldMin");
for (const trade of [...winners].sort((a, b) => b.reconstructedR - a.reconstructedR)) {
  const e = trade.initialStopEvidence;
  const holdMin = (Date.parse(trade.exitAt) - Date.parse(trade.entryAt)) / 60000;
  console.log(
    `${trade.tradingDay} ${String(trade.symbol).padEnd(6)} ${upper(trade.direction).padEnd(5)} ` +
    `${fmt(trade.reconstructedR, 2).padStart(6)} ${fmt(Number(trade.realizedPnl), 2).padStart(8)} ` +
    `${fmt(e.ageSec, 1).padStart(8)}s ${fmt(trade.initialStop, 4).padStart(9)} ` +
    `${String(e.quantity ?? "—").padStart(4)}/${e.fullCover ? "Y" : "N"} ${fmt(holdMin, 2).padStart(8)}`,
  );
}

const pairs = [];
for (let i = 0; i < winners.length; i += 1) {
  for (let j = i + 1; j < winners.length; j += 1) {
    const removeIds = new Set([winners[i].id, winners[j].id]);
    const subset = enriched.filter((trade) => !removeIds.has(trade.id));
    const summary = summarizeRMultiples(subset);
    pairs.push({ a: winners[i], b: winners[j], summary, score: score(summary) });
  }
}

console.log("");
console.log("TOP TWO-WINNER EXCLUSIONS BY PRESERVED WINNER-R FINGERPRINT");
console.log("================================================================================");
console.log("Rank  Trade A                         Trade B                         MedW  MeanW  W<.5  W<1   Score");
for (const [index, row] of pairs.sort((a, b) => a.score - b.score).slice(0, 20).entries()) {
  const label = (t) => `${t.tradingDay} ${String(t.symbol).padEnd(5)} R=${fmt(t.reconstructedR, 2)} age=${fmt(t.initialStopEvidence.ageSec, 0)}s`;
  console.log(
    `${String(index + 1).padStart(4)}  ${label(row.a).padEnd(31)} ${label(row.b).padEnd(31)} ` +
    `${fmt(row.summary.winner.medianR, 2).padStart(5)} ${fmt(row.summary.winner.meanR, 2).padStart(6)} ` +
    `${pct(row.summary.pctWinnersBelowHalfR).padStart(6)} ${pct(row.summary.pctWinnersBelowOneR).padStart(5)} ${fmt(row.score, 2).padStart(7)}`,
  );
}

console.log("");
console.log("PROVENANCE FLAGS AMONG THE 37 WINNERS");
console.log("================================================================================");
const late = winners.filter((t) => t.initialStopEvidence.ageSec > 300);
const partial = winners.filter((t) => !t.initialStopEvidence.fullCover);
const hugeR = winners.filter((t) => t.reconstructedR >= 2);
console.log(`First loss-side stop entered >300s after entry: ${late.length}`);
for (const t of late) console.log(`  ${t.tradingDay} ${t.symbol} R=${fmt(t.reconstructedR, 2)} age=${fmt(t.initialStopEvidence.ageSec, 1)}s cover=${t.initialStopEvidence.fullCover ? "Y" : "N"}`);
console.log(`First loss-side stop did not cover original size: ${partial.length}`);
for (const t of partial) console.log(`  ${t.tradingDay} ${t.symbol} R=${fmt(t.reconstructedR, 2)} age=${fmt(t.initialStopEvidence.ageSec, 1)}s qty=${t.initialStopEvidence.quantity}/${t.initialQuantity}`);
console.log(`Reconstructed winner >= +2R: ${hugeR.length}`);
for (const t of hugeR) console.log(`  ${t.tradingDay} ${t.symbol} R=${fmt(t.reconstructedR, 2)} age=${fmt(t.initialStopEvidence.ageSec, 1)}s cover=${t.initialStopEvidence.fullCover ? "Y" : "N"}`);

console.log("");
console.log("Interpretation: pair ranking is only a clue. Prefer an independently defensible provenance rule, especially evidence that a first observed loss-side stop was entered too late to represent original risk or did not cover the original position.");
