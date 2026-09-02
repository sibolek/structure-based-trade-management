import fs from "node:fs";
import path from "node:path";
import { applyExecution, createSymbolState } from "./trade-state.mjs";
import { createLiveStateApi } from "./live-state-api.mjs";
import {
  advanceBrokerExecutionCoverage,
  createBrokerExecutionCoverage,
  establishBrokerExecutionCoverage,
  markBrokerExecutionCoverageGap,
  publicBrokerAccount,
  publicBrokerExecution,
  publicBrokerPosition,
} from "./broker-execution-provenance.mjs";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const TOKEN_PATH = path.join(ROOT, ".schwab-tokens.json");

const TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
const TRADER_BASE_URL = "https://api.schwabapi.com/trader/v1";
const ACCESS_REFRESH_SAFETY_MS = 2 * 60 * 1000;
const ORDER_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_RISK_FRACTION = 0.005;
const DEFAULT_API_PORT = 8787;

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
  const configuredApiPort = Number(process.env.EXECUTIONOS_API_PORT || fileEnv.EXECUTIONOS_API_PORT || DEFAULT_API_PORT);
  const apiPort = Number.isInteger(configuredApiPort) && configuredApiPort >= 1024 && configuredApiPort <= 65535
    ? configuredApiPort
    : DEFAULT_API_PORT;

  if (!clientId || !clientSecret) {
    throw new Error("Missing Schwab client ID or client secret in .env.local.");
  }

  return { clientId, clientSecret, pollMs, apiPort };
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

function priceText(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : "—";
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function riskBudgetForEquity(equity) {
  const n = Number(equity);
  return Number.isFinite(n) && n >= 0 ? n * MAX_RISK_FRACTION : null;
}

function accountSnapshot(wrapper, fallback = {}) {
  const account = wrapper?.securitiesAccount || wrapper || {};
  const current = account.currentBalances || {};
  const initial = account.initialBalances || {};
  const equity = Number(current.equity ?? initial.liquidationValue ?? initial.accountValue);
  const accountNumber = String(account.accountNumber || fallback.accountNumber || "");

  return {
    accountNumber,
    accountHash: fallback.accountHash || null,
    equity: Number.isFinite(equity) ? equity : null,
    maxRisk: riskBudgetForEquity(equity),
  };
}

function quantityFor(position) {
  const longQty = Number(position.longQuantity || 0);
  const shortQty = Number(position.shortQuantity || 0);
  return longQty - shortQty;
}

function averagePriceFor(position) {
  const qty = quantityFor(position);
  if (qty > 0) return Number(position.averageLongPrice ?? position.averagePrice ?? 0);
  if (qty < 0) return Number(position.averageShortPrice ?? position.averagePrice ?? 0);
  return Number(position.averagePrice || 0);
}

function stateKey(accountHash, symbol) {
  return `${accountHash}|${String(symbol || "?").toUpperCase()}`;
}

function formatPosition(state) {
  if (!state || state.quantity === 0) return "FLAT";
  return `${state.side} ${Math.abs(state.quantity)}`;
}

function publicAccount(snapshot) {
  return publicBrokerAccount({
    ...snapshot,
    accountDisplay: maskAccount(snapshot.accountNumber),
  });
}

function publicPosition(accountNumber, accountHash, state) {
  return publicBrokerPosition({
    accountId: accountHash,
    accountDisplay: maskAccount(accountNumber),
    state,
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
          positionEffect: orderLeg?.positionEffect || "?",
          quantity: Number(execution.quantity || 0),
          price: Number(execution.price || 0),
          executionTime: execution.time,
        });
      }
    }
  }

  return found;
}

function positionEffectPriority(effect) {
  const normalized = String(effect || "").toUpperCase();
  if (normalized === "CLOSING") return 0;
  if (normalized === "OPENING") return 1;
  return 2;
}

