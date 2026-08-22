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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function getConfig() {
  const fileEnv = loadEnvFile(ENV_PATH);
  const clientId = process.env.SCHWAB_CLIENT_ID || fileEnv.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET || fileEnv.SCHWAB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing Schwab client ID or client secret in .env.local.");
  }
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
  if (!response.ok) {
    throw new Error(`Schwab Trader API request failed (${response.status}) for ${relativePath}: ${JSON.stringify(payload)}`);
  }
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
  const fragmentedOnly = values["fragmented-only"] === true || String(values["fragmented-only"]).toLowerCase() === "true";
  return { days, symbol, fragmentedOnly };
}

function maskAccount(accountNumber) {
  const text = String(accountNumber || "");
  return `••••${text.slice(-4)}`;
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

function price(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function signedMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function instructionDirection(instruction) {
  const text = String(instruction || "").toUpperCase();
  if (text.startsWith("BUY")) return "BUY";
  if (text.startsWith("SELL")) return "SELL";
  return null;
}

function adverseSlippage(fillPrice, referencePrice, instruction) {
  const fill = finiteNumber(fillPrice);
  const ref = finiteNumber(referencePrice);
  const direction = instructionDirection(instruction);
  if (fill == null || ref == null || !direction) return null;
  return direction === "BUY" ? fill - ref : ref - fill;
}

function groupOrderExecutions(account, orders, symbolFilter) {
  const groups = [];

  for (const order of orders || []) {
    const legs = order.orderLegCollection || [];
    const executionsByLeg = new Map();

    for (const activity of order.orderActivityCollection || []) {
      if (activity.activityType !== "EXECUTION" || activity.executionType !== "FILL") continue;
      for (const execution of activity.executionLegs || []) {
        const legKey = String(execution.legId ?? (legs.length === 1 ? legs[0]?.legId ?? 0 : "?"));
        if (!executionsByLeg.has(legKey)) executionsByLeg.set(legKey, []);
        executionsByLeg.get(legKey).push(execution);
      }
    }

    for (const [legKey, executions] of executionsByLeg.entries()) {
      const leg = legs.find((item) => String(item.legId) === legKey) || (legs.length === 1 ? legs[0] : null);
      const symbol = leg?.instrument?.symbol || "?";
      if (symbolFilter && symbol.toUpperCase() !== symbolFilter) continue;

      const validFills = executions
        .map((execution) => ({
          quantity: finiteNumber(execution.quantity) ?? 0,
          price: finiteNumber(execution.price),
          time: execution.time,
        }))
        .filter((fill) => fill.quantity > 0 && fill.price != null);

      if (!validFills.length) continue;

      const totalQty = validFills.reduce((sum, fill) => sum + fill.quantity, 0);
      const notional = validFills.reduce((sum, fill) => sum + fill.quantity * fill.price, 0);
      const vwap = totalQty > 0 ? notional / totalQty : null;
      const prices = validFills.map((fill) => fill.price);
      const numericMin = Math.min(...prices);
      const numericMax = Math.max(...prices);
      const direction = instructionDirection(leg?.instruction);
      const bestFill = direction === "BUY" ? numericMin : direction === "SELL" ? numericMax : numericMax;
      const worstFill = direction === "BUY" ? numericMax : direction === "SELL" ? numericMin : numericMin;
      const range = numericMax - numericMin;
      const weightedVariance = totalQty > 0
        ? validFills.reduce((sum, fill) => sum + fill.quantity * ((fill.price - vwap) ** 2), 0) / totalQty
        : 0;
      const weightedStdDev = Math.sqrt(weightedVariance);

      const limitReference = legs.length === 1 ? finiteNumber(order.price) : null;
      const stopReference = legs.length === 1 ? finiteNumber(order.stopPrice) : null;
      const limitSlipPerShare = adverseSlippage(vwap, limitReference, leg?.instruction);
      const stopSlipPerShare = adverseSlippage(vwap, stopReference, leg?.instruction);

      groups.push({
        accountNumber: account.accountNumber,
        orderId: order.orderId,
        legId: legKey,
        symbol,
        instruction: leg?.instruction || "?",
        positionEffect: leg?.positionEffect || "?",
        orderType: order.orderType || "?",
        orderStatus: order.status || "?",
        enteredTime: order.enteredTime,
        closeTime: order.closeTime,
        requestedQuantity: finiteNumber(leg?.quantity ?? order.quantity),
        filledQuantity: totalQty,
        fragmentCount: validFills.length,
        vwap,
        bestFill,
        worstFill,
        fillRange: range,
        weightedStdDev,
        firstFillTime: validFills.map((fill) => fill.time).filter(Boolean).sort()[0] || null,
        lastFillTime: validFills.map((fill) => fill.time).filter(Boolean).sort().at(-1) || null,
        limitReference,
        stopReference,
        limitSlipPerShare,
        limitSlipDollars: limitSlipPerShare == null ? null : limitSlipPerShare * totalQty,
        stopSlipPerShare,
        stopSlipDollars: stopSlipPerShare == null ? null : stopSlipPerShare * totalQty,
        multiLeg: legs.length > 1,
      });
    }
  }

  return groups;
}

function printReference(label, ref, slipPerShare, slipDollars) {
  if (ref == null) return;
  const quality = slipPerShare > 0 ? "adverse" : slipPerShare < 0 ? "improvement" : "exact";
  console.log(`  vs ${label.padEnd(5)} ${price(ref).padStart(12)}  adverse/share ${signedPrice(slipPerShare).padStart(12)}  total ${signedMoney(slipDollars).padStart(10)}  ${quality}`);
}

function printOrder(row) {
  console.log("\n--------------------------------------------------------------------------------");
  console.log(`${localDateTime(row.firstFillTime || row.enteredTime)}  ${maskAccount(row.accountNumber)}  ${row.symbol}  ${row.instruction}`);
  console.log(`Order ${row.orderId}  ${row.orderType}  ${row.orderStatus}  ${row.positionEffect}`);
  console.log(`Filled qty: ${row.filledQuantity}${row.requestedQuantity != null ? ` / requested ${row.requestedQuantity}` : ""}  fragments: ${row.fragmentCount}`);
  console.log(`Execution VWAP: ${price(row.vwap)}  best: ${price(row.bestFill)}  worst: ${price(row.worstFill)}`);
  console.log(`Fill range:     ${price(row.fillRange)}  weighted σ: ${price(row.weightedStdDev)}`);

  if (row.multiLeg) {
    console.log("Reference slippage: N/A for multi-leg order (order-level price is not safely comparable to one leg). ");
  } else if (row.limitReference == null && row.stopReference == null) {
    console.log("Reference slippage: N/A — no limit/stop reference in order record; NBBO capture is not implemented yet.");
  } else {
    printReference("limit", row.limitReference, row.limitSlipPerShare, row.limitSlipDollars);
    printReference("stop", row.stopReference, row.stopSlipPerShare, row.stopSlipDollars);
  }
}

function summarizeReference(rows, fieldPerShare, fieldDollars, refField) {
  const measurable = rows.filter((row) => row[refField] != null && row[fieldPerShare] != null && row[fieldDollars] != null);
  const qty = measurable.reduce((sum, row) => sum + row.filledQuantity, 0);
  const dollars = measurable.reduce((sum, row) => sum + row[fieldDollars], 0);
  return {
    count: measurable.length,
    qty,
    dollars,
    weightedPerShare: qty > 0 ? dollars / qty : null,
  };
}

async function main() {
  const { days, symbol, fragmentedOnly } = parseArgs();
  const accounts = await traderGet("/accounts/accountNumbers");
  if (!Array.isArray(accounts) || !accounts.length) throw new Error("No authorized Schwab accounts found.");

  const end = new Date(Date.now() + 60_000);
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = [];

  for (const account of accounts) {
    const params = new URLSearchParams({
      maxResults: "3000",
      fromEnteredTime: start.toISOString(),
      toEnteredTime: end.toISOString(),
    });
    const orders = await traderGet(`/accounts/${encodeURIComponent(account.hashValue)}/orders?${params.toString()}`);
    rows.push(...groupOrderExecutions(account, orders, symbol));
  }

  rows.sort((a, b) => Date.parse(a.firstFillTime || a.enteredTime || 0) - Date.parse(b.firstFillTime || b.enteredTime || 0));
  const displayed = fragmentedOnly ? rows.filter((row) => row.fragmentCount > 1) : rows;

  console.log("\nEXECUTIONOS OFFLINE EXECUTION / SLIPPAGE ANALYTICS\n");
  console.log(`✓ Lookback: ${days} day(s)`);
  console.log(`✓ Symbol: ${symbol || "all"}`);
  console.log(`✓ Orders with executions: ${rows.length}`);
  console.log(`✓ Display: ${fragmentedOnly ? "fragmented orders only" : "all executed orders"}`);
  console.log("✓ Read-only");
  console.log("\nDefinitions:");
  console.log("  • Execution VWAP = quantity-weighted average of Schwab execution fragments.");
  console.log("  • Fill dispersion describes variation among fragments; it does NOT prove broker-caused slippage.");
  console.log("  • Reference slippage is positive when execution was worse than the order's limit/stop reference, negative when better.");
  console.log("  • Market-order slippage versus NBBO is intentionally unavailable until live quote capture is added after Monday's latency test.");

  for (const row of displayed) printOrder(row);

  const fragmented = rows.filter((row) => row.fragmentCount > 1);
  const totalExecutionLegs = rows.reduce((sum, row) => sum + row.fragmentCount, 0);
  const totalQty = rows.reduce((sum, row) => sum + row.filledQuantity, 0);
  const limitSummary = summarizeReference(rows, "limitSlipPerShare", "limitSlipDollars", "limitReference");
  const stopSummary = summarizeReference(rows, "stopSlipPerShare", "stopSlipDollars", "stopReference");

  console.log("\n\nANALYTICS SUMMARY");
  console.log("================================================================================");
  console.log(`Executed order legs analyzed:      ${rows.length}`);
  console.log(`Individual execution fragments:    ${totalExecutionLegs}`);
  console.log(`Fragmented executed orders:        ${fragmented.length}`);
  console.log(`Total filled quantity:             ${totalQty}`);
  console.log(`Orders measurable vs limit:        ${limitSummary.count}`);
  if (limitSummary.count) {
    console.log(`  Weighted adverse/share vs limit: ${signedPrice(limitSummary.weightedPerShare)}`);
    console.log(`  Aggregate reference impact:      ${signedMoney(limitSummary.dollars)}`);
  }
  console.log(`Orders measurable vs stop:         ${stopSummary.count}`);
  if (stopSummary.count) {
    console.log(`  Weighted adverse/share vs stop:  ${signedPrice(stopSummary.weightedPerShare)}`);
    console.log(`  Aggregate reference impact:      ${signedMoney(stopSummary.dollars)}`);
  }

  const widest = [...fragmented].sort((a, b) => b.fillRange - a.fillRange).slice(0, 5);
  if (widest.length) {
    console.log("\nWIDEST FRAGMENT PRICE RANGES");
    for (const row of widest) {
      console.log(`${row.symbol.padEnd(8)} order ${row.orderId}  fragments ${String(row.fragmentCount).padStart(3)}  range ${price(row.fillRange)}  VWAP ${price(row.vwap)}`);
    }
  }

  console.log("\nPositive reference-slippage numbers are adverse; negative numbers indicate price improvement.\n");
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exitCode = 1;
});
