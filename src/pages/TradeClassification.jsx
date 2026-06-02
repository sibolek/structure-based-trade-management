import DecisionTable from "../components/DecisionTable.jsx";
import SectionPanel from "../components/SectionPanel.jsx";
import StatusPill from "../components/StatusPill.jsx";
import { classifications } from "../data/classifications.js";

export default function TradeClassification() {
  return (
    <div className="space-y-4">
      <SectionPanel label="Trade Identity" title="Classify before permission">
        <DecisionTable
          columns={[
            { key: "type", label: "Class" },
            { key: "status", label: "Mode", pill: true },
            { key: "allowed", label: "When allowed" },
            { key: "stop", label: "Stop logic" },
            { key: "target", label: "Target logic" },
            { key: "management", label: "Management" },
          ]}
          rows={classifications}
        />
      </SectionPanel>
      <section className="grid gap-3 md:grid-cols-4">
        {classifications.map((item) => (
          <article key={item.type} className="compact-card">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100">{item.type}</h3>
              <StatusPill tone={item.tone}>{item.status}</StatusPill>
            </div>
            <p className="text-sm leading-6 text-zinc-400">{item.management}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
