export default function SectionPanel({ label, title, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          {label && <p className="section-label">{label}</p>}
          {title && <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>}
        </div>
      </div>
      {children}
    </section>
  );
}
