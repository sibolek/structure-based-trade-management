import ManualCandidateImport from "./ManualCandidateImport.jsx";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileImage,
  Layers3,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  WifiOff,
  X,
} from "lucide-react";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
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

function byteLabel(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ResultSummary({ result }) {
  if (!result) return null;
  const lineage = Array.isArray(result.lineage) ? result.lineage : [];
  const publication = result.publication || null;
  const status = upper(result.stage || result.status);
  const candidatesAvailable = ["SUCCESS", "NO_CANDIDATES", "PRETRADE_PREFLIGHT_REQUIRED"].includes(status)
    && Array.isArray(result.lineage);
  const ambiguous = status === "RECOVERY_REQUIRED" && result.reason === "PROVIDER_OUTCOME_AMBIGUOUS";

  return (
    <section className="rounded border border-white/10 bg-ink-850/95 shadow-terminal">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="section-label">Latest SOD Result</p>
          <h3 className="text-lg font-semibold text-zinc-100">{result.sourceDate || "SOD"} · {status || "COMPLETE"}</h3>
        </div>
        <StatusChip good={status === "SUCCESS" || status === "NO_CANDIDATES"}>
          {status === "PRETRADE_PREFLIGHT_REQUIRED" ? "PRETRADE PREFLIGHT REQUIRED" : status || "COMPLETE"}
        </StatusChip>
      </header>

      <div className="grid gap-3 p-4 lg:grid-cols-3">
        <div className="rounded border border-white/10 bg-black/10 p-3">
          <p className="section-label">Candidates</p>
          <p className="mt-1 text-2xl font-bold text-zinc-100">{candidatesAvailable ? lineage.length : "Unavailable"}</p>
          {ambiguous && <p className="mt-1 text-sm text-amber-200">Candidates unavailable — provider outcome ambiguous</p>}
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

function TrustedChartSet({ sod }) {
  const charts = Array.isArray(sod?.charts) ? sod.charts : [];
  const maxBytes = sod?.health?.chartMaxBytes;

  async function upload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    await sod.uploadFiles(files).catch(() => {});
  }

  return (
    <section className="rounded border border-white/10 bg-ink-850/95 shadow-terminal">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="section-label">Trusted Chart Set</p>
          <h3 className="text-lg font-semibold text-zinc-100">Immutable chart ingestion</h3>
          <p className="mt-1 text-xs text-zinc-500">PNG, JPEG, or WebP screenshots are uploaded as bytes and replaced by opaque orchestrator-issued references.</p>
        </div>
        <label className={`inline-flex items-center gap-2 rounded border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-100 ${sod?.uploading || !sod?.connected ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}>
          <Upload size={14} />
          {sod?.uploading ? "UPLOADING" : "ADD CHARTS"}
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            disabled={sod?.uploading || !sod?.connected}
            onChange={upload}
            className="hidden"
          />
        </label>
      </header>

      <div className="p-4">
        {charts.length ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {charts.map((chart) => (
              <div key={chart.contentRef} className="rounded border border-emerald-400/20 bg-emerald-950/10 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FileImage size={15} className="shrink-0 text-emerald-300" />
                      <p className="truncate text-sm font-semibold text-zinc-200">{chart.displayName || "chart"}</p>
                    </div>
                    <p className="mt-2 font-mono text-[10px] text-zinc-500">{chart.mediaType} · {byteLabel(chart.byteLength)}</p>
                    <p className="mt-1 font-mono text-[10px] text-zinc-600">SHA {text(chart.sha256).slice(0, 12)}…</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => sod.removeChart(chart.contentRef)}
                    className="rounded border border-white/10 p-1.5 text-zinc-500 hover:border-red-400/30 hover:text-red-300"
                    title="Remove from current SOD selection"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded border border-dashed border-white/10 bg-black/10 px-4 py-8 text-center">
            <FileImage size={24} className="mx-auto text-zinc-600" />
            <p className="mt-2 text-sm font-semibold text-zinc-300">No charts selected</p>
            <p className="mt-1 text-xs text-zinc-500">Choose chart screenshots above. The browser never supplies a storage path.</p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
          <span>{Number.isFinite(Number(maxBytes)) ? `Maximum ${byteLabel(maxBytes)} per chart` : "Server size limit unavailable"}</span>
          {charts.length ? (
            <button type="button" onClick={sod.clearCharts} className="inline-flex items-center gap-1.5 text-zinc-500 hover:text-red-300">
              <Trash2 size={12} />
              Clear selection
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default function SodWorkspace({ sod, pretrade, onOpenPretrade }) {
  const [sourceDate, setSourceDate] = useState("");
  const charts = Array.isArray(sod?.charts) ? sod.charts : [];
  const inputsReady = Boolean(sourceDate && charts.length > 0);
  const serviceReady = Boolean(
    sod?.connected
    && sod?.health?.providerConfigured === true
    && sod?.health?.chartIngestion === "IMMUTABLE_OPAQUE_REF",
  );
  const unresolvedRun = sod?.lastResult?.runId
    && !["SUCCESS", "NO_CANDIDATES", "PRETRADE_PREFLIGHT_REQUIRED", "FAILED", "ABANDONED"].includes(sod.lastResult.stage);
  const dateClaimed = unresolvedRun && sod.lastResult.sourceDate === sourceDate;
  const canGenerate = serviceReady && inputsReady && !dateClaimed && !sod?.busy && !sod?.uploading;

  async function generate(mode) {
    if (!canGenerate) return;
    await sod.generate({
      sourceDate,
      generationMode: mode,
      charts: charts.map((chart) => ({
        chartId: chart.chartId,
        contentRef: chart.contentRef,
        label: chart.displayName || null,
      })),
    }).catch(() => {});
  }

  return (
    <div className="space-y-3">
      <ManualCandidateImport pretrade={pretrade} onOpenPretrade={onOpenPretrade} />
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
              <p className="section-label">Trusted Inputs</p>
            </div>
            <p className="mt-2 font-semibold text-zinc-200">{charts.length ? `${charts.length} chart reference(s) ready` : "No chart set"}</p>
            <p className="mt-2 text-xs text-zinc-500">References are issued only after local immutable ingestion and integrity validation.</p>
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

        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-white/10 px-4 py-3">
          <label className="text-xs text-zinc-500">
            SOD source date
            <input
              type="date"
              required
              value={sourceDate}
              onChange={(event) => setSourceDate(event.target.value)}
              className="mt-1 block rounded border border-white/10 bg-ink-900 px-2.5 py-2 font-mono text-xs text-zinc-200"
            />
          </label>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
            <div className="text-xs text-zinc-500">
              {dateClaimed ? <span className="text-amber-200">Resolve the existing run for {sourceDate} before starting another.</span>
                : sod?.error ? <span className="text-amber-200">{sod.error}</span>
                : !sourceDate ? "Select the chart session date before generation."
                : inputsReady ? `${charts.length} trusted chart(s) · ${sourceDate}` : "Add at least one trusted chart before generation."}
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
        </div>
      </section>

      <TrustedChartSet sod={sod} />
      <section className="rounded border border-white/10 p-4 text-sm text-zinc-300">
        <p>Provider {sod?.health?.providerLoaded ? "loaded" : "unavailable"} · Configuration {sod?.health?.providerConfigured ? "ready" : "missing"} · Model {sod?.health?.modelConfigured ? "configured" : "missing"} · Live acceptance {sod?.health?.liveAcceptanceValidated ? "validated" : "pending"}</p>
        {(sod?.lastResult?.runId || sod?.pendingRun?.runId) && <p className="mt-2 break-all font-mono text-xs">Run {sod.lastResult?.runId || sod.pendingRun.runId} · {sod.lastResult?.stage || "Status unknown"} {sod.lastResult?.reason || ""}</p>}
        {sod?.lastResult?.sourceDate && <p className="mt-2 text-xs">Recorded run source date: {sod.lastResult.sourceDate}</p>}
        {sod?.lastResult?.providerDiagnostics && <p className="mt-2 text-xs">Provider diagnostic: {sod.lastResult.providerDiagnostics.errorCode || "Unavailable"}
          {sod.lastResult.providerDiagnostics.elapsedMs != null && ` · ${sod.lastResult.providerDiagnostics.elapsedMs} ms elapsed`}
          {sod.lastResult.providerDiagnostics.phase && ` · Last observed phase: ${sod.lastResult.providerDiagnostics.phase}`}</p>}
        <div className="mt-3 flex gap-3">
          {sod?.pendingRun && <button disabled={sod.busy} onClick={() => sod.resumeRun()?.catch(() => {})}>Resume saved run</button>}
          {(sod?.lastResult?.runId || sod?.pendingRun?.runId) && <button onClick={() => sod.inspectRun(sod.lastResult?.runId || sod.pendingRun?.runId)}>Check run status</button>}
          {sod?.lastResult?.stage === "RECOVERY_REQUIRED" && sod?.lastResult?.reason === "PROVIDER_OUTCOME_AMBIGUOUS" && <button disabled={sod.busy} onClick={sod.abandonRun}>Abandon ambiguous run</button>}
        </div>
      </section>

      <ResultSummary result={sod?.lastResult} />
    </div>
  );
}
