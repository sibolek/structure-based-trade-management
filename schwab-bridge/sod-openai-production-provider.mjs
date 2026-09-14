import { SOD_PROVIDER_LIMITS, sodError, serializeSodProviderRequest } from "./sod-provider-validation.mjs";
import { createOpenAiSodAnalysisProvider } from "./sod-openai-analysis-provider.mjs";
import { Agent } from "undici";
import {
  buildSodTransportErrorDiagnostics,
  sanitizeSodTransportDiagnostics,
  SOD_OPENAI_MAX_TIMEOUT_MS,
} from "./sod-transport-diagnostics.mjs";

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const SOD_OPENAI_DEFAULT_TIMEOUT_MS = 600_000;
export const SOD_OPENAI_TRANSPORT_TIMEOUT_MARGIN_MS = 30_000;
export const SOD_OPENAI_DISPATCHER_CLOSE_GRACE_MS = 5_000;

export function deriveSodTransportTimeoutMs(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > SOD_OPENAI_MAX_TIMEOUT_MS
    || timeoutMs > Number.MAX_SAFE_INTEGER - SOD_OPENAI_TRANSPORT_TIMEOUT_MARGIN_MS) {
    throw productionError("OpenAI SOD timeout must be an integer from 1 to 600000 ms", "SOD_OPENAI_TIMEOUT_INVALID");
  }
  return timeoutMs + SOD_OPENAI_TRANSPORT_TIMEOUT_MARGIN_MS;
}

function createSodDispatcher({ headersTimeout, bodyTimeout }) {
  return new Agent({ headersTimeout, bodyTimeout });
}

const DISPATCHER_CLOSE_TIMEOUT = Symbol("SOD_OPENAI_DISPATCHER_CLOSE_TIMEOUT");

async function closeSodDispatcher(dispatcher, allowanceMs) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => dispatcher.close()),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(DISPATCHER_CLOSE_TIMEOUT), allowanceMs);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    // A bounded shutdown must never leave a pooled dispatcher alive. Destroy
    // is also used when graceful close itself rejects.
    await Promise.resolve().then(() => dispatcher.destroy()).catch(() => {});
    if (error !== DISPATCHER_CLOSE_TIMEOUT) throw error;
  } finally {
    clearTimeout(timer);
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function productionError(message, code = "SOD_OPENAI_PRODUCTION_CONFIG_INVALID", details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function upstreamError(status, requestId = null) {
  const error = new Error("OpenAI Responses request failed");
  error.status = Number(status) || 0;
  if (/^[a-zA-Z0-9_-]{1,128}$/.test(requestId || "")) error.requestId = requestId;
  return error;
}

export async function readBoundedOpenAiResponse(response, controller, observe = () => {}) {
  const fail = async () => {
    controller?.abort();
    await response.body?.cancel?.().catch(() => {});
    throw sodError("SOD_OPENAI_RAW_RESPONSE_LIMIT");
  };
  if (Number(response.headers?.get?.("content-length")) > SOD_PROVIDER_LIMITS.maxResponseBytes) return fail();
  if (!response.body?.getReader) throw sodError("SOD_OPENAI_RESPONSE_INVALID");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      observe("BODY_READING");
      size += value.byteLength;
      if (size > SOD_PROVIDER_LIMITS.maxResponseBytes) {
        controller?.abort();
        await reader.cancel().catch(() => {});
        throw sodError("SOD_OPENAI_RAW_RESPONSE_LIMIT");
      }
      chunks.push(value);
    }
    observe("BODY_RECEIVED");
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
      const parsed = JSON.parse(decoded);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      observe("RESPONSE_PARSED");
      return parsed;
    } catch { throw sodError("SOD_OPENAI_RESPONSE_INVALID"); }
  } finally { reader.releaseLock(); }
}

