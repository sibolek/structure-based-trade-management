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
function timeMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}
function eventTime(order) {
  return timeMs(order?.enteredTime) ?? timeMs(order?.closeTime) ?? timeMs(order?.cancelTime);
}
function isStopOrder(order) {
  return upper(order?.orderType).includes("STOP") && Number.isFinite(Number(order?.stopPrice));
}
function isAccepted(order) { return upper(order?.status) !== "REJECTED"; }
function isClosingInstruction(trade, order) {
  const instruction = upper(order?.instruction);
  if (upper(trade?.direction) === "SHORT") return instruction === "BUY_TO_COVER" || instruction === "BUY";
  return instruction === "SELL";
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
function coversOriginalSize(trade, order) {
  const required = Number(trade?.initialQuantity);
  const offered = stopQuantity(order);
  return Number.isFinite(required) && required > 0 && Number.isFinite(offered) && offered + 1e-9 >= required;
}
function outcome(trade) {
  const pnl = Number(trade?.realizedPnl ?? trade?.realizedGrossPnl);
  return pnl > 1e-9 ? "W" : pnl < -1e-9 ? "L" : "F";
}

function baseCandidates(trade, snapshots) {
  const entry = timeMs(trade?.entryAt);
  const exit = timeMs(trade?.exitAt);
  const fillOrderIds = new Set((trade?.fills || []).map((fill) => String(fill?.orderId || "")).filter(Boolean));

  return snapshots
    .filter((order) => {
      if (String(order?.accountKey || "") !== String(trade?.accountKey || "")) return false;
      if (upper(order?.symbol) !== upper(trade?.symbol)) return false;
      if (upper(order?.positionEffect) !== "CLOSING") return false;
      if (!isClosingInstruction(trade, order) || !isStopOrder(order) || !isAccepted(order)) return false;
      if (!isLossSide(trade, order?.stopPrice)) return false;
      const t = eventTime(order);
      if (!Number.isFinite(t) || !Number.isFinite(entry) || !Number.isFinite(exit)) return false;
      const parentMatch = order?.parentOrderId != null && fillOrderIds.has(String(order.parentOrderId));
      if (parentMatch && t >= entry - 120_000 && t <= exit) return true;
      return t >= entry && t <= exit;
    })
    .sort((a, b) => (eventTime(a) ?? 0) - (eventTime(b) ?? 0));
}

function chooseInitialStop(trade, snapshots, rule) {
  const entry = timeMs(trade?.entryAt);
  const fillOrderIds = new Set((trade?.fills || []).map((fill) => String(fill?.orderId || "")).filter(Boolean));
  const candidates = baseCandidates(trade, snapshots).filter((order) => {
    if (rule.fullCover && !coversOriginalSize(trade, order)) return false;
    const t = eventTime(order);
    const ageSec = Number.isFinite(t) && Number.isFinite(entry) ? (t - entry) / 1000 : null;
    const parentMatch = order?.parentOrderId != null && fillOrderIds.has(String(order.parentOrderId));
    if (rule.parentOnly && !parentMatch) return false;
    if (Number.isFinite(rule.maxAgeSec)) {
      if (!Number.isFinite(ageSec)) return false;
      // Explicit bracket lineage may precede the fill slightly; ordinary orders must be post-entry.
      if (parentMatch) return ageSec >= -120 && ageSec <= rule.maxAgeSec;
      return ageSec >= 0 && ageSec <= rule.maxAgeSec;
    }
    return true;
  });
  return candidates[0] || null;
}

function enrichedForRule(trades, snapshots, rule) {
  const rows = [];
  for (const trade of trades) {
    const stop = chooseInitialStop(trade, snapshots, rule);
    if (!stop) continue;
    const initialStop = Number(stop.stopPrice);
    const entry = Number(trade?.entryPrice ?? trade?.entryVWAP);
    const qty = Number(trade?.initialQuantity);
    const risk = Math.abs(entry - initialStop) * qty;
    if (![initialStop, entry, qty, risk].every(Number.isFinite) || qty <= 0 || risk <= 0) continue;
    rows.push({
      ...trade,
      initialStop,
      initialRisk: risk,
      initialStopEvidence: {
        orderId: stop.orderId ?? null,
        enteredTime: stop.enteredTime ?? null,
        status: upper(stop.status),
        quantity: stopQuantity(stop),
        parentOrderId: stop.parentOrderId ?? null,
        ageSec: (eventTime(stop) - timeMs(trade.entryAt)) / 1000,
      },
    });
  }
  return rows;
}

function fmt(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
}

const raw = readJson(RAW_PATH);
const study = readJson(STUDY_PATH);
const snapshots = Array.isArray(raw?.orderSnapshots) ? raw.orderSnapshots : [];
const trades = Array.isArray(study?.trades) ? study.trades : [];

const rules = [
  { name: "parent lineage only", parentOnly: true },
  { name: "parent lineage + full cover", parentOnly: true, fullCover: true },
  { name: "<=15s loss-side", maxAgeSec: 15 },
  { name: "<=15s + full cover", maxAgeSec: 15, fullCover: true },
  { name: "<=30s loss-side", maxAgeSec: 30 },
  { name: "<=30s + full cover", maxAgeSec: 30, fullCover: true },
  { name: "<=60s loss-side", maxAgeSec: 60 },
  { name: "<=60s + full cover", maxAgeSec: 60, fullCover: true },
  { name: "<=120s loss-side", maxAgeSec: 120 },
  { name: "<=120s + full cover", maxAgeSec: 120, fullCover: true },
  { name: "<=300s loss-side", maxAgeSec: 300 },
  { name: "<=300s + full cover", maxAgeSec: 300, fullCover: true },
  { name: "first loss-side anytime" },
  { name: "first anytime + full cover", fullCover: true },
];

console.log("ExecutionOS initial-risk reconstruction diagnostic");
console.log("================================================================================");
console.log(`Recovered study population: ${trades.length} trades`);
console.log("Historical R target: 83 trades / 35 winners / 48 losers");
console.log("Historical R stats: winner median/mean 0.31R/0.60R; loser median/mean -1.00R/-1.01R");
console.log("Historical thresholds: 68.6% winners <0.5R; 82.9% winners <1R; 54.2% losers <=-1R");
console.log("");
console.log("RULE COMPARISON");
console.log("================================================================================");
console.log("Rule                         N   W   L   F   MedW   MeanW   MedL   MeanL   W<.5  W<1   L<=-1");

const results = [];
for (const rule of rules) {
  const subset = enrichedForRule(trades, snapshots, rule);
  const summary = summarizeRMultiples(subset);
  const w = subset.filter((trade) => outcome(trade) === "W").length;
  const l = subset.filter((trade) => outcome(trade) === "L").length;
  const f = subset.filter((trade) => outcome(trade) === "F").length;
  results.push({ rule, subset, summary, w, l, f });
  console.log(
    `${rule.name.padEnd(28)} ${String(subset.length).padStart(3)} ${String(w).padStart(3)} ${String(l).padStart(3)} ${String(f).padStart(3)} ` +
    `${fmt(summary?.winner?.medianR, 2).padStart(6)} ${fmt(summary?.winner?.meanR, 2).padStart(7)} ` +
    `${fmt(summary?.loser?.medianR, 2).padStart(6)} ${fmt(summary?.loser?.meanR, 2).padStart(7)} ` +
    `${(summary?.pctWinnersBelowHalfR == null ? "—" : `${(summary.pctWinnersBelowHalfR * 100).toFixed(1)}%`).padStart(6)} ` +
    `${(summary?.pctWinnersBelowOneR == null ? "—" : `${(summary.pctWinnersBelowOneR * 100).toFixed(1)}%`).padStart(5)} ` +
    `${(summary?.pctLosersAtOrBeyondMinusOneR == null ? "—" : `${(summary.pctLosersAtOrBeyondMinusOneR * 100).toFixed(1)}%`).padStart(7)}`,
  );
}

function score(result) {
  const s = result.summary;
  let value = Math.abs(result.subset.length - 83) * 8 + Math.abs(result.w - 35) * 4 + Math.abs(result.l - 48) * 4;
  const terms = [
    [s?.winner?.medianR, 0.31, 8], [s?.winner?.meanR, 0.60, 6],
    [s?.loser?.medianR, -1.00, 8], [s?.loser?.meanR, -1.01, 6],
    [s?.pctWinnersBelowHalfR, 0.686, 20], [s?.pctWinnersBelowOneR, 0.829, 20],
    [s?.pctLosersAtOrBeyondMinusOneR, 0.542, 20],
  ];
  for (const [actual, target, weight] of terms) if (Number.isFinite(actual)) value += Math.abs(actual - target) * weight;
  return value;
}

console.log("");
console.log("CLOSEST RULES TO PRESERVED FINGERPRINT (diagnostic only)");
console.log("================================================================================");
for (const result of [...results].sort((a, b) => score(a) - score(b)).slice(0, 5)) {
  console.log(`${result.rule.name}: N=${result.subset.length} W/L/F=${result.w}/${result.l}/${result.f} score=${score(result).toFixed(2)}`);
}

console.log("");
console.log("Interpretation: do not choose a rule merely because it numerically matches 83. A recovered initial stop must be defensible as the original risk-bearing stop, not a later tightened loss-side stop.");
