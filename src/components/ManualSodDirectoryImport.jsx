import { useRef, useState } from "react";
import { CheckCircle2, FolderSearch, LoaderCircle, ShieldCheck } from "lucide-react";

import { manualImportError, manualImportOutcomeLabel } from "../pretrade/manual-candidate-import.js";
import {
  prepareManualSodDirectoryResponse,
  validateManualSodImportResult,
} from "../pretrade/manual-sod-directory-import.js";

function field(value) {
  return value === undefined ? "Not supplied" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

function resultTone(status) {
  return ["ACCEPTED", "DUPLICATE"].includes(status)
    ? "border-emerald-400/25 bg-emerald-950/10 text-emerald-100"
    : "border-amber-400/25 bg-amber-950/10 text-amber-100";
}

export default function ManualSodDirectoryImport({
  pretrade,
  sourceDate,
  onSourceDateChange,
  onOpenPretrade,
}) {
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const generation = useRef(0);
  const submitting = useRef(false);
  const currentPackage = loaded?.sourceDate === sourceDate ? loaded : null;
  const items = currentPackage?.items || [];
  const pendingSelected = items.filter((item) => item.selected && !item.result && !item.busy);

  function changeDate(value) {
    generation.current++;
    setLoaded(null);
    setError("");
    onSourceDateChange(value);
  }

  function updateItem(key, patch) {
    setLoaded((value) => value ? {
      ...value,
      items: value.items.map((item) => item.key === key ? { ...item, ...patch } : item),
    } : value);
  }

  async function load() {
    if (loading || submitting.current || !sourceDate || !pretrade?.client) return;
    const requestGeneration = ++generation.current;
    setLoading(true);
    setError("");
    setLoaded(null);
    try {
      const response = await pretrade.client.loadManualSodCandidates(sourceDate);
      const prepared = prepareManualSodDirectoryResponse(response, sourceDate);
      if (generation.current !== requestGeneration) return;
      setLoaded({
        ...prepared,
        items: prepared.candidates.map((candidate) => ({
          ...candidate,
          key: `${candidate.prepared.candidate.candidateId}:${candidate.prepared.candidate.contractVersion}`,
          selected: true,
          busy: false,
          result: null,
          error: "",
        })),
      });
    } catch (loadError) {
      if (generation.current === requestGeneration) {
        const code = String(loadError?.code || "MANUAL_SOD_LOAD_FAILED");
        setError(`${code}: ${loadError?.message || "The local SOD package could not be loaded."}`);
      }
    } finally {
      if (generation.current === requestGeneration) setLoading(false);
    }
  }

  async function importSelected() {
    if (submitting.current || !pretrade?.connected || !pendingSelected.length) return;
    submitting.current = true;
    setImporting(true);
    setError("");
    try {
      for (const item of pendingSelected) {
        updateItem(item.key, { busy: true, error: "" });
        try {
          const response = item.prepared.kind === "manual-envelope"
            ? await pretrade.client.importManualEnvelope(item.prepared.body)
            : await pretrade.client.importCandidateBundle(item.prepared.body);
          const result = validateManualSodImportResult(response, item.prepared);
          updateItem(item.key, { busy: false, result, error: "", selected: false });
        } catch (importError) {
          updateItem(item.key, { busy: false, error: manualImportError(importError) });
        }
      }
      await pretrade.refreshNow?.().catch(() => {});
    } finally {
      submitting.current = false;
      setImporting(false);
    }
  }

  return (
    <section aria-label="Generated SOD candidate intake" className="rounded border border-sky-400/20 bg-ink-850/95 shadow-terminal">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="section-label">Local SOD package</p>
          <h2 className="text-xl font-semibold text-zinc-100">Load generated candidates</h2>
          <p className="mt-1 text-sm text-zinc-400">Read the dated JSON package from this Mac, review it, then explicitly import selected candidates into PRETRADE.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-100">
          <ShieldCheck size={13} /> NO AI API CALL
        </span>
      </header>

      <div className="flex flex-wrap items-end gap-3 p-4">
        <label className="text-xs text-zinc-400">
          SOD trading date
          <input
            type="date"
            value={sourceDate}
            disabled={loading || importing}
            onChange={(event) => changeDate(event.target.value)}
            className="mt-1 block rounded border border-white/15 bg-ink-900 px-2.5 py-2 font-mono text-xs text-zinc-100 disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          disabled={!sourceDate || loading || importing || !pretrade?.client}
          onClick={load}
          className="inline-flex items-center gap-2 rounded border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? <LoaderCircle size={15} className="animate-spin" /> : <FolderSearch size={15} />}
          {loading ? "Loading…" : "Load SOD candidates"}
        </button>
        <p className="max-w-xl text-xs text-zinc-500">Expected folder: ~/Downloads/ExecutionOS/SOD/{sourceDate || "YYYY-MM-DD"}/individual-candidates</p>
      </div>

      {error ? <p role="alert" className="mx-4 mb-4 rounded border border-amber-400/30 p-3 text-sm text-amber-200">{error}</p> : null}

      {currentPackage ? (
        <div className="border-t border-white/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-zinc-100">{currentPackage.delivery.status} · {items.length} candidate{items.length === 1 ? "" : "s"}</p>
              <p className="mt-1 text-xs text-zinc-400">{currentPackage.delivery.message}</p>
              <p className="mt-1 break-all font-mono text-[11px] text-zinc-600">{currentPackage.packageDirectory}</p>
            </div>
            {items.length ? (
              <button
                type="button"
                disabled={importing || !pretrade?.connected || pendingSelected.length === 0}
                onClick={importSelected}
                className="inline-flex items-center gap-2 rounded border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {importing ? <LoaderCircle size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                {importing ? "Importing…" : `Import selected into PRETRADE (${pendingSelected.length})`}
              </button>
            ) : null}
          </div>

          {!pretrade?.connected && items.length ? <p className="mt-3 text-xs text-amber-200">PRETRADE is offline. The local package is available for review, but import is disabled.</p> : null}

          {items.length ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {items.map((item) => {
                const candidate = item.prepared.candidate;
                const outcome = item.result?.outcomes?.[0];
                return (
                  <article key={item.key} className="rounded border border-white/10 bg-black/10 p-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${candidate.symbol} candidate`}
                        checked={item.selected}
                        disabled={importing || item.busy || Boolean(item.result)}
                        onChange={(event) => updateItem(item.key, { selected: event.target.checked })}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-semibold text-zinc-100">{candidate.symbol} · {candidate.direction}</h3>
                          <span className="font-mono text-[11px] text-zinc-500">v{candidate.contractVersion}</span>
                        </div>
                        <p className="mt-1 text-sm text-zinc-300">{field(candidate.setup)}</p>
                        <p className="mt-1 break-all text-[11px] text-zinc-500">{candidate.candidateId}</p>
                        <p className="mt-1 truncate font-mono text-[10px] text-zinc-600">{item.filename} · {item.byteLength} bytes</p>
                        <details className="mt-2 text-xs text-zinc-400">
                          <summary className="cursor-pointer text-zinc-300">Review trade structure</summary>
                          <dl className="mt-2 grid gap-2">
                            <div><dt className="text-zinc-500">Trigger</dt><dd className="whitespace-pre-wrap break-words">{field(candidate.trigger)}</dd></div>
                            <div><dt className="text-zinc-500">Structural invalidation</dt><dd className="whitespace-pre-wrap break-words">{field(candidate.structuralInvalidation)}</dd></div>
                            <div><dt className="text-zinc-500">Targets</dt><dd className="whitespace-pre-wrap break-words">{field(candidate.targets)}</dd></div>
                          </dl>
                        </details>
                      </div>
                    </div>
                    {outcome ? (
                      <div role="status" className={`mt-3 rounded border p-2 text-xs ${resultTone(outcome.status)}`}>
                        {manualImportOutcomeLabel(outcome.status)} · {outcome.status}{outcome.lifecycleState ? ` · ${outcome.lifecycleState}` : ""}
                        {(outcome.reasons || []).slice(0, 10).map((reason, index) => <p key={index} className="mt-1">{String(reason).slice(0, 500)}</p>)}
                      </div>
                    ) : null}
                    {item.error ? <p role="alert" className="mt-3 rounded border border-amber-400/30 p-2 text-xs text-amber-200">{item.error}</p> : null}
                  </article>
                );
              })}
            </div>
          ) : null}

          {items.some((item) => item.result) && onOpenPretrade ? (
            <button type="button" onClick={onOpenPretrade} className="mt-4 rounded border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-zinc-200">Open PRETRADE</button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
