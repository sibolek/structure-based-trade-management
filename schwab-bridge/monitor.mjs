import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const TOKEN_PATH = path.join(ROOT, ".schwab-tokens.json");

const TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
const TRADER_BASE_URL = "https://api.schwabapi.com/trader/v1";
const ACCESS_REFRESH_SAFETY_MS = 2 * 60 * 1000;
const ORDER_LOOKBACK_MS = 24 * 60 * 60 * 1000;

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
  const configuredPollMs = Number(process.env.SCHWAB_POLL_MS || fileEnv.SCHWAB_POLL_MS || 1000);
  const pollMs = Number.isFinite(configuredPollMs) ? Math.min(Math.max(configuredPollMs, 500), 10000) : 1000;

  if (!clientId || !clientSecret) {
    throw new Error("Missing Schwab client ID or client secret in .env.local.");
  }

  return { clientId, clientSecret, pollMs };
}

function readTokens() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(TOKEN_PATH, 0o600);
  } catch {
    // Best effort on platforms without POSIX permissions.
  }
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
  if (!tokens?.refreshToken) {
    throw new Error("No refresh token is available. Run npm run schwab:auth first.");
  }

  const { clientId, clientSecret } = getConfig();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Schwab token refresh failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  const updated = buildStoredTokens(payload, tokens);
  saveTokens(updated);
  return updated;
}

async function getValidTokens() {
  let tokens = readTokens();
  if (!tokens) {
    throw new Error("No Schwab tokens found. Run npm run schwab:auth first.");
  }

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
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    throw new Error(`Schwab Trader API request failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload;
}

function maskAccount(accountNumber) {
  const text = String(accountNumber || "");
  return `••••${text.slice(-4)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function localTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value || "—");
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

function executionKey(accountHash, orderId, execution, legId) {
  return [
    accountHash,
    orderId,
    legId ?? "?",
    execution.time || "?",
    execution.price ?? "?",
    execution.quantity ?? "?",
    execution.instrumentId ?? "?",
  ].join("|");
}

function extractExecutions(account, orders) {
  const found = [];

  for (const order of orders || []) {
    const legs = order.orderLegCollection || [];
    const activities = order.orderActivityCollection || [];

    for (const activity of activities) {
      if (activity.activityType !== "EXECUTION" || activity.executionType !== "FILL") continue;

      for (const execution of activity.executionLegs || []) {
        const orderLeg =
          legs.find((leg) => String(leg.legId) === String(execution.legId)) ||
          (legs.length === 1 ? legs[0] : null);

        found.push({
          key: executionKey(account.hashValue, order.orderId, execution, execution.legId),
          accountNumber: account.accountNumber,
          accountHash: account.hashValue,
          orderId: order.orderId,
          orderStatus: order.status,
          symbol: orderLeg?.instrument?.symbol || "?",
          instruction: orderLeg?.instruction || "?",
          quantity: Number(execution.quantity || 0),
          price: Number(execution.price || 0),
          executionTime: execution.time,
        });
      }
    }
  }

  return found;
}

function recentOrderPath(accountHash) {
  const now = Date.now();
  const params = new URLSearchParams({
    maxResults: "3000",
    fromEnteredTime: new Date(now - ORDER_LOOKBACK_MS).toISOString(),
    toEnteredTime: new Date(now + 60_000).toISOString(),
  });
  return `/accounts/${encodeURIComponent(accountHash)}/orders?${params.toString()}`;
}

async function fetchAllExecutions(accounts) {
  const batches = await Promise.all(
    accounts.map(async (account) => {
      const orders = await traderGet(recentOrderPath(account.hashValue));
      return extractExecutions(account, orders);
    }),
  );
  return batches.flat();
}

function printFill(fill, detectedAt) {
  const executionMs = Date.parse(fill.executionTime || "");
  const detectedMs = detectedAt.getTime();
  const latencyMs = Number.isFinite(executionMs) ? detectedMs - executionMs : null;
  const latencyText = latencyMs == null
    ? "unavailable"
    : latencyMs >= 0
      ? `${latencyMs} ms`
      : `${latencyMs} ms (local/API clock skew)`;

  console.log("\nNEW SCHWAB EXECUTION");
  console.log("----------------------------------------");
  console.log(`Account:        ${maskAccount(fill.accountNumber)}`);
  console.log(`Symbol:         ${fill.symbol}`);
  console.log(`Instruction:    ${fill.instruction}`);
  console.log(`Quantity:       ${fill.quantity}`);
  console.log(`Fill price:     ${fill.price}`);
  console.log(`Order ID:       ${fill.orderId}`);
  console.log(`Order status:   ${fill.orderStatus || "—"}`);
  console.log(`Schwab fill:    ${localTime(fill.executionTime)}`);
  console.log(`Detected:       ${localTime(detectedAt)}`);
  console.log(`Observed delay: ${latencyText}`);
  console.log("----------------------------------------");
}

async function monitor() {
  const { pollMs } = getConfig();
  const accounts = await traderGet("/accounts/accountNumbers");

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("No Schwab accounts are authorized for this app.");
  }

  console.log("\nEXECUTIONOS TOS / SCHWAB FILL MONITOR\n");
  console.log(`✓ Schwab authenticated`);
  console.log(`✓ ${accounts.length} authorized account(s)`);
  console.log(`✓ Poll interval: ${pollMs} ms`);
  console.log("✓ Read-only: this monitor does not place, replace, or cancel orders");
  console.log("\nBuilding baseline of existing executions...");

  const seen = new Set();
  const baseline = await fetchAllExecutions(accounts);
  for (const fill of baseline) seen.add(fill.key);

  console.log(`✓ Baseline complete (${baseline.length} existing execution leg(s) ignored)`);
  console.log("✓ MONITOR ARMED — new Schwab execution fills will print below");
  console.log("Press Ctrl+C to stop.\n");

  let consecutiveErrors = 0;
  while (true) {
    const cycleStarted = Date.now();
    try {
      const fills = await fetchAllExecutions(accounts);
      const detectedAt = new Date();

      for (const fill of fills) {
        if (seen.has(fill.key)) continue;
        seen.add(fill.key);
        printFill(fill, detectedAt);
      }

      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      const backoffMs = Math.min(pollMs * (2 ** consecutiveErrors), 30_000);
      console.error(`\n⚠ Monitor poll failed: ${error.message}`);
      console.error(`Retrying in ${backoffMs} ms...\n`);
      await sleep(backoffMs);
      continue;
    }

    const elapsed = Date.now() - cycleStarted;
    await sleep(Math.max(0, pollMs - elapsed));
  }
}

process.on("SIGINT", () => {
  console.log("\n\nFill monitor stopped.\n");
  process.exit(0);
});

monitor().catch((error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exitCode = 1;
});
