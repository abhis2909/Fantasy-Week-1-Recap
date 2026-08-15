import type { CategoryTotalsResult } from "@/lib/standings";
import { formatStatValue } from "@/lib/formatStatValue";

export function CategoryBreakdownTable({ data }: { data: CategoryTotalsResult }) {
  const { categories, rows } = data;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-white/20 text-cream/70 uppercase tracking-wide text-xs">
            <th className="py-2 pr-3">Team</th>
            {categories.map((c) => (
              <th key={c.id} className="py-2 pr-3 text-right" title={c.label}>
                {c.code}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.teamId} className="border-b border-white/10">
              <td className="py-2.5 pr-3 font-medium text-white">{row.teamName}</td>
              {categories.map((c) => (
                <td key={c.id} className="py-2.5 pr-3 text-right text-cream/90">
                  {formatStatValue(row.totals[c.id], c.code)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
