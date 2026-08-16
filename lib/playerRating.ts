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

interface CategoryCalibration {
  /** Typical per-game-average value across a realistic rostered-player
   * population — NOT a per-game raw-score baseline like SKATER_BASELINE_PER_GAME
   * above; this is per individual category, in that category's own units. */
  baseline: number;
  stdDev: number;
  higherIsBetter: boolean;
}

/** Hand-calibrated from general knowledge of realistic per-game rates for a
 * rostered (i.e. already above-replacement-level) NHL skater — there's no
 * league-wide data source wired up to derive these empirically. Reasonable
 * starting points, easiest single place to retune once real full-season
 * data makes the card scores feel too generous/harsh in practice.
 *
 * Split by forward vs. defense (unlike the first version of this table,
 * which shared one set of offensive baselines across both) — a defenseman
 * scoring/assisting at even a good rate for their position was landing well
 * below a baseline calibrated off forward-level production, dragging every
 * D's card down regardless of how they actually compared to other
 * defensemen. Forwards' baselines were also brought down some: the original
 * numbers leaned toward "good top-6 producer," not the realistic average
 * across a full rostered mix that includes bottom-6/depth players — enough
 * that most real rosters were coming out under 50 across the board. */
// stdDev values are tuned tighter than a "pure" statistical spread would
// suggest, deliberately — the point of an Ultimate-Team-style card is
// visible separation between a genuine top performer and a replacement-level
// one (think HUT/FUT gold vs bronze), not a strict bell curve where nearly
// everyone rostered lands within a few points of 50.
const FORWARD_CATEGORY_CALIBRATION: Record<string, CategoryCalibration> = {
  G: { baseline: 0.18, stdDev: 0.11, higherIsBetter: true },
  A: { baseline: 0.24, stdDev: 0.13, higherIsBetter: true },
  PPP: { baseline: 0.1, stdDev: 0.08, higherIsBetter: true },
  SHP: { baseline: 0.02, stdDev: 0.04, higherIsBetter: true },
  SOG: { baseline: 1.9, stdDev: 0.6, higherIsBetter: true },
  HIT: { baseline: 1.1, stdDev: 0.75, higherIsBetter: true },
  BLK: { baseline: 0.5, stdDev: 0.35, higherIsBetter: true },
  PIM: { baseline: 0.4, stdDev: 0.4, higherIsBetter: true },
};

const DEFENSE_CATEGORY_CALIBRATION: Record<string, CategoryCalibration> = {
  G: { baseline: 0.09, stdDev: 0.07, higherIsBetter: true },
  A: { baseline: 0.2, stdDev: 0.12, higherIsBetter: true },
  PPP: { baseline: 0.08, stdDev: 0.07, higherIsBetter: true },
  SHP: { baseline: 0.02, stdDev: 0.035, higherIsBetter: true },
  SOG: { baseline: 1.6, stdDev: 0.55, higherIsBetter: true },
  HIT: { baseline: 1.6, stdDev: 0.9, higherIsBetter: true },
  BLK: { baseline: 1.3, stdDev: 0.75, higherIsBetter: true },
  PIM: { baseline: 0.45, stdDev: 0.4, higherIsBetter: true },
};

const GOALIE_CATEGORY_CALIBRATION: Record<string, CategoryCalibration> = {
  // A per-appearance win rate (0-1), not a count — same "totals / games"
  // math as every other category here works fine for a rate stat too.
  W: { baseline: 0.45, stdDev: 0.2, higherIsBetter: true },
  SV: { baseline: 24, stdDev: 5.5, higherIsBetter: true },
  GA: { baseline: 2.7, stdDev: 0.5, higherIsBetter: false },
  SO: { baseline: 0.08, stdDev: 0.08, higherIsBetter: true },
};

function categoryCalibrationFor(position: Position): Record<string, CategoryCalibration> {
  if (position === "G") return GOALIE_CATEGORY_CALIBRATION;
  return position === "D" ? DEFENSE_CATEGORY_CALIBRATION : FORWARD_CATEGORY_CALIBRATION;
}

