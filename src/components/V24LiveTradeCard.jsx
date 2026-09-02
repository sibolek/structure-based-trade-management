import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import {
  executionAuthorizedMaxDollarRisk,
  executionStop,
  executionStructuralInvalidation,
} from "../execution/execution-v23-compat.js";

function price(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

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

function StatePill({ state }) {
  const cls = state === "VALID"
    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
    : state === "THREATENED"
      ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
      : "border-red-400/30 bg-red-400/10 text-red-200";
  return <span className={`rounded-full border px-3 py-1 font-mono text-[11px] font-bold ${cls}`}>{state}</span>;
}

export default function V24LiveTradeCard({ trade, onState, onClassify }) {
  const plan = trade.originalPlan || {};
  const broker = trade.broker || {};
  const effectiveStop = executionStop(trade);
  const structuralInvalidation = executionStructuralInvalidation(trade);
  const authorizedMaxRisk = executionAuthorizedMaxDollarRisk(trade);
  const lifecycleStatus = broker.lifecycleStatus || "LIVE";
  const warnings = Array.isArray(broker.lifecycleWarnings) ? broker.lifecycleWarnings : [];

  if (trade.phase === "EXIT") {
    const reversed = broker.terminalEvent === "REVERSAL";
    return (
      <article className="rounded border border-sky-400/25 bg-ink-850 p-4 shadow-terminal">
        <p className="section-label">V2.4 · {reversed ? "Broker Reversal Detected" : "Broker Exit Detected"}</p>
        <h3 className="text-2xl font-bold">{reversed ? `${plan.symbol} ${plan.direction} ended by REVERSAL` : `${plan.symbol} is FLAT`}</h3>
        <p className="mt-1 text-sm text-zinc-400">Entry {price(broker.entryPrice)} · Exit VWAP {price(broker.exitPrice)} · Peak qty {broker.peakQuantity}</p>
        <p className="mt-1 text-xs text-zinc-500">Effective stop {price(effectiveStop)} · Structural invalidation {price(structuralInvalidation)}</p>
        {reversed && (
          <div className="mt-3 rounded border border-amber-400/25 bg-amber-950/15 p-3 text-sm text-amber-100">
            Broker now {broker.reversalSide} {broker.reversalQuantity} @ {price(broker.reversalAveragePrice)}. Opposite-side broker exposure is not owned by the original V2.4 authorization.
          </div>
        )}
        <p className="mt-4 text-sm font-semibold">Classify why the trade ended:</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <button onClick={() => onClassify(trade.id, "Planned target", "STRUCTURAL / PLANNED")} className="rounded border border-emerald-400/25 bg-emerald-400/10 px-3 py-3 font-semibold text-emerald-100">TARGET</button>
          <button onClick={() => onClassify(trade.id, "Structural invalidation", "STRUCTURAL / PLANNED")} className="rounded border border-red-400/25 bg-red-400/10 px-3 py-3 font-semibold text-red-100">INVALIDATED</button>
          <button onClick={() => onClassify(trade.id, "Legitimate new adverse structure", "STRUCTURAL / PLANNED")} className="rounded border border-amber-400/25 bg-amber-400/10 px-3 py-3 font-semibold text-amber-100">ADVERSE STRUCTURE</button>
          <button onClick={() => onClassify(trade.id, "Predefined management rule", "STRUCTURAL / PLANNED")} className="rounded border border-sky-400/25 bg-sky-400/10 px-3 py-3 font-semibold text-sky-100">PLAN RULE</button>
        </div>
      </article>
    );
  }

  const qty = Number(broker.currentQuantity);
  const avg = Number(broker.currentAveragePrice ?? broker.entryPrice);
  const actualRisk = Number.isFinite(Number(broker.actualStopRisk))
    ? Number(broker.actualStopRisk)
    : ([avg, Number(effectiveStop), qty].every(Number.isFinite) ? Math.abs(avg - Number(effectiveStop)) * qty : null);
  const riskBreach = warnings.includes("ACTUAL_STOP_RISK_EXCEEDS_AUTHORIZED_BUDGET")
    || (Number.isFinite(actualRisk) && Number.isFinite(Number(authorizedMaxRisk)) && actualRisk > Number(authorizedMaxRisk));
  const reconciliation = lifecycleStatus === "LIVE_RECONCILIATION_REQUIRED";

  return (
    <article className={`rounded border bg-ink-850 p-4 shadow-terminal ${reconciliation ? "border-red-400/35" : "border-emerald-400/20"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-label">V2.4 · Exact-Account Broker-Bound Trade</p>
          <div className="flex items-baseline gap-2">
            <h3 className="text-2xl font-bold">{plan.symbol}</h3>
            <span className={plan.direction === "LONG" ? "font-bold text-emerald-300" : "font-bold text-red-300"}>{plan.direction}</span>
          </div>
          <p className="text-xs text-zinc-500">{plan.setup} · {plan.timeframe}</p>
        </div>
        <StatePill state={trade.currentState} />
      </div>

      {reconciliation && (
        <div className="mt-3 rounded border border-red-400/35 bg-red-950/20 p-3 text-sm text-red-100">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} />AUTOMATIC BROKER LIFECYCLE SUSPENDED</div>
          <p className="mt-1">Broker execution continuity could not be proven. This trade remains owned; explicit reconciliation is required.</p>
          <p className="mt-1 font-mono text-xs">{broker.reconciliationReason || "BROKER_EXECUTION_RECONCILIATION_REQUIRED"}</p>
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <div className="compact-card"><p className="section-label">Actual Avg</p><p className="text-lg font-semibold">{price(avg)}</p></div>
        <div className="compact-card"><p className="section-label">Current Qty</p><p className="text-lg font-semibold">{Number.isFinite(qty) ? qty : "—"}</p></div>
        <div className="compact-card"><p className="section-label">Effective Stop</p><p className="text-lg font-semibold text-red-200">{price(effectiveStop)}</p></div>
        <div className="compact-card"><p className="section-label">Structural Invalid.</p><p className="text-lg font-semibold text-amber-100">{price(structuralInvalidation)}</p></div>
        <div className="compact-card"><p className="section-label">Actual Stop Risk</p><p className={`text-lg font-semibold ${riskBreach ? "text-red-300" : "text-zinc-100"}`}>{money(actualRisk)}</p></div>
        <div className="compact-card"><p className="section-label">Frozen Max Risk</p><p className="text-lg font-semibold text-sky-100">{money(authorizedMaxRisk)}</p></div>
      </div>

      {warnings.includes("AUTHORIZED_QUANTITY_EXCEEDED") && (
        <div className="mt-3 rounded border border-amber-400/30 bg-amber-950/15 p-3 text-sm font-semibold text-amber-100">Actual owned quantity exceeded the immutable V2.4 authorized quantity. ExecutionOS owns the full broker exposure; no automatic reduction is performed.</div>
      )}
      {riskBreach && (
        <div className="mt-3 rounded border border-red-400/30 bg-red-950/20 p-3 text-sm font-semibold text-red-200">Actual fill/size implies stop risk above the frozen ARM-time budget. Do not tighten the effective stop to fix sizing.</div>
      )}

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <button onClick={() => onState(trade.id, "VALID")} className="rounded border border-emerald-400/30 bg-emerald-400/10 p-3 text-left font-bold text-emerald-100"><CheckCircle2 className="mb-2" size={20} />VALID — HOLD</button>
        <button onClick={() => onState(trade.id, "THREATENED")} className="rounded border border-amber-400/30 bg-amber-400/10 p-3 text-left font-bold text-amber-100"><AlertTriangle className="mb-2" size={20} />THREATENED</button>
        <button onClick={() => onState(trade.id, "INVALID")} className="rounded border border-red-400/30 bg-red-400/10 p-3 text-left font-bold text-red-100"><XCircle className="mb-2" size={20} />INVALID</button>
      </div>
    </article>
  );
}
