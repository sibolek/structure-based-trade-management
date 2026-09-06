import { validateBrokerExecutionOwnershipJournal } from "../../schwab-bridge/broker-execution-ownership-journal.mjs";
import {
  EXECUTION_BOARD_STORE_KEY,
  readExecutionBoardStore,
  transactExecutionBoardStoreSerialized,
} from "./execution-board-store-repository.js";

export const V24_RETIRED_AUTHORIZATION_EXCEPTION_SCHEMA_VERSION = 1;

function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function iso(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return new Date(numeric).toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function immutable(value) { return Object.freeze(structuredClone(value)); }
function error(message, code) { const value = new Error(message); value.code = code; return value; }
function array(value) { return Array.isArray(value) ? value : []; }

function expectedInstruction(direction) {
  if (upper(direction) === "LONG") return "BUY";
  if (upper(direction) === "SHORT") return "SELL_SHORT";
  return null;
}

function installationView(installation) {
  const v24 = installation?.compatibility?.v24 || {};
  const direction = upper(v24.direction);
  const instruction = expectedInstruction(direction);
  const view = {
    handoffId: text(v24.handoffId ?? installation?.handoffId),
    symbol: upper(v24.symbol ?? installation?.symbol),
    accountId: text(v24.authorizedExecutionAccountId),
    direction,
    instruction,
  };
  if (!view.handoffId || !view.symbol || !view.accountId || !instruction) {
    throw error("retired authorization provenance is incomplete", "INVALID_V24_EXECUTION_PROVENANCE");
  }
  return view;
}

function brokerInterval(brokerState) {
  const coverage = brokerState?.executionCoverage;
  const journal = brokerState?.executionOwnershipJournal;
  const contract = validateBrokerExecutionOwnershipJournal(journal);
  const valid = Boolean(
    brokerState
    && upper(brokerState.status) === "ARMED"
    && brokerState.readOnly === true
    && upper(brokerState.source) === "SCHWAB"
    && !text(brokerState.lastError)
    && upper(coverage?.status) === "CONTIGUOUS"
    && contract.valid
    && iso(coverage?.coverageStartedAt)
    && iso(coverage?.currentThrough)
    && journal?.coverageStartedAt === coverage.coverageStartedAt
    && journal?.currentThrough === coverage.currentThrough
  );
  return { valid, coverage, journal };
}

function plausibleLaterAuthorization(store, retiredHandoffId, view, eventTime) {
  return array(store?.v24Installations).filter((item) => {
    const v24 = item?.compatibility?.v24 || {};
    if (text(v24.handoffId ?? item?.handoffId) === retiredHandoffId) return false;
    if (upper(v24.symbol ?? item?.symbol) !== view.symbol) return false;
    if (text(v24.authorizedExecutionAccountId) !== view.accountId) return false;
    if (upper(v24.direction) !== view.direction) return false;
    const listeningAt = iso(v24.executionListeningAt ?? item?.executionListeningAt);
    return Boolean(listeningAt && Date.parse(listeningAt) <= Date.parse(eventTime));
  });
}

function deterministicExceptionId(handoffId, event, code) {
  const executionIdentity = text(event?.executionKey)
    || `${text(event?.orderId)}:${Number(event?.sequence || 0)}:${iso(event?.executionTime)}`;
  return `retired-exception:${handoffId}:${upper(code)}:${executionIdentity}`;
}

export function findV24RetiredAuthorizationExceptions({ store, installation, retirement, brokerState } = {}) {
  if (upper(retirement?.status) !== "RETIRED" || upper(retirement?.reason) !== "ENTRY_AUTHORIZATION_EXPIRED") return immutable([]);
  const cutoffAt = iso(retirement?.cutoffAt);
  if (!cutoffAt) return immutable([]);
  const interval = brokerInterval(brokerState);
  if (!interval.valid || Date.parse(interval.coverage.currentThrough) < Date.parse(cutoffAt)) return immutable([]);

  const view = installationView(installation);
  const relevant = array(interval.journal.entries).filter((event) => (
    text(event?.accountId) === view.accountId
    && upper(event?.symbol) === view.symbol
    && upper(event?.positionEffect) === "OPENING"
    && upper(event?.instruction) === view.instruction
    && iso(event?.executionTime)
    && Date.parse(event.executionTime) >= Date.parse(cutoffAt)
    && Date.parse(event.executionTime) <= Date.parse(interval.coverage.currentThrough)
  ));

  return immutable(relevant.map((event) => {
    const later = plausibleLaterAuthorization(store, view.handoffId, view, event.executionTime);
    const ambiguous = later.length > 0;
    const code = ambiguous ? "FILL_ATTRIBUTION_UNRESOLVED" : "LATE_OPENING_FILL";
    return {
      schemaVersion: V24_RETIRED_AUTHORIZATION_EXCEPTION_SCHEMA_VERSION,
      exceptionId: deterministicExceptionId(view.handoffId, event, code),
      handoffId: view.handoffId,
      code,
      severity: "CRITICAL",
      status: "OPEN",
      occurredAt: iso(event.executionTime),
      detectedAt: iso(event.detectedAt) || null,
      symbol: view.symbol,
      direction: view.direction,
      executionAccountId: view.accountId,
      retirementCutoffAt: cutoffAt,
      retirementReason: upper(retirement.reason),
      brokerExecution: structuredClone(event),
      plausibleLaterHandoffIds: later.map((item) => text(item?.compatibility?.v24?.handoffId ?? item?.handoffId)).filter(Boolean),
      reconciledAt: null,
      reconciliationOutcome: null,
      reconciliationNote: null,
    };
  }));
}

export async function recordV24RetiredAuthorizationExceptionsSerialized({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
  handoffId,
  exceptions,
  lockManager = globalThis?.navigator?.locks,
} = {}) {
  const id = text(handoffId);
  const candidates = array(exceptions).filter((item) => text(item?.handoffId) === id && text(item?.exceptionId));
  if (!id || !candidates.length) return immutable({ recorded: [], storeRevision: readExecutionBoardStore({ storage, storeKey }).storeRevision });

  const recorded = [];
  const committed = await transactExecutionBoardStoreSerialized({
    storage,
    storeKey,
    lockManager,
    mutate: (store) => {
      const existing = array(store.v24AuthorizationExceptions);
      const existingIds = new Set(existing.map((item) => text(item?.exceptionId)));
      for (const candidate of candidates) {
        if (existingIds.has(candidate.exceptionId)) continue;
        existing.push(structuredClone(candidate));
        existingIds.add(candidate.exceptionId);
        recorded.push(structuredClone(candidate));
      }
      return { ...store, v24AuthorizationExceptions: existing };
    },
  });
  return immutable({ recorded, storeRevision: committed.storeRevision });
}

export async function reconcileV24RetiredAuthorizationExceptionSerialized({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
  exceptionId,
  outcome,
  note = null,
  at = Date.now(),
  lockManager = globalThis?.navigator?.locks,
} = {}) {
  const id = text(exceptionId);
  const normalizedOutcome = upper(outcome);
  if (!id) throw error("exceptionId is required", "AUTHORIZATION_EXCEPTION_NOT_FOUND");
  if (!["BROKER_TRUTH_REVIEWED", "ASSIGNED_TO_OTHER_AUTHORIZATION"].includes(normalizedOutcome)) {
    throw error("retired authorization exception reconciliation outcome is invalid", "AUTHORIZATION_EXCEPTION_RECONCILIATION_INVALID");
  }
  const reconciledAt = iso(at);
  if (!reconciledAt) throw error("reconciliation timestamp is invalid", "AUTHORIZATION_EXCEPTION_RECONCILIATION_INVALID");

  let result = null;
  const committed = await transactExecutionBoardStoreSerialized({
    storage,
    storeKey,
    lockManager,
    mutate: (store) => {
      const exceptions = array(store.v24AuthorizationExceptions).map((item) => {
        if (text(item?.exceptionId) !== id) return item;
        if (upper(item.status) === "RECONCILED") { result = structuredClone(item); return item; }
        result = {
          ...structuredClone(item),
          status: "RECONCILED",
          reconciledAt,
          reconciliationOutcome: normalizedOutcome,
          reconciliationNote: text(note) || null,
        };
        return result;
      });
      if (!result) throw error("authorization exception was not found", "AUTHORIZATION_EXCEPTION_NOT_FOUND");
      return { ...store, v24AuthorizationExceptions: exceptions };
    },
  });
  return immutable({ exception: result, storeRevision: committed.storeRevision, brokerWriteAuthority: false });
}

export function readV24RetiredAuthorizationExceptions({ storage = globalThis?.localStorage, storeKey = EXECUTION_BOARD_STORE_KEY, handoffId = null } = {}) {
  const all = array(readExecutionBoardStore({ storage, storeKey }).v24AuthorizationExceptions);
  const id = text(handoffId);
  return immutable(id ? all.filter((item) => text(item?.handoffId) === id) : all);
}
