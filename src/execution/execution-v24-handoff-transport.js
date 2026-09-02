function text(value) {
  return String(value ?? "").trim();
}

function transportError(message, code, status = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function createV24HandoffTransport({ pretradeUrl, fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = text(pretradeUrl).replace(/\/$/, "");
  if (!baseUrl) throw transportError("pretradeUrl is required", "V24_HANDOFF_TRANSPORT_URL_REQUIRED");
  if (typeof fetchImpl !== "function") throw transportError("fetch implementation is required", "V24_HANDOFF_TRANSPORT_FETCH_REQUIRED");

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        cache: "no-store",
        ...options,
        headers: {
          "content-type": "application/json",
          ...(options.headers || {}),
        },
      });
    } catch (error) {
      throw transportError(`handoff transport unavailable: ${error.message}`, "V24_HANDOFF_TRANSPORT_UNAVAILABLE");
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw transportError(
        payload?.error || `handoff transport HTTP ${response.status}`,
        payload?.code || "V24_HANDOFF_TRANSPORT_ERROR",
        response.status,
      );
    }
    return payload;
  }

  return Object.freeze({
    async discover(receiverId) {
      const receiver = text(receiverId);
      if (!receiver) throw transportError("receiverId is required", "EXECUTION_BOARD_RECEIVER_ID_REQUIRED");
      const payload = await request(`/api/handoffs?receiverId=${encodeURIComponent(receiver)}`);
      return Array.isArray(payload?.handoffs) ? payload.handoffs : [];
    },

    async claim(handoffId, receiverId) {
      return request(`/api/handoffs/${encodeURIComponent(text(handoffId))}/claim`, {
        method: "POST",
        body: JSON.stringify({ receiverId: text(receiverId) }),
      });
    },

    async acknowledge(handoffId, receiverId, executionListeningAt) {
      return request(`/api/handoffs/${encodeURIComponent(text(handoffId))}/ack`, {
        method: "POST",
        body: JSON.stringify({
          receiverId: text(receiverId),
          executionListeningAt: text(executionListeningAt),
        }),
      });
    },

    async block(handoffId, receiverId, reason) {
      return request(`/api/handoffs/${encodeURIComponent(text(handoffId))}/block`, {
        method: "POST",
        body: JSON.stringify({ receiverId: text(receiverId), reason: text(reason) }),
      });
    },
  });
}
