import {
  AlertTriangle,
  CircleCheck,
  Clock3,
  Radio,
  ShieldAlert,
} from "lucide-react";

function text(value) {
  return String(value ?? "").trim();
}

function timeLabel(value) {
  const raw = text(value);
  if (!raw) return "—";

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;

  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function presentation(status) {
  switch (text(status).toUpperCase()) {
    case "RUNNING":
      return {
        label: "RUNNING",
        detail: "V2.4 router healthy",
        tone: "emerald",
        attention: false,
        Icon: CircleCheck,
      };

    case "WAITING_FOR_SCHWAB":
      return {
        label: "WAITING FOR SCHWAB",
        detail: "Ownership-sensitive routing is waiting for authoritative broker state.",
        tone: "amber",
        attention: false,
        Icon: Clock3,
      };

    case "WAITING_FOR_PRETRADE":
      return {
        label: "WAITING FOR PRETRADE",
        detail: "Durable broker ownership continues; new transport work is waiting.",
        tone: "amber",
        attention: false,
        Icon: Clock3,
      };

    case "WAITING_FOR_ROUTER_LOCK":
      return {
        label: "PASSIVE TAB",
        detail: "Waiting for router leadership lock; routing may be active in another tab.",
        tone: "sky",
        attention: false,
        Icon: Radio,
      };

    case "PAUSED":
      return {
        label: "PAUSED",
        detail: "Router orchestration is paused. Durable execution ownership remains authoritative.",
        tone: "amber",
        attention: true,
        Icon: AlertTriangle,
      };

    case "STALE":
      return {
        label: "STALE",
        detail: "Router heartbeat exceeded its cadence tolerance. Web Lock ownership remains authoritative.",
        tone: "red",
        attention: true,
        Icon: ShieldAlert,
      };

    case "BLOCKED":
      return {
        label: "BLOCKED",
        detail: "Router progression is blocked by a known safety or capability condition.",
        tone: "red",
        attention: true,
        Icon: ShieldAlert,
      };

    case "ERROR":
      return {
        label: "ERROR",
        detail: "Router encountered an unexpected operational failure. Durable ownership is unchanged.",
        tone: "red",
        attention: true,
        Icon: ShieldAlert,
      };

    case "DISABLED_PENDING_ACCEPTANCE":
      return {
        label: "DISABLED PENDING ACCEPTANCE",
        detail: "Acceptance-only positive router gate remains off until Decision 22 is fully accepted.",
        tone: "zinc",
        attention: false,
        Icon: Radio,
      };

    default:
      return {
        label: text(status).toUpperCase() || "STARTING",
        detail: "V2.4 router service is initializing.",
        tone: "zinc",
        attention: false,
        Icon: Radio,
      };
  }
}

function failureLabel(failure) {
  if (!failure) return null;

  const identity = [
    text(failure.stage),
    text(failure.code),
    text(failure.symbol),
    text(failure.handoffId),
  ].filter(Boolean);

  return {
    identity: identity.join(" · "),
    message: text(failure.message),
    scope: text(failure.scope),
    recoverable: failure.recoverable === true
      ? "RECOVERABLE"
      : failure.recoverable === false
        ? "NON-RECOVERABLE"
        : "",
    occurredAt: failure.occurredAt,
  };
}

function toneClasses(tone, attention) {
  const base = attention
    ? "border-2 shadow-terminal"
    : "border";

  switch (tone) {
    case "emerald":
      return `${base} border-emerald-400/25 bg-emerald-950/15 text-emerald-100`;
    case "amber":
      return `${base} border-amber-400/30 bg-amber-950/15 text-amber-100`;
    case "red":
      return `${base} border-red-400/35 bg-red-950/25 text-red-100`;
    case "sky":
      return `${base} border-sky-400/25 bg-sky-950/15 text-sky-100`;
    default:
      return `${base} border-zinc-700 bg-zinc-900/50 text-zinc-200`;
  }
}

export default function V24RouterHealthPanel({ router } = {}) {
  const status = router?.status || "STARTING";
  const view = presentation(status);
  const Icon = view.Icon;
  const error = text(router?.error);
  const activeFailure = failureLabel(router?.activeError);
  const lastFailure = failureLabel(router?.lastFailure);
  const recoveredFailure = !activeFailure && lastFailure;

  return (
    <section
      aria-label="V2.4 router health"
      className={`rounded px-3 py-2 ${toneClasses(view.tone, view.attention)}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon size={16} className="shrink-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold tracking-wide">V2.4 ROUTER</span>
              <span className="rounded border border-current/20 px-1.5 py-0.5 text-[10px] font-bold">
                {view.label}
              </span>
              {router?.leader && (
                <span className="text-[10px] font-semibold text-zinc-400">LEADER</span>
              )}
            </div>

            {(view.attention || status !== "RUNNING") && (
              <p className="mt-1 text-xs opacity-90">{view.detail}</p>
            )}

            {error && !activeFailure && (
              <p className="mt-1 font-mono text-[10px] text-red-200">{error}</p>
            )}

            {activeFailure && (
              <div className="mt-2 rounded border border-red-400/30 bg-red-950/30 p-2 text-[10px]">
                <div className="flex flex-wrap items-center gap-2 font-semibold text-red-100">
                  <span>ACTIVE FAILURE</span>
                  <span className="font-mono">{activeFailure.identity}</span>
                  {activeFailure.scope && <span>{activeFailure.scope}</span>}
                  {activeFailure.recoverable && <span>{activeFailure.recoverable}</span>}
                </div>
                {activeFailure.message && (
                  <p className="mt-1 text-red-200">{activeFailure.message}</p>
                )}
              </div>
            )}

            {recoveredFailure && (
              <div className="mt-2 rounded border border-zinc-700 bg-zinc-950/40 p-2 text-[10px] text-zinc-400">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-zinc-300">LAST FAILURE · RECOVERED</span>
                  <span className="font-mono">{recoveredFailure.identity}</span>
                  {recoveredFailure.scope && <span>{recoveredFailure.scope}</span>}
                </div>
                {recoveredFailure.message && (
                  <p className="mt-1">{recoveredFailure.message}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-400">
          <span>Heartbeat <strong className="font-mono text-zinc-300">{timeLabel(router?.lastHeartbeatAt)}</strong></span>
          <span>Last success <strong className="font-mono text-zinc-300">{timeLabel(router?.lastSuccessfulCycleAt)}</strong></span>
          <span>Last failure <strong className="font-mono text-zinc-300">{timeLabel(router?.lastFailedCycleAt)}</strong></span>
        </div>
      </div>

      <p className="mt-1 text-[10px] text-zinc-500">
        Health and failure telemetry are observational only · execution ownership is unchanged · broker write authority: NONE
      </p>
    </section>
  );
}
