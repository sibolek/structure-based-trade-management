import fs from "node:fs";
import path from "node:path";
import {
  aggregateMinuteBars,
  freshness,
  minuteContinuity,
  selectSessionBars,
} from "./market-data-provider.mjs";
import { SchwabMarketDataProvider } from "./schwab-market-data-provider.mjs";

const AUTH_DIR = path.resolve(process.env.EXECUTIONOS_SCHWAB_AUTH_DIR || process.cwd());
const TOKEN_PATH = path.join(AUTH_DIR, ".schwab-tokens.json");
const ACCESS_SAFETY_MS = 30_000;
const FULL_RTH_MINUTES = 390;

function readCurrentAccessToken() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`No Schwab token store found at ${TOKEN_PATH}. Set EXECUTIONOS_SCHWAB_AUTH_DIR to the checkout that owns Schwab auth.`);
  }
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  if (!tokens?.accessToken) throw new Error("Schwab token store has no access token.");
  const expiresAt = Date.parse(tokens.accessExpiresAt || "");
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt - ACCESS_SAFETY_MS) {
    throw new Error("Schwab access token is expired or near expiry. Refresh it through the existing Schwab monitor/auth flow, then rerun this read-only probe.");
  }
  return { accessToken: tokens.accessToken, expiresAt };
}

function broadDateWindow(date) {
  const center = Date.parse(`${date}T12:00:00.000Z`);
  if (!Number.isFinite(center)) throw new Error("date must be YYYY-MM-DD");
  return {
    startDate: center - 18 * 60 * 60 * 1000,
    endDate: center + 18 * 60 * 60 * 1000,
  };
}

function price(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : "—";
}

function ageLabel(ms) {
  const number = Number(ms);
  if (!Number.isFinite(number)) return "unknown";
  if (number < 60_000) return `${Math.round(number / 1000)}s`;
  if (number < 3_600_000) return `${Math.round(number / 60_000)}m`;
  return `${(number / 3_600_000).toFixed(1)}h`;
}

async function main() {
  const symbol = String(process.argv[2] || "").toUpperCase();
  const date = process.argv[3];
  if (!symbol || !date) {
    throw new Error("Usage: npm run v24:market-data-probe -- NVDA YYYY-MM-DD");
  }

  const { accessToken, expiresAt } = readCurrentAccessToken();
  const requestJson = async (url) => {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) {
      const message = payload?.message || payload?.error_description || payload?.error || text || "unknown error";
      throw new Error(`Schwab market-data request failed (${response.status}): ${message}`);
    }
    return payload;
  };

  const provider = new SchwabMarketDataProvider({ requestJson });
  const quote = await provider.getQuote(symbol);
  const window = broadDateWindow(date);
  const minuteBars = await provider.getMinuteBars(symbol, { ...window, extendedHours: true });
  const selectedMinuteBars = selectSessionBars(minuteBars, { session: "ALL", tradingDate: date });
  const rthMinuteBars = selectSessionBars(minuteBars, { session: "RTH", tradingDate: date });
  const rthContinuity = minuteContinuity(rthMinuteBars);
  const rthTwoMinuteBars = aggregateMinuteBars(rthMinuteBars, { minutes: 2 });
  const completeRthTwoMinuteBars = rthTwoMinuteBars.filter((bar) => bar.complete);
  const dailyBars = await provider.getDailyBars(symbol);
  const quoteFreshness = freshness(quote.asOf, { maxAgeMs: 15_000 });

  const quoteHasPrice = [quote.bid, quote.ask, quote.last].some(Number.isFinite);
  const capabilityPass = quoteHasPrice && selectedMinuteBars.length > 0 && completeRthTwoMinuteBars.length > 0 && dailyBars.length > 0;
  const rthIntegrityPass = rthMinuteBars.length === FULL_RTH_MINUTES
    && rthContinuity.missingSlots === 0
    && rthContinuity.duplicates === 0
    && rthTwoMinuteBars.length === FULL_RTH_MINUTES / 2
    && completeRthTwoMinuteBars.length === FULL_RTH_MINUTES / 2;

  console.log("\nExecutionOS V2.4 MarketDataProvider live capability probe");
  console.log("================================================================================");
  console.log(`Symbol/date:      ${symbol} ${date}`);
  console.log(`Auth source:      ${AUTH_DIR}`);
  console.log(`Access expires:   ${new Date(expiresAt).toISOString()}`);
  console.log("Token behavior:   READ ONLY — this probe does not refresh or write OAuth tokens");
  console.log("");
  console.log(`Quote:            bid ${price(quote.bid)} · ask ${price(quote.ask)} · last ${price(quote.last)} · mark ${price(quote.mark)}`);
  console.log(`Quote as-of:      ${quote.asOf || "—"} · age ${ageLabel(quoteFreshness.ageMs)} · ${quoteFreshness.isStale ? "STALE" : "FRESH"}`);
  console.log(`ET-day 1m bars:   ${selectedMinuteBars.length}`);
  console.log(`RTH 1m bars:      ${rthMinuteBars.length} · missing ${rthContinuity.missingSlots} · duplicates ${rthContinuity.duplicates}`);
  console.log(`RTH 2m bars:      ${rthTwoMinuteBars.length} total · ${completeRthTwoMinuteBars.length} complete`);
  console.log(`Daily bars:       ${dailyBars.length}`);
  if (completeRthTwoMinuteBars.length) {
    const first = completeRthTwoMinuteBars[0];
    const last = completeRthTwoMinuteBars[completeRthTwoMinuteBars.length - 1];
    console.log(`First RTH 2m:     ${first.time} O=${price(first.open)} H=${price(first.high)} L=${price(first.low)} C=${price(first.close)} V=${first.volume}`);
    console.log(`Last RTH 2m:      ${last.time} O=${price(last.open)} H=${price(last.high)} L=${price(last.low)} C=${price(last.close)} V=${last.volume}`);
  }
  console.log("");
  console.log(`Capability result: ${capabilityPass ? "PASS" : "FAIL"}`);
  console.log(`RTH integrity:     ${rthIntegrityPass ? "PASS — 390 contiguous 1m bars → 195 complete 2m bars" : "FAIL — selected historical RTH session is not complete/contiguous"}`);
  if (quoteFreshness.isStale) {
    console.log("Freshness result:  NOT ACCEPTED YET — stale data fails closed. Market-open freshness must be validated separately.");
  } else {
    console.log("Freshness result:  PASS for the configured 15-second quote threshold in this probe.");
  }
  console.log("No credentials, tokens, or account identifiers were printed.\n");

  if (!capabilityPass || !rthIntegrityPass) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exitCode = 1;
});
