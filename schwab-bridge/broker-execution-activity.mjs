export const BROKER_EXECUTION_ACTIVITY_SCHEMA_VERSION = 1;
export const BROKER_EXECUTION_ACTIVITY_SOURCE = "SCHWAB_ORDER_API_POLL";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function isoTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return new Date(numeric).toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function activityError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function entryKey(accountId, symbol) {
  return `${text(accountId)}|${upper(symbol)}`;
}

function normalizeExecution(execution) {
  const accountId = text(execution?.accountId ?? execution?.accountHash);
  const symbol = upper(execution?.symbol);
  const executionTime = isoTimestamp(execution?.executionTime);
  const detectedAt = isoTimestamp(execution?.detectedAt);

  if (!accountId) {
    throw activityError("execution accountId is required", "BROKER_EXECUTION_ACTIVITY_ACCOUNT_REQUIRED");
  }
  if (!symbol || symbol === "?") {
    throw activityError("execution symbol is required", "BROKER_EXECUTION_ACTIVITY_SYMBOL_REQUIRED");
  }
  if (!executionTime) {
    throw activityError("authoritative Schwab executionTime is required", "BROKER_EXECUTION_TIME_REQUIRED");
  }
  if (!detectedAt) {
    throw activityError("execution detectedAt is required for audit provenance", "BROKER_EXECUTION_DETECTED_AT_REQUIRED");
  }

  return { accountId, symbol, executionTime, detectedAt };
}

export function validateBrokerExecutionActivity(activity) {
  const value = activity && typeof activity === "object" ? activity : {};
  const errors = [];
  const coverageStartedAt = isoTimestamp(value.coverageStartedAt);
  const currentThrough = isoTimestamp(value.currentThrough);
  const source = upper(value.source);
  const entries = Array.isArray(value.entries) ? value.entries : null;

  if (Number(value.schemaVersion) !== BROKER_EXECUTION_ACTIVITY_SCHEMA_VERSION) errors.push("unsupported schemaVersion");
  if (source !== BROKER_EXECUTION_ACTIVITY_SOURCE) errors.push("source is invalid");
  if (!entries) errors.push("entries must be an array");

  const intervalEstablished = Boolean(coverageStartedAt || currentThrough);
  if (intervalEstablished && (!coverageStartedAt || !currentThrough)) {
    errors.push("coverageStartedAt and currentThrough must either both be present or both be null");
  }
  if (!intervalEstablished && entries?.length) {
    errors.push("unestablished activity cannot contain entries");
  }
  if (coverageStartedAt && currentThrough && Date.parse(currentThrough) < Date.parse(coverageStartedAt)) {
    errors.push("currentThrough cannot precede coverageStartedAt");
  }

  const seen = new Set();
  for (const entry of entries || []) {
    const accountId = text(entry?.accountId);
    const symbol = upper(entry?.symbol);
    const latestExecutionTime = isoTimestamp(entry?.latestExecutionTime);
    const latestDetectedAt = isoTimestamp(entry?.latestDetectedAt);
    const key = entryKey(accountId, symbol);

    if (!accountId) errors.push("entry accountId is required");
    if (!symbol || symbol === "?") errors.push("entry symbol is required");
    if (!latestExecutionTime) errors.push("entry latestExecutionTime is invalid");
    if (!latestDetectedAt) errors.push("entry latestDetectedAt is invalid");
    if (seen.has(key)) errors.push(`duplicate account+symbol activity entry: ${key}`);
    seen.add(key);

    if (coverageStartedAt && latestExecutionTime && Date.parse(latestExecutionTime) < Date.parse(coverageStartedAt)) {
      errors.push(`entry latestExecutionTime precedes coverageStartedAt: ${key}`);
    }
  }

  return { valid: errors.length === 0, errors: Object.freeze(errors) };
}

function requireValidActivity(activity) {
  const contract = validateBrokerExecutionActivity(activity);
  if (!contract.valid) {
    throw activityError(
      `broker execution activity is invalid: ${contract.errors.join("; ")}`,
      "INVALID_BROKER_EXECUTION_ACTIVITY",
    );
  }
  return activity;
}

export function createBrokerExecutionActivity() {
  return immutable(requireValidActivity({
    schemaVersion: BROKER_EXECUTION_ACTIVITY_SCHEMA_VERSION,
    source: BROKER_EXECUTION_ACTIVITY_SOURCE,
    coverageStartedAt: null,
    currentThrough: null,
    entries: [],
  }));
}

