import Link from "next/link";
import Image from "next/image";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Reveal } from "@/components/ui/Reveal";
import { PlayerSearchBar } from "@/components/players/PlayerSearchBar";
import { prisma } from "@/lib/prisma";
import { avatarForPlayer } from "@/lib/positionAvatar";
import { getCurrentSeason } from "@/lib/currentSeason";

export default async function PlayersDirectoryPage() {
  const season = await getCurrentSeason();
  const rosterEntries = await prisma.rosterEntry.findMany({
    where: { droppedAt: null, team: { seasonId: season.id } },
    include: { player: true, team: true },
    orderBy: [{ team: { name: "asc" } }, { player: { fullName: "asc" } }],
  });

  const searchEntries = rosterEntries.map((entry) => ({
    id: entry.player.id,
    fullName: entry.player.fullName,
    primaryPosition: entry.player.primaryPosition,
    teamName: entry.team.name,
    avatarUrl: avatarForPlayer(entry.player),
  }));

  return (
    <>
      <PageHeader
        title="Players"
        subtitle="Every rostered player — season stats, last 10 games, and a 0-100 rating for each."
      />
      <SectionCard title="Roster">
        <PlayerSearchBar players={searchEntries} />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {rosterEntries.map((entry, i) => (
            <Reveal key={entry.player.id} delayMs={(i % 12) * 50}>
              <Link
                href={`/players/${entry.player.id}`}
                className="flex flex-col items-center rounded-xl bg-white/5 p-3 text-center transition hover:bg-white/10"
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-white">
                  <Image
                    src={avatarForPlayer(entry.player)}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="150px"
                  />
                </div>
                <p className="mt-2 text-sm font-semibold text-white">{entry.player.fullName}</p>
                <p className="text-xs tracking-wide text-cream/60 uppercase">
                  {entry.player.primaryPosition} · {entry.team.name}
                </p>
              </Link>
            </Reveal>
          ))}
        </div>
      </SectionCard>
    </>
  );
}
