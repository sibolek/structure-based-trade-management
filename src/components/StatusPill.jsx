const toneMap = {
  green: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  red: "border-red-400/30 bg-red-400/10 text-red-300",
  amber: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  blue: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  neutral: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
};

export default function StatusPill({ children, tone = "neutral" }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${toneMap[tone]}`}>
      {children}
    </span>
  );
}
