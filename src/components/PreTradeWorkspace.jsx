import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  Inbox,
  Layers3,
  Link2,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Target,
  WifiOff,
  XCircle,
} from "lucide-react";
import useExecutionBoardProjection from "../hooks/useExecutionBoardProjection.js";
import {
  pretradeCandidateKey,
  projectPretradeWorkspace,
} from "../pretrade/pretrade-ui-projection.js";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function price(value) {
  if (value === null || value === undefined || text(value) === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(number);
}

function clock(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function statusTone(state) {
  const value = upper(state);
  if (["READY", "ARMED", "LIVE", "HISTORY"].includes(value)) return "border-emerald-400/30 bg-emerald-950/15 text-emerald-100";
  if (["CAUTION", "PERMISSION_EVALUATING", "PRETRADE_TRIGGER_EVALUATING", "PREPARED", "LISTENING"].includes(value)) return "border-amber-400/30 bg-amber-950/15 text-amber-100";
  if (["PASS", "INVALIDATED", "OCO_CANCELLED", "EXPIRED", "DECLINED", "RETIRED"].includes(value)) return "border-red-400/30 bg-red-950/15 text-red-200";
  return "border-violet-400/30 bg-violet-950/15 text-violet-100";
}

function reasonCodes(value) {
  return text(value)
    .split(/[\s,]+/)
    .map((item) => upper(item))
    .filter(Boolean);
}

function accountOptions(broker) {
  return (Array.isArray(broker?.state?.accounts) ? broker.state.accounts : [])
    .map((account) => ({
      accountId: text(account?.accountId),
      label: text(account?.account) || text(account?.displayAccount) || text(account?.accountId),
    }))
    .filter((account) => account.accountId);
}

function manualTriggerNodeIds(candidate) {
  const found = [];
  const seen = new Set();
  const visit = (node, fallbackId = "satisfaction") => {
    if (!node || typeof node !== "object") return;
    const type = upper(node.type);
    const nodeId = text(node.nodeId || node.id) || fallbackId;
    if (type === "MANUAL_CONFIRMATION" && !seen.has(nodeId)) {
      seen.add(nodeId);
      found.push(nodeId);
    }
    for (const key of ["children", "nodes", "conditions", "allOf", "anyOf"]) {
      for (const child of Array.isArray(node[key]) ? node[key] : []) visit(child, nodeId);
    }
    if (node.satisfaction && node.satisfaction !== node) visit(node.satisfaction, "satisfaction");
  };
  visit(candidate?.trigger, "satisfaction");
  return found;
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

function triggerNodeLabel(node) {
  if (!node || typeof node !== "object") return "";

  const type = upper(node.type);

  if (type === "MANUAL_CONFIRMATION") {
    return text(node.prompt) || "Manual confirmation";
  }

  if (type === "QUOTE_COMPARISON" || type === "BAR_CLOSE_COMPARISON") {
    const subject = type === "BAR_CLOSE_COMPARISON"
      ? `${text(node.timeframe) || "Bar"} close`
      : upper(node.side || "LAST");
    const operator = {
      GT: ">",
      GTE: "≥",
      LT: "<",
      LTE: "≤",
    }[upper(node.operator)] || upper(node.operator);
    const value = node.value ?? node.level;
    return [subject, operator, price(value)].filter(Boolean).join(" ");
  }

  if (type === "ALL_OF" || type === "ANY_OF") {
    const children = Array.isArray(node.children)
      ? node.children.map(triggerNodeLabel).filter(Boolean)
      : [];
    if (!children.length) return type.replaceAll("_", " ");
    return children.join(type === "ALL_OF" ? " AND " : " OR ");
  }

  return text(node.type).replaceAll("_", " ");
}

function triggerLabel(trigger) {
  if (!trigger || typeof trigger !== "object") return "—";
  const node = trigger.satisfaction && typeof trigger.satisfaction === "object"
    ? trigger.satisfaction
    : trigger;
  return triggerNodeLabel(node) || "Structured trigger";
}

function structuralInvalidationLabel(invalidation) {
  if (!invalidation || typeof invalidation !== "object") return "—";

  if (
    invalidation.price !== null
    && invalidation.price !== undefined
    && text(invalidation.price) !== ""
    && Number.isFinite(Number(invalidation.price))
  ) {
    return price(invalidation.price);
  }

  const reference = invalidation.reference && typeof invalidation.reference === "object"
    ? invalidation.reference
    : null;

  if (reference) {
    const originalText = text(reference.originalText);
    if (originalText) return originalText;

    const upperPrice = reference.upper ?? reference.high ?? reference.max;
    const lowerPrice = reference.lower ?? reference.low ?? reference.min;
    if (Number.isFinite(Number(upperPrice)) && Number.isFinite(Number(lowerPrice))) {
      return `${price(upperPrice)}–${price(lowerPrice)} zone`;
    }

    const referencePrice = reference.price ?? reference.value ?? reference.level;
    if (Number.isFinite(Number(referencePrice))) return price(referencePrice);
  }

  const referenceType = text(invalidation.referenceType).replaceAll("_", " ");
  return referenceType || "Resolve in PRETRADE";
}

function selectedQuantity(review) {
  const value = Number(review?.selectedQuantity?.value);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function currentReviewPackage(review) {
  return review?.currentPackage && typeof review.currentPackage === "object" ? review.currentPackage : null;
}

function unitLabel(review, quantity) {
  const assetType = upper(currentReviewPackage(review)?.material?.instrument?.assetType);
  if (assetType === "EQUITY") return Number(quantity) === 1 ? "SHARE" : "SHARES";
  if (assetType === "FUTURE") return Number(quantity) === 1 ? "CONTRACT" : "CONTRACTS";
  return Number(quantity) === 1 ? "UNIT" : "UNITS";
}

function assessmentInputs(draft) {
  const structuralStatus = upper(draft.structuralStatus);
  const permissionOutcome = upper(draft.permissionOutcome);
  const resolvedPrice = Number(draft.resolvedPrice);
  const structural = structuralStatus
    ? {
        status: structuralStatus,
        actor: "OPERATOR",
        evidenceReference: text(draft.structuralEvidence) || null,
        reasonCodes: reasonCodes(draft.structuralReasons),
        ...(Number.isFinite(resolvedPrice) && resolvedPrice > 0 ? { resolvedPrice } : {}),
      }
    : null;
  const permission = permissionOutcome
    ? {
        outcome: permissionOutcome,
        actor: "OPERATOR",
        note: text(draft.permissionEvidence) || null,
        reasonCodes: reasonCodes(draft.permissionReasons),
      }
    : null;
  return { structural, permission };
}

function baseDraft() {
  return {
    accountId: "",
    entryMode: "MARKETABLE_NOW",
    triggerPrice: "",
    structuralStatus: "",
    structuralEvidence: "",
    structuralReasons: "",
    resolvedPrice: "",
    permissionOutcome: "",
    permissionEvidence: "",
    permissionReasons: "",
    quantity: "",
  };
}

function CandidateHeader({ candidate, subtitle = null }) {
  const directionClass = upper(candidate.direction) === "LONG" ? "text-emerald-300" : "text-red-300";
  return (
    <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
      <div>
        <p className="section-label">{candidate.source || "PRETRADE"} · v{candidate.contractVersion}</p>
        <div className="flex items-baseline gap-2">
          <h3 className="text-2xl font-bold">{candidate.symbol}</h3>
          <span className={`font-bold ${directionClass}`}>{candidate.direction}</span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">{candidate.setup} · {candidate.timeframe}{subtitle ? ` · ${subtitle}` : ""}</p>
      </div>
      <span className={`rounded border px-2 py-1 font-mono text-[10px] font-bold ${statusTone(candidate.lifecycleState)}`}>
        {candidate.lifecycleState}
      </span>
    </header>
  );
}

function ReadOnlyPlan({ candidate }) {
  return (
    <div className="grid gap-3 p-4 text-sm lg:grid-cols-2">
      <div>
        <p className="section-label">Trigger</p>
        <p className="font-semibold text-violet-100">{triggerLabel(candidate.trigger)}</p>
        <p className="mt-3 section-label">Structural Invalidation</p>
        <p className="font-semibold text-red-200">{structuralInvalidationLabel(candidate.structuralInvalidation)}</p>
        <p className="mt-1 text-xs text-zinc-500">{candidate.structuralInvalidation?.rule || "—"}</p>
      </div>
      <div>
        <p className="section-label">Targets</p>
        <p className="text-zinc-300">{targetLabel(candidate.targets)}</p>
        <p className="mt-3 section-label">Thesis</p>
        <p className="text-zinc-400">{candidate.thesis || "—"}</p>
      </div>
    </div>
  );
}

function PermissionControls({ candidate, draft, setDraft, accounts, busy, onEvaluate }) {
  const exactCandidateStop = (
    candidate?.structuralInvalidation?.price !== null
    && candidate?.structuralInvalidation?.price !== undefined
    && Number.isFinite(Number(candidate.structuralInvalidation.price))
    && Number(candidate.structuralInvalidation.price) > 0
  ) ? String(candidate.structuralInvalidation.price) : "";

  const effectiveDraft = {
    ...draft,
    accountId: draft.accountId || (accounts.length === 1 ? accounts[0].accountId : ""),
    resolvedPrice: draft.resolvedPrice || exactCandidateStop,
  };

  const { structural, permission } = assessmentInputs(effectiveDraft);
  const needsPermissionReasons = ["CAUTION", "PASS"].includes(upper(effectiveDraft.permissionOutcome));
  const reasonMissing = needsPermissionReasons && reasonCodes(effectiveDraft.permissionReasons).length === 0;
  const structuralEvidenceMissing = (
    upper(effectiveDraft.structuralStatus) === "VALID"
    && !text(effectiveDraft.structuralEvidence)
  );
  return (
    <div className="space-y-3 border-t border-white/10 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="section-label">Permission Evaluation</p>
          <p className="text-xs text-zinc-500">No operator judgment is inferred. Leave an assessment blank only when a trusted evaluator is configured.</p>
        </div>
        <ShieldCheck size={17} className="text-sky-300" />
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <div className="text-xs text-zinc-500">
          <p>Exact account</p>
          {accounts.length === 1 ? (
            <div className="mt-1 rounded border border-emerald-400/20 bg-emerald-950/10 px-2 py-2 font-mono text-zinc-200">
              {accounts[0].label}
            </div>
          ) : (
            <select value={effectiveDraft.accountId} onChange={(event) => setDraft({ accountId: event.target.value })} className="mt-1 w-full rounded border border-white/10 bg-ink-900 px-2 py-2 text-zinc-200">
              <option value="">Select account</option>
              {accounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.label}</option>)}
            </select>
          )}
        </div>

        <label className="text-xs text-zinc-500">
          Entry mode
          <select value={effectiveDraft.entryMode} onChange={(event) => setDraft({ entryMode: event.target.value })} className="mt-1 w-full rounded border border-white/10 bg-ink-900 px-2 py-2 text-zinc-200">
            <option value="MARKETABLE_NOW">MARKETABLE NOW</option>
            <option value="STOP_TRIGGER">STOP TRIGGER</option>
          </select>
        </label>

        {effectiveDraft.entryMode === "STOP_TRIGGER" ? (
          <label className="text-xs text-zinc-500">
            Trigger price
            <input value={effectiveDraft.triggerPrice} onChange={(event) => setDraft({ triggerPrice: event.target.value })} inputMode="decimal" className="mt-1 w-full rounded border border-white/10 bg-ink-900 px-2 py-2 text-zinc-200" placeholder="Required" />
          </label>
        ) : (
          <div className="text-xs text-zinc-500">
            <p>Trigger price</p>
            <div className="mt-1 rounded border border-white/10 bg-black/10 px-2 py-2 text-zinc-500">Not required</div>
          </div>
        )}

        <label className="text-xs text-zinc-500">
          Structural stop
          <input
            value={effectiveDraft.resolvedPrice}
            onChange={(event) => setDraft({ resolvedPrice: event.target.value })}
            inputMode="decimal"
            readOnly={Boolean(exactCandidateStop)}
            className="mt-1 w-full rounded border border-white/10 bg-ink-900 px-2 py-2 text-zinc-200 read-only:text-emerald-200"
            placeholder="Resolve if dynamic"
          />
        </label>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <div className="rounded border border-white/10 bg-black/10 p-3">
          <p className="section-label">Structure</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {["VALID", "INVALID", "BLOCKED"].map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setDraft({ structuralStatus: status })}
                className={`rounded border px-3 py-2 text-xs font-bold ${
                  upper(effectiveDraft.structuralStatus) === status
                    ? status === "VALID"
                      ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-100"
                      : "border-red-400/40 bg-red-400/10 text-red-200"
                    : "border-white/10 text-zinc-500"
                }`}
              >
                {status}
              </button>
            ))}
          </div>
          <input
            value={effectiveDraft.structuralEvidence}
            onChange={(event) => setDraft({ structuralEvidence: event.target.value })}
            aria-required={upper(effectiveDraft.structuralStatus) === "VALID"}
            className="mt-2 w-full rounded border border-white/10 bg-ink-900 px-2 py-2 text-xs text-zinc-200"
            placeholder="Structure evidence / reference — required for VALID"
          />
          {structuralEvidenceMissing && (
            <p className="mt-1 text-xs text-red-300">
              Structure evidence is required when STRUCTURE = VALID.
            </p>
          )}
          {["INVALID", "BLOCKED"].includes(upper(effectiveDraft.structuralStatus)) && (
            <input value={effectiveDraft.structuralReasons} onChange={(event) => setDraft({ structuralReasons: event.target.value })} className="mt-2 w-full rounded border border-white/10 bg-ink-900 px-2 py-2 text-xs text-zinc-200" placeholder="Reason codes" />
          )}
        </div>

        <div className="rounded border border-white/10 bg-black/10 p-3">
          <p className="section-label">Setup / Context</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {["READY", "CAUTION", "PASS"].map((outcome) => (
              <button
                key={outcome}
                type="button"
                onClick={() => setDraft({ permissionOutcome: outcome })}
                className={`rounded border px-3 py-2 text-xs font-bold ${
                  upper(effectiveDraft.permissionOutcome) === outcome
                    ? outcome === "READY"
                      ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-100"
                      : outcome === "CAUTION"
                        ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
                        : "border-red-400/40 bg-red-400/10 text-red-200"
                    : "border-white/10 text-zinc-500"
                }`}
              >
                {outcome}
              </button>
            ))}
          </div>
          <input value={effectiveDraft.permissionEvidence} onChange={(event) => setDraft({ permissionEvidence: event.target.value })} className="mt-2 w-full rounded border border-white/10 bg-ink-900 px-2 py-2 text-xs text-zinc-200" placeholder="Optional context/evidence note" />
          {["CAUTION", "PASS"].includes(upper(effectiveDraft.permissionOutcome)) && (
            <input value={effectiveDraft.permissionReasons} onChange={(event) => setDraft({ permissionReasons: event.target.value })} className="mt-2 w-full rounded border border-white/10 bg-ink-900 px-2 py-2 text-xs text-zinc-200" placeholder="Required reason codes" />
          )}
        </div>
      </div>

      <button
        type="button"
        disabled={busy || !effectiveDraft.accountId || !effectiveDraft.entryMode || !effectiveDraft.structuralStatus || !effectiveDraft.permissionOutcome || structuralEvidenceMissing || reasonMissing}
        onClick={() => onEvaluate({ structural, permission, effectiveDraft })}
        className="flex items-center gap-2 rounded border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-100 disabled:opacity-35"
      >
        <ShieldCheck size={14} /> EVALUATE PERMISSION
      </button>
    </div>
  );
}

