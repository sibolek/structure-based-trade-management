import { Activity, Radio, ShieldCheck, WifiOff } from "lucide-react";

const WORKSPACES = [
  { id: "PRETRADE", label: "PRE-TRADE" },
  { id: "EXECUTION", label: "EXECUTION" },
];

function StatusChip({ connected, label, offlineLabel }) {
  return (
    <span className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] font-semibold ${connected ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100" : "border-amber-400/25 bg-amber-400/10 text-amber-100"}`}>
      {connected ? <ShieldCheck size={13} /> : <WifiOff size={13} />}
      {connected ? label : offlineLabel}
    </span>
  );
}

export default function WorkspaceNav({ workspace, onChange, broker, pretrade }) {
  const candidates = Array.isArray(pretrade?.state?.candidates) ? pretrade.state.candidates : [];
  const waiting = candidates.filter((candidate) => candidate.lifecycleState === "WAITING").length;
  const positions = Array.isArray(broker?.state?.positions) ? broker.state.positions.length : 0;

  return (
    <section className="rounded border border-white/10 bg-ink-850/95 shadow-terminal">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="section-label">ExecutionOS Workspace</p>
          <h1 className="text-lg font-semibold text-zinc-100">Pre-trade decisions and execution stay visibly separate.</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip connected={broker?.connected} label={`SCHWAB · ${positions} POS`} offlineLabel="SCHWAB OFFLINE" />
          <StatusChip connected={pretrade?.connected} label={`PRE-TRADE · WAITING ${waiting}`} offlineLabel="PRE-TRADE OFFLINE" />
        </div>
      </div>

      <nav className="grid grid-cols-2" aria-label="ExecutionOS workspaces">
        {WORKSPACES.map((item) => {
          const active = workspace === item.id;
          const Icon = item.id === "PRETRADE" ? Radio : Activity;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={`flex items-center justify-center gap-2 border-r border-white/10 px-3 py-3 text-xs font-bold tracking-wide last:border-r-0 ${active ? "bg-sky-400/10 text-sky-100" : "text-zinc-500 hover:bg-white/[0.025] hover:text-zinc-300"}`}
            >
              <Icon size={14} />
              {item.label}
            </button>
          );
        })}
      </nav>
    </section>
  );
}
