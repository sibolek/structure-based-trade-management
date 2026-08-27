import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

const STORE_KEY = "execution-v22-store";
const REFRESH_MS = 400;

function freshTrade() {
  return {
    id: null,
    createdAt: null,
    completedAt: null,
    phase: "PLAN",
    plan: {
      symbol: "",
      direction: "LONG",
      setup: "",
      timeframe: "2m",
      thesis: "",
      trigger: "",
      invalidation: "",
      structuralStop: "",
      target: "",
      management: "",
    },
    originalPlan: null,
    risk: { expectedEntry: "", intendedSize: "" },
    armedAt: null,
    currentState: "VALID",
    broker: {
      account: null,
      entryPrice: null,
      entryQuantity: null,
      peakQuantity: null,
      currentQuantity: null,
      currentAveragePrice: null,
      entryDetectedAt: null,
      exitPrice: null,
      exitQuantity: null,
      flatDetectedAt: null,
    },
    decisions: [],
    exit: null,
    reviewNote: "",
  };
}

function readPreEntryTrade() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (!saved) return null;
    const store = JSON.parse(saved);
    const trade = store?.activeTrade;
    if (!trade?.originalPlan) return null;
    if (trade.phase !== "RISK" && trade.phase !== "AWAITING_ENTRY") return null;
    return trade;
  } catch {
    return null;
  }
}

export default function PreEntryTradeActions() {
  const [trade, setTrade] = useState(readPreEntryTrade);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const next = readPreEntryTrade();
      setTrade(next);
      if (!next) setConfirming(false);
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    refresh();
    return () => window.clearInterval(timer);
  }, []);

  if (!trade || trade.phase === "AWAITING_ENTRY") return null;

  const discardTrade = () => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (!saved) return;
      const store = JSON.parse(saved);
      store.activeTrade = freshTrade();
      store.view = "TRADE";
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      window.location.reload();
    } catch {
      // Do not alter state if the local store cannot be updated safely.
    }
  };

  return (
    <section className="px-3 pb-4 text-zinc-100 md:px-5">
      <div className="mx-auto max-w-7xl">
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex items-center gap-2 rounded border border-red-400/20 px-4 py-2 text-sm font-semibold text-red-200/75 transition hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-100"
          >
            <Trash2 size={15} />
            DISCARD TRADE → NEW PLAN
          </button>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-red-400/25 bg-red-950/15 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-red-100">Discard {trade.originalPlan.symbol} {trade.originalPlan.direction}?</p>
              <p className="mt-1 text-xs text-zinc-500">This clears only the current unfilled plan. Trade history and Schwab state are untouched.</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="rounded border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300">KEEP TRADE</button>
              <button type="button" onClick={discardTrade} className="rounded border border-red-400/35 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-100">CONFIRM DISCARD</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
