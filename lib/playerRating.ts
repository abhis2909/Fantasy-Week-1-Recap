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

/** Sums raw per-category values across a set of PlayerGameLog-shaped rows. */
export function sumGameLogValues(gameLogs: { values: unknown }[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const log of gameLogs) {
    for (const [code, value] of Object.entries(log.values as Record<string, number>)) {
      totals[code] = (totals[code] ?? 0) + value;
    }
  }
  return totals;
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
    return { values: sumGameLogValues(gameLogsInWeek), gamesPlayed: gameLogsInWeek.length };
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
  const totals = sumGameLogValues(gameLogs);
  const gamesPlayed = gameLogs.length;
  if (gamesPlayed > 0) {
    if (typeof totals.GAA === "number") totals.GAA = Math.round((totals.GAA / gamesPlayed) * 100) / 100;
    if (typeof totals["SV%"] === "number") totals["SV%"] = Math.round((totals["SV%"] / gamesPlayed) * 1000) / 1000;
  }
  return { gamesPlayed, totals };
}

// ---------------------------------------------------------------------------
// Season card score — the "Ultimate Team"-style overall + per-category
// sub-scores shown on PlayerCard, distinct from the per-game/per-week
// ratings above. Starts as last season's rating and blends toward this
// season's actual performance as the season progresses (see
// seasonBlendWeight), recomputed on demand by the "Update season card
// scores" admin action rather than per-game.
// ---------------------------------------------------------------------------

/** Skater season-card categories, in card display order. */
const SKATER_CATEGORY_CODES = ["G", "A", "PPP", "SHP", "SOG", "HIT", "BLK", "PIM"];
/** Goalie season-card categories — the league's own codes (W, GAA, SV%,
 * SO), the same ones shown on Standings and in the "Season totals" panel,
 * not the raw SV/GA counts the per-game rating formula uses internally
 * (lib/nhl.ts's mapGoalieGameEntry stores both per game; SV/GA make more
 * sense there since ratingForValues needs counts, not rates). The card is
 * user-facing, so it should read the same as everywhere else a goalie's
 * stats show up. */
const GOALIE_CATEGORY_CODES = ["W", "GAA", "SV%", "SO"];

/** Whether a higher value is better for a category — GAA is the one
 * exception (fewer goals against is better), same convention Standings
 * uses (ScoringCategory.higherIsBetter). */
const CATEGORY_HIGHER_IS_BETTER: Record<string, boolean> = {
  G: true,
  A: true,
  PPP: true,
  SHP: true,
  SOG: true,
  HIT: true,
  BLK: true,
  PIM: true,
  W: true,
  GAA: false,
  "SV%": true,
  SO: true,
};

/**
 * Ordered category codes for a position's season card, e.g. ["G", "A",
 * "PPP", ...]. Exported so PlayerCard doesn't need its own duplicate list —
 * and, importantly, can't just `Object.keys()` a stored PlayerSeasonRating.
 * categoryScores itself, since Postgres jsonb doesn't preserve the original
 * key insertion order on round-trip.
 */
export function categoryCodesForPosition(position: Position): string[] {
  return position === "G" ? GOALIE_CATEGORY_CODES : SKATER_CATEGORY_CODES;
}

/**
 * How much each category counts toward the overall card score, by position
 * — this is where "defensemen should weight blocks/hits/PIM more heavily"
 * lives. Forwards (C/LW/RW) share one profile emphasizing offense; D shifts
 * weight toward the physical/defensive categories; goalies are separate
 * entirely. Weights don't need to sum to 1 — overallFromCategoryScores
 * normalizes by whatever weights are actually present.
 */
const FORWARD_EMPHASIS: Record<string, number> = {
  G: 0.22,
  A: 0.2,
  PPP: 0.14,
  SHP: 0.06,
  SOG: 0.16,
  HIT: 0.08,
  BLK: 0.06,
  PIM: 0.08,
};
const DEFENSE_EMPHASIS: Record<string, number> = {
  G: 0.1,
  A: 0.16,
  PPP: 0.1,
  SHP: 0.04,
  SOG: 0.12,
  HIT: 0.17,
  BLK: 0.19,
  PIM: 0.12,
};
const GOALIE_EMPHASIS: Record<string, number> = { W: 0.35, "SV%": 0.2, GAA: 0.3, SO: 0.15 };

