import { useMemo } from "react";
import { Activity, CircleDollarSign, Radio, ShieldCheck, Wifi, WifiOff } from "lucide-react";

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

function clock(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function transition(execution) {
  const before = execution.previousQuantity === 0
    ? "FLAT"
    : `${execution.previousSide} ${Math.abs(execution.previousQuantity)}`;
  const after = execution.nextQuantity === 0
    ? "FLAT"
    : `${execution.nextSide} ${Math.abs(execution.nextQuantity)}`;
  return `${before} → ${after}`;
}

export default function BrokerStatusPanel({ broker }) {
  const state = broker?.state || null;
  const connected = Boolean(broker?.connected);
  const error = broker?.error || "";
  const positions = state?.positions || [];
  const accounts = state?.accounts || [];
  const executions = state?.executions || [];
  const lastFive = executions.slice(0, 5);
  const lastUpdate = useMemo(() => (state?.updatedAt ? clock(state.updatedAt) : "—"), [state?.updatedAt]);

  return (
    <section className={`panel ${connected ? "border-emerald-400/20" : "border-amber-400/20"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`rounded border p-2 ${connected ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-amber-400/25 bg-amber-400/10 text-amber-300"}`}>
            {connected ? <Wifi size={18} /> : <WifiOff size={18} />}
          </div>
          <div>
            <p className="section-label">Broker Link · Read Only</p>
            <h2 className="text-lg font-semibold text-zinc-100">Schwab Live State</h2>
            <p className="mt-1 text-xs text-zinc-500">
              {connected
                ? `Connected · ${state?.status || "—"} · ${state?.pollMs || "—"} ms monitor · updated ${lastUpdate}`
                : "Waiting for the local Schwab monitor. Start npm run schwab:monitor."}
            </p>
          </div>
        </div>
        <div className={`rounded-full border px-3 py-1 font-mono text-[10px] font-bold ${connected ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}`}>
          {connected ? "BROKER ONLINE" : "BROKER OFFLINE"}
        </div>
      </div>

      {!connected ? (
        <div className="mt-3 rounded border border-white/10 bg-black/15 px-3 py-2 text-xs text-zinc-500">
          React remains usable without the broker link. No orders can be sent from this panel.{error ? ` Local API: ${error}.` : ""}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            {accounts.map((account) => (
              <div key={account.account} className="compact-card">
                <div className="flex items-center justify-between gap-2">
                  <p className="section-label">Account {account.account}</p>
                  <ShieldCheck size={15} className="text-emerald-300" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-xs text-zinc-500">Equity</p><p className="mt-1 text-lg font-semibold text-zinc-100">{money(account.equity)}</p></div>
                  <div><p className="text-xs text-zinc-500">0.5% Max Risk</p><p className="mt-1 text-lg font-semibold text-sky-100">{money(account.maxRisk)}</p></div>
                </div>
              </div>
            ))}
            <div className="compact-card">
              <div className="flex items-center justify-between gap-2"><p className="section-label">Open Positions</p><CircleDollarSign size={15} className="text-zinc-500" /></div>
              <p className="text-2xl font-semibold text-zinc-100">{positions.length}</p>
              <p className="mt-1 text-xs text-zinc-500">Broker-derived; live P/L intentionally hidden.</p>
            </div>
            <div className="compact-card">
              <div className="flex items-center justify-between gap-2"><p className="section-label">Recent Executions</p><Activity size={15} className="text-zinc-500" /></div>
              <p className="text-2xl font-semibold text-zinc-100">{executions.length}</p>
              <p className="mt-1 text-xs text-zinc-500">Most recent {Math.min(executions.length, 25)} retained in UI memory.</p>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <div className="rounded border border-white/10 bg-black/10 p-3 overflow-x-auto">
              <div className="mb-2 flex items-center gap-2"><Radio size={14} className="text-sky-300" /><p className="section-label mb-0">Current Broker Positions</p></div>
              {positions.length ? (
                <table className="w-full min-w-[460px] text-left text-xs">
                  <thead className="text-zinc-600"><tr className="border-b border-white/10"><th className="py-2">Symbol</th><th>Side</th><th className="text-right">Qty</th><th className="text-right">Avg</th></tr></thead>
                  <tbody>{positions.map((item) => <tr key={`${item.account}-${item.symbol}`} className="border-b border-white/5"><td className="py-2 font-semibold text-zinc-200">{item.symbol}</td><td className={item.side === "LONG" ? "text-emerald-300" : "text-red-300"}>{item.side}</td><td className="text-right font-mono text-zinc-300">{Math.abs(item.quantity)}</td><td className="text-right font-mono text-zinc-400">{price(item.averagePrice)}</td></tr>)}</tbody>
                </table>
              ) : <p className="py-3 text-xs text-zinc-600">No open Schwab positions.</p>}
            </div>

            <div className="rounded border border-white/10 bg-black/10 p-3 overflow-x-auto">
              <div className="mb-2 flex items-center gap-2"><Activity size={14} className="text-sky-300" /><p className="section-label mb-0">Latest Live State Events</p></div>
              {lastFive.length ? (
                <table className="w-full min-w-[620px] text-left text-xs">
                  <thead className="text-zinc-600"><tr className="border-b border-white/10"><th className="py-2">Time</th><th>Symbol</th><th>Fill</th><th>State</th><th className="text-right">Delay</th></tr></thead>
                  <tbody>{lastFive.map((item, index) => <tr key={`${item.detectedAt}-${item.symbol}-${index}`} className="border-b border-white/5"><td className="py-2 font-mono text-zinc-500">{clock(item.detectedAt)}</td><td className="font-semibold text-zinc-200">{item.symbol}</td><td className="text-zinc-400">{item.instruction} {item.quantity} @ {price(item.price)}</td><td><span className="font-semibold text-zinc-300">{item.stateEvent}</span><span className="ml-2 text-zinc-600">{transition(item)}</span></td><td className="text-right font-mono text-zinc-500">{Number.isFinite(Number(item.observedDelayMs)) ? `${item.observedDelayMs} ms` : "—"}</td></tr>)}</tbody>
                </table>
              ) : <p className="py-3 text-xs text-zinc-600">No post-arm execution events yet.</p>}
            </div>
          </div>

          {state?.lastError && <div className="rounded border border-red-400/25 bg-red-950/15 px-3 py-2 text-xs text-red-200">Monitor warning: {state.lastError}</div>}
        </div>
      )}
    </section>
  );
}
