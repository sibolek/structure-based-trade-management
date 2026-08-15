import { Ban, ClipboardCheck, OctagonAlert, ShieldCheck } from "lucide-react";
import ChecklistCard from "../components/ChecklistCard.jsx";
import DecisionTable from "../components/DecisionTable.jsx";
import RuleCard from "../components/RuleCard.jsx";
import SectionPanel from "../components/SectionPanel.jsx";
import StatusPill from "../components/StatusPill.jsx";

const activeRules = ["MES ONLY", "FOUR TRADES MAX", "NO RECOVERY TRADING", "STRUCTURE BEFORE CERTAINTY"];

const regimeRows = [
  { rule: "Live instrument", requirement: "MES only" },
  { rule: "Max trades per day", requirement: "4" },
  { rule: "Max losing trades", requirement: "2" },
  { rule: "ES", requirement: "Not allowed live" },
  { rule: "MNQ", requirement: "Observation or paper only" },
  { rule: "MCL", requirement: "Observation only unless separately planned" },
  { rule: "Recovery trades", requirement: "Forbidden" },
  { rule: "Silent clicks", requirement: "Forbidden" },
];

const beforeEntryItems = [
  "This is MES.",
  "I have taken fewer than 4 trades today.",
  "I have fewer than 2 losses today.",
  "I am not trying to recover a loss.",
  "The trade is at a meaningful level.",
  "The setup has a name.",
  "The trigger has occurred.",
  "The signal bar has closed.",
  "The stop is structural.",
  "The stop is affordable.",
  "The first target is clear.",
  "The trade is not in the middle.",
  "I can explain the trade in 20 seconds.",
];

const allowedTrades = [
  "Breakout pullback",
  "Failed breakout",
  "Failed breakdown",
  "Reclaim of ORH / ORL / VWAP / YDC / PMH / PML",
  "Wedge reversal at support or resistance",
  "Double bottom / double top with confirmation",
  "Breakout mode resolution with retest",
  "Higher-low or lower-high continuation after clean level test",
];

const forbiddenTrades = [
  "First break in breakout mode without retest/follow-through",
  "Middle-of-range trades",
  "EMA-tangle trades",
  "Trades with unaffordable structural stop",
  "Trades taken because price is moving without me",
  "Trades taken to recover",
  "ES/MNQ trades because MES feels too slow",
  "Any trade that cannot be explained in one clean sentence",
];

const stopConditions = [
  "4 trades have been taken",
  "2 losing trades have been taken",
  "Daily loss limit is hit",
  "A rule is broken and the urge to continue appears",
  "I want to make back money",
  "The next trade cannot be explained in one clean sentence",
];

const scorecardRows = [
  { category: "Instrument discipline", requirement: "MES only", grade: "", notes: "" },
  { category: "Trade count", requirement: "1–4 trades", grade: "", notes: "" },
  { category: "Loss limit discipline", requirement: "0–2 losing trades", grade: "", notes: "" },
  { category: "Setup clarity", requirement: "Setup named before entry", grade: "", notes: "" },
  { category: "Level discipline", requirement: "Trade taken at predefined zone", grade: "", notes: "" },
  { category: "Trigger discipline", requirement: "Trigger occurred after setup was valid", grade: "", notes: "" },
  { category: "Stop discipline", requirement: "Stop placed at structural invalidation", grade: "", notes: "" },
  { category: "Target discipline", requirement: "Target defined before entry", grade: "", notes: "" },
  { category: "No recovery trading", requirement: "No trade taken to get money back", grade: "", notes: "" },
  { category: "Emotional control", requirement: "No revenge, rescue, or urgency trades", grade: "", notes: "" },
  { category: "Journal quality", requirement: "Every trade tagged and reviewed", grade: "", notes: "" },
];

const rubrics = [
  "No silent clicks.",
  "I want a good trade, not my money back.",
  "If I want my money back, I stop trading.",
  "Missing a trade is not a mistake.",
  "Structure before certainty.",
  "A correct read is not automatically a setup.",
  "A valid setup is not automatically a trade.",
  "A trade requires context, location, trigger, logical stop, target room, invalidation, and affordable risk.",
];

