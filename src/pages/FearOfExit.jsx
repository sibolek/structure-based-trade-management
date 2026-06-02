import ChecklistCard from "../components/ChecklistCard.jsx";
import RuleCard from "../components/RuleCard.jsx";
import SectionPanel from "../components/SectionPanel.jsx";
import { fearExitProtocol } from "../data/checklists.js";

export default function FearOfExit() {
  return (
    <div className="space-y-4">
      <SectionPanel label="Fear-of-Exit Protocol" title="Check structure before acting">
        <div className="grid gap-3 md:grid-cols-3">
          <RuleCard title="Anti-Fear Rule" code="first" tone="blue">
            When fear rises, do not exit first. Check structure first.
          </RuleCard>
          <RuleCard title="Open-Profit Script" code="say" tone="green">
            Profit is pulling back. That is not a signal. Target, invalidation, or plan decides.
          </RuleCard>
          <RuleCard title="Failure Condition" code="exit" tone="red">
            Exit only when structure breaks, target hits, or a planned early-exit condition triggers.
          </RuleCard>
        </div>
      </SectionPanel>
      <ChecklistCard label="Protocol" title="Open Profit Pullback Process" items={fearExitProtocol} />
    </div>
  );
}
