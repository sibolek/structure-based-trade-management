import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.join(HERE, "normalized-trades.json");
const START = "2026-07-22";
const END = "2026-08-21";

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Input file not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function pnl(trade) {
  return Number(trade?.realizedPnl ?? trade?.realizedGrossPnl ?? 0);
}

function outcome(trade) {
  const value = pnl(trade);
  if (value > 1e-9) return "W";
  if (value < -1e-9) return "L";
  return "F";
}

function holdSec(trade) {
  const a = Date.parse(trade.entryAt || trade.firstFillAt || "");
  const b = Date.parse(trade.exitAt || trade.flatAt || "");
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / 1000 : null;
}

function et(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(d);
}

function session(value) {
  const d = new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const mins = Number(m.hour) * 60 + Number(m.minute);
  if (mins < 9 * 60 + 30) return "PRE";
  if (mins < 16 * 60) return "RTH";
  return "POST";
}

function fmtTrade(trade) {
  const hs = holdSec(trade);
  const orders = [...new Set((trade.fills || []).map((f) => String(f.orderId || "")).filter(Boolean))];
  return `${trade.tradingDay} ${et(trade.entryAt)} ${session(trade.entryAt).padEnd(4)} ${String(trade.symbol).padEnd(6)} ${String(trade.direction).padEnd(5)} ${outcome(trade)} hold=${hs == null ? "—" : (hs / 60).toFixed(3)}m pnl=${pnl(trade).toFixed(4)} fills=${(trade.fills || []).length} orders=${orders.length}`;
}

const data = readJson(INPUT);
const trades = (Array.isArray(data.trades) ? data.trades : [])
  .filter((t) => t.tradingDay >= START && t.tradingDay <= END)
  .sort((a, b) => Date.parse(a.entryAt) - Date.parse(b.entryAt));

const winners = trades.filter((t) => outcome(t) === "W");
const losers = trades.filter((t) => outcome(t) === "L");
const flats = trades.filter((t) => outcome(t) === "F");

console.log("ExecutionOS one-trade delta forensic diagnostic");
console.log("================================================================================");
console.log(`Window:       ${START} -> ${END}`);
console.log(`Current W/L/F ${winners.length}/${losers.length}/${flats.length} (${trades.length})`);
console.log("Target W/L/F  265/118/1 (384)");
console.log("\nA valid explanation must be source/methodology based; none of the sections below auto-excludes a trade.\n");

console.log("JULY 22 BOUNDARY — ALL EPISODES IN CHRONOLOGICAL ORDER");
console.log("================================================================================");
const boundary = trades.filter((t) => t.tradingDay === START);
boundary.forEach((t, i) => console.log(`${String(i + 1).padStart(2)}  ${fmtTrade(t)}`));
if (boundary.length) {
  const first = boundary[0];
  console.log(`\nFirst July 22 episode is ${outcome(first) === "W" ? "a WINNER" : outcome(first) === "L" ? "a LOSER" : "FLAT"}.`);
  if (outcome(first) === "W") {
    console.log("A source window beginning after that episode but before the next July 22 episode would reduce 266/118/1 to 265/118/1 without changing loser/flat counts.");
  }
}

console.log("\nSMALLEST POSITIVE-P&L WINNERS");
console.log("================================================================================");
winners.slice().sort((a, b) => pnl(a) - pnl(b)).slice(0, 20).forEach((t, i) => {
  console.log(`${String(i + 1).padStart(2)}  ${fmtTrade(t)}`);
});
console.log("\nUse this only to investigate fee/statement-treatment edge cases; a small gross winner is not automatically excludable.");

console.log("\nSAME-SYMBOL RE-ENTRIES WITH <= 60 SECOND FLAT GAP");
console.log("================================================================================");
const byKey = new Map();
for (const t of trades) {
  const key = `${t.tradingDay}|${t.accountKey}|${t.symbol}`;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(t);
}
const near = [];
for (const arr of byKey.values()) {
  arr.sort((a, b) => Date.parse(a.entryAt) - Date.parse(b.entryAt));
  for (let i = 1; i < arr.length; i += 1) {
    const prior = arr[i - 1];
    const next = arr[i];
    const gap = (Date.parse(next.entryAt) - Date.parse(prior.exitAt)) / 1000;
    if (Number.isFinite(gap) && gap >= 0 && gap <= 60) near.push({ prior, next, gap });
  }
}
near.sort((a, b) => a.gap - b.gap);
if (!near.length) console.log("None.");
else near.slice(0, 40).forEach((x, i) => {
  console.log(`${String(i + 1).padStart(2)}  gap=${x.gap.toFixed(3)}s  ${x.prior.tradingDay} ${x.prior.symbol}  ${outcome(x.prior)}→${outcome(x.next)}  ${et(x.prior.entryAt)}-${et(x.prior.exitAt)} then ${et(x.next.entryAt)}-${et(x.next.exitAt)}  pnl=${pnl(x.prior).toFixed(2)} + ${pnl(x.next).toFixed(2)}`);
});
console.log("\nNear re-entries are clues only. Flat-to-flat semantics normally treat them as separate episodes unless the original source grouped them differently.");

console.log("\nONE-FILL / ORDER-SHAPE ODDITIES AMONG WINNERS");
console.log("================================================================================");
const odd = winners.filter((t) => {
  const fills = t.fills || [];
  const orders = new Set(fills.map((f) => String(f.orderId || "")).filter(Boolean));
  return fills.length < 2 || orders.size < 2 || !Number.isFinite(Number(t.entryPrice)) || !Number.isFinite(Number(t.exitVWAP));
});
if (!odd.length) console.log("None.");
else odd.slice(0, 40).forEach((t, i) => console.log(`${String(i + 1).padStart(2)}  ${fmtTrade(t)}`));

console.log("\nInterpretation order: boundary evidence first, then statement/fee edge cases, then episode-adjacency anomalies. Do not choose a trade from statistical fit alone.");
