import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { PlayerCard } from "@/components/totw/PlayerCard";
import { Reveal } from "@/components/ui/Reveal";
import { getCurrentSeason, getCurrentWeek } from "@/lib/currentSeason";
import { computeAndSaveTeamOfWeek, type TeamOfWeekPick } from "@/lib/team-of-week";
import { shortStatSummary } from "@/lib/statSummary";
import type { Position } from "@/lib/generated/prisma/client";

const FORMATION_ROWS: Position[][] = [["LW", "C", "RW"], ["D"], ["G"]];

function Slot({ pick, delayMs = 0 }: { pick: TeamOfWeekPick; delayMs?: number }) {
  return (
    <Reveal delayMs={delayMs} className="flex flex-col items-center gap-1.5">
      <PlayerCard
        playerId={pick.playerId}
        name={pick.playerName}
        position={pick.position}
        photoUrl={pick.photoUrl}
        rating={pick.rating}
        statLine={shortStatSummary(pick.position, pick.values)}
        teamName={pick.teamName}
      />
      <p className="text-xs text-cream/60">
        {pick.usedFallback
          ? "ranked by raw score (small sample)"
          : `z-score ${pick.zScore! >= 0 ? "+" : ""}${pick.zScore}`}
      </p>
    </Reveal>
  );
}

export default async function TeamOfTheWeekPage() {
  const season = await getCurrentSeason();
  const week = await getCurrentWeek(season.id);
  const picks = await computeAndSaveTeamOfWeek(week.id);

  const byPosition = new Map<Position, TeamOfWeekPick[]>();
  for (const p of picks) {
    const list = byPosition.get(p.position) ?? [];
    list.push(p);
    byPosition.set(p.position, list.sort((a, b) => a.slotIndex - b.slotIndex));
  }

  return (
    <>
      <PageHeader
        title="Team of the Week"
        subtitle={`Week ${week.number} — best player at each position, ranked against everyone else at that position this week.`}
      />
      <SectionCard title={`Week ${week.number} All-Stars`}>
        <div className="flex flex-col items-center gap-10 py-4">
          {FORMATION_ROWS.map((row, i) => (
            <div key={i} className="flex flex-wrap justify-center gap-8">
              {row.flatMap((position) =>
                (byPosition.get(position) ?? []).map((pick, i) => (
                  <Slot key={pick.playerId} pick={pick} delayMs={i * 80} />
                ))
              )}
            </div>
          ))}
        </div>
      </SectionCard>
    </>
  );
}
