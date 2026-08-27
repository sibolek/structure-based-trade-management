import fs from "node:fs";
import path from "node:path";
import { applyExecution, createSymbolState } from "./trade-state.mjs";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const TOKEN_PATH = path.join(ROOT, ".schwab-tokens.json");
const TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
const TRADER_BASE_URL = "https://api.schwabapi.com/trader/v1";
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

function getConfig() {
  const fileEnv = loadEnvFile(ENV_PATH);
  const clientId = process.env.SCHWAB_CLIENT_ID || fileEnv.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET || fileEnv.SCHWAB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing Schwab client ID or client secret in .env.local.");
  return { clientId, clientSecret };
}

function readTokens() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(TOKEN_PATH, 0o600); } catch { /* best effort */ }
}

function buildStoredTokens(payload, previous = {}) {
  const now = Date.now();
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || previous.refreshToken,
    tokenType: payload.token_type || "Bearer",
    scope: payload.scope || previous.scope || "api",
    accessObtainedAt: new Date(now).toISOString(),
    accessExpiresAt: new Date(now + Number(payload.expires_in || 1800) * 1000).toISOString(),
    authorizedAt: previous.authorizedAt || new Date(now).toISOString(),
  };
}

async function refreshAccessToken(tokens) {
  if (!tokens?.refreshToken) throw new Error("No refresh token available. Run npm run schwab:auth first.");
  const { clientId, clientSecret } = getConfig();
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
  if (!response.ok) throw new Error(`Schwab token refresh failed (${response.status}): ${JSON.stringify(payload)}`);
  const updated = buildStoredTokens(payload, tokens);
  saveTokens(updated);
  return updated;
}

async function getValidTokens() {
  let tokens = readTokens();
  if (!tokens) throw new Error("No Schwab tokens found. Run npm run schwab:auth first.");
  const expiresAt = Date.parse(tokens.accessExpiresAt || "");
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt - ACCESS_REFRESH_SAFETY_MS) {
    console.log("Access token is near expiry; refreshing it...");
    tokens = await refreshAccessToken(tokens);
    console.log("✓ Access token refreshed.\n");
  }
  return tokens;
}

async function traderGet(relativePath) {
  const tokens = await getValidTokens();
  const response = await fetch(`${TRADER_BASE_URL}${relativePath}`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" },
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) throw new Error(`Schwab Trader API request failed (${response.status}) for ${relativePath}: ${JSON.stringify(payload)}`);
  return payload;
}

function parseArgs() {
  const values = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, "").split("=");
      return [key, rest.join("=") || true];
    }),
  );
  const parsedDays = Number(values.days ?? 7);
  const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 1), 365) : 7;
  const symbol = typeof values.symbol === "string" ? values.symbol.trim().toUpperCase() : null;
  return { days, symbol };
}

function localDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value || "—");
  return date.toLocaleString("en-US", {
    month: "2-digit", day: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    fractionalSecondDigits: 3, hour12: false,
  });
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);
}

function extractExecutions(orders, symbolFilter) {
  const rows = [];
  for (const order of orders || []) {
    const legs = order.orderLegCollection || [];
    for (const activity of order.orderActivityCollection || []) {
      if (activity.activityType !== "EXECUTION" || activity.executionType !== "FILL") continue;
      for (const execution of activity.executionLegs || []) {
        const leg = legs.find((item) => String(item.legId) === String(execution.legId)) || (legs.length === 1 ? legs[0] : null);
        const symbol = leg?.instrument?.symbol || "?";
        if (symbolFilter && symbol.toUpperCase() !== symbolFilter) continue;
        rows.push({
          symbol,
          instruction: leg?.instruction || "?",
          positionEffect: leg?.positionEffect || "?",
          quantity: Number(execution.quantity || 0),
          price: Number(execution.price || 0),
          time: execution.time,
          orderId: order.orderId,
        });
      }
    }
  }
  return rows;
}

function positionEffectPriority(effect) {
  const normalized = String(effect || "").toUpperCase();
  if (normalized === "CLOSING") return 0;
  if (normalized === "OPENING") return 1;
  return 2;
}

