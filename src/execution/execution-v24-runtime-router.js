import {
  EXECUTION_BOARD_STORE_KEY,
  readExecutionBoardStore,
  transactExecutionBoardStoreSerialized,
} from "./execution-board-store-repository.js";
import { advanceV24HandoffActivation } from "./execution-v24-handoff-activation.js";
import { evaluateV24InitialFillOwnership } from "./execution-v24-initial-fill-matcher.js";
import { buildV23CandidateFromListeningInstallation } from "./execution-v24-local-installation.js";
import {
  advanceV24LiveLifecycle,
  createV24LiveLifecycle,
} from "./execution-v24-live-lifecycle.js";
import { resolveV24RetirementSerialized } from "./execution-v24-retirement.js";

export const V24_RUNTIME_ROUTER_SCHEMA_VERSION = 1;

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

function routerError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function byHandoff(items, handoffId) {
  const id = text(handoffId);
  return (Array.isArray(items) ? items : []).find((item) => text(item?.handoffId ?? item?.v24?.handoffId) === id) || null;
}

function installationByHandoff(store, handoffId) {
  return byHandoff(store?.v24Installations, handoffId);
}

function retirementByHandoff(store, handoffId) {
  return byHandoff(store?.v24Retirements, handoffId);
}

function lifecycleByHandoff(store, handoffId) {
  return byHandoff(store?.v24Lifecycles, handoffId);
}

function liveTradeByHandoff(store, handoffId) {
  return (Array.isArray(store?.liveTrades) ? store.liveTrades : [])
    .find((item) => text(item?.v24?.handoffId) === text(handoffId)) || null;
}

function historyByHandoff(store, handoffId) {
  return (Array.isArray(store?.history) ? store.history : [])
    .find((item) => text(item?.v24?.handoffId) === text(handoffId)) || null;
}

function replaceByHandoff(items, handoffId, record) {
  const id = text(handoffId);
  const clean = (Array.isArray(items) ? items : []).filter((item) => text(item?.handoffId) !== id);
  return [...clean, structuredClone(record)];
}

function replaceLiveTradeByHandoff(items, handoffId, trade) {
  const id = text(handoffId);
  const clean = (Array.isArray(items) ? items : []).filter((item) => text(item?.v24?.handoffId) !== id);
  return [...clean, structuredClone(trade)];
}

function eventDecision(handoffId, event) {
  const type = upper(event?.type) || upper(event?.trustedReducerEvent) || "BROKER_EVENT";
  const timestamp = isoTimestamp(event?.executionTime) || new Date().toISOString();
  const sequence = Number(event?.sequence || 0);
  const stage = ["FLAT", "REVERSAL"].includes(type) ? "EXIT" : type === "PARTIAL" ? "UPDATE" : "TRIGGER";
  return {
    id: `v24:${text(handoffId)}:${sequence}:${type}`,
    timestamp,
    time: timestamp,
    stage,
    state: "VALID",
    action: `V2.4 ${type}`,
    note: `${upper(event?.instruction)} ${Number(event?.quantity || 0)} @ ${Number(event?.price || 0)}`,
  };
}

function reconciliationDecision(handoffId, lifecycle) {
  const reason = text(lifecycle?.reconciliationReason) || "BROKER_EXECUTION_RECONCILIATION_REQUIRED";
  const timestamp = new Date().toISOString();
  return {
    id: `v24:${text(handoffId)}:reconciliation:${reason}`,
    timestamp,
    time: timestamp,
    stage: "UPDATE",
    state: "THREATENED",
    action: "V2.4 LIVE RECONCILIATION REQUIRED",
    note: reason,
  };
}

function accountLabel(brokerState, accountId) {
  const account = (Array.isArray(brokerState?.accounts) ? brokerState.accounts : [])
    .find((item) => text(item?.accountId) === text(accountId));
  return account?.account || account?.label || null;
}

