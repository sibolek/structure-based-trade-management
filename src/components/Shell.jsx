import TopBar from "./TopBar.jsx";

export default function Shell({ pages, activeId, onSelect, children }) {
  return (
    <div className="min-h-screen bg-ink-950 text-zinc-200">
      <TopBar />
      <div className="grid min-h-[calc(100vh-65px)] lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-white/10 bg-ink-900/80 p-3 lg:border-b-0 lg:border-r">
          <nav className="grid gap-4">
            {pages.map((group) => (
              <div key={group.section}>
                <p className="mb-2 px-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-zinc-600">{group.section}</p>
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
                  {group.items.map((page) => (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => onSelect(page.id)}
                      className={`rounded border px-3 py-2 text-left text-xs font-medium transition ${
                        activeId === page.id
                          ? "border-sky-400/40 bg-sky-400/10 text-sky-100"
                          : "border-transparent text-zinc-500 hover:border-white/10 hover:bg-white/[0.03] hover:text-zinc-200"
                      }`}
                    >
                      {page.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>
        <main className="bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.08),transparent_28rem)] p-3 sm:p-4">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
