export const BROKER_EXECUTION_OWNERSHIP_JOURNAL_SCHEMA_VERSION = 1;
const SOURCE = "SCHWAB_ORDER_API_POLL";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function finiteNumber(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function journalError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeExecution(execution, sequence) {
  const accountId = text(execution?.accountId);
  const symbol = upper(execution?.symbol);
  const instruction = upper(execution?.instruction);
  const positionEffect = upper(execution?.positionEffect);
  const executionTime = isoTimestamp(execution?.executionTime);
  const detectedAt = isoTimestamp(execution?.detectedAt);
  const quantity = finiteNumber(execution?.quantity);
  const price = finiteNumber(execution?.price);

  if (!accountId) throw journalError("execution accountId is required", "BROKER_ACCOUNT_ID_REQUIRED");
  if (!symbol) throw journalError("execution symbol is required", "BROKER_EXECUTION_SYMBOL_REQUIRED");
  if (!instruction) throw journalError("execution instruction is required", "BROKER_EXECUTION_INSTRUCTION_REQUIRED");
  if (!positionEffect) throw journalError("execution positionEffect is required", "BROKER_EXECUTION_POSITION_EFFECT_REQUIRED");
  if (!executionTime) throw journalError("authoritative Schwab executionTime is required", "BROKER_EXECUTION_TIME_REQUIRED");
  if (!detectedAt) throw journalError("execution detectedAt is required", "BROKER_EXECUTION_DETECTED_AT_REQUIRED");
  if (!(quantity > 0)) throw journalError("execution quantity must be positive", "BROKER_EXECUTION_QUANTITY_INVALID");
  if (!(price > 0)) throw journalError("execution price must be positive", "BROKER_EXECUTION_PRICE_INVALID");

  return {
    sequence,
    accountId,
    account: text(execution?.account) || null,
    symbol,
    instruction,
    positionEffect,
    quantity,
    price,
    executionTime,
    detectedAt,
    stateEvent: upper(execution?.stateEvent) || null,
    previousSide: upper(execution?.previousSide) || null,
    previousQuantity: finiteNumber(execution?.previousQuantity) ?? 0,
    nextSide: upper(execution?.nextSide) || null,
    nextQuantity: finiteNumber(execution?.nextQuantity) ?? 0,
    averagePrice: finiteNumber(execution?.averagePrice),
  };
}

export function validateBrokerExecutionOwnershipJournal(journal) {
  const value = journal && typeof journal === "object" ? journal : {};
  const errors = [];
  const coverageStartedAt = isoTimestamp(value.coverageStartedAt);
  const currentThrough = isoTimestamp(value.currentThrough);
  const entries = Array.isArray(value.entries) ? value.entries : null;

  if (Number(value.schemaVersion) !== BROKER_EXECUTION_OWNERSHIP_JOURNAL_SCHEMA_VERSION) errors.push("unsupported schemaVersion");
  if (upper(value.source) !== SOURCE) errors.push("source is invalid");
  if (!entries) errors.push("entries must be an array");
  if ((coverageStartedAt && !currentThrough) || (!coverageStartedAt && currentThrough)) {
    errors.push("coverageStartedAt and currentThrough must be established together");
  }
  if (coverageStartedAt && currentThrough && Date.parse(currentThrough) < Date.parse(coverageStartedAt)) {
    errors.push("currentThrough cannot precede coverageStartedAt");
  }
  if (!coverageStartedAt && entries?.length) errors.push("unestablished journal cannot contain entries");

  let lastSequence = 0;
  for (const entry of entries || []) {
    const executionTime = isoTimestamp(entry?.executionTime);
    const detectedAt = isoTimestamp(entry?.detectedAt);
    const sequence = Number(entry?.sequence);
    if (!Number.isInteger(sequence) || sequence <= lastSequence) errors.push("entry sequence must be strictly increasing positive integers");
    lastSequence = Number.isInteger(sequence) ? sequence : lastSequence;
    if (!text(entry?.accountId)) errors.push("entry accountId is required");
    if (!upper(entry?.symbol)) errors.push("entry symbol is required");
    if (!upper(entry?.instruction)) errors.push("entry instruction is required");
    if (!upper(entry?.positionEffect)) errors.push("entry positionEffect is required");
    if (!executionTime) errors.push("entry executionTime is required");
    if (!detectedAt) errors.push("entry detectedAt is required");
    if (!(finiteNumber(entry?.quantity) > 0)) errors.push("entry quantity must be positive");
    if (!(finiteNumber(entry?.price) > 0)) errors.push("entry price must be positive");
    if (coverageStartedAt && executionTime && Date.parse(executionTime) < Date.parse(coverageStartedAt)) {
      errors.push("entry executionTime cannot precede coverageStartedAt");
    }
  }

  return { valid: errors.length === 0, errors: Object.freeze(errors) };
}

function requireValid(journal) {
  const result = validateBrokerExecutionOwnershipJournal(journal);
  if (!result.valid) {
    throw journalError(`broker execution ownership journal is invalid: ${result.errors.join("; ")}`, "INVALID_BROKER_EXECUTION_OWNERSHIP_JOURNAL");
  }
  return journal;
}

export function createBrokerExecutionOwnershipJournal() {
  return immutable(requireValid({
    schemaVersion: BROKER_EXECUTION_OWNERSHIP_JOURNAL_SCHEMA_VERSION,
    source: SOURCE,
    coverageStartedAt: null,
    currentThrough: null,
    entries: [],
  }));
}

export function establishBrokerExecutionOwnershipJournal(journal, { coverageStartedAt, currentThrough = coverageStartedAt } = {}) {
  requireValid(journal);
  if (journal.coverageStartedAt) {
    throw journalError("ownership journal interval is already established", "BROKER_EXECUTION_OWNERSHIP_JOURNAL_ALREADY_ESTABLISHED");
  }
  const startedAt = isoTimestamp(coverageStartedAt);
  const through = isoTimestamp(currentThrough);
  if (!startedAt || !through || Date.parse(through) < Date.parse(startedAt)) {
    throw journalError("valid ownership-journal coverage interval is required", "BROKER_EXECUTION_OWNERSHIP_JOURNAL_INTERVAL_INVALID");
  }
  return immutable(requireValid({
    ...structuredClone(journal),
    coverageStartedAt: startedAt,
    currentThrough: through,
  }));
}

export function appendBrokerExecutionOwnershipEvent(journal, execution) {
  requireValid(journal);
  if (!journal.coverageStartedAt) {
    throw journalError("ownership journal interval is not established", "BROKER_EXECUTION_OWNERSHIP_JOURNAL_NOT_ESTABLISHED");
  }

  const sequence = journal.entries.length ? Number(journal.entries[journal.entries.length - 1].sequence) + 1 : 1;
  const entry = normalizeExecution(execution, sequence);
  if (Date.parse(entry.executionTime) < Date.parse(journal.coverageStartedAt)) {
    return journal;
  }

  return immutable(requireValid({
    ...structuredClone(journal),
    entries: [...journal.entries.map((item) => structuredClone(item)), entry],
  }));
}

export function advanceBrokerExecutionOwnershipJournal(journal, { observedThrough } = {}) {
  requireValid(journal);
  if (!journal.coverageStartedAt) {
    throw journalError("ownership journal interval is not established", "BROKER_EXECUTION_OWNERSHIP_JOURNAL_NOT_ESTABLISHED");
  }
  const through = isoTimestamp(observedThrough);
  if (!through || Date.parse(through) < Date.parse(journal.currentThrough)) {
    throw journalError("ownership journal coverage cannot move backward", "BROKER_EXECUTION_OWNERSHIP_JOURNAL_TIME_REGRESSION");
  }
  return immutable(requireValid({
    ...structuredClone(journal),
    currentThrough: through,
  }));
}