function RuleStrip() {
  return (
    <section className="rounded border border-red-400/30 bg-red-950/20 p-4 shadow-terminal">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {activeRules.map((rule) => (
          <div key={rule} className="rounded border border-red-300/20 bg-black/20 px-3 py-3 text-center">
            <p className="font-mono text-sm font-semibold uppercase tracking-wide text-red-100">{rule}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ExecutionDiscipline() {
  return (
    <div className="space-y-4">
      <RuleStrip />

      <section className="grid gap-3 xl:grid-cols-[0.85fr_1.15fr]">
        <SectionPanel label="Active Regime" title="20-session MES-only discipline block">
          <div className="mb-4 flex flex-wrap gap-2">
            <StatusPill tone="green">ACTIVE</StatusPill>
            <StatusPill tone="blue">MES only</StatusPill>
            <StatusPill tone="amber">20 sessions</StatusPill>
            <StatusPill tone="red">No recovery</StatusPill>
          </div>
          <p className="mb-4 text-sm leading-6 text-zinc-400">
            Chart analysis is improving faster than live execution. This block closes that gap by making execution boring,
            consistent, and non-emotional.
          </p>
          <DecisionTable
            columns={[
              { key: "rule", label: "Rule" },
              { key: "requirement", label: "Requirement" },
            ]}
            rows={regimeRows}
          />
        </SectionPanel>

        <SectionPanel label="Pre-Click Permission Script" title="Say it before entry or pass">
          <div className="rounded border border-white/10 bg-black/20 p-4 font-mono text-sm leading-7 text-zinc-200">
            <p>I am taking <span className="text-sky-200">[setup]</span> at <span className="text-sky-200">[level]</span> because <span className="text-sky-200">[trigger]</span>.</p>
            <p>My stop is <span className="text-amber-200">[structural invalidation]</span>.</p>
            <p>My first target is <span className="text-emerald-200">[specific level]</span>.</p>
            <p>I am wrong if <span className="text-red-200">[condition]</span>.</p>
          </div>
          <div className="mt-3 rounded border border-red-400/20 bg-red-950/20 p-3 text-sm font-semibold text-red-100">
            If I cannot say this clearly before entry, there is no trade. Any unchecked box means no trade.
          </div>
        </SectionPanel>
      </section>

      <section className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
        <ChecklistCard label="Required Before Entry" title="Pre-click checklist" items={beforeEntryItems} />
        <SectionPanel label="Trade Logic" title="Allowed only at meaningful levels">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center gap-2 text-emerald-300">
                <ShieldCheck size={16} />
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wide">Allowed</p>
              </div>
              <ul className="rule-list">
                {allowedTrades.map((trade) => (
                  <li key={trade}>{trade}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2 text-red-300">
                <Ban size={16} />
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wide">Forbidden</p>
              </div>
              <ul className="rule-list">
                {forbiddenTrades.map((trade) => (
                  <li key={trade}>{trade}</li>
                ))}
              </ul>
            </div>
          </div>
        </SectionPanel>
      </section>

      <section className="grid gap-3 xl:grid-cols-[0.8fr_1.2fr]">
        <SectionPanel label="Hard Stop Conditions" title="Stop trading when any condition appears">
          <div className="grid gap-2">
            {stopConditions.map((condition) => (
              <div key={condition} className="flex items-start gap-2 rounded border border-red-400/20 bg-red-950/15 px-3 py-2 text-sm text-red-100">
                <OctagonAlert className="mt-0.5 shrink-0 text-red-300" size={14} />
                <span>{condition}</span>
              </div>
            ))}
          </div>
        </SectionPanel>

        <SectionPanel label="Daily Execution Scorecard" title="Grade execution separately from P&L">
          <div className="mb-3 rounded border border-white/10 bg-white/[0.025] p-3 text-sm font-semibold text-zinc-200">
            A green day can be a C execution day. A red day can be an A execution day.
          </div>
          <DecisionTable
            columns={[
              { key: "category", label: "Category" },
              { key: "requirement", label: "A-grade requirement" },
              { key: "grade", label: "Grade" },
              { key: "notes", label: "Notes" },
            ]}
            rows={scorecardRows}
          />
        </SectionPanel>
      </section>

      <section className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <SectionPanel label="Core Rubrics" title="The decision standard">
          <div className="grid gap-2">
            {rubrics.map((rubric) => (
              <div key={rubric} className="flex items-start gap-2 rounded border border-white/10 bg-white/[0.025] px-3 py-2 text-sm text-zinc-400">
                <ClipboardCheck className="mt-0.5 shrink-0 text-sky-300" size={14} />
                <span>{rubric}</span>
              </div>
            ))}
          </div>
        </SectionPanel>

        <SectionPanel label="Recovery Red Flag" title="Do not negotiate with this thought">
          <div className="grid gap-3">
            <RuleCard title="Red-flag thought" code="STOP" tone="red">
              "I find it easier with ES to make up a loss."
            </RuleCard>
            <RuleCard title="Professional response" code="RULE" tone="amber">
              That is recovery thinking, not professional trading.
            </RuleCard>
            <RuleCard title="Primary rule" code="MES" tone="green">
              Live futures execution is MES only. ES, MNQ, and MCL are study, observation, replay, or paper only during this block.
            </RuleCard>
          </div>
        </SectionPanel>
      </section>
    </div>
  );
}
