import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  History,
  LockKeyhole,
  Radio,
  RotateCcw,
  ShieldCheck,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";

const STORE_KEY = "execution-v23-store";
const FUTURES = new Set(["MES", "MNQ", "MCL", "ES", "NQ", "CL"]);
const CHAIN = ["READ", "PLAN", "RISK", "ARM", "TRIGGER", "HOLD", "UPDATE", "EXIT", "REVIEW"];

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

const PLAN_FIELDS = [
  ["Symbol", "symbol"],
  ["Direction", "direction"],
  ["Setup", "setup"],
  ["Timeframe", "timeframe"],
  ["Thesis", "thesis"],
  ["Trigger", "trigger"],
  ["Invalidation", "invalidation"],
  ["Structural Stop", "structuralStop"],
  ["Target", "target"],
  ["Management Plan", "management"],
];

function freshDraft() {
  return {
    phase: "PLAN",
    plan: { ...emptyPlan },
    originalPlan: null,
    risk: { expectedEntry: "", intendedSize: "" },
  };
}

function initialStore() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // Fall through to a clean V2.3 store.
  }
  return { draft: freshDraft(), candidates: [], liveTrades: [], history: [], view: "TRADE" };
}

function sourceFor(symbol) {
  return FUTURES.has(String(symbol || "").toUpperCase()) ? "NINJATRADER" : "SCHWAB";
}

function openingInstruction(direction) {
  return direction === "SHORT" ? "SELL_SHORT" : "BUY";
}