export function projectV24LifecycleToExecutionTrade({
  installation,
  lifecycle,
  brokerState = null,
  existingTrade = null,
} = {}) {
  if (!installation || upper(installation.status) !== "LISTENING") {
    throw routerError("LISTENING installation is required for V2.4 trade projection", "V24_LISTENING_INSTALLATION_REQUIRED");
  }
  if (!lifecycle || text(lifecycle.handoffId) !== text(installation.handoffId)) {
    throw routerError("matching V2.4 lifecycle is required for trade projection", "INVALID_V24_LIVE_LIFECYCLE");
  }

  const base = existingTrade
    ? structuredClone(existingTrade)
    : structuredClone(buildV23CandidateFromListeningInstallation(installation));
  const priorProjectedSequence = Number(base?.broker?.lastProjectedLifecycleSequence || 0);
  const lifecycleEvents = Array.isArray(lifecycle.events) ? lifecycle.events : [];
  const newDecisions = lifecycleEvents
    .filter((event) => Number(event?.sequence || 0) > priorProjectedSequence)
    .map((event) => eventDecision(lifecycle.handoffId, event));

  const existingDecisions = Array.isArray(base.decisions) ? base.decisions : [];
  const decisions = [...existingDecisions, ...newDecisions];
  if (
    lifecycle.status === "LIVE_RECONCILIATION_REQUIRED"
    && base?.broker?.lifecycleStatus !== "LIVE_RECONCILIATION_REQUIRED"
  ) {
    decisions.push(reconciliationDecision(lifecycle.handoffId, lifecycle));
  }

  const terminal = upper(lifecycle.status) === "EXIT";
  return immutable({
    ...base,
    phase: terminal ? "EXIT" : "LIVE",
    currentState: base.currentState || "VALID",
    broker: {
      ...(base.broker || {}),
      account: accountLabel(brokerState, lifecycle.executionAccountId) ?? base?.broker?.account ?? null,
      accountId: lifecycle.executionAccountId,
      entryPrice: lifecycle.entryVwap,
      entryQuantity: lifecycle.entryQuantity,
      peakQuantity: lifecycle.peakQuantity,
      currentQuantity: lifecycle.currentQuantity,
      currentAveragePrice: lifecycle.currentAveragePrice,
      entryExecutionTime: lifecycle.firstExecutionTime,
      entryDetectedAt: lifecycle.events?.[0]?.detectedAt ?? base?.broker?.entryDetectedAt ?? null,
      exitPrice: lifecycle.exitVwap,
      exitQuantity: lifecycle.closingQuantity,
      terminalEvent: lifecycle.terminalEvent,
      terminalExecutionTime: terminal ? lifecycle.lastProcessedExecutionTime : null,
      reversalSide: lifecycle.reversalSide,
      reversalQuantity: lifecycle.reversalQuantity,
      reversalAveragePrice: lifecycle.reversalAveragePrice,
      lifecycleStatus: lifecycle.status,
      lifecycleWarnings: structuredClone(lifecycle.warnings || []),
      lifecycleDiagnostics: structuredClone(lifecycle.diagnostics || []),
      reconciliationReason: lifecycle.reconciliationReason || null,
      actualStopRisk: lifecycle.actualStopRisk,
      lastProcessedLifecycleSequence: lifecycle.lastProcessedSequence,
      lastProjectedLifecycleSequence: lifecycle.lastProcessedSequence,
    },
    decisions,
  });
}

