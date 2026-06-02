import ChecklistCard from "../components/ChecklistCard.jsx";
import DecisionTable from "../components/DecisionTable.jsx";
import RuleCard from "../components/RuleCard.jsx";
import SectionPanel from "../components/SectionPanel.jsx";
import { aPlusExceptionChecklist } from "../data/checklists.js";
import { riskTiers } from "../data/rubrics.js";

export default function RiskPermission() {
  return (
    <div className="space-y-4">
      <SectionPanel label="Risk Permission" title="Can I afford the correct structural stop?">
        <DecisionTable
          columns={[
            { key: "tier", label: "Tier", pill: true },
            { key: "label", label: "Permission" },
            { key: "criteria", label: "Criteria" },
            { key: "action", label: "Required action" },
          ]}
          rows={riskTiers}
        />
      </SectionPanel>
      <section className="grid gap-3 md:grid-cols-[0.85fr_1.15fr]">
        <SectionPanel label="Wider Risk" title="When wider risk is allowed">
          <div className="grid gap-2">
            <RuleCard title="Allowed" code="R3" tone="amber">
              Wider risk is allowed only when it is the correct structural stop and size is reduced.
            </RuleCard>
            <RuleCard title="Forbidden" code="R0" tone="red">
              Wider risk is not allowed because entry is late, fear is high, or the trade feels important.
            </RuleCard>
          </div>
        </SectionPanel>
        <ChecklistCard label="Supporting Rubric" title="A+ Exception Checklist" items={aPlusExceptionChecklist} />
      </section>
    </div>
  );
}