function missingPlanFields(plan) {
  return PLAN_FIELDS.filter(([, key]) => !String(plan?.[key] ?? "").trim()).map(([label]) => label);
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

function price(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function nowIso() {
  return new Date().toISOString();
}

function nowLabel() {
  return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
}

function decision(stage, state, action, note = "") {
  return { id: `${Date.now()}-${Math.random()}`, timestamp: nowIso(), time: nowLabel(), stage, state, action, note };
}

function weightedVwap(events) {
  const totalQty = events.reduce((sum, event) => sum + Number(event.quantity || 0), 0);
  if (!totalQty) return { quantity: 0, price: null };
  const totalValue = events.reduce((sum, event) => sum + Number(event.quantity || 0) * Number(event.price || 0), 0);
  return { quantity: totalQty, price: totalValue / totalQty };
}

function plannedRisk(trade) {
  const entry = Number(trade?.risk?.expectedEntry);
  const stop = Number(trade?.originalPlan?.structuralStop);
  const size = Number(trade?.risk?.intendedSize);
  if (![entry, stop, size].every(Number.isFinite)) return null;
  return Math.abs(entry - stop) * size;
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

function Chain({ active }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CHAIN.map((step) => (
        <div key={step} className={`rounded border px-2 py-1 font-mono text-[9px] font-semibold ${step === active ? "border-sky-400/40 bg-sky-400/10 text-sky-100" : "border-white/10 text-zinc-700"}`}>
          {step}
        </div>
      ))}
    </div>
  );
}

function PlanEditor({ draft, setDraft }) {
  const [validationMessage, setValidationMessage] = useState("");
  const plan = draft.plan;
  const missing = missingPlanFields(plan);
  const source = sourceFor(plan.symbol);
  const update = (key, value) => {
    setValidationMessage("");
    setDraft((current) => ({ ...current, plan: { ...current.plan, [key]: value } }));
  };

  const freeze = () => {
    const currentMissing = missingPlanFields(plan);
    if (currentMissing.length) {
      setValidationMessage(`Complete before freezing: ${currentMissing.join(", ")}.`);
      return;
    }
    setDraft((current) => ({
      ...current,
      phase: "RISK",
      originalPlan: { ...current.plan, symbol: current.plan.symbol.toUpperCase() },
    }));
  };

  return (
    <div className="space-y-4">
      <section className="panel">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="section-label">New Candidate · Pre-Entry Freeze</p>
            <h2 className="text-xl font-semibold text-zinc-100">Build the next setup without disturbing armed candidates.</h2>
            <p className="mt-1 text-sm text-zinc-500">Armed ideas remain listening while you plan additional symbols.</p>
          </div>
          <LockKeyhole className="text-sky-300" size={22} />
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <Field label="Symbol"><input className={inputClass} value={plan.symbol} onChange={(e) => update("symbol", e.target.value.toUpperCase())} placeholder="e.g. NVDA" /></Field>
          <Field label="Direction"><select className={inputClass} value={plan.direction} onChange={(e) => update("direction", e.target.value)}><option>LONG</option><option>SHORT</option></select></Field>
          <Field label="Setup"><input className={inputClass} value={plan.setup} onChange={(e) => update("setup", e.target.value)} placeholder="H2, MTR, breakout/retest…" /></Field>
          <Field label="Timeframe"><input className={inputClass} value={plan.timeframe} onChange={(e) => update("timeframe", e.target.value)} /></Field>
          <div className="rounded border border-white/10 bg-black/20 px-3 py-2"><p className="section-label">Execution Source</p><p className={`text-sm font-semibold ${source === "SCHWAB" ? "text-emerald-200" : "text-amber-200"}`}>{source}</p></div>
        </div>
      </section>

      {source === "NINJATRADER" && plan.symbol && <section className="rounded border border-amber-400/25 bg-amber-950/15 p-3 text-sm text-amber-100">{plan.symbol} is a futures instrument. NinjaTrader binding is not connected yet.</section>}

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="panel space-y-3">
          <Field label="Thesis" help="What exactly am I trading?"><textarea className={textareaClass} value={plan.thesis} onChange={(e) => update("thesis", e.target.value)} /></Field>
          <Field label="Trigger" help="What authorizes entry in ToS?"><textarea className={textareaClass} value={plan.trigger} onChange={(e) => update("trigger", e.target.value)} /></Field>
          <Field label="Invalidation" help="What proves the thesis wrong?"><textarea className={textareaClass} value={plan.invalidation} onChange={(e) => update("invalidation", e.target.value)} /></Field>
        </div>
        <div className="panel space-y-3">
          <Field label="Structural Stop"><input type="number" step="any" className={inputClass} value={plan.structuralStop} onChange={(e) => update("structuralStop", e.target.value)} /></Field>
          <Field label="Target"><textarea className={textareaClass} value={plan.target} onChange={(e) => update("target", e.target.value)} /></Field>
          <Field label="Management Plan"><textarea className={textareaClass} value={plan.management} onChange={(e) => update("management", e.target.value)} /></Field>
        </div>
      </section>

      <div className={`rounded border px-4 py-3 text-sm ${missing.length ? "border-amber-400/25 bg-amber-950/15 text-amber-100" : "border-emerald-400/25 bg-emerald-950/15 text-emerald-100"}`}>
        {missing.length ? `Still required: ${missing.join(", ")}.` : "READY TO FREEZE — this candidate can move to risk sizing."}
        {validationMessage && <p className="mt-1 font-semibold">{validationMessage}</p>}
      </div>
      <button type="button" onClick={freeze} className="w-full rounded border border-sky-400/40 bg-sky-400/10 px-4 py-3 font-semibold text-sky-100">FREEZE CANDIDATE → RISK</button>
    </div>
  );
}

function RiskEditor({ draft, broker, candidates, onBack, onArm, onDiscard }) {
  const plan = draft.originalPlan;
  const account = broker?.state?.accounts?.[0] || null;
  const positions = broker?.state?.positions || [];
  const existingPosition = positions.find((item) => item.symbol === plan.symbol);
  const duplicateCandidate = candidates.find((item) => item.originalPlan.symbol === plan.symbol);
  const source = sourceFor(plan.symbol);
  const [expectedEntry, setExpectedEntry] = useState(draft.risk.expectedEntry || "");
  const [intendedSize, setIntendedSize] = useState(draft.risk.intendedSize || "");

  const metrics = useMemo(() => {
    const entry = Number(expectedEntry);
    const stop = Number(plan.structuralStop);
    const size = Number(intendedSize);
    const maxRisk = Number(account?.maxRisk ?? Number(account?.equity) * 0.005);
    const distance = Math.abs(entry - stop);
    const risk = distance * size;
    const maxSize = distance > 0 && Number.isFinite(maxRisk) ? Math.floor(maxRisk / distance) : 0;
    return { entry, stop, size, maxRisk, distance, risk, maxSize };
  }, [expectedEntry, intendedSize, plan.structuralStop, account?.equity, account?.maxRisk]);

  const numbersReady = [metrics.entry, metrics.stop, metrics.size].every((value) => Number.isFinite(value) && value > 0) && metrics.distance > 0;
  const brokerReady = source === "SCHWAB" && broker?.connected && broker?.state?.status === "ARMED" && account;
  const allowed = brokerReady && numbersReady && !existingPosition && !duplicateCandidate && metrics.risk <= metrics.maxRisk;

  return (
    <div className="space-y-4">
      <section className="panel"><p className="section-label">Candidate Risk Permission</p><h2 className="text-xl font-semibold text-zinc-100">{plan.symbol} {plan.direction} · size this setup, then add it to the armed board.</h2></section>
      <section className="grid gap-3 md:grid-cols-4">
        <div className="compact-card"><p className="section-label">Broker Equity</p><p className="text-2xl font-semibold">{money(account?.equity)}</p></div>
        <div className="compact-card"><p className="section-label">0.5% Maximum</p><p className="text-2xl font-semibold text-sky-100">{money(metrics.maxRisk)}</p></div>
        <Field label="Expected Entry · sizing reference"><input type="number" step="any" className={inputClass} value={expectedEntry} onChange={(e) => setExpectedEntry(e.target.value)} /></Field>
        <Field label="Intended Size"><input type="number" min="1" step="1" className={inputClass} value={intendedSize} onChange={(e) => setIntendedSize(e.target.value)} /></Field>
      </section>
      <section className="grid gap-3 md:grid-cols-4">
        <div className="compact-card"><p className="section-label">Structural Stop</p><p className="text-xl font-semibold text-red-200">{plan.structuralStop}</p></div>
        <div className="compact-card"><p className="section-label">Stop Distance</p><p className="text-xl font-semibold">{numbersReady ? price(metrics.distance) : "—"}</p></div>
        <div className="compact-card"><p className="section-label">Planned Risk</p><p className="text-xl font-semibold">{numbersReady ? money(metrics.risk) : "—"}</p></div>
        <div className="compact-card"><p className="section-label">Maximum Shares</p><p className="text-xl font-semibold">{numbersReady ? metrics.maxSize : "—"}</p></div>
      </section>
      {existingPosition && <section className="rounded border border-amber-400/25 bg-amber-950/15 p-3 text-sm text-amber-100">{plan.symbol} is already held in Schwab, so automatic fresh-trade binding is blocked.</section>}
      {duplicateCandidate && <section className="rounded border border-amber-400/25 bg-amber-950/15 p-3 text-sm text-amber-100">{plan.symbol} is already armed. One armed candidate per symbol avoids ambiguous fill binding.</section>}
      <div className={`rounded border p-4 ${allowed ? "border-emerald-400/25 bg-emerald-950/15" : "border-amber-400/25 bg-amber-950/15"}`}>
        <div className="flex gap-3">{allowed ? <ShieldCheck className="text-emerald-300" /> : <AlertTriangle className="text-amber-300" />}<div><p className="font-semibold">{allowed ? "RISK PERMITTED" : "NOT YET PERMITTED"}</p><p className="mt-1 text-sm text-zinc-400">Arming listens for a fill; it does not place or reserve an order.</p></div></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!allowed} onClick={() => onArm(expectedEntry, intendedSize)} className="flex-1 rounded border border-emerald-400/40 bg-emerald-400/10 px-4 py-3 font-semibold text-emerald-100 disabled:opacity-30">ARM CANDIDATE + START NEXT PLAN</button>
        <button type="button" onClick={onBack} className="rounded border border-white/10 px-4 py-3 text-sm font-semibold text-zinc-400">BACK TO PLAN</button>
        <button type="button" onClick={onDiscard} className="rounded border border-red-400/20 px-4 py-3 text-sm font-semibold text-red-300">DISCARD CANDIDATE</button>
      </div>
    </div>
  );
}

