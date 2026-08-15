import { notFound } from "next/navigation";
import Image from "next/image";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { prisma } from "@/lib/prisma";
import { avatarForPlayer } from "@/lib/positionAvatar";
import { formatStatValue } from "@/lib/formatStatValue";
import { shortStatSummary } from "@/lib/statSummary";
import { rateGamesForPlayer, seasonTotalsForPlayer } from "@/lib/playerRating";
import { getCurrentSeason } from "@/lib/currentSeason";

export default async function PlayerDetailPage({
  params,
}: PageProps<"/players/[playerId]">) {
  const { playerId } = await params;
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { rosterEntries: { where: { droppedAt: null }, include: { team: true } } },
  });
  if (!player) notFound();

  const season = await getCurrentSeason();
  const categories = await prisma.scoringCategory.findMany({
    where: { leagueId: season.leagueId, appliesTo: { has: player.primaryPosition }, enabled: true },
    orderBy: { sortOrder: "asc" },
  });

  const [{ gamesPlayed, totals }, ratedGames] = await Promise.all([
    seasonTotalsForPlayer(playerId),
    rateGamesForPlayer(playerId),
  ]);
  const last10 = ratedGames.slice(0, 10);
  const avgRating =
    ratedGames.length > 0
      ? Math.round(ratedGames.reduce((sum, g) => sum + g.rating, 0) / ratedGames.length)
      : null;
  const teamName = player.rosterEntries[0]?.team.name;

  return (
    <>
      <PageHeader
        title={player.fullName}
        subtitle={`${player.primaryPosition}${teamName ? ` · ${teamName}` : ""}`}
      />

      <SectionCard title="Season">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <div className="relative h-40 w-40 shrink-0 overflow-hidden rounded-xl bg-white">
            <Image src={avatarForPlayer(player)} alt="" fill className="object-cover" sizes="160px" />
          </div>
          <div className="flex-1">
            <p className="mb-3 text-sm text-cream/70">
              {gamesPlayed} game{gamesPlayed === 1 ? "" : "s"} synced
              {avgRating !== null ? ` · average rating ${avgRating}/100` : ""}
            </p>
            {categories.length === 0 || gamesPlayed === 0 ? (
              <p className="text-cream/70">
                No synced games yet — run &quot;Sync full season game logs&quot; on the NHL
                Sync admin page.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {categories.map((c) => (
                  <div key={c.id} className="rounded-lg bg-white/5 px-3 py-2 text-center">
                    <p className="text-xs tracking-wide text-cream/60 uppercase">{c.code}</p>
                    <p className="font-heading text-lg text-white">
                      {formatStatValue(totals[c.code], c.code)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Last 10 games">
        {last10.length === 0 ? (
          <p className="text-cream/80">No game logs synced yet for this player.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {last10.map((g) => (
              <div
                key={g.gameDate.toISOString()}
                className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium text-white">
                    {g.gameDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    {g.opponent ? ` vs ${g.opponent}` : ""}
                  </p>
                  <p className="text-xs text-cream/60">
                    {shortStatSummary(player.primaryPosition, g.values)}
                  </p>
                </div>
                <div className="text-right">
                  <div className="font-heading text-lg text-gold">{g.rating}</div>
                  <div className="text-[10px] tracking-wide text-cream/50 uppercase">/ 100</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );
}