function compareExecutions(a, b) {
  const timeDiff = Date.parse(a.time) - Date.parse(b.time);
  if (timeDiff !== 0) return timeDiff;

  // Schwab can report a reversal as separate closing and opening orders with
  // the exact same execution timestamp. Process the closing leg first so a
  // BUY_TO_COVER cannot appear to open a long, or a SELL appear to open a short.
  const effectDiff = positionEffectPriority(a.positionEffect) - positionEffectPriority(b.positionEffect);
  if (effectDiff !== 0) return effectDiff;

  return String(a.orderId ?? "").localeCompare(String(b.orderId ?? ""), undefined, { numeric: true });
}

function formatTransition(result) {
  const left = result.previousQuantity === 0 ? "FLAT" : `${result.previousSide} ${Math.abs(result.previousQuantity)}`;
  const right = result.nextQuantity === 0 ? "FLAT" : `${result.nextSide} ${Math.abs(result.nextQuantity)}`;
  return `${left} → ${right}`;
}

async function main() {
  const { days, symbol } = parseArgs();
  const accounts = await traderGet("/accounts/accountNumbers");
  if (!Array.isArray(accounts) || !accounts.length) throw new Error("No authorized Schwab accounts found.");

  const end = new Date(Date.now() + 60_000);
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const fills = [];

  for (const account of accounts) {
    const params = new URLSearchParams({
      maxResults: "3000",
      fromEnteredTime: start.toISOString(),
      toEnteredTime: end.toISOString(),
    });
    const orders = await traderGet(`/accounts/${encodeURIComponent(account.hashValue)}/orders?${params.toString()}`);
    fills.push(...extractExecutions(orders, symbol));
  }

  fills.sort(compareExecutions);

  console.log("\nEXECUTIONOS HISTORICAL TRADE-STATE REPLAY\n");
  console.log(`✓ Lookback: ${days} day(s)`);
  console.log(`✓ Symbol: ${symbol || "all"}`);
  console.log(`✓ Execution legs: ${fills.length}`);
  console.log("✓ Read-only");
  console.log("\nNote: replay assumes each symbol is flat at the beginning of the selected window. If the first fill for a symbol closes a position opened before the window, that symbol's earliest reconstruction will be incomplete.\n");

  const states = new Map();
  const firstFillEffect = new Map();
  let completed = 0;
  let reversals = 0;

  for (const fill of fills) {
    if (!states.has(fill.symbol)) {
      states.set(fill.symbol, createSymbolState(fill.symbol));
      firstFillEffect.set(fill.symbol, fill.positionEffect);
    }

    const state = states.get(fill.symbol);
    const result = applyExecution(state, fill);
    states.set(fill.symbol, result.state);

    if (result.event === "FLAT") completed += 1;
    if (result.event === "REVERSAL") reversals += 1;

    const pnlText = result.realizedGrossPnl ? `  realized gross ${money(result.realizedGrossPnl)}` : "";
    console.log(
      `${localDateTime(fill.time)}  ${fill.symbol.padEnd(8)}  ${String(fill.instruction).padEnd(13)} ` +
      `${String(fill.quantity).padStart(6)} @ ${String(fill.price).padStart(10)}  ` +
      `${result.event.padEnd(8)}  ${formatTransition(result)}  avg ${money(result.nextAveragePrice)}${pnlText}`,
    );
  }

  console.log("\nREPLAY SUMMARY");
  console.log("================================================================================");
  console.log(`Completed flat cycles: ${completed}`);
  console.log(`Reversals detected:    ${reversals}`);

  const ambiguous = [...firstFillEffect.entries()].filter(([, effect]) => String(effect).toUpperCase() === "CLOSING").map(([ticker]) => ticker);
  if (ambiguous.length) console.log(`Window-start context warning: ${ambiguous.join(", ")} first appeared as CLOSING.`);

  const openStates = [...states.values()].filter((state) => state.quantity !== 0);
  if (openStates.length) {
    console.log("\nSTATE AT END OF REPLAY");
    for (const state of openStates) {
      console.log(`${state.symbol.padEnd(8)} ${state.side.padEnd(5)} qty ${String(Math.abs(state.quantity)).padStart(6)}  avg ${money(state.averagePrice)}`);
    }
  } else {
    console.log("\nAll reconstructed symbol states are flat at the end of the replay window.");
  }
  console.log("");
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exitCode = 1;
});
