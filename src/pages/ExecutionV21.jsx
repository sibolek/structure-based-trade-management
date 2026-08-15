import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  History,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Target,
  XCircle,
  Zap,
} from "lucide-react";

const STORE_KEY = "execution-v21-store";
const OLD_TRADE_KEY = "execution-v2-active-trade";
const CHAIN = ["READ", "PLAN", "TRIGGER", "RISK", "HOLD", "UPDATE", "EXIT", "REVIEW"];

const emptyPlan = {
  symbol: "MES",
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

const emptyRisk = {
  accountEquity: "",
  entry: "",
  stop: "",
  size: "1",
  pointValue: "5",
};

function freshTrade() {
  return {
    id: null,
    createdAt: null,
    completedAt: null,
    phase: "PLAN",
    plan: { ...emptyPlan },
    originalPlan: null,
    risk: { ...emptyRisk },
    currentState: "VALID",
    decisions: [],
    exit: null,
    reviewNote: "",
  };
}

function initialStore() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) return JSON.parse(saved);

    const oldTrade = localStorage.getItem(OLD_TRADE_KEY);
    if (oldTrade) {
      return { activeTrade: JSON.parse(oldTrade), history: [], view: "TRADE" };
    }
  } catch {
    // Fall through to a clean store.
  }
  return { activeTrade: freshTrade(), history: [], view: "TRADE" };
}

