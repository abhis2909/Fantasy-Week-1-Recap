import { prisma } from "@/lib/prisma";

export interface StandingsRow {
  teamId: string;
  teamName: string;
  managerName: string;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  categoryWinsFor: number;
  categoryWinsAgainst: number;
}

/**
 * H2H Categories standings: a season W-L-T record built from each week's
 * matchup result (who won more categories), NOT a points total — see
 * lib/scoring/weeklyScore.ts for why that distinction matters. Ties break on
 * total category-wins-for across the season.
 */
export async function computeStandings(seasonId: string): Promise<StandingsRow[]> {
  const teams = await prisma.team.findMany({
    where: { seasonId },
    include: { manager: true },
  });

  const table = new Map<string, StandingsRow>();
  for (const t of teams) {
    table.set(t.id, {
      teamId: t.id,
      teamName: t.name,
      managerName: t.manager.name,
      wins: 0,
      losses: 0,
      ties: 0,
      winPct: 0,
      categoryWinsFor: 0,
      categoryWinsAgainst: 0,
    });
  }

  const matchups = await prisma.matchup.findMany({
    where: { week: { seasonId } },
    orderBy: { week: { number: "asc" } },
  });

  for (const m of matchups) {
    const home = table.get(m.homeTeamId);
    const away = table.get(m.awayTeamId);
    if (!home || !away) continue;

    home.categoryWinsFor += m.homeCategoryWins;
    home.categoryWinsAgainst += m.awayCategoryWins;
    away.categoryWinsFor += m.awayCategoryWins;
    away.categoryWinsAgainst += m.homeCategoryWins;

    if (m.homeCategoryWins > m.awayCategoryWins) {
      home.wins += 1;
      away.losses += 1;
    } else if (m.homeCategoryWins < m.awayCategoryWins) {
      away.wins += 1;
      home.losses += 1;
    } else {
      home.ties += 1;
      away.ties += 1;
    }
  }

  const rows = Array.from(table.values()).map((row) => {
    const gamesPlayed = row.wins + row.losses + row.ties;
    const winPct = gamesPlayed === 0 ? 0 : (row.wins + row.ties * 0.5) / gamesPlayed;
    return { ...row, winPct };
  });

  rows.sort(
    (a, b) => b.winPct - a.winPct || b.categoryWinsFor - a.categoryWinsFor
  );
  return rows;
}

export interface CategoryTotalsResult {
  categories: { id: string; code: string; label: string; higherIsBetter: boolean }[];
  rows: { teamId: string; teamName: string; totals: Record<string, number> }[];
}

/**
 * Season-cumulative per-category team totals, summed from each week's
 * MatchupCategoryResult — the same per-week team totals the standings
 * are computed from, so this view and the standings can never disagree
 * about what a team actually put up.
 */
export async function computeCategoryTotals(
  seasonId: string
): Promise<CategoryTotalsResult> {
  const teams = await prisma.team.findMany({
    where: { seasonId },
    orderBy: { name: "asc" },
  });
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId },
    include: {
      league: { include: { categories: { where: { enabled: true }, orderBy: { sortOrder: "asc" } } } },
    },
  });
  const categories = season.league.categories;

  const results = await prisma.matchupCategoryResult.findMany({
    where: { matchup: { week: { seasonId } } },
    include: { matchup: true },
  });

  const totals = new Map<string, Record<string, number>>();
  for (const t of teams) totals.set(t.id, {});

  for (const r of results) {
    const home = totals.get(r.matchup.homeTeamId);
    const away = totals.get(r.matchup.awayTeamId);
    if (home) home[r.categoryId] = (home[r.categoryId] ?? 0) + r.homeValue;
    if (away) away[r.categoryId] = (away[r.categoryId] ?? 0) + r.awayValue;
  }

  return {
    categories,
    rows: teams.map((t) => ({
      teamId: t.id,
      teamName: t.name,
      totals: totals.get(t.id) ?? {},
    })),
  };
}
