import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeLegacyWindowExcursions } from "../../analytics/mfe-mae.mjs";
import { summarizeFixedDuration } from "../../analytics/counterfactuals.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const STUDY_PATH = path.join(HERE, "historical-study-trades.json");
const CACHE_PATH = path.join(HERE, "schwab-minute-cache.json");
const ENV_PATH = path.join(ROOT, ".env.local");
const TOKEN_PATH = path.join(ROOT, ".schwab-tokens.json");
const TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
const PRICE_HISTORY_URL = "https://api.schwabapi.com/marketdata/v1/pricehistory";
const ACCESS_REFRESH_SAFETY_MS = 2 * 60 * 1000;
const FAST_CUTOFF_SEC = 209;
const TARGET_N = 19;
const WINDOWS = [300, 600, 900, 1800, 3600];
const TARGET = {
  actual: 86.46,
  hold209: 111.30,
  improved209: 6,
  hold842: 18.16,
  losers842: 11,
  mfe: { 300: 387, 600: 513, 900: 687, 1800: 858, 3600: 1185 },
  twiceActual: { 300: 15, 600: 16, 3600: 17 },
};

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing local research file: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}
function config() {
  const fileEnv = loadEnvFile(ENV_PATH);
  const clientId = process.env.SCHWAB_CLIENT_ID || fileEnv.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET || fileEnv.SCHWAB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing Schwab client credentials in .env.local.");
  return { clientId, clientSecret };
}
function readTokens() {
  if (!fs.existsSync(TOKEN_PATH)) throw new Error("No local Schwab token store. Run npm run schwab:auth first.");
  return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
}
function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(TOKEN_PATH, 0o600); } catch { /* best effort */ }
}
async function refresh(tokens) {
  if (!tokens?.refreshToken) throw new Error("No refresh token is available. Run npm run schwab:auth first.");
  const { clientId, clientSecret } = config();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refreshToken }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`Schwab token refresh failed (${response.status}).`);
  const now = Date.now();
  const updated = {
    ...tokens,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || tokens.refreshToken,
    tokenType: payload.token_type || "Bearer",
    scope: payload.scope || tokens.scope || "api",
    accessObtainedAt: new Date(now).toISOString(),
    accessExpiresAt: new Date(now + Number(payload.expires_in || 1800) * 1000).toISOString(),
  };
  saveTokens(updated);
  return updated;
}
async function validTokens() {
  let tokens = readTokens();
  const expiresAt = Date.parse(tokens.accessExpiresAt || "");
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt - ACCESS_REFRESH_SAFETY_MS) tokens = await refresh(tokens);
  return tokens;
}
function readCache() {
  if (!fs.existsSync(CACHE_PATH)) return { schemaVersion: 1, provider: "Schwab /marketdata/v1/pricehistory", entries: {} };
  const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  return parsed?.entries ? parsed : { schemaVersion: 1, provider: "Schwab /marketdata/v1/pricehistory", entries: {} };
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(CACHE_PATH, 0o600); } catch { /* best effort */ }
}
function dayFor(trade) {
  if (trade?.tradingDay) return String(trade.tradingDay);
  const d = new Date(trade?.entryAt || "");
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "?";
}
function pnl(trade) { return Number(trade?.realizedPnl ?? trade?.realizedGrossPnl); }
function durationSec(trade) {
  const a = Date.parse(trade?.entryAt || "");
  const b = Date.parse(trade?.exitAt || "");
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / 1000 : null;
}
function easternDayBounds(date) {
  // Recovered study dates are Jul/Aug 2026 (EDT, UTC-4). Request enough extended-hours coverage for +60m windows.
  return { start: Date.parse(`${date}T04:00:00.000Z`), end: Date.parse(`${date}T23:59:59.999Z`) };
}
function candleToSample(c) {
  return {
    timestamp: new Date(Number(c.datetime)).toISOString(),
    open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), last: Number(c.close), volume: Number(c.volume),
  };
}
async function fetchBars(symbol, date, tokens, cache) {
  const key = `${date}|${symbol}`;
  if (Array.isArray(cache.entries[key]?.samples) && cache.entries[key].samples.length) return { samples: cache.entries[key].samples, cached: true };
  const { start, end } = easternDayBounds(date);
  const url = new URL(PRICE_HISTORY_URL);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("periodType", "day");
  url.searchParams.set("frequencyType", "minute");
  url.searchParams.set("frequency", "1");
  url.searchParams.set("startDate", String(start));
  url.searchParams.set("endDate", String(end));
  url.searchParams.set("needExtendedHoursData", "true");
  url.searchParams.set("needPreviousClose", "false");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" } });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok) throw new Error(`Schwab price history failed (${response.status}) for ${symbol} ${date}.`);
  const samples = (Array.isArray(payload?.candles) ? payload.candles : []).map(candleToSample);
  if (!samples.length) throw new Error(`No Schwab 1-minute candles returned for ${symbol} ${date}.`);
  cache.entries[key] = { symbol, date, fetchedAt: new Date().toISOString(), samples };
  saveCache(cache);
  return { samples, cached: false };
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
    let index = selector === "last" ? block.length - 1 : selector === "middle" ? Math.floor((block.length - 1) / 2) : 0;
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
    allocations.push({ key, rows, count: base, rem: exact - base });
    assigned += base;
  }
  allocations.sort((a,b)=>b.rem-a.rem || String(a.key).localeCompare(String(b.key)));
  for (let i = 0; i < targetN - assigned; i += 1) allocations[i].count += 1;
  allocations.sort((a,b)=>String(a.key).localeCompare(String(b.key)));
  return allocations;
}
function stratifiedByDay(rows, within) {
  const groups = new Map();
  for (const t of rows) {
    const day = dayFor(t);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(t);
  }
  const sample = [];
  for (const item of allocateLargestRemainder(groups, TARGET_N)) {
    if (!item.count) continue;
    let ordered = [...item.rows];
    if (within.startsWith("duration")) ordered.sort((a,b)=>durationSec(a)-durationSec(b) || Date.parse(a.entryAt)-Date.parse(b.entryAt));
    else ordered.sort((a,b)=>Date.parse(a.entryAt)-Date.parse(b.entryAt));
    sample.push(...equalCountStrata(ordered, item.count, within.endsWith("first") ? "first" : "middle"));
  }
  return sample.sort((a,b)=>Date.parse(a.entryAt)-Date.parse(b.entryAt));
}
function buildCandidates(eligible) {
  const chrono = [...eligible].sort((a,b)=>Date.parse(a.entryAt)-Date.parse(b.entryAt));
  const duration = [...eligible].sort((a,b)=>durationSec(a)-durationSec(b) || Date.parse(a.entryAt)-Date.parse(b.entryAt));
  const candidates = [];
  for (let offset = 0; offset < 10; offset += 1) {
    const c = systematic(chrono, 10, offset); if (c.length === TARGET_N) candidates.push([`chrono systematic offset ${offset}`, c]);
    const d = systematic(duration, 10, offset); if (d.length === TARGET_N) candidates.push([`duration systematic offset ${offset}`, d]);
  }
  for (const selector of ["first", "middle", "last"]) {
    candidates.push([`chrono 19-strata ${selector}`, equalCountStrata(chrono, TARGET_N, selector)]);
    candidates.push([`duration 19-strata ${selector}`, equalCountStrata(duration, TARGET_N, selector)]);
  }
  candidates.push(["day proportional chronological-first", stratifiedByDay(chrono, "chronological-first")]);
  candidates.push(["day proportional chronological-middle", stratifiedByDay(chrono, "chronological-middle")]);
  candidates.push(["day proportional duration-middle", stratifiedByDay(chrono, "duration-middle")]);
  return candidates.filter(([, rows]) => rows.length === TARGET_N);
}
function attachSamples(rows, samplesByKey) {
  return rows.map((trade) => ({ ...trade, marketSamples: samplesByKey.get(`${dayFor(trade)}|${String(trade.symbol).toUpperCase()}`) || [] }));
}
function aggregateMfe(rows, windowSec) {
  return rows.reduce((sum, trade) => {
    const e = computeLegacyWindowExcursions(trade, trade.marketSamples, [windowSec]);
    const v = Number(e?.[windowSec]?.mfeDollars);
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);
}
function twiceActualCount(rows, windowSec) {
  return rows.filter((trade) => {
    const actual = pnl(trade);
    const e = computeLegacyWindowExcursions(trade, trade.marketSamples, [windowSec]);
    const mfe = Number(e?.[windowSec]?.mfeDollars);
    return Number.isFinite(actual) && actual > 0 && Number.isFinite(mfe) && mfe >= 2 * actual;
  }).length;
}
function dollarError(actual, target) { return Math.abs(actual - target) / Math.max(Math.abs(target), 25); }
function countError(actual, target) { return Math.abs(actual - target) / TARGET_N; }
function evaluate(label, rows) {
  const cf209 = summarizeFixedDuration(rows, 209);
  const cf842 = summarizeFixedDuration(rows, 842);
  const mfe = Object.fromEntries(WINDOWS.map((w) => [w, aggregateMfe(rows, w)]));
  const twice = { 300: twiceActualCount(rows, 300), 600: twiceActualCount(rows, 600), 3600: twiceActualCount(rows, 3600) };
  const actual = rows.reduce((s, t) => s + pnl(t), 0);
  const marketScore =
    dollarError(cf209.counterfactualAggregatePnl, TARGET.hold209) + countError(cf209.improvedTrades, TARGET.improved209) +
    dollarError(cf842.counterfactualAggregatePnl, TARGET.hold842) + countError(cf842.losingAtCounterfactualExit, TARGET.losers842) +
    WINDOWS.reduce((s,w)=>s+dollarError(mfe[w], TARGET.mfe[w]),0) +
    countError(twice[300], TARGET.twiceActual[300]) + countError(twice[600], TARGET.twiceActual[600]) + countError(twice[3600], TARGET.twiceActual[3600]);
  return { label, rows, actual, cf209, cf842, mfe, twice, marketScore };
}
function money(v) { return `${v >= 0 ? "+" : ""}$${v.toFixed(2)}`; }
function printResult(r, rank) {
  console.log(`${String(rank).padStart(2)}. ${r.label}`);
  console.log(`    marketScore=${r.marketScore.toFixed(3)}  actual=${money(r.actual)} (target ${money(TARGET.actual)})`);
  console.log(`    209s: ${money(r.cf209.counterfactualAggregatePnl)} improved=${r.cf209.improvedTrades}/19  | target ${money(TARGET.hold209)}, 6/19`);
  console.log(`    842s: ${money(r.cf842.counterfactualAggregatePnl)} losers=${r.cf842.losingAtCounterfactualExit}/19   | target ${money(TARGET.hold842)}, 11/19`);
  console.log(`    MFE: 5m=${money(r.mfe[300])} 10m=${money(r.mfe[600])} 15m=${money(r.mfe[900])} 30m=${money(r.mfe[1800])} 60m=${money(r.mfe[3600])}`);
  console.log(`    2x actual by: 5m=${r.twice[300]}/19 10m=${r.twice[600]}/19 60m=${r.twice[3600]}/19`);
}

async function main() {
  const study = readJson(STUDY_PATH);
  const trades = Array.isArray(study?.trades) ? study.trades : [];
  const eligible = trades.filter((t) => pnl(t) > 1e-9 && Number.isFinite(durationSec(t)) && durationSec(t) <= FAST_CUTOFF_SEC);
  const candidates = buildCandidates(eligible);
  const uniqueTrades = new Map();
  for (const [, rows] of candidates) for (const t of rows) uniqueTrades.set(`${dayFor(t)}|${String(t.symbol).toUpperCase()}`, t);

  console.log("ExecutionOS Schwab validation of predeclared 19-trade fast-winner samples");
  console.log("================================================================================");
  console.log(`Eligible fast winners: ${eligible.length}`);
  console.log(`Predeclared 19-trade candidates: ${candidates.length}`);
  console.log(`Unique symbol/day bar requests needed: ${uniqueTrades.size}`);
  console.log("Selection is frozen before market data. Ranking uses market-only counterfactual/MFE fingerprints; actual +$86.46 is displayed but is not part of marketScore.");

  let tokens = await validTokens();
  const cache = readCache();
  const samplesByKey = new Map();
  let fetched = 0;
  let cached = 0;
  let i = 0;
  for (const [key, trade] of uniqueTrades) {
    i += 1;
    if (i % 20 === 0) tokens = await validTokens();
    const symbol = String(trade.symbol).toUpperCase();
    const date = dayFor(trade);
    const result = await fetchBars(symbol, date, tokens, cache);
    samplesByKey.set(key, result.samples);
    if (result.cached) cached += 1; else fetched += 1;
    if (!result.cached) console.log(`Fetched ${String(fetched).padStart(3)}: ${date} ${symbol} (${result.samples.length} candles)`);
  }
  console.log(`\nMarket data ready: ${cached} cached symbol/days, ${fetched} fetched from Schwab.`);

  const results = candidates.map(([label, rows]) => evaluate(label, attachSamples(rows, samplesByKey))).sort((a,b)=>a.marketScore-b.marketScore);
  console.log("\nMARKET-FINGERPRINT RANKING");
  console.log("================================================================================");
  results.forEach((r, idx) => printResult(r, idx + 1));

  console.log("\nTOP CANDIDATE IDENTITIES");
  console.log("================================================================================");
  const top = results[0];
  console.log(top.label);
  for (const t of top.rows) console.log(`  ${dayFor(t)} ${String(t.symbol).padEnd(6)} ${String(t.direction).padEnd(5)} hold=${String(durationSec(t).toFixed(1)).padStart(6)}s pnl=${money(pnl(t)).padStart(9)} entry=${t.entryAt}`);

  console.log("\nINTERPRETATION");
  console.log("================================================================================");
  console.log("A candidate is high-confidence only if one predeclared rule is clearly superior across multiple independent market fingerprints and is also reasonably consistent with the preserved actual P/L. If no candidate does so, do not search arbitrary 19-trade combinations; record the exact original sample identities as unrecoverable and define a new reproducible sample prospectively.");
}

main().catch((error) => { console.error(`\n✗ ${error.message}\n`); process.exitCode = 1; });
