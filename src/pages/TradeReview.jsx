import ChecklistCard from "../components/ChecklistCard.jsx";
import SectionPanel from "../components/SectionPanel.jsx";
import { tradeReviewChecklist } from "../data/checklists.js";

const reviewRows = [
  ["Read", "What structure did I read correctly or incorrectly?"],
  ["Setup", "Was there a valid setup, or only a market opinion?"],
  ["Entry", "Was entry close enough to structural invalidation?"],
  ["Stop", "Was the stop the real invalidation point?"],
  ["Target", "Was target defined before entry?"],
  ["Exit", "Did I exit by target, invalidation, plan, or fear?"],
];

export default function TradeReview() {
  return (
    <div className="space-y-4">
      <SectionPanel label="Execution Review" title="Match entry, stop, target, and exit to plan">
        <div className="grid gap-2">
          {reviewRows.map(([label, prompt]) => (
            <div key={label} className="grid gap-2 rounded border border-white/10 bg-white/[0.025] p-3 sm:grid-cols-[110px_1fr]">
              <span className="font-mono text-[11px] uppercase text-sky-300">{label}</span>
              <span className="text-sm text-zinc-400">{prompt}</span>
            </div>
          ))}
        </div>
      </SectionPanel>
      <ChecklistCard label="Review Checklist" title="Plan Compliance" items={tradeReviewChecklist} />
    </div>
  );
}