function compareExecutions(a, b) {
  const timeDiff = Date.parse(a.executionTime) - Date.parse(b.executionTime);
  if (timeDiff !== 0) return timeDiff;

  const effectDiff = positionEffectPriority(a.positionEffect) - positionEffectPriority(b.positionEffect);
  if (effectDiff !== 0) return effectDiff;

  const accountDiff = String(a.accountHash || "").localeCompare(String(b.accountHash || ""));
  if (accountDiff !== 0) return accountDiff;

  return String(a.orderId ?? "").localeCompare(String(b.orderId ?? ""), undefined, { numeric: true });
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

async function refreshAccountRisk(accountHash, accountNumber) {
  const wrapper = await traderGet(`/accounts/${encodeURIComponent(accountHash)}`);
  return accountSnapshot(wrapper, { accountHash, accountNumber });
}

async function bootstrapLiveState(accounts) {
  const wrappers = await traderGet("/accounts?fields=positions");
  const hashByPlain = new Map(
    (accounts || []).map((account) => [String(account.accountNumber || ""), account.hashValue]),
  );

  const states = new Map();
  const openPositions = [];
  const accountSnapshots = [];

  for (const wrapper of wrappers || []) {
    const account = wrapper.securitiesAccount || wrapper;
    const accountNumber = String(account.accountNumber || "");
    const accountHash = hashByPlain.get(accountNumber);
    if (!accountHash) continue;

    accountSnapshots.push(accountSnapshot(wrapper, { accountNumber, accountHash }));

    for (const position of account.positions || []) {
      const symbol = position.instrument?.symbol || "?";
      const quantity = quantityFor(position);
      if (!Number.isFinite(quantity) || quantity === 0) continue;

      const averagePrice = averagePriceFor(position);
      const state = createSymbolState(symbol, { quantity, averagePrice });
      states.set(stateKey(accountHash, symbol), state);
      openPositions.push({ accountNumber, accountHash, state });
    }
  }

  return { states, openPositions, accountSnapshots };
}

function printFill(fill, detectedAt, stateResult) {
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
  console.log(`Position effect:${String(fill.positionEffect).padStart(9)}`);
  console.log(`Quantity:       ${fill.quantity}`);
  console.log(`Fill price:     ${fill.price}`);
  console.log(`Order ID:       ${fill.orderId}`);
  console.log(`Order status:   ${fill.orderStatus || "—"}`);
  console.log(`Schwab fill:    ${localTime(fill.executionTime)}`);
  console.log(`Detected:       ${localTime(detectedAt)}`);
  console.log(`Observed delay: ${latencyText}`);
  if (stateResult) {
    const before = stateResult.previousQuantity === 0
      ? "FLAT"
      : `${stateResult.previousSide} ${Math.abs(stateResult.previousQuantity)}`;
    const after = stateResult.nextQuantity === 0
      ? "FLAT"
      : `${stateResult.nextSide} ${Math.abs(stateResult.nextQuantity)}`;
    console.log(`State event:    ${stateResult.event}`);
    console.log(`Transition:     ${before} → ${after}`);
    console.log(`Position avg:   ${stateResult.nextQuantity === 0 ? "—" : priceText(stateResult.nextAveragePrice)}`);
  }
  console.log("----------------------------------------");
}

function printRiskSnapshot(snapshot, label = "ACCOUNT RISK") {
  console.log(`\n${label}`);
  console.log("----------------------------------------");
  console.log(`Account:        ${maskAccount(snapshot.accountNumber)}`);
  console.log(`Current equity: ${money(snapshot.equity)}`);
  console.log(`0.5% max risk:  ${money(snapshot.maxRisk)}`);
  console.log("----------------------------------------");
}

function publicExecution(fill, detectedAt, result) {
  return publicBrokerExecution({
    fill: {
      ...fill,
      accountDisplay: maskAccount(fill.accountNumber),
    },
    detectedAt,
    result,
  });
}

function coverageTimestampAtOrAfter(coverage, value = Date.now()) {
  const requested = Number(value);
  const floors = [coverage?.baselineCompletedAt, coverage?.currentThrough]
    .map((item) => Date.parse(item || ""))
    .filter(Number.isFinite);
  const floor = floors.length ? Math.max(...floors) : 0;
  return new Date(Math.max(Number.isFinite(requested) ? requested : Date.now(), floor)).toISOString();
}

async function monitor() {
  const { pollMs, apiPort } = getConfig();
  const accounts = await traderGet("/accounts/accountNumbers");

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("No Schwab accounts are authorized for this app.");
  }

  const liveApi = createLiveStateApi({ port: apiPort });
  try {
    await liveApi.start();
  } catch (error) {
    throw new Error(`ExecutionOS local API could not start on 127.0.0.1:${apiPort}: ${error.message}`);
  }

  let executionCoverage = createBrokerExecutionCoverage();
  liveApi.setExecutionCoverage(executionCoverage);

  console.log("\nEXECUTIONOS TOS / SCHWAB FILL MONITOR\n");
  console.log("✓ Schwab authenticated");
  console.log(`✓ ${accounts.length} authorized account(s)`);
  console.log(`✓ Poll interval: ${pollMs} ms`);
  console.log("✓ Read-only: this monitor does not place, replace, or cancel orders");
  console.log(`✓ Local UI API: http://127.0.0.1:${apiPort}/api/state (read-only, loopback only)`);

  console.log("\nInitializing live position state from Schwab...");
  const bootstrap = await bootstrapLiveState(accounts);
  const liveStates = bootstrap.states;
  const accountSnapshots = new Map(
    bootstrap.accountSnapshots.map((snapshot) => [snapshot.accountHash, snapshot]),
  );

  liveApi.setBootstrap({
    pollMs,
    accounts: bootstrap.accountSnapshots.map(publicAccount),
    positions: bootstrap.openPositions.map((item) => publicPosition(item.accountNumber, item.accountHash, item.state)),
  });

  console.log(`✓ Position bootstrap complete (${bootstrap.openPositions.length} open position(s))`);

  if (bootstrap.accountSnapshots.length !== accounts.length) {
    console.log(`⚠ Matched ${bootstrap.accountSnapshots.length} of ${accounts.length} authorized account(s) to account snapshots.`);
  }

  for (const snapshot of bootstrap.accountSnapshots) {
    console.log(
      `  ${maskAccount(snapshot.accountNumber)}  equity ${money(snapshot.equity)}  ` +
      `0.5% max risk ${money(snapshot.maxRisk)}`,
    );
  }

  if (bootstrap.openPositions.length) {
    for (const item of bootstrap.openPositions) {
      console.log(
        `  ${maskAccount(item.accountNumber)}  ${item.state.symbol.padEnd(10)} ` +
        `${formatPosition(item.state).padEnd(14)} avg ${priceText(item.state.averagePrice)}`,
      );
    }
  } else {
    console.log("  No open Schwab positions at startup.");
  }

  console.log("\nBuilding baseline of existing executions...");
  const seen = new Set();
  const baseline = await fetchAllExecutions(accounts);
  for (const fill of baseline) seen.add(fill.key);

  const baselineCompletedAt = new Date().toISOString();
  executionCoverage = establishBrokerExecutionCoverage(executionCoverage, { baselineCompletedAt });
  liveApi.setExecutionCoverage(executionCoverage);
  liveApi.setStatus("ARMED");

  console.log(`✓ Baseline complete (${baseline.length} existing execution leg(s) ignored)`);
  console.log(`✓ Continuous execution-observation coverage begins at ${baselineCompletedAt}`);
  console.log("✓ MONITOR ARMED — new Schwab execution fills will print below");
  console.log("✓ Live state is seeded from broker positions; new fills update that state automatically");
  console.log("✓ Equity and the 0.5% risk budget refresh after completed trade cycles");
  console.log("✓ React can read masked display labels, stable opaque account IDs, and execution coverage provenance");
  console.log("Press Ctrl+C to stop.\n");

  let consecutiveErrors = 0;
  while (true) {
    const cycleStarted = Date.now();
    try {
      const fills = await fetchAllExecutions(accounts);
      const detectedAt = new Date();
      const unseen = fills.filter((fill) => !seen.has(fill.key)).sort(compareExecutions);
      const riskRefreshAccounts = new Map();

      for (const fill of unseen) {
        seen.add(fill.key);
        const key = stateKey(fill.accountHash, fill.symbol);
        const current = liveStates.get(key) || createSymbolState(fill.symbol);

        if (String(fill.positionEffect).toUpperCase() === "CLOSING" && current.quantity === 0) {
          console.warn(
            `\n⚠ STATE CONTEXT WARNING: ${fill.symbol} arrived as CLOSING while ExecutionOS state is FLAT. ` +
            "Do not rely on the inferred transition until broker position state is resynchronized.",
          );
        }

        const result = applyExecution(current, fill);
        liveStates.set(key, result.state);
        printFill(fill, detectedAt, result);
        liveApi.updatePosition(publicPosition(fill.accountNumber, fill.accountHash, result.state));
        liveApi.recordExecution(publicExecution(fill, detectedAt, result));

        if (result.event === "FLAT" || result.event === "REVERSAL") {
          riskRefreshAccounts.set(fill.accountHash, {
            accountHash: fill.accountHash,
            accountNumber: fill.accountNumber,
          });
        }
      }

      for (const account of riskRefreshAccounts.values()) {
        try {
          const snapshot = await refreshAccountRisk(account.accountHash, account.accountNumber);
          accountSnapshots.set(account.accountHash, snapshot);
          liveApi.updateAccount(publicAccount(snapshot));
          printRiskSnapshot(snapshot, "RISK BUDGET REFRESH — TRADE CYCLE COMPLETE");
        } catch (error) {
          console.warn(
            `\n⚠ Risk-budget refresh failed for ${maskAccount(account.accountNumber)}: ${error.message}`,
          );
          console.warn("  Fill/state processing succeeded; account risk can be refreshed on the next completed cycle.\n");
        }
      }

      executionCoverage = advanceBrokerExecutionCoverage(executionCoverage, {
        observedThrough: coverageTimestampAtOrAfter(executionCoverage, detectedAt.getTime()),
      });
      liveApi.setExecutionCoverage(executionCoverage);

      consecutiveErrors = 0;
      liveApi.setStatus("ARMED");
    } catch (error) {
      consecutiveErrors += 1;
      try {
        executionCoverage = markBrokerExecutionCoverageGap(executionCoverage, {
          gapDetectedAt: coverageTimestampAtOrAfter(executionCoverage),
          reason: error.message,
        });
        liveApi.setExecutionCoverage(executionCoverage);
      } catch (coverageError) {
        console.error(`\n⚠ Execution coverage could not be updated: ${coverageError.message}`);
      }
      liveApi.setError(error.message);
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