import RuleCard from "../components/RuleCard.jsx";
import SectionPanel from "../components/SectionPanel.jsx";
import { operatingModel, permissionGates, supportRubrics } from "../data/coreRules.js";

export default function FrontPageRules() {
  return (
    <div className="space-y-4">
      <SectionPanel label="Trade Permission Gate" title="A setup is not a trade until it passes permission">
        <div className="grid gap-3 md:grid-cols-2">
          {operatingModel.map((item) => (
            <RuleCard key={item.title} title={item.title} code={item.badge} tone={item.tone}>
              {item.body}
            </RuleCard>
          ))}
        </div>
      </SectionPanel>

      <SectionPanel label="Four-Gate Trade Permission Model" title="Before entry, all gates must answer cleanly">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {permissionGates.map((gate) => (
            <RuleCard key={gate.title} title={gate.title} code={gate.badge} tone={gate.tone}>
              {gate.question} {gate.check}
            </RuleCard>
          ))}
        </div>
      </SectionPanel>

      <SectionPanel label="Supporting Rubrics" title="Operational reference hierarchy">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {supportRubrics.map((rubric) => (
            <RuleCard key={rubric.label} title={rubric.label} code={rubric.badge} tone={rubric.tone}>
              {rubric.value}
            </RuleCard>
          ))}
        </div>
      </SectionPanel>
    </div>
  );
}
