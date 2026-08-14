import type { StandingsRow } from "@/lib/standings";

export function StandingsTable({ rows }: { rows: StandingsRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-white/20 text-cream/70 uppercase tracking-wide text-xs">
            <th className="py-2 pr-3">#</th>
            <th className="py-2 pr-3">Team</th>
            <th className="py-2 pr-3">Manager</th>
            <th className="py-2 pr-3 text-right">W-L-T</th>
            <th className="py-2 pr-3 text-right">Win%</th>
            <th className="py-2 pr-3 text-right">Cat For</th>
            <th className="py-2 pr-3 text-right">Cat Against</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.teamId} className="border-b border-white/10">
              <td className="py-2.5 pr-3 font-semibold text-white">{i + 1}</td>
              <td className="py-2.5 pr-3 font-medium text-white">{row.teamName}</td>
              <td className="py-2.5 pr-3 text-cream/70">{row.managerName}</td>
              <td className="py-2.5 pr-3 text-right">
                {row.wins}-{row.losses}-{row.ties}
              </td>
              <td className="py-2.5 pr-3 text-right">{(row.winPct * 100).toFixed(1)}%</td>
              <td className="py-2.5 pr-3 text-right">{row.categoryWinsFor}</td>
              <td className="py-2.5 pr-3 text-right">{row.categoryWinsAgainst}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
