import crypto from "node:crypto";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

function text(value) {
  return String(value ?? "").trim();
}

function json(res, statusCode, value, origin = null) {
  const body = JSON.stringify(value);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  };
  if (origin) {
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
        const error = new Error("request body too large");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        error.code = "INVALID_JSON";
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function isLoopbackAddress(value) {
  const address = text(value).toLowerCase();
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function hostAllowed(host, allowedHosts) {
  const normalized = text(host).toLowerCase();
  return allowedHosts.has(normalized);
}

function preflightAllowed(req) {
  const method = text(req.headers["access-control-request-method"]).toUpperCase();
  if (!["GET", "POST"].includes(method)) return false;
  const requestedHeaders = text(req.headers["access-control-request-headers"])
    .toLowerCase()
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return requestedHeaders.every((header) => ["content-type", "x-pretrade-session"].includes(header));
}

function assertIntent(body, fields) {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((key) => !fields.includes(key))
    || fields.some((key) => typeof body[key] !== "string" || !body[key].trim())) {
    const error = new Error("preview request must contain exact identifiers only");
    error.code = "INVALID_PREVIEW_INTENT";
    throw error;
  }
}

function errorStatus(error) {
  if (error?.code === "BODY_TOO_LARGE") return 413;
  if (["PREVIEW_UNAVAILABLE", "PREVIEW_OPERATION_UNAVAILABLE"].includes(error?.code)) return 404;
  if (["PREVIEW_ACCEPT_CONFLICT", "PREVIEW_DISCARDED", "PREVIEW_REVALIDATION_REQUIRED", "PREVIEW_EXPIRED"].includes(error?.code)) return 409;
  if (["PRETRADE_RECOVERY_REQUIRED", "PRETRADE_CONCURRENT_WRITE", "PRETRADE_WRITER_FENCED", "PRETRADE_COMMIT_AMBIGUOUS", "OUTCOME_UNKNOWN"].includes(error?.code)) return 503;
  if (error?.code === "PRETRADE_PREVIEW_FEATURE_DISABLED") return 503;
  return 400;
}

export function createPreTradePreviewApiHandler({
  authority,
  expectedOrigin,
  allowedHosts = ["127.0.0.1:8788", "localhost:8788", "[::1]:8788"],
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  tokenFactory = () => crypto.randomBytes(32).toString("base64url"),
} = {}) {
  if (!authority || typeof authority.create !== "function" || typeof authority.accept !== "function") {
    throw new Error("preview authority is required");
  }
  const configuredOrigin = text(expectedOrigin);
  const hosts = new Set(allowedHosts.map((value) => text(value).toLowerCase()).filter(Boolean));
  const sessionToken = text(tokenFactory());
  if (!sessionToken) throw new Error("session token allocation failed");

  return async function handlePreTradePreviewApi(req, res) {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;
    if (!pathname.startsWith("/api/pretrade-previews")) return false;

    const origin = text(req.headers.origin);
    if (
      !configuredOrigin
      || origin !== configuredOrigin
      || !isLoopbackAddress(req.socket?.remoteAddress)
      || !hostAllowed(req.headers.host, hosts)
    ) {
      json(res, 403, { error: "preview route origin, host or network boundary rejected", code: "PREVIEW_ROUTE_FORBIDDEN" });
      return true;
    }

    if (req.method === "OPTIONS") {
      if (!preflightAllowed(req)) {
        json(res, 403, { error: "preview route preflight rejected", code: "PREVIEW_PREFLIGHT_FORBIDDEN" }, origin);
        return true;
      }
      res.writeHead(204, {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST",
        "access-control-allow-headers": "content-type, x-pretrade-session",
        "access-control-max-age": "300",
        "cache-control": "no-store",
        vary: "Origin",
      });
      res.end();
      return true;
    }

    if (req.method === "GET" && pathname === "/api/pretrade-previews/session") {
      json(res, 200, { sessionToken, readiness: authority.readiness() }, origin);
      return true;
    }

    if (text(req.headers["x-pretrade-session"]) !== sessionToken) {
      json(res, 401, { error: "invalid PRETRADE preview session", code: "PREVIEW_SESSION_INVALID" }, origin);
      return true;
    }

    try {
      if (req.method === "GET" && pathname === "/api/pretrade-previews") {
        json(res, 200, { previews: authority.list() }, origin);
        return true;
      }
      if (req.method === "POST" && pathname === "/api/pretrade-previews") {
        await readJson(req, maxBodyBytes);
        json(res, 403, {
          error: "trusted preview registration is internal-only",
          code: "PREVIEW_REGISTRATION_INTERNAL_ONLY",
        }, origin);
        return true;
      }

      const operationMatch = pathname.match(/^\/api\/pretrade-previews\/operations\/([^/]+)$/);
      if (req.method === "GET" && operationMatch) {
        const operationId = decodeURIComponent(operationMatch[1]);
        const state = authority.store.snapshot();
        const operation = state.pretradePreviewOperations.find((item) => item.operationId === operationId);
        if (!operation) {
          const error = new Error("acceptance operation is unavailable");
          error.code = "PREVIEW_OPERATION_UNAVAILABLE";
          throw error;
        }
        json(res, 200, authority.status(operation.previewId), origin);
        return true;
      }

      const match = pathname.match(/^\/api\/pretrade-previews\/([^/]+)(?:\/(discard|accept|refresh))?$/);
      if (!match) return false;
      const previewId = decodeURIComponent(match[1]);
      const action = match[2] || null;
      if (req.method === "GET" && !action) {
        json(res, 200, authority.status(previewId), origin);
        return true;
      }
      if (req.method === "POST" && action === "discard") {
        const body = await readJson(req, maxBodyBytes);
        assertIntent(body, ["operationId"]);
        json(res, 200, authority.discard({ previewId, operationId: body.operationId }), origin);
        return true;
      }
      if (req.method === "POST" && action === "accept") {
        const body = await readJson(req, maxBodyBytes);
        assertIntent(body, ["operationId", "proposalHash", "accountScope"]);
        json(res, 200, await authority.accept({ previewId, operationId: body.operationId, proposalHash: body.proposalHash, accountScope: body.accountScope }), origin);
        return true;
      }
      if (req.method === "POST" && action === "refresh") {
        const body = await readJson(req, maxBodyBytes);
        assertIntent(body, ["operationId"]);
        json(res, 200, await authority.refresh({ previewId, operationId: body.operationId }), origin);
        return true;
      }
      return false;
    } catch (error) {
      json(res, errorStatus(error), {
        error: "preview request failed; check the original operation when acceptance may have started",
        code: /^[A-Z][A-Z0-9_]{0,79}$/.test(error?.code || "") ? error.code : "PREVIEW_REQUEST_FAILED",
      }, origin);
      return true;
    }
  };
}
