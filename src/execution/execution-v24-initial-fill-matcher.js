import { validateBrokerExecutionOwnershipJournal } from "../../schwab-bridge/broker-execution-ownership-journal.mjs";

export const V24_INITIAL_FILL_MATCH_STATUSES = Object.freeze(["WAITING", "MATCHED", "SUSPENDED"]);

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

function immutable(value) {
  return Object.freeze(structuredClone(value));
}

function result(status, reason, extra = {}) {
  return immutable({ status, reason, ...extra });
}

function listeningProvenance(installation) {
  if (!installation || installation.status !== "LISTENING") return null;
  const v24 = installation.compatibility?.v24;
  const listeningAt = isoTimestamp(installation.executionListeningAt ?? v24?.executionListeningAt);
  if (!v24 || !listeningAt) return null;
  return {
    handoffId: text(v24.handoffId),
    symbol: upper(v24.symbol),
    direction: upper(v24.direction),
    authorizedExecutionAccountId: text(v24.authorizedExecutionAccountId),
    selectedQuantity: Number(v24.selectedQuantity),
    executionListeningAt: listeningAt,
  };
}

function expectedInstruction(direction) {
  if (direction === "LONG") return "BUY";
  if (direction === "SHORT") return "SELL_SHORT";
  return null;
}

function brokerUsable(brokerState) {
  return Boolean(
    brokerState
    && upper(brokerState.status) === "ARMED"
    && brokerState.readOnly === true
    && upper(brokerState.source) === "SCHWAB"
    && !text(brokerState.lastError),
  );
}

function eventOrder(left, right) {
  const timeDelta = Date.parse(left.executionTime) - Date.parse(right.executionTime);
  if (timeDelta) return timeDelta;
  return Number(left.sequence || 0) - Number(right.sequence || 0);
}

export function evaluateV24InitialFillOwnership({ installation, brokerState } = {}) {
  const provenance = listeningProvenance(installation);
  if (!provenance) {
    return result("SUSPENDED", "V24_LISTENING_INSTALLATION_REQUIRED");
  }

  if (!brokerUsable(brokerState)) {
    return result("SUSPENDED", "BROKER_STATE_UNAVAILABLE", { handoffId: provenance.handoffId });
  }

  const accountPresent = (Array.isArray(brokerState.accounts) ? brokerState.accounts : [])
    .some((account) => text(account?.accountId) === provenance.authorizedExecutionAccountId);
  if (!accountPresent) {
    return result("SUSPENDED", "AUTHORIZED_EXECUTION_ACCOUNT_UNAVAILABLE", { handoffId: provenance.handoffId });
  }

  const coverage = brokerState.executionCoverage;
  const journal = brokerState.executionOwnershipJournal;
  const journalContract = validateBrokerExecutionOwnershipJournal(journal);
  if (
    upper(coverage?.status) !== "CONTIGUOUS"
    || !journalContract.valid
    || !isoTimestamp(coverage?.coverageStartedAt)
    || !isoTimestamp(coverage?.currentThrough)
    || journal.coverageStartedAt !== coverage.coverageStartedAt
    || journal.currentThrough !== coverage.currentThrough
  ) {
    return result("SUSPENDED", "BROKER_EXECUTION_COVERAGE_GAP", { handoffId: provenance.handoffId });
  }

  const listeningMs = Date.parse(provenance.executionListeningAt);
  const coverageStartMs = Date.parse(coverage.coverageStartedAt);
  const currentThroughMs = Date.parse(coverage.currentThrough);
  if (coverageStartMs > listeningMs || currentThroughMs < listeningMs) {
    return result("SUSPENDED", "BROKER_EXECUTION_COVERAGE_GAP", {
      handoffId: provenance.handoffId,
      coverageStartedAt: coverage.coverageStartedAt,
      executionListeningAt: provenance.executionListeningAt,
    });
  }

  const instruction = expectedInstruction(provenance.direction);
  if (!instruction) {
    return result("SUSPENDED", "INVALID_V24_EXECUTION_PROVENANCE", { handoffId: provenance.handoffId });
  }

  const relevant = journal.entries
    .filter((event) => (
      upper(event?.symbol) === provenance.symbol
      && Date.parse(event.executionTime) >= listeningMs
      && Date.parse(event.executionTime) <= currentThroughMs
    ))
    .sort(eventOrder);

  const eligible = relevant.find((event) => (
    text(event.accountId) === provenance.authorizedExecutionAccountId
    && upper(event.positionEffect) === "OPENING"
    && upper(event.instruction) === instruction
  )) || null;

  const eligibleTime = eligible ? Date.parse(eligible.executionTime) : Number.POSITIVE_INFINITY;
  const preOwnership = relevant.filter((event) => Date.parse(event.executionTime) <= eligibleTime);

  const wrongAccount = preOwnership.find((event) => text(event.accountId) !== provenance.authorizedExecutionAccountId);
  if (wrongAccount) {
    return result("SUSPENDED", "WRONG_ACCOUNT_EXECUTION_OBSERVED", {
      handoffId: provenance.handoffId,
      conflictingExecution: wrongAccount,
    });
  }

  const unexpectedAuthorized = preOwnership.find((event) => (
    text(event.accountId) === provenance.authorizedExecutionAccountId
    && !(
      upper(event.positionEffect) === "OPENING"
      && upper(event.instruction) === instruction
    )
  ));
  if (unexpectedAuthorized) {
    return result("SUSPENDED", "UNEXPECTED_AUTHORIZED_ACCOUNT_EXECUTION", {
      handoffId: provenance.handoffId,
      conflictingExecution: unexpectedAuthorized,
    });
  }

  if (!eligible) {
    return result("WAITING", null, {
      handoffId: provenance.handoffId,
      observedThrough: coverage.currentThrough,
    });
  }

  const warnings = [];
  if (Number(eligible.quantity) > provenance.selectedQuantity) warnings.push("AUTHORIZED_QUANTITY_EXCEEDED");

  return result("MATCHED", null, {
    handoffId: provenance.handoffId,
    executionAccountId: provenance.authorizedExecutionAccountId,
    matchedExecution: eligible,
    warnings,
  });
}
