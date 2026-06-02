import RuleCard from "../components/RuleCard.jsx";
import SectionPanel from "../components/SectionPanel.jsx";
import { stopRules } from "../data/rubrics.js";

export default function StructuralStops() {
  return (
    <div className="space-y-4">
      <SectionPanel label="Invalidation & Stop Integrity" title="A stop marks the point where the thesis is wrong">
        <div className="grid gap-3 md:grid-cols-3">
          <RuleCard title="Definition" code="stop" tone="amber">
            Invalidation is the structural price area that proves the trade idea failed.
          </RuleCard>
          <RuleCard title="Discomfort" code="not stop" tone="red">
            Discomfort is information about size, timing, or fear. It is not invalidation.
          </RuleCard>
          <RuleCard title="Unaffordable Stop" code="pass" tone="red">
            If the correct stop is too expensive, reduce size or do not trade.
          </RuleCard>
        </div>
      </SectionPanel>
      <section className="grid gap-3 md:grid-cols-2">
        <SectionPanel label="Long Stops" title="Structure below must hold">
          <ul className="rule-list">
            {stopRules.long.map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
        </SectionPanel>
        <SectionPanel label="Short Stops" title="Structure above must reject">
          <ul className="rule-list">
            {stopRules.short.map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
        </SectionPanel>
      </section>
    </div>
  );
}