function CandidateCard({ trade, account, brokerConnected, onEdit, onDiscard }) {
  const plan = trade.originalPlan;
  const risk = plannedRisk(trade);
  return (
    <article className="overflow-hidden rounded border border-sky-400/20 bg-ink-850 shadow-terminal">
      <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="section-label">Armed Candidate</p>
          <div className="flex items-baseline gap-2"><h3 className="text-2xl font-bold">{plan.symbol}</h3><span className={plan.direction === "LONG" ? "font-bold text-emerald-300" : "font-bold text-red-300"}>{plan.direction}</span></div>
          <p className="mt-1 text-xs text-zinc-500">{plan.setup} · {plan.timeframe}</p>
        </div>
        <div className={`flex items-center gap-2 text-[11px] font-semibold ${brokerConnected ? "text-emerald-300" : "text-red-300"}`}><span className={`h-2 w-2 rounded-full ${brokerConnected ? "bg-emerald-300" : "bg-red-300"}`} />{brokerConnected ? "LISTENING" : "OFFLINE"}</div>
      </header>
      <div className="grid grid-cols-2 border-b border-white/10 text-sm lg:grid-cols-5">
        <div className="p-3"><p className="section-label">Expected</p><p className="font-semibold">{price(trade.risk.expectedEntry)}</p></div>
        <div className="p-3"><p className="section-label">Stop</p><p className="font-semibold text-red-200">{price(plan.structuralStop)}</p></div>
        <div className="p-3"><p className="section-label">Shares</p><p className="font-semibold">{trade.risk.intendedSize}</p></div>
        <div className="p-3"><p className="section-label">Risk</p><p className="font-semibold">{money(risk)}</p></div>
        <div className="p-3"><p className="section-label">0.5% Max</p><p className="font-semibold text-sky-100">{money(account?.maxRisk)}</p></div>
      </div>
      <div className="grid gap-3 p-4 text-sm lg:grid-cols-2">
        <div><p className="section-label">Trigger</p><p className="font-semibold text-sky-100">{plan.trigger}</p><p className="mt-3 section-label">Invalidation</p><p className="font-semibold text-red-200">{plan.invalidation}</p></div>
        <div><p className="section-label">Target</p><p className="text-zinc-300">{plan.target}</p><p className="mt-3 section-label">Management</p><p className="text-zinc-300">{plan.management}</p></div>
      </div>
      <footer className="flex gap-2 border-t border-white/10 px-4 py-3">
        <button type="button" onClick={() => onEdit(trade.id)} className="rounded border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300">DISARM + EDIT</button>
        <button type="button" onClick={() => onDiscard(trade.id)} className="flex items-center gap-1 rounded border border-red-400/20 px-3 py-2 text-xs font-semibold text-red-300"><Trash2 size={13} /> DISCARD</button>
      </footer>
    </article>
  );
}

