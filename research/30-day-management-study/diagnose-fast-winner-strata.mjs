import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUDY_PATH = path.join(HERE, "historical-study-trades.json");
const FAST_CUTOFF_SEC = 209;
const TARGET_N = 19;
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
function fmtMoney(v) { return `${v >= 0 ? "+" : ""}$${v.toFixed(2)}`; }
function median(values) {
  const xs = values.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}
function describe(rows) {
  return {
    n: rows.length,
    pnl: sumPnl(rows),
    medianHold: median(rows.map(durationSec)),
    days: new Set(rows.map(dayFor)).size,
    symbols: new Set(rows.map((t)=>String(t.symbol || "?"))).size,
  };
}
function printCandidate(label, rows) {
  const d = describe(rows);
  console.log(`${label.padEnd(38)} N=${String(d.n).padStart(2)} P/L=${fmtMoney(d.pnl).padStart(9)} delta=${fmtMoney(d.pnl - TARGET_PNL).padStart(9)} medHold=${String(d.medianHold?.toFixed(1) ?? "—").padStart(6)}s days=${String(d.days).padStart(2)} syms=${String(d.symbols).padStart(2)}`);
}
function systematic(rows, step, offset) {
  const out = [];
  for (let i = offset; i < rows.length && out.length < TARGET_N; i += step) out.push(rows[i]);
  return out;
}
function equalCountStrata(rows, n = TARGET_N, selector = "middle") {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const lo = Math.floor(i * rows.length / n);
    const hi = Math.floor((i + 1) * rows.length / n);
    const block = rows.slice(lo, hi);
    if (!block.length) continue;
    let index = 0;
    if (selector === "middle") index = Math.floor((block.length - 1) / 2);
    else if (selector === "last") index = block.length - 1;
    out.push(block[index]);
  }
  return out;
}
function allocateLargestRemainder(groups, targetN) {
  const total = [...groups.values()].reduce((s, rows) => s + rows.length, 0);
  const allocations = [];
  let assigned = 0;
  for (const [key, rows] of groups) {
    const exact = rows.length * targetN / total;
    const base = Math.floor(exact);
    allocations.push({ key, rows, exact, count: base, rem: exact - base });
    assigned += base;
  }
  allocations.sort((a,b)=>b.rem-a.rem || String(a.key).localeCompare(String(b.key)));
  for (let i = 0; i < targetN - assigned; i += 1) allocations[i].count += 1;
  allocations.sort((a,b)=>String(a.key).localeCompare(String(b.key)));
  return allocations;
}
function stratifiedByDay(rows, within = "chronological-middle") {
  const groups = new Map();
  for (const t of rows) {
    const day = dayFor(t);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(t);
  }
  const allocations = allocateLargestRemainder(groups, TARGET_N);
  const sample = [];
  for (const item of allocations) {
    if (!item.count) continue;
    let ordered = [...item.rows];
    if (within.startsWith("duration")) ordered.sort((a,b)=>durationSec(a)-durationSec(b) || Date.parse(a.entryAt)-Date.parse(b.entryAt));
    else ordered.sort((a,b)=>Date.parse(a.entryAt)-Date.parse(b.entryAt));
    const sub = equalCountStrata(ordered, item.count, within.endsWith("first") ? "first" : within.endsWith("last") ? "last" : "middle");
    sample.push(...sub);
  }
  return sample.sort((a,b)=>Date.parse(a.entryAt)-Date.parse(b.entryAt));
}
function printRows(rows) {
  for (const t of rows) {
    console.log(`  ${dayFor(t)} ${String(t.symbol || "?").padEnd(6)} ${String(t.direction || "?").padEnd(5)} hold=${String(durationSec(t).toFixed(1)).padStart(6)}s pnl=${fmtMoney(pnl(t)).padStart(8)} entry=${t.entryAt}`);
  }
}

