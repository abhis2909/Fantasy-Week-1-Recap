import { prisma } from "@/lib/prisma";

/**
 * Per-category team totals for a week, summed from STARTED players' stat
 * lines only — benched players don't score, matching how Yahoo-style H2H
 * categories actually work. This is the single source of truth both the
 * seed fixture and the admin matchup-compute flow use, so they can never
 * quietly disagree about what a team "actually" put up.
 */
export async function computeTeamCategoryTotals(
  weekId: string,
  teamId: string
): Promise<Map<string, number>> {
  const startedSlots = await prisma.weeklyRosterSlot.findMany({
    where: { weekId, teamId, started: true },
    select: { playerId: true },
  });
  const playerIds = startedSlots.map((s) => s.playerId);
  const lines = await prisma.statLine.findMany({
    where: { weekId, playerId: { in: playerIds } },
  });
  const totals = new Map<string, number>();
  for (const line of lines) {
    totals.set(line.categoryId, (totals.get(line.categoryId) ?? 0) + line.value);
  }
  return totals;
}

/**
 * Computes one matchup's category-by-category result from the two teams'
 * started-player stat totals and upserts the Matchup + MatchupCategoryResult
 * rows. Re-running it (e.g. after a stat correction) is safe — it fully
 * replaces the previous result for that pairing.
 */
export async function computeAndSaveMatchup(
  weekId: string,
  homeTeamId: string,
  awayTeamId: string
) {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: {
      season: { include: { league: { include: { categories: { where: { enabled: true } } } } } },
    },
  });
  const categories = week.season.league.categories;

  const [homeTotals, awayTotals] = await Promise.all([
    computeTeamCategoryTotals(weekId, homeTeamId),
    computeTeamCategoryTotals(weekId, awayTeamId),
  ]);

  let homeWins = 0;
  let awayWins = 0;
  const categoryResults: {
    categoryId: string;
    homeValue: number;
    awayValue: number;
    winner: string | null;
  }[] = [];

  for (const cat of categories) {
    const h = homeTotals.get(cat.id) ?? 0;
    const a = awayTotals.get(cat.id) ?? 0;
    let winner: string | null = null;
    if (h === a) {
      homeWins += 0.5;
      awayWins += 0.5;
    } else {
      const homeIsBetter = cat.higherIsBetter ? h > a : h < a;
      if (homeIsBetter) {
        homeWins += 1;
        winner = "home";
      } else {
        awayWins += 1;
        winner = "away";
      }
    }
    categoryResults.push({ categoryId: cat.id, homeValue: h, awayValue: a, winner });
  }

  return prisma.matchup.upsert({
    where: { weekId_homeTeamId_awayTeamId: { weekId, homeTeamId, awayTeamId } },
    create: {
      weekId,
      homeTeamId,
      awayTeamId,
      homeCategoryWins: homeWins,
      awayCategoryWins: awayWins,
      isTie: homeWins === awayWins,
      categoryResults: { create: categoryResults },
    },
    update: {
      homeCategoryWins: homeWins,
      awayCategoryWins: awayWins,
      isTie: homeWins === awayWins,
      categoryResults: { deleteMany: {}, create: categoryResults },
    },
  });
}
