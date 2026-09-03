import { useEffect, useState } from "react";
import { AlertTriangle, Eye, Radio, Trash2 } from "lucide-react";
import {
  readExecutionBoardStore,
  subscribeExecutionBoardStore,
} from "../execution/execution-board-store-repository.js";
import { isV24InstallationReservationActive } from "../execution/execution-v24-active-ownership.js";
import { evaluateV24InitialFillOwnership } from "../execution/execution-v24-initial-fill-matcher.js";
import { requestV24RetirementSerialized } from "../execution/execution-v24-retirement.js";
import V24TradeSpecificationModal from "./V24TradeSpecificationModal.jsx";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
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

function retirementFor(store, handoffId) {
  return (Array.isArray(store?.v24Retirements) ? store.v24Retirements : [])
    .find((item) => text(item?.handoffId) === text(handoffId)) || null;
}

function authorizationStatus({ installation, retirement, brokerState }) {
  const retirementStatus = upper(retirement?.status);
  if (retirementStatus === "REQUESTED") return { label: "DISCARD PENDING", tone: "amber", reason: null };
  if (retirementStatus === "RECONCILIATION_REQUIRED") return { label: "RECONCILIATION REQUIRED", tone: "red", reason: "Retirement interval could not be proven completely." };
  if (retirementStatus === "SUPERSEDED_BY_PRIOR_FILL") return { label: "PRIOR FILL OWNED", tone: "amber", reason: "A broker fill executed before the discard cutoff; LIVE promotion is pending." };
  if (upper(installation?.status) === "PREPARED") return { label: "PREPARED", tone: "amber", reason: null };
  if (upper(installation?.status) !== "LISTENING") return { label: upper(installation?.status) || "UNKNOWN", tone: "red", reason: null };

  const ownership = evaluateV24InitialFillOwnership({ installation, brokerState });
  if (ownership.status === "MATCHED") return { label: "FILL MATCHED", tone: "emerald", reason: "Atomic LIVE ownership transfer is pending." };
  if (ownership.status === "SUSPENDED") return { label: "AUTO-OWNERSHIP SUSPENDED", tone: "red", reason: ownership.reason };
  return { label: "LISTENING", tone: "emerald", reason: null };
}

function toneClass(tone) {
  if (tone === "red") return "border-red-400/30 bg-red-950/20 text-red-200";
  if (tone === "amber") return "border-amber-400/30 bg-amber-950/15 text-amber-100";
  return "border-emerald-400/30 bg-emerald-950/15 text-emerald-100";
}