function CandidateBoard({ candidates, broker, onEdit, onDiscard }) {
  if (!candidates.length) return null;
  const account = broker?.state?.accounts?.[0] || null;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between"><div><p className="section-label">Armed Candidate Board</p><h2 className="text-lg font-semibold">{candidates.length} setup{candidates.length === 1 ? "" : "s"} listening for ToS entries</h2></div><Radio className="text-sky-300" size={20} /></div>
      <div className="grid gap-3 xl:grid-cols-2">{candidates.map((trade) => <CandidateCard key={trade.id} trade={trade} account={account} brokerConnected={broker?.connected} onEdit={onEdit} onDiscard={onDiscard} />)}</div>
    </section>
  );
}

function StatePill({ state }) {
  const cls = state === "VALID" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : state === "THREATENED" ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : "border-red-400/30 bg-red-400/10 text-red-200";
  return <span className={`rounded-full border px-3 py-1 font-mono text-[11px] font-bold ${cls}`}>{state}</span>;
}

function LiveTradeCard({ trade, brokerPosition, account, onState, onClassify }) {
  const plan = trade.originalPlan;
  if (trade.phase === "EXIT") {
    return (
      <article className="rounded border border-sky-400/25 bg-ink-850 p-4 shadow-terminal">
        <p className="section-label">Broker Exit Detected</p>
        <h3 className="text-2xl font-bold">{plan.symbol} is FLAT</h3>
        <p className="mt-1 text-sm text-zinc-400">Entry {price(trade.broker.entryPrice)} · Exit VWAP {price(trade.broker.exitPrice)} · Peak qty {trade.broker.peakQuantity}</p>
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

  const qty = brokerPosition ? Math.abs(brokerPosition.quantity) : trade.broker.currentQuantity;
  const avg = brokerPosition?.averagePrice ?? trade.broker.currentAveragePrice ?? trade.broker.entryPrice;
  const actualRisk = Number.isFinite(Number(avg)) && Number.isFinite(Number(plan.structuralStop)) && Number.isFinite(Number(qty)) ? Math.abs(Number(avg) - Number(plan.structuralStop)) * Number(qty) : null;
  const riskBreach = Number.isFinite(actualRisk) && Number.isFinite(Number(account?.maxRisk)) && actualRisk > Number(account.maxRisk);

  return (
    <article className="rounded border border-emerald-400/20 bg-ink-850 p-4 shadow-terminal">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="section-label">Broker-Bound Live Trade</p><div className="flex items-baseline gap-2"><h3 className="text-2xl font-bold">{plan.symbol}</h3><span className={plan.direction === "LONG" ? "font-bold text-emerald-300" : "font-bold text-red-300"}>{plan.direction}</span></div><p className="text-xs text-zinc-500">{plan.setup} · {plan.timeframe}</p></div><StatePill state={trade.currentState} /></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><div className="compact-card"><p className="section-label">Actual Avg</p><p className="text-lg font-semibold">{price(avg)}</p></div><div className="compact-card"><p className="section-label">Current Qty</p><p className="text-lg font-semibold">{qty ?? "—"}</p></div><div className="compact-card"><p className="section-label">Peak Qty</p><p className="text-lg font-semibold">{trade.broker.peakQuantity ?? "—"}</p></div><div className="compact-card"><p className="section-label">Actual Stop Risk</p><p className={`text-lg font-semibold ${riskBreach ? "text-red-300" : "text-zinc-100"}`}>{money(actualRisk)}</p></div><div className="compact-card"><p className="section-label">0.5% Max</p><p className="text-lg font-semibold text-sky-100">{money(account?.maxRisk)}</p></div></div>
      {riskBreach && <div className="mt-3 rounded border border-red-400/30 bg-red-950/20 p-3 text-sm font-semibold text-red-200">Actual fill/size implies risk above the current 0.5% budget. Do not tighten structure to fix sizing.</div>}
      <div className="mt-4 grid gap-2 md:grid-cols-3"><button onClick={() => onState(trade.id, "VALID")} className="rounded border border-emerald-400/30 bg-emerald-400/10 p-3 text-left font-bold text-emerald-100"><CheckCircle2 className="mb-2" size={20} />VALID — HOLD</button><button onClick={() => onState(trade.id, "THREATENED")} className="rounded border border-amber-400/30 bg-amber-400/10 p-3 text-left font-bold text-amber-100"><AlertTriangle className="mb-2" size={20} />THREATENED</button><button onClick={() => onState(trade.id, "INVALID")} className="rounded border border-red-400/30 bg-red-400/10 p-3 text-left font-bold text-red-100"><XCircle className="mb-2" size={20} />INVALID</button></div>
    </article>
  );
}

function LiveBoard({ liveTrades, broker, onState, onClassify }) {
  if (!liveTrades.length) return null;
  const account = broker?.state?.accounts?.[0] || null;
  const positions = broker?.state?.positions || [];
  return (
    <section className="space-y-3"><div><p className="section-label">Live Execution Board</p><h2 className="text-lg font-semibold">{liveTrades.filter((trade) => trade.phase === "LIVE").length} live · {liveTrades.filter((trade) => trade.phase === "EXIT").length} awaiting exit classification</h2></div><div className="grid gap-3 xl:grid-cols-2">{liveTrades.map((trade) => <LiveTradeCard key={trade.id} trade={trade} brokerPosition={positions.find((item) => item.symbol === trade.originalPlan.symbol)} account={account} onState={onState} onClassify={onClassify} />)}</div></section>
  );
}

function HistoryView({ history, onBack }) {
  return <div className="space-y-3"><div className="flex items-center justify-between"><div><p className="section-label">Execution History</p><h2 className="text-xl font-semibold">{history.length} completed trade{history.length === 1 ? "" : "s"}</h2></div><button onClick={onBack} className="rounded border border-white/10 px-3 py-2 text-sm font-semibold text-zinc-300">BACK TO TRADE</button></div><div className="grid gap-3 md:grid-cols-2">{history.map((trade) => <article key={trade.id} className="compact-card"><p className="section-label">{trade.completedAt ? new Date(trade.completedAt).toLocaleString() : "Completed"}</p><h3 className="text-lg font-semibold">{trade.originalPlan.symbol} {trade.originalPlan.direction}</h3><p className="mt-1 text-sm text-zinc-500">{trade.exit?.classification} · {trade.exit?.reason}</p></article>)}</div></div>;
}

export default function ExecutionV23({ broker }) {
  const [store, setStore] = useState(initialStore);
  const executions = broker?.state?.executions || [];
  const positions = broker?.state?.positions || [];

  useEffect(() => { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }, [store]);

  const setDraft = (updater) => setStore((current) => ({ ...current, draft: typeof updater === "function" ? updater(current.draft) : updater }));

  const armCandidate = (expectedEntry, intendedSize) => setStore((current) => {
    const plan = current.draft.originalPlan;
    const candidate = {
      id: `${Date.now()}-${plan.symbol}`,
      phase: "ARMED",
      createdAt: nowIso(),
      armedAt: nowIso(),
      originalPlan: plan,
      risk: { expectedEntry, intendedSize },
      currentState: "VALID",
      broker: { account: null, entryPrice: null, entryQuantity: null, peakQuantity: null, currentQuantity: null, currentAveragePrice: null, entryDetectedAt: null, exitPrice: null, exitQuantity: null, flatDetectedAt: null },
      decisions: [decision("PLAN", "—", "PLAN FROZEN", `${plan.symbol} ${plan.direction} — ${plan.setup}`), decision("ARM", "—", "CANDIDATE ARMED", "Waiting for matching ToS opening fill")],
    };
    return { ...current, candidates: [...current.candidates, candidate], draft: freshDraft() };
  });

  const discardCandidate = (id) => {
    if (!window.confirm("Discard this unfilled armed candidate? This does not affect Schwab or any order.")) return;
    setStore((current) => ({ ...current, candidates: current.candidates.filter((item) => item.id !== id) }));
  };

  const editCandidate = (id) => setStore((current) => {
    const candidate = current.candidates.find((item) => item.id === id);
    if (!candidate) return current;
    return {
      ...current,
      candidates: current.candidates.filter((item) => item.id !== id),
      draft: { phase: "PLAN", plan: { ...candidate.originalPlan }, originalPlan: { ...candidate.originalPlan }, risk: { ...candidate.risk } },
    };
  });

  useEffect(() => {
    if (!store.candidates.length || !executions.length) return;
    const matches = [];
    for (const candidate of store.candidates) {
      const armedMs = Date.parse(candidate.armedAt);
      const expectedInstruction = openingInstruction(candidate.originalPlan.direction);
      const opening = executions
        .filter((event) => event.symbol === candidate.originalPlan.symbol && String(event.positionEffect).toUpperCase() === "OPENING" && event.instruction === expectedInstruction && Date.parse(event.detectedAt) >= armedMs)
        .sort((a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt))[0];
      if (opening) matches.push({ candidate, opening });
    }
    if (!matches.length) return;

    setStore((current) => {
      let candidates = [...current.candidates];
      let liveTrades = [...current.liveTrades];
      for (const { candidate, opening } of matches) {
        if (!candidates.some((item) => item.id === candidate.id)) continue;
        const position = positions.find((item) => item.symbol === candidate.originalPlan.symbol);
        const qty = position ? Math.abs(position.quantity) : Number(opening.quantity);
        const avg = position?.averagePrice ?? Number(opening.price);
        const live = {
          ...candidate,
          phase: "LIVE",
          currentState: "VALID",
          broker: { ...candidate.broker, account: position?.account || opening.account, entryPrice: avg, entryQuantity: qty, peakQuantity: qty, currentQuantity: qty, currentAveragePrice: avg, entryDetectedAt: opening.detectedAt },
          decisions: [...candidate.decisions, decision("TRIGGER", "VALID", "BROKER ENTRY DETECTED", `${opening.instruction} ${opening.quantity} @ ${price(opening.price)}`)],
        };
        candidates = candidates.filter((item) => item.id !== candidate.id);
        liveTrades.push(live);
      }
      return { ...current, candidates, liveTrades };
    });
  }, [store.candidates, executions, positions]);

  useEffect(() => {
    if (!store.liveTrades.length) return;
    let changed = false;
    const nextTrades = store.liveTrades.map((trade) => {
      if (trade.phase !== "LIVE" || !trade.broker.entryDetectedAt) return trade;
      const position = positions.find((item) => item.symbol === trade.originalPlan.symbol);
      let next = trade;
      if (position) {
        const qty = Math.abs(position.quantity);
        const avg = position.averagePrice;
        if (qty !== trade.broker.currentQuantity || avg !== trade.broker.currentAveragePrice) {
          changed = true;
          next = { ...next, broker: { ...next.broker, account: position.account, currentQuantity: qty, currentAveragePrice: avg, peakQuantity: Math.max(Number(next.broker.peakQuantity || 0), qty) } };
        }
      }
      const entryMs = Date.parse(trade.broker.entryDetectedAt);
      const terminal = executions
        .filter((event) => event.symbol === trade.originalPlan.symbol && Date.parse(event.detectedAt) >= entryMs && (event.stateEvent === "FLAT" || event.stateEvent === "REVERSAL"))
        .sort((a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt))[0];
      if (!terminal) return next;
      const terminalMs = Date.parse(terminal.detectedAt);
      const closings = executions.filter((event) => event.symbol === trade.originalPlan.symbol && Date.parse(event.detectedAt) >= entryMs && Date.parse(event.detectedAt) <= terminalMs && String(event.positionEffect).toUpperCase() === "CLOSING");
      const exit = weightedVwap(closings);
      changed = true;
      return { ...next, phase: "EXIT", broker: { ...next.broker, currentQuantity: 0, exitPrice: exit.price ?? terminal.price, exitQuantity: exit.quantity || Math.abs(terminal.previousQuantity || terminal.quantity || 0), flatDetectedAt: terminal.detectedAt }, decisions: [...next.decisions, decision("EXIT", next.currentState, "BROKER FLAT DETECTED", `${terminal.stateEvent}; exit VWAP ${price(exit.price ?? terminal.price)}`)] };
    });
    if (changed) setStore((current) => ({ ...current, liveTrades: nextTrades }));
  }, [store.liveTrades, executions, positions]);

  const updateState = (id, state) => setStore((current) => ({ ...current, liveTrades: current.liveTrades.map((trade) => trade.id === id ? { ...trade, currentState: state, decisions: [...trade.decisions, decision(state === "VALID" ? "HOLD" : "UPDATE", state, state === "VALID" ? "HOLD — VALID" : state, state === "VALID" ? "Nothing requires action." : "State updated from chart structure.")] } : trade) }));

  const classifyExit = (id, reason, classification) => setStore((current) => {
    const trade = current.liveTrades.find((item) => item.id === id);
    if (!trade) return current;
    const completed = { ...trade, phase: "REVIEW", completedAt: nowIso(), exit: { reason, classification, time: nowLabel() }, decisions: [...trade.decisions, decision("EXIT", trade.currentState, reason.toUpperCase(), classification)] };
    return { ...current, liveTrades: current.liveTrades.filter((item) => item.id !== id), history: [completed, ...current.history] };
  });

  const activeStep = store.draft.phase === "RISK" ? "RISK" : "PLAN";
  const liveCount = store.liveTrades.filter((trade) => trade.phase === "LIVE").length;

  return (
    <main className="px-3 py-4 text-zinc-100 md:px-5">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded border border-white/10 bg-ink-850 p-3 shadow-terminal">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="section-label">ExecutionOS · V2.3</p><h1 className="text-xl font-semibold">Multi-Candidate Broker-Aware Execution</h1><p className="mt-1 text-xs text-zinc-500">Plan many. Arm many. Trade selectively. ExecutionOS binds only to actual broker fills.</p></div>
            <div className="flex items-center gap-2"><span className="rounded border border-sky-400/20 px-3 py-2 text-xs font-semibold text-sky-100">ARMED {store.candidates.length}</span><span className="rounded border border-emerald-400/20 px-3 py-2 text-xs font-semibold text-emerald-100">LIVE {liveCount}</span><button onClick={() => setStore((current) => ({ ...current, view: current.view === "HISTORY" ? "TRADE" : "HISTORY" }))} className="flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300"><History size={14} /> HISTORY ({store.history.length})</button></div>
          </div>
          {store.view === "TRADE" && <div className="mt-3"><Chain active={activeStep} /></div>}
        </header>

        {store.view === "HISTORY" ? <HistoryView history={store.history} onBack={() => setStore((current) => ({ ...current, view: "TRADE" }))} /> : <>
          {liveCount > 2 && <section className="rounded border border-red-400/30 bg-red-950/20 p-3 font-semibold text-red-200">More than two instruments are live. This exceeds the ExecutionOS two-live-instrument guardrail.</section>}
          <LiveBoard liveTrades={store.liveTrades} broker={broker} onState={updateState} onClassify={classifyExit} />
          <CandidateBoard candidates={store.candidates} broker={broker} onEdit={editCandidate} onDiscard={discardCandidate} />
          <section className="border-t border-white/10 pt-5">
            {store.draft.phase === "PLAN" ? <PlanEditor draft={store.draft} setDraft={setDraft} /> : <RiskEditor draft={store.draft} broker={broker} candidates={store.candidates} onBack={() => setDraft((current) => ({ ...current, phase: "PLAN" }))} onArm={armCandidate} onDiscard={() => { if (window.confirm("Discard this unfilled candidate and start a new plan?")) setDraft(freshDraft()); }} />}
          </section>
        </>}
      </div>
    </main>
  );
}
