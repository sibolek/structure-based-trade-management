import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import V24LiveTradeCard from "./V24LiveTradeCard.jsx";
import {
  readExecutionBoardStore,
  subscribeExecutionBoardStore,
  transactExecutionBoardStoreSerialized,
} from "../execution/execution-board-store-repository.js";
import { applyV24LiveManagementCommandSerialized } from "../execution/execution-v24-live-management.js";
import { reconcileV24RetiredAuthorizationExceptionSerialized } from "../execution/execution-v24-retired-authorization-exceptions.js";

function nowIso() {
  return new Date().toISOString();
}

function nowLabel() {
  return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
}

function operationId(prefix, identity) {
  const uuid = globalThis?.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${identity}:${uuid}`;
}

function decision(stage, state, action, note = "") {
  return {
    id: `v24-ui:${Date.now()}:${Math.random()}`,
    timestamp: nowIso(),
    time: nowLabel(),
    stage,
    state,
    action,
    note,
  };
}

function isV24(record) {
  return record?.origin === "V24_HANDOFF" && record?.v24?.handoffId;
}

function RetiredAuthorizationExceptions({ exceptions, onReconcile }) {
  if (!exceptions.length) return null;
  return (
    <div className="rounded border border-red-400/35 bg-red-950/15 p-3">
      <div className="flex items-center gap-2 font-semibold text-red-100"><AlertTriangle size={17} />Retired Authorization Exceptions</div>
      <p className="mt-1 text-xs text-red-200/70">Broker truth was observed after an authorization had already expired. The expired authorization remains retired and is never resurrected.</p>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {exceptions.map((item) => (
          <div key={item.exceptionId} className="rounded border border-red-400/20 bg-ink-850 p-3">
            <p className="font-mono text-xs font-bold text-red-200">{item.code} · {item.severity} · {item.status}</p>
            <p className="mt-1 text-sm font-semibold">{item.symbol} {item.direction}</p>
            <p className="mt-1 text-xs text-zinc-400">Broker {item.brokerExecution?.quantity} @ {item.brokerExecution?.price} · {item.brokerExecution?.executionTime ? new Date(item.brokerExecution.executionTime).toLocaleString() : "—"}</p>
            <p className="mt-1 text-xs text-zinc-500">Expired cutoff {item.retirementCutoffAt ? new Date(item.retirementCutoffAt).toLocaleString() : "—"}</p>
            {Array.isArray(item.plausibleLaterHandoffIds) && item.plausibleLaterHandoffIds.length > 0 && (
              <p className="mt-1 font-mono text-[11px] text-amber-200">Possible later authorization: {item.plausibleLaterHandoffIds.join(", ")}</p>
            )}
            {item.status !== "RECONCILED" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => onReconcile(item.exceptionId, "BROKER_TRUTH_REVIEWED", null)} className="rounded border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-100">Reviewed — Keep Outside Expired Auth</button>
                {item.code === "FILL_ATTRIBUTION_UNRESOLVED" && item.plausibleLaterHandoffIds?.map((handoffId) => (
                  <button key={handoffId} onClick={() => onReconcile(item.exceptionId, "ASSIGNED_TO_OTHER_AUTHORIZATION", handoffId)} className="rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100">Assign → {handoffId}</button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-emerald-300">Reconciled: {item.reconciliationOutcome}{item.reconciliationAssignedHandoffId ? ` → ${item.reconciliationAssignedHandoffId}` : ""}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function V24LiveExecutionBoard() {
  const [store, setStore] = useState(() => {
    try { return readExecutionBoardStore(); } catch { return null; }
  });

  useEffect(() => subscribeExecutionBoardStore({ listener: setStore }), []);
  if (!store) return null;

  const v24Trades = (Array.isArray(store.liveTrades) ? store.liveTrades : []).filter(isV24);
  const v24History = (Array.isArray(store.history) ? store.history : []).filter(isV24);
  const retiredExceptions = (Array.isArray(store.v24AuthorizationExceptions) ? store.v24AuthorizationExceptions : [])
    .filter((item) => item?.severity === "CRITICAL");

  const updateState = async (id, state) => {
    await transactExecutionBoardStoreSerialized({
      mutate: (latest) => ({
        ...latest,
        liveTrades: latest.liveTrades.map((trade) => {
          if (trade.id !== id || !isV24(trade)) return trade;
          return {
            ...trade,
            currentState: state,
            decisions: [
              ...(Array.isArray(trade.decisions) ? trade.decisions : []),
              decision(
                state === "VALID" ? "HOLD" : "UPDATE",
                state,
                state === "VALID" ? "HOLD — VALID" : state,
                state === "VALID" ? "Nothing requires action." : "State updated from chart structure.",
              ),
            ],
          };
        }),
      }),
    });
  };

  const runManagementCommand = async (handoffId, action, payload = {}) => {
    const latest = readExecutionBoardStore();
    const lifecycle = (Array.isArray(latest.v24Lifecycles) ? latest.v24Lifecycles : [])
      .find((item) => item?.handoffId === handoffId);
    const revision = Number(lifecycle?.management?.revision);
    if (!Number.isInteger(revision) || revision < 0) {
      const error = new Error("V2.4 live-management authority is unavailable");
      error.code = "V24_LIVE_MANAGEMENT_UNAVAILABLE";
      throw error;
    }
    return applyV24LiveManagementCommandSerialized({
      handoffId,
      command: {
        operationId: operationId("live-management", handoffId),
        expectedRevision: revision,
        action,
        payload,
        at: nowIso(),
      },
    });
  };

  const reconcileRetiredException = async (exceptionId, outcome, assignedHandoffId = null) => reconcileV24RetiredAuthorizationExceptionSerialized({
    exceptionId,
    outcome,
    assignedHandoffId,
    note: outcome === "ASSIGNED_TO_OTHER_AUTHORIZATION"
      ? `Operator reviewed broker truth and assigned attribution to ${assignedHandoffId}.`
      : "Operator reviewed broker truth; the fill remains outside the expired authorization.",
    at: nowIso(),
  });

  const classifyExit = async (id, reason, classification) => {
    await transactExecutionBoardStoreSerialized({
      mutate: (latest) => {
        const trade = latest.liveTrades.find((item) => item.id === id && isV24(item));
        if (!trade || trade.phase !== "EXIT") return latest;
        const completed = {
          ...trade,
          phase: "REVIEW",
          completedAt: nowIso(),
          exit: { reason, classification, time: nowLabel() },
          decisions: [
            ...(Array.isArray(trade.decisions) ? trade.decisions : []),
            decision("EXIT", trade.currentState, reason.toUpperCase(), classification),
          ],
        };
        return {
          ...latest,
          liveTrades: latest.liveTrades.filter((item) => item.id !== id),
          history: [completed, ...latest.history],
        };
      },
    });
  };

  if (store.view === "HISTORY") {
    if (!v24History.length && !retiredExceptions.length) return null;
    return (
      <section className="space-y-3 pb-4">
        <RetiredAuthorizationExceptions exceptions={retiredExceptions} onReconcile={reconcileRetiredException} />
        {v24History.length > 0 && (
          <>
            <div>
              <p className="section-label">V2.4 Execution History</p>
              <h2 className="text-lg font-semibold">{v24History.length} completed V2.4 trade{v24History.length === 1 ? "" : "s"}</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {v24History.map((trade) => (
                <article key={trade.id} className="compact-card">
                  <p className="section-label">{trade.completedAt ? new Date(trade.completedAt).toLocaleString() : "Completed"}</p>
                  <h3 className="text-lg font-semibold">{trade.originalPlan?.symbol} {trade.originalPlan?.direction}</h3>
                  <p className="mt-1 text-sm text-zinc-500">{trade.exit?.classification} · {trade.exit?.reason}</p>
                  <p className="mt-2 text-xs text-zinc-600">V2.4 handoff {trade.v24?.handoffId}</p>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    );
  }

  if (!v24Trades.length && !retiredExceptions.length) return null;

  const globalLiveCount = (Array.isArray(store.liveTrades) ? store.liveTrades : [])
    .filter((trade) => trade.phase === "LIVE").length;
  const v24Live = v24Trades.filter((trade) => trade.phase === "LIVE").length;
  const v24Exit = v24Trades.filter((trade) => trade.phase === "EXIT").length;

  return (
    <section className="space-y-3 pb-4">
      {globalLiveCount > 2 && (
        <div className="rounded border border-red-400/30 bg-red-950/20 p-3 font-semibold text-red-200">
          More than two instruments are live across legacy and V2.4 execution. This exceeds the ExecutionOS two-live-instrument guardrail.
        </div>
      )}
      <RetiredAuthorizationExceptions exceptions={retiredExceptions} onReconcile={reconcileRetiredException} />
      {v24Trades.length > 0 && (
        <>
          <div>
            <p className="section-label">V2.4 Live Execution Board</p>
            <h2 className="text-lg font-semibold">{v24Live} live · {v24Exit} awaiting exit classification</h2>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {v24Trades.map((trade) => (
              <V24LiveTradeCard
                key={trade.id}
                trade={trade}
                onState={updateState}
                onClassify={classifyExit}
                onManagementCommand={runManagementCommand}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
