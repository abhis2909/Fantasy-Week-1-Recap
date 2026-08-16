import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SeasonCard } from "@/components/players/SeasonCard";
import { prisma } from "@/lib/prisma";
import { formatStatValue } from "@/lib/formatStatValue";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { shortStatSummary } from "@/lib/statSummary";
import { rateGamesForPlayer, seasonTotalsForPlayer } from "@/lib/playerRating";
import { getCurrentSeason } from "@/lib/currentSeason";

/** Flags the card score as visibly stale past this age — "Sync full season
 * game logs" and "Update season card scores" are separate admin buttons
 * (the former doesn't trigger the latter), so it's easy to sync fresh stats
 * and never notice the card score wasn't recomputed against them. Loud
 * rather than silent about it, since a stale card score doesn't error or
 * look obviously broken — it just quietly shows numbers that no longer
 * match reality. 3 days, not the ~monthly cadence "Update season card
 * scores" is meant to run at — an unnoticed staleness bug is worse than a
 * slightly premature warning. */
const STALE_CARD_MS = 3 * 24 * 60 * 60 * 1000;

export default async function PlayerDetailPage({
  params,
}: PageProps<"/players/[playerId]">) {
  const { playerId } = await params;
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: {
      rosterEntries: { where: { droppedAt: null }, include: { team: true } },
      seasonRating: true,
    },
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
  const now = new Date();
  const cardIsStale = player.seasonRating
    ? now.getTime() - player.seasonRating.updatedAt.getTime() > STALE_CARD_MS
    : false;

  return (
    <>
      <PageHeader
        title={player.fullName}
        subtitle={`${player.primaryPosition}${teamName ? ` · ${teamName}` : ""}`}
      />

      <SectionCard title="Season">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          <div className="w-full max-w-[240px] shrink-0">
            <SeasonCard
              name={player.fullName}
              position={player.primaryPosition}
              photoUrl={player.photoUrl}
              nhlTeamAbbrev={player.nhlTeamAbbrev}
              overall={player.seasonRating?.overall ?? null}
              categoryScores={player.seasonRating?.categoryScores as Record<string, number> | null}
              teamName={teamName}
            />
            {player.seasonRating && (
              <>
                <p className="mt-2 text-center text-[11px] text-cream/50">
                  0–100 rating per category — {Math.round(player.seasonRating.currentSeasonWeight * 100)}%
                  this season, {Math.round((1 - player.seasonRating.currentSeasonWeight) * 100)}% last.
                  Not the same scale as the totals to the right, and labeled as card attributes (e.g.
                  &quot;SHO&quot; for Goals) rather than the raw stat codes — hover a tile for the real
                  name.
                </p>
                <p
                  className={`mt-1 text-center text-[11px] ${
                    cardIsStale ? "font-semibold text-danger" : "text-cream/40"
                  }`}
                >
                  Card score last updated {formatRelativeTime(player.seasonRating.updatedAt, now)}
                  {cardIsStale
                    ? " — stats above may be newer. Re-run “Update season card scores” on the NHL Sync admin page (syncing stats alone does not refresh it)."
                    : "."}
                </p>
              </>
            )}
          </div>
          <div className="flex-1">
            <p className="mb-1 text-sm text-cream/70">
              {gamesPlayed} game{gamesPlayed === 1 ? "" : "s"} synced
              {avgRating !== null ? ` · average per-game rating ${avgRating}/100` : ""}
            </p>
            {!player.seasonRating && (
              <p className="mb-3 text-sm text-cream/70">
                No card score yet — run &quot;Update season card scores&quot; on the NHL Sync
                admin page.
              </p>
            )}
            <p className="mt-3 mb-2 text-xs tracking-wide text-cream/50 uppercase">Season totals</p>
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

            <p className="mt-5 mb-2 text-xs tracking-wide text-cream/50 uppercase">Last 10 games</p>
            {last10.length === 0 ? (
              <p className="text-cream/70">No game logs synced yet for this player.</p>
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
          </div>
        </div>
      </SectionCard>
    </>
  );
}
