import { validateBrokerExecutionOwnershipJournal } from "../../schwab-bridge/broker-execution-ownership-journal.mjs";
import {
  readExecutionBoardStore,
  transactExecutionBoardStore,
  withExecutionBoardStoreWriterLock,
} from "./execution-board-store-repository.js";
import { executionOwnedSymbolsForHandoffAdmission } from "./execution-v24-active-ownership.js";
import {
  EXECUTION_V23_STORE_KEY,
  bindAndPersistV24ExecutionListeningAt,
  buildV23CandidateFromListeningInstallation,
  persistPreparedV24LocalInstallation,
} from "./execution-v24-local-installation.js";
import { evaluateV24InitialFillOwnership } from "./execution-v24-initial-fill-matcher.js";

export const V24_RETIREMENT_SCHEMA_VERSION = 1;
export const V24_RETIREMENT_STATUSES = Object.freeze([
  "REQUESTED",
  "RETIRED",
  "SUPERSEDED_BY_PRIOR_FILL",
  "RECONCILIATION_REQUIRED",
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

function retirementError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function installationById(store, handoffId) {
  return (Array.isArray(store?.v24Installations) ? store.v24Installations : [])
    .find((item) => text(item?.handoffId) === text(handoffId)) || null;
}

function retirementById(store, handoffId) {
  return (Array.isArray(store?.v24Retirements) ? store.v24Retirements : [])
    .find((item) => text(item?.handoffId) === text(handoffId)) || null;
}

function replaceRetirement(store, record) {
  const without = store.v24Retirements.filter((item) => text(item?.handoffId) !== text(record.handoffId));
  return { ...store, v24Retirements: [...without, structuredClone(record)] };
}

function verifyRetirement(store, expected) {
  const found = retirementById(store, expected.handoffId);
  if (!found || JSON.stringify(found) !== JSON.stringify(expected)) {
    throw retirementError("persisted V2.4 retirement differs on readback", "LOCAL_EXECUTION_PERSISTENCE_FAILED");
  }
  return immutable(found);
}

function receiverFor(installation) {
  return text(installation?.receiverId ?? installation?.compatibility?.v24?.executionBoardReceiverId);
}

function listeningAtFor(installation) {
  return isoTimestamp(installation?.executionListeningAt ?? installation?.compatibility?.v24?.executionListeningAt);
}

function terminal(status) {
  return ["RETIRED", "SUPERSEDED_BY_PRIOR_FILL", "RECONCILIATION_REQUIRED"].includes(upper(status));
}

function requireMatchingInstallation(installation, receiverId) {
  if (!installation || !["PREPARED", "LISTENING"].includes(upper(installation.status))) {
    throw retirementError("PREPARED or LISTENING V2.4 installation is required", "V24_RETIREMENT_INSTALLATION_REQUIRED");
  }
  const receiver = receiverFor(installation);
  const requestedReceiver = text(receiverId || receiver);
  if (!receiver || requestedReceiver !== receiver) {
    throw retirementError("retirement receiver does not own this installation", "EXECUTION_BOARD_HANDOFF_CLAIM_RECEIVER_MISMATCH");
  }
  return receiver;
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

function resolutionBrokerState(brokerState, cutoffAt) {
  const cutoffMs = Date.parse(cutoffAt);
  const journal = brokerState.executionOwnershipJournal;
  return {
    ...structuredClone(brokerState),
    executionCoverage: {
      ...structuredClone(brokerState.executionCoverage),
      currentThrough: cutoffAt,
    },
    executionOwnershipJournal: {
      ...structuredClone(journal),
      currentThrough: cutoffAt,
      entries: journal.entries.filter((event) => Date.parse(event.executionTime) < cutoffMs),
    },
  };
}

export function readV24Retirement({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_V23_STORE_KEY,
  handoffId,
} = {}) {
  const found = retirementById(readExecutionBoardStore({ storage, storeKey }), handoffId);
  return found ? immutable(found) : null;
}

export function requestV24Retirement({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_V23_STORE_KEY,
  handoffId,
  receiverId = null,
  requestedAt = Date.now(),
  reason = "USER_DISCARD",
} = {}) {
  const current = readExecutionBoardStore({ storage, storeKey });
  const already = retirementById(current, handoffId);
  if (already) return immutable(already);

  const requested = isoTimestamp(requestedAt);
  if (!requested) throw retirementError("discardRequestedAt is invalid", "V24_RETIREMENT_CUTOFF_INVALID");

  let record = null;
  const committed = transactExecutionBoardStore({
    storage,
    storeKey,
    mutate: (store) => {
      const existing = retirementById(store, handoffId);
      if (existing) {
        record = structuredClone(existing);
        return store;
      }

      const installation = installationById(store, handoffId);
      const receiver = requireMatchingInstallation(installation, receiverId);
      const listeningAt = listeningAtFor(installation);
      const preparedOnly = upper(installation.status) === "PREPARED";
      if (!preparedOnly && !listeningAt) {
        throw retirementError("LISTENING installation has no executionListeningAt", "V24_EXECUTION_LISTENING_AT_INVALID");
      }
      if (listeningAt && Date.parse(requested) < Date.parse(listeningAt)) {
        throw retirementError("discard cutoff cannot precede executionListeningAt", "V24_RETIREMENT_CUTOFF_INVALID");
      }

      record = {
        schemaVersion: V24_RETIREMENT_SCHEMA_VERSION,
        retirementId: `retirement:${text(handoffId)}`,
        handoffId: text(handoffId),
        receiverId: receiver,
        symbol: upper(installation.symbol ?? installation.compatibility?.v24?.symbol),
        executionListeningAt: listeningAt,
        requestedAt: requested,
        cutoffAt: requested,
        reason: text(reason) || "USER_DISCARD",
        status: preparedOnly ? "RETIRED" : "REQUESTED",
        finalizedAt: preparedOnly ? requested : null,
        priorFill: null,
      };

      return replaceRetirement(store, record);
    },
  });

  return verifyRetirement(committed, record);
}

export async function requestV24RetirementSerialized({
  lockManager = globalThis?.navigator?.locks,
  ...options
} = {}) {
  return withExecutionBoardStoreWriterLock({
    lockManager,
    operation: () => requestV24Retirement(options),
  });
}

export function resolveV24Retirement({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_V23_STORE_KEY,
  handoffId,
  brokerState,
  finalizedAt = Date.now(),
} = {}) {
  const finalized = isoTimestamp(finalizedAt);
  if (!finalized) throw retirementError("retirement finalizedAt is invalid", "V24_RETIREMENT_FINALIZED_AT_INVALID");

  const current = readExecutionBoardStore({ storage, storeKey });
  const already = retirementById(current, handoffId);
  if (!already) throw retirementError("retirement request was not found", "V24_RETIREMENT_NOT_FOUND");
  if (terminal(already.status)) return immutable(already);

  let resolved = null;
  const committed = transactExecutionBoardStore({
    storage,
    storeKey,
    mutate: (store) => {
      const retirement = retirementById(store, handoffId);
      if (!retirement) throw retirementError("retirement request was not found", "V24_RETIREMENT_NOT_FOUND");
      if (terminal(retirement.status)) {
        resolved = structuredClone(retirement);
        return store;
      }
      if (upper(retirement.status) !== "REQUESTED") {
        throw retirementError("retirement is not resolvable", "INVALID_V24_RETIREMENT_STATE");
      }

      const installation = installationById(store, handoffId);
      if (!installation || upper(installation.status) !== "LISTENING") {
        throw retirementError("LISTENING installation is required to resolve discard", "V24_LISTENING_INSTALLATION_REQUIRED");
      }

      let nextStatus = "REQUESTED";
      let priorFill = null;
      const coverage = brokerState?.executionCoverage;
      const journal = brokerState?.executionOwnershipJournal;
      const journalContract = validateBrokerExecutionOwnershipJournal(journal);
      const listeningAt = retirement.executionListeningAt;
      const cutoffAt = retirement.cutoffAt;
      const accountId = text(installation.compatibility?.v24?.authorizedExecutionAccountId);
      const accountPresent = (Array.isArray(brokerState?.accounts) ? brokerState.accounts : [])
        .some((account) => text(account?.accountId) === accountId);

      const coverageStartedAt = isoTimestamp(coverage?.coverageStartedAt);
      const coverageCurrentThrough = isoTimestamp(coverage?.currentThrough);
      const journalStartedAt = isoTimestamp(journal?.coverageStartedAt);
      const journalCurrentThrough = isoTimestamp(journal?.currentThrough);

      const reconciliationRequired = Boolean(
        upper(coverage?.status) === "GAP"
        || (journal && !journalContract.valid)
        || (
          coverageStartedAt
          && journalStartedAt
          && coverageStartedAt !== journalStartedAt
        )
        || (
          coverageCurrentThrough
          && journalCurrentThrough
          && coverageCurrentThrough !== journalCurrentThrough
        )
        || (
          coverageStartedAt
          && Date.parse(coverageStartedAt) > Date.parse(listeningAt)
        )
      );

      if (reconciliationRequired) {
        nextStatus = "RECONCILIATION_REQUIRED";
      } else {
        const complete = Boolean(
          brokerUsable(brokerState)
          && accountId
          && accountPresent
          && upper(coverage?.status) === "CONTIGUOUS"
          && journalContract.valid
          && coverageStartedAt
          && coverageCurrentThrough
          && journalStartedAt
          && journalCurrentThrough
          && coverageStartedAt === journalStartedAt
          && coverageCurrentThrough === journalCurrentThrough
          && Date.parse(coverageStartedAt) <= Date.parse(listeningAt)
          && Date.parse(coverageCurrentThrough) >= Date.parse(cutoffAt)
        );

        if (complete) {
          const ownership = evaluateV24InitialFillOwnership({
            installation,
            brokerState: resolutionBrokerState(brokerState, cutoffAt),
          });

          if (ownership.status === "MATCHED") {
            nextStatus = "SUPERSEDED_BY_PRIOR_FILL";
            priorFill = structuredClone(ownership.matchedExecution);
          } else if (
            ownership.status === "WAITING"
            || ["WRONG_ACCOUNT_EXECUTION_OBSERVED", "UNEXPECTED_AUTHORIZED_ACCOUNT_EXECUTION"].includes(ownership.reason)
          ) {
            nextStatus = "RETIRED";
          } else {
            nextStatus = "RECONCILIATION_REQUIRED";
          }
        }
      }

      if (nextStatus === "REQUESTED") {
        resolved = structuredClone(retirement);
        return store;
      }

      resolved = {
        ...structuredClone(retirement),
        status: nextStatus,
        finalizedAt: finalized,
        priorFill,
      };
      return replaceRetirement(store, resolved);
    },
  });

  return verifyRetirement(committed, resolved);
}

export async function resolveV24RetirementSerialized({
  lockManager = globalThis?.navigator?.locks,
  ...options
} = {}) {
  return withExecutionBoardStoreWriterLock({
    lockManager,
    operation: () => resolveV24Retirement(options),
  });
}

export function assertV24HandoffRetirementAllowsActivation({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_V23_STORE_KEY,
  handoffId,
} = {}) {
  const retirement = readV24Retirement({ storage, storeKey, handoffId });
  if (!retirement) return true;
  const code = retirement.status === "RETIRED" ? "V24_HANDOFF_RETIRED" : "V24_HANDOFF_RETIREMENT_ACTIVE";
  throw retirementError(`V2.4 handoff ${handoffId} cannot be activated after retirement lifecycle began`, code);
}

export function persistPreparedV24LocalInstallationGuarded(options = {}) {
  const handoffId = options.installation?.handoffId;
  assertV24HandoffRetirementAllowsActivation({ storage: options.storage, storeKey: options.storeKey, handoffId });
  return persistPreparedV24LocalInstallation(options);
}

export function bindAndPersistV24ExecutionListeningAtGuarded(options = {}) {
  assertV24HandoffRetirementAllowsActivation({ storage: options.storage, storeKey: options.storeKey, handoffId: options.handoffId });
  return bindAndPersistV24ExecutionListeningAt(options);
}

export function buildV23CandidateFromActiveListeningInstallation({ installation, retirement = null } = {}) {
  if (retirement) {
    const code = retirement.status === "RETIRED" ? "V24_HANDOFF_RETIRED" : "V24_HANDOFF_RETIREMENT_ACTIVE";
    throw retirementError("retirement lifecycle prevents candidate activation", code);
  }
  return buildV23CandidateFromListeningInstallation(installation);
}

export function executionOwnedSymbolsFromV23StoreWithRetirement(store, { excludeHandoffId = null } = {}) {
  return executionOwnedSymbolsForHandoffAdmission(store, { excludeHandoffId });
}
