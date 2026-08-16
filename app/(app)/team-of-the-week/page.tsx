import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { TeamRevealSequence } from "@/components/totw/TeamRevealSequence";
import { getCurrentSeason, getCurrentWeek } from "@/lib/currentSeason";
import { computeAndSaveTeamOfWeek } from "@/lib/team-of-week";

export default async function TeamOfTheWeekPage() {
  const season = await getCurrentSeason();
  const week = await getCurrentWeek(season.id);
  const picks = await computeAndSaveTeamOfWeek(week.id);

  return (
    <>
      <PageHeader
        title="Team of the Week"
        subtitle={`Week ${week.number} — best player at each position, ranked against everyone else at that position this week.`}
      />
      <SectionCard title={`Week ${week.number} All-Stars`}>
        <TeamRevealSequence picks={picks} />
      </SectionCard>
    </>
  );
}