export default function V24AuthorizedTradesBoard({ broker, v24Router } = {}) {
  const [store, setStore] = useState(() => {
    try { return readExecutionBoardStore(); } catch { return null; }
  });
  const [error, setError] = useState("");
  const [selectedHandoffId, setSelectedHandoffId] = useState(null);

  useEffect(() => subscribeExecutionBoardStore({
    listener: (snapshot) => {
      setStore(snapshot);
      setError("");
    },
  }), []);

  if (!store) {
    return <section className="rounded border border-red-400/30 bg-red-950/20 p-3 text-sm text-red-200">V2.4 authorization state is unavailable.</section>;
  }

  const installations = (Array.isArray(store.v24Installations) ? store.v24Installations : [])
    .filter((installation) => isV24InstallationReservationActive(store, installation));
  const routerProblem = v24Router?.error || "";
  const selectedInstallation = installations.find((installation) => installation.handoffId === selectedHandoffId) || null;
  const selectedRetirement = selectedInstallation ? retirementFor(store, selectedInstallation.handoffId) : null;
  const selectedStatus = selectedInstallation
    ? authorizationStatus({ installation: selectedInstallation, retirement: selectedRetirement, brokerState: broker?.state })
    : null;

  if (!installations.length && !routerProblem && !error) return null;

  const discard = async (installation) => {
    if (!window.confirm("Discard this V2.4 pre-fill listener? ExecutionOS will stop future fill eligibility after the approved cutoff protocol. Broker orders, if any, are unchanged.")) return;
    try {
      await requestV24RetirementSerialized({
        handoffId: installation.handoffId,
        receiverId: installation.receiverId,
        requestedAt: Date.now(),
        reason: "USER_DISCARD",
      });
      setError("");
    } catch (err) {
      setError(err?.code || err?.message || String(err));
    }
  };

  const openSpecification = (installation) => setSelectedHandoffId(installation.handoffId);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="section-label">V2.4 Authorized Trades</p>
          <h2 className="text-lg font-semibold">{installations.length} pre-fill authorization{installations.length === 1 ? "" : "s"}</h2>
          <p className="mt-1 text-xs text-zinc-500">Immutable V2.4 authorization. Click a card to inspect the complete frozen trade specification. DISCARD uses the durable retirement cutoff; EDIT requires a future Revise → Re-arm workflow.</p>
        </div>
        <Radio className="text-sky-300" size={20} />
      </div>

      {(routerProblem || error) && (
        <div className="rounded border border-red-400/30 bg-red-950/20 p-3 text-sm text-red-200">
          <div className="flex items-center gap-2"><AlertTriangle size={16} /><span className="font-semibold">V2.4 runtime attention required</span></div>
          <p className="mt-1 font-mono text-xs">{error || routerProblem}</p>
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        {installations.map((installation) => {
          const v24 = installation.compatibility?.v24 || {};
          const retirement = retirementFor(store, installation.handoffId);
          const status = authorizationStatus({ installation, retirement, brokerState: broker?.state });
          const discardDisabled = Boolean(retirement);
          return (
            <article
              key={installation.handoffId}
              role="button"
              tabIndex={0}
              aria-label={`View full trade specification for ${v24.symbol || "V2.4 authorization"}`}
              onClick={() => openSpecification(installation)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openSpecification(installation);
                }
              }}
              className="group cursor-pointer overflow-hidden rounded border border-sky-400/20 bg-ink-850 shadow-terminal transition hover:border-sky-300/40 hover:bg-ink-800/80 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
            >
              <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div>
                  <p className="section-label">V2.4 · {installation.status}</p>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-2xl font-bold">{v24.symbol}</h3>
                    <span className={v24.direction === "LONG" ? "font-bold text-emerald-300" : "font-bold text-red-300"}>{v24.direction}</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{v24.setup} · {v24.timeframe} · acct {accountDisplay(v24.authorizedExecutionAccountId)}</p>
                </div>
                <span className={`rounded border px-2 py-1 text-[10px] font-bold ${toneClass(status.tone)}`}>{status.label}</span>
              </header>

              <div className="grid grid-cols-2 border-b border-white/10 text-sm lg:grid-cols-5">
                <div className="p-3"><p className="section-label">Expected Entry</p><p className="font-semibold">{price(v24.currentExpectedEntry)}</p></div>
                <div className="p-3"><p className="section-label">Effective Stop</p><p className="font-semibold text-red-200">{price(v24.effectiveStop)}</p></div>
                <div className="p-3"><p className="section-label">Structural Invalid.</p><p className="font-semibold text-amber-100">{price(v24.structuralInvalidation)}</p></div>
                <div className="p-3"><p className="section-label">Authorized Qty</p><p className="font-semibold">{v24.selectedQuantity ?? "—"}</p></div>
                <div className="p-3"><p className="section-label">Frozen Max Risk</p><p className="font-semibold text-sky-100">{money(v24.authorizedMaxDollarRisk)}</p></div>
              </div>

              {status.reason && <div className={`m-3 rounded border p-3 text-sm ${toneClass(status.tone)}`}>{status.reason}</div>}

              <footer className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs text-zinc-500 transition group-hover:text-sky-200"><Eye size={13} /> View full trade specification</p>
                <button
                  type="button"
                  disabled={discardDisabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    discard(installation);
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  className="flex items-center gap-1 rounded border border-red-400/20 px-3 py-2 text-xs font-semibold text-red-300 disabled:opacity-35"
                >
                  <Trash2 size={13} /> DISCARD
                </button>
              </footer>
            </article>
          );
        })}
      </div>

      <V24TradeSpecificationModal
        installation={selectedInstallation}
        status={selectedStatus}
        onClose={() => setSelectedHandoffId(null)}
      />
    </section>
  );
}
