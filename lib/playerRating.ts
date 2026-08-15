import { prisma } from "@/lib/prisma";
import { getCurrentSeason } from "@/lib/currentSeason";
import { computeWeeklyFantasyScore, meanAndStdDev, zScore } from "@/lib/scoring/weeklyScore";

/**
 * Converts a z-score to a 0-100 rating: z=0 -> 50 ("dead average"), each
 * standard deviation is worth ~15 points, clamped to the 0-100 range. This
 * is the one place the "score out of 100" scale is defined — Team of the
 * Week and individual player game ratings both go through this, so a "72"
 * means the same thing everywhere in the app.
 */
export function ratingFromZ(z: number): number {
  return Math.round(Math.max(0, Math.min(100, 50 + z * 15)));
}

/**
 * Monday-anchored week-bucket key for a date (e.g. "2025-10-06"), used to
 * group individual NHL games into a peer-comparison window. Deliberately
 * independent of the app's own Week/WeeklyRosterSlot records — those only
 * exist for weeks the commissioner has run a sync for, but per-game ratings
 * need to work for any date a player has a stored game log entry.
 */
export function weekBucketKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

const MIN_PEER_POOL_FOR_ZSCORE = 3;

export interface RatedGame {
  gameDate: Date;
  opponent: string | null;
  values: Record<string, number>;
  rawScore: number;
  rating: number;
  peerCount: number;
}

/**
 * Rates every stored game for one player against a peer pool of every
 * other rostered player at the same position whose own games fall in the
 * same Monday-anchored week. Falls back to a coarse above/below-average
 * rating when that pool is too thin for a z-score to mean anything (same
 * philosophy as Team of the Week's small-sample fallback).
 */
export async function rateGamesForPlayer(playerId: string): Promise<RatedGame[]> {
  const player = await prisma.player.findUniqueOrThrow({
    where: { id: playerId },
    include: { gameLogs: { orderBy: { gameDate: "desc" } } },
  });
  if (player.gameLogs.length === 0) return [];

  const season = await getCurrentSeason();
  const categories = await prisma.scoringCategory.findMany({
    where: { leagueId: season.leagueId, enabled: true },
  });
  const categoryByCode = new Map(categories.map((c) => [c.code, c]));

  function scoreValues(values: unknown): number {
    if (!values || typeof values !== "object") return 0;
    const lines = Object.entries(values as Record<string, unknown>)
      .map(([code, value]) => {
        const category = categoryByCode.get(code);
        if (!category || typeof value !== "number") return null;
        return { value, category: { code: category.code, higherIsBetter: category.higherIsBetter } };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return computeWeeklyFantasyScore(lines);
  }

  const peerEntries = await prisma.rosterEntry.findMany({
    where: {
      droppedAt: null,
      player: { primaryPosition: player.primaryPosition, id: { not: playerId } },
    },
    select: {
      player: { select: { gameLogs: { select: { gameDate: true, values: true } } } },
    },
  });

  const peerScoresByWeek = new Map<string, number[]>();
  for (const entry of peerEntries) {
    for (const g of entry.player.gameLogs) {
      const key = weekBucketKey(g.gameDate);
      const list = peerScoresByWeek.get(key) ?? [];
      list.push(scoreValues(g.values));
      peerScoresByWeek.set(key, list);
    }
  }

  return player.gameLogs.map((g) => {
    const rawScore = scoreValues(g.values);
    const pool = peerScoresByWeek.get(weekBucketKey(g.gameDate)) ?? [];
    const useFallback = pool.length < MIN_PEER_POOL_FOR_ZSCORE;
    const rating = useFallback
      ? rawScore > 0
        ? 60
        : rawScore < 0
          ? 40
          : 50
      : (() => {
          const { mean, stdDev } = meanAndStdDev(pool);
          return ratingFromZ(zScore(rawScore, mean, stdDev));
        })();

    return {
      gameDate: g.gameDate,
      opponent: g.opponent,
      values: g.values as Record<string, number>,
      rawScore: Math.round(rawScore * 10) / 10,
      rating,
      peerCount: pool.length,
    };
  });
}

/**
 * Season-to-date totals for a player, summed straight from PlayerGameLog.
 * GAA and SV% are per-game snapshots, not counting stats, so they're
 * averaged across games played instead of summed — a sum of save
 * percentages isn't a save percentage.
 */
export async function seasonTotalsForPlayer(playerId: string): Promise<{
  gamesPlayed: number;
  totals: Record<string, number>;
}> {
  const gameLogs = await prisma.playerGameLog.findMany({ where: { playerId } });
  const totals: Record<string, number> = {};
  for (const g of gameLogs) {
    for (const [code, value] of Object.entries(g.values as Record<string, number>)) {
      totals[code] = (totals[code] ?? 0) + value;
    }
  }
  const gamesPlayed = gameLogs.length;
  if (gamesPlayed > 0) {
    if (typeof totals.GAA === "number") totals.GAA = Math.round((totals.GAA / gamesPlayed) * 100) / 100;
    if (typeof totals["SV%"] === "number") totals["SV%"] = Math.round((totals["SV%"] / gamesPlayed) * 1000) / 1000;
  }
  return { gamesPlayed, totals };
}