export function createOpenAiResponsesFetchClient({
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = SOD_OPENAI_DEFAULT_TIMEOUT_MS,
  // Dependency-injection seam used by offline lifecycle tests. Production
  // construction always uses the private Agent above and fixed grace period.
  dispatcherFactory = createSodDispatcher,
  shutdownAllowanceMs = SOD_OPENAI_DISPATCHER_CLOSE_GRACE_MS,
  abortControllerFactory = () => new AbortController(),
} = {}) {
  const configuredKey = text(apiKey);
  if (!configuredKey) {
    throw productionError("OPENAI_API_KEY is required for production SOD analysis", "SOD_OPENAI_API_KEY_REQUIRED");
  }
  if (typeof fetchImpl !== "function") {
    throw productionError("Production OpenAI SOD provider requires fetch", "SOD_OPENAI_FETCH_REQUIRED");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > SOD_OPENAI_MAX_TIMEOUT_MS) {
    throw productionError("OpenAI SOD timeout must be an integer from 1 to 600000 ms", "SOD_OPENAI_TIMEOUT_INVALID");
  }
  if (typeof dispatcherFactory !== "function") {
    throw productionError("OpenAI SOD dispatcher factory is invalid", "SOD_OPENAI_DISPATCHER_INVALID");
  }
  if (typeof abortControllerFactory !== "function") {
    throw productionError("OpenAI SOD abort controller factory is invalid", "SOD_OPENAI_ABORT_CONTROLLER_INVALID");
  }
  if (!Number.isInteger(shutdownAllowanceMs) || shutdownAllowanceMs < 1 || shutdownAllowanceMs > 60_000) {
    throw productionError("OpenAI SOD dispatcher shutdown allowance is invalid", "SOD_OPENAI_DISPATCHER_INVALID");
  }

  const transportTimeoutMs = deriveSodTransportTimeoutMs(timeoutMs);
  const dispatcher = dispatcherFactory({ headersTimeout: transportTimeoutMs, bodyTimeout: transportTimeoutMs });
  if (!dispatcher || typeof dispatcher.dispatch !== "function"
    || typeof dispatcher.close !== "function" || typeof dispatcher.destroy !== "function") {
    throw productionError("OpenAI SOD dispatcher is invalid", "SOD_OPENAI_DISPATCHER_INVALID");
  }
  let closePromise = null;
  const close = () => {
    if (!closePromise) closePromise = closeSodDispatcher(dispatcher, shutdownAllowanceMs);
    return closePromise;
  };
  const assertOpen = () => {
    if (closePromise) throw productionError("OpenAI SOD fetch client is closed", "SOD_OPENAI_DISPATCHER_CLOSED");
  };

  return Object.freeze({
    close,
    responses: Object.freeze({
      async create(payload) {
        assertOpen();
        const body = serializeSodProviderRequest(payload);
        const controller = abortControllerFactory();
        if (!controller?.signal || typeof controller.abort !== "function") {
          throw productionError("OpenAI SOD abort controller is invalid", "SOD_OPENAI_ABORT_CONTROLLER_INVALID");
        }
        const startedAt = performance.now();
        const observed = {
          timeoutMs,
          phase: "REQUEST_STARTED",
          headersObserved: false,
          applicationAbortObserved: false,
        };
        const timer = setTimeout(() => {
          observed.applicationAbortObserved = true;
          controller.abort();
        }, timeoutMs);
        timer.unref?.();
        try {
          const response = await fetchImpl(OPENAI_RESPONSES_URL, {
            method: "POST",
            headers: {
              authorization: `Bearer ${configuredKey}`,
              "content-type": "application/json",
            },
            body,
            redirect: "error",
            signal: controller.signal,
            dispatcher,
          });

          if (response) {
            observed.headersObserved = true;
            observed.phase = "HEADERS_RECEIVED";
          }
          observed.httpStatus = response?.status;
          observed.requestId = response?.headers?.get?.("x-request-id");
          if (controller.signal.aborted) throw sodError("SOD_OPENAI_TIMEOUT");

          if (!response || response.ok !== true) {
            await response?.body?.cancel?.().catch(() => {});
            throw upstreamError(response?.status, response?.headers?.get?.("x-request-id"));
          }

          const parsed = await readBoundedOpenAiResponse(response, controller, phase => { observed.phase = phase; });
          if (controller.signal.aborted) throw sodError("SOD_OPENAI_TIMEOUT");
          const requestId = response.headers?.get?.("x-request-id");
          if (/^req_[a-zA-Z0-9_-]{1,124}$/.test(requestId || "")) parsed._request_id = requestId;
          return parsed;
        } catch (error) {
          const failure = (typeof error?.code === "string" && error.code.startsWith("SOD_OPENAI_")) || error?.status
            ? error : sodError(controller.signal.aborted ? "SOD_OPENAI_TIMEOUT" : "SOD_OPENAI_NETWORK_FAILED");
          failure.providerDiagnostics = sanitizeSodTransportDiagnostics({
            ...observed,
            ...buildSodTransportErrorDiagnostics(error),
            nodeVersion: process.version,
            undiciVersion: process.versions?.undici,
            errorCode: failure.code,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
          throw failure;
        } finally {
          clearTimeout(timer);
        }
      },
    }),
  });
}

export function createOpenAiSodProductionProvider({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = env?.EXECUTIONOS_SOD_OPENAI_TIMEOUT_MS === undefined
    ? SOD_OPENAI_DEFAULT_TIMEOUT_MS : Number(env.EXECUTIONOS_SOD_OPENAI_TIMEOUT_MS),
  clock = () => new Date().toISOString(),
} = {}) {
  // Configuration is observable without a paid/network probe. Generation fails closed.
  const apiKey = text(env?.OPENAI_API_KEY);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > SOD_OPENAI_MAX_TIMEOUT_MS) {
    throw productionError("OpenAI SOD timeout must be an integer from 1 to 600000 ms", "SOD_OPENAI_TIMEOUT_INVALID");
  }
  const model = text(env?.EXECUTIONOS_SOD_OPENAI_MODEL);
  const configured = Boolean(apiKey && model);
  const provider = configured ? createOpenAiSodAnalysisProvider({
    client: createOpenAiResponsesFetchClient({ apiKey, fetchImpl, timeoutMs }), model, clock,
  }) : null;
  return Object.freeze({
    providerIdentity: "openai", providerVersion: 1, model, timeoutMs,
    async close() { await provider?.close?.(); },
    readiness: () => ({ providerLoaded: true, providerConfigured: configured, modelConfigured: Boolean(model), timeoutMs }),
    async generate(request, context) {
      if (!apiKey) throw productionError("OPENAI_API_KEY is required", "SOD_OPENAI_API_KEY_REQUIRED");
      if (!model) throw productionError("EXECUTIONOS_SOD_OPENAI_MODEL is required", "SOD_OPENAI_MODEL_REQUIRED");
      return provider.generate(request, context);
    },
  });
}
