import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_PATH = path.join(HERE, "raw-schwab-history.json");
const STUDY_PATH = path.join(HERE, "historical-study-trades.json");

function readJson(p) {
  if (!fs.existsSync(p)) throw new Error(`Missing local research file: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function upper(v) { return String(v || "").toUpperCase(); }
function t(v) { const n = Date.parse(v || ""); return Number.isFinite(n) ? n : null; }
function fmtTs(v) { return v || "—"; }
function isStop(o) { return upper(o?.orderType).includes("STOP") && Number.isFinite(Number(o?.stopPrice)); }
function isNvda(o) { return upper(o?.symbol) === "NVDA"; }
function closingLong(o) { return upper(o?.positionEffect) === "CLOSING" && upper(o?.instruction) === "SELL"; }
function eventTime(o) { return t(o?.enteredTime) ?? t(o?.closeTime) ?? t(o?.cancelTime); }

const raw = readJson(RAW_PATH);
const study = readJson(STUDY_PATH);
const snapshots = Array.isArray(raw?.orderSnapshots) ? raw.orderSnapshots : [];
const trades = Array.isArray(study?.trades) ? study.trades : [];

const trade = trades.find((x) => x.tradingDay === "2026-08-20" && upper(x.symbol) === "NVDA" && upper(x.direction) === "LONG" && Number(x.realizedPnl ?? x.realizedGrossPnl) < 0 && Math.abs(Number(x.entryPrice) - 217.9105) < 0.01);
if (!trade) throw new Error("Could not locate target 2026-08-20 NVDA long loser.");

const entryAt = t(trade.entryAt);
const exitAt = t(trade.exitAt);
const windowStart = entryAt - 30 * 60 * 1000;
const windowEnd = exitAt + 30 * 60 * 1000;

const relevant = snapshots
  .filter((o) => String(o?.accountKey || "") === String(trade?.accountKey || ""))
  .filter(isNvda)
  .filter(closingLong)
  .filter(isStop)
  .filter((o) => {
    const et = eventTime(o);
    return Number.isFinite(et) && et >= windowStart && et <= windowEnd;
  })
  .sort((a, b) => (eventTime(a) ?? 0) - (eventTime(b) ?? 0));

console.log("ExecutionOS NVDA 2026-08-20 stop-provenance forensic");
console.log("================================================================================");
console.log(`Trade entry: ${trade.entryAt}  exit: ${trade.exitAt}`);
console.log(`Initial entry=${Number(trade.entryPrice).toFixed(4)} episodeVWAP=${Number(trade.entryVWAP).toFixed(4)} initialQty=${trade.initialQuantity} peakQty=${trade.peakQuantity} realized=${Number(trade.realizedPnl ?? trade.realizedGrossPnl).toFixed(2)}`);
console.log("");
console.log("FILLS");
console.log("================================================================================");
for (const f of [...(trade.fills || [])].sort((a,b) => (t(a.time) ?? 0) - (t(b.time) ?? 0))) {
  console.log(`${fmtTs(f.time)}  ${upper(f.instruction).padEnd(12)} qty=${f.quantity} px=${f.price} orderId=${f.orderId ?? "—"}`);
}

console.log("");
console.log("NVDA CLOSING STOP SNAPSHOTS WITHIN ±30 MIN OF EPISODE");
console.log("================================================================================");
for (const o of relevant) {
  const et = eventTime(o);
  const rel = et < entryAt ? "PRE" : et > exitAt ? "POST" : "IN";
  const ageSec = Number.isFinite(et) ? (et - entryAt) / 1000 : null;
  console.log(
    `${rel.padEnd(4)} ${fmtTs(o.enteredTime).padEnd(25)} age=${Number.isFinite(ageSec) ? ageSec.toFixed(1).padStart(7) : "      —"}s ` +
    `stop=${Number(o.stopPrice).toFixed(4)} qty=${o.quantity ?? "—"} filled=${o.filledQuantity ?? "—"} rem=${o.remainingQuantity ?? "—"} ` +
    `status=${upper(o.status).padEnd(18)} orderId=${o.orderId ?? "—"} parent=${o.parentOrderId ?? "—"}`
  );
}
if (!relevant.length) console.log("None.");

console.log("");
console.log("STRICT IN-EPISODE ACCEPTED STOPS");
console.log("================================================================================");
const strict = relevant.filter((o) => upper(o.status) !== "REJECTED" && eventTime(o) >= entryAt && eventTime(o) <= exitAt);
for (const o of strict) console.log(`${o.enteredTime} stop=${o.stopPrice} status=${upper(o.status)} qty=${o.quantity ?? "—"} orderId=${o.orderId ?? "—"} parent=${o.parentOrderId ?? "—"}`);
if (!strict.length) console.log("None.");

console.log("");
console.log("INTERPRETATION");
console.log("================================================================================");
console.log("If a defensible earlier loss-side stop appears before 216.76 (especially a replaced/canceled order tied to this episode), then 216.76 was a later management stop and should not define initial risk. If no such stop exists, episode VWAP x peak quantity remains the best reconstructible basis and the 54.2% historical threshold is likely a one-trade source-detail/rounding discrepancy rather than evidence for a hybrid formula.");
