import { Clock3, Inbox, ShieldCheck, WifiOff } from "lucide-react";

function price(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function triggerLabel(trigger) {
  if (!trigger || typeof trigger !== "object") return "—";
  const parts = [String(trigger.type || "").replaceAll("_", " ")];
  if (Number.isFinite(Number(trigger.level))) parts.push(`@ ${price(trigger.level)}`);
  if (trigger.direction) parts.push(String(trigger.direction).toUpperCase());
  return parts.filter(Boolean).join(" ");
}

function targetLabel(targets) {
  if (!Array.isArray(targets) || !targets.length) return "—";
  return targets.map((target) => {
    if (target && typeof target === "object") {
      const label = target.label || target.name || "Target";
      const value = target.price ?? target.level ?? target.value;
      return Number.isFinite(Number(value)) ? `${label} ${price(value)}` : label;
    }
    return price(target);
  }).join(" · ");
}

function importedLabel(value) {
  if (!value || Number.isNaN(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function CandidateCard({ candidate }) {
  const directionClass = candidate.direction === "LONG" ? "text-emerald-300" : "text-red-300";
  const requestedMode = candidate.armPolicy?.requestedMode || "MANUAL";

  return (
    <article className="rounded border border-violet-400/20 bg-ink-850 shadow-terminal">
      <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="section-label">SOD Candidate · WAITING</p>
          <div className="flex items-baseline gap-2">
            <h3 className="text-2xl font-bold">{candidate.symbol}</h3>
            <span className={`font-bold ${directionClass}`}>{candidate.direction}</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{candidate.setup} · {candidate.timeframe}</p>
        </div>
        <div className="text-right">
          <span className="rounded border border-violet-400/30 bg-violet-400/10 px-2 py-1 font-mono text-[10px] font-bold text-violet-100">WAITING</span>
          <p className="mt-2 text-[10px] text-zinc-600">v{candidate.contractVersion}</p>
        </div>
      </header>

      <div className="grid gap-3 p-4 text-sm lg:grid-cols-2">
        <div>
          <p className="section-label">Trigger Proposal</p>
          <p className="font-semibold text-violet-100">{triggerLabel(candidate.trigger)}</p>
          <p className="mt-3 section-label">Structural Invalidation</p>
          <p className="font-semibold text-red-200">{price(candidate.structuralInvalidation?.price)}</p>
          <p className="mt-1 text-xs text-zinc-500">{candidate.structuralInvalidation?.rule || "—"}</p>
        </div>
        <div>
          <p className="section-label">Targets</p>
          <p className="text-zinc-300">{targetLabel(candidate.targets)}</p>
          <p className="mt-3 section-label">Requested Arm Mode</p>
          <p className="font-semibold text-zinc-200">{requestedMode}</p>
        </div>
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        <p className="section-label">Thesis</p>
        <p className="text-sm text-zinc-400">{candidate.thesis}</p>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3 text-[11px] text-zinc-600">
        <span>{candidate.source} · {candidate.sourceDate}</span>
        <span>Imported {importedLabel(candidate.importedAt)}</span>
      </footer>
    </article>
  );
}

export default function PreTradeWaitingBoard({ pretrade }) {
  const candidates = Array.isArray(pretrade?.state?.candidates) ? pretrade.state.candidates : [];
  const waiting = candidates.filter((candidate) => candidate.lifecycleState === "WAITING");
  const superseded = candidates.filter((candidate) => candidate.lifecycleState === "SUPERSEDED").length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-label">ExecutionOS · V2.4 Pre-Trade</p>
          <h2 className="text-lg font-semibold">Waiting Candidate Board</h2>
          <p className="mt-1 text-xs text-zinc-500">Imported proposals only. No candidate on this board is ARMED or eligible to bind a broker fill.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-2 rounded border px-3 py-2 text-xs font-semibold ${pretrade?.connected ? "border-violet-400/25 text-violet-100" : "border-red-400/25 text-red-200"}`}>
            {pretrade?.connected ? <ShieldCheck size={14} /> : <WifiOff size={14} />}
            {pretrade?.connected ? `WAITING ${waiting.length}` : "PRE-TRADE OFFLINE"}
          </span>
        </div>
      </div>

      {!pretrade?.connected && (
        <div className="rounded border border-red-400/20 bg-red-950/15 px-4 py-3 text-sm text-red-200">
          <div className="flex items-center gap-2 font-semibold"><WifiOff size={16} /> V2.4 pre-trade service is not connected.</div>
          <p className="mt-1 text-xs text-red-200/70">Start it with <span className="font-mono">npm run v24:pretrade</span>. V2.3 execution remains independent.</p>
        </div>
      )}

      {pretrade?.connected && !waiting.length && (
        <div className="rounded border border-white/10 bg-white/[0.02] px-4 py-4 text-sm text-zinc-500">
          <div className="flex items-center gap-2 font-semibold text-zinc-400"><Inbox size={16} /> No WAITING candidates.</div>
          <p className="mt-1 text-xs">SOD A+ candidates will appear here after a successful import.</p>
        </div>
      )}

      {waiting.length > 0 && (
        <div className="grid gap-3 xl:grid-cols-2">
          {waiting.map((candidate) => <CandidateCard key={`${candidate.candidateId}-${candidate.contractVersion}`} candidate={candidate} />)}
        </div>
      )}

      {pretrade?.connected && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-600">
          <span className="flex items-center gap-1"><Clock3 size={12} /> Updated {pretrade.state?.updatedAt ? importedLabel(pretrade.state.updatedAt) : "—"}</span>
          {superseded > 0 && <span>{superseded} superseded version{superseded === 1 ? "" : "s"} retained in the audit store</span>}
        </div>
      )}
    </section>
  );
}
