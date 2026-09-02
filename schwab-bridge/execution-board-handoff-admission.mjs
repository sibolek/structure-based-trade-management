import { validateExecutionBoardHandoffContract } from "./execution-board-handoff.mjs";
import { validateBrokerExecutionCoverage } from "./broker-execution-provenance.mjs";
import {
  brokerExecutionActivitySince,
  validateBrokerExecutionActivity,
} from "./broker-execution-activity.mjs";

export const EXECUTION_BOARD_HANDOFF_ADMISSION_REASONS = Object.freeze([
  "AUTHORIZED_EXECUTION_ACCOUNT_UNAVAILABLE",
  "BROKER_STATE_UNAVAILABLE",
  "BROKER_EXECUTION_COVERAGE_GAP",
  "EXISTING_POSITION_AT_HANDOFF",
  "INTERVENING_BROKER_ACTIVITY",
  "WRONG_ACCOUNT_EXECUTION_OBSERVED",
  "EXECUTION_SYMBOL_OWNERSHIP_CONFLICT",
]);

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

function admissionError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function blocked(reason, evidence = {}) {
  return immutable({
    status: "BLOCKED",
    admitted: false,
    reason,
    evidence,
  });
}

function admitted(evidence = {}) {
  return immutable({
    status: "ADMITTED",
    admitted: true,
    reason: null,
    evidence,
  });
}

function brokerStateUsable(brokerState) {
  return (
    brokerState
    && typeof brokerState === "object"
    && upper(brokerState.status) === "ARMED"
    && brokerState.readOnly === true
    && upper(brokerState.source) === "SCHWAB"
    && !text(brokerState.lastError)
  );
}

function ownedSymbolSet(executionOwnedSymbols) {
  const values = Array.isArray(executionOwnedSymbols) ? executionOwnedSymbols : [];
  return new Set(values.map((item) => upper(
    typeof item === "string" ? item : item?.symbol,
  )).filter(Boolean));
}

