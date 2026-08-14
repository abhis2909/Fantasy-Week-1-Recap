import { prisma } from "@/lib/prisma";
import { computeStandings, type StandingsRow } from "@/lib/standings";
import { computeAndSaveTeamOfWeek, type TeamOfWeekPick } from "@/lib/team-of-week";
import {
  closestMatchup,
  hardestBeating,
  managerOfWeek,
  chokerOfWeek,
  comebackOfWeek,
  pickupOfWeek,
  type MatchupMarginResult,
  type ManagerOfWeekResult,
  type ChokerResult,
  type ComebackResult,
  type PickupResult,
} from "@/lib/recap/detectors";

export interface WeeklyStatsPayload {
  leagueName: string;
  weekNumber: number;
  standingsAfterThisWeek: StandingsRow[];
  matchups: {
    homeTeamName: string;
    awayTeamName: string;
    homeCategoryWins: number;
    awayCategoryWins: number;
  }[];
  teamOfTheWeek: TeamOfWeekPick[];
  transactions: {
    type: string;
    teamName: string;
    counterpartyTeamName: string | null;
    players: { name: string; direction: string }[];
    avgRating: number | null;
    ratingCount: number;
  }[];
  detectors: {
    closestMatchup: MatchupMarginResult | null;
    hardestBeating: MatchupMarginResult | null;
    managerOfWeek: ManagerOfWeekResult | null;
    chokerOfWeek: ChokerResult | null;
    comebackOfWeek: ComebackResult | null;
    pickupOfWeek: PickupResult | null;
  };
}

/** Everything the recap needs to know about a week, gathered in one place. */
export async function buildWeeklyStatsPayload(weekId: string): Promise<WeeklyStatsPayload> {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: { season: { include: { league: true } } },
  });
  const seasonId = week.seasonId;

  const [standings, matchups, teamOfTheWeek, txs, cm, hb, mow, ck, cb, pu] =
    await Promise.all([
      computeStandings(seasonId),
      prisma.matchup.findMany({
        where: { weekId },
        include: { homeTeam: true, awayTeam: true },
      }),
      computeAndSaveTeamOfWeek(weekId),
      prisma.transaction.findMany({
        where: { weekId },
        include: {
          initiatingTeam: true,
          counterpartyTeam: true,
          playersInvolved: { include: { player: true } },
          ratings: true,
        },
      }),
      closestMatchup(weekId),
      hardestBeating(weekId),
      managerOfWeek(weekId),
      chokerOfWeek(weekId),
      comebackOfWeek(seasonId, weekId),
      pickupOfWeek(weekId),
    ]);

  return {
    leagueName: week.season.league.name,
    weekNumber: week.number,
    standingsAfterThisWeek: standings,
    matchups: matchups.map((m) => ({
      homeTeamName: m.homeTeam.name,
      awayTeamName: m.awayTeam.name,
      homeCategoryWins: m.homeCategoryWins,
      awayCategoryWins: m.awayCategoryWins,
    })),
    teamOfTheWeek,
    transactions: txs.map((tx) => {
      const ratingCount = tx.ratings.length;
      const avgRating =
        ratingCount === 0
          ? null
          : Math.round((tx.ratings.reduce((s, r) => s + r.score, 0) / ratingCount) * 10) / 10;
      return {
        type: tx.type,
        teamName: tx.initiatingTeam.name,
        counterpartyTeamName: tx.counterpartyTeam?.name ?? null,
        players: tx.playersInvolved.map((tp) => ({
          name: tp.player.fullName,
          direction: tp.direction,
        })),
        avgRating,
        ratingCount,
      };
    }),
    detectors: {
      closestMatchup: cm,
      hardestBeating: hb,
      managerOfWeek: mow,
      chokerOfWeek: ck,
      comebackOfWeek: cb,
      pickupOfWeek: pu,
    },
  };
}
