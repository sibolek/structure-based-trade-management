import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const TOKEN_PATH = path.join(ROOT, ".schwab-tokens.json");
const TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
const PRICE_HISTORY_URL = "https://api.schwabapi.com/marketdata/v1/pricehistory";
const ACCESS_REFRESH_SAFETY_MS = 2 * 60 * 1000;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
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
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
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
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt - ACCESS_REFRESH_SAFETY_MS) {
    console.log("Access token is near expiry; refreshing it...");
    tokens = await refresh(tokens);
    console.log("✓ Access token refreshed.");
  }
  return tokens;
}

function easternDayBounds(date) {
  // August 2026 is EDT (UTC-4). This test is intentionally pinned to the recovered study period.
  const start = Date.parse(`${date}T04:00:00.000Z`);
  const end = Date.parse(`${date}T23:59:59.999Z`);
  return { start, end };
}

async function main() {
  const symbol = String(process.argv[2] || "NVDA").toUpperCase();
  const date = process.argv[3] || "2026-08-20";
  const tokens = await validTokens();
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

  console.log("ExecutionOS Schwab 1-minute price-history validation");
  console.log("================================================================================");
  console.log(`Symbol/date: ${symbol} ${date}`);
  console.log("Request:     read-only /marketdata/v1/pricehistory, 1-minute candles, extended hours included");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" },
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }

  if (!response.ok) {
    console.log(`HTTP status: ${response.status}`);
    if (response.status === 401 || response.status === 403) {
      console.log("Result: Schwab authentication/Market Data entitlement did not authorize this request.");
      console.log("Next: verify the Schwab Developer app has the Market Data product before using a replacement feed.");
    } else {
      console.log("Result: Schwab price-history request failed; inspect the returned error before changing providers.");
    }
    if (payload?.message) console.log(`Schwab message: ${payload.message}`);
    process.exitCode = 2;
    return;
  }

  const candles = Array.isArray(payload?.candles) ? payload.candles : [];
  console.log(`HTTP status: 200`);
  console.log(`Candles:     ${candles.length}`);
  if (!candles.length) {
    console.log("Result: endpoint is authorized, but no candles were returned for this symbol/date.");
    return;
  }

  const first = candles[0];
  const last = candles[candles.length - 1];
  const fmt = (candle) => `${new Date(Number(candle.datetime)).toISOString()} O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close} V=${candle.volume}`;
  console.log(`First candle: ${fmt(first)}`);
  console.log(`Last candle:  ${fmt(last)}`);
  console.log("Result: PASS — Schwab can supply 1-minute historical candles for the recovered study window.");
  console.log("No credentials, tokens, or account identifiers were printed.");
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exitCode = 1;
});
