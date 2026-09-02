import { validateBrokerExecutionOwnershipJournal } from "../../schwab-bridge/broker-execution-ownership-journal.mjs";
import { applyExecution, createSymbolState } from "../../schwab-bridge/trade-state.mjs";
import { EXECUTION_V23_STORE_KEY } from "./execution-v24-local-installation.js";

export const V24_LIVE_LIFECYCLE_SCHEMA_VERSION = 1;
export const V24_LIVE_LIFECYCLE_STATUSES = Object.freeze(["LIVE", "EXIT", "LIVE_RECONCILIATION_REQUIRED"]);

function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function positive(value) { const n = finite(value); return n !== null && n > 0 ? n : null; }
function iso(value) {
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
function immutable(value) { return deepFreeze(structuredClone(value)); }
function lifecycleError(message, code) { const error = new Error(message); error.code = code; return error; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function expectedInstruction(direction) { return direction === "SHORT" ? "SELL_SHORT" : direction === "LONG" ? "BUY" : null; }
function expectedSide(direction) { return direction === "SHORT" ? "SHORT" : direction === "LONG" ? "LONG" : null; }

function installationView(installation) {
  const v24 = installation?.compatibility?.v24;
  if (!installation || upper(installation.status) !== "LISTENING" || !v24) {
    throw lifecycleError("LISTENING V2.4 installation is required", "V24_LISTENING_INSTALLATION_REQUIRED");
  }
  const listeningAt = iso(installation.executionListeningAt ?? v24.executionListeningAt);
  const direction = upper(v24.direction);
  const accountId = text(v24.authorizedExecutionAccountId);
  const symbol = upper(v24.symbol);
  if (!listeningAt || !accountId || !symbol || !["LONG", "SHORT"].includes(direction)) {
    throw lifecycleError("V2.4 installation provenance is incomplete", "INVALID_V24_EXECUTION_PROVENANCE");
  }
  return {
    handoffId: text(v24.handoffId),
    listeningAt,
    direction,
    accountId,
    symbol,
    selectedQuantity: positive(v24.selectedQuantity),
    effectiveStop: positive(v24.effectiveStop),
    authorizedMaxDollarRisk: positive(v24.authorizedMaxDollarRisk),
  };
}

function requireUsableBrokerInterval(brokerState, { coverageStartedAt = null, listeningAt = null } = {}) {
  const coverage = brokerState?.executionCoverage;
  const journal = brokerState?.executionOwnershipJournal;
  const contract = validateBrokerExecutionOwnershipJournal(journal);
  const usable = Boolean(
    brokerState
    && upper(brokerState.status) === "ARMED"
    && brokerState.readOnly === true
    && upper(brokerState.source) === "SCHWAB"
    && !text(brokerState.lastError)
    && upper(coverage?.status) === "CONTIGUOUS"
    && contract.valid
    && iso(coverage?.coverageStartedAt)
    && iso(coverage?.currentThrough)
    && journal?.coverageStartedAt === coverage?.coverageStartedAt
    && journal?.currentThrough === coverage?.currentThrough
  );
  if (!usable) return { valid: false, reason: "BROKER_EXECUTION_COVERAGE_GAP", coverage, journal };
  if (coverageStartedAt && coverage.coverageStartedAt !== coverageStartedAt) {
    return { valid: false, reason: "BROKER_EXECUTION_COVERAGE_GAP", coverage, journal };
  }
  if (listeningAt && Date.parse(coverage.coverageStartedAt) > Date.parse(listeningAt)) {
    return { valid: false, reason: "BROKER_EXECUTION_COVERAGE_GAP", coverage, journal };
  }
  return { valid: true, coverage, journal };
}

function riskWarnings(view, quantity, averagePrice, prior = []) {
  const warnings = [...prior];
  if (view.selectedQuantity !== null && quantity > view.selectedQuantity) warnings.push("AUTHORIZED_QUANTITY_EXCEEDED");
  const actualStopRisk = (
    view.effectiveStop !== null
    && Number.isFinite(Number(averagePrice))
    && Number.isFinite(Number(quantity))
  ) ? Math.abs(Number(averagePrice) - view.effectiveStop) * Number(quantity) : null;
  if (view.authorizedMaxDollarRisk !== null && actualStopRisk !== null && actualStopRisk > view.authorizedMaxDollarRisk + 1e-9) {
    warnings.push("ACTUAL_STOP_RISK_EXCEEDS_AUTHORIZED_BUDGET");
  }
  return { warnings: unique(warnings), actualStopRisk };
}

function entryIdentity(event) {
  const orderId = text(event?.orderId);
  const executionKey = text(event?.executionKey);
  if (!orderId || !executionKey) {
    throw lifecycleError("broker order/execution identity is required for V2.4 LIVE ownership", "V24_BROKER_ORDER_PROVENANCE_REQUIRED");
  }
  return { orderId, executionKey };
}

function reconcile(lifecycle, reason, extra = {}) {
  return immutable({
    ...structuredClone(lifecycle),
    status: "LIVE_RECONCILIATION_REQUIRED",
    reconciliationReason: reason,
    reconciliationEvidence: structuredClone(extra),
  });
}

function eventAudit(type, event, reducerEvent = null) {
  return {
    type,
    sequence: Number(event.sequence),
    executionKey: text(event.executionKey) || null,
    orderId: text(event.orderId) || null,
    executionTime: iso(event.executionTime),
    detectedAt: iso(event.detectedAt),
    instruction: upper(event.instruction),
    positionEffect: upper(event.positionEffect),
    quantity: Number(event.quantity),
    price: Number(event.price),
    stateEvent: upper(event.stateEvent),
    trustedReducerEvent: reducerEvent,
  };
}

export function createV24LiveLifecycle({ installation, matchedExecution, brokerState } = {}) {
  const view = installationView(installation);
  const interval = requireUsableBrokerInterval(brokerState, { listeningAt: view.listeningAt });
  if (!interval.valid) throw lifecycleError("continuous broker coverage is required to establish LIVE lifecycle", interval.reason);

  const event = matchedExecution;
  const sequence = Number(event?.sequence);
  const executionTime = iso(event?.executionTime);
  const { orderId, executionKey } = entryIdentity(event);
  if (!Number.isInteger(sequence) || sequence < 1 || !executionTime) throw lifecycleError("matched execution sequence/time is invalid", "INVALID_V24_FIRST_FILL_PROVENANCE");
  if (text(event.accountId) !== view.accountId || upper(event.symbol) !== view.symbol) throw lifecycleError("matched execution account/symbol does not match authorization", "INVALID_V24_FIRST_FILL_PROVENANCE");
  if (upper(event.positionEffect) !== "OPENING" || upper(event.instruction) !== expectedInstruction(view.direction)) throw lifecycleError("matched execution is not the authorized opening fill", "INVALID_V24_FIRST_FILL_PROVENANCE");
  if (Date.parse(executionTime) < Date.parse(view.listeningAt) || Date.parse(executionTime) > Date.parse(interval.coverage.currentThrough)) throw lifecycleError("matched execution is outside proven listening coverage", "INVALID_V24_FIRST_FILL_PROVENANCE");
  if (upper(event.stateEvent) !== "ENTRY" || Number(event.previousQuantity) !== 0 || upper(event.nextSide) !== expectedSide(view.direction)) {
    throw lifecycleError("first owned fill must be the trusted flat-to-position ENTRY transition", "INVALID_V24_FIRST_FILL_PROVENANCE");
  }
  const journalEvent = interval.journal.entries.find((item) => Number(item.sequence) === sequence);
  if (!journalEvent || (text(journalEvent.executionKey) && text(journalEvent.executionKey) !== executionKey)) {
    throw lifecycleError("matched execution is not present in the lossless ownership journal", "INVALID_V24_FIRST_FILL_PROVENANCE");
  }

  const currentQuantity = Math.abs(Number(event.nextQuantity));
  const currentAveragePrice = finite(event.averagePrice) ?? positive(event.price);
  if (!(currentQuantity > 0) || currentAveragePrice === null) throw lifecycleError("first owned fill quantity/average is invalid", "INVALID_V24_FIRST_FILL_PROVENANCE");
  const risk = riskWarnings(view, currentQuantity, currentAveragePrice);

  return immutable({
    schemaVersion: V24_LIVE_LIFECYCLE_SCHEMA_VERSION,
    status: "LIVE",
    handoffId: view.handoffId,
    executionAccountId: view.accountId,
    symbol: view.symbol,
    direction: view.direction,
    entryOrderId: orderId,
    coverageStartedAt: interval.coverage.coverageStartedAt,
    firstOwnedSequence: sequence,
    lastProcessedSequence: sequence,
    firstExecutionTime: executionTime,
    lastProcessedExecutionTime: executionTime,
    signedQuantity: Number(event.nextQuantity),
    currentQuantity,
    currentAveragePrice,
    peakQuantity: currentQuantity,
    entryQuantity: Number(event.quantity),
    entryVwap: Number(event.price),
    closingQuantity: 0,
    closingValue: 0,
    exitVwap: null,
    terminalEvent: null,
    reversalSide: null,
    reversalQuantity: 0,
    reversalAveragePrice: null,
    actualStopRisk: risk.actualStopRisk,
    warnings: risk.warnings,
    diagnostics: [],
    events: [eventAudit("ENTRY", event, "ENTRY")],
    reconciliationReason: null,
    reconciliationEvidence: null,
  });
}

function trustedTransition(lifecycle, event) {
  const state = createSymbolState(lifecycle.symbol, {
    quantity: lifecycle.signedQuantity,
    averagePrice: lifecycle.currentAveragePrice,
  });
  const result = applyExecution(state, event);
  if (
    upper(event.stateEvent) !== upper(result.event)
    || Number(event.previousQuantity) !== Number(result.previousQuantity)
    || Number(event.nextQuantity) !== Number(result.nextQuantity)
  ) return null;
  return result;
}

export function advanceV24LiveLifecycle({ lifecycle, installation, brokerState } = {}) {
  if (!lifecycle || Number(lifecycle.schemaVersion) !== V24_LIVE_LIFECYCLE_SCHEMA_VERSION) throw lifecycleError("valid V2.4 LIVE lifecycle is required", "INVALID_V24_LIVE_LIFECYCLE");
  if (lifecycle.status === "EXIT" || lifecycle.status === "LIVE_RECONCILIATION_REQUIRED") return immutable(lifecycle);
  if (lifecycle.status !== "LIVE") throw lifecycleError("V2.4 lifecycle is not LIVE", "INVALID_V24_LIVE_LIFECYCLE");

  const view = installationView(installation);
  if (view.handoffId !== lifecycle.handoffId || view.accountId !== lifecycle.executionAccountId || view.symbol !== lifecycle.symbol || view.direction !== lifecycle.direction) {
    return reconcile(lifecycle, "V24_LIVE_AUTHORIZATION_IDENTITY_CONFLICT");
  }

  const interval = requireUsableBrokerInterval(brokerState, { coverageStartedAt: lifecycle.coverageStartedAt, listeningAt: view.listeningAt });
  if (!interval.valid) return reconcile(lifecycle, "BROKER_EXECUTION_COVERAGE_GAP", {
    expectedCoverageStartedAt: lifecycle.coverageStartedAt,
    observedCoverageStartedAt: interval.coverage?.coverageStartedAt ?? null,
    observedStatus: upper(interval.coverage?.status) || null,
  });

  const accountPresent = (Array.isArray(brokerState?.accounts) ? brokerState.accounts : []).some((account) => text(account?.accountId) === lifecycle.executionAccountId);
  if (!accountPresent) return reconcile(lifecycle, "AUTHORIZED_EXECUTION_ACCOUNT_UNAVAILABLE");

  let next = structuredClone(lifecycle);
  const currentThroughMs = Date.parse(interval.coverage.currentThrough);
  const pending = interval.journal.entries.filter((event) => Number(event.sequence) > Number(next.lastProcessedSequence)).sort((a, b) => Number(a.sequence) - Number(b.sequence));

  for (const event of pending) {
    const eventTime = iso(event.executionTime);
    if (!eventTime) return reconcile(next, "LIVE_EXECUTION_PROVENANCE_INVALID", { sequence: event.sequence });
    if (Date.parse(eventTime) > currentThroughMs) break;

    const sequence = Number(event.sequence);
    const sameSymbol = upper(event.symbol) === next.symbol;
    const sameAccount = text(event.accountId) === next.executionAccountId;

    if (sameSymbol && !sameAccount) {
      next.diagnostics.push({
        code: "WRONG_ACCOUNT_EXECUTION_OBSERVED",
        sequence,
        accountId: text(event.accountId),
        executionTime: eventTime,
        orderId: text(event.orderId) || null,
      });
      next.lastProcessedSequence = sequence;
      continue;
    }

    if (!sameSymbol || !sameAccount) {
      next.lastProcessedSequence = sequence;
      continue;
    }

    if (Date.parse(eventTime) < Date.parse(next.lastProcessedExecutionTime)) {
      return reconcile(next, "LIVE_EXECUTION_TIME_REGRESSION", { sequence, executionTime: eventTime, lastProcessedExecutionTime: next.lastProcessedExecutionTime });
    }
    const orderId = text(event.orderId);
    const executionKey = text(event.executionKey);
    if (!orderId || !executionKey) return reconcile(next, "V24_BROKER_ORDER_PROVENANCE_REQUIRED", { sequence });

    const result = trustedTransition(next, event);
    if (!result || result.event === "NO_CHANGE") return reconcile(next, "LIVE_EXECUTION_STATE_CONFLICT", { sequence, stateEvent: event.stateEvent });

    let type = result.event;
    if (
      result.event === "ADD"
      && orderId === next.entryOrderId
      && upper(event.positionEffect) === "OPENING"
      && upper(event.instruction) === expectedInstruction(next.direction)
    ) type = "ENTRY_FRAGMENT";

    if (result.event === "ADD" && type !== "ENTRY_FRAGMENT") {
      if (upper(event.positionEffect) !== "OPENING" || upper(event.instruction) !== expectedInstruction(next.direction)) {
        return reconcile(next, "LIVE_ADD_PROVENANCE_CONFLICT", { sequence, orderId });
      }
    }

    if (["PARTIAL", "FLAT", "REVERSAL"].includes(result.event) && upper(event.positionEffect) !== "CLOSING") {
      return reconcile(next, "LIVE_CLOSING_PROVENANCE_CONFLICT", { sequence, stateEvent: result.event });
    }

    if (type === "ENTRY_FRAGMENT") {
      const priorQty = Number(next.entryQuantity || 0);
      const addQty = Number(event.quantity);
      const totalQty = priorQty + addQty;
      next.entryVwap = totalQty > 0 ? ((Number(next.entryVwap || 0) * priorQty) + (Number(event.price) * addQty)) / totalQty : next.entryVwap;
      next.entryQuantity = totalQty;
    }

    if (["PARTIAL", "FLAT", "REVERSAL"].includes(result.event)) {
      const closedQty = Math.max(0, Math.abs(Number(result.previousQuantity)) - (result.event === "PARTIAL" ? Math.abs(Number(result.nextQuantity)) : 0));
      next.closingQuantity += closedQty;
      next.closingValue += closedQty * Number(event.price);
      next.exitVwap = next.closingQuantity > 0 ? next.closingValue / next.closingQuantity : next.exitVwap;
    }

    next.signedQuantity = Number(result.nextQuantity);
    next.currentQuantity = Math.abs(Number(result.nextQuantity));
    next.currentAveragePrice = result.nextQuantity === 0 ? null : Number(result.nextAveragePrice);
    next.peakQuantity = Math.max(Number(next.peakQuantity || 0), next.currentQuantity);
    next.lastProcessedSequence = sequence;
    next.lastProcessedExecutionTime = eventTime;
    next.events.push(eventAudit(type, event, result.event));

    const risk = riskWarnings(view, next.currentQuantity, next.currentAveragePrice, next.warnings);
    next.warnings = risk.warnings;
    next.actualStopRisk = risk.actualStopRisk;

    if (result.event === "FLAT" || result.event === "REVERSAL") {
      next.status = "EXIT";
      next.terminalEvent = result.event;
      if (result.event === "REVERSAL") {
        next.reversalSide = result.nextSide;
        next.reversalQuantity = Math.abs(Number(result.nextQuantity));
        next.reversalAveragePrice = Number(result.nextAveragePrice);
      }
      break;
    }
  }

  return immutable(next);
}

function requireStorage(storage) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") throw lifecycleError("durable local execution storage is unavailable", "LOCAL_EXECUTION_PERSISTENCE_FAILED");
  return storage;
}
function parseStore(storage, storeKey) {
  const durable = requireStorage(storage);
  try {
    const raw = durable.getItem(storeKey);
    if (!raw) return { candidates: [], liveTrades: [], history: [], v24Installations: [], v24Retirements: [], v24Lifecycles: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("store root must be an object");
    return { ...parsed, v24Lifecycles: Array.isArray(parsed.v24Lifecycles) ? parsed.v24Lifecycles : [] };
  } catch (error) {
    throw lifecycleError(`local execution store could not be read: ${error.message}`, "LOCAL_EXECUTION_PERSISTENCE_FAILED");
  }
}
function validateLifecycle(lifecycle) {
  if (!lifecycle || Number(lifecycle.schemaVersion) !== V24_LIVE_LIFECYCLE_SCHEMA_VERSION || !V24_LIVE_LIFECYCLE_STATUSES.includes(upper(lifecycle.status))) {
    throw lifecycleError("invalid V2.4 LIVE lifecycle", "INVALID_V24_LIVE_LIFECYCLE");
  }
  if (!text(lifecycle.handoffId) || !text(lifecycle.executionAccountId) || !upper(lifecycle.symbol) || !text(lifecycle.entryOrderId)) {
    throw lifecycleError("V2.4 LIVE lifecycle identity is incomplete", "INVALID_V24_LIVE_LIFECYCLE");
  }
  return lifecycle;
}
export function persistV24LiveLifecycle({ storage = globalThis?.localStorage, storeKey = EXECUTION_V23_STORE_KEY, lifecycle } = {}) {
  validateLifecycle(lifecycle);
  const durable = requireStorage(storage);
  const store = parseStore(durable, storeKey);
  const prior = durable.getItem(storeKey);
  const nextStore = {
    ...store,
    v24Lifecycles: [...store.v24Lifecycles.filter((item) => text(item?.handoffId) !== text(lifecycle.handoffId)), structuredClone(lifecycle)],
  };
  const serialized = JSON.stringify(nextStore);
  try {
    durable.setItem(storeKey, serialized);
    if (durable.getItem(storeKey) !== serialized) throw new Error("exact store readback mismatch");
    const readBack = parseStore(durable, storeKey).v24Lifecycles.find((item) => text(item?.handoffId) === text(lifecycle.handoffId));
    if (!readBack || JSON.stringify(readBack) !== JSON.stringify(lifecycle)) throw new Error("lifecycle readback mismatch");
    return immutable(readBack);
  } catch (error) {
    try { if (prior !== null) durable.setItem(storeKey, prior); } catch { /* best effort */ }
    throw lifecycleError(`local V2.4 LIVE lifecycle could not be persisted exactly: ${error.message}`, "LOCAL_EXECUTION_PERSISTENCE_FAILED");
  }
}
export function readV24LiveLifecycle({ storage = globalThis?.localStorage, storeKey = EXECUTION_V23_STORE_KEY, handoffId } = {}) {
  const found = parseStore(storage, storeKey).v24Lifecycles.find((item) => text(item?.handoffId) === text(handoffId));
  return found ? immutable(found) : null;
}
