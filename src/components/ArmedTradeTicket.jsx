import { useEffect, useState } from "react";
import { Radio } from "lucide-react";

const STORE_KEY = "execution-v22-store";
const REFRESH_MS = 400;

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function price(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function readArmedTrade() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (!saved) return null;
    const store = JSON.parse(saved);
    const trade = store?.activeTrade;
    if (trade?.phase !== "AWAITING_ENTRY" || !trade?.originalPlan) return null;
    return trade;
  } catch {
    return null;
  }
}

export default function ArmedTradeTicket({ broker }) {
  const [trade, setTrade] = useState(readArmedTrade);

  useEffect(() => {
    const refresh = () => setTrade(readArmedTrade());
    const timer = window.setInterval(refresh, REFRESH_MS);
    refresh();
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (trade) document.body.dataset.executionosArmed = "true";
    else delete document.body.dataset.executionosArmed;
    return () => { delete document.body.dataset.executionosArmed; };
  }, [Boolean(trade)]);

  if (!trade) return null;

  const plan = trade.originalPlan;
  const account = broker?.state?.accounts?.[0] || null;
  const expectedEntry = Number(trade.risk?.expectedEntry);
  const structuralStop = Number(plan.structuralStop);
  const intendedSize = Number(trade.risk?.intendedSize);
  const plannedRisk = Number.isFinite(expectedEntry) && Number.isFinite(structuralStop) && Number.isFinite(intendedSize)
    ? Math.abs(expectedEntry - structuralStop) * intendedSize
    : null;

  const cancelArm = () => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (!saved) return;
      const store = JSON.parse(saved);
      store.activeTrade = { ...store.activeTrade, phase: "RISK", armedAt: null };
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      window.location.reload();
    } catch {
      // Leave the armed state untouched if local state cannot be safely updated.
    }
  };

  return (
    <section className="px-3 pb-4 text-zinc-100 md:px-5">
      <div className="mx-auto max-w-7xl space-y-3">
        <article className="overflow-hidden rounded border border-sky-400/25 bg-ink-850 shadow-terminal">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
            <div className="flex items-start gap-3">
              <Radio className="mt-1 animate-pulse text-sky-300" size={24} />
              <div>
                <p className="section-label">Armed Trade Ticket · Waiting for ToS Fill</p>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-3xl font-bold tracking-tight text-zinc-50">{plan.symbol}</h2>
                  <span className={plan.direction === "LONG" ? "text-lg font-bold text-emerald-300" : "text-lg font-bold text-red-300"}>{plan.direction}</span>
                </div>
                <p className="mt-1 text-sm text-zinc-400">{plan.setup} · {plan.timeframe} · Schwab / ToS</p>
              </div>
            </div>
            <div className={`flex items-center gap-2 text-xs font-semibold ${broker?.connected ? "text-emerald-300" : "text-red-300"}`}>
              <span className={`h-2 w-2 rounded-full ${broker?.connected ? "bg-emerald-300" : "bg-red-300"}`} />
              {broker?.connected ? "SCHWAB LISTENING" : "BROKER OFFLINE"}
            </div>
          </header>

          <div className="grid border-b border-white/10 sm:grid-cols-2 lg:grid-cols-5 lg:divide-x lg:divide-white/10">
            <div className="px-5 py-4"><p className="section-label">Expected Entry</p><p className="text-xl font-semibold text-zinc-100">{price(expectedEntry)}</p><p className="mt-1 text-[11px] text-zinc-600">Sizing reference only</p></div>
            <div className="px-5 py-4"><p className="section-label">Structural Stop</p><p className="text-xl font-semibold text-red-200">{price(structuralStop)}</p></div>
            <div className="px-5 py-4"><p className="section-label">Intended Shares</p><p className="text-xl font-semibold text-zinc-100">{Number.isFinite(intendedSize) ? intendedSize : "—"}</p></div>
            <div className="px-5 py-4"><p className="section-label">Planned Risk</p><p className="text-xl font-semibold text-zinc-100">{money(plannedRisk)}</p></div>
            <div className="px-5 py-4"><p className="section-label">0.5% Max Risk</p><p className="text-xl font-semibold text-sky-100">{money(account?.maxRisk)}</p></div>
          </div>

          <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-white/10">
            <div className="space-y-4 px-5 py-4">
              <div><p className="section-label">Thesis</p><p className="text-sm leading-6 text-zinc-300">{plan.thesis}</p></div>
              <div><p className="section-label">Trigger — Authorizes Entry</p><p className="text-sm font-semibold leading-6 text-sky-100">{plan.trigger}</p></div>
              <div><p className="section-label">Invalidation — Proves Thesis Wrong</p><p className="text-sm font-semibold leading-6 text-red-200">{plan.invalidation}</p></div>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div><p className="section-label">Target</p><p className="text-sm leading-6 text-zinc-300">{plan.target}</p></div>
              <div><p className="section-label">Management Plan</p><p className="text-sm leading-6 text-zinc-300">{plan.management}</p></div>
              <div className="border-t border-white/10 pt-3"><p className="text-xs leading-5 text-zinc-500">ExecutionOS is armed but cannot place an order. When the chart trigger occurs, enter in ToS. The actual Schwab fill price and quantity will replace the sizing reference automatically.</p></div>
            </div>
          </div>
        </article>

        <button type="button" onClick={cancelArm} className="rounded border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-400 hover:border-white/20 hover:text-zinc-200">CANCEL ARM → RISK</button>
      </div>
    </section>
  );
}
