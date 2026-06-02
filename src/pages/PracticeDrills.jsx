import SectionPanel from "../components/SectionPanel.jsx";
import { examples } from "../data/examples.js";

const drills = [
  "Mark invalidation before marking entry.",
  "Hide P&L and rehearse exit decisions from chart structure only.",
  "Replay one winner and identify every fear-exit temptation.",
  "Rewrite each bad exit as a permission rule.",
];

export default function PracticeDrills() {
  return (
    <div className="space-y-4">
      <SectionPanel label="Practice Drills" title="Train the management reflex">
        <ul className="rule-list">
          {drills.map((drill) => <li key={drill}>{drill}</li>)}
        </ul>
      </SectionPanel>
      <section className="grid gap-3 md:grid-cols-2">
        {examples.map((example) => (
          <article key={example.title} className="compact-card">
            <p className="section-label">Example</p>
            <h3 className="mb-2 text-sm font-semibold text-zinc-100">{example.title}</h3>
            <p className="mb-2 text-sm text-red-300">{example.problem}</p>
            <p className="text-sm text-zinc-400">{example.correction}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
