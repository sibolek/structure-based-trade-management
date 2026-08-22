import fs from "node:fs";
import path from "node:path";

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
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
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
  const values = Object.fromEntries(process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || true];
  }));
  const parsedDays = Number(values.days ?? 7);
  const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 1), 365) : 7;
  const symbol = typeof values.symbol === "string" ? values.symbol.trim().toUpperCase() : null;
  return { days, symbol };
}

function maskAccount(accountNumber) {
  const text = String(accountNumber || "");
  return `••••${text.slice(-4)}`;
}

function localDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value || "—");
  return date.toLocaleString("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    fractionalSecondDigits: 3, hour12: false,
  });
}

function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toString() : "—";
}

function extractOrderExecutions(account, orders, symbolFilter) {
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
          accountNumber: account.accountNumber,
          orderId: order.orderId,
          symbol,
          instruction: leg?.instruction || "?",
          positionEffect: leg?.positionEffect || "",
          quantity: execution.quantity,
          price: execution.price,
          time: execution.time,
          status: order.status,
        });
      }
    }
  }
  return rows;
}

function isSecurityTransferItem(item) {
  const symbol = String(item?.instrument?.symbol || "");
  const type = String(item?.instrument?.type || "").toUpperCase();
  if (!symbol) return false;
  if (symbol.toUpperCase().startsWith("CURRENCY_")) return false;
  if (type === "CURRENCY") return false;
  return true;
}

function extractTradeTransactions(account, transactions, symbolFilter) {
  const rows = [];
  for (const tx of transactions || []) {
    const items = tx.transferItems || [];
    const securityItem = items.find(isSecurityTransferItem) ||
      items.find((item) => item?.instrument?.symbol && Number(item?.price) !== 0) ||
      items[0] || {};
    const symbol = securityItem.instrument?.symbol || "?";
    if (symbolFilter && symbol.toUpperCase() !== symbolFilter) continue;
    rows.push({
      accountNumber: account.accountNumber,
      orderId: tx.orderId,
      activityId: tx.activityId,
      symbol,
      amount: securityItem.amount,
      price: securityItem.price,
      cost: securityItem.cost,
      netAmount: tx.netAmount,
      positionEffect: securityItem.positionEffect,
      time: tx.time || tx.tradeDate,
      status: tx.status,
    });
  }
  return rows;
}

function printOrders(rows) {
  console.log("\nORDER EXECUTION LEGS");
  console.log("================================================================================");
  if (!rows.length) return console.log("No execution fills found in the requested window.");
  for (const row of rows) {
    console.log(
      `${localDateTime(row.time)}  ${maskAccount(row.accountNumber)}  ${row.symbol.padEnd(10)} ` +
      `${String(row.instruction).padEnd(14)} qty ${String(formatNumber(row.quantity)).padStart(8)}  ` +
      `@ ${String(formatNumber(row.price)).padStart(10)}  order ${row.orderId}  ${row.status || ""}`,
    );
  }
}

function printTransactions(rows) {
  console.log("\nTRADE TRANSACTIONS");
  console.log("================================================================================");
  if (!rows.length) return console.log("No TRADE transactions found in the requested window.");
  for (const row of rows) {
    console.log(
      `${localDateTime(row.time)}  ${maskAccount(row.accountNumber)}  ${row.symbol.padEnd(10)} ` +
      `amount ${String(formatNumber(row.amount)).padStart(8)}  @ ${String(formatNumber(row.price)).padStart(10)}  ` +
      `order ${row.orderId ?? "—"}  ${row.positionEffect || ""}`,
    );
  }
}

async function main() {
  const { days, symbol } = parseArgs();
  const accounts = await traderGet("/accounts/accountNumbers");
  if (!Array.isArray(accounts) || !accounts.length) throw new Error("No authorized Schwab accounts found.");

  const end = new Date(Date.now() + 60_000);
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const orderRows = [];
  const transactionRows = [];

  console.log("\nEXECUTIONOS SCHWAB HISTORY VERIFIER\n");
  console.log(`✓ Accounts: ${accounts.length}`);
  console.log(`✓ Lookback: ${days} day(s)`);
  console.log(`✓ Symbol filter: ${symbol || "none"}`);
  console.log("✓ Read-only\n");

  for (const account of accounts) {
    const orderParams = new URLSearchParams({
      maxResults: "3000",
      fromEnteredTime: start.toISOString(),
      toEnteredTime: end.toISOString(),
    });
    const transactionParams = new URLSearchParams({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      types: "TRADE",
    });
    if (symbol) transactionParams.set("symbol", symbol);

    const [orders, transactions] = await Promise.all([
      traderGet(`/accounts/${encodeURIComponent(account.hashValue)}/orders?${orderParams}`),
      traderGet(`/accounts/${encodeURIComponent(account.hashValue)}/transactions?${transactionParams}`),
    ]);
    orderRows.push(...extractOrderExecutions(account, orders, symbol));
    transactionRows.push(...extractTradeTransactions(account, transactions, symbol));
  }

  orderRows.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  transactionRows.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  printOrders(orderRows);
  printTransactions(transactionRows);

  const orderIds = new Set(orderRows.map((row) => String(row.orderId)).filter((value) => value && value !== "undefined"));
  const txOrderIds = new Set(transactionRows.map((row) => String(row.orderId)).filter((value) => value && value !== "undefined"));
  const overlap = [...orderIds].filter((id) => txOrderIds.has(id));

  console.log("\nSUMMARY");
  console.log("================================================================================");
  console.log(`Order execution legs:        ${orderRows.length}`);
  console.log(`TRADE transactions:          ${transactionRows.length}`);
  console.log(`Unique execution order IDs:  ${orderIds.size}`);
  console.log(`Order IDs also in txns:      ${overlap.length}`);
  console.log("\nIf you recognize these as trades entered in thinkorswim, the ToS → Schwab API visibility path is proven before Monday.\n");
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exitCode = 1;
});
