export const V24_ROUTER_FAILURE_STAGES = Object.freeze([
  "ACTIVATION",
  "RETIREMENT",
  "FIRST_FILL",
  "LIFECYCLE",
  "ROUTER_SERVICE",
  "STORE",
  "TRANSPORT",
]);

export const V24_ROUTER_FAILURE_SCOPES = Object.freeze([
  "HANDOFF",
  "SERVICE",
  "STORE",
]);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function iso(value) {
  if (value === null || value === undefined || value === "") {
    return new Date().toISOString();
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) return new Date(numeric).toISOString();

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : new Date().toISOString();
}

function stableCode(value, fallback) {
  const candidate = upper(value);
  return /^[A-Z0-9_]+$/.test(candidate) ? candidate : fallback;
}

function isStoreFailureCode(code) {
  const value = upper(code);
  return (
    value === "LOCAL_EXECUTION_PERSISTENCE_FAILED"
    || value === "EXECUTION_BOARD_STORE_WRITER_LOCK_UNAVAILABLE"
    || value.startsWith("INVALID_EXECUTION_BOARD_STORE_")
  );
}

function normalizeStage(stage, code) {
  if (isStoreFailureCode(code)) return "STORE";

  const candidate = upper(stage);
  return V24_ROUTER_FAILURE_STAGES.includes(candidate)
    ? candidate
    : "ROUTER_SERVICE";
}

function normalizeScope(scope, stage, handoffId) {
  const candidate = upper(scope);
  if (V24_ROUTER_FAILURE_SCOPES.includes(candidate)) return candidate;
  if (stage === "STORE") return "STORE";
  if (text(handoffId)) return "HANDOFF";
  return "SERVICE";
}

export function createV24RouterFailure({
  occurredAt = new Date().toISOString(),
  stage = "ROUTER_SERVICE",
  code,
  message,
  error = null,
  handoffId = null,
  symbol = null,
  scope = null,
  recoverable = null,
} = {}) {
  const rawCode = error?.code || code;
  const normalizedStage = normalizeStage(stage, rawCode);
  const fallbackCode = `${normalizedStage}_ERROR`;
  const normalizedCode = stableCode(rawCode, fallbackCode);
  const normalizedMessage = text(message)
    || text(error?.message)
    || text(rawCode)
    || "V2.4 router operational failure";

  const normalizedScope = normalizeScope(
    scope,
    normalizedStage,
    handoffId,
  );

  return Object.freeze({
    occurredAt: iso(occurredAt),
    stage: normalizedStage,
    code: normalizedCode,
    message: normalizedMessage,
    handoffId: text(handoffId) || null,
    symbol: upper(symbol) || null,
    scope: normalizedScope,
    recoverable: recoverable === null || recoverable === undefined
      ? normalizedScope !== "STORE"
      : Boolean(recoverable),
  });
}

export function failuresFromV24RouterCycleResult(result, {
  occurredAt = result?.processedAt || new Date().toISOString(),
} = {}) {
  const results = Array.isArray(result?.results) ? result.results : [];

  return Object.freeze(results
    .filter((item) => upper(item?.status) === "ERROR")
    .map((item) => {
      const reason = text(item?.reason);
      const stage = normalizeStage(item?.stage, reason);

      return createV24RouterFailure({
        occurredAt,
        stage,
        code: reason,
        message: reason || `${stage} failed`,
        handoffId: item?.handoffId,
        symbol: item?.symbol,
      });
    }));
}
