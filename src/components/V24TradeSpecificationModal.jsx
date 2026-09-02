import { useEffect } from "react";
import { ChevronDown, X } from "lucide-react";

function text(value) {
  return String(value ?? "").trim();
}

function price(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function accountDisplay(accountId) {
  const id = text(accountId);
  if (!id) return "—";
  return `…${id.slice(-8)}`;
}

function timestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(parsed));
}

function displayTrigger(trigger) {
  if (!trigger || typeof trigger !== "object") return "—";
  const entries = Object.entries(trigger);
  if (!entries.length) return "—";
  return entries.map(([key, value]) => ({ key, value: typeof value === "object" ? JSON.stringify(value) : String(value) }));
}

function displayTargets(targets) {
  if (!Array.isArray(targets) || !targets.length) return ["—"];
  return targets.map((target) => price(target));
}

function Metric({ label, value, tone = "" }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <p className="section-label">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function Narrative({ label, children, emphasis = false }) {
  return (
    <section className={`rounded-lg border p-4 ${emphasis ? "border-sky-400/25 bg-sky-950/10" : "border-white/10 bg-black/20"}`}>
      <p className="section-label">{label}</p>
      <div className={`mt-2 leading-6 text-zinc-200 ${emphasis ? "text-base font-semibold" : "text-sm"}`}>{children}</div>
    </section>
  );
}

function ProvenanceRow({ label, value }) {
  return (
    <div className="grid gap-1 border-b border-white/5 py-2 text-xs last:border-b-0 sm:grid-cols-[180px_1fr]">
      <span className="text-zinc-500">{label}</span>
      <span className="break-all font-mono text-zinc-300">{value || "—"}</span>
    </div>
  );
}

export default function V24TradeSpecificationModal({ installation, status, onClose } = {}) {
  const v24 = installation?.compatibility?.v24 || {};

  useEffect(() => {
    if (!installation) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [installation, onClose]);

  if (!installation) return null;

  const triggerRows = displayTrigger(v24.trigger);
  const targets = displayTargets(v24.targets);
  const long = v24.direction === "LONG";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 px-4 py-8 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="v24-trade-specification-title"
        className="w-full max-w-5xl overflow-hidden rounded-2xl border border-sky-400/20 bg-ink-900 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 bg-gradient-to-r from-sky-950/30 via-transparent to-transparent px-5 py-5 sm:px-6">
          <div>
            <p className="section-label">V2.4 · Full Trade Specification</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h2 id="v24-trade-specification-title" className="text-3xl font-bold tracking-tight text-zinc-100">{v24.symbol || "—"}</h2>
              <span className={long ? "font-bold text-emerald-300" : "font-bold text-red-300"}>{v24.direction || "—"}</span>
              <span className="rounded border border-emerald-400/25 bg-emerald-950/20 px-2 py-1 text-[10px] font-bold text-emerald-200">{status?.label || installation.status}</span>
            </div>
            <p className="mt-2 text-xs text-zinc-500">{v24.timeframe || "—"} · acct {accountDisplay(v24.authorizedExecutionAccountId)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 p-2 text-zinc-400 transition hover:border-white/20 hover:bg-white/5 hover:text-zinc-100"
            aria-label="Close trade specification"
          >
            <X size={18} />
          </button>
        </header>

        <div className="space-y-5 p-5 sm:p-6">
          <Narrative label="Trade Setup" emphasis>{v24.setup || "—"}</Narrative>

          <div className="grid gap-4 lg:grid-cols-2">
            <Narrative label="Trade Thesis">{v24.thesis || "—"}</Narrative>
            <Narrative label="Entry Trigger">
              {Array.isArray(triggerRows) ? (
                <div className="space-y-2">
                  {triggerRows.map(({ key, value }) => (
                    <div key={key} className="grid grid-cols-[120px_1fr] gap-3">
                      <span className="font-mono text-xs uppercase tracking-wide text-sky-300">{key}</span>
                      <span>{value}</span>
                    </div>
                  ))}
                </div>
              ) : triggerRows}
            </Narrative>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="Expected Entry" value={price(v24.currentExpectedEntry)} />
            <Metric label="Effective Stop" value={price(v24.effectiveStop)} tone="text-red-200" />
            <Metric label="Structural Invalid." value={price(v24.structuralInvalidation)} tone="text-amber-100" />
            <Metric label="Authorized Qty" value={v24.selectedQuantity ?? "—"} />
            <Metric label="Frozen Max Risk" value={money(v24.authorizedMaxDollarRisk)} tone="text-sky-100" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Narrative label="Targets">
              <div className="flex flex-wrap gap-2">
                {targets.map((target, index) => (
                  <span key={`${target}-${index}`} className="rounded-md border border-emerald-400/20 bg-emerald-950/15 px-3 py-2 font-semibold text-emerald-100">T{index + 1} · {target}</span>
                ))}
              </div>
            </Narrative>
            <Narrative label="Management Plan">{v24.managementPlan || "—"}</Narrative>
          </div>

          <section className="rounded-lg border border-white/10 bg-black/20 p-4">
            <p className="section-label">Authorization Timeline</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div><p className="text-xs text-zinc-500">Authorized</p><p className="mt-1 text-sm text-zinc-200">{timestamp(v24.authorizedAt)}</p></div>
              <div><p className="text-xs text-zinc-500">Listening</p><p className="mt-1 text-sm text-zinc-200">{timestamp(v24.executionListeningAt)}</p></div>
              <div><p className="text-xs text-zinc-500">Handoff Created</p><p className="mt-1 text-sm text-zinc-200">{timestamp(v24.handoffCreatedAt)}</p></div>
            </div>
          </section>

          <details className="group rounded-lg border border-white/10 bg-black/20 p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-zinc-200">
              <span>Technical / API Provenance</span>
              <ChevronDown size={16} className="text-zinc-500 transition group-open:rotate-180" />
            </summary>
            <div className="mt-3 border-t border-white/10 pt-2">
              <ProvenanceRow label="Handoff ID" value={v24.handoffId} />
              <ProvenanceRow label="Source ID" value={v24.sourceId} />
              <ProvenanceRow label="Candidate ID" value={v24.candidateId} />
              <ProvenanceRow label="Contract Version" value={String(v24.contractVersion ?? "")} />
              <ProvenanceRow label="Candidate Content Hash" value={v24.candidateContentHash} />
              <ProvenanceRow label="DSS Evaluation ID" value={v24.dssEvaluationId} />
              <ProvenanceRow label="Risk Evaluation ID" value={v24.riskEvaluationId} />
              <ProvenanceRow label="Execution Board Receiver" value={v24.executionBoardReceiverId} />
              <ProvenanceRow label="Authorized Account ID" value={v24.authorizedExecutionAccountId} />
            </div>
          </details>

          <p className="text-center text-xs text-zinc-500">Read-only immutable authorization snapshot. Changes require Revise → Re-arm; this inspector never modifies broker orders.</p>
        </div>
      </section>
    </div>
  );
}
