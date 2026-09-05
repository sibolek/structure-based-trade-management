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

function readJson(req, maxBodyBytes = DEFAULT_MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        fail(apiError("Request body too large", "BODY_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        error.code = "INVALID_JSON";
        reject(error);
      }
    });

    req.on("error", fail);
  });
}

function statusForError(error) {
  const code = text(error?.code);
  if (code === "BODY_TOO_LARGE") return 413;
  if (code === "CANDIDATE_NOT_FOUND") return 404;
  if (
    code === "STALE_LIFECYCLE_STATE"
    || code === "STALE_STATE_REVISION"
    || code === "OPERATION_ID_CONFLICT"
    || code === "ILLEGAL_LIFECYCLE_ACTION"
    || code === "MANUAL_ACTIVATION_PINNED"
    || code === "RECOVERY_RECONCILIATION_REQUIRED"
    || code === "ENTITY_MUTATION_IN_PROGRESS"
    || code === "NO_PERMISSION_BLOCKER"
    || code === "NO_RECOVERY_GATE"
    || code === "CANDIDATE_NOT_YET_VALID"
    || code === "CANDIDATE_VALIDITY_EXPIRED"
  ) return 409;
  if (
    code === "EACCES"
    || code === "ENOSPC"
    || code === "EROFS"
    || code === "EIO"
    || code === "CANDIDATE_CONTRACT_INTEGRITY_ERROR"
    || code === "CANDIDATE_VALIDITY_UNVERIFIABLE"
  ) return 500;
  return 400;
}

function routeFromPath(pathname) {
  const match = pathname.match(/^\/api\/candidates\/([^/]+)\/versions\/(\d+)\/commands\/([^/]+)$/);
  if (!match) return null;
  try {
    return {
      candidateId: decodeURIComponent(match[1]),
      contractVersion: Number(match[2]),
      commandName: decodeURIComponent(match[3]),
    };
  } catch {
    return null;
  }
}

const COMMANDS = new Map([
  ["activate", "activateCandidate"],
  ["return-to-waiting", "returnToWaiting"],
  ["begin-permission", "beginPermission"],
  ["publish-permission", "publishPermissionOutcome"],
  ["revalidate-permission", "revalidatePermission"],
  ["expire", "expireCandidate"],
  ["decline", "declineCandidate"],
  ["invalidate", "invalidateCandidate"],
  ["set-prerequisites", "setPrerequisites"],
  ["set-permission-blocker", "setPermissionBlocker"],
  ["clear-permission-blocker", "clearPermissionBlocker"],
  ["set-recovery-gate", "setRecoveryGate"],
  ["clear-recovery-gate", "clearRecoveryGate"],
]);

export class PreTradeLifecycleApiService {
  constructor({ coordinator } = {}) {
    if (!coordinator || typeof coordinator.candidateSnapshot !== "function") {
      throw new Error("PreTradeLifecycleApiService requires a lifecycle coordinator");
    }
    this.coordinator = coordinator;
  }

  execute(commandName, pathIdentity, payload = {}) {
    const methodName = COMMANDS.get(commandName);
    if (!methodName || typeof this.coordinator[methodName] !== "function") {
      throw apiError(`unsupported lifecycle command ${commandName}`, "UNSUPPORTED_LIFECYCLE_COMMAND");
    }

    if (payload.candidateId !== undefined && text(payload.candidateId) !== pathIdentity.candidateId) {
      throw apiError("candidateId in body conflicts with path identity", "CANDIDATE_IDENTITY_CONFLICT");
    }
    if (
      payload.contractVersion !== undefined
      && Number(payload.contractVersion) !== pathIdentity.contractVersion
    ) {
      throw apiError("contractVersion in body conflicts with path identity", "CANDIDATE_IDENTITY_CONFLICT");
    }

    const result = this.coordinator[methodName]({
      ...payload,
      candidateId: pathIdentity.candidateId,
      contractVersion: pathIdentity.contractVersion,
    });

    return {
      result,
      candidate: this.coordinator.candidateSnapshot(pathIdentity.candidateId, pathIdentity.contractVersion),
    };
  }
}

export function createPreTradeLifecycleApiHandler({
  coordinator,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
} = {}) {
  const service = new PreTradeLifecycleApiService({ coordinator });

  return async function handlePreTradeLifecycleApi(req, res) {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    const route = routeFromPath(requestUrl.pathname);
    if (!route) return false;
    if (req.method !== "POST") return false;

    const origin = req.headers.origin || null;
    if (origin && !isAllowedLocalOrigin(origin)) {
      json(res, 403, { error: "origin not allowed", code: "ORIGIN_NOT_ALLOWED" });
      return true;
    }

    try {
      const payload = await readJson(req, maxBodyBytes);
      const response = service.execute(route.commandName, route, payload);
      json(res, 200, {
        ...response,
        brokerWriteAuthority: false,
      }, origin);
    } catch (error) {
      json(res, statusForError(error), {
        error: error.message,
        code: error.code || "PRETRADE_LIFECYCLE_API_ERROR",
        details: error.details || null,
      }, origin);
    }
    return true;
  };
}
