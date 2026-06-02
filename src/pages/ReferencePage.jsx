import RuleCard from "../components/RuleCard.jsx";
import SectionPanel from "../components/SectionPanel.jsx";

const pageContent = {
  tradezella: {
    label: "TradeZella Note",
    title: "Post the execution facts, not the emotional story",
    cards: [
      { title: "Permission Result", code: "CORE", tone: "blue", body: "Which gate passed, failed, or was ignored?" },
      { title: "Stop Integrity", code: "STOP", tone: "amber", body: "Was invalidation structural and accepted before entry?" },
      { title: "Exit Reason", code: "EXIT", tone: "green", body: "Target, invalidation, written plan, or fear." },
      { title: "Correction", code: "REVIEW", tone: "neutral", body: "One rule that would have changed the decision." },
    ],
  },
  rubrics: {
    label: "Rubrics",
    title: "Operational scoring aids",
    cards: [
      { title: "Risk Tier", code: "RISK", tone: "amber", body: "R0 pass, R1 tactical, R2 standard, R3 reduced." },
      { title: "Exit Permission", code: "EXIT", tone: "green", body: "Exit only on target, invalidation, or planned early-exit condition." },
      { title: "Fear Check", code: "FEAR", tone: "red", body: "Name the fear, then check structure before action." },
    ],
  },
  cases: {
    label: "Case Studies",
    title: "Replay decisions against the permission model",
    cards: [
      { title: "Correct Read, No Trade", code: "CORE", tone: "blue", body: "Market idea was right, but permission did not pass." },
      { title: "Late Entry, Corrupted Stop", code: "STOP", tone: "red", body: "Entry timing made correct invalidation unaffordable." },
      { title: "Winner Exited By Fear", code: "FEAR", tone: "red", body: "Open profit pulled back, but structure remained intact." },
      { title: "Reduced Risk Done Correctly", code: "RISK", tone: "amber", body: "Wide structural stop accepted with smaller size." },
    ],
  },
};

export default function ReferencePage({ type }) {
  const content = pageContent[type] ?? pageContent.rubrics;

  return (
    <SectionPanel label={content.label} title={content.title}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {content.cards.map((card) => (
          <RuleCard key={card.title} title={card.title} code={card.code} tone={card.tone}>
            {card.body}
          </RuleCard>
        ))}
      </div>
    </SectionPanel>
  );
}
