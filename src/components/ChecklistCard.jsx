import { CheckSquare } from "lucide-react";

export default function ChecklistCard({ title, items, label }) {
  return (
    <section className="compact-card">
      {label && <p className="section-label">{label}</p>}
      <h3 className="mb-3 text-sm font-semibold text-zinc-100">{title}</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="grid grid-cols-[16px_1fr] gap-2 text-sm text-zinc-400">
            <CheckSquare className="mt-0.5 text-sky-300" size={14} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
