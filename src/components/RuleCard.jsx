import StatusPill from "./StatusPill.jsx";

export default function RuleCard({ title, children, tone = "blue", code }) {
  return (
    <article className="compact-card transition hover:border-white/20 hover:bg-white/[0.04]">
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        {code && <StatusPill tone={tone}>{code}</StatusPill>}
      </div>
      <p className="text-sm leading-6 text-zinc-400">{children}</p>
    </article>
  );
}