function emphasisFor(position: Position): Record<string, number> {
  if (position === "G") return GOALIE_EMPHASIS;
  return position === "D" ? DEFENSE_EMPHASIS : FORWARD_EMPHASIS;
}

/** Weighted average of per-category 0-100 scores into one overall 0-100. */
export function overallFromCategoryScores(
  categoryScores: Record<string, number>,
  position: Position
): number {
  const emphasis = emphasisFor(position);
  let weightedSum = 0;
  let totalWeight = 0;
  for (const [code, weight] of Object.entries(emphasis)) {
    const score = categoryScores[code];
    if (score === undefined) continue;
    weightedSum += score * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
}

/**
 * A player's blended (last season + this season, weighted by currentWeight
 * — 0 = pure last season, 1 = pure this season) per-game average for one
 * category, straight from real synced NHL data — or `null` when there's no
 * real data for this category at all, rather than a fabricated number.
 * `null` happens for two real cases: a true rookie with no last-season
 * record, and — currently — HIT/BLK specifically before this season has
 * boxscore-enriched game logs, since the season-card computation
 * deliberately omits HIT/BLK from *last*-season totals (getting real
 * last-season hits/blocks would mean a boxscore call per game across a
 * whole prior season, per rostered player — too expensive to run from an
 * admin button). A category with no this-season data yet falls back to the
 * last-season average regardless of currentWeight, so the value doesn't
 * get pulled toward a fabricated zero just because the calendar has ticked
 * forward — see percentileCategoryScores for how `null` is handled from
 * here (a neutral score for just that category, not exclusion of the
 * player or a punishing 0).
 */
export function blendedPerGameAverage(
  lastSeasonTotals: Record<string, number>,
  lastSeasonGames: number,
  thisSeasonTotals: Record<string, number>,
  thisSeasonGames: number,
  code: string,
  currentWeight: number
): number | null {
  const lastAvg =
    lastSeasonGames > 0 && lastSeasonTotals[code] !== undefined ? lastSeasonTotals[code] / lastSeasonGames : null;
  const thisAvg =
    thisSeasonGames > 0 && thisSeasonTotals[code] !== undefined ? thisSeasonTotals[code] / thisSeasonGames : null;
  if (lastAvg === null && thisAvg === null) return null;
  if (thisAvg === null) return lastAvg;
  if (lastAvg === null) return thisAvg;
  return lastAvg * (1 - currentWeight) + thisAvg * currentWeight;
}

/** Every one of a position's category codes, blended per-game average or
 * `null` (see blendedPerGameAverage) for each. */
export function blendedCategoryAverages(
  lastSeasonTotals: Record<string, number>,
  lastSeasonGames: number,
  thisSeasonTotals: Record<string, number>,
  thisSeasonGames: number,
  position: Position,
  currentWeight: number
): Record<string, number | null> {
  const averages: Record<string, number | null> = {};
  for (const code of categoryCodesForPosition(position)) {
    averages[code] = blendedPerGameAverage(
      lastSeasonTotals,
      lastSeasonGames,
      thisSeasonTotals,
      thisSeasonGames,
      code,
      currentWeight
    );
  }
  return averages;
}

export interface PlayerCategoryInputs {
  playerId: string;
  position: Position;
  averages: Record<string, number | null>;
}

/** A player with no real data for a category (see blendedPerGameAverage)
 * gets exactly this for that one category — not excluded from the card,
 * not a fabricated top or bottom rank, just "unknown, assume average." */
const NEUTRAL_CATEGORY_SCORE = 50;
/** No rostered player reads as a genuine 0 or a perfect 100 — leaves
 * headroom in both directions and matches how HUT/FUT-style ratings read
 * (nobody's actually a 0, nobody's actually 100). */
const CATEGORY_SCORE_FLOOR = 40;
const CATEGORY_SCORE_CEILING = 99;

function positionGroup(position: Position): "forward" | "defense" | "goalie" {
  if (position === "G") return "goalie";
  return position === "D" ? "defense" : "forward";
}

/**
 * Converts every active-roster player's blended per-game averages
 * (blendedCategoryAverages) into 0-100 category scores — by ranking each
 * category against every other rostered player at the same position group
 * (forward / defense / goalie), a genuine percentile rather than a
 * comparison against a hand-guessed absolute baseline. This is the whole
 * point: a player's G score is entirely a function of how their real
 * per-game goal rate compares to their real teammates' and opponents' real
 * per-game goal rates — nothing invented, no constant that can just be
 * wrong. It also self-calibrates to whatever this league's actual talent
 * pool looks like (a shallow league of stars and a deep league with a lot
 * of replacement-level players both produce a sensible 0-100 spread,
 * where a fixed baseline would have to guess which one it's looking at).
 *
 * Needs the *whole* roster passed in at once (not a per-player call) since
 * a percentile is meaningless against a population of one — this is why
 * the admin action computes every player's averages first, then calls this
 * once, rather than the old per-player blendedSeasonScores.
 */
export function percentileCategoryScores(
  players: PlayerCategoryInputs[]
): Map<string, { categoryScores: Record<string, number>; overall: number }> {
  const byGroup = new Map<string, PlayerCategoryInputs[]>();
  for (const p of players) {
    const group = positionGroup(p.position);
    const list = byGroup.get(group) ?? [];
    list.push(p);
    byGroup.set(group, list);
  }

  const scoresByPlayer = new Map<string, Record<string, number>>();
  for (const p of players) scoresByPlayer.set(p.playerId, {});

  for (const [group, groupPlayers] of byGroup) {
    const codes = group === "goalie" ? GOALIE_CATEGORY_CODES : SKATER_CATEGORY_CODES;
    for (const code of codes) {
      const higherIsBetter = CATEGORY_HIGHER_IS_BETTER[code] ?? true;
      const withData = groupPlayers
        .map((p) => ({ playerId: p.playerId, value: p.averages[code] }))
        .filter((p): p is { playerId: string; value: number } => typeof p.value === "number");
      withData.sort((a, b) => (higherIsBetter ? a.value - b.value : b.value - a.value));
      const rankByPlayer = new Map(withData.map((p, i) => [p.playerId, i]));
      const n = withData.length;

      for (const p of groupPlayers) {
        const scores = scoresByPlayer.get(p.playerId)!;
        const rank = rankByPlayer.get(p.playerId);
        if (rank === undefined || n <= 1) {
          scores[code] = NEUTRAL_CATEGORY_SCORE;
          continue;
        }
        const percentile = rank / (n - 1);
        scores[code] = Math.round(
          CATEGORY_SCORE_FLOOR + percentile * (CATEGORY_SCORE_CEILING - CATEGORY_SCORE_FLOOR)
        );
      }
    }
  }

  const result = new Map<string, { categoryScores: Record<string, number>; overall: number }>();
  for (const p of players) {
    const categoryScores = scoresByPlayer.get(p.playerId)!;
    result.set(p.playerId, { categoryScores, overall: overallFromCategoryScores(categoryScores, p.position) });
  }
  return result;
}

const SEASON_START_MONTH_INDEX = 9; // October, 0-indexed (Date.getUTCMonth())
const SEASON_LENGTH_MONTHS = 7; // October through April

/**
 * How much of the season-card blend should be "this season" rather than
 * "last season," derived from the calendar rather than from how many times
 * the admin action has been clicked — 0 in the offseason/at puck drop,
 * ramping linearly to 1 by ~7 months into the season (per the user's
 * choice: shift toward this season over time rather than snapping over the
 * moment any current data exists). Re-running the update just recomputes
 * this fresh each time from today's date, so it's always correct for
 * wherever the calendar actually is, regardless of update cadence.
 */
export function seasonBlendWeight(today: Date, seasonStartCalendarYear: number): number {
  const seasonStart = new Date(Date.UTC(seasonStartCalendarYear, SEASON_START_MONTH_INDEX, 1));
  const monthsElapsed =
    (today.getUTCFullYear() - seasonStart.getUTCFullYear()) * 12 +
    (today.getUTCMonth() - seasonStart.getUTCMonth());
  return Math.max(0, Math.min(1, monthsElapsed / SEASON_LENGTH_MONTHS));
}
