import { isAllowedLocalOrigin } from "./local-origin.mjs";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

function text(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return structuredClone(value);
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
        const error = apiError("Request body too large", "BODY_TOO_LARGE");
        fail(error);
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
  if (
    code === "EXECUTION_BOARD_HANDOFF_NOT_FOUND"
    || code === "EXECUTION_BOARD_HANDOFF_DELIVERY_NOT_FOUND"
  ) return 404;
  if (
    code === "EXECUTION_BOARD_HANDOFF_ALREADY_CLAIMED"
    || code === "EXECUTION_BOARD_HANDOFF_DELIVERY_TERMINAL"
    || code === "EXECUTION_BOARD_HANDOFF_CLAIM_RECEIVER_MISMATCH"
    || code === "HANDOFF_ACK_CONTENT_CONFLICT"
    || code === "EXECUTION_BOARD_HANDOFF_BLOCK_CONTENT_CONFLICT"
  ) return 409;
  if (
    code === "EXECUTION_BOARD_HANDOFF_DELIVERY_PERSISTENCE_ERROR"
    || code === "EXECUTION_BOARD_HANDOFF_DELIVERY_CLOCK_INVALID"
    || code === "CORRUPT_EXECUTION_BOARD_HANDOFF_DELIVERY_REPOSITORY"
    || code === "CORRUPT_EXECUTION_BOARD_HANDOFF_REPOSITORY"
  ) return 500;
  return 400;
}

function handoffIdFromPath(pathname, action) {
  const pattern = new RegExp(`^/api/handoffs/([^/]+)/${action}$`);
  const match = pathname.match(pattern);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export class ExecutionBoardHandoffApiService {
  constructor({ handoffRepository, deliveryRepository } = {}) {
    if (!handoffRepository || typeof handoffRepository.getById !== "function") {
      throw new Error("ExecutionBoardHandoffApiService requires handoffRepository.getById()");
    }
    if (
      !deliveryRepository
      || typeof deliveryRepository.listByStatus !== "function"
      || typeof deliveryRepository.claim !== "function"
      || typeof deliveryRepository.deliver !== "function"
      || typeof deliveryRepository.block !== "function"
    ) {
      throw new Error("ExecutionBoardHandoffApiService requires a compatible delivery repository");
    }
    this.handoffRepository = handoffRepository;
    this.deliveryRepository = deliveryRepository;
  }

  envelope(delivery) {
    const handoff = this.handoffRepository.getById(delivery.handoffId);
    return clone({ handoff, delivery });
  }

  discover(receiverId) {
    const receiver = text(receiverId);
    if (!receiver) {
      throw apiError("receiverId is required", "EXECUTION_BOARD_RECEIVER_ID_REQUIRED");
    }

    const pending = this.deliveryRepository.listByStatus("PENDING");
    const claimed = this.deliveryRepository
      .listByStatus("CLAIMED")
      .filter((delivery) => text(delivery.claimedBy) === receiver);

    return [...pending, ...claimed]
      .map((delivery) => this.envelope(delivery))
      .sort((left, right) => {
        const leftTime = Date.parse(left.handoff.createdAt || left.delivery.createdAt || "");
        const rightTime = Date.parse(right.handoff.createdAt || right.delivery.createdAt || "");
        return leftTime - rightTime;
      });
  }

  claim(handoffId, receiverId) {
    const delivery = this.deliveryRepository.claim(handoffId, receiverId);
    return this.envelope(delivery);
  }

  acknowledge(handoffId, { receiverId, executionListeningAt } = {}) {
    const delivery = this.deliveryRepository.deliver(handoffId, {
      receiverId,
      executionListeningAt,
    });
    return this.envelope(delivery);
  }

  block(handoffId, { receiverId, reason } = {}) {
    const delivery = this.deliveryRepository.block(handoffId, {
      receiverId,
      reason,
    });
    return this.envelope(delivery);
  }
}

export function createExecutionBoardHandoffApiHandler({
  handoffRepository,
  deliveryRepository,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
} = {}) {
  const service = new ExecutionBoardHandoffApiService({ handoffRepository, deliveryRepository });

  return async function handleExecutionBoardHandoffApi(req, res) {
    const origin = req.headers.origin || null;
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;

    if (req.method === "GET" && pathname === "/api/handoffs") {
      try {
        const receiverId = requestUrl.searchParams.get("receiverId");
        json(res, 200, {
          handoffs: service.discover(receiverId),
          brokerWriteAuthority: false,
        }, origin);
      } catch (error) {
        json(res, statusForError(error), { error: error.message, code: error.code || "HANDOFF_API_ERROR" }, origin);
      }
      return true;
    }

    const actions = ["claim", "ack", "block"];
    for (const action of actions) {
      const handoffId = handoffIdFromPath(pathname, action);
      if (handoffId === null) continue;

      if (req.method !== "POST") return false;
      if (origin && !isAllowedLocalOrigin(origin)) {
        json(res, 403, { error: "origin not allowed", code: "ORIGIN_NOT_ALLOWED" });
        return true;
      }

      try {
        const payload = await readJson(req, maxBodyBytes);
        let result;
        if (action === "claim") result = service.claim(handoffId, payload.receiverId);
        else if (action === "ack") result = service.acknowledge(handoffId, payload);
        else result = service.block(handoffId, payload);

        json(res, 200, {
          ...result,
          brokerWriteAuthority: false,
        }, origin);
      } catch (error) {
        json(res, statusForError(error), { error: error.message, code: error.code || "HANDOFF_API_ERROR" }, origin);
      }
      return true;
    }

    return false;
  };
}
