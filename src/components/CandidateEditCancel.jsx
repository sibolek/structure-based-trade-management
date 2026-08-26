import { useEffect, useState } from "react";

const STORE_KEY = "execution-v23-store";
const REFRESH_MS = 300;

function readEditingDraft() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (!saved) return null;
    const store = JSON.parse(saved);
    const draft = store?.draft;
    const hasSavedRisk = String(draft?.risk?.expectedEntry ?? "").trim() || String(draft?.risk?.intendedSize ?? "").trim();
    if (draft?.phase !== "PLAN" || !draft?.originalPlan || !hasSavedRisk) return null;
    return draft;
  } catch {
    return null;
  }
}

function freshDraft() {
  return {
    phase: "PLAN",
    plan: {
      symbol: "",
      direction: "LONG",
      setup: "",
      timeframe: "2m",
      thesis: "",
      trigger: "",
      invalidation: "",
      structuralStop: "",
      target: "",
      management: "",
    },
    originalPlan: null,
    risk: { expectedEntry: "", intendedSize: "" },
  };
}

function decision(stage, action, note = "") {
  const now = new Date();
  return {
    id: `${Date.now()}-${Math.random()}`,
    timestamp: now.toISOString(),
    time: new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now),
    stage,
    state: "—",
    action,
    note,
  };
}

export default function CandidateEditCancel() {
  const [draft, setDraft] = useState(readEditingDraft);

  useEffect(() => {
    const refresh = () => setDraft(readEditingDraft());
    const timer = window.setInterval(refresh, REFRESH_MS);
    refresh();
    return () => window.clearInterval(timer);
  }, []);

  if (!draft) return null;

  const cancelEdit = () => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (!saved) return;
      const store = JSON.parse(saved);
      const currentDraft = store?.draft;
      if (!currentDraft?.originalPlan) return;

      const plan = { ...currentDraft.originalPlan };
      const now = new Date().toISOString();
      const candidate = {
        id: `${Date.now()}-${plan.symbol}`,
        phase: "ARMED",
        createdAt: now,
        armedAt: now,
        originalPlan: plan,
        risk: { ...currentDraft.risk },
        currentState: "VALID",
        broker: {
          account: null,
          entryPrice: null,
          entryQuantity: null,
          peakQuantity: null,
          currentQuantity: null,
          currentAveragePrice: null,
          entryDetectedAt: null,
          exitPrice: null,
          exitQuantity: null,
          flatDetectedAt: null,
        },
        decisions: [
          decision("PLAN", "EDIT CANCELED", "Original candidate restored without applying draft changes."),
          decision("ARM", "CANDIDATE RE-ARMED", "Listening only for fills detected after edit cancellation."),
        ],
      };

      store.candidates = [...(store.candidates || []), candidate];
      store.draft = freshDraft();
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      window.location.reload();
    } catch {
      // If local state cannot be safely restored, leave the draft untouched.
    }
  };

  return (
    <section className="px-3 pb-5 text-zinc-100 md:px-5">
      <div className="mx-auto max-w-7xl rounded border border-white/10 bg-ink-850/95 p-3 shadow-terminal">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-label">Editing Armed Candidate</p>
            <p className="text-sm text-zinc-400">
              Editing {draft.originalPlan.symbol} {draft.originalPlan.direction}. Cancel restores the original candidate and resumes listening from now.
            </p>
          </div>
          <button
            type="button"
            onClick={cancelEdit}
            className="rounded border border-white/15 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-sky-400/30 hover:text-sky-100"
          >
            CANCEL EDIT → RE-ARM ORIGINAL
          </button>
        </div>
      </div>
    </section>
  );
}
