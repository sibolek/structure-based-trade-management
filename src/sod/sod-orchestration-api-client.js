export const DEFAULT_SOD_ORCHESTRATION_URL = "http://127.0.0.1:8790";
export const SOD_ORCHESTRATION_SERVICE = "executionos-v24-sod-orchestrator";
export const SOD_CHART_INGESTION_CAPABILITY = "IMMUTABLE_OPAQUE_REF";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const CHART_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function text(value) {
  return String(value ?? "").trim();
}

function clientError(message, code = "SOD_ORCHESTRATION_CLIENT_ERROR", details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function normalizeBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(text(value || DEFAULT_SOD_ORCHESTRATION_URL));
  } catch {
    throw clientError("SOD orchestration URL must be an absolute URL", "SOD_CLIENT_URL_INVALID");
  }
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw clientError("SOD orchestration URL must use loopback HTTP only", "SOD_CLIENT_URL_INVALID");
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  return parsed.toString().replace(/\/$/, "");
}

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw clientError(
      payload?.message || payload?.error || `SOD orchestration HTTP ${response.status}`,
      payload?.error || "SOD_ORCHESTRATION_HTTP_ERROR",
      payload,
    );
  }
  return payload;
}

function assertHealthCapabilities(health) {
  const violations = [];
  if (health?.ok !== true) violations.push("ok must be true");
  if (health?.service !== SOD_ORCHESTRATION_SERVICE) violations.push("service identity mismatch");
  if (health?.pretradeAccess !== "READ_ONLY_HTTP") violations.push("PRETRADE access must remain READ_ONLY_HTTP");
  if (health?.candidatePublication !== "ATOMIC_INBOX_ONLY") violations.push("candidate publication must remain ATOMIC_INBOX_ONLY");
  if (health?.chartIngestion !== SOD_CHART_INGESTION_CAPABILITY) violations.push("chart ingestion capability mismatch");
  if (health?.lifecycleAuthority !== false) violations.push("lifecycle authority must remain false");
  if (health?.armAuthority !== false) violations.push("ARM authority must remain false");
  if (health?.executionAuthority !== false) violations.push("execution authority must remain false");
  if (health?.brokerWriteAuthority !== false) violations.push("broker write authority must remain false");

  if (violations.length) {
    throw clientError(
      `SOD orchestration capability mismatch: ${violations.join("; ")}`,
      "SOD_CLIENT_CAPABILITY_MISMATCH",
      { violations },
    );
  }
  return health;
}

function assertChartFile(file) {
  if (!file || typeof file !== "object") {
    throw clientError("SOD chart file is required", "SOD_CLIENT_CHART_FILE_REQUIRED");
  }
  const mediaType = text(file.type).toLowerCase();
  if (!CHART_MEDIA_TYPES.has(mediaType)) {
    throw clientError(
      `Unsupported SOD chart media type ${mediaType || "(empty)"}`,
      "SOD_CLIENT_CHART_MEDIA_UNSUPPORTED",
    );
  }
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    throw clientError("SOD chart file is empty", "SOD_CLIENT_CHART_FILE_INVALID");
  }
  return { mediaType, displayName: text(file.name) || "chart" };
}

export function createSodOrchestrationApiClient({
  baseUrl = DEFAULT_SOD_ORCHESTRATION_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw clientError("SOD orchestration client requires fetch", "SOD_CLIENT_FETCH_REQUIRED");
  }

  const resolvedBaseUrl = normalizeBaseUrl(baseUrl);
  let sessionToken = null;

  async function request(pathname, options = {}) {
    return fetchImpl(`${resolvedBaseUrl}${pathname}`, {
      cache: "no-store",
      ...options,
      headers: {
        ...(options.body && !options.headers?.["content-type"] ? { "content-type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    }).then(parseJsonResponse);
  }

  async function health() {
    return assertHealthCapabilities(await request("/health"));
  }

  async function bootstrapSession() {
    const payload = await request("/api/sod/session");
    if (payload?.service !== SOD_ORCHESTRATION_SERVICE || !text(payload?.sessionToken)) {
      throw clientError("SOD orchestration session response is invalid", "SOD_CLIENT_SESSION_INVALID");
    }
    sessionToken = payload.sessionToken;
    return { service: payload.service };
  }

  async function authorizedRequest(pathname, options) {
    await health();
    if (!sessionToken) await bootstrapSession();

    const execute = () => request(pathname, {
      ...options,
      headers: {
        ...(options?.headers || {}),
        "x-executionos-sod-session": sessionToken,
      },
    });

    try {
      return await execute();
    } catch (error) {
      if (error?.code !== "SOD_ORCHESTRATION_SESSION_FORBIDDEN") throw error;
      sessionToken = null;
      await bootstrapSession();
      return execute();
    }
  }

  async function uploadChart(file) {
    const { mediaType, displayName } = assertChartFile(file);
    const payload = await authorizedRequest("/api/sod/charts", {
      method: "POST",
      body: file,
      headers: {
        "content-type": mediaType,
        "x-executionos-chart-name": encodeURIComponent(displayName),
      },
    });
    const chart = payload?.chart;
    if (!text(chart?.chartId) || !text(chart?.contentRef)) {
      throw clientError("SOD chart ingestion response is invalid", "SOD_CLIENT_CHART_RESPONSE_INVALID");
    }
    return chart;
  }

  async function generate(generationRequest) {
    return authorizedRequest("/api/sod/generate", {
      method: "POST",
      body: JSON.stringify(generationRequest || {}),
    });
  }

  return Object.freeze({
    baseUrl: resolvedBaseUrl,
    health,
    uploadChart,
    generate,
    resetSession() {
      sessionToken = null;
    },
  });
}