export async function promoteV24FirstFillAtomically({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
  handoffId,
  matchedExecution,
  brokerState,
  lockManager = globalThis?.navigator?.locks,
} = {}) {
  const id = text(handoffId);
  if (!id) throw routerError("handoffId is required for V2.4 first-fill promotion", "INVALID_V24_RUNTIME_ROUTER_INPUT");

  const before = readExecutionBoardStore({ storage, storeKey });
  const existingLifecycle = lifecycleByHandoff(before, id);
  const existingTrade = liveTradeByHandoff(before, id);
  if (existingLifecycle && existingTrade) {
    return immutable({ status: "ALREADY_PROMOTED", lifecycle: existingLifecycle, trade: existingTrade, storeRevision: before.storeRevision });
  }
  if (existingLifecycle || existingTrade || historyByHandoff(before, id)) {
    throw routerError("V2.4 first-fill ownership projection is incomplete or already terminal", "V24_FIRST_FILL_PROMOTION_CONFLICT");
  }

  let promotedLifecycle = null;
  let promotedTrade = null;
  const committed = await transactExecutionBoardStoreSerialized({
    storage,
    storeKey,
    lockManager,
    mutate: (store) => {
      const installation = installationByHandoff(store, id);
      if (!installation || upper(installation.status) !== "LISTENING") {
        throw routerError("LISTENING installation is required for first-fill promotion", "V24_LISTENING_INSTALLATION_REQUIRED");
      }

      const retirement = retirementByHandoff(store, id);
      if (retirement && upper(retirement.status) !== "SUPERSEDED_BY_PRIOR_FILL") {
        throw routerError("retirement state prevents V2.4 first-fill promotion", "V24_HANDOFF_RETIREMENT_ACTIVE");
      }
      if (lifecycleByHandoff(store, id) || liveTradeByHandoff(store, id) || historyByHandoff(store, id)) {
        throw routerError("V2.4 first-fill promotion collided with newer durable ownership", "V24_FIRST_FILL_PROMOTION_CONFLICT");
      }

      promotedLifecycle = createV24LiveLifecycle({ installation, matchedExecution, brokerState });
      promotedTrade = projectV24LifecycleToExecutionTrade({
        installation,
        lifecycle: promotedLifecycle,
        brokerState,
      });

      return {
        ...store,
        v24Lifecycles: replaceByHandoff(store.v24Lifecycles, id, promotedLifecycle),
        liveTrades: replaceLiveTradeByHandoff(store.liveTrades, id, promotedTrade),
      };
    },
  });

  const lifecycleReadBack = lifecycleByHandoff(committed, id);
  const tradeReadBack = liveTradeByHandoff(committed, id);
  if (
    !lifecycleReadBack
    || !tradeReadBack
    || JSON.stringify(lifecycleReadBack) !== JSON.stringify(promotedLifecycle)
    || JSON.stringify(tradeReadBack) !== JSON.stringify(promotedTrade)
  ) {
    throw routerError("atomic V2.4 first-fill promotion failed exact readback", "LOCAL_EXECUTION_PERSISTENCE_FAILED");
  }

  return immutable({
    status: "PROMOTED_LIVE",
    lifecycle: lifecycleReadBack,
    trade: tradeReadBack,
    storeRevision: committed.storeRevision,
  });
}

export async function advanceV24OwnedLifecycleAtomically({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
  handoffId,
  brokerState,
  lockManager = globalThis?.navigator?.locks,
} = {}) {
  const id = text(handoffId);
  const before = readExecutionBoardStore({ storage, storeKey });
  const lifecycle = lifecycleByHandoff(before, id);
  if (!lifecycle) return immutable({ status: "NO_LIFECYCLE", handoffId: id, storeRevision: before.storeRevision });

  if (historyByHandoff(before, id) && upper(lifecycle.status) === "EXIT") {
    return immutable({ status: "HISTORY_COMPLETE", handoffId: id, lifecycle, storeRevision: before.storeRevision });
  }

  const installation = installationByHandoff(before, id);
  const liveTrade = liveTradeByHandoff(before, id);
  if (!installation || !liveTrade) {
    return immutable({
      status: "RECONCILIATION_REQUIRED",
      handoffId: id,
      reason: !installation ? "V24_INSTALLATION_PROVENANCE_MISSING" : "V24_LIVE_PROJECTION_MISSING",
      lifecycle,
      storeRevision: before.storeRevision,
    });
  }

  const preview = advanceV24LiveLifecycle({ lifecycle, installation, brokerState });
  const projectedPreview = projectV24LifecycleToExecutionTrade({
    installation,
    lifecycle: preview,
    brokerState,
    existingTrade: liveTrade,
  });
  if (JSON.stringify(preview) === JSON.stringify(lifecycle) && JSON.stringify(projectedPreview) === JSON.stringify(liveTrade)) {
    return immutable({ status: "UNCHANGED", handoffId: id, lifecycle, trade: liveTrade, storeRevision: before.storeRevision });
  }

  let advanced = null;
  let projected = null;
  const committed = await transactExecutionBoardStoreSerialized({
    storage,
    storeKey,
    lockManager,
    mutate: (store) => {
      const latestLifecycle = lifecycleByHandoff(store, id);
      const latestInstallation = installationByHandoff(store, id);
      const latestTrade = liveTradeByHandoff(store, id);
      if (!latestLifecycle || !latestInstallation || !latestTrade) {
        throw routerError("V2.4 LIVE ownership projection disappeared during lifecycle transaction", "V24_LIVE_PROJECTION_MISSING");
      }

      advanced = advanceV24LiveLifecycle({
        lifecycle: latestLifecycle,
        installation: latestInstallation,
        brokerState,
      });
      projected = projectV24LifecycleToExecutionTrade({
        installation: latestInstallation,
        lifecycle: advanced,
        brokerState,
        existingTrade: latestTrade,
      });

      return {
        ...store,
        v24Lifecycles: replaceByHandoff(store.v24Lifecycles, id, advanced),
        liveTrades: replaceLiveTradeByHandoff(store.liveTrades, id, projected),
      };
    },
  });

  return immutable({
    status: advanced.status === "LIVE_RECONCILIATION_REQUIRED" ? "RECONCILIATION_REQUIRED" : advanced.status,
    handoffId: id,
    lifecycle: lifecycleByHandoff(committed, id),
    trade: liveTradeByHandoff(committed, id),
    storeRevision: committed.storeRevision,
  });
}

