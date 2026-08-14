import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { StandingsTable } from "@/components/standings/StandingsTable";
import { getCurrentSeason } from "@/lib/currentSeason";
import { computeStandings } from "@/lib/standings";

export default async function StandingsPage() {
  const season = await getCurrentSeason();
  const rows = await computeStandings(season.id);

  return (
    <>
      <PageHeader
        title="Standings"
        subtitle={`${season.league.name} — ${season.year} season`}
      />
      <SectionCard title="League Standings">
        <StandingsTable rows={rows} />
      </SectionCard>
    </>
  );
}
