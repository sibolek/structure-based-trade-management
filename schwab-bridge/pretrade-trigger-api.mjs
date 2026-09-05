import { isAllowedLocalOrigin } from "./local-origin.mjs";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

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
        reject(apiError("Request body too large", "BODY_TOO_LARGE"));
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

function routeFromPath(pathname) {
  const match = pathname.match(/^\/api\/candidates\/([^/]+)\/versions\/(\d+)\/trigger\/evidence$/);
  if (!match) return null;
  try {
    return { candidateId: decodeURIComponent(match[1]), contractVersion: Number(match[2]) };
  } catch {
    return null;
  }
}

function statusForError(error) {
  const code = text(error?.code);
  if (code === "BODY_TOO_LARGE") return 413;
  if (code === "CANDIDATE_NOT_FOUND") return 404;
  if (
    code === "STALE_LIFECYCLE_STATE"
    || code === "STALE_STATE_REVISION"
    || code === "TRIGGER_EVIDENCE_ID_CONFLICT"
    || code === "STALE_TRIGGER_EVIDENCE"
    || code === "TRIGGER_CANDIDATE_NOT_VALID"
    || code === "TRIGGER_NOT_ACTIVE_IN_STATE"
    || code === "TRIGGER_RUNTIME_RECONCILIATION_REQUIRED"
  ) return 409;
  if (
    code === "CANDIDATE_CONTRACT_INTEGRITY_ERROR"
    || code === "EACCES"
    || code === "ENOSPC"
    || code === "EROFS"
    || code === "EIO"
  ) return 500;
  return 400;
}

export function createPreTradeTriggerApiHandler({
  triggerEngine,
  lifecycleCoordinator,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
} = {}) {
  if (!triggerEngine || typeof triggerEngine.processEvidence !== "function") {
    throw new Error("triggerEngine is required");
  }
  if (!lifecycleCoordinator || typeof lifecycleCoordinator.candidateSnapshot !== "function") {
    throw new Error("lifecycleCoordinator is required");
  }

  return async function handlePreTradeTriggerApi(req, res) {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    const route = routeFromPath(requestUrl.pathname);
    if (!route || req.method !== "POST") return false;

    const origin = req.headers.origin || null;
    if (origin && !isAllowedLocalOrigin(origin)) {
      json(res, 403, { error: "origin not allowed", code: "ORIGIN_NOT_ALLOWED" });
      return true;
    }

    try {
      const payload = await readJson(req, maxBodyBytes);
      if (payload.candidateId !== undefined && text(payload.candidateId) !== route.candidateId) {
        throw apiError("candidateId in body conflicts with path identity", "CANDIDATE_IDENTITY_CONFLICT");
      }
      if (payload.contractVersion !== undefined && Number(payload.contractVersion) !== route.contractVersion) {
        throw apiError("contractVersion in body conflicts with path identity", "CANDIDATE_IDENTITY_CONFLICT");
      }
      const result = triggerEngine.processEvidence({
        candidateId: route.candidateId,
        contractVersion: route.contractVersion,
        expectedState: payload.expectedState,
        expectedRevision: payload.expectedRevision,
        evidence: payload.evidence,
      });
      json(res, 200, {
        result,
        candidate: lifecycleCoordinator.candidateSnapshot(route.candidateId, route.contractVersion),
        brokerWriteAuthority: false,
      }, origin);
    } catch (error) {
      json(res, statusForError(error), {
        error: error.message,
        code: error.code || "PRETRADE_TRIGGER_API_ERROR",
        details: error.details || null,
      }, origin);
    }
    return true;
  };
}
