import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  History,
  LockKeyhole,
  Radio,
  RotateCcw,
  ShieldCheck,
  XCircle,
  Zap,
} from "lucide-react";

const STORE_KEY = "execution-v22-store";
const CHAIN = ["READ", "PLAN", "RISK", "ARM", "TRIGGER", "HOLD", "UPDATE", "EXIT", "REVIEW"];
const FUTURES = new Set(["MES", "MNQ", "MCL", "ES", "NQ", "CL"]);

const emptyPlan = {
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
};

function freshTrade() {
  return {
    id: null,
    createdAt: null,
    completedAt: null,
    phase: "PLAN",
    plan: { ...emptyPlan },
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

function initialStore() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // Fall through.
  }
  return { activeTrade: freshTrade(), history: [], view: "TRADE" };
}

function nowLabel() {
  return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function price(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function addDecision(trade, stage, state, decision, note = "") {
  return {
    ...trade,
    decisions: [
      ...trade.decisions,
      {
        id: `${Date.now()}-${Math.random()}`,
        time: nowLabel(),
        timestamp: new Date().toISOString(),
        stage,
        state,
        decision,
        note,
      },
    ],
  };
}

function upsertHistory(history, trade) {
  const without = history.filter((item) => item.id !== trade.id);
  return [trade, ...without].sort((a, b) => String(b.completedAt || b.createdAt).localeCompare(String(a.completedAt || a.createdAt)));
}

function sourceFor(symbol) {
  return FUTURES.has(String(symbol || "").toUpperCase()) ? "NINJATRADER" : "SCHWAB";
}

function openingInstruction(direction) {
  return direction === "SHORT" ? "SELL_SHORT" : "BUY";
}

function weightedVwap(events) {
  const totalQty = events.reduce((sum, event) => sum + Number(event.quantity || 0), 0);
  if (!totalQty) return { quantity: 0, price: null };
  const value = events.reduce((sum, event) => sum + Number(event.quantity || 0) * Number(event.price || 0), 0);
  return { quantity: totalQty, price: value / totalQty };
}

const inputClass = "w-full rounded border border-white/10 bg-black/25 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-sky-400/50";
const textareaClass = `${inputClass} min-h-20 resize-y`;

function Field({ label, children, help }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
      {help && <span className="mt-1 block text-xs text-zinc-600">{help}</span>}
    </label>
  );
}

function StatePill({ state }) {
  const tone = {
    VALID: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    THREATENED: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    INVALID: "border-red-400/30 bg-red-400/10 text-red-200",
  }[state] || "border-white/10 text-zinc-400";
  return <span className={`rounded-full border px-3 py-1 font-mono text-[11px] font-bold ${tone}`}>{state}</span>;
}

function Chain({ phase }) {
  const activeMap = { PLAN: "PLAN", RISK: "RISK", AWAITING_ENTRY: "ARM", LIVE: "HOLD", EXIT: "EXIT", REVIEW: "REVIEW" };
  const active = activeMap[phase] || "PLAN";
  return (
    <div className="flex flex-wrap gap-1.5">
      {CHAIN.map((step) => <div key={step} className={`rounded border px-2 py-1 font-mono text-[9px] font-semibold ${step === active ? "border-sky-400/40 bg-sky-400/10 text-sky-100" : "border-white/10 text-zinc-700"}`}>{step}</div>)}
    </div>
  );
}

function PlanScreen({ trade, updateTrade }) {
  const plan = trade.plan;
  const update = (key, value) => updateTrade((current) => ({ ...current, plan: { ...current.plan, [key]: value } }));
  const canFreeze = Object.keys(emptyPlan).every((key) => String(plan[key] ?? "").trim());
  const source = sourceFor(plan.symbol);

  const freeze = () => {
    if (!canFreeze) return;
    updateTrade((current) => {
      const frozen = { ...current.plan, symbol: current.plan.symbol.toUpperCase() };
      let next = {
        ...current,
        id: current.id || `${Date.now()}`,
        createdAt: current.createdAt || new Date().toISOString(),
        phase: "RISK",
        originalPlan: frozen,
      };
      return addDecision(next, "PLAN", "—", "PLAN FROZEN", `${frozen.symbol} ${frozen.direction} — ${frozen.setup}`);
    });
  };

  return (
    <div className="space-y-4">
      <section className="panel">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div><p className="section-label">Pre-Entry Freeze · Broker-Aware</p><h2 className="text-xl font-semibold text-zinc-100">You provide the why. Broker provides the what.</h2><p className="mt-1 text-sm text-zinc-500">ExecutionOS will observe the actual entry, size, adds, partials, and exit from the broker.</p></div>
          <LockKeyhole className="text-sky-300" size={22} />
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <Field label="Symbol"><input className={inputClass} value={plan.symbol} onChange={(e) => update("symbol", e.target.value.toUpperCase())} placeholder="NVDA" /></Field>
          <Field label="Direction"><select className={inputClass} value={plan.direction} onChange={(e) => update("direction", e.target.value)}><option>LONG</option><option>SHORT</option></select></Field>
          <Field label="Setup"><input className={inputClass} value={plan.setup} onChange={(e) => update("setup", e.target.value)} placeholder="H2, MTR, breakout/retest…" /></Field>
          <Field label="Timeframe"><input className={inputClass} value={plan.timeframe} onChange={(e) => update("timeframe", e.target.value)} /></Field>
          <div className="rounded border border-white/10 bg-black/20 px-3 py-2"><p className="section-label">Execution Source</p><p className={`text-sm font-semibold ${source === "SCHWAB" ? "text-emerald-200" : "text-amber-200"}`}>{source}</p></div>
        </div>
      </section>

      {source === "NINJATRADER" && plan.symbol && <section className="rounded border border-amber-400/25 bg-amber-950/15 p-3 text-sm text-amber-100">{plan.symbol} is a futures instrument. The NinjaTrader adapter is the future execution source; Schwab binding is intentionally disabled for this instrument.</section>}

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="panel space-y-3">
          <Field label="Thesis" help="What exactly am I trading?"><textarea className={textareaClass} value={plan.thesis} onChange={(e) => update("thesis", e.target.value)} /></Field>
          <Field label="Trigger" help="What event authorizes entry in ToS?"><textarea className={textareaClass} value={plan.trigger} onChange={(e) => update("trigger", e.target.value)} /></Field>
          <Field label="Invalidation" help="What proves the thesis wrong?"><textarea className={textareaClass} value={plan.invalidation} onChange={(e) => update("invalidation", e.target.value)} /></Field>
        </div>
        <div className="panel space-y-3">
          <Field label="Structural Stop"><input type="number" step="any" className={inputClass} value={plan.structuralStop} onChange={(e) => update("structuralStop", e.target.value)} /></Field>
          <Field label="Target"><textarea className={textareaClass} value={plan.target} onChange={(e) => update("target", e.target.value)} /></Field>
          <Field label="Management Plan"><textarea className={textareaClass} value={plan.management} onChange={(e) => update("management", e.target.value)} /></Field>
        </div>
      </section>

      <button type="button" disabled={!canFreeze} onClick={freeze} className="w-full rounded border border-sky-400/40 bg-sky-400/10 px-4 py-3 font-semibold text-sky-100 disabled:opacity-30">FREEZE PLAN → RISK</button>
    </div>
  );
}

function RiskScreen({ trade, updateTrade, broker }) {
  const plan = trade.originalPlan;
  const account = broker?.state?.accounts?.[0] || null;
  const positions = broker?.state?.positions || [];
  const existingPosition = positions.find((item) => item.symbol === plan.symbol);
  const source = sourceFor(plan.symbol);
  const [expectedEntry, setExpectedEntry] = useState(trade.risk.expectedEntry || "");
  const [intendedSize, setIntendedSize] = useState(trade.risk.intendedSize || "");

  const metrics = useMemo(() => {
    const entry = Number(expectedEntry);
    const stop = Number(plan.structuralStop);
    const size = Number(intendedSize);
    const equity = Number(account?.equity);
    const maxRisk = Number(account?.maxRisk ?? equity * 0.005);
    const distance = Math.abs(entry - stop);
    const plannedRisk = distance * size;
    const maxSize = distance > 0 && Number.isFinite(maxRisk) ? Math.floor(maxRisk / distance) : 0;
    return { entry, stop, size, equity, maxRisk, distance, plannedRisk, maxSize };
  }, [expectedEntry, intendedSize, plan.structuralStop, account?.equity, account?.maxRisk]);

  const brokerReady = source === "SCHWAB" && broker?.connected && broker?.state?.status === "ARMED" && account;
  const numbersReady = [metrics.entry, metrics.stop, metrics.size].every((value) => Number.isFinite(value) && value > 0) && metrics.distance > 0;
  const allowed = brokerReady && numbersReady && !existingPosition && metrics.plannedRisk <= metrics.maxRisk;

  const arm = () => {
    if (!allowed) return;
    updateTrade((current) => {
      let next = {
        ...current,
        phase: "AWAITING_ENTRY",
        armedAt: new Date().toISOString(),
        risk: { expectedEntry, intendedSize },
      };
      next = addDecision(next, "RISK", "—", "RISK APPROVED", `${money(metrics.plannedRisk)} planned risk; ${money(metrics.maxRisk)} maximum`);
      return addDecision(next, "ARM", "—", "WAITING FOR BROKER ENTRY", `${plan.symbol} ${plan.direction}; trade in ToS when trigger occurs.`);
    });
  };

  return (
    <div className="space-y-4">
      <section className="panel"><p className="section-label">Risk Permission · Schwab Derived Equity</p><h2 className="text-xl font-semibold text-zinc-100">Structural stop first. Planned size second. Actual fill comes from ToS.</h2></section>

      <section className="grid gap-3 md:grid-cols-4">
        <div className="compact-card"><p className="section-label">Broker Equity</p><p className="text-2xl font-semibold text-zinc-100">{money(account?.equity)}</p><p className="mt-1 text-xs text-zinc-600">Automatic; not editable.</p></div>
        <div className="compact-card"><p className="section-label">0.5% Maximum</p><p className="text-2xl font-semibold text-sky-100">{money(metrics.maxRisk)}</p><p className="mt-1 text-xs text-zinc-600">Automatic from Schwab equity.</p></div>
        <Field label="Expected Entry · risk reference"><input type="number" step="any" className={inputClass} value={expectedEntry} onChange={(e) => setExpectedEntry(e.target.value)} /></Field>
        <Field label="Intended Size"><input type="number" min="1" step="1" className={inputClass} value={intendedSize} onChange={(e) => setIntendedSize(e.target.value)} /></Field>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <div className="compact-card"><p className="section-label">Structural Stop</p><p className="text-xl font-semibold text-zinc-100">{plan.structuralStop}</p></div>
        <div className="compact-card"><p className="section-label">Stop Distance</p><p className="text-xl font-semibold text-zinc-100">{numbersReady ? price(metrics.distance) : "—"}</p></div>
        <div className="compact-card"><p className="section-label">Planned Risk</p><p className="text-xl font-semibold text-zinc-100">{numbersReady ? money(metrics.plannedRisk) : "—"}</p></div>
        <div className="compact-card"><p className="section-label">Maximum Shares</p><p className="text-xl font-semibold text-zinc-100">{numbersReady ? metrics.maxSize : "—"}</p></div>
      </section>

      {existingPosition && <section className="rounded border border-amber-400/25 bg-amber-950/15 p-3 text-sm text-amber-100">ExecutionOS already sees {plan.symbol} {existingPosition.side} {Math.abs(existingPosition.quantity)} in Schwab. Automatic new-trade binding is blocked so an existing holding cannot be mistaken for a fresh day-trade entry.</section>}
      {source === "NINJATRADER" && <section className="rounded border border-amber-400/25 bg-amber-950/15 p-3 text-sm text-amber-100">NinjaTrader binding is not connected yet. Do not route this futures plan through the Schwab adapter.</section>}
      {!broker?.connected && source === "SCHWAB" && <section className="rounded border border-red-400/25 bg-red-950/15 p-3 text-sm text-red-100">Schwab monitor is offline. Start the broker monitor before arming this trade.</section>}

      <div className={`rounded border p-4 ${allowed ? "border-emerald-400/25 bg-emerald-950/20" : "border-amber-400/25 bg-amber-950/20"}`}>
        <div className="flex items-start gap-3">{allowed ? <ShieldCheck className="text-emerald-300" /> : <AlertTriangle className="text-amber-300" />}<div><p className="font-semibold text-zinc-100">{allowed ? "RISK PERMITTED" : "RISK NOT YET PERMITTED"}</p><p className="mt-1 text-sm text-zinc-400">Expected entry is only the pre-trade sizing reference. Once filled, ExecutionOS replaces it with the actual broker average and quantity.</p></div></div>
      </div>

      <button type="button" disabled={!allowed} onClick={arm} className="w-full rounded border border-emerald-400/40 bg-emerald-400/10 px-4 py-3 font-semibold text-emerald-100 disabled:opacity-30">ARM FOR BROKER ENTRY</button>
    </div>
  );
}

function AwaitingEntryScreen({ trade, broker, cancelArm }) {
  return (
    <div className="space-y-4">
      <section className="rounded border border-sky-400/25 bg-sky-950/15 p-6 text-center">
        <Radio className="mx-auto mb-3 animate-pulse text-sky-300" size={30} />
        <p className="section-label">Broker Entry Armed</p>
        <h2 className="text-2xl font-semibold text-zinc-50">Waiting for {trade.originalPlan.symbol} in ToS</h2>
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-zinc-400">No entry button exists here. When your chart trigger occurs, place the trade normally in ToS. ExecutionOS will bind to the actual Schwab opening fill and move to LIVE automatically.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3 text-xs"><span className="rounded border border-white/10 px-3 py-2 text-zinc-400">Direction: {trade.originalPlan.direction}</span><span className="rounded border border-white/10 px-3 py-2 text-zinc-400">Expected: {trade.risk.expectedEntry}</span><span className="rounded border border-white/10 px-3 py-2 text-zinc-400">Planned size: {trade.risk.intendedSize}</span><span className={`rounded border px-3 py-2 ${broker?.connected ? "border-emerald-400/20 text-emerald-200" : "border-red-400/20 text-red-200"}`}>{broker?.connected ? "SCHWAB LISTENING" : "BROKER OFFLINE"}</span></div>
      </section>
      <button onClick={cancelArm} className="rounded border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-400">CANCEL ARM → RISK</button>
    </div>
  );
}

function CompactPlan({ trade }) {
  const plan = trade.originalPlan;
  return (
    <section className="rounded border border-white/10 bg-ink-850 p-3 shadow-terminal">
      <div className="grid gap-2 md:grid-cols-5">
        <div><p className="section-label">Trade</p><p className="text-sm font-semibold text-zinc-100">{plan.symbol} {plan.direction}</p></div>
        <div><p className="section-label">Thesis</p><p className="text-xs leading-5 text-zinc-300">{plan.thesis}</p></div>
        <div><p className="section-label">Invalidation</p><p className="text-xs leading-5 font-semibold text-red-200">{plan.invalidation}</p></div>
        <div><p className="section-label">Stop</p><p className="text-lg font-semibold text-zinc-100">{plan.structuralStop}</p></div>
        <div><p className="section-label">Target</p><p className="text-xs leading-5 text-zinc-300">{plan.target}</p></div>
      </div>
    </section>
  );
}

function LiveScreen({ trade, updateTrade, brokerPosition }) {
  const quickDecision = (state, decision, note) => updateTrade((current) => addDecision({ ...current, currentState: state }, state === "VALID" ? "HOLD" : "UPDATE", state, decision, note));
  const quantity = brokerPosition ? Math.abs(brokerPosition.quantity) : trade.broker.currentQuantity;
  const avg = brokerPosition?.averagePrice ?? trade.broker.currentAveragePrice ?? trade.broker.entryPrice;

  return (
    <div className="space-y-3">
      <CompactPlan trade={trade} />
      <section className="rounded border border-emerald-400/20 bg-emerald-950/10 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-start gap-2"><Zap className="mt-0.5 text-emerald-300" size={18} /><div><p className="font-semibold text-emerald-100">BROKER-BOUND LIVE TRADE</p><p className="text-xs text-emerald-100/60">ToS owns orders. ExecutionOS owns plan discipline and observes position state.</p></div></div><StatePill state={trade.currentState} /></div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <div className="compact-card"><p className="section-label">Actual Broker Entry Avg</p><p className="text-xl font-semibold text-zinc-100">{price(avg)}</p></div>
        <div className="compact-card"><p className="section-label">Current Broker Qty</p><p className="text-xl font-semibold text-zinc-100">{quantity ?? "—"}</p></div>
        <div className="compact-card"><p className="section-label">Peak Qty Seen</p><p className="text-xl font-semibold text-zinc-100">{trade.broker.peakQuantity ?? "—"}</p></div>
        <div className="compact-card"><p className="section-label">Account</p><p className="text-xl font-semibold text-zinc-100">{trade.broker.account || "—"}</p></div>
      </section>

      <section className="grid gap-2 md:grid-cols-3">
        <button type="button" onClick={() => quickDecision("VALID", "HOLD — VALID", "No structural change.")} className="min-h-32 rounded border border-emerald-400/35 bg-emerald-400/10 p-4 text-left"><CheckCircle2 className="mb-3 text-emerald-300" size={26} /><p className="text-xl font-bold text-emerald-100">VALID — HOLD</p><p className="mt-1 text-sm text-emerald-100/60">Nothing requires action.</p></button>
        <button type="button" onClick={() => quickDecision("THREATENED", "THREATENED — OBSERVE", "Adverse structure noted; invalidation has not occurred.")} className="min-h-32 rounded border border-amber-400/35 bg-amber-400/10 p-4 text-left"><AlertTriangle className="mb-3 text-amber-300" size={26} /><p className="text-xl font-bold text-amber-100">THREATENED</p><p className="mt-1 text-sm text-amber-100/60">Probability degraded. Keep observing.</p></button>
        <button type="button" onClick={() => quickDecision("INVALID", "INVALID — STRUCTURE FAILED", "Original thesis is structurally invalid.")} className="min-h-32 rounded border border-red-400/35 bg-red-400/10 p-4 text-left"><XCircle className="mb-3 text-red-300" size={26} /><p className="text-xl font-bold text-red-100">INVALID</p><p className="mt-1 text-sm text-red-100/60">The original thesis has failed.</p></button>
      </section>

      <section className="rounded border border-sky-400/20 bg-sky-950/10 p-3"><p className="text-sm font-semibold text-sky-100">Green is not an exit. Red is not invalidation. Structure is invalidation.</p><p className="mt-1 text-xs text-sky-100/60">Exit in ToS when the chart/plan says so. When the broker position becomes flat, ExecutionOS will detect it automatically and ask you to classify the reason.</p></section>
    </div>
  );
}

function ExitScreen({ trade, finishTrade }) {
  const [showDiscretionary, setShowDiscretionary] = useState(false);
  const [pnlHidden, setPnlHidden] = useState("");
  const [priorDay, setPriorDay] = useState("");
  const ready = pnlHidden && priorDay;
  const discretionaryClassification = pnlHidden === "YES" && priorDay === "YES" ? "DISCRETIONARY — STRUCTURE CONFIRMED" : "NONSTRUCTURAL";

  return (
    <div className="space-y-4">
      <section className="rounded border border-sky-400/25 bg-sky-950/15 p-5"><p className="section-label">Broker Exit Detected</p><h2 className="text-2xl font-semibold text-zinc-50">{trade.originalPlan.symbol} is flat</h2><p className="mt-2 text-sm text-zinc-400">ExecutionOS observed the exit. Now record the chart reason—never the P/L reason.</p><div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded border border-white/10 px-3 py-2">Entry avg {price(trade.broker.entryPrice)}</span><span className="rounded border border-white/10 px-3 py-2">Peak qty {trade.broker.peakQuantity ?? trade.broker.entryQuantity}</span><span className="rounded border border-white/10 px-3 py-2">Exit VWAP {price(trade.broker.exitPrice)}</span><span className="rounded border border-white/10 px-3 py-2">Exit qty {trade.broker.exitQuantity ?? "—"}</span></div></section>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <button onClick={() => finishTrade("Planned target", "STRUCTURAL / PLANNED", "Planned target reached.")} className="rounded border border-emerald-400/25 bg-emerald-400/10 px-3 py-4 font-semibold text-emerald-100">TARGET</button>
        <button onClick={() => finishTrade("Structural invalidation", "STRUCTURAL / PLANNED", "Original invalidation occurred.")} className="rounded border border-red-400/25 bg-red-400/10 px-3 py-4 font-semibold text-red-100">INVALIDATED</button>
        <button onClick={() => finishTrade("Legitimate new adverse structure", "STRUCTURAL / PLANNED", "New adverse structure justified exit.")} className="rounded border border-amber-400/25 bg-amber-400/10 px-3 py-4 font-semibold text-amber-100">ADVERSE STRUCTURE</button>
        <button onClick={() => finishTrade("Predefined management rule", "STRUCTURAL / PLANNED", "Predefined management rule triggered.")} className="rounded border border-sky-400/25 bg-sky-400/10 px-3 py-4 font-semibold text-sky-100">PLAN RULE</button>
      </section>

      <button onClick={() => setShowDiscretionary((value) => !value)} className="rounded border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-400">DISCRETIONARY EXIT…</button>
      {showDiscretionary && <section className="rounded border border-red-400/25 bg-red-950/15 p-4 space-y-4"><div><p className="font-semibold text-zinc-100">If I could not see my P/L, would I still exit this chart?</p><div className="mt-2 flex gap-2">{["YES", "NO"].map((answer) => <button key={answer} onClick={() => setPnlHidden(answer)} className={`rounded border px-5 py-2 font-bold ${pnlHidden === answer ? "border-sky-400/50 bg-sky-400/10 text-sky-100" : "border-white/10 text-zinc-500"}`}>{answer}</button>)}</div></div><div><p className="font-semibold text-zinc-100">Would I make this exact same exit if yesterday had been +$50?</p><div className="mt-2 flex gap-2">{["YES", "NO"].map((answer) => <button key={answer} onClick={() => setPriorDay(answer)} className={`rounded border px-5 py-2 font-bold ${priorDay === answer ? "border-sky-400/50 bg-sky-400/10 text-sky-100" : "border-white/10 text-zinc-500"}`}>{answer}</button>)}</div></div><button disabled={!ready} onClick={() => finishTrade("Discretionary exit", discretionaryClassification, `P/L-hidden: ${pnlHidden}; prior-day test: ${priorDay}`)} className="rounded border border-red-400/35 bg-red-400/10 px-5 py-3 font-semibold text-red-100 disabled:opacity-30">RECORD DISCRETIONARY EXIT</button></section>}
    </div>
  );
}

function Timeline({ trade }) {
  return <section className="panel overflow-x-auto"><p className="section-label">Decision Timeline</p><table className="w-full min-w-[700px] text-left text-sm"><thead className="text-zinc-500"><tr className="border-b border-white/10"><th className="px-2 py-2">Time</th><th>Stage</th><th>State</th><th>Decision</th><th>Note</th></tr></thead><tbody>{trade.decisions.map((item) => <tr key={item.id} className="border-b border-white/5"><td className="px-2 py-3 font-mono text-xs text-zinc-500">{item.time}</td><td>{item.stage}</td><td>{item.state}</td><td className="font-semibold">{item.decision}</td><td className="text-zinc-500">{item.note || "—"}</td></tr>)}</tbody></table></section>;
}

function ReviewScreen({ trade, saveReviewNote, startNewTrade, exportTrade }) {
  const [note, setNote] = useState(trade.reviewNote || "");
  const structural = trade.exit?.classification !== "NONSTRUCTURAL";
  return <div className="space-y-4"><section className={`rounded border p-5 ${structural ? "border-emerald-400/25 bg-emerald-950/15" : "border-red-400/25 bg-red-950/15"}`}><p className="section-label">Execution Review · Broker Bound</p><h2 className="text-2xl font-semibold text-zinc-50">{trade.originalPlan.symbol} {trade.originalPlan.direction}</h2><p className="mt-1 text-sm text-zinc-400">{trade.originalPlan.setup} · entry {price(trade.broker.entryPrice)} · exit {price(trade.broker.exitPrice)} · {trade.exit?.classification}</p></section><CompactPlan trade={trade} /><Timeline trade={trade} /><section className="panel space-y-2"><Field label="Post-trade review note"><textarea className={textareaClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field><button onClick={() => saveReviewNote(note)} className="rounded border border-sky-400/25 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100">SAVE REVIEW NOTE</button></section><section className="flex flex-wrap gap-2"><button onClick={startNewTrade} className="flex items-center gap-2 rounded border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 font-semibold text-emerald-100"><RotateCcw size={16} /> START NEW TRADE</button><button onClick={() => exportTrade(trade)} className="flex items-center gap-2 rounded border border-white/10 px-4 py-2 font-semibold text-zinc-300"><Download size={16} /> EXPORT JSON</button></section></div>;
}

function HistoryScreen({ history, openTrade, exportAll }) {
  return <div className="space-y-4"><section className="panel flex items-center justify-between"><div><p className="section-label">Trade History</p><h2 className="text-xl font-semibold text-zinc-100">{history.length} archived trade{history.length === 1 ? "" : "s"}</h2></div><button onClick={exportAll} disabled={!history.length} className="flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-sm font-semibold text-zinc-300 disabled:opacity-30"><Download size={15} /> EXPORT ALL</button></section><section className="grid gap-3 md:grid-cols-2">{history.map((trade) => <article key={trade.id} className="compact-card"><div className="flex items-start justify-between"><div><p className="section-label">{trade.completedAt ? new Date(trade.completedAt).toLocaleString() : "Saved trade"}</p><h3 className="text-lg font-semibold text-zinc-100">{trade.originalPlan?.symbol} {trade.originalPlan?.direction}</h3><p className="mt-1 text-sm text-zinc-500">{trade.exit?.classification}</p></div><Archive size={18} className="text-zinc-600" /></div><button onClick={() => openTrade(trade)} className="mt-3 rounded border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-100">OPEN REVIEW</button></article>)}</section></div>;
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ExecutionV22({ broker }) {
  const [store, setStore] = useState(initialStore);
  const trade = store.activeTrade;
  const brokerState = broker?.state;
  const executions = brokerState?.executions || [];
  const positions = brokerState?.positions || [];
  const symbol = trade.originalPlan?.symbol;
  const brokerPosition = symbol ? positions.find((item) => item.symbol === symbol) : null;

  useEffect(() => { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }, [store]);

  const updateTrade = (updater) => setStore((current) => ({ ...current, activeTrade: typeof updater === "function" ? updater(current.activeTrade) : updater }));

  useEffect(() => {
    if (trade.phase !== "AWAITING_ENTRY" || !trade.originalPlan || !trade.armedAt) return;
    const armedMs = Date.parse(trade.armedAt);
    const expectedInstruction = openingInstruction(trade.originalPlan.direction);
    const openings = executions
      .filter((event) => event.symbol === trade.originalPlan.symbol && String(event.positionEffect).toUpperCase() === "OPENING" && event.instruction === expectedInstruction && Date.parse(event.detectedAt) >= armedMs)
      .sort((a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt));
    if (!openings.length) return;

    const entry = weightedVwap(openings);
    const first = openings[0];
    const currentPosition = positions.find((item) => item.symbol === trade.originalPlan.symbol);
    const quantity = currentPosition ? Math.abs(currentPosition.quantity) : entry.quantity;
    const averagePrice = currentPosition?.averagePrice ?? entry.price;

    setStore((current) => {
      if (current.activeTrade.phase !== "AWAITING_ENTRY") return current;
      let next = {
        ...current.activeTrade,
        phase: "LIVE",
        currentState: "VALID",
        broker: {
          ...current.activeTrade.broker,
          account: currentPosition?.account || first.account,
          entryPrice: averagePrice,
          entryQuantity: quantity,
          peakQuantity: quantity,
          currentQuantity: quantity,
          currentAveragePrice: averagePrice,
          entryDetectedAt: first.detectedAt,
        },
      };
      next = addDecision(next, "TRIGGER", "VALID", "BROKER ENTRY DETECTED", `${first.instruction} ${entry.quantity} @ ${price(entry.price)}; broker position ${quantity} @ ${price(averagePrice)}`);
      return { ...current, activeTrade: next };
    });
  }, [trade.phase, trade.armedAt, trade.originalPlan, executions, positions]);

  useEffect(() => {
    if (trade.phase !== "LIVE" || !trade.originalPlan || !trade.broker.entryDetectedAt) return;
    const entryMs = Date.parse(trade.broker.entryDetectedAt);
    const currentPosition = positions.find((item) => item.symbol === trade.originalPlan.symbol);

    if (currentPosition) {
      const qty = Math.abs(currentPosition.quantity);
      const avg = currentPosition.averagePrice;
      if (qty !== trade.broker.currentQuantity || avg !== trade.broker.currentAveragePrice) {
        setStore((current) => {
          if (current.activeTrade.phase !== "LIVE") return current;
          return {
            ...current,
            activeTrade: {
              ...current.activeTrade,
              broker: {
                ...current.activeTrade.broker,
                account: currentPosition.account,
                currentQuantity: qty,
                currentAveragePrice: avg,
                entryPrice: avg,
                peakQuantity: Math.max(Number(current.activeTrade.broker.peakQuantity || 0), qty),
              },
            },
          };
        });
      }
    }

    const terminalEvents = executions
      .filter((event) => event.symbol === trade.originalPlan.symbol && Date.parse(event.detectedAt) >= entryMs && (event.stateEvent === "FLAT" || event.stateEvent === "REVERSAL"))
      .sort((a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt));
    if (!terminalEvents.length) return;

    const terminal = terminalEvents[0];
    const terminalMs = Date.parse(terminal.detectedAt);
    const closings = executions.filter((event) => event.symbol === trade.originalPlan.symbol && Date.parse(event.detectedAt) >= entryMs && Date.parse(event.detectedAt) <= terminalMs && (String(event.positionEffect).toUpperCase() === "CLOSING" || event.stateEvent === "REVERSAL"));
    const exit = weightedVwap(closings);

    setStore((current) => {
      if (current.activeTrade.phase !== "LIVE") return current;
      let next = {
        ...current.activeTrade,
        phase: "EXIT",
        broker: {
          ...current.activeTrade.broker,
          currentQuantity: 0,
          exitPrice: exit.price ?? terminal.price,
          exitQuantity: exit.quantity || Math.abs(terminal.previousQuantity || terminal.quantity || 0),
          flatDetectedAt: terminal.detectedAt,
        },
      };
      next = addDecision(next, "EXIT", current.activeTrade.currentState, "BROKER FLAT DETECTED", `${terminal.stateEvent}; observed exit VWAP ${price(exit.price ?? terminal.price)}`);
      return { ...current, activeTrade: next };
    });
  }, [trade.phase, trade.originalPlan, trade.broker.entryDetectedAt, trade.broker.currentQuantity, trade.broker.currentAveragePrice, executions, positions]);

  const finishTrade = (reason, classification, note) => setStore((current) => {
    let finalTrade = addDecision(current.activeTrade, "EXIT", current.activeTrade.currentState, classification === "NONSTRUCTURAL" ? "NONSTRUCTURAL EXIT" : reason.toUpperCase(), note);
    finalTrade = { ...finalTrade, phase: "REVIEW", completedAt: new Date().toISOString(), exit: { time: nowLabel(), reason, classification, note } };
    return { ...current, activeTrade: finalTrade, history: upsertHistory(current.history, finalTrade), view: "TRADE" };
  });

  const saveReviewNote = (reviewNote) => setStore((current) => {
    const updated = { ...current.activeTrade, reviewNote };
    return { ...current, activeTrade: updated, history: upsertHistory(current.history, updated) };
  });

  const startNewTrade = () => setStore((current) => ({ ...current, activeTrade: freshTrade(), view: "TRADE" }));
  const openTrade = (savedTrade) => setStore((current) => ({ ...current, activeTrade: savedTrade, view: "TRADE" }));

  return (
    <main className="px-3 py-4 text-zinc-100 md:px-5">
      <div className="mx-auto max-w-7xl space-y-3">
        <header className="rounded border border-white/10 bg-ink-850 p-3 shadow-terminal">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="section-label">ExecutionOS · V2.2</p><h1 className="text-xl font-semibold text-zinc-50">Broker-Aware Execution</h1><p className="mt-1 text-xs text-zinc-500">Think before entry. Trade in broker. ExecutionOS observes. Explain after exit.</p></div><div className="flex items-center gap-2"><button onClick={() => setStore((current) => ({ ...current, view: current.view === "HISTORY" ? "TRADE" : "HISTORY" }))} className="flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300"><History size={15} /> {store.view === "HISTORY" ? "BACK TO TRADE" : `HISTORY (${store.history.length})`}</button>{trade.phase === "LIVE" && <StatePill state={trade.currentState} />}</div></div>
          {store.view === "TRADE" && <div className="mt-3"><Chain phase={trade.phase} /></div>}
        </header>

        {store.view === "HISTORY" ? <HistoryScreen history={store.history} openTrade={openTrade} exportAll={() => downloadJson(store.history, "executionos-v22-history.json")} /> : <>
          {trade.phase === "PLAN" && <PlanScreen trade={trade} updateTrade={updateTrade} />}
          {trade.phase === "RISK" && <RiskScreen trade={trade} updateTrade={updateTrade} broker={broker} />}
          {trade.phase === "AWAITING_ENTRY" && <AwaitingEntryScreen trade={trade} broker={broker} cancelArm={() => updateTrade((current) => ({ ...current, phase: "RISK", armedAt: null }))} />}
          {trade.phase === "LIVE" && <LiveScreen trade={trade} updateTrade={updateTrade} brokerPosition={brokerPosition} />}
          {trade.phase === "EXIT" && <ExitScreen trade={trade} finishTrade={finishTrade} />}
          {trade.phase === "REVIEW" && <ReviewScreen trade={trade} saveReviewNote={saveReviewNote} startNewTrade={startNewTrade} exportTrade={(item) => downloadJson(item, `executionos-${item.originalPlan.symbol}-${item.id}.json`)} />}
        </>}
      </div>
    </main>
  );
}
