import { prisma } from "@/lib/prisma";
import type { Position } from "@/lib/generated/prisma/client";

/**
 * Fixed-weight per-game valuation model (commissioner-provided spec) —
 * replaces the earlier peer-relative z-score system. Every rating in the
 * app (individual per-game ratings, Team of the Week) goes through this,
 * so a given number means the same thing everywhere, and — unlike the old
 * peer-comparison approach — every game gets a real computed rating
 * regardless of how many other players happen to be rostered at that
 * position that week.
 */
export const SKATER_WEIGHTS: Record<string, number> = {
  G: 3.0,
  A: 2.0,
  PPP: 1.0,
  SHP: 2.0,
  SOG: 0.4,
  BLK: 0.5,
  HIT: 0.3,
  PIM: 0.3,
};
export const SKATER_BASELINE_PER_GAME = 1.5;
export const SKATER_STD_DEV_PER_GAME = 2.0;

/** SV (saves) and GA (goals against) are raw counts, not the rate stats
 * (GAA/SV%) tracked as standings categories — see lib/nhl.ts's
 * mapGoalieGameEntry, which stores both per game specifically so this
 * formula has real counts to work with. */
export const GOALIE_WEIGHTS: Record<string, number> = {
  W: 4.0,
  SV: 0.2,
  GA: -1.5,
  SO: 3.0,
};
export const GOALIE_BASELINE_PER_GAME = 5.0;
export const GOALIE_STD_DEV_PER_GAME = 3.5;

export function rawScoreForValues(values: Record<string, number>, position: Position): number {
  const weights = position === "G" ? GOALIE_WEIGHTS : SKATER_WEIGHTS;
  return Object.entries(weights).reduce((sum, [code, weight]) => sum + weight * (values[code] ?? 0), 0);
}

/**
 * 50 = baseline performance, each standard deviation is worth 10 points,
 * clamped to 0-100. baseline/stdDev must already be scaled for however many
 * games the raw score covers — 1x for a single game, Nx for an N-game
 * weekly total (see ratingForValues's gamesPlayed parameter).
 */
export function standardizeRating(rawScore: number, baseline: number, stdDev: number): number {
  const standardized = 50 + ((rawScore - baseline) / stdDev) * 10;
  return Math.round(Math.max(0, Math.min(100, standardized)));
}

/**
 * Raw score + 0-100 rating for a set of category values. gamesPlayed scales
 * the baseline/stdDev linearly — a 3-game week is judged against 3x a
 * single game's expected average and spread, not the same per-game
 * constants a lone box score would be judged against.
 */
export function ratingForValues(
  values: Record<string, number>,
  position: Position,
  gamesPlayed: number = 1
): { rawScore: number; rating: number } {
  const rawScore = rawScoreForValues(values, position);
  const isGoalie = position === "G";
  const baseline = (isGoalie ? GOALIE_BASELINE_PER_GAME : SKATER_BASELINE_PER_GAME) * gamesPlayed;
  const stdDev = (isGoalie ? GOALIE_STD_DEV_PER_GAME : SKATER_STD_DEV_PER_GAME) * gamesPlayed;
  return {
    rawScore: Math.round(rawScore * 100) / 100,
    rating: standardizeRating(rawScore, baseline, stdDev),
  };
}

/** A typical NHL week's game count — used only as a scaling fallback when
 * there's no real per-game data to count from (see weeklyValuesAndGameCount
 * below), so a weekly rating still has a sane baseline/stdDev to compare
 * against instead of blowing up against the per-game constants. */
const DEFAULT_GAMES_PER_WEEK = 3;

/**
 * A player's totals for one fantasy week, for rating purposes. Prefers
 * summing real per-game data (PlayerGameLog rows within the week's date
 * range) when available — this is the only source with true SV/GA counts
 * for goalies, since StatLine only tracks the rate stats GAA/SV%. Falls
 * back to the week's StatLine totals (CSV-imported weeks, or before "Sync
 * full season game logs" has run for this player) using a typical week's
 * game count for scaling, since there's no way to know the real count
 * without per-game data.
 */
export function weeklyValuesAndGameCount(
  gameLogsInWeek: { values: unknown }[],
  statLines: { value: number; category: { code: string } }[]
): { values: Record<string, number>; gamesPlayed: number } {
  if (gameLogsInWeek.length > 0) {
    const values: Record<string, number> = {};
    for (const log of gameLogsInWeek) {
      for (const [code, value] of Object.entries(log.values as Record<string, number>)) {
        values[code] = (values[code] ?? 0) + value;
      }
    }
    return { values, gamesPlayed: gameLogsInWeek.length };
  }
  const values: Record<string, number> = {};
  for (const sl of statLines) values[sl.category.code] = sl.value;
  return { values, gamesPlayed: DEFAULT_GAMES_PER_WEEK };
}

export interface RatedGame {
  gameDate: Date;
  opponent: string | null;
  values: Record<string, number>;
  rawScore: number;
  rating: number;
}

/** Rates every stored game for one player using the fixed per-game model. */
export async function rateGamesForPlayer(playerId: string): Promise<RatedGame[]> {
  const player = await prisma.player.findUniqueOrThrow({
    where: { id: playerId },
    include: { gameLogs: { orderBy: { gameDate: "desc" } } },
  });
  return player.gameLogs.map((g) => {
    const values = g.values as Record<string, number>;
    const { rawScore, rating } = ratingForValues(values, player.primaryPosition, 1);
    return { gameDate: g.gameDate, opponent: g.opponent, values, rawScore, rating };
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
