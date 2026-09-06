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

function route(pathname) {
  const match = pathname.match(/^\/api\/candidates\/([^/]+)\/versions\/(\d+)\/(review(?:\/refresh|\/quantity|\/caution-ack)?|arm)$/);
  if (!match) return null;
  try {
    return { candidateId: decodeURIComponent(match[1]), contractVersion: Number(match[2]), action: match[3] };
  } catch {
    return null;
  }
}

function statusFor(error) {
  const code = text(error?.code);
  if (code === "BODY_TOO_LARGE") return 413;
  if (code === "CANDIDATE_NOT_FOUND") return 404;
  if (
    code.includes("STALE")
    || code.includes("CONFLICT")
    || code === "ARM_IN_PROGRESS"
    || code === "ARM_OPERATION_ID_CONFLICT"
    || code === "REVIEW_OPERATION_ID_CONFLICT"
    || code === "OCO_ARM_COMMIT_IN_PROGRESS"
    || code === "ARM_RECOVERY_RECONCILIATION_REQUIRED"
  ) return 409;
  if (code.startsWith("CORRUPT_") || ["EACCES", "ENOSPC", "EROFS", "EIO"].includes(code)) return 500;
  return 400;
}

export function createPreTradeReviewArmApiHandler({
  reviewService,
  reviewRepository,
  armService,
  lifecycleCoordinator,
  recoveryBlocked = false,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
} = {}) {
  if (!reviewService || !reviewRepository || !armService || !lifecycleCoordinator) throw new Error("review/ARM API dependencies are required");

  return async function handlePreTradeReviewArmApi(req, res) {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    const parsed = route(requestUrl.pathname);
    if (!parsed) return false;
    const origin = req.headers.origin || null;
    if (origin && !isAllowedLocalOrigin(origin)) {
      json(res, 403, { error: "origin not allowed", code: "ORIGIN_NOT_ALLOWED" });
      return true;
    }

    try {
      if (req.method === "GET" && parsed.action === "review") {
        const review = reviewRepository.get(parsed.candidateId, parsed.contractVersion);
        const readiness = reviewService.readiness(parsed.candidateId, parsed.contractVersion, review?.currentPackage?.reviewPackageId || null);
        json(res, 200, { review, readiness, brokerWriteAuthority: false }, origin);
        return true;
      }
      if (req.method !== "POST") return false;
      const payload = await readJson(req, maxBodyBytes);
      if (payload.candidateId !== undefined && text(payload.candidateId) !== parsed.candidateId) throw apiError("candidateId conflicts with path identity", "CANDIDATE_IDENTITY_CONFLICT");
      if (payload.contractVersion !== undefined && Number(payload.contractVersion) !== parsed.contractVersion) throw apiError("contractVersion conflicts with path identity", "CANDIDATE_IDENTITY_CONFLICT");

      let result;
      if (parsed.action === "review/refresh") {
        result = reviewService.refresh({ ...payload, candidateId: parsed.candidateId, contractVersion: parsed.contractVersion });
      } else if (parsed.action === "review/quantity") {
        result = reviewService.selectQuantity({ ...payload, candidateId: parsed.candidateId, contractVersion: parsed.contractVersion });
      } else if (parsed.action === "review/caution-ack") {
        result = reviewService.acknowledgeCaution({ ...payload, candidateId: parsed.candidateId, contractVersion: parsed.contractVersion });
      } else if (parsed.action === "arm") {
        if (recoveryBlocked) throw apiError("ARM is blocked pending startup recovery reconciliation", "ARM_RECOVERY_RECONCILIATION_REQUIRED");
        if (payload.confirmArm !== true) throw apiError("ARM requires explicit confirmArm=true intent", "ARM_EXPLICIT_CONFIRMATION_REQUIRED");
        result = await armService.arm({ ...payload, candidateId: parsed.candidateId, contractVersion: parsed.contractVersion });
      } else {
        return false;
      }
      json(res, 200, {
        result,
        candidate: lifecycleCoordinator.candidateSnapshot(parsed.candidateId, parsed.contractVersion),
        brokerWriteAuthority: false,
      }, origin);
    } catch (error) {
      json(res, statusFor(error), { error: error.message, code: error.code || "PRETRADE_REVIEW_ARM_API_ERROR", details: error.details || null }, origin);
    }
    return true;
  };
}
