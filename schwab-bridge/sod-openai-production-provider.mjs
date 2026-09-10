import { createOpenAiSodAnalysisProvider } from "./sod-openai-analysis-provider.mjs";

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const SOD_OPENAI_DEFAULT_TIMEOUT_MS = 120_000;

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
  if (text(requestId)) error.requestId = text(requestId);
  return error;
}

export function createOpenAiResponsesFetchClient({
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = SOD_OPENAI_DEFAULT_TIMEOUT_MS,
} = {}) {
  const configuredKey = text(apiKey);
  if (!configuredKey) {
    throw productionError("OPENAI_API_KEY is required for production SOD analysis", "SOD_OPENAI_API_KEY_REQUIRED");
  }
  if (typeof fetchImpl !== "function") {
    throw productionError("Production OpenAI SOD provider requires fetch", "SOD_OPENAI_FETCH_REQUIRED");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw productionError("OpenAI SOD timeout must be a positive integer", "SOD_OPENAI_TIMEOUT_INVALID");
  }

  return Object.freeze({
    responses: Object.freeze({
      async create(payload) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        timer.unref?.();
        try {
          const response = await fetchImpl(OPENAI_RESPONSES_URL, {
            method: "POST",
            headers: {
              authorization: `Bearer ${configuredKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          if (!response || response.ok !== true) {
            throw upstreamError(response?.status, response?.headers?.get?.("x-request-id"));
          }

          try {
            return await response.json();
          } catch {
            throw upstreamError(502, response?.headers?.get?.("x-request-id"));
          }
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
  timeoutMs = SOD_OPENAI_DEFAULT_TIMEOUT_MS,
  clock = () => new Date().toISOString(),
} = {}) {
  const apiKey = text(env?.OPENAI_API_KEY);
  if (!apiKey) {
    throw productionError("OPENAI_API_KEY is required for production SOD analysis", "SOD_OPENAI_API_KEY_REQUIRED");
  }

  const model = text(env?.EXECUTIONOS_SOD_OPENAI_MODEL);
  if (!model) {
    throw productionError(
      "EXECUTIONOS_SOD_OPENAI_MODEL is required; production SOD analysis has no silent model fallback",
      "SOD_OPENAI_MODEL_REQUIRED",
    );
  }

  const client = createOpenAiResponsesFetchClient({ apiKey, fetchImpl, timeoutMs });
  return createOpenAiSodAnalysisProvider({ client, model, clock });
}
