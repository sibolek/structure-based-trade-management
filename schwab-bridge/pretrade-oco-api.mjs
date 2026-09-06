import { isAllowedLocalOrigin } from "./local-origin.mjs";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

function text(value) { return String(value ?? "").trim(); }
function apiError(message, code) { const error = new Error(message); error.code = code; return error; }

function json(res, statusCode, payload, origin = null) {
  const body = JSON.stringify(payload);
  const headers = { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" };
  if (origin && isAllowedLocalOrigin(origin)) { headers["access-control-allow-origin"] = origin; headers.vary = "Origin"; }
  res.writeHead(statusCode, headers);
  res.end(body);
}

function readJson(req, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) { reject(apiError("request body too large", "BODY_TOO_LARGE")); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { const body = Buffer.concat(chunks).toString("utf8"); resolve(body ? JSON.parse(body) : {}); }
      catch (error) { error.code = "INVALID_JSON"; reject(error); }
    });
    req.on("error", reject);
  });
}

function route(pathname) {
  if (pathname === "/api/oco-groups") return { action: "collection", groupId: null };
  const match = pathname.match(/^\/api\/oco-groups\/([^/]+)\/(account|dissolve)$/);
  if (!match) return null;
  try { return { action: match[2], groupId: decodeURIComponent(match[1]) }; }
  catch { return null; }
}

function statusFor(error) {
  const code = text(error?.code);
  if (code === "BODY_TOO_LARGE") return 413;
  if (code === "OCO_GROUP_NOT_FOUND" || code === "CANDIDATE_NOT_FOUND") return 404;
  if (code.includes("CONFLICT") || code.includes("NOT_ALLOWED") || code.includes("NOT_MUTABLE")) return 409;
  if (code.startsWith("CORRUPT_") || ["EACCES", "ENOSPC", "EROFS", "EIO"].includes(code)) return 500;
  return 400;
}

export function createPreTradeOcoApiHandler({ ocoService, ocoRepository, maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  if (!ocoService || !ocoRepository) throw new Error("OCO API dependencies are required");
  return async function handlePreTradeOcoApi(req, res) {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    const parsed = route(requestUrl.pathname);
    if (!parsed) return false;
    const origin = req.headers.origin || null;
    if (origin && !isAllowedLocalOrigin(origin)) { json(res, 403, { error: "origin not allowed", code: "ORIGIN_NOT_ALLOWED" }); return true; }
    try {
      if (req.method === "GET" && parsed.action === "collection") {
        json(res, 200, { groups: ocoRepository.list(), brokerWriteAuthority: false }, origin);
        return true;
      }
      if (req.method !== "POST") return false;
      const payload = await readJson(req, maxBodyBytes);
      let result;
      if (parsed.action === "collection") result = ocoService.createGroup(payload);
      else if (parsed.action === "account") result = ocoService.setAccount({ ...payload, groupId: parsed.groupId });
      else if (parsed.action === "dissolve") result = ocoService.dissolve({ ...payload, groupId: parsed.groupId });
      else return false;
      json(res, 200, { result, brokerWriteAuthority: false }, origin);
    } catch (error) {
      json(res, statusFor(error), { error: error.message, code: error.code || "PRETRADE_OCO_API_ERROR", details: error.details || null }, origin);
    }
    return true;
  };
}
