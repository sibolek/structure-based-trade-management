import { applyExecution, createSymbolState } from "../../schwab-bridge/trade-state.mjs";
import {
  advanceV24LiveLifecycle,
  createV24LiveLifecycle,
} from "./execution-v24-live-lifecycle.js";
import {
  applyV24ExecutionToManagement,
  createV24LiveManagement,
  reconcileV24BuildWindow,
  recordV24AuthorizationException,
} from "./execution-v24-live-management.js";

function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
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

function auditAsFill(audit) {
  return {
    sequence: Number(audit.sequence),
    executionKey: text(audit.executionKey) || null,
    orderId: text(audit.orderId) || null,
    executionTime: iso(audit.executionTime),
    detectedAt: iso(audit.detectedAt),
    instruction: upper(audit.instruction),
    positionEffect: upper(audit.positionEffect),
    quantity: Number(audit.quantity),
    price: Number(audit.price),
    stateEvent: upper(audit.stateEvent),
  };
}

function migrateManagementIfNeeded(lifecycle, installation) {
  if (lifecycle?.management) return lifecycle.management;
  let management = createV24LiveManagement({
    installation,
    firstExecutionTime: lifecycle?.firstExecutionTime,
    currentQuantity: lifecycle?.currentQuantity,
    currentAveragePrice: lifecycle?.currentAveragePrice,
  });
  if ((Array.isArray(lifecycle?.events) ? lifecycle.events.length : 0) > 1) {
    management = recordV24AuthorizationException(management, {
      code: "FILL_ATTRIBUTION_UNRESOLVED",
      occurredAt: lifecycle?.lastProcessedExecutionTime ?? lifecycle?.firstExecutionTime,
      evidence: { reason: "LIVE_MANAGEMENT_MIGRATED_AFTER_PRIOR_EXECUTIONS", priorEventCount: lifecycle.events.length },
    });
  }
  return management;
}

export function createV24ManagedLiveLifecycle({ installation, matchedExecution, brokerState } = {}) {
  const base = createV24LiveLifecycle({ installation, matchedExecution, brokerState });
  const management = createV24LiveManagement({
    installation,
    firstExecutionTime: base.firstExecutionTime,
    currentQuantity: base.currentQuantity,
    currentAveragePrice: base.currentAveragePrice,
  });
  return immutable({ ...structuredClone(base), management: structuredClone(management) });
}

export function advanceV24ManagedLiveLifecycle({ lifecycle, installation, brokerState, now = Date.now() } = {}) {
  const prior = structuredClone(lifecycle);
  const priorEventCount = Array.isArray(prior?.events) ? prior.events.length : 0;
  const priorDiagnosticCount = Array.isArray(prior?.diagnostics) ? prior.diagnostics.length : 0;
  const advancedBase = advanceV24LiveLifecycle({ lifecycle: prior, installation, brokerState });
  let management = migrateManagementIfNeeded(prior, installation);

  if (upper(advancedBase.status) === "LIVE_RECONCILIATION_REQUIRED") {
    management = recordV24AuthorizationException(management, {
      code: "FILL_ATTRIBUTION_UNRESOLVED",
      occurredAt: now,
      evidence: {
        reason: advancedBase.reconciliationReason,
        reconciliationEvidence: advancedBase.reconciliationEvidence ?? null,
      },
    });
  }

  const newDiagnostics = (Array.isArray(advancedBase.diagnostics) ? advancedBase.diagnostics : []).slice(priorDiagnosticCount);
  for (const diagnostic of newDiagnostics) {
    if (upper(diagnostic?.code) === "WRONG_ACCOUNT_EXECUTION_OBSERVED") {
      management = recordV24AuthorizationException(management, {
        code: "WRONG_ACCOUNT_EXECUTION_OBSERVED",
        occurredAt: diagnostic.executionTime ?? now,
        evidence: diagnostic,
      });
    }
  }

  let signedQuantity = Number(prior.signedQuantity || 0);
  let averagePrice = Number(prior.currentAveragePrice || 0);
  const newEvents = (Array.isArray(advancedBase.events) ? advancedBase.events : []).slice(priorEventCount);
  for (const audit of newEvents) {
    const fill = auditAsFill(audit);
    const state = createSymbolState(prior.symbol, { quantity: signedQuantity, averagePrice });
    const transition = applyExecution(state, fill);
    const forManagement = {
      ...transition,
      state: { ...transition.state, averagePrice },
    };
    management = applyV24ExecutionToManagement({
      management,
      event: fill,
      reducerResult: forManagement,
      eventType: audit.type,
    });
    signedQuantity = transition.nextQuantity;
    averagePrice = transition.nextAveragePrice;
  }

  management = reconcileV24BuildWindow(management, {
    at: now,
    currentQuantity: advancedBase.currentQuantity,
    currentAveragePrice: advancedBase.currentAveragePrice,
  });

  return immutable({ ...structuredClone(advancedBase), management: structuredClone(management) });
}