function proposedBoundaryFor(proposedBoundaries, handoffId) {
  if (!proposedBoundaries || typeof proposedBoundaries.get !== "function") return null;
  return proposedBoundaries.get(text(handoffId)) || null;
}

function setProposedBoundary(proposedBoundaries, handoffId, value) {
  if (!proposedBoundaries || typeof proposedBoundaries.set !== "function") return;
  proposedBoundaries.set(text(handoffId), value);
}

function clearProposedBoundary(proposedBoundaries, handoffId) {
  if (!proposedBoundaries || typeof proposedBoundaries.delete !== "function") return;
  proposedBoundaries.delete(text(handoffId));
}

function routerResult(stage, handoffId, status, extra = {}) {
  return { stage, handoffId: text(handoffId), status, ...extra };
}

export async function runV24ExecutionRouterCycle({
  transport,
  receiverId,
  brokerState,
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
  proposedBoundaries = new Map(),
  now = () => new Date().toISOString(),
  lockManager = globalThis?.navigator?.locks,
  dependencies = {},
} = {}) {
  const receiver = text(receiverId);
  if (!receiver) throw routerError("V2.4 runtime router requires receiverId", "EXECUTION_BOARD_RECEIVER_ID_REQUIRED");
  if (!brokerState) throw routerError("V2.4 runtime router requires brokerState", "BROKER_STATE_UNAVAILABLE");

  const activate = dependencies.advanceActivation || advanceV24HandoffActivation;
  const matchFill = dependencies.evaluateInitialFill || evaluateV24InitialFillOwnership;
  const resolveRetirement = dependencies.resolveRetirement || resolveV24RetirementSerialized;
  const promote = dependencies.promoteFirstFill || promoteV24FirstFillAtomically;
  const advanceLifecycle = dependencies.advanceLifecycle || advanceV24OwnedLifecycleAtomically;
  const readStore = dependencies.readStore || readExecutionBoardStore;

  const results = [];
  let envelopes = [];

  // Decision 22C: transport/activation availability is independent from
  // already-durable broker-ownership work. Missing or failing pretrade
  // discovery must not prevent retirement, first-fill, or lifecycle processing.
  if (!transport || typeof transport.discover !== "function") {
    results.push(routerResult(
      "TRANSPORT",
      "",
      "WAITING_FOR_PRETRADE",
      { reason: "V24_HANDOFF_TRANSPORT_UNAVAILABLE" },
    ));
  } else {
    try {
      envelopes = await transport.discover(receiver);

      // Decision 20: activation envelopes are always processed serially in server order.
      for (const envelope of envelopes) {
        const handoffId = text(envelope?.handoff?.handoffId);
        if (!handoffId) continue;
        const activation = await activate({
          envelope,
          brokerState,
          receiverId: receiver,
          storage,
          storeKey,
          proposedExecutionListeningAt: proposedBoundaryFor(proposedBoundaries, handoffId),
          transport,
          now,
          lockManager,
        });
        results.push(routerResult("ACTIVATION", handoffId, activation.status, activation));
        if (activation.status === "WAITING_FOR_BROKER_PROOF" && activation.proposedExecutionListeningAt) {
          setProposedBoundary(proposedBoundaries, handoffId, activation.proposedExecutionListeningAt);
        } else if (["DELIVERED", "BLOCKED", "RETIREMENT_ACTIVE", "RECONCILIATION_REQUIRED"].includes(activation.status)) {
          clearProposedBoundary(proposedBoundaries, handoffId);
        }
      }
    } catch (error) {
      results.push(routerResult(
        "TRANSPORT",
        "",
        "ERROR",
        { reason: error?.code || error?.message || String(error) },
      ));
    }
  }

  // Delivered handoffs disappear from discovery, so local LISTENING authorization
  // remains the durable source for retirement and first-fill ownership.
  let store = readStore({ storage, storeKey });
  const installations = [...(Array.isArray(store.v24Installations) ? store.v24Installations : [])]
    .sort((a, b) => Date.parse(a?.preparedAt || 0) - Date.parse(b?.preparedAt || 0) || text(a?.handoffId).localeCompare(text(b?.handoffId)));

  for (const installation of installations) {
    const handoffId = text(installation?.handoffId);
    if (!handoffId || upper(installation?.status) !== "LISTENING") continue;
    clearProposedBoundary(proposedBoundaries, handoffId);

    store = readStore({ storage, storeKey });
    let retirement = retirementByHandoff(store, handoffId);
    let lifecycle = lifecycleByHandoff(store, handoffId);

    if (retirement && upper(retirement.status) === "REQUESTED") {
      retirement = await resolveRetirement({
        storage,
        storeKey,
        handoffId,
        brokerState,
        finalizedAt: now(),
        lockManager,
      });
      results.push(routerResult("RETIREMENT", handoffId, retirement.status));
      store = readStore({ storage, storeKey });
      lifecycle = lifecycleByHandoff(store, handoffId);
    }

    if (!lifecycle) {
      if (retirement && ["RETIRED", "RECONCILIATION_REQUIRED"].includes(upper(retirement.status))) {
        results.push(routerResult("FIRST_FILL", handoffId, retirement.status));
        continue;
      }

      let ownership;
      if (upper(retirement?.status) === "SUPERSEDED_BY_PRIOR_FILL" && retirement?.priorFill) {
        ownership = { status: "MATCHED", matchedExecution: retirement.priorFill, reason: null };
      } else {
        ownership = matchFill({ installation, brokerState });
      }

      if (ownership.status === "MATCHED") {
        try {
          const promoted = await promote({
            storage,
            storeKey,
            handoffId,
            matchedExecution: ownership.matchedExecution,
            brokerState,
            lockManager,
          });
          results.push(routerResult("FIRST_FILL", handoffId, promoted.status));
        } catch (error) {
          results.push(routerResult("FIRST_FILL", handoffId, "RECONCILIATION_REQUIRED", {
            reason: error?.code || error?.message || String(error),
          }));
        }
      } else {
        results.push(routerResult("FIRST_FILL", handoffId, ownership.status, { reason: ownership.reason || null }));
      }
    }
  }

  // Lifecycle processing is independent of discovery and continues through LIVE/EXIT.
  store = readStore({ storage, storeKey });
  const lifecycles = [...(Array.isArray(store.v24Lifecycles) ? store.v24Lifecycles : [])]
    .sort((a, b) => text(a?.handoffId).localeCompare(text(b?.handoffId)));

  for (const lifecycle of lifecycles) {
    const handoffId = text(lifecycle?.handoffId);
    if (!handoffId) continue;
    const advanced = await advanceLifecycle({
      storage,
      storeKey,
      handoffId,
      brokerState,
      lockManager,
    });
    results.push(routerResult("LIFECYCLE", handoffId, advanced.status, {
      reason: advanced.reason || advanced.lifecycle?.reconciliationReason || null,
    }));
  }

  const finalStore = readStore({ storage, storeKey });
  return immutable({
    schemaVersion: V24_RUNTIME_ROUTER_SCHEMA_VERSION,
    status: "RUNNING",
    receiverId: receiver,
    processedAt: isoTimestamp(now()) || new Date().toISOString(),
    discoveredCount: envelopes.length,
    results,
    storeRevision: finalStore.storeRevision,
  });
}
