import { useEffect, useState } from "react";
import { History } from "lucide-react";

const STORE_KEY = "execution-v23-store";
const REFRESH_MS = 1000;

function readHistory() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.history) ? parsed.history : [];
  } catch {
    return [];
  }
}

export default function ExecutionHistoryWorkspace() {
  const [history, setHistory] = useState(readHistory);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active) setHistory(readHistory());
    };
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-label">ExecutionOS · V2.3 Record</p>
          <h2 className="text-lg font-semibold text-zinc-100">Execution History</h2>
          <p className="mt-1 text-xs text-zinc-500">Read-only view of completed trades already persisted by the existing V2.3 execution system.</p>
        </div>
        <span className="flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300">
          <History size={14} /> {history.length} COMPLETE
        </span>
      </div>

      {!history.length ? (
        <div className="rounded border border-white/10 bg-white/[0.02] px-4 py-5 text-sm text-zinc-500">No completed ExecutionOS trades are stored yet.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {history.map((trade) => (
            <article key={trade.id} className="compact-card">
              <p className="section-label">{trade.completedAt ? new Date(trade.completedAt).toLocaleString() : "Completed"}</p>
              <h3 className="text-lg font-semibold text-zinc-100">{trade.originalPlan?.symbol || "—"} {trade.originalPlan?.direction || ""}</h3>
              <p className="mt-1 text-sm text-zinc-500">{trade.exit?.classification || "Unclassified"} · {trade.exit?.reason || "—"}</p>
              <p className="mt-3 text-xs text-zinc-600">{trade.originalPlan?.setup || "—"} · {trade.originalPlan?.timeframe || "—"}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
