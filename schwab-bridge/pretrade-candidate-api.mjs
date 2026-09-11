import { isAllowedLocalOrigin } from "./local-origin.mjs";

const MAX_BODY_BYTES = 1024 * 1024;

function json(res, statusCode, value, origin = null) {
  const body = JSON.stringify(value);
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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error("Request body too large");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        req.destroy();
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

function statusForPreTradeError(error) {
  const code = String(error?.code || "").trim();
  if (code === "BODY_TOO_LARGE") return 413;
  if (
    code === "CANDIDATE_CONTRACT_INTEGRITY_ERROR"
    || code === "CANDIDATE_VALIDITY_UNVERIFIABLE"
    || code.startsWith("CORRUPT_")
    || code === "EACCES"
    || code === "ENOSPC"
    || code === "EROFS"
    || code === "EIO"
  ) return 500;
  return 400;
}

function failPreTradeRequest(res, error, origin = null, fallbackCode = "PRETRADE_API_ERROR") {
  json(res, statusForPreTradeError(error), {
    error: error.message,
    code: error.code || fallbackCode,
    details: error.details || null,
  }, origin);
}

export function createPreTradeCandidateApiHandler({
  candidateIngress,
  lifecycleCoordinator,
  ocoService = null,
} = {}) {
  if (
    !candidateIngress
    || typeof candidateIngress.importBundle !== "function"
    || typeof candidateIngress.createManualSupersessionReview !== "function"
    || typeof candidateIngress.authorizeManualSupersession !== "function"
    || typeof candidateIngress.declineManualSupersession !== "function"
    || typeof candidateIngress.observeManualSupersessionDecision !== "function"
  ) {
    throw new Error("candidateIngress with import and manual supersession decision methods is required");
  }
  if (!lifecycleCoordinator || typeof lifecycleCoordinator.reconcileAllValidity !== "function") {
    throw new Error("lifecycleCoordinator with reconcileAllValidity() is required");
  }

  return async function handleCandidateApi(req, res) {
    const origin = req.headers.origin || null;
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;
    if (!pathname.startsWith("/api/candidates")) return false;

    if (origin && !isAllowedLocalOrigin(origin)) {
      json(res, 403, { error: "origin not allowed" });
      return true;
    }

    try {
      lifecycleCoordinator.reconcileAllValidity({ source: "REQUEST_VALIDITY_RECONCILIATION" });
      ocoService?.reconcileBlockedHandoffRetirements?.();
      ocoService?.reconcileClosedNoArm?.();
    } catch (error) {
      failPreTradeRequest(res, error, origin, "VALIDITY_RECONCILIATION_ERROR");
      return true;
    }

    if (req.method === "POST" && pathname === "/api/candidates/import") {
      try {
        const payload = await readJson(req);
        const result = candidateIngress.importBundle(payload);
        const validityReconciliation = lifecycleCoordinator.reconcileAllValidity({
          source: "INGRESS_VALIDITY_RECONCILIATION",
        });
        const blockedHandoffRetirementReconciliation = ocoService?.reconcileBlockedHandoffRetirements?.() ?? [];
        const ocoReconciliation = ocoService?.reconcileClosedNoArm?.() ?? [];
        json(res, 200, { ...result, validityReconciliation, blockedHandoffRetirementReconciliation, ocoReconciliation }, origin);
      } catch (error) {
        failPreTradeRequest(res, error, origin, "IMPORT_ERROR");
      }
      return true;
    }

    if (req.method === "POST" && pathname === "/api/candidates/manual-supersession-review") {
      try {
        const payload = await readJson(req);
        json(res, 200, candidateIngress.createManualSupersessionReview(payload), origin);
      } catch (error) {
        failPreTradeRequest(res, error, origin, "MANUAL_SUPERSESSION_REVIEW_ERROR");
      }
      return true;
    }

    if (req.method === "POST" && pathname === "/api/candidates/manual-supersession-authorize") {
      try {
        const payload = await readJson(req);
        json(res, 200, candidateIngress.authorizeManualSupersession(payload), origin);
      } catch (error) {
        failPreTradeRequest(res, error, origin, "MANUAL_SUPERSESSION_AUTHORIZATION_ERROR");
      }
      return true;
    }

    if (req.method === "POST" && pathname === "/api/candidates/manual-supersession-decline") {
      try {
        const payload = await readJson(req);
        json(res, 200, candidateIngress.declineManualSupersession(payload), origin);
      } catch (error) {
        failPreTradeRequest(res, error, origin, "MANUAL_SUPERSESSION_DECLINE_ERROR");
      }
      return true;
    }

    if (req.method === "POST" && pathname === "/api/candidates/manual-supersession-observe") {
      try {
        const payload = await readJson(req);
        json(res, 200, candidateIngress.observeManualSupersessionDecision(payload), origin);
      } catch (error) {
        failPreTradeRequest(res, error, origin, "MANUAL_SUPERSESSION_OBSERVATION_ERROR");
      }
      return true;
    }

    return false;
  };
}
