import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Target,
} from "lucide-react";

const STORAGE_KEY = "execution-v2-active-trade";
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

const emptyTrade = {
  phase: "PLAN",
  plan: emptyPlan,
  originalPlan: null,
  risk: emptyRisk,
  currentState: "VALID",
  decisions: [],
  exit: null,
};

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
        stage,
        state,
        decision,
        note,
      },
    ],
  };
}

function Field({ label, children, help }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {children}
      {help && <span className="mt-1 block text-xs text-zinc-600">{help}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded border border-white/10 bg-black/25 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-sky-400/50";

const textareaClass = `${inputClass} min-h-24 resize-y`;

function StatePill({ state }) {
  const tone = {
    VALID: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    THREATENED: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    INVALID: "border-red-400/30 bg-red-400/10 text-red-200",
  }[state];

  return (
    <span className={`rounded-full border px-3 py-1 font-mono text-[11px] font-bold tracking-wide ${tone}`}>
      {state}
    </span>
  );
}

function Chain({ phase }) {
  const activeMap = {
    PLAN: "PLAN",
    RISK: "RISK",
    LIVE: "HOLD",
    REVIEW: "REVIEW",
  };
  const active = activeMap[phase] ?? "PLAN";

  return (
    <div className="flex flex-wrap gap-2">
      {CHAIN.map((step) => (
        <div
          key={step}
          className={`rounded border px-2.5 py-1.5 font-mono text-[10px] font-semibold ${
            step === active
              ? "border-sky-400/40 bg-sky-400/10 text-sky-100"
              : "border-white/10 bg-white/[0.02] text-zinc-600"
          }`}
        >
          {step}
        </div>
      ))}
    </div>
  );
}

function PlanScreen({ trade, setTrade }) {
  const plan = trade.plan;
  const required = [
    "symbol",
    "direction",
    "setup",
    "timeframe",
    "thesis",
    "trigger",
    "invalidation",
    "structuralStop",
    "target",
    "management",
  ];
  const canArm = required.every((key) => String(plan[key] ?? "").trim());

  const update = (key, value) => {
    setTrade((current) => ({ ...current, plan: { ...current.plan, [key]: value } }));
  };

  const arm = () => {
    if (!canArm) return;
    setTrade((current) => {
      const frozen = { ...current.plan };
      const next = {
        ...current,
        phase: "RISK",
        originalPlan: frozen,
        risk: {
          ...current.risk,
          stop: current.plan.structuralStop,
          pointValue: current.plan.symbol.toUpperCase() === "MNQ" ? "2" : current.plan.symbol.toUpperCase() === "MES" ? "5" : current.risk.pointValue,
        },
      };
      return addDecision(next, "PLAN", "—", "PLAN FROZEN", `${frozen.symbol} ${frozen.direction} — ${frozen.setup}`);
    });
  };

  return (
    <div className="space-y-4">
      <section className="panel">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-label">Pre-Entry Freeze</p>
            <h2 className="text-xl font-semibold text-zinc-100">Define the trade before money is involved</h2>
            <p className="mt-1 text-sm text-zinc-500">All required fields must be explicit before the trade can be armed.</p>
          </div>
          <LockKeyhole className="text-sky-300" size={22} />
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Symbol">
            <input className={inputClass} value={plan.symbol} onChange={(e) => update("symbol", e.target.value.toUpperCase())} />
          </Field>
          <Field label="Direction">
            <select className={inputClass} value={plan.direction} onChange={(e) => update("direction", e.target.value)}>
              <option>LONG</option>
              <option>SHORT</option>
            </select>
          </Field>
          <Field label="Setup">
            <input className={inputClass} value={plan.setup} onChange={(e) => update("setup", e.target.value)} placeholder="HL MTR, H2, failed breakout…" />
          </Field>
          <Field label="Timeframe">
            <input className={inputClass} value={plan.timeframe} onChange={(e) => update("timeframe", e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="panel space-y-3">
          <Field label="Thesis" help="What exactly am I trading?">
            <textarea className={textareaClass} value={plan.thesis} onChange={(e) => update("thesis", e.target.value)} />
          </Field>
          <Field label="Trigger" help="What event authorizes the entry?">
            <textarea className={textareaClass} value={plan.trigger} onChange={(e) => update("trigger", e.target.value)} />
          </Field>
          <Field label="Invalidation" help="What price action proves the thesis wrong?">
            <textarea className={textareaClass} value={plan.invalidation} onChange={(e) => update("invalidation", e.target.value)} />
          </Field>
        </div>

        <div className="panel space-y-3">
          <Field label="Structural Stop" help="Where does the stop belong because of invalidation?">
            <input className={inputClass} value={plan.structuralStop} onChange={(e) => update("structuralStop", e.target.value)} placeholder="Price or structural description" />
          </Field>
          <Field label="Target" help="What am I expecting if I am right?">
            <textarea className={textareaClass} value={plan.target} onChange={(e) => update("target", e.target.value)} />
          </Field>
          <Field label="Management Plan" help="What is allowed after entry?">
            <textarea className={textareaClass} value={plan.management} onChange={(e) => update("management", e.target.value)} placeholder="TBTL, partial + runner, fixed target, trailing rule…" />
          </Field>
        </div>
      </section>

      <button
        type="button"
        disabled={!canArm}
        onClick={arm}
        className="w-full rounded border border-sky-400/40 bg-sky-400/10 px-4 py-3 font-semibold text-sky-100 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.02] disabled:text-zinc-700"
      >
        ARM TRADE — FREEZE PLAN
      </button>
    </div>
  );
}

function RiskScreen({ trade, setTrade }) {
  const risk = trade.risk;
  const update = (key, value) => setTrade((current) => ({ ...current, risk: { ...current.risk, [key]: value } }));

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

  const validNumbers = [metrics.equity, metrics.entry, metrics.stop, metrics.size, metrics.pointValue].every((v) => Number.isFinite(v) && v > 0);
  const riskAllowed = validNumbers && metrics.plannedRisk <= metrics.maxRisk && metrics.distance > 0;

  const enter = () => {
    if (!riskAllowed) return;
    setTrade((current) => {
      let next = { ...current, phase: "LIVE", currentState: "VALID" };
      next = addDecision(next, "RISK", "—", "RISK APPROVED", `$${metrics.plannedRisk.toFixed(2)} planned risk; $${metrics.maxRisk.toFixed(2)} maximum`);
      return addDecision(next, "TRIGGER", "VALID", "ENTERED", `${current.originalPlan.symbol} ${current.originalPlan.direction} @ ${risk.entry}`);
    });
  };

  return (
    <div className="space-y-4">
      <section className="panel">
        <p className="section-label">Risk Permission</p>
        <h2 className="text-xl font-semibold text-zinc-100">Structural stop first. Size second.</h2>
        <p className="mt-1 text-sm text-zinc-500">Maximum planned risk is 0.5% of account equity. Commissions and slippage are not included in this prototype.</p>
      </section>

      <section className="grid gap-3 md:grid-cols-5">
        <Field label="Account Equity">
          <input type="number" className={inputClass} value={risk.accountEquity} onChange={(e) => update("accountEquity", e.target.value)} />
        </Field>
        <Field label="Entry">
          <input type="number" step="any" className={inputClass} value={risk.entry} onChange={(e) => update("entry", e.target.value)} />
        </Field>
        <Field label="Structural Stop">
          <input type="number" step="any" className={inputClass} value={risk.stop} onChange={(e) => update("stop", e.target.value)} />
        </Field>
        <Field label="Size">
          <input type="number" min="1" className={inputClass} value={risk.size} onChange={(e) => update("size", e.target.value)} />
        </Field>
        <Field label="$ / Point / Unit" help="MES = 5, MNQ = 2">
          <input type="number" step="any" className={inputClass} value={risk.pointValue} onChange={(e) => update("pointValue", e.target.value)} />
        </Field>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <div className="compact-card">
          <p className="section-label">Stop Distance</p>
          <p className="text-2xl font-semibold text-zinc-100">{validNumbers ? metrics.distance.toFixed(2) : "—"}</p>
        </div>
        <div className="compact-card">
          <p className="section-label">Planned Risk</p>
          <p className="text-2xl font-semibold text-zinc-100">{validNumbers ? `$${metrics.plannedRisk.toFixed(2)}` : "—"}</p>
        </div>
        <div className="compact-card">
          <p className="section-label">0.5% Maximum</p>
          <p className="text-2xl font-semibold text-zinc-100">{metrics.equity > 0 ? `$${metrics.maxRisk.toFixed(2)}` : "—"}</p>
        </div>
        <div className="compact-card">
          <p className="section-label">Max Size At This Stop</p>
          <p className="text-2xl font-semibold text-zinc-100">{validNumbers ? metrics.maxSize : "—"}</p>
        </div>
      </section>

      <div className={`rounded border p-4 ${riskAllowed ? "border-emerald-400/25 bg-emerald-950/20" : "border-amber-400/25 bg-amber-950/20"}`}>
        <div className="flex items-start gap-3">
          {riskAllowed ? <ShieldCheck className="text-emerald-300" size={20} /> : <AlertTriangle className="text-amber-300" size={20} />}
          <div>
            <p className={`font-semibold ${riskAllowed ? "text-emerald-100" : "text-amber-100"}`}>{riskAllowed ? "RISK PERMITTED" : "RISK NOT YET PERMITTED"}</p>
            <p className="mt-1 text-sm text-zinc-400">If the correct stop is unaffordable, reduce size or pass. Do not tighten the structural stop to force permission.</p>
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={!riskAllowed}
        onClick={enter}
        className="w-full rounded border border-emerald-400/40 bg-emerald-400/10 px-4 py-3 font-semibold text-emerald-100 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.02] disabled:text-zinc-700"
      >
        ENTER TRADE
      </button>
    </div>
  );
}

function FrozenPlan({ plan, risk }) {
  return (
    <section className="panel">
      <div className="mb-3 flex items-center gap-2 text-sky-200">
        <LockKeyhole size={16} />
        <span className="font-mono text-[10px] font-semibold uppercase">Frozen Original Plan</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div><p className="section-label">Thesis</p><p className="text-sm leading-6 text-zinc-300">{plan.thesis}</p></div>
        <div><p className="section-label">Invalidation</p><p className="text-sm leading-6 text-zinc-300">{plan.invalidation}</p></div>
        <div><p className="section-label">Stop</p><p className="text-sm leading-6 text-zinc-300">{risk.stop}</p></div>
        <div><p className="section-label">Target / Management</p><p className="text-sm leading-6 text-zinc-300">{plan.target} — {plan.management}</p></div>
      </div>
    </section>
  );
}

function LiveScreen({ trade, setTrade }) {
  const [showUpdate, setShowUpdate] = useState(false);
  const [updateState, setUpdateState] = useState(trade.currentState);
  const [updateReason, setUpdateReason] = useState("Weak follow-through");
  const [updateNote, setUpdateNote] = useState("");
  const [showExit, setShowExit] = useState(false);
  const [exitReason, setExitReason] = useState("Planned target");
  const [exitPrice, setExitPrice] = useState("");
  const [pnlHiddenAnswer, setPnlHiddenAnswer] = useState("");
  const [exitStructureNote, setExitStructureNote] = useState("");

  const hold = () => {
    setTrade((current) => addDecision(current, "HOLD", current.currentState, "HOLD — NO STRUCTURAL CHANGE", "Structure, not P/L, remains controlling."));
  };

  const saveUpdate = () => {
    if (!updateNote.trim()) return;
    setTrade((current) => {
      const next = { ...current, currentState: updateState };
      return addDecision(next, "UPDATE", updateState, updateReason, updateNote.trim());
    });
    setUpdateNote("");
    setShowUpdate(false);
  };

  const discretionary = exitReason === "Discretionary exit";
  const canExit = exitReason && (!discretionary || (pnlHiddenAnswer && exitStructureNote.trim()));

  const completeExit = () => {
    if (!canExit) return;
    const nonStructural = discretionary && pnlHiddenAnswer === "NO";
    setTrade((current) => {
      const note = discretionary
        ? `${exitStructureNote.trim()} | P/L-hidden test: ${pnlHiddenAnswer}`
        : exitPrice
          ? `Exit price ${exitPrice}`
          : "";
      let next = addDecision(current, "EXIT", current.currentState, nonStructural ? "NONSTRUCTURAL EXIT" : exitReason.toUpperCase(), note);
      next = {
        ...next,
        phase: "REVIEW",
        exit: {
          time: nowLabel(),
          reason: exitReason,
          price: exitPrice,
          pnlHiddenAnswer: discretionary ? pnlHiddenAnswer : null,
          structureNote: discretionary ? exitStructureNote.trim() : "",
          classification: nonStructural ? "NONSTRUCTURAL" : "STRUCTURAL / PLANNED",
        },
      };
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <FrozenPlan plan={trade.originalPlan} risk={trade.risk} />

      <section className="rounded border border-white/10 bg-ink-850 p-5 text-center shadow-terminal">
        <p className="section-label">Live Decision</p>
        <h2 className="text-2xl font-semibold text-zinc-50">What is the state of the trade?</h2>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          {["VALID", "THREATENED", "INVALID"].map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => setTrade((current) => ({ ...current, currentState: state }))}
              className={`rounded border px-5 py-3 font-semibold ${
                trade.currentState === state ? "border-sky-400/50 bg-sky-400/10 text-sky-100" : "border-white/10 bg-white/[0.02] text-zinc-500"
              }`}
            >
              {state}
            </button>
          ))}
        </div>
        <div className="mt-4"><StatePill state={trade.currentState} /></div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <button type="button" onClick={hold} className="rounded border border-emerald-400/30 bg-emerald-400/10 p-4 text-left">
          <CheckCircle2 className="mb-3 text-emerald-300" size={20} />
          <p className="font-semibold text-emerald-100">HOLD — NO STRUCTURAL CHANGE</p>
          <p className="mt-1 text-sm text-emerald-100/65">Record doing nothing correctly as an execution decision.</p>
        </button>
        <button type="button" onClick={() => { setShowUpdate((v) => !v); setUpdateState(trade.currentState); }} className="rounded border border-amber-400/30 bg-amber-400/10 p-4 text-left">
          <CircleDot className="mb-3 text-amber-300" size={20} />
          <p className="font-semibold text-amber-100">UPDATE STRUCTURE</p>
          <p className="mt-1 text-sm text-amber-100/65">Record new information and reclassify the trade.</p>
        </button>
        <button type="button" onClick={() => setShowExit((v) => !v)} className="rounded border border-red-400/30 bg-red-400/10 p-4 text-left">
          <Target className="mb-3 text-red-300" size={20} />
          <p className="font-semibold text-red-100">I WANT TO EXIT</p>
          <p className="mt-1 text-sm text-red-100/65">Run the exit gate before recording the decision.</p>
        </button>
      </section>

      {showUpdate && (
        <section className="panel space-y-3">
          <p className="section-label">Update Gate</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="What changed?">
              <select className={inputClass} value={updateReason} onChange={(e) => setUpdateReason(e.target.value)}>
                <option>Weak follow-through</option>
                <option>Failed breakout</option>
                <option>Opposing signal</option>
                <option>Support / resistance failed</option>
                <option>Trend → trading range transition</option>
                <option>Momentum deterioration</option>
                <option>Unexpected strong opposing bar</option>
                <option>Other</option>
              </select>
            </Field>
            <Field label="New structural state">
              <select className={inputClass} value={updateState} onChange={(e) => setUpdateState(e.target.value)}>
                <option>VALID</option>
                <option>THREATENED</option>
                <option>INVALID</option>
              </select>
            </Field>
          </div>
          <Field label="Structural evidence" help="Describe the chart. Do not describe the P/L.">
            <textarea className={textareaClass} value={updateNote} onChange={(e) => setUpdateNote(e.target.value)} />
          </Field>
          <button type="button" disabled={!updateNote.trim()} onClick={saveUpdate} className="rounded border border-amber-400/30 bg-amber-400/10 px-4 py-2 font-semibold text-amber-100 disabled:opacity-30">
            SAVE UPDATE
          </button>
        </section>
      )}

      {showExit && (
        <section className="rounded border border-red-400/25 bg-red-950/15 p-4 space-y-3">
          <p className="section-label text-red-300">Exit Gate</p>
          <h3 className="text-lg font-semibold text-red-100">Why are you exiting?</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Exit reason">
              <select className={inputClass} value={exitReason} onChange={(e) => setExitReason(e.target.value)}>
                <option>Planned target</option>
                <option>Structural invalidation</option>
                <option>Legitimate new adverse structure</option>
                <option>Predefined management rule</option>
                <option>Discretionary exit</option>
              </select>
            </Field>
            <Field label="Exit price (optional)">
              <input type="number" step="any" className={inputClass} value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} />
            </Field>
          </div>

          {discretionary && (
            <div className="space-y-3 rounded border border-white/10 bg-black/20 p-4">
              <p className="text-base font-semibold text-zinc-100">If I could not see my P/L, would I still exit this chart right now?</p>
              <div className="flex gap-2">
                {["YES", "NO"].map((answer) => (
                  <button key={answer} type="button" onClick={() => setPnlHiddenAnswer(answer)} className={`rounded border px-4 py-2 font-semibold ${pnlHiddenAnswer === answer ? "border-sky-400/40 bg-sky-400/10 text-sky-100" : "border-white/10 text-zinc-500"}`}>
                    {answer}
                  </button>
                ))}
              </div>
              <Field label="What changed structurally?">
                <textarea className={textareaClass} value={exitStructureNote} onChange={(e) => setExitStructureNote(e.target.value)} />
              </Field>
              {pnlHiddenAnswer === "NO" && (
                <p className="rounded border border-red-400/25 bg-red-950/25 p-3 text-sm text-red-200">You remain free to exit, but this will be classified as a NONSTRUCTURAL EXIT for review.</p>
              )}
            </div>
          )}

          <button type="button" disabled={!canExit} onClick={completeExit} className="rounded border border-red-400/40 bg-red-400/10 px-4 py-2 font-semibold text-red-100 disabled:opacity-30">
            RECORD EXIT
          </button>
        </section>
      )}

      <section className="rounded border border-sky-400/20 bg-sky-950/10 p-4">
        <p className="text-sm font-semibold text-sky-100">Green is not an exit. Red is not invalidation. Structure is invalidation.</p>
      </section>
    </div>
  );
}

function ReviewScreen({ trade, reset }) {
  const structural = trade.exit?.classification !== "NONSTRUCTURAL";
  return (
    <div className="space-y-4">
      <section className={`rounded border p-5 ${structural ? "border-emerald-400/25 bg-emerald-950/15" : "border-red-400/25 bg-red-950/15"}`}>
        <p className="section-label">Execution Review</p>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-50">{trade.originalPlan.symbol} {trade.originalPlan.direction}</h2>
            <p className="mt-1 text-sm text-zinc-400">{trade.originalPlan.setup} · {trade.originalPlan.timeframe}</p>
          </div>
          <span className={`rounded border px-3 py-1 font-mono text-xs font-bold ${structural ? "border-emerald-400/30 text-emerald-200" : "border-red-400/30 text-red-200"}`}>
            {trade.exit?.classification}
          </span>
        </div>
      </section>

      <FrozenPlan plan={trade.originalPlan} risk={trade.risk} />

      <section className="panel overflow-x-auto">
        <div className="mb-3">
          <p className="section-label">Decision Timeline</p>
          <h3 className="text-lg font-semibold text-zinc-100">What did I decide at each opportunity to interfere?</h3>
        </div>
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="text-zinc-500">
            <tr className="border-b border-white/10">
              <th className="px-2 py-2 font-mono text-[10px] uppercase">Time</th>
              <th className="px-2 py-2 font-mono text-[10px] uppercase">Stage</th>
              <th className="px-2 py-2 font-mono text-[10px] uppercase">State</th>
              <th className="px-2 py-2 font-mono text-[10px] uppercase">Decision</th>
              <th className="px-2 py-2 font-mono text-[10px] uppercase">Evidence / Note</th>
            </tr>
          </thead>
          <tbody>
            {trade.decisions.map((item) => (
              <tr key={item.id} className="border-b border-white/5 text-zinc-300">
                <td className="px-2 py-3 font-mono text-xs text-zinc-500">{item.time}</td>
                <td className="px-2 py-3">{item.stage}</td>
                <td className="px-2 py-3">{item.state}</td>
                <td className="px-2 py-3 font-semibold">{item.decision}</td>
                <td className="px-2 py-3 text-zinc-500">{item.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <button type="button" onClick={reset} className="flex items-center gap-2 rounded border border-white/10 bg-white/[0.03] px-4 py-2 font-semibold text-zinc-300">
        <RotateCcw size={16} /> START NEW TRADE
      </button>
    </div>
  );
}

export default function ExecutionV2() {
  const [trade, setTrade] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : emptyTrade;
    } catch {
      return emptyTrade;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trade));
  }, [trade]);

  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    setTrade(emptyTrade);
  };

  return (
    <main className="min-h-screen bg-ink-950 px-4 py-5 text-zinc-100 md:px-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="rounded border border-white/10 bg-ink-850 p-4 shadow-terminal">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="section-label">ExecutionOS · Version 2 Prototype</p>
              <h1 className="text-2xl font-semibold text-zinc-50">Live Execution Loop</h1>
              <p className="mt-1 max-w-3xl text-sm text-zinc-500">The app remembers the plan when P/L and uncertainty create pressure to rewrite it.</p>
            </div>
            {trade.phase !== "PLAN" && trade.currentState && <StatePill state={trade.currentState} />}
          </div>
          <div className="mt-4"><Chain phase={trade.phase} /></div>
        </header>

        {trade.phase === "PLAN" && <PlanScreen trade={trade} setTrade={setTrade} />}
        {trade.phase === "RISK" && <RiskScreen trade={trade} setTrade={setTrade} />}
        {trade.phase === "LIVE" && <LiveScreen trade={trade} setTrade={setTrade} />}
        {trade.phase === "REVIEW" && <ReviewScreen trade={trade} reset={reset} />}
      </div>
    </main>
  );
}
