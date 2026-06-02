import ChecklistCard from "../components/ChecklistCard.jsx";
import DecisionTable from "../components/DecisionTable.jsx";
import RuleCard from "../components/RuleCard.jsx";
import SectionPanel from "../components/SectionPanel.jsx";
import { beforeExitingWinnerChecklist } from "../data/checklists.js";
import { exitRubric } from "../data/rubrics.js";

export default function WinnerManagement() {
  return (
    <div className="space-y-4">
      <SectionPanel label="Winner Management Contract" title="Hold winners by plan, not by comfort">
        <div className="grid gap-3 md:grid-cols-3">
          <RuleCard title="Green Is Not An Exit" code="hold" tone="green">
            Open profit permits management. It does not cancel the target.
          </RuleCard>
          <RuleCard title="Pullback Is Not Failure" code="check" tone="blue">
            A pullback inside intact structure is normal trade movement.
          </RuleCard>
          <RuleCard title="No Fear Scalp" code="ban" tone="red">
            Do not enter for structure and exit because a winner becomes uncomfortable.
          </RuleCard>
        </div>
      </SectionPanel>
      <section className="grid gap-3 lg:grid-cols-[1fr_0.85fr]">
        <SectionPanel label="Exit Permission" title="Allowed versus forbidden early exits">
          <DecisionTable
            columns={[
              { key: "state", label: "State" },
              { key: "allowed", label: "Exit", pill: true },
              { key: "rule", label: "Rule" },
            ]}
            rows={exitRubric.map((row) => ({
              ...row,
              tone: row.allowed === "Yes" ? "green" : row.allowed === "No" ? "red" : "amber",
            }))}
          />
        </SectionPanel>
        <ChecklistCard label="Pause Before Exit" title="Winner Management Contract" items={beforeExitingWinnerChecklist} />
      </section>
    </div>
  );
}