/**
 * Ordered category codes for a position's season card, e.g. ["G", "A",
 * "PPP", ...]. Exported so PlayerCard doesn't need its own duplicate list —
 * and, importantly, can't just `Object.keys()` a stored PlayerSeasonRating.
 * categoryScores itself, since Postgres jsonb doesn't preserve the original
 * key insertion order on round-trip.
 */
export function categoryCodesForPosition(position: Position): string[] {
  return Object.keys(categoryCalibrationFor(position));
}

// Season card scores use a different curve from standardizeRating (shared
// with the per-game/per-week system above, deliberately left alone) — a
// symmetric bell curve centered on 50 doesn't match how HUT/FUT-style cards
// actually read. "Replacement level for a rostered player" reads as a
// mid-60s/generic-silver card there, not a 50; genuine stars are meant to
// break into the 90s, not top out in the 70s-80s. So above-average
// performance climbs faster per standard deviation than below-average
// performance falls — anchored higher than 50, and asymmetric on purpose.
const CARD_SCORE_ANCHOR = 68;
const CARD_SCORE_ABOVE_PER_STDDEV = 11;
const CARD_SCORE_BELOW_PER_STDDEV = 7;

/** One category's 0-100 sub-score from its per-game average, honoring
 * higherIsBetter (GA needs lower-is-better standardization, same as GAA
 * does for Standings). */
function categoryScore(perGameAvg: number, calib: CategoryCalibration): number {
  const sign = calib.higherIsBetter ? 1 : -1;
  const z = (sign * (perGameAvg - calib.baseline)) / calib.stdDev;
  const perStdDev = z >= 0 ? CARD_SCORE_ABOVE_PER_STDDEV : CARD_SCORE_BELOW_PER_STDDEV;
  return Math.round(Math.max(0, Math.min(100, CARD_SCORE_ANCHOR + z * perStdDev)));
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
const GOALIE_EMPHASIS: Record<string, number> = { W: 0.35, SV: 0.2, GA: 0.3, SO: 0.15 };

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
 * Blends last season's per-game averages with this season's (weighted by
 * currentWeight, 0 = pure last season, 1 = pure this season) and
 * standardizes the blend into per-category 0-100 scores plus an overall.
 *
 * Falls back to that category's own baseline — a neutral ~50, not a
 * punishing 0 — whenever a specific category's total is genuinely absent
 * (the key missing from the totals object) rather than present-and-zero.
 * This matters for two real cases, not just a hypothetical: a true rookie
 * with no last-season data at all, and — currently — HIT/BLK specifically,
 * which the season-card computation deliberately omits from the
 * *last*-season totals (getting real last-season hits/blocks would mean a
 * boxscore call per game across a whole prior season, per rostered player —
 * too expensive to run from an admin button) while still using real
 * game-log data for the other six categories. A category with no
 * this-season data yet (start of the season, before any games) falls back
 * to the last-season average regardless of currentWeight, so the card
 * doesn't get pulled toward a fabricated zero just because the calendar has
 * ticked forward.
 */
export function blendedSeasonScores(
  lastSeasonTotals: Record<string, number>,
  lastSeasonGames: number,
  thisSeasonTotals: Record<string, number>,
  thisSeasonGames: number,
  position: Position,
  currentWeight: number
): { categoryScores: Record<string, number>; overall: number } {
  const calibration = categoryCalibrationFor(position);
  const categoryScores: Record<string, number> = {};
  for (const [code, calib] of Object.entries(calibration)) {
    const lastAvg =
      lastSeasonGames > 0 && lastSeasonTotals[code] !== undefined
        ? lastSeasonTotals[code] / lastSeasonGames
        : calib.baseline;
    const thisAvg =
      thisSeasonGames > 0 && thisSeasonTotals[code] !== undefined
        ? thisSeasonTotals[code] / thisSeasonGames
        : lastAvg;
    const blendedAvg = lastAvg * (1 - currentWeight) + thisAvg * currentWeight;
    categoryScores[code] = categoryScore(blendedAvg, calib);
  }
  return { categoryScores, overall: overallFromCategoryScores(categoryScores, position) };
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
