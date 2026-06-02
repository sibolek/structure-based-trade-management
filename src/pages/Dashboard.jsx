import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, ShieldAlert } from "lucide-react";
import SectionPanel from "../components/SectionPanel.jsx";
import StatusPill from "../components/StatusPill.jsx";
import { operatingModel, permissionGates, riskPermissionSummary, supportRubrics } from "../data/coreRules.js";
import { riskTiers } from "../data/rubrics.js";

function FlowStep({ label, active }) {
  return (
    <div className={`flex items-center gap-2 rounded border px-3 py-2 ${active ? "border-sky-400/40 bg-sky-400/10 text-sky-100" : "border-white/10 bg-white/[0.025] text-zinc-500"}`}>
      <span className="font-mono text-[10px] font-semibold uppercase">{label}</span>
    </div>
  );
}

function GateCard({ gate }) {
  return (
    <article className="rounded border border-white/10 bg-ink-850 p-4 shadow-terminal">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="section-label">{gate.question}</p>
          <h3 className="text-base font-semibold text-zinc-100">{gate.title}</h3>
        </div>
        <StatusPill tone={gate.tone}>{gate.badge}</StatusPill>
      </div>
      <p className="text-sm leading-6 text-zinc-400">{gate.check}</p>
    </article>
  );
}

function ModelCard({ item }) {
  return (
    <article className="compact-card">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-100">{item.title}</h3>
        <StatusPill tone={item.tone}>{item.badge}</StatusPill>
      </div>
      <p className="text-sm leading-6 text-zinc-400">{item.body}</p>
    </article>
  );
}

export default function Dashboard() {
  return (
    <div className="space-y-4">
      <section className="grid gap-3 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded border border-sky-400/20 bg-[linear-gradient(135deg,rgba(14,165,233,0.12),rgba(13,16,19,0.96)_42%)] p-5 shadow-terminal">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="section-label">Command Center</p>
              <h2 className="text-2xl font-semibold tracking-normal text-zinc-50">Can I take this trade?</h2>
            </div>
            <StatusPill tone="amber">Trade Permission Gate</StatusPill>
          </div>

          <div className="mb-5 rounded border border-white/10 bg-black/20 p-4">
            <div className="mb-3 flex items-center gap-2 text-sky-200">
              <ClipboardCheck size={18} />
              <span className="font-mono text-[11px] font-semibold uppercase">Primary Operating Model</span>
            </div>
            <p className="max-w-3xl text-lg leading-8 text-zinc-100">
              A setup is not a trade until it passes permission.
            </p>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-zinc-400">
              The setup earns attention. The stop grants permission. The target justifies risk. The plan controls holding.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {["READ", "CLASSIFY", "PERMIT", "MANAGE", "REVIEW"].map((step, index) => (
              <div key={step} className="flex items-center gap-2">
                <FlowStep label={step} active={index < 3} />
                {index < 4 && <ArrowRight className="text-zinc-700" size={14} />}
              </div>
            ))}
          </div>
        </div>

        <SectionPanel label="Execution Chain" title="What controls the decision">
          <div className="grid gap-2">
            {riskPermissionSummary.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded border border-white/10 bg-white/[0.025] px-3 py-2">
                <span className="font-mono text-[11px] uppercase text-zinc-500">{item.label}</span>
                <StatusPill tone={item.tone}>{item.value}</StatusPill>
              </div>
            ))}
          </div>
        </SectionPanel>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {permissionGates.map((gate) => (
          <GateCard key={gate.title} gate={gate} />
        ))}
      </section>

      <section className="rounded border border-red-400/25 bg-red-950/20 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 text-red-300" size={20} />
            <div>
              <p className="section-label text-red-300">Fear-of-Exit Protocol</p>
              <p className="text-base font-semibold text-red-100">When fear rises, do not exit first. Check structure first.</p>
              <p className="mt-1 text-sm text-red-200/75">Green is not an exit. Red is not invalidation. Structure is invalidation.</p>
            </div>
          </div>
          <StatusPill tone="red">FEAR</StatusPill>
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1fr_0.9fr]">
        <SectionPanel label="Primary Operating Model" title="Concept hierarchy">
          <div className="grid gap-3 md:grid-cols-2">
            {operatingModel.map((item) => (
              <ModelCard key={item.title} item={item} />
            ))}
          </div>
        </SectionPanel>

        <SectionPanel label="Supporting Rubrics" title="Permission states">
          <div className="grid gap-2">
            {riskTiers.map((tier) => (
              <div key={tier.tier} className="grid gap-2 rounded border border-white/10 bg-white/[0.025] p-3 sm:grid-cols-[72px_1fr]">
                <div className="flex items-center gap-2">
                  {tier.tone === "green" ? <CheckCircle2 size={15} className="text-emerald-300" /> : <AlertTriangle size={15} className="text-amber-300" />}
                  <StatusPill tone={tier.tone}>{tier.tier}</StatusPill>
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{tier.label}</p>
                  <p className="mt-1 text-sm leading-6 text-zinc-500">{tier.action}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionPanel>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {supportRubrics.map((rubric) => (
          <article key={rubric.label} className="compact-card">
            <div className="mb-2 flex items-center justify-between gap-2">
              <StatusPill tone={rubric.tone}>{rubric.badge}</StatusPill>
            </div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-100">{rubric.label}</h3>
            <p className="text-sm leading-6 text-zinc-500">{rubric.value}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