export function evaluateExecutionBoardHandoffAdmission({
  handoff,
  brokerState,
  executionOwnedSymbols = [],
  requiredThrough = handoff?.createdAt,
} = {}) {
  const handoffContract = validateExecutionBoardHandoffContract(handoff);
  if (!handoffContract.valid) {
    throw admissionError(
      `handoff admission input is invalid: ${handoffContract.errors.join("; ")}`,
      "INVALID_EXECUTION_BOARD_HANDOFF_ADMISSION_INPUT",
    );
  }

  const symbol = upper(handoff.symbol);
  const authorizedAccountId = text(handoff.authorizedExecutionAccountId);
  const authorizedAt = isoTimestamp(handoff.authorizedAt);
  const proofRequiredThrough = isoTimestamp(requiredThrough);

  if (!brokerState || typeof brokerState !== "object") {
    return blocked("BROKER_STATE_UNAVAILABLE", { symbol, authorizedAccountId });
  }

  // Decision 12 ordering: exact authorized account is the first broker-state gate.
  const accounts = Array.isArray(brokerState.accounts) ? brokerState.accounts : [];
  const exactAccount = accounts.find((account) => text(account?.accountId) === authorizedAccountId);
  if (!exactAccount) {
    return blocked("AUTHORIZED_EXECUTION_ACCOUNT_UNAVAILABLE", {
      symbol,
      authorizedAccountId,
    });
  }

  if (!brokerStateUsable(brokerState)) {
    return blocked("BROKER_STATE_UNAVAILABLE", {
      symbol,
      authorizedAccountId,
      brokerStatus: upper(brokerState.status) || null,
      lastError: text(brokerState.lastError) || null,
    });
  }

  const coverage = brokerState.executionCoverage;
  const activity = brokerState.executionActivity;
  const coverageContract = validateBrokerExecutionCoverage(coverage);
  const activityContract = validateBrokerExecutionActivity(activity);

  if (!coverageContract.valid || !activityContract.valid || coverage?.status !== "CONTIGUOUS") {
    return blocked("BROKER_EXECUTION_COVERAGE_GAP", {
      symbol,
      authorizedAccountId,
      coverageStatus: upper(coverage?.status) || null,
    });
  }

  const coverageStartedAt = isoTimestamp(coverage.coverageStartedAt);
  const currentThrough = isoTimestamp(coverage.currentThrough);
  const activityStartedAt = isoTimestamp(activity.coverageStartedAt);
  const activityCurrentThrough = isoTimestamp(activity.currentThrough);

  const intervalAligned = (
    coverageStartedAt
    && currentThrough
    && activityStartedAt === coverageStartedAt
    && activityCurrentThrough === currentThrough
  );
  const requiredThroughMs = proofRequiredThrough ? Date.parse(proofRequiredThrough) : NaN;
  const intervalSufficient = (
    intervalAligned
    && authorizedAt
    && proofRequiredThrough
    && Date.parse(coverageStartedAt) <= Date.parse(authorizedAt)
    && Date.parse(currentThrough) >= Date.parse(authorizedAt)
    && Number.isFinite(requiredThroughMs)
    && Date.parse(currentThrough) >= requiredThroughMs
  );

  if (!intervalSufficient) {
    return blocked("BROKER_EXECUTION_COVERAGE_GAP", {
      symbol,
      authorizedAccountId,
      authorizedAt,
      requiredThrough: proofRequiredThrough,
      coverageStartedAt,
      currentThrough,
      activityStartedAt,
      activityCurrentThrough,
    });
  }

  const positions = Array.isArray(brokerState.positions) ? brokerState.positions : [];
  for (const position of positions) {
    if (upper(position?.symbol) !== symbol) continue;
    const quantity = Number(position?.quantity);
    if (!Number.isFinite(quantity)) {
      return blocked("BROKER_STATE_UNAVAILABLE", {
        symbol,
        authorizedAccountId,
        malformedPositionAccountId: text(position?.accountId) || null,
      });
    }
    if (quantity !== 0) {
      return blocked("EXISTING_POSITION_AT_HANDOFF", {
        symbol,
        authorizedAccountId,
        positionAccountId: text(position?.accountId) || null,
        positionQuantity: quantity,
      });
    }
  }

  const intervening = brokerExecutionActivitySince(activity, {
    symbol,
    since: authorizedAt,
  });

  // A wrong-account execution is the stronger ambiguity if both intended- and
  // wrong-account activity exist during the interval.
  const wrongAccountExecution = intervening.find(
    (entry) => text(entry.accountId) !== authorizedAccountId,
  );
  if (wrongAccountExecution) {
    return blocked("WRONG_ACCOUNT_EXECUTION_OBSERVED", {
      symbol,
      authorizedAccountId,
      executionAccountId: wrongAccountExecution.accountId,
      latestExecutionTime: wrongAccountExecution.latestExecutionTime,
      latestDetectedAt: wrongAccountExecution.latestDetectedAt,
    });
  }

  const intendedAccountExecution = intervening.find(
    (entry) => text(entry.accountId) === authorizedAccountId,
  );
  if (intendedAccountExecution) {
    return blocked("INTERVENING_BROKER_ACTIVITY", {
      symbol,
      authorizedAccountId,
      latestExecutionTime: intendedAccountExecution.latestExecutionTime,
      latestDetectedAt: intendedAccountExecution.latestDetectedAt,
    });
  }

  if (ownedSymbolSet(executionOwnedSymbols).has(symbol)) {
    return blocked("EXECUTION_SYMBOL_OWNERSHIP_CONFLICT", {
      symbol,
      authorizedAccountId,
    });
  }

  return admitted({
    symbol,
    authorizedAccountId,
    authorizedAt,
    requiredThrough: proofRequiredThrough,
    coverageStartedAt,
    currentThrough,
  });
}
