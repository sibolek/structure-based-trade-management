import fs from "node:fs";
import path from "node:path";

const DEFAULT_ACCESS_SAFETY_MS = 30_000;

function text(value) {
  return String(value ?? "").trim();
}

function requestError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createSchwabReadOnlyRequestJson({
  authDir = process.env.EXECUTIONOS_SCHWAB_AUTH_DIR || process.cwd(),
  fetchImpl = globalThis.fetch,
  accessSafetyMs = DEFAULT_ACCESS_SAFETY_MS,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl must be a function");
  const resolvedAuthDir = path.resolve(authDir);
  const tokenPath = path.join(resolvedAuthDir, ".schwab-tokens.json");

  return async function requestJson(url) {
    if (!fs.existsSync(tokenPath)) {
      throw requestError(`No Schwab token store found at ${tokenPath}`, "SCHWAB_ACCESS_TOKEN_UNAVAILABLE");
    }
    let tokens;
    try {
      tokens = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
    } catch (error) {
      throw requestError(`Schwab token store could not be read: ${error?.message || error}`, "SCHWAB_ACCESS_TOKEN_UNAVAILABLE");
    }
    const accessToken = text(tokens?.accessToken);
    const expiresAt = Date.parse(String(tokens?.accessExpiresAt || ""));
    if (!accessToken || !Number.isFinite(expiresAt) || Date.now() >= expiresAt - Number(accessSafetyMs)) {
      throw requestError("Schwab access token is missing, expired, or near expiry; refresh through the existing auth/monitor flow", "SCHWAB_ACCESS_TOKEN_STALE");
    }

    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    const body = await response.text();
    let payload;
    try {
      payload = body ? JSON.parse(body) : {};
    } catch {
      payload = { raw: body };
    }
    if (!response.ok) {
      const message = payload?.message || payload?.error_description || payload?.error || body || "unknown error";
      throw requestError(`Schwab read-only request failed (${response.status}): ${message}`, "SCHWAB_READ_ONLY_REQUEST_FAILED");
    }
    return payload;
  };
}
