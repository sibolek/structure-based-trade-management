import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Shield, Target } from "lucide-react";

function price(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}

function labelTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function reasonText(reasons) {
  return Array.isArray(reasons) && reasons.length ? reasons.join(" · ") : "None";
}

export default function V24LiveManagementPanel({ trade, onCommand }) {
  const management = trade?.broker?.liveManagement;
  const handoffId = trade?.v24?.handoffId;
  const [stopValue, setStopValue] = useState("");
  const [stopReason, setStopReason] = useState("");
  const [addQuantity, setAddQuantity] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [note, setNote] = useState("");
  const [targetPrices, setTargetPrices] = useState({});
  const [exceptionNotes, setExceptionNotes] = useState({});
  const [lastResult, setLastResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const openExceptions = useMemo(
    () => (Array.isArray(management?.authorizationExceptions) ? management.authorizationExceptions : [])
      .filter((item) => item.status !== "RECONCILED"),
    [management],
  );

  if (!management || !handoffId) return null;

  const run = async (action, payload = {}) => {
    setBusy(true);
    setError("");
    try {
      const response = await onCommand(handoffId, action, payload);
      setLastResult(response?.result ?? response ?? null);
      return response;
    } catch (cause) {
      setError(cause?.code || cause?.message || String(cause));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const risk = management.risk || {};
  const currentStop = management.currentEffectiveStop || {};
  const buildOpen = management.build?.status === "OPEN";

  return (
    <div className="mt-4 space-y-3 rounded border border-sky-400/20 bg-sky-950/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="section-label">V2.4 Live Management Authority</p>
          <p className="text-xs text-zinc-500">Revision {management.revision} · management state only · broker writes disabled</p>
        </div>
        <span className={`rounded-full border px-3 py-1 font-mono text-[11px] font-bold ${management.exposureIncreaseBlocked ? "border-red-400/30 bg-red-400/10 text-red-200" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"}`}>
          {management.exposureIncreaseBlocked ? "ADDS BLOCKED" : "ADD CHECK AVAILABLE"}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="compact-card"><p className="section-label">ARM Ceiling</p><p className="text-lg font-semibold">{management.armQuantityCeiling}</p></div>
        <div className="compact-card"><p className="section-label">Live Ceiling</p><p className="text-lg font-semibold text-sky-100">{management.liveManagementCeiling}</p></div>
        <div className="compact-card"><p className="section-label">Established Peak</p><p className="text-lg font-semibold">{management.establishedPeakQuantity}</p></div>
        <div className="compact-card"><p className="section-label">Build</p><p className="text-lg font-semibold">{management.build?.status || "—"}</p><p className="text-[11px] text-zinc-500">until {labelTime(management.build?.authorizedUntil)}</p></div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="compact-card"><p className="section-label">Current Stop</p><p className="text-lg font-semibold text-red-200">{price(currentStop.price)}</p><p className="text-[11px] text-zinc-500">{currentStop.source || "—"}</p></div>
        <div className="compact-card"><p className="section-label">Lifecycle Budget</p><p className="text-lg font-semibold">{money(risk.authorizedMaxDollarRisk)}</p></div>
        <div className="compact-card"><p className="section-label">Realized Loss Used</p><p className="text-lg font-semibold text-amber-100">{money(risk.cumulativeRealizedLosses)}</p></div>
        <div className="compact-card"><p className="section-label">Open Stop Risk</p><p className="text-lg font-semibold">{money(risk.openStopRisk)}</p></div>
        <div className="compact-card"><p className="section-label">Worst Case / Remaining</p><p className="text-sm font-semibold">{money(risk.aggregateWorstCaseLoss)}</p><p className="text-[11px] text-zinc-500">remaining {money(risk.remainingLossBudget)}</p></div>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <div className="rounded border border-zinc-700/70 p-3">
          <div className="flex items-center gap-2 font-semibold"><Shield size={16} />Position-build authority</div>
          <p className="mt-1 text-xs text-zinc-500">Completing build permanently relinquishes never-used initial capacity; it does not rewrite the ARM ceiling.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={busy || !buildOpen} onClick={() => run("COMPLETE_POSITION_BUILD")} className="rounded border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100 disabled:opacity-40">Complete Position Build</button>
            <button disabled={busy || management.futureExposureIncreaseDisabled} onClick={() => run("CLOSE_FURTHER_EXPOSURE")} className="rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-100 disabled:opacity-40">Disable Future Adds</button>
          </div>
        </div>

        <div className="rounded border border-zinc-700/70 p-3">
          <div className="font-semibold">Effective-stop authority</div>
          <p className="mt-1 text-xs text-zinc-500">This records ExecutionOS stop state only. It does not modify a broker stop order.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[120px_1fr_auto]">
            <input value={stopValue} onChange={(event) => setStopValue(event.target.value)} inputMode="decimal" placeholder="New stop" className="rounded border border-zinc-700 bg-ink-900 px-2 py-2 text-sm" />
            <input value={stopReason} onChange={(event) => setStopReason(event.target.value)} placeholder="Reason / rule" className="rounded border border-zinc-700 bg-ink-900 px-2 py-2 text-sm" />
            <button disabled={busy || !stopValue} onClick={() => run("SET_EFFECTIVE_STOP", { newStop: Number(stopValue), source: "OPERATOR", reason: stopReason || "OPERATOR_MANAGEMENT" })} className="rounded border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm font-semibold text-red-100 disabled:opacity-40">Record Stop</button>
          </div>
        </div>
      </div>

      <div className="rounded border border-zinc-700/70 p-3">
        <div className="font-semibold">Exposure-increase preflight</div>
        <p className="mt-1 text-xs text-zinc-500">Advisory only. The check never resizes or submits an order.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-[120px_140px_auto]">
          <input value={addQuantity} onChange={(event) => setAddQuantity(event.target.value)} inputMode="decimal" placeholder="Add qty" className="rounded border border-zinc-700 bg-ink-900 px-2 py-2 text-sm" />
          <input value={addPrice} onChange={(event) => setAddPrice(event.target.value)} inputMode="decimal" placeholder="Expected price" className="rounded border border-zinc-700 bg-ink-900 px-2 py-2 text-sm" />
          <button disabled={busy || !addQuantity || !addPrice} onClick={() => run("CHECK_EXPOSURE_INCREASE", { quantity: Number(addQuantity), expectedPrice: Number(addPrice), kind: "ADD" })} className="rounded border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-100 disabled:opacity-40">Check Add</button>
        </div>
        {lastResult?.action === "CHECK_EXPOSURE_INCREASE" && (
          <div className={`mt-2 rounded border p-2 text-sm ${lastResult.allowed ? "border-emerald-400/30 bg-emerald-950/15 text-emerald-100" : "border-amber-400/30 bg-amber-950/15 text-amber-100"}`}>
            <strong>{lastResult.allowed ? "ALLOWED" : "BLOCKED"}</strong> · max resulting qty {lastResult.maxPermittedResultingQuantity} · {reasonText(lastResult.reasonCodes)}
          </div>
        )}
      </div>

      {Array.isArray(management.targets) && management.targets.length > 0 && (
        <div className="rounded border border-zinc-700/70 p-3">
          <div className="flex items-center gap-2 font-semibold"><Target size={16} />Authorized targets</div>
          <p className="mt-1 text-xs text-zinc-500">Target observation records management state only; it never implies a broker exit.</p>
          <div className="mt-2 space-y-2">
            {management.targets.map((target) => (
              <div key={target.targetId} className="grid items-center gap-2 rounded border border-zinc-800 p-2 sm:grid-cols-[1fr_120px_auto]">
                <div><span className="font-mono text-xs font-bold">{target.targetId}</span><span className={`ml-2 text-xs ${target.status === "ATTAINED" ? "text-emerald-300" : "text-zinc-500"}`}>{target.status}</span></div>
                <input disabled={target.status === "ATTAINED"} value={targetPrices[target.targetId] || ""} onChange={(event) => setTargetPrices((current) => ({ ...current, [target.targetId]: event.target.value }))} inputMode="decimal" placeholder="Observed price" className="rounded border border-zinc-700 bg-ink-900 px-2 py-2 text-sm disabled:opacity-40" />
                <button disabled={busy || target.status === "ATTAINED" || !targetPrices[target.targetId]} onClick={() => run("RECORD_TARGET_OBSERVATION", { targetId: target.targetId, observation: { price: Number(targetPrices[target.targetId]), observedAt: new Date().toISOString(), source: "OPERATOR_OBSERVATION" } })} className="rounded border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100 disabled:opacity-40">Observe</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {openExceptions.length > 0 && (
        <div className="rounded border border-red-400/35 bg-red-950/15 p-3">
          <div className="flex items-center gap-2 font-semibold text-red-100"><AlertTriangle size={16} />Authorization exceptions</div>
          <p className="mt-1 text-xs text-red-200/70">CRITICAL exceptions remain add-blocking until explicit reconciliation.</p>
          <div className="mt-2 space-y-2">
            {openExceptions.map((item) => (
              <div key={item.exceptionId} className="rounded border border-red-400/20 p-2">
                <p className="font-mono text-xs font-bold text-red-200">{item.code} · {item.severity}</p>
                <p className="mt-1 text-[11px] text-zinc-500">{labelTime(item.occurredAt)}</p>
                <input value={exceptionNotes[item.exceptionId] || ""} onChange={(event) => setExceptionNotes((current) => ({ ...current, [item.exceptionId]: event.target.value }))} placeholder="Reconciliation note" className="mt-2 w-full rounded border border-zinc-700 bg-ink-900 px-2 py-2 text-sm" />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button disabled={busy} onClick={() => run("RECONCILE_EXCEPTION", { exceptionId: item.exceptionId, outcome: "CONTINUE_AFTER_REVIEW", note: exceptionNotes[item.exceptionId] || "Operator reviewed current compliance." })} className="rounded border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 disabled:opacity-40"><CheckCircle2 className="mr-1 inline" size={14} />Continue After Review</button>
                  <button disabled={busy} onClick={() => run("RECONCILE_EXCEPTION", { exceptionId: item.exceptionId, outcome: "CLOSE_TO_NEW_EXPOSURE", note: exceptionNotes[item.exceptionId] || "No further exposure increases authorized." })} className="rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100 disabled:opacity-40">Close to New Exposure</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded border border-zinc-700/70 p-3">
        <div className="font-semibold">Discretionary management note</div>
        <p className="mt-1 text-xs text-zinc-500">Notes are durable context and never become automatic authority.</p>
        <div className="mt-2 flex gap-2">
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="What changed in your read?" className="min-w-0 flex-1 rounded border border-zinc-700 bg-ink-900 px-2 py-2 text-sm" />
          <button disabled={busy || !note.trim()} onClick={async () => { const response = await run("RECORD_DISCRETIONARY_NOTE", { note }); if (response) setNote(""); }} className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm font-semibold disabled:opacity-40">Record</button>
        </div>
      </div>

      {error && <div className="rounded border border-red-400/30 bg-red-950/20 p-2 font-mono text-xs text-red-200">{error}</div>}
    </div>
  );
}
