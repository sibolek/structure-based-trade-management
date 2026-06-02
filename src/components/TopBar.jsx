import { Activity, ShieldCheck } from "lucide-react";
import StatusPill from "./StatusPill.jsx";

export default function TopBar() {
  return (
    <header className="flex flex-col gap-3 border-b border-white/10 bg-ink-900/95 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="grid h-8 w-8 place-items-center rounded border border-sky-400/30 bg-sky-400/10 text-sky-300">
          <Activity size={16} />
        </div>
        <div>
          <p className="section-label">Execution Cockpit</p>
          <h1 className="text-base font-semibold text-zinc-100">Structure-Based Trade Management</h1>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone="blue">Read</StatusPill>
        <StatusPill tone="amber">Permit</StatusPill>
        <StatusPill tone="green">Manage</StatusPill>
        <div className="hidden items-center gap-2 font-mono text-[11px] uppercase text-zinc-500 sm:flex">
          <ShieldCheck size={14} />
          Structure First
        </div>
      </div>
    </header>
  );
}
