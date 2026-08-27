import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUDY_PATH = path.join(HERE, "historical-study-trades.json");
const TARGET_PNL = 86.46;

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing local research file: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function pnl(trade) { return Number(trade?.realizedPnl ?? trade?.realizedGrossPnl); }
function durationSec(trade) {
  const a = Date.parse(trade?.entryAt || "");
  const b = Date.parse(trade?.exitAt || "");
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / 1000 : null;
}
function dayFor(trade) {
  if (trade?.tradingDay) return String(trade.tradingDay);
  const d = new Date(trade?.entryAt || "");
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "?";
}
function sumPnl(rows) { return rows.reduce((s, t) => s + pnl(t), 0); }
function fmtMoney(v) { return Number.isFinite(v) ? `${v >= 0 ? "+" : ""}$${v.toFixed(2)}` : "—"; }
function fmtSec(v) { return Number.isFinite(v) ? `${v.toFixed(1)}s` : "—"; }
function printSet(label, rows) {
  const ds = rows.map(durationSec).filter(Number.isFinite).sort((a,b)=>a-b);
  const med = ds.length ? (ds.length % 2 ? ds[(ds.length-1)/2] : (ds[ds.length/2-1]+ds[ds.length/2])/2) : null;
  console.log(`${label.padEnd(34)} N=${String(rows.length).padStart(3)}  P/L=${fmtMoney(sumPnl(rows)).padStart(10)}  medDur=${fmtSec(med)}`);
}

const study = readJson(STUDY_PATH);
const trades = Array.isArray(study?.trades) ? study.trades : [];
const winners = trades
  .filter((t) => pnl(t) > 1e-9 && Number.isFinite(durationSec(t)))
  .sort((a,b) => durationSec(a) - durationSec(b) || Date.parse(a.entryAt)-Date.parse(b.entryAt));

console.log("ExecutionOS 19-trade fast-winner sample reconstruction diagnostic");
console.log("================================================================================");
console.log(`Recovered winners: ${winners.length}`);
console.log("Preserved sample description: 19-trade stratified sample of fast winners");
console.log(`Preserved actual aggregate P/L: ${fmtMoney(TARGET_PNL)}`);
console.log("");

console.log("DURATION BUCKETS");
console.log("================================================================================");
const buckets = [
  [0, 15], [15, 30], [30, 45], [45, 60], [60, 75], [75, 90],
  [90, 120], [120, 180], [180, 209], [209, 300], [300, 600], [600, Infinity],
];
for (const [lo, hi] of buckets) {
  const rows = winners.filter((t) => {
    const d = durationSec(t);
    return d > lo && d <= hi;
  });
  console.log(`${String(lo).padStart(3)}-${hi === Infinity ? "inf" : String(hi).padStart(3)}s  N=${String(rows.length).padStart(3)}  P/L=${fmtMoney(sumPnl(rows)).padStart(10)}`);
}

console.log("");
console.log("CUMULATIVE FAST-WINNER CUTOFFS");
console.log("================================================================================");
for (const cutoff of [15,20,25,30,35,40,45,50,55,60,65,70,75,80,81,82,85,90,100,120,150,180,209]) {
  const rows = winners.filter((t) => durationSec(t) <= cutoff);
  if (rows.length <= 40 || [60,81,90,120,180,209].includes(cutoff)) printSet(`<= ${cutoff}s`, rows);
}

console.log("");
console.log("SIMPLE 19-TRADE CANDIDATES (diagnostic only; not accepted methodology)");
console.log("================================================================================");
printSet("fastest 19 overall", winners.slice(0, 19));
const chrono = [...winners].sort((a,b)=>Date.parse(a.entryAt)-Date.parse(b.entryAt));
printSet("first 19 chronologically", chrono.slice(0, 19));
const smallestPnl = [...winners].sort((a,b)=>pnl(a)-pnl(b));
printSet("smallest-P/L 19 winners", smallestPnl.slice(0,19));
const largestPnl = [...winners].sort((a,b)=>pnl(b)-pnl(a));
printSet("largest-P/L 19 winners", largestPnl.slice(0,19));

const byDay = new Map();
for (const t of winners) {
  const d = dayFor(t);
  if (!byDay.has(d)) byDay.set(d, []);
  byDay.get(d).push(t);
}
const fastestPerDay = [...byDay.values()].map((rows)=>[...rows].sort((a,b)=>durationSec(a)-durationSec(b))[0]);
printSet("fastest winner per day", fastestPerDay);
const earliestPerDay = [...byDay.values()].map((rows)=>[...rows].sort((a,b)=>Date.parse(a.entryAt)-Date.parse(b.entryAt))[0]);
printSet("first winner per day", earliestPerDay);

const bySymbol = new Map();
for (const t of winners) {
  const s = String(t.symbol || "?");
  if (!bySymbol.has(s)) bySymbol.set(s, []);
  bySymbol.get(s).push(t);
}
const fastestPerSymbol = [...bySymbol.values()].map((rows)=>[...rows].sort((a,b)=>durationSec(a)-durationSec(b))[0]);
printSet("fastest winner per symbol", fastestPerSymbol);

console.log("");
console.log("FASTEST 40 WINNERS");
console.log("================================================================================");
console.log("#   Day         Symbol Dir    Hold      P/L      EntryAt");
winners.slice(0,40).forEach((t,i)=>{
  console.log(`${String(i+1).padStart(2)}  ${dayFor(t)}  ${String(t.symbol||"?").padEnd(6)} ${String(t.direction||"?").padEnd(5)} ${fmtSec(durationSec(t)).padStart(7)}  ${fmtMoney(pnl(t)).padStart(9)}  ${t.entryAt}`);
});

console.log("");
console.log("NEAR-19 CUMULATIVE THRESHOLDS");
console.log("================================================================================");
let lastN = null;
for (const t of winners) {
  const d = durationSec(t);
  const rows = winners.filter((x)=>durationSec(x) <= d);
  if (rows.length < 15 || rows.length > 25 || rows.length === lastN) continue;
  lastN = rows.length;
  console.log(`<= ${d.toFixed(1)}s  N=${String(rows.length).padStart(2)}  P/L=${fmtMoney(sumPnl(rows)).padStart(9)}  deltaToTarget=${fmtMoney(sumPnl(rows)-TARGET_PNL)}`);
}

console.log("");
console.log("INTERPRETATION");
console.log("================================================================================");
console.log("Use this output to recover an independently defensible definition of 'fast winners' and any plausible stratification. Do not select 19 trades solely because their realized P/L sums to +$86.46. Schwab market data should be used only after the 19 identities are frozen, as validation rather than sample selection.");