export function establishBrokerExecutionActivity(activity, {
  coverageStartedAt,
  currentThrough = coverageStartedAt,
} = {}) {
  requireValidActivity(activity);
  if (activity.coverageStartedAt || activity.currentThrough || activity.entries.length) {
    throw activityError(
      "execution activity interval is already established",
      "BROKER_EXECUTION_ACTIVITY_ALREADY_ESTABLISHED",
    );
  }

  const startedAt = isoTimestamp(coverageStartedAt);
  const through = isoTimestamp(currentThrough);
  if (!startedAt || !through) {
    throw activityError(
      "coverageStartedAt and currentThrough are required",
      "BROKER_EXECUTION_ACTIVITY_INTERVAL_REQUIRED",
    );
  }
  if (Date.parse(through) < Date.parse(startedAt)) {
    throw activityError(
      "currentThrough cannot precede coverageStartedAt",
      "BROKER_EXECUTION_ACTIVITY_TIME_REGRESSION",
    );
  }

  return immutable(requireValidActivity({
    ...structuredClone(activity),
    coverageStartedAt: startedAt,
    currentThrough: through,
    entries: [],
  }));
}

export function advanceBrokerExecutionActivity(activity, {
  observedThrough,
  executions = [],
} = {}) {
  requireValidActivity(activity);
  if (!activity.coverageStartedAt || !activity.currentThrough) {
    throw activityError(
      "execution activity interval must be established before it can advance",
      "BROKER_EXECUTION_ACTIVITY_NOT_ESTABLISHED",
    );
  }
  if (!Array.isArray(executions)) {
    throw activityError("executions must be an array", "BROKER_EXECUTION_ACTIVITY_EXECUTIONS_INVALID");
  }

  const through = isoTimestamp(observedThrough);
  if (!through) {
    throw activityError("observedThrough is required", "BROKER_EXECUTION_ACTIVITY_OBSERVED_THROUGH_REQUIRED");
  }
  if (Date.parse(through) < Date.parse(activity.currentThrough)) {
    throw activityError(
      "execution activity currentThrough cannot move backward",
      "BROKER_EXECUTION_ACTIVITY_TIME_REGRESSION",
    );
  }

  // Validate every observed execution before changing any activity state. A missing
  // authoritative Schwab executionTime therefore fails the whole poll closed.
  const normalizedExecutions = executions.map(normalizeExecution);
  const startedMs = Date.parse(activity.coverageStartedAt);
  const entries = new Map(
    activity.entries.map((entry) => [entryKey(entry.accountId, entry.symbol), structuredClone(entry)]),
  );

  for (const execution of normalizedExecutions) {
    const executionMs = Date.parse(execution.executionTime);
    if (executionMs < startedMs) continue;

    const key = entryKey(execution.accountId, execution.symbol);
    const previous = entries.get(key);
    if (!previous) {
      entries.set(key, {
        accountId: execution.accountId,
        symbol: execution.symbol,
        latestExecutionTime: execution.executionTime,
        latestDetectedAt: execution.detectedAt,
      });
      continue;
    }

    const previousExecutionMs = Date.parse(previous.latestExecutionTime);
    const previousDetectedMs = Date.parse(previous.latestDetectedAt);
    const detectedMs = Date.parse(execution.detectedAt);

    if (
      executionMs > previousExecutionMs
      || (executionMs === previousExecutionMs && detectedMs > previousDetectedMs)
    ) {
      entries.set(key, {
        accountId: execution.accountId,
        symbol: execution.symbol,
        latestExecutionTime: execution.executionTime,
        latestDetectedAt: execution.detectedAt,
      });
    }
  }

  const orderedEntries = [...entries.values()].sort((a, b) => (
    a.accountId.localeCompare(b.accountId)
    || a.symbol.localeCompare(b.symbol)
  ));

  return immutable(requireValidActivity({
    ...structuredClone(activity),
    currentThrough: through,
    entries: orderedEntries,
  }));
}

export function brokerExecutionActivitySince(activity, { symbol, since } = {}) {
  requireValidActivity(activity);
  const normalizedSymbol = upper(symbol);
  const sinceAt = isoTimestamp(since);
  if (!normalizedSymbol || normalizedSymbol === "?") {
    throw activityError("symbol is required", "BROKER_EXECUTION_ACTIVITY_SYMBOL_REQUIRED");
  }
  if (!sinceAt) {
    throw activityError("since timestamp is required", "BROKER_EXECUTION_ACTIVITY_SINCE_REQUIRED");
  }

  const sinceMs = Date.parse(sinceAt);
  return immutable(activity.entries.filter((entry) => (
    entry.symbol === normalizedSymbol
    && Date.parse(entry.latestExecutionTime) >= sinceMs
  )));
}
