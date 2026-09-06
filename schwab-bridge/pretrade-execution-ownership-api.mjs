import { isAllowedLocalOrigin } from "./local-origin.mjs";
import { EXECUTION_OWNERSHIP_PROJECTION_SOURCE } from "./pretrade-execution-ownership-authority.mjs";

const DEFAULT_MAX_BODY_BYTES = 6 * 1024 * 1024;
const ROUTE = "/api/execution-ownership/snapshot";

function text(value) {
  return String(value ?? "").trim();
}

function apiError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function json(res, statusCode, payload, origin = null) {
  const body = JSON.stringify(payload);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  };
  if (origin && isAllowedLocalOrigin(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  res.writeHead(statusCode, headers);
  res.end(body);
}

function readJson(req, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(apiError("request body too large", "BODY_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        error.code = "INVALID_JSON";
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function statusFor(error) {
  const code = text(error?.code);
  if (code === "BODY_TOO_LARGE") return 413;
  if (code === "EXECUTION_OWNERSHIP_STALE_REVISION" || code === "EXECUTION_OWNERSHIP_REVISION_CONFLICT" || code === "EXECUTION_OWNERSHIP_HEARTBEAT_MISMATCH") return 409;
  if (code.startsWith("CORRUPT_") || ["EACCES", "ENOSPC", "EROFS", "EIO"].includes(code)) return 500;
  return 400;
}

export function createPreTradeExecutionOwnershipApiHandler({
  authority,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
} = {}) {
  if (!authority || typeof authority.publish !== "function" || typeof authority.health !== "function") {
    throw new Error("Execution ownership API requires authority.publish() and authority.health()");
  }

  return async function handlePreTradeExecutionOwnershipApi(req, res) {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname !== ROUTE) return false;

    const origin = req.headers.origin || null;
    if (!origin || !isAllowedLocalOrigin(origin)) {
      json(res, 403, { error: "local browser origin required", code: "EXECUTION_OWNERSHIP_ORIGIN_REQUIRED" });
      return true;
    }

    if (req.method === "GET") {
      json(res, 200, { health: authority.health(), brokerWriteAuthority: false }, origin);
      return true;
    }
    if (req.method !== "POST") return false;

    const sourceHeader = text(req.headers["x-executionos-source"]).toUpperCase();
    if (sourceHeader !== EXECUTION_OWNERSHIP_PROJECTION_SOURCE) {
      json(res, 403, {
        error: `x-executionos-source must be ${EXECUTION_OWNERSHIP_PROJECTION_SOURCE}`,
        code: "EXECUTION_OWNERSHIP_SOURCE_HEADER_REQUIRED",
      }, origin);
      return true;
    }

    try {
      const payload = await readJson(req, maxBodyBytes);
      const result = authority.publish(payload);
      json(res, 200, {
        result,
        health: authority.health(),
        brokerWriteAuthority: false,
      }, origin);
    } catch (error) {
      json(res, statusFor(error), {
        error: error.message,
        code: error.code || "EXECUTION_OWNERSHIP_API_ERROR",
        details: error.details || null,
      }, origin);
    }
    return true;
  };
}
