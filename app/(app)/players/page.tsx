import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Reveal } from "@/components/ui/Reveal";
import { PlayerSearchBar } from "@/components/players/PlayerSearchBar";
import { SeasonCard } from "@/components/players/SeasonCard";
import { prisma } from "@/lib/prisma";
import { avatarForPlayer } from "@/lib/positionAvatar";
import { getCurrentSeason } from "@/lib/currentSeason";

export default async function PlayersDirectoryPage() {
  const season = await getCurrentSeason();
  const rosterEntries = await prisma.rosterEntry.findMany({
    where: { droppedAt: null, team: { seasonId: season.id } },
    include: { player: { include: { seasonRating: true } }, team: true },
    orderBy: [{ team: { name: "asc" } }, { player: { fullName: "asc" } }],
  });

  // Search covers the whole known player pool — rostered players plus any
  // free agents pre-loaded via "Import full NHL player pool" on the NHL
  // Sync admin page — even though the grid below only shows this league's
  // actual rosters.
  const allPlayers = await prisma.player.findMany({
    include: { rosterEntries: { where: { droppedAt: null }, include: { team: true } } },
    orderBy: { fullName: "asc" },
  });
  const searchEntries = allPlayers.map((player) => ({
    id: player.id,
    fullName: player.fullName,
    primaryPosition: player.primaryPosition,
    teamName: player.rosterEntries[0]?.team.name ?? "Free Agent",
    avatarUrl: avatarForPlayer(player),
  }));

  return (
    <>
      <PageHeader
        title="Players"
        subtitle="Every rostered player, Ultimate Team style — season card score up top, click through for game-by-game stats."
      />
      <SectionCard title="Roster">
        <PlayerSearchBar players={searchEntries} />
        {/* No place-items-center here on purpose — grid items default to
            stretch, so every card in a row gets the same column width
            (SeasonCard centers itself within it via mx-auto). Centering the
            grid items directly instead would size each one to its own
            content (name length), producing visibly different card widths
            across the same row. */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {rosterEntries.map((entry, i) => (
            <Reveal key={entry.player.id} delayMs={(i % 12) * 50}>
              <SeasonCard
                playerId={entry.player.id}
                name={entry.player.fullName}
                position={entry.player.primaryPosition}
                photoUrl={entry.player.photoUrl}
                nhlTeamAbbrev={entry.player.nhlTeamAbbrev}
                overall={entry.player.seasonRating?.overall ?? null}
                categoryScores={entry.player.seasonRating?.categoryScores as Record<string, number> | null}
                teamName={entry.team.name}
              />
            </Reveal>
          ))}
        </div>
      </SectionCard>
    </>
  );
}