function ReviewControls({ candidate, review, draft, setDraft, pretrade, busy, run }) {
  const pkg = currentReviewPackage(review);
  const quantity = selectedQuantity(review);
  const rawMaxQuantity = Number(pkg?.material?.maxAffordableQuantity);
  const maxRiskSizedQuantity = Number.isFinite(rawMaxQuantity) && rawMaxQuantity > 0
    ? rawMaxQuantity
    : null;
  const cautionRequired = upper(candidate.lifecycleState) === "CAUTION";
  const cautionAcked = Boolean(review?.cautionAcknowledgment && text(review.cautionAcknowledgment.reviewPackageId) === text(pkg?.reviewPackageId));
  const ownershipConnected = pretrade?.health?.executionOwnershipAuthorityConnected === true;
  const recoveryBlocked = pretrade?.health?.armRecoveryBlocked === true;
  const accountId = text(pkg?.material?.accountId);
  const entryMode = upper(draft.entryMode);
  const { structural, permission } = assessmentInputs(draft);
  const armDisabled = busy
    || !pkg
    || !quantity
    || (cautionRequired && !cautionAcked)
    || !ownershipConnected
    || recoveryBlocked
    || !accountId
    || !entryMode;

  if (!pkg) {
    return (
      <div className="border-t border-white/10 p-4">
        <button type="button" disabled={busy} onClick={() => run(() => pretrade.client.refreshReview(candidate))} className="flex items-center gap-2 rounded border border-violet-400/30 bg-violet-400/10 px-3 py-2 text-xs font-bold text-violet-100 disabled:opacity-35">
          <RefreshCw size={14} /> PREPARE REVIEW PACKAGE
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-white/10 p-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <div><p className="section-label">Expected Entry</p><p className="font-semibold">{price(pkg.material.currentExpectedEntry)}</p></div>
        <div><p className="section-label">Effective Stop</p><p className="font-semibold text-red-200">{price(pkg.material.effectiveStop)}</p></div>
        <div><p className="section-label">Max Risk</p><p className="font-semibold text-sky-100">{money(pkg.material.maxDollarRisk)}</p></div>
        <div><p className="section-label">Max Qty</p><p className="font-semibold">{pkg.material.maxAffordableQuantity}</p></div>
        <div><p className="section-label">Account</p><p className="font-mono text-xs text-zinc-300">…{accountId.slice(-8)}</p></div>
      </div>

      {cautionRequired && (
        <div className="rounded border border-amber-400/25 bg-amber-950/15 p-3 text-xs text-amber-100">
          <p className="font-bold">CAUTION · {pkg.material.cautionReasonCodes.join(" · ")}</p>
          <button type="button" disabled={busy || cautionAcked} onClick={() => run(() => pretrade.client.acknowledgeCaution(candidate, pkg.reviewPackageId))} className="mt-2 rounded border border-amber-400/30 px-3 py-2 font-bold disabled:opacity-40">
            {cautionAcked ? "CAUTION ACKNOWLEDGED" : "ACKNOWLEDGE THIS CAUTION PACKAGE"}
          </button>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            disabled={busy || !maxRiskSizedQuantity}
            onClick={() => {
              setDraft({ quantity: String(maxRiskSizedQuantity) });
              run(() => pretrade.client.selectQuantity(candidate, pkg.reviewPackageId, maxRiskSizedQuantity));
            }}
            className="rounded border border-emerald-400/35 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100 disabled:opacity-35"
          >
            USE MAX RISK-SIZED QTY — {maxRiskSizedQuantity || "—"} {unitLabel(review, maxRiskSizedQuantity)}
          </button>

          <label className="text-xs text-zinc-500">
            Or choose smaller quantity
            <input
              value={draft.quantity}
              onChange={(event) => setDraft({ quantity: event.target.value })}
              inputMode="decimal"
              className="mt-1 w-32 rounded border border-white/10 bg-ink-900 px-2 py-2 text-zinc-100"
              placeholder={quantity ? String(quantity) : "Qty"}
            />
          </label>

          <button
            type="button"
            disabled={busy || !draft.quantity}
            onClick={() => run(() => pretrade.client.selectQuantity(candidate, pkg.reviewPackageId, draft.quantity))}
            className="rounded border border-white/15 px-3 py-2 text-xs font-bold text-zinc-200 disabled:opacity-35"
          >
            SET CUSTOM QTY
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => pretrade.client.refreshReview(candidate))}
            className="flex items-center gap-1 rounded border border-white/15 px-3 py-2 text-xs font-bold text-zinc-400 disabled:opacity-35"
          >
            <RefreshCw size={13} /> REFRESH REVIEW
          </button>
        </div>

        <p className="text-[11px] text-zinc-600">
          Max risk-sized quantity is the largest quantity permitted by the current authorized risk calculation. It is not a trade recommendation.
        </p>
      </div>

      {!ownershipConnected && (
        <div className="rounded border border-red-400/25 bg-red-950/15 p-3 text-xs text-red-200">
          <p className="font-bold">EXECUTION_OWNERSHIP_AUTHORITY_UNAVAILABLE</p>
          <p className="mt-1 text-red-200/70">Review remains usable, but final ARM is disabled. The browser will not claim the symbol is FREE on the server's behalf.</p>
        </div>
      )}
      {recoveryBlocked && (
        <div className="rounded border border-red-400/25 bg-red-950/15 p-3 text-xs text-red-200">ARM recovery reconciliation is unresolved. Authorization-changing actions remain blocked.</div>
      )}

      <button
        type="button"
        disabled={armDisabled}
        onClick={() => run(() => pretrade.client.arm(candidate, {
          reviewPackageId: pkg.reviewPackageId,
          selectedQuantity: quantity,
          accountId,
          entryMode,
          triggerPrice: draft.triggerPrice ? Number(draft.triggerPrice) : null,
          operatorStructuralAssessment: structural,
          operatorPermissionAssessment: permission,
        }))}
        className="flex items-center gap-2 rounded border border-emerald-400/35 bg-emerald-400/10 px-4 py-3 text-sm font-black text-emerald-100 disabled:opacity-30"
      >
        <ShieldCheck size={16} /> ARM {candidate.symbol} {candidate.direction} — {quantity || "—"} {unitLabel(review, quantity)}
      </button>
      <p className="text-[11px] text-zinc-600">The ARM button is the explicit quantity/direction confirmation. Enter-key submission is not wired to ARM.</p>
    </div>
  );
}

function ActiveCard({ item, pretrade, broker, drafts, updateDraft, busyKey, runFor }) {
  const candidate = item.candidate;
  const key = pretradeCandidateKey(candidate);
  const draft = drafts[key] || baseDraft();
  const accounts = accountOptions(broker);
  const state = upper(candidate.lifecycleState);
  const manualNodes = state === "PRETRADE_TRIGGER_EVALUATING" ? manualTriggerNodeIds(candidate) : [];
  const blocker = candidate.permissionBlocker || candidate.recoveryGate || null;
  const blockerReasons = blocker ? [...new Set([
    ...(Array.isArray(blocker.reasonCodes) ? blocker.reasonCodes : []),
    ...(Array.isArray(blocker.provenance?.reasonCodes) ? blocker.provenance.reasonCodes : []),
    blocker.reasonCode,
    blocker.code,
  ].map(upper).filter(Boolean))] : [];
  const busy = busyKey === key;
  const setDraft = (patch) => updateDraft(key, patch);
  const run = (action) => runFor(key, action);

  const terminalAction = (kind) => {
    const promptLabel = kind === "DECLINE" ? "Reason for declining this candidate:" : "Reason this candidate is structurally invalid:";
    const note = window.prompt(promptLabel, "");
    if (note === null) return;
    if (kind === "DECLINE") run(() => pretrade.client.decline(candidate, { note }));
    else run(() => pretrade.client.invalidate(candidate, { note }));
  };

  return (
    <article className={`overflow-hidden rounded border bg-ink-850 shadow-terminal ${item.projectionWarning ? "border-red-400/30" : "border-violet-400/20"}`}>
      <CandidateHeader candidate={candidate} subtitle={item.ocoGroup ? `OCO ${item.ocoGroup.groupId}` : null} />
      <ReadOnlyPlan candidate={candidate} />

      {item.projectionWarning && <div className="mx-4 mb-4 rounded border border-red-400/25 bg-red-950/15 p-3 text-xs text-red-200">{item.projectionWarning}. No mutation action is enabled for an unrecognized lifecycle state.</div>}

      {blocker && (
        <div className="mx-4 mb-4 rounded border border-amber-400/25 bg-amber-950/15 p-3 text-xs text-amber-100">
          <div className="space-y-1">
            {blockerReasons.length ? blockerReasons.map((reason, index) => (
              <p key={reason} className={index === 0 ? "font-bold" : "font-mono text-[11px] opacity-80"}>
                {reason}
              </p>
            )) : (
              <p className="font-bold">BLOCKED</p>
            )}
          </div>
          <p className="mt-2 opacity-70">{blocker.message || (blocker.retryable === false ? "Not retryable." : "Retry only after the prerequisite is resolved.")}</p>
        </div>
      )}

      {!item.projectionWarning && state === "WAITING" && (
        <div className="flex flex-wrap gap-2 border-t border-white/10 p-4">
          <button type="button" disabled={busy} onClick={() => run(() => pretrade.client.activate(candidate))} className="flex items-center gap-2 rounded border border-violet-400/30 bg-violet-400/10 px-3 py-2 text-xs font-bold text-violet-100 disabled:opacity-35"><Play size={13} /> ACTIVATE</button>
          <button type="button" disabled={busy} onClick={() => terminalAction("DECLINE")} className="rounded border border-white/10 px-3 py-2 text-xs font-bold text-zinc-400 disabled:opacity-35">DECLINE</button>
          <button type="button" disabled={busy} onClick={() => terminalAction("INVALIDATE")} className="rounded border border-red-400/20 px-3 py-2 text-xs font-bold text-red-300 disabled:opacity-35">INVALIDATE</button>
        </div>
      )}

      {!item.projectionWarning && state === "PRETRADE_TRIGGER_EVALUATING" && (
        <div className="space-y-2 border-t border-white/10 p-4">
          {manualNodes.length ? (
            manualNodes.map((nodeId) => (
              <button key={nodeId} type="button" disabled={busy} onClick={() => run(() => pretrade.client.confirmManualTrigger(candidate, nodeId))} className="mr-2 rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-100 disabled:opacity-35">CONFIRM MANUAL TRIGGER · {nodeId}</button>
            ))
          ) : <p className="text-xs text-zinc-500">Automatic trigger evidence is evaluated by the authoritative trigger engine.</p>}
          <button type="button" disabled={busy} onClick={() => run(() => pretrade.client.returnToWaiting(candidate))} className="rounded border border-white/10 px-3 py-2 text-xs font-bold text-zinc-500 disabled:opacity-35">RETURN TO WAITING</button>
        </div>
      )}

      {!item.projectionWarning && state === "PERMISSION_EVALUATING" && (
        <PermissionControls
          candidate={candidate}
          draft={draft}
          setDraft={setDraft}
          accounts={accounts}
          busy={busy}
          onEvaluate={({ structural, permission, effectiveDraft }) => run(() => pretrade.client.evaluatePermission(candidate, {
            accountId: effectiveDraft.accountId,
            entryMode: effectiveDraft.entryMode,
            triggerPrice: effectiveDraft.triggerPrice ? Number(effectiveDraft.triggerPrice) : null,
            operatorStructuralAssessment: structural,
            operatorPermissionAssessment: permission,
          }))}
        />
      )}

      {!item.projectionWarning && ["READY", "CAUTION"].includes(state) && (
        <ReviewControls candidate={candidate} review={item.review} draft={draft} setDraft={setDraft} pretrade={pretrade} busy={busy} run={run} />
      )}

      {!item.projectionWarning && state !== "WAITING" && (
        <div className="flex flex-wrap gap-2 border-t border-white/10 px-4 py-3">
          <button type="button" disabled={busy} onClick={() => terminalAction("DECLINE")} className="rounded border border-white/10 px-3 py-2 text-[11px] font-bold text-zinc-500 disabled:opacity-35">DECLINE</button>
          <button type="button" disabled={busy} onClick={() => terminalAction("INVALIDATE")} className="rounded border border-red-400/20 px-3 py-2 text-[11px] font-bold text-red-300 disabled:opacity-35">INVALIDATE</button>
        </div>
      )}
    </article>
  );
}

function AuthorizedCard({ item }) {
  const candidate = item.candidate;
  const executionState = item.execution?.executionState || "UNAVAILABLE";
  return (
    <article className="overflow-hidden rounded border border-sky-400/20 bg-ink-850 shadow-terminal">
      <CandidateHeader candidate={candidate} subtitle={`Execution ${executionState}`} />
      <div className="grid gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="section-label">Selected Qty</p><p className="font-semibold">{candidate.arm?.selectedQuantity ?? "—"}</p></div>
        <div><p className="section-label">Execution Account</p><p className="font-mono text-xs">…{text(candidate.arm?.executionAccountId).slice(-8) || "—"}</p></div>
        <div><p className="section-label">Handoff</p><p className="break-all font-mono text-[11px] text-zinc-400">{candidate.arm?.handoffId || "—"}</p></div>
        <div><p className="section-label">Downstream</p><span className={`inline-block rounded border px-2 py-1 text-[10px] font-bold ${statusTone(executionState)}`}>{executionState}</span></div>
      </div>
      {!item.execution?.projectionAvailable && <div className="mx-4 mb-4 rounded border border-amber-400/25 bg-amber-950/15 p-3 text-xs text-amber-100">Downstream projection is unavailable. PRETRADE remains ARMED; this UI does not infer Execution state.</div>}
    </article>
  );
}

function HistoryCard({ item }) {
  const candidate = item.candidate;
  const state = item.execution?.executionState || candidate.lifecycleState;
  const reason = candidate.terminalOutcome?.reasonCode || candidate.terminalOutcome?.note || null;
  return (
    <article className="overflow-hidden rounded border border-white/10 bg-ink-850/70">
      <CandidateHeader candidate={candidate} subtitle={item.execution ? `Execution ${state}` : "Terminal unarmed"} />
      <div className="grid gap-3 p-4 text-sm lg:grid-cols-3">
        <div><p className="section-label">Outcome</p><p className="font-semibold">{state}</p></div>
        <div><p className="section-label">Reason</p><p className="text-zinc-400">{reason || "—"}</p></div>
        <div><p className="section-label">Authorization</p><p className="text-zinc-400">{candidate.arm ? `${candidate.arm.selectedQuantity} · ${candidate.arm.handoffId}` : "Never ARMED"}</p></div>
      </div>
    </article>
  );
}

function OcoPanel({ projection, pretrade, broker, selected, setSelected, busyKey, runFor }) {
  const activeGroups = (Array.isArray(pretrade?.state?.ocoGroups) ? pretrade.state.ocoGroups : []).filter((group) => ["ACTIVE", "COMMITTING"].includes(upper(group.status)));
  const activeCandidates = projection.active.map((item) => item.candidate);
  const selectedCandidates = activeCandidates.filter((candidate) => selected.includes(pretradeCandidateKey(candidate)));
  const accounts = accountOptions(broker);
  const [accountId, setAccountId] = useState("");
  const symbols = [...new Set(selectedCandidates.map((candidate) => upper(candidate.symbol)).filter(Boolean))];
  const canCreate = selectedCandidates.length >= 2 && symbols.length === 1 && Boolean(accountId) && !busyKey;

  const toggle = (candidate) => {
    const key = pretradeCandidateKey(candidate);
    setSelected((prior) => prior.includes(key) ? prior.filter((value) => value !== key) : [...prior, key]);
  };

  const create = () => runFor("OCO_CREATE", async () => {
    const result = await pretrade.client.createOco({ accountId, members: selectedCandidates });
    setSelected([]);
    return result;
  });

  if (activeCandidates.length < 2 && !activeGroups.length) return null;

  return (
    <section className="rounded border border-white/10 bg-black/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <div><p className="section-label">Same-Symbol OCO</p><p className="text-xs text-zinc-500">OCO is explicit only. Similar symbol/setup candidates are never grouped automatically.</p></div>
        <Link2 size={16} className="text-violet-300" />
      </div>

      {activeGroups.length > 0 && <div className="mt-3 space-y-2">{activeGroups.map((group) => (
        <div key={group.groupId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-violet-400/20 bg-violet-950/10 p-2 text-xs">
          <div><span className="font-bold text-violet-100">{group.groupId}</span><span className="ml-2 text-zinc-500">{group.symbol} · {group.status} · acct …{text(group.accountId).slice(-8)}</span><p className="mt-1 text-zinc-600">{group.members.map((member) => `${member.candidateId} v${member.contractVersion}`).join(" · ")}</p></div>
          {group.status === "ACTIVE" && <button type="button" disabled={Boolean(busyKey)} onClick={() => {
            if (window.confirm(`Dissolve OCO group ${group.groupId}?`)) runFor(`OCO:${group.groupId}`, () => pretrade.client.dissolveOco(group.groupId));
          }} className="rounded border border-red-400/20 px-2 py-1 font-bold text-red-300 disabled:opacity-35">DISSOLVE</button>}
        </div>
      ))}</div>}

      {activeCandidates.length >= 2 && (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
          <div className="flex flex-wrap gap-2">{activeCandidates.map((candidate) => {
            const key = pretradeCandidateKey(candidate);
            const alreadyGrouped = projection.active.find((item) => pretradeCandidateKey(item.candidate) === key)?.ocoGroup;
            return <label key={key} className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${alreadyGrouped ? "border-white/5 text-zinc-700" : "border-white/10 text-zinc-400"}`}><input type="checkbox" disabled={Boolean(alreadyGrouped)} checked={selected.includes(key)} onChange={() => toggle(candidate)} /> {candidate.symbol} {candidate.direction} · v{candidate.contractVersion}</label>;
          })}</div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-zinc-500">Common execution account
              <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="mt-1 block rounded border border-white/10 bg-ink-900 px-2 py-2 text-zinc-200"><option value="">Select account</option>{accounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.label}</option>)}</select>
            </label>
            <button type="button" disabled={!canCreate} onClick={create} className="rounded border border-violet-400/30 bg-violet-400/10 px-3 py-2 text-xs font-bold text-violet-100 disabled:opacity-35">CREATE OCO FROM SELECTED</button>
          </div>
          {selectedCandidates.length >= 2 && symbols.length !== 1 && <p className="text-xs text-red-300">Selected OCO members must have the exact same symbol.</p>}
        </div>
      )}
    </section>
  );
}

export default function PreTradeWorkspace({ pretrade, broker }) {
  const execution = useExecutionBoardProjection();
  const projection = useMemo(() => projectPretradeWorkspace(pretrade?.state, execution.store), [pretrade?.state, execution.store]);
  const [tab, setTab] = useState("ACTIVE");
  const [drafts, setDrafts] = useState({});
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [ocoSelected, setOcoSelected] = useState([]);

  const updateDraft = (key, patch) => setDrafts((prior) => ({
    ...prior,
    [key]: { ...(prior[key] || baseDraft()), ...patch },
  }));

  const runFor = async (key, action) => {
    if (busyKey) return;
    setBusyKey(key);
    setNotice("");
    setError("");
    try {
      const result = await action();
      await pretrade.refreshNow();
      setNotice(result?.result?.status || result?.result?.lifecycleState || result?.result?.outcome || "Command committed");
      return result;
    } catch (err) {
      setError(err?.code || err?.message || String(err));
      return null;
    } finally {
      setBusyKey("");
    }
  };

  const tabs = [
    { id: "ACTIVE", label: "Active", count: projection.counts.active, icon: Layers3 },
    { id: "AUTHORIZED", label: "Authorized / Execution", count: projection.counts.authorizedExecution, icon: ShieldCheck },
    { id: "HISTORY", label: "History", count: projection.counts.history, icon: History },
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-label">ExecutionOS · V2.4 Pre-Trade</p>
          <h2 className="text-lg font-semibold">PRETRADE Workspace</h2>
          <p className="mt-1 text-xs text-zinc-500">Authoritative server state, intent-only browser commands, read-only downstream Execution projection.</p>
        </div>
        <span className={`flex items-center gap-2 rounded border px-3 py-2 text-xs font-semibold ${pretrade?.connected ? "border-violet-400/25 text-violet-100" : "border-red-400/25 text-red-200"}`}>
          {pretrade?.connected ? <ShieldCheck size={14} /> : <WifiOff size={14} />}
          {pretrade?.connected ? `PRETRADE ONLINE · ${projection.counts.total}` : "PRETRADE OFFLINE"}
        </span>
      </div>

      {!pretrade?.connected && <div className="rounded border border-red-400/20 bg-red-950/15 px-4 py-3 text-sm text-red-200"><div className="flex items-center gap-2 font-semibold"><WifiOff size={16} /> V2.4 pretrade service is not connected.</div><p className="mt-1 text-xs text-red-200/70">Start <span className="font-mono">npm run v24:pretrade</span>. Existing downstream Execution ownership remains independent.</p></div>}
      {execution.error && <div className="rounded border border-amber-400/20 bg-amber-950/15 px-4 py-3 text-xs text-amber-100"><AlertTriangle size={14} className="mr-2 inline" />Execution projection unavailable: {execution.error}. ARMED records remain ARMED and are not guessed into History.</div>}
      {error && <div className="rounded border border-red-400/25 bg-red-950/15 px-4 py-3 text-xs font-mono text-red-200"><ShieldAlert size={14} className="mr-2 inline" />{error}</div>}
      {notice && <div className="rounded border border-emerald-400/20 bg-emerald-950/10 px-4 py-2 text-xs text-emerald-100"><CheckCircle2 size={14} className="mr-2 inline" />{notice}</div>}

      <div className="flex flex-wrap gap-2 rounded border border-white/10 bg-ink-850 p-2">
        {tabs.map(({ id, label, count, icon: Icon }) => <button key={id} type="button" onClick={() => setTab(id)} className={`flex items-center gap-2 rounded px-3 py-2 text-xs font-bold ${tab === id ? "bg-violet-400/15 text-violet-100" : "text-zinc-500 hover:text-zinc-300"}`}><Icon size={14} /> {label} <span className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px]">{count}</span></button>)}
      </div>

      {tab === "ACTIVE" && (
        <div className="space-y-3">
          <OcoPanel projection={projection} pretrade={pretrade} broker={broker} selected={ocoSelected} setSelected={setOcoSelected} busyKey={busyKey} runFor={runFor} />
          {!projection.active.length ? <div className="rounded border border-white/10 bg-white/[0.02] px-4 py-5 text-sm text-zinc-500"><Inbox size={16} className="mr-2 inline" />No active PRETRADE candidates.</div> : <div className="grid gap-3 xl:grid-cols-2">{projection.active.map((item) => <ActiveCard key={pretradeCandidateKey(item.candidate)} item={item} pretrade={pretrade} broker={broker} drafts={drafts} updateDraft={updateDraft} busyKey={busyKey} runFor={runFor} />)}</div>}
        </div>
      )}

      {tab === "AUTHORIZED" && (!projection.authorizedExecution.length ? <div className="rounded border border-white/10 bg-white/[0.02] px-4 py-5 text-sm text-zinc-500"><Target size={16} className="mr-2 inline" />No ARMED candidates currently projected in Execution.</div> : <div className="grid gap-3 xl:grid-cols-2">{projection.authorizedExecution.map((item) => <AuthorizedCard key={pretradeCandidateKey(item.candidate)} item={item} />)}</div>)}

      {tab === "HISTORY" && (!projection.history.length ? <div className="rounded border border-white/10 bg-white/[0.02] px-4 py-5 text-sm text-zinc-500"><History size={16} className="mr-2 inline" />No PRETRADE history records.</div> : <div className="grid gap-3 xl:grid-cols-2">{projection.history.map((item) => <HistoryCard key={pretradeCandidateKey(item.candidate)} item={item} />)}</div>)}

      {pretrade?.connected && <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-600"><span className="flex items-center gap-1"><Clock3 size={12} /> Updated {clock(pretrade.state?.updatedAt)}</span><span>broker write authority: NONE</span><span>browser state authority: NONE</span></div>}
    </section>
  );
}
