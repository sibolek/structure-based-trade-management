import StatusPill from "./StatusPill.jsx";

export default function DecisionTable({ columns, rows }) {
  return (
    <div className="overflow-hidden rounded border border-white/10">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-white/[0.03] font-mono text-[10px] uppercase tracking-wide text-zinc-500">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="border-b border-white/10 px-3 py-2 font-semibold">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? index} className="border-b border-white/5 last:border-b-0">
              {columns.map((column) => (
                <td key={column.key} className="px-3 py-2 align-top text-zinc-400">
                  {column.pill ? <StatusPill tone={row.tone}>{row[column.key]}</StatusPill> : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
