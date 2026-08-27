import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const TOKEN_PATH = path.join(ROOT, ".schwab-tokens.json");

const AUTH_URL = "https://api.schwabapi.com/v1/oauth/authorize";
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
  const config = {
    clientId: process.env.SCHWAB_CLIENT_ID || fileEnv.SCHWAB_CLIENT_ID,
    clientSecret: process.env.SCHWAB_CLIENT_SECRET || fileEnv.SCHWAB_CLIENT_SECRET,
    callbackUrl: process.env.SCHWAB_CALLBACK_URL || fileEnv.SCHWAB_CALLBACK_URL,
  };

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(
      `Missing Schwab configuration (${missing.join(", ")}). Create .env.local from .env.local.example and add your credentials.`,
    );
  }

  return config;
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(TOKEN_PATH, 0o600);
  } catch {
    // Best effort on platforms that do not support POSIX permissions.
  }
}

function readTokens() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
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

async function tokenRequest(form) {
  const { clientId, clientSecret } = getConfig();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(form),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Schwab token request failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload;
}

function openBrowser(url) {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // The URL is also printed, so browser launch failure is non-fatal.
  }
}

async function authorize() {
  const { clientId, callbackUrl } = getConfig();
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callbackUrl);

  console.log("\nExecutionOS Schwab authorization\n");
  console.log("1. A Schwab authorization page will open in your browser.");
  console.log("2. Log in directly at Schwab and authorize the account(s) you want ExecutionOS to read.");
  console.log("3. Schwab will redirect to your registered callback URL.");
  console.log("4. The callback page may fail to load; that is okay. Copy the FULL URL from the browser address bar.");
  console.log("5. Paste that full URL back into this terminal.\n");
  console.log(`Authorization URL:\n${url.toString()}\n`);

  openBrowser(url.toString());

  const rl = readline.createInterface({ input, output });
  const redirected = (await rl.question("Paste the full redirected URL here: ")).trim();
  rl.close();

  let callback;
  try {
    callback = new URL(redirected);
  } catch {
    throw new Error("The pasted value is not a valid URL. Paste the full URL from the browser address bar.");
  }

  const code = callback.searchParams.get("code");
  if (!code) {
    throw new Error("No OAuth authorization code was found in the pasted URL.");
  }

  const payload = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl,
  });

  saveTokens(buildStoredTokens(payload));
  console.log("\n✓ Schwab authorization succeeded.");
  console.log("✓ Access and refresh tokens were saved locally to .schwab-tokens.json.");
  console.log("✓ The token file is not intended to be committed to Git.\n");
}

async function refreshAccessToken(tokens) {
  if (!tokens?.refreshToken) {
    throw new Error("No refresh token is available. Run npm run schwab:auth first.");
  }

  const payload = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
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
    throw new Error(`Schwab Trader API request failed (${response.status}) for ${relativePath}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

function maskAccount(accountNumber) {
  const text = String(accountNumber || "");
  return text.length <= 4 ? `••••${text}` : `••••${text.slice(-4)}`;
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}

function quantityFor(position) {
  const longQty = Number(position.longQuantity || 0);
  const shortQty = Number(position.shortQuantity || 0);
  return longQty - shortQty;
}

function averagePriceFor(position) {
  const qty = quantityFor(position);
  if (qty > 0) return position.averageLongPrice || position.averagePrice;
  if (qty < 0) return position.averageShortPrice || position.averagePrice;
  return position.averagePrice;
}

async function showAccounts() {
  const [accountNumbers, accounts] = await Promise.all([
    traderGet("/accounts/accountNumbers"),
    traderGet("/accounts?fields=positions"),
  ]);

  console.log("\nEXECUTIONOS SCHWAB BRIDGE\n");
  console.log(`✓ Schwab authenticated`);
  console.log(`✓ ${Array.isArray(accountNumbers) ? accountNumbers.length : 0} authorized account(s) discovered\n`);

  const hashByPlain = new Map(
    (accountNumbers || []).map((item) => [String(item.accountNumber), item.hashValue]),
  );

  for (const wrapper of accounts || []) {
    const account = wrapper.securitiesAccount || wrapper;
    const accountNumber = String(account.accountNumber || "");
    const current = account.currentBalances || {};
    const initial = account.initialBalances || {};
    const equity = current.equity ?? initial.liquidationValue ?? initial.accountValue;
    const riskBudget = Number(equity) * 0.005;

    console.log(`ACCOUNT ${maskAccount(accountNumber)}`);
    console.log("----------------------------------------");
    console.log(`Current equity:       ${money(equity)}`);
    console.log(`0.5% max risk:        ${money(riskBudget)}`);
    console.log(`Buying power:         ${money(current.buyingPower ?? initial.buyingPower)}`);
    console.log(`Encrypted account ID: ${hashByPlain.has(accountNumber) ? "available ✓" : "not matched"}`);

    const positions = account.positions || [];
    console.log("\nPOSITIONS");
    console.log("----------------------------------------");
    if (!positions.length) {
      console.log("No open positions.");
    } else {
      for (const position of positions) {
        const symbol = position.instrument?.symbol || "?";
        const qty = quantityFor(position);
        const avg = averagePriceFor(position);
        const side = qty > 0 ? "LONG" : qty < 0 ? "SHORT" : "FLAT";
        console.log(`${symbol.padEnd(12)} ${side.padEnd(5)} qty ${String(Math.abs(qty)).padStart(8)}  avg ${money(avg)}`);
      }
    }
    console.log("");
  }
}

function showStatus() {
  const configExists = fs.existsSync(ENV_PATH);
  const tokens = readTokens();
  console.log("\nSCHWAB BRIDGE STATUS\n");
  console.log(`.env.local:          ${configExists ? "present ✓" : "missing"}`);
  console.log(`token store:         ${tokens ? "present ✓" : "missing"}`);
  if (tokens) {
    console.log(`authorized at:       ${tokens.authorizedAt || "—"}`);
    console.log(`access expires at:   ${tokens.accessExpiresAt || "—"}`);
    console.log(`refresh token:       ${tokens.refreshToken ? "present ✓" : "missing"}`);
  }
  console.log("");
}

function logout() {
  if (fs.existsSync(TOKEN_PATH)) fs.rmSync(TOKEN_PATH);
  console.log("Local Schwab tokens removed. Schwab-side authorization is not revoked by this command.");
}

async function main() {
  const command = process.argv[2] || "status";
  switch (command) {
    case "auth":
      await authorize();
      break;
    case "account":
      await showAccounts();
      break;
    case "status":
      showStatus();
      break;
    case "logout":
      logout();
      break;
    default:
      throw new Error(`Unknown command: ${command}. Use auth, account, status, or logout.`);
  }
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exitCode = 1;
});