const study = readJson(STUDY_PATH);
const trades = Array.isArray(study?.trades) ? study.trades : [];
const eligible = trades.filter((t) => pnl(t) > 1e-9 && Number.isFinite(durationSec(t)) && durationSec(t) <= FAST_CUTOFF_SEC);
const chrono = [...eligible].sort((a,b)=>Date.parse(a.entryAt)-Date.parse(b.entryAt));
const byDuration = [...eligible].sort((a,b)=>durationSec(a)-durationSec(b) || Date.parse(a.entryAt)-Date.parse(b.entryAt));

console.log("ExecutionOS fast-winner stratified-sample forensic");
console.log("================================================================================");
console.log(`Eligibility hypothesis: realized winner with hold <= ${FAST_CUTOFF_SEC}s (the preserved ~3.49m loser-median horizon)`);
console.log(`Eligible winners: ${eligible.length}`);
console.log(`10% of eligible: ${(eligible.length * 0.10).toFixed(1)} -> ${Math.round(eligible.length * 0.10)} trades`);
console.log(`Preserved sample: ${TARGET_N} trades, actual aggregate P/L ${fmtMoney(TARGET_PNL)}`);
console.log("Market data is not used by this diagnostic.");

console.log("\nCHRONOLOGICAL SYSTEMATIC 1-IN-10 SAMPLES");
console.log("================================================================================");
for (let offset = 0; offset < 10; offset += 1) {
  printCandidate(`chronological every 10th offset ${offset}`, systematic(chrono, 10, offset));
}

console.log("\nDURATION-SORTED SYSTEMATIC 1-IN-10 SAMPLES");
console.log("================================================================================");
for (let offset = 0; offset < 10; offset += 1) {
  printCandidate(`duration every 10th offset ${offset}`, systematic(byDuration, 10, offset));
}

console.log("\nEQUAL-COUNT 19-STRATUM REPRESENTATIVE SAMPLES");
console.log("================================================================================");
for (const [label, rows] of [
  ["chrono strata: first", equalCountStrata(chrono, TARGET_N, "first")],
  ["chrono strata: middle", equalCountStrata(chrono, TARGET_N, "middle")],
  ["chrono strata: last", equalCountStrata(chrono, TARGET_N, "last")],
  ["duration strata: first", equalCountStrata(byDuration, TARGET_N, "first")],
  ["duration strata: middle", equalCountStrata(byDuration, TARGET_N, "middle")],
  ["duration strata: last", equalCountStrata(byDuration, TARGET_N, "last")],
]) printCandidate(label, rows);

console.log("\nPROPORTIONAL STRATIFICATION BY TRADING DAY");
console.log("================================================================================");
for (const mode of ["chronological-first", "chronological-middle", "duration-middle"]) {
  printCandidate(`day-proportional ${mode}`, stratifiedByDay(chrono, mode));
}

const namedCandidates = [
  ["chrono strata: middle", equalCountStrata(chrono, TARGET_N, "middle")],
  ["duration strata: middle", equalCountStrata(byDuration, TARGET_N, "middle")],
  ["day-proportional chronological-middle", stratifiedByDay(chrono, "chronological-middle")],
  ["day-proportional duration-middle", stratifiedByDay(chrono, "duration-middle")],
];

console.log("\nPRE-DECLARED REPRESENTATIVE SAMPLE IDENTITIES");
console.log("================================================================================");
for (const [label, rows] of namedCandidates) {
  console.log(`\n${label}`);
  printRows(rows);
}

console.log("\nINTERPRETATION");
console.log("================================================================================");
console.log("The 209-second eligibility rule is independently motivated by the preserved loser-median counterfactual horizon, and 189 eligible winners naturally imply a 19-trade 10% sample. Compare only standard pre-declared systematic/stratified schemes. The +$86.46 baseline may validate a plausible rule, but must not be used to invent arbitrary inclusions/exclusions or a custom offset after the fact.");
