import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Layers3,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from "lucide-react";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function trustedRequestReady(request) {
  return Boolean(
    request
    && text(request.sourceDate)
    && Array.isArray(request.charts)
    && request.charts.length > 0
    && request.charts.every((chart) => text(chart?.chartId) && text(chart?.contentRef)),
  );
}

function StatusChip({ good, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] font-semibold ${
      good
        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
        : "border-amber-400/25 bg-amber-400/10 text-amber-100"
    }`}>
      {good ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}
      {children}
    </span>
  );
}

function ResultSummary({ result }) {
  if (!result) return null;
  const lineage = Array.isArray(result.lineage) ? result.lineage : [];
  const publication = result.publication || null;
  const status = upper(result.status);

  return (
    <section className="rounded border border-white/10 bg-ink-850/95 shadow-terminal">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="section-label">Latest SOD Result</p>
          <h3 className="text-lg font-semibold text-zinc-100">{result.sourceDate || "SOD"} · {status || "COMPLETE"}</h3>
        </div>
        <StatusChip good={status === "READY_TO_PUBLISH" || status === "NO_CANDIDATES"}>
          {status === "PRETRADE_PREFLIGHT_REQUIRED" ? "PRETRADE PREFLIGHT REQUIRED" : status || "COMPLETE"}
        </StatusChip>
      </header>

      <div className="grid gap-3 p-4 lg:grid-cols-3">
        <div className="rounded border border-white/10 bg-black/10 p-3">
          <p className="section-label">Candidates</p>
          <p className="mt-1 text-2xl font-bold text-zinc-100">{lineage.length}</p>
          <p className="mt-1 text-xs text-zinc-500">Lineage is metadata only; PRETRADE remains lifecycle authority.</p>
        </div>
        <div className="rounded border border-white/10 bg-black/10 p-3">
          <p className="section-label">Candidate Publication</p>
          <p className="mt-1 font-semibold text-zinc-200">{publication?.finalName || "No publication"}</p>
          <p className="mt-1 text-xs text-zinc-500">{publication ? `${publication.byteLength} bytes · atomic inbox handoff` : "Nothing was delivered to the feeder."}</p>
        </div>
        <div className="rounded border border-white/10 bg-black/10 p-3">
          <p className="section-label">Artifacts</p>
          <p className="mt-1 text-sm text-zinc-300">Report {result.analysis?.report ? "available" : "not returned"} · Dashboard {result.analysis?.dashboard ? "available" : "not returned"}</p>
          <p className="mt-1 text-xs text-zinc-500">Artifact viewing/export will use a dedicated surface rather than raw HTML injection.</p>
        </div>
      </div>

      {lineage.length ? (
        <div className="border-t border-white/10 p-4">
          <p className="section-label">Candidate Lineage</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {lineage.map((item) => {
              const intent = (result.publicationIntents || []).find((candidate) => candidate.candidateId === item.candidateId);
              const classification = upper(item.classification);
              const tone = classification === "NEW"
                ? "border-emerald-400/25 bg-emerald-950/10"
                : classification === "REVISED"
                  ? "border-amber-400/25 bg-amber-950/10"
                  : "border-sky-400/25 bg-sky-950/10";
              return (
                <div key={`${item.candidateId}:${item.contractVersion}`} className={`rounded border p-3 ${tone}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-zinc-200">v{item.contractVersion} · {classification}</span>
                    {intent?.pretradePreflightRequired ? <AlertTriangle size={14} className="text-amber-300" /> : <CheckCircle2 size={14} className="text-emerald-300" />}
                  </div>
                  <p className="mt-2 break-all text-xs text-zinc-400">{item.candidateId}</p>
                  <p className="mt-2 text-[11px] text-zinc-500">{intent?.publicationIntent || "—"}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function SodWorkspace({ sod, trustedGenerationRequest = null }) {
  const inputsReady = trustedRequestReady(trustedGenerationRequest);
  const serviceReady = Boolean(sod?.connected && sod?.health?.providerConfigured === true);
  const canGenerate = serviceReady && inputsReady && !sod?.busy;

  async function generate(mode) {
    if (!canGenerate) return;
    await sod.generate({
      ...trustedGenerationRequest,
      generationMode: mode,
    }).catch(() => {});
  }

  return (
    <div className="space-y-3">
      <section className="rounded border border-white/10 bg-ink-850/95 shadow-terminal">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <p className="section-label">Start of Day</p>
            <h2 className="text-xl font-semibold text-zinc-100">Analysis orchestration and candidate publication</h2>
            <p className="mt-1 text-xs text-zinc-500">SOD proposes. PRETRADE decides. Execution remains downstream and manual-authority controlled.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusChip good={Boolean(sod?.connected)}>{sod?.connected ? "SOD SERVICE ONLINE" : "SOD SERVICE OFFLINE"}</StatusChip>
            <StatusChip good={sod?.health?.brokerWriteAuthority === false}>BROKER WRITE NONE</StatusChip>
          </div>
        </header>

        <div className="grid gap-3 p-4 lg:grid-cols-3">
          <div className="rounded border border-white/10 bg-black/10 p-3">
            <div className="flex items-center gap-2">
              {sod?.connected ? <Sparkles size={16} className="text-sky-300" /> : <WifiOff size={16} className="text-amber-300" />}
              <p className="section-label">Orchestration Service</p>
            </div>
            <p className="mt-2 font-mono text-xs text-zinc-300">{sod?.sodUrl || "—"}</p>
            <p className="mt-2 text-xs text-zinc-500">PRETRADE access: {sod?.health?.pretradeAccess || "unavailable"}</p>
          </div>

          <div className="rounded border border-white/10 bg-black/10 p-3">
            <div className="flex items-center gap-2">
              <Layers3 size={16} className={inputsReady ? "text-emerald-300" : "text-amber-300"} />
              <p className="section-label">Trusted Chart Set</p>
            </div>
            <p className="mt-2 font-semibold text-zinc-200">{inputsReady ? `${trustedGenerationRequest.charts.length} chart reference(s) ready` : "Not loaded"}</p>
            <p className="mt-2 text-xs text-zinc-500">No free-form filesystem or content-reference input is accepted here. Chart ingestion will supply trusted references.</p>
          </div>

          <div className="rounded border border-white/10 bg-black/10 p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-emerald-300" />
              <p className="section-label">Authority Boundary</p>
            </div>
            <p className="mt-2 text-sm text-zinc-300">Lifecycle: NONE · ARM: NONE · Execution: NONE</p>
            <p className="mt-2 text-xs text-zinc-500">Candidate delivery is limited to the atomic feeder inbox publication path.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
          <div className="text-xs text-zinc-500">
            {sod?.error ? <span className="text-amber-200">{sod.error}</span> : inputsReady ? `Source date ${trustedGenerationRequest.sourceDate}` : "Load a trusted chart set before generation."}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => generate("INITIAL")}
              disabled={!canGenerate}
              className="inline-flex items-center gap-2 rounded border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-100 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Play size={14} />
              {sod?.busy ? "GENERATING" : "GENERATE SOD"}
            </button>
            <button
              type="button"
              onClick={() => generate("REFRESH")}
              disabled={!canGenerate}
              className="inline-flex items-center gap-2 rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-bold text-zinc-300 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <RefreshCw size={14} />
              REFRESH SOD
            </button>
          </div>
        </div>
      </section>

      {!inputsReady ? (
        <section className="rounded border border-amber-400/20 bg-amber-950/10 p-4">
          <div className="flex items-start gap-3">
            <FileText size={18} className="mt-0.5 text-amber-300" />
            <div>
              <p className="font-semibold text-amber-100">Chart ingestion is the remaining input boundary.</p>
              <p className="mt-1 text-xs text-amber-100/60">The workspace is intentionally connected but generation-disabled until ExecutionOS can issue trusted chart references. This prevents browser-controlled local paths or fabricated content references from becoming analysis inputs.</p>
            </div>
          </div>
        </section>
      ) : null}

      <ResultSummary result={sod?.lastResult} />
    </div>
  );
}