function nowLabel() {
  return new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
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

const inputClass =
  "w-full rounded border border-white/10 bg-black/25 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-sky-400/50";
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
  const activeMap = { PLAN: "PLAN", RISK: "RISK", LIVE: "HOLD", REVIEW: "REVIEW" };
  const active = activeMap[phase] || "PLAN";
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

function PlanScreen({ trade, updateTrade }) {
  const plan = trade.plan;
  const required = Object.keys(emptyPlan);
  const canArm = required.every((key) => String(plan[key] ?? "").trim());
  const update = (key, value) => updateTrade((current) => ({ ...current, plan: { ...current.plan, [key]: value } }));

  const arm = () => {
    if (!canArm) return;
    updateTrade((current) => {
      const frozen = { ...current.plan };
      let next = {
        ...current,
        id: current.id || `${Date.now()}`,
        createdAt: current.createdAt || new Date().toISOString(),
        phase: "RISK",
        originalPlan: frozen,
        risk: {
          ...current.risk,
          stop: frozen.structuralStop,
          pointValue: frozen.symbol.toUpperCase() === "MNQ" ? "2" : frozen.symbol.toUpperCase() === "MES" ? "5" : current.risk.pointValue,
        },
      };
      return addDecision(next, "PLAN", "—", "PLAN FROZEN", `${frozen.symbol} ${frozen.direction} — ${frozen.setup}`);
    });
  };

  return (
    <div className="space-y-4">
      <section className="panel">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="section-label">Pre-Entry Freeze</p>
            <h2 className="text-xl font-semibold text-zinc-100">Do the thinking before the trigger</h2>
            <p className="mt-1 text-sm text-zinc-500">Typing belongs here—not while a 2-minute trade is moving.</p>
          </div>
          <LockKeyhole className="text-sky-300" size={22} />
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Symbol"><input className={inputClass} value={plan.symbol} onChange={(e) => update("symbol", e.target.value.toUpperCase())} /></Field>
          <Field label="Direction"><select className={inputClass} value={plan.direction} onChange={(e) => update("direction", e.target.value)}><option>LONG</option><option>SHORT</option></select></Field>
          <Field label="Setup"><input className={inputClass} value={plan.setup} onChange={(e) => update("setup", e.target.value)} placeholder="H2, MTR, failed breakout…" /></Field>
          <Field label="Timeframe"><input className={inputClass} value={plan.timeframe} onChange={(e) => update("timeframe", e.target.value)} /></Field>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="panel space-y-3">
          <Field label="Thesis" help="What exactly am I trading?"><textarea className={textareaClass} value={plan.thesis} onChange={(e) => update("thesis", e.target.value)} /></Field>
          <Field label="Trigger" help="What authorizes entry?"><textarea className={textareaClass} value={plan.trigger} onChange={(e) => update("trigger", e.target.value)} /></Field>
          <Field label="Invalidation" help="What proves the thesis wrong?"><textarea className={textareaClass} value={plan.invalidation} onChange={(e) => update("invalidation", e.target.value)} /></Field>
        </div>
        <div className="panel space-y-3">
          <Field label="Structural Stop"><input className={inputClass} value={plan.structuralStop} onChange={(e) => update("structuralStop", e.target.value)} /></Field>
          <Field label="Target"><textarea className={textareaClass} value={plan.target} onChange={(e) => update("target", e.target.value)} /></Field>
          <Field label="Management Plan"><textarea className={textareaClass} value={plan.management} onChange={(e) => update("management", e.target.value)} /></Field>
        </div>
      </section>

      <button type="button" disabled={!canArm} onClick={arm} className="w-full rounded border border-sky-400/40 bg-sky-400/10 px-4 py-3 font-semibold text-sky-100 disabled:opacity-30">
        ARM TRADE — FREEZE PLAN
      </button>
    </div>
  );
}

function RiskScreen({ trade, updateTrade }) {
  const risk = trade.risk;
  const update = (key, value) => updateTrade((current) => ({ ...current, risk: { ...current.risk, [key]: value } }));
  const metrics = useMemo(() => {
    const equity = Number(risk.accountEquity);
    const entry = Number(risk.entry);
    const stop = Number(risk.stop);
    const size = Number(risk.size);
    const pointValue = Number(risk.pointValue);
    const distance = Math.abs(entry - stop);
    const plannedRisk = distance * size * pointValue;
    const maxRisk = equity * 0.005;
    const maxSize = distance > 0 && pointValue > 0 ? Math.floor(maxRisk / (distance * pointValue)) : 0;
    return { equity, entry, stop, size, pointValue, distance, plannedRisk, maxRisk, maxSize };
  }, [risk]);
  const valid = [metrics.equity, metrics.entry, metrics.stop, metrics.size, metrics.pointValue].every((v) => Number.isFinite(v) && v > 0);
  const allowed = valid && metrics.distance > 0 && metrics.plannedRisk <= metrics.maxRisk;

  const enter = () => {
    if (!allowed) return;
    updateTrade((current) => {
      let next = { ...current, phase: "LIVE", currentState: "VALID" };
      next = addDecision(next, "RISK", "—", "RISK APPROVED", `$${metrics.plannedRisk.toFixed(2)} risk; $${metrics.maxRisk.toFixed(2)} maximum`);
      return addDecision(next, "TRIGGER", "VALID", "ENTERED", `${current.originalPlan.symbol} ${current.originalPlan.direction} @ ${risk.entry}`);
    });
  };

  return (
    <div className="space-y-4">
      <section className="panel">
        <p className="section-label">Risk Permission</p>
        <h2 className="text-xl font-semibold text-zinc-100">Structural stop first. Size second.</h2>
      </section>
      <section className="grid gap-3 md:grid-cols-5">
        <Field label="Account Equity"><input type="number" className={inputClass} value={risk.accountEquity} onChange={(e) => update("accountEquity", e.target.value)} /></Field>
        <Field label="Entry"><input type="number" step="any" className={inputClass} value={risk.entry} onChange={(e) => update("entry", e.target.value)} /></Field>
        <Field label="Structural Stop"><input type="number" step="any" className={inputClass} value={risk.stop} onChange={(e) => update("stop", e.target.value)} /></Field>
        <Field label="Size"><input type="number" min="1" className={inputClass} value={risk.size} onChange={(e) => update("size", e.target.value)} /></Field>
        <Field label="$ / Point / Unit"><input type="number" step="any" className={inputClass} value={risk.pointValue} onChange={(e) => update("pointValue", e.target.value)} /></Field>
      </section>
      <section className="grid gap-3 md:grid-cols-4">
        {[['Stop Distance', valid ? metrics.distance.toFixed(2) : '—'], ['Planned Risk', valid ? `$${metrics.plannedRisk.toFixed(2)}` : '—'], ['0.5% Maximum', metrics.equity > 0 ? `$${metrics.maxRisk.toFixed(2)}` : '—'], ['Max Size', valid ? metrics.maxSize : '—']].map(([label, value]) => (
          <div key={label} className="compact-card"><p className="section-label">{label}</p><p className="text-2xl font-semibold text-zinc-100">{value}</p></div>
        ))}
      </section>
      <div className={`rounded border p-4 ${allowed ? "border-emerald-400/25 bg-emerald-950/20" : "border-amber-400/25 bg-amber-950/20"}`}>
        <div className="flex items-start gap-3">{allowed ? <ShieldCheck className="text-emerald-300" /> : <AlertTriangle className="text-amber-300" />}<div><p className="font-semibold text-zinc-100">{allowed ? "RISK PERMITTED" : "RISK NOT YET PERMITTED"}</p><p className="mt-1 text-sm text-zinc-400">If the stop is unaffordable, reduce size or pass. Never tighten structure to fit risk.</p></div></div>
      </div>
      <button type="button" disabled={!allowed} onClick={enter} className="w-full rounded border border-emerald-400/40 bg-emerald-400/10 px-4 py-3 font-semibold text-emerald-100 disabled:opacity-30">ENTER TRADE</button>
    </div>
  );
}

function CompactPlan({ trade }) {
  const plan = trade.originalPlan;
  return (
    <section className="rounded border border-white/10 bg-ink-850 p-3 shadow-terminal">
      <div className="grid gap-2 md:grid-cols-4">
        <div><p className="section-label">Thesis</p><p className="text-xs leading-5 text-zinc-300">{plan.thesis}</p></div>
        <div><p className="section-label">Invalidation</p><p className="text-xs leading-5 font-semibold text-red-200">{plan.invalidation}</p></div>
        <div><p className="section-label">Stop</p><p className="text-lg font-semibold text-zinc-100">{trade.risk.stop}</p></div>
        <div><p className="section-label">Target</p><p className="text-xs leading-5 text-zinc-300">{plan.target}</p></div>
      </div>
    </section>
  );
}

function LiveScreen({ trade, updateTrade, finishTrade }) {
  const [showDiscretionary, setShowDiscretionary] = useState(false);
  const [pnlHidden, setPnlHidden] = useState("");
  const [priorDay, setPriorDay] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");

  const quickDecision = (state, decision, noteText) => {
    updateTrade((current) => addDecision({ ...current, currentState: state }, state === "VALID" ? "HOLD" : "UPDATE", state, decision, noteText));
  };

  const saveOptionalNote = () => {
    if (!note.trim()) return;
    updateTrade((current) => addDecision(current, "UPDATE", current.currentState, "STRUCTURAL NOTE", note.trim()));
    setNote("");
    setShowNote(false);
  };

  const discretionaryReady = pnlHidden && priorDay;
  const discretionaryClassification = pnlHidden === "YES" && priorDay === "YES" ? "DISCRETIONARY — STRUCTURE CONFIRMED" : "NONSTRUCTURAL";

  return (
    <div className="space-y-3">
      <CompactPlan trade={trade} />

      <section className="rounded border border-sky-400/20 bg-sky-950/10 p-3">
        <div className="flex items-start gap-2">
          <Zap className="mt-0.5 text-sky-300" size={18} />
          <div><p className="font-semibold text-sky-100">FAST LIVE MODE</p><p className="text-xs leading-5 text-sky-100/65">One click per normal decision. Do not type unless the structure truly needs explanation.</p></div>
        </div>
      </section>

      <section className="grid gap-2 md:grid-cols-3">
        <button type="button" onClick={() => quickDecision("VALID", "HOLD — VALID", "No structural change.")} className="min-h-32 rounded border border-emerald-400/35 bg-emerald-400/10 p-4 text-left transition hover:bg-emerald-400/15">
          <CheckCircle2 className="mb-3 text-emerald-300" size={26} /><p className="text-xl font-bold text-emerald-100">VALID — HOLD</p><p className="mt-1 text-sm text-emerald-100/60">Nothing requires action.</p>
        </button>
        <button type="button" onClick={() => quickDecision("THREATENED", "THREATENED — OBSERVE", "Adverse structure noted; invalidation has not occurred.")} className="min-h-32 rounded border border-amber-400/35 bg-amber-400/10 p-4 text-left transition hover:bg-amber-400/15">
          <AlertTriangle className="mb-3 text-amber-300" size={26} /><p className="text-xl font-bold text-amber-100">THREATENED</p><p className="mt-1 text-sm text-amber-100/60">Probability degraded. Keep observing.</p>
        </button>
        <button type="button" onClick={() => quickDecision("INVALID", "INVALID — STRUCTURE FAILED", "Original thesis is structurally invalid.")} className="min-h-32 rounded border border-red-400/35 bg-red-400/10 p-4 text-left transition hover:bg-red-400/15">
          <XCircle className="mb-3 text-red-300" size={26} /><p className="text-xl font-bold text-red-100">INVALID</p><p className="mt-1 text-sm text-red-100/60">The original thesis has failed.</p>
        </button>
      </section>

      <section className="rounded border border-white/10 bg-ink-850 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div><p className="section-label">Fast Exit</p><p className="text-sm font-semibold text-zinc-200">Structural/planned exits are one click.</p></div>
          <StatePill state={trade.currentState} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <button onClick={() => finishTrade("Planned target", "STRUCTURAL / PLANNED", "Planned target reached.")} className="rounded border border-emerald-400/25 bg-emerald-400/10 px-3 py-3 text-sm font-semibold text-emerald-100">TARGET</button>
          <button onClick={() => finishTrade("Structural invalidation", "STRUCTURAL / PLANNED", "Original invalidation occurred.")} className="rounded border border-red-400/25 bg-red-400/10 px-3 py-3 text-sm font-semibold text-red-100">INVALIDATED</button>
          <button onClick={() => finishTrade("Legitimate new adverse structure", "STRUCTURAL / PLANNED", "New adverse structure justified exit.")} className="rounded border border-amber-400/25 bg-amber-400/10 px-3 py-3 text-sm font-semibold text-amber-100">ADVERSE STRUCTURE</button>
          <button onClick={() => finishTrade("Predefined management rule", "STRUCTURAL / PLANNED", "Predefined management rule triggered.")} className="rounded border border-sky-400/25 bg-sky-400/10 px-3 py-3 text-sm font-semibold text-sky-100">PLAN RULE</button>
          <button onClick={() => setShowDiscretionary((v) => !v)} className="rounded border border-white/15 bg-white/[0.03] px-3 py-3 text-sm font-semibold text-zinc-300">DISCRETIONARY…</button>
        </div>
      </section>

      {showDiscretionary && (
        <section className="rounded border border-red-400/25 bg-red-950/15 p-4 space-y-4">
          <p className="section-label text-red-300">Two-Question Exit Gate</p>
          <div>
            <p className="font-semibold text-zinc-100">If I could not see my P/L, would I still exit this chart?</p>
            <div className="mt-2 flex gap-2">{["YES", "NO"].map((a) => <button key={a} onClick={() => setPnlHidden(a)} className={`rounded border px-5 py-2 font-bold ${pnlHidden === a ? "border-sky-400/50 bg-sky-400/10 text-sky-100" : "border-white/10 text-zinc-500"}`}>{a}</button>)}</div>
          </div>
          <div>
            <p className="font-semibold text-zinc-100">Would I make this exact same exit if yesterday had been +$50?</p>
            <div className="mt-2 flex gap-2">{["YES", "NO"].map((a) => <button key={a} onClick={() => setPriorDay(a)} className={`rounded border px-5 py-2 font-bold ${priorDay === a ? "border-sky-400/50 bg-sky-400/10 text-sky-100" : "border-white/10 text-zinc-500"}`}>{a}</button>)}</div>
          </div>
          {(pnlHidden === "NO" || priorDay === "NO") && <p className="rounded border border-red-400/25 bg-red-950/25 p-3 text-sm text-red-200">This exit is being contaminated by P/L or prior results. You can still exit; it will be recorded as NONSTRUCTURAL.</p>}
          <button disabled={!discretionaryReady} onClick={() => finishTrade("Discretionary exit", discretionaryClassification, `P/L-hidden: ${pnlHidden}; prior-day test: ${priorDay}`)} className="rounded border border-red-400/35 bg-red-400/10 px-5 py-3 font-semibold text-red-100 disabled:opacity-30">RECORD DISCRETIONARY EXIT</button>
        </section>
      )}

      <section className="flex flex-wrap gap-2">
        <button onClick={() => setShowNote((v) => !v)} className="rounded border border-white/10 bg-white/[0.02] px-3 py-2 text-xs font-semibold text-zinc-500">+ OPTIONAL STRUCTURAL NOTE</button>
      </section>
      {showNote && <section className="panel space-y-2"><Field label="Optional live note" help="Use only when one-click classification is not enough."><textarea className={textareaClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field><button onClick={saveOptionalNote} disabled={!note.trim()} className="rounded border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-100 disabled:opacity-30">SAVE NOTE</button></section>}

      <section className="rounded border border-sky-400/20 bg-sky-950/10 p-3">
        <p className="text-sm font-semibold text-sky-100">Green is not an exit. Red is not invalidation. Structure is invalidation.</p>
        <p className="mt-1 text-xs text-sky-100/60">For a 2-minute trade, do not change management solely because of P/L during the remainder of the entry bar or the next completed bar.</p>
      </section>
    </div>
  );
}

function Timeline({ trade }) {
  return (
    <section className="panel overflow-x-auto">
      <p className="section-label">Decision Timeline</p>
      <table className="w-full min-w-[700px] border-collapse text-left text-sm">
        <thead className="text-zinc-500"><tr className="border-b border-white/10"><th className="px-2 py-2">Time</th><th className="px-2 py-2">Stage</th><th className="px-2 py-2">State</th><th className="px-2 py-2">Decision</th><th className="px-2 py-2">Note</th></tr></thead>
        <tbody>{trade.decisions.map((item) => <tr key={item.id} className="border-b border-white/5"><td className="px-2 py-3 font-mono text-xs text-zinc-500">{item.time}</td><td className="px-2 py-3">{item.stage}</td><td className="px-2 py-3">{item.state}</td><td className="px-2 py-3 font-semibold">{item.decision}</td><td className="px-2 py-3 text-zinc-500">{item.note || "—"}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

function ReviewScreen({ trade, saveReviewNote, startNewTrade, exportTrade }) {
  const [note, setNote] = useState(trade.reviewNote || "");
  const structural = trade.exit?.classification !== "NONSTRUCTURAL";
  return (
    <div className="space-y-4">
      <section className={`rounded border p-5 ${structural ? "border-emerald-400/25 bg-emerald-950/15" : "border-red-400/25 bg-red-950/15"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="section-label">Execution Review · Auto-Saved</p><h2 className="text-2xl font-semibold text-zinc-50">{trade.originalPlan.symbol} {trade.originalPlan.direction}</h2><p className="mt-1 text-sm text-zinc-400">{trade.originalPlan.setup} · {trade.originalPlan.timeframe}</p></div><span className="rounded border border-white/10 px-3 py-1 font-mono text-xs font-bold text-zinc-200">{trade.exit?.classification}</span></div>
      </section>
      <CompactPlan trade={trade} />
      <Timeline trade={trade} />
      <section className="panel space-y-2"><Field label="Post-trade review note" help="Add the detail you deliberately skipped while the trade was live."><textarea className={textareaClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field><button onClick={() => saveReviewNote(note)} className="rounded border border-sky-400/25 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100">SAVE REVIEW NOTE</button></section>
      <section className="flex flex-wrap gap-2"><button onClick={startNewTrade} className="flex items-center gap-2 rounded border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 font-semibold text-emerald-100"><RotateCcw size={16} /> START NEW TRADE</button><button onClick={() => exportTrade(trade)} className="flex items-center gap-2 rounded border border-white/10 px-4 py-2 font-semibold text-zinc-300"><Download size={16} /> EXPORT JSON</button></section>
    </div>
  );
}

function HistoryScreen({ history, openTrade, exportAll }) {
  return (
    <div className="space-y-4">
      <section className="panel flex flex-wrap items-center justify-between gap-3"><div><p className="section-label">Trade History</p><h2 className="text-xl font-semibold text-zinc-100">{history.length} archived trade{history.length === 1 ? "" : "s"}</h2></div><button onClick={exportAll} disabled={!history.length} className="flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-sm font-semibold text-zinc-300 disabled:opacity-30"><Download size={15} /> EXPORT ALL</button></section>
      {!history.length && <section className="panel text-sm text-zinc-500">Completed trades will be archived here automatically before a new trade can replace them.</section>}
      <section className="grid gap-3 md:grid-cols-2">{history.map((trade) => <article key={trade.id} className="compact-card"><div className="flex items-start justify-between gap-3"><div><p className="section-label">{trade.completedAt ? new Date(trade.completedAt).toLocaleString() : "Saved trade"}</p><h3 className="text-lg font-semibold text-zinc-100">{trade.originalPlan?.symbol} {trade.originalPlan?.direction}</h3><p className="mt-1 text-sm text-zinc-500">{trade.originalPlan?.setup}</p></div><Archive size={18} className="text-zinc-600" /></div><div className="mt-3 flex items-center justify-between gap-2"><span className="text-xs font-semibold text-zinc-400">{trade.exit?.classification}</span><button onClick={() => openTrade(trade)} className="rounded border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-100">OPEN REVIEW</button></div></article>)}</section>
    </div>
  );
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

export default function ExecutionV21() {
  const [store, setStore] = useState(initialStore);
  const trade = store.activeTrade;

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }, [store]);

  const updateTrade = (updater) => {
    setStore((current) => ({ ...current, activeTrade: typeof updater === "function" ? updater(current.activeTrade) : updater }));
  };

  const finishTrade = (reason, classification, note) => {
    setStore((current) => {
      let finalTrade = addDecision(current.activeTrade, "EXIT", current.activeTrade.currentState, classification === "NONSTRUCTURAL" ? "NONSTRUCTURAL EXIT" : reason.toUpperCase(), note);
      finalTrade = { ...finalTrade, phase: "REVIEW", completedAt: new Date().toISOString(), exit: { time: nowLabel(), reason, classification, note } };
      return { ...current, activeTrade: finalTrade, history: upsertHistory(current.history, finalTrade), view: "TRADE" };
    });
  };

  const saveReviewNote = (reviewNote) => {
    setStore((current) => {
      const updated = { ...current.activeTrade, reviewNote };
      return { ...current, activeTrade: updated, history: upsertHistory(current.history, updated) };
    });
  };

  const startNewTrade = () => setStore((current) => ({ ...current, activeTrade: freshTrade(), view: "TRADE" }));
  const openTrade = (savedTrade) => setStore((current) => ({ ...current, activeTrade: savedTrade, view: "TRADE" }));

  return (
    <main className="min-h-screen bg-ink-950 px-3 py-4 text-zinc-100 md:px-5">
      <div className="mx-auto max-w-7xl space-y-3">
        <header className="rounded border border-white/10 bg-ink-850 p-3 shadow-terminal">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="section-label">ExecutionOS · V2.1</p><h1 className="text-xl font-semibold text-zinc-50">Speed-First Execution</h1><p className="mt-1 text-xs text-zinc-500">Think before entry. One-click decisions during the trade. Detail after exit.</p></div>
            <div className="flex items-center gap-2"><button onClick={() => setStore((current) => ({ ...current, view: current.view === "HISTORY" ? "TRADE" : "HISTORY" }))} className="flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300"><History size={15} /> {store.view === "HISTORY" ? "BACK TO TRADE" : `HISTORY (${store.history.length})`}</button>{trade.phase !== "PLAN" && <StatePill state={trade.currentState} />}</div>
          </div>
          {store.view === "TRADE" && <div className="mt-3"><Chain phase={trade.phase} /></div>}
        </header>

        {store.view === "HISTORY" ? (
          <HistoryScreen history={store.history} openTrade={openTrade} exportAll={() => downloadJson(store.history, "executionos-trade-history.json")} />
        ) : (
          <>
            {trade.phase === "PLAN" && <PlanScreen trade={trade} updateTrade={updateTrade} />}
            {trade.phase === "RISK" && <RiskScreen trade={trade} updateTrade={updateTrade} />}
            {trade.phase === "LIVE" && <LiveScreen trade={trade} updateTrade={updateTrade} finishTrade={finishTrade} />}
            {trade.phase === "REVIEW" && <ReviewScreen trade={trade} saveReviewNote={saveReviewNote} startNewTrade={startNewTrade} exportTrade={(item) => downloadJson(item, `executionos-${item.originalPlan.symbol}-${item.id}.json`)} />}
          </>
        )}
      </div>
    </main>
  );
}
