import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const TOKEN_PATH = path.join(ROOT, ".schwab-tokens.json");

const TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
const TRADER_BASE_URL = "https://api.schwabapi.com/trader/v1";
const ACCESS_REFRESH_SAFETY_MS = 2 * 60 * 1000;
const REFRESH_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

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
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok) {
    throw new Error(`Schwab token refresh failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  const updated = buildStoredTokens(payload, tokens);
  saveTokens(updated);
  return updated;
}

async function getValidTokens() {
  let tokens = readTokens();
  if (!tokens) throw new Error("No Schwab tokens found. Run npm run schwab:auth first.");

  const expiresAt = Date.parse(tokens.accessExpiresAt || "");
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt - ACCESS_REFRESH_SAFETY_MS) {
    tokens = await refreshAccessToken(tokens);
  }
  return tokens;
}

async function accountProbe() {
  const tokens = await getValidTokens();
  const response = await fetch(`${TRADER_BASE_URL}/accounts/accountNumbers`, {
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    throw new Error(`Account probe failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return { tokens, accountCount: Array.isArray(payload) ? payload.length : 0 };
}

function parseArgs() {
  const values = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, "").split("=");
      return [key, rest.join("=") || true];
    }),
  );

  const parsedMinutes = Number(values.minutes ?? 40);
  const parsedInterval = Number(values.interval ?? 60);
  const minutes = Number.isFinite(parsedMinutes) ? Math.min(Math.max(parsedMinutes, 5), 180) : 40;
  const intervalSeconds = Number.isFinite(parsedInterval) ? Math.min(Math.max(parsedInterval, 15), 300) : 60;
  return { minutes, intervalSeconds };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function duration(ms) {
  if (!Number.isFinite(ms)) return "unknown";
  const negative = ms < 0;
  let seconds = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(seconds / 86400);
  seconds -= days * 86400;
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  if (minutes || hours || days) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return `${negative ? "-" : ""}${parts.join(" ")}`;
}

function tokenAgeStatus(tokens) {
  const authorizedAt = Date.parse(tokens?.authorizedAt || "");
  if (!Number.isFinite(authorizedAt)) {
    return { ageMs: NaN, remainingMs: NaN };
  }
  const ageMs = Date.now() - authorizedAt;
  return { ageMs, remainingMs: REFRESH_TOKEN_LIFETIME_MS - ageMs };
}

async function main() {
  getConfig();
  const initialTokens = readTokens();
  if (!initialTokens) throw new Error("No Schwab tokens found. Run npm run schwab:auth first.");

  const { minutes, intervalSeconds } = parseArgs();
  const testStart = Date.now();
  const testEnd = testStart + minutes * 60 * 1000;
  let previousObtainedAt = initialTokens.accessObtainedAt || null;
  let refreshEvents = 0;
  let successfulProbes = 0;
  let failedProbes = 0;
  let accountCount = null;
  let stopped = false;

  const age = tokenAgeStatus(initialTokens);
  const accessExpiresAt = Date.parse(initialTokens.accessExpiresAt || "");

  console.log("\nEXECUTIONOS SCHWAB CREDENTIAL LIFECYCLE TEST\n");
  console.log(`✓ Test duration:          ${minutes} minute(s)`);
  console.log(`✓ Probe interval:         ${intervalSeconds} second(s)`);
  console.log(`✓ Test endpoint:          GET /accounts/accountNumbers`);
  console.log(`✓ Read-only:              no order writes or credential invalidation`);
  console.log(`Access token remaining:   ${duration(accessExpiresAt - Date.now())}`);
  console.log(`Authorization age:        ${duration(age.ageMs)}`);
  console.log(`Est. 7-day window left:   ${duration(age.remainingMs)}`);
  if (Number.isFinite(age.remainingMs) && age.remainingMs <= 24 * 60 * 60 * 1000) {
    console.log("⚠ Reauthorization window is within approximately 24 hours.");
  }
  console.log("\nThe test will verify that account access survives an automatic access-token refresh.");
  console.log("Press Ctrl+C to end early and print the current summary.\n");

  const printSummary = () => {
    const finalTokens = readTokens();
    const finalAge = tokenAgeStatus(finalTokens);
    console.log("\nCREDENTIAL TEST SUMMARY");
    console.log("================================================================================");
    console.log(`Runtime:                  ${duration(Date.now() - testStart)}`);
    console.log(`Successful API probes:    ${successfulProbes}`);
    console.log(`Failed API probes:        ${failedProbes}`);
    console.log(`Access refreshes observed:${String(refreshEvents).padStart(5)}`);
    console.log(`Authorized accounts:      ${accountCount ?? "unknown"}`);
    console.log(`Est. 7-day window left:   ${duration(finalAge.remainingMs)}`);

    const crossedRefresh = refreshEvents > 0;
    const apiHealthy = successfulProbes > 0 && failedProbes === 0;
    if (crossedRefresh && apiHealthy) {
      console.log("\nPASS ✓ Access remained usable across an automatic token refresh.");
    } else if (!crossedRefresh && apiHealthy) {
      console.log("\nINCOMPLETE — API remained healthy, but no access-token refresh occurred during this run.");
      console.log("Run long enough to cross the displayed access-token remaining time.");
    } else {
      console.log("\nFAIL ✗ One or more API probes failed. Review the error(s) above before Monday.");
    }
    console.log("");
  };

  process.on("SIGINT", () => {
    if (stopped) return;
    stopped = true;
    printSummary();
    process.exit(0);
  });

  while (Date.now() < testEnd) {
    const cycleStart = Date.now();
    try {
      const before = readTokens();
      const beforeObtainedAt = before?.accessObtainedAt || previousObtainedAt;
      const result = await accountProbe();
      accountCount = result.accountCount;
      successfulProbes += 1;

      const after = readTokens();
      const afterObtainedAt = after?.accessObtainedAt || result.tokens?.accessObtainedAt || null;
      if (afterObtainedAt && beforeObtainedAt && afterObtainedAt !== beforeObtainedAt) {
        refreshEvents += 1;
        console.log(`${new Date().toLocaleTimeString()}  REFRESH ✓ access token refreshed; account probe succeeded (${accountCount} account(s))`);
      } else {
        const remaining = Date.parse(after?.accessExpiresAt || "") - Date.now();
        console.log(`${new Date().toLocaleTimeString()}  OK        account probe succeeded; access token remaining ${duration(remaining)}`);
      }
      previousObtainedAt = afterObtainedAt || previousObtainedAt;
    } catch (error) {
      failedProbes += 1;
      console.error(`${new Date().toLocaleTimeString()}  ERROR     ${error.message}`);
    }

    const elapsed = Date.now() - cycleStart;
    const waitMs = intervalSeconds * 1000 - elapsed;
    if (waitMs > 0 && Date.now() + waitMs < testEnd) await sleep(waitMs);
    else if (Date.now() < testEnd) await sleep(Math.max(0, testEnd - Date.now()));
  }

  printSummary();
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exitCode = 1;
});
