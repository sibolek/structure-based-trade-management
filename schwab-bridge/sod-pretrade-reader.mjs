export const DEFAULT_SOD_PRETRADE_URL = "http://127.0.0.1:8788";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function text(value) {
  return String(value ?? "").trim();
}

function readerError(message, code = "SOD_PRETRADE_READER_ERROR", details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

export function assertLoopbackSodPretradeUrl(value = DEFAULT_SOD_PRETRADE_URL) {
  let parsed;
  try {
    parsed = new URL(text(value));
  } catch {
    throw readerError("SOD PRETRADE URL must be a valid absolute URL", "SOD_PRETRADE_URL_INVALID");
  }
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw readerError(
      "SOD orchestration may read PRETRADE through loopback HTTP only",
      "SOD_PRETRADE_URL_NON_LOOPBACK",
    );
  }
  return parsed;
}

async function getJson(url, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 3000,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw readerError("SOD PRETRADE reader requires fetch implementation", "SOD_PRETRADE_FETCH_UNAVAILABLE");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    throw readerError(
      `SOD PRETRADE read failed: ${error.message}`,
      error?.name === "AbortError" ? "SOD_PRETRADE_TIMEOUT" : "SOD_PRETRADE_TRANSPORT_ERROR",
      { causeCode: error?.code || null },
    );
  } finally {
    clearTimeout(timer);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw readerError("SOD PRETRADE returned invalid JSON", "SOD_PRETRADE_INVALID_JSON");
  }

  if (!response.ok) {
    throw readerError(
      `SOD PRETRADE returned HTTP ${response.status}`,
      "SOD_PRETRADE_HTTP_ERROR",
      { status: response.status, payload },
    );
  }
  if (payload?.brokerWriteAuthority === true) {
    throw readerError(
      "SOD PRETRADE response attempted to grant broker-write authority",
      "SOD_PRETRADE_BROKER_WRITE_AUTHORITY_VIOLATION",
    );
  }
  return payload;
}

export async function fetchSodPretradeSnapshot(pretradeUrl = DEFAULT_SOD_PRETRADE_URL, options = {}) {
  const base = assertLoopbackSodPretradeUrl(pretradeUrl);
  const health = await getJson(new URL("/health", base), options);
  const violations = [];
  if (health.ok !== true) violations.push("ok must be true");
  if (health.service !== "executionos-v24-pretrade") violations.push("service identity mismatch");
  if (health.candidateContractVersioning !== true) violations.push("candidate contract versioning authority missing");
  if (health.readOnlyBrokerBoundary !== true) violations.push("read-only broker boundary missing");
  if (health.brokerWriteAuthority === true) violations.push("broker-write authority must remain absent");
  if (violations.length) {
    throw readerError(
      `SOD PRETRADE capability mismatch: ${violations.join("; ")}`,
      "SOD_PRETRADE_CAPABILITY_MISMATCH",
      { violations },
    );
  }

  const snapshot = await getJson(new URL("/api/candidates", base), options);
  if (!Array.isArray(snapshot?.candidates)) {
    throw readerError(
      "SOD PRETRADE snapshot is missing candidates",
      "SOD_PRETRADE_SNAPSHOT_INVALID",
    );
  }
  return {
    health,
    snapshot,
  };
}
