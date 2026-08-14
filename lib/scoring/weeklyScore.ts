/**
 * A single composite "weekly fantasy score" per player, used only by the
 * derived features that need to rank individual players against each other
 * within a week — Team of the Week, the Choker of the Week detector, and the
 * optimal-lineup% term of Manager of the Week.
 *
 * This is deliberately NOT used for league standings. Standings in an H2H
 * Categories league come from comparing each category independently
 * (see lib/standings.ts) — nobody's season is decided by a made-up point
 * total. This score only exists to answer "who had the better week, this
 * specific player vs that one," which categories alone can't do on their own
 * (a 5-hit, 0-point game and a 2-goal, 0-hit game aren't comparable without
 * some conversion).
 *
 * Weights are a reasonable default "points league" conversion. They are not
 * league-configurable yet (see README follow-ups) but are centralized here
 * so every feature that needs a per-player composite score computes it the
 * same way.
 */

export const DEFAULT_CATEGORY_WEIGHTS: Record<string, number> = {
  G: 3,
  A: 2,
  "+/-": 1,
  PIM: 0.2,
  PPP: 0.5,
  SOG: 0.1,
  HIT: 0.2,
  BLK: 0.2,
  W: 5,
  GAA: 2,
  "SV%": 50,
  SO: 3,
};

export interface ScoredStatLine {
  value: number;
  category: {
    code: string;
    higherIsBetter: boolean;
  };
}

/** The signed contribution of one category's value to the composite score. */
export function categoryContribution(
  categoryCode: string,
  value: number,
  higherIsBetter: boolean,
  weights: Record<string, number> = DEFAULT_CATEGORY_WEIGHTS
): number {
  const weight = weights[categoryCode] ?? 1;
  const direction = higherIsBetter ? 1 : -1;
  return direction * weight * value;
}

/** Sums a player's stat lines for a week into one composite score. */
export function computeWeeklyFantasyScore(
  statLines: ScoredStatLine[],
  weights: Record<string, number> = DEFAULT_CATEGORY_WEIGHTS
): number {
  return statLines.reduce(
    (sum, line) =>
      sum +
      categoryContribution(
        line.category.code,
        line.value,
        line.category.higherIsBetter,
        weights
      ),
    0
  );
}

/** Mean and (population) standard deviation of a list of numbers. */
export function meanAndStdDev(values: number[]): {
  mean: number;
  stdDev: number;
} {
  if (values.length === 0) return { mean: 0, stdDev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

/** z-score of `value` against a population's mean/stdDev. 0 if stdDev is 0. */
export function zScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}
