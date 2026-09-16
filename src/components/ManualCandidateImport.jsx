import { useRef, useState } from "react";
import { prepareManualCandidateImport, readCandidateJsonFile, manualImportError, manualImportOutcomeLabel } from "../pretrade/manual-candidate-import.js";

const fieldValue = value => value === undefined ? "Not supplied" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);

export default function ManualCandidateImport({ pretrade, onOpenPretrade }) {
  const [raw, setRaw] = useState("");
  const [prepared, setPrepared] = useState(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const edit = useRef(0);
  const submitting = useRef(false);
  const inputClass = "rounded border border-white/20 bg-ink-900 px-3 py-2 text-sm text-zinc-100";
  function changed(value) {
    edit.current++; setRaw(value); setPrepared(null); setResult(null); setError("");
  }
  function preview(value = raw) {
    setResult(null);
    try { setPrepared(prepareManualCandidateImport(value)); setError(""); }
    catch (err) { setPrepared(null); setError(err.message); }
  }
  async function fileSelected(files) {
    if (submitting.current) return;
    changed(""); const current = edit.current;
    if (files.length !== 1) { setError("Choose exactly one JSON file."); return; }
    try {
      const contents = await readCandidateJsonFile(files[0]);
      if (edit.current !== current) return;
      setRaw(contents); preview(contents);
    } catch (err) { if (edit.current === current) setError(err.message); }
  }
  async function submit() {
    if (!prepared || submitting.current || result) return;
    submitting.current = true; setBusy(true); setError(""); setResult(null);
    try {
      const response = prepared.kind === "manual-envelope"
        ? await pretrade.client.importManualEnvelope(prepared.body)
        : await pretrade.client.importCandidateBundle(prepared.body);
      if (!Array.isArray(response?.outcomes) || response.outcomes.length !== 1
        || !["ACCEPTED", "DUPLICATE", "CONFLICT", "STALE", "ACTION_REQUIRED", "REJECTED"].includes(response.outcomes[0]?.status)) {
        throw Object.assign(new Error("Canonical import result is unavailable"), { code: "MANUAL_IMPORT_INVALID_RESULT" });
      }
      setResult(response);
      // Refresh failure cannot turn a confirmed admission into an import failure.
      await pretrade.refreshNow?.().catch(() => {});
    } catch (err) { setError(manualImportError(err)); }
    finally { submitting.current = false; setBusy(false); }
  }
  const outcome = result?.outcomes[0]?.status;
  const importLabel = outcome === "ACCEPTED" ? "Imported ✓"
    : outcome === "DUPLICATE" ? "Already imported"
    : outcome ? "Not imported — review result"
    : busy ? "Importing…" : "Import into PRETRADE";
  const candidate = prepared?.candidate;
  const fields = candidate ? {
    Symbol: candidate.symbol, Direction: candidate.direction, Setup: candidate.setup,
    Trigger: candidate.trigger, "Structural invalidation": candidate.structuralInvalidation,
    Targets: candidate.targets, Source: prepared.source, sourceDate: prepared.sourceDate,
    candidateId: candidate.candidateId, contractVersion: candidate.contractVersion ?? (prepared.kind === "manual-envelope" ? "Resolved by existing manual lineage" : undefined),
  } : {};
  return (
    <section aria-label="Manual candidate import" className="rounded border border-white/10 bg-ink-850/95 p-4 shadow-terminal">
      <h2 className="text-xl font-semibold text-zinc-100">Import Candidate JSON</h2>
      <p className="mt-1 text-sm text-zinc-400">Add one intraday trade card to PRETRADE. Review the JSON, then import; permission, risk sizing and manual ARM follow in PRETRADE.</p>
      <div className="mt-4 space-y-3" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void fileSelected(Array.from(event.dataTransfer.files)); }}>
        <label className="block text-sm text-zinc-300">Choose JSON file
          <input type="file" accept=".json,application/json" disabled={busy} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) void fileSelected(files); }} className="mt-2 block text-sm" />
        </label>
        <p className="text-xs text-zinc-500">Or drop one .json file here. Maximum 768 KiB. Canonical candidates, one-candidate manual bundles, and existing standalone trade-card envelopes are supported.</p>
        <label className="block text-sm text-zinc-300">Paste candidate JSON
          <textarea value={raw} disabled={busy} spellCheck={false} maxLength={768 * 1024} onChange={event => changed(event.target.value)} rows={6} className={`${inputClass} mt-2 block w-full font-mono text-xs`} />
        </label>
        <button type="button" disabled={busy || !raw.trim()} onClick={() => preview()} className={`${inputClass} disabled:opacity-40`}>Preview JSON</button>
      </div>
      {error && <p role="alert" className="mt-3 rounded border border-amber-400/30 p-3 text-sm text-amber-200">{error}</p>}
      {prepared && <div className="mt-4 rounded border border-white/15 p-3">
        <h3 className="font-semibold text-zinc-100">Candidate preview</h3>
        <p className="mt-1 text-xs text-zinc-400">JSON parsed locally. PRETRADE validates the contract and identity on import. Optional content is preserved.</p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {Object.entries(fields).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-zinc-400">{label}</dt><dd className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm text-zinc-100">{fieldValue(value)}</dd></div>)}
        </dl>
        <button type="button" disabled={busy || !!result || !pretrade?.client || !pretrade?.connected} onClick={submit} className="mt-4 rounded border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-100 disabled:opacity-40">{importLabel}</button>
        {!pretrade?.connected && <p className="mt-2 text-xs text-amber-200">PRETRADE is offline. You can preview JSON now and import when it reconnects.</p>}
      </div>}
      {result && <div role="status" aria-label="Canonical import result" className="mt-4 rounded border border-white/15 p-3">
        <h3 className="font-semibold text-zinc-100">Canonical import result</h3>
        {(Array.isArray(result.outcomes) ? result.outcomes : []).map((outcome, index) => <div key={index} className="mt-2 text-sm text-zinc-200">
          <p>{manualImportOutcomeLabel(outcome.status)} · {outcome.status}{outcome.lifecycleState ? ` · ${outcome.lifecycleState} at admission` : ""}</p>
          <p className="break-all text-xs text-zinc-400">{outcome.candidateId} {outcome.contractVersion ? `· v${outcome.contractVersion}` : ""}</p>
          {(outcome.reasons || []).slice(0, 20).map((reason, i) => <p key={i} className="mt-1 text-xs text-zinc-400">{String(reason).slice(0, 500)}</p>)}
          {outcome.status === "ACTION_REQUIRED" && <p className="mt-2 text-xs text-amber-200">The prior candidate is unchanged. Complete the existing manual supersession review/authorization process before importing a replacement.</p>}
        </div>)}
        <p className="mt-3 text-xs text-zinc-400">PRETRADE shows current lifecycle state, including any validity expiration. Importing does not authorize ARM or create an Execution Board trade.</p>
        {onOpenPretrade && <button type="button" onClick={onOpenPretrade} className={`${inputClass} mt-3`}>Open PRETRADE</button>}
      </div>}
    </section>
  );
}
