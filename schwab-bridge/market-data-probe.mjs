import fs from "node:fs";
import path from "node:path";
import { aggregateMinuteBars, freshness } from "./market-data-provider.mjs";
import { SchwabMarketDataProvider } from "./schwab-market-data-provider.mjs";

const AUTH_DIR = path.resolve(process.env.EXECUTIONOS_SCHWAB_AUTH_DIR || process.cwd());
const TOKEN_PATH = path.join(AUTH_DIR, ".schwab-tokens.json");
const ACCESS_SAFETY_MS = 30_000;

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

function easternDate(timestamp) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
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
  const selectedMinuteBars = minuteBars.filter((bar) => easternDate(bar.timestamp) === date);
  const twoMinuteBars = aggregateMinuteBars(selectedMinuteBars, { minutes: 2 });
  const completeTwoMinuteBars = twoMinuteBars.filter((bar) => bar.complete);
  const dailyBars = await provider.getDailyBars(symbol);
  const quoteFreshness = freshness(quote.asOf, { maxAgeMs: 15_000 });

  const quoteHasPrice = [quote.bid, quote.ask, quote.last].some(Number.isFinite);
  const capabilityPass = quoteHasPrice && selectedMinuteBars.length > 0 && completeTwoMinuteBars.length > 0 && dailyBars.length > 0;

  console.log("\nExecutionOS V2.4 MarketDataProvider live capability probe");
  console.log("================================================================================");
  console.log(`Symbol/date:      ${symbol} ${date}`);
  console.log(`Auth source:      ${AUTH_DIR}`);
  console.log(`Access expires:   ${new Date(expiresAt).toISOString()}`);
  console.log("Token behavior:   READ ONLY — this probe does not refresh or write OAuth tokens");
  console.log("");
  console.log(`Quote:            bid ${price(quote.bid)} · ask ${price(quote.ask)} · last ${price(quote.last)} · mark ${price(quote.mark)}`);
  console.log(`Quote as-of:      ${quote.asOf || "—"} · age ${ageLabel(quoteFreshness.ageMs)} · ${quoteFreshness.isStale ? "STALE" : "FRESH"}`);
  console.log(`1-minute bars:    ${selectedMinuteBars.length} for ${date} ET`);
  console.log(`2-minute bars:    ${twoMinuteBars.length} total · ${completeTwoMinuteBars.length} complete`);
  console.log(`Daily bars:       ${dailyBars.length}`);
  if (completeTwoMinuteBars.length) {
    const first = completeTwoMinuteBars[0];
    const last = completeTwoMinuteBars[completeTwoMinuteBars.length - 1];
    console.log(`First complete 2m: ${first.time} O=${price(first.open)} H=${price(first.high)} L=${price(first.low)} C=${price(first.close)} V=${first.volume}`);
    console.log(`Last complete 2m:  ${last.time} O=${price(last.open)} H=${price(last.high)} L=${price(last.low)} C=${price(last.close)} V=${last.volume}`);
  }
  console.log("");
  console.log(`Capability result: ${capabilityPass ? "PASS" : "FAIL"}`);
  if (quoteFreshness.isStale) {
    console.log("Freshness result:  NOT ACCEPTED YET — stale data fails closed. Market-open freshness must be validated separately.");
  } else {
    console.log("Freshness result:  PASS for the configured 15-second quote threshold in this probe.");
  }
  console.log("No credentials, tokens, or account identifiers were printed.\n");

  if (!capabilityPass) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exitCode = 1;
});
