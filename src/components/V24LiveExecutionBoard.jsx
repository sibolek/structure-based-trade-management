import { useEffect, useState } from "react";
import V24LiveTradeCard from "./V24LiveTradeCard.jsx";
import {
  readExecutionBoardStore,
  subscribeExecutionBoardStore,
  transactExecutionBoardStoreSerialized,
} from "../execution/execution-board-store-repository.js";

function nowIso() {
  return new Date().toISOString();
}

function nowLabel() {
  return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
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

export default function V24LiveExecutionBoard() {
  const [store, setStore] = useState(() => {
    try { return readExecutionBoardStore(); } catch { return null; }
  });

  useEffect(() => subscribeExecutionBoardStore({ listener: setStore }), []);
  if (!store) return null;

  const v24Trades = (Array.isArray(store.liveTrades) ? store.liveTrades : []).filter(isV24);
  const v24History = (Array.isArray(store.history) ? store.history : []).filter(isV24);

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
    if (!v24History.length) return null;
    return (
      <section className="space-y-3 pb-4">
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
      </section>
    );
  }

  if (!v24Trades.length) return null;

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
          />
        ))}
      </div>
    </section>
  );
}
