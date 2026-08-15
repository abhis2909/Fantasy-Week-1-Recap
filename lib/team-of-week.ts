import { prisma } from "@/lib/prisma";
import { ratingForValues, weeklyValuesAndGameCount } from "@/lib/playerRating";
import type { Position } from "@/lib/generated/prisma/client";

export interface WeeklyPlayerScore {
  playerId: string;
  playerName: string;
  photoUrl: string | null;
  teamId: string;
  teamName: string;
  position: Position;
  started: boolean;
  score: number;
  values: Record<string, number>;
  rating: number;
  gamesPlayed: number;
}

/**
 * Every rostered player's weekly composite score and 0-100 rating, via the
 * fixed per-game valuation model (lib/playerRating.ts) scaled up to
 * whatever the player actually played that week. This is the shared
 * building block behind both Team of the Week (top N per position) and the
 * Choker of the Week detector (started vs benched at the same position) —
 * both need "how good was this specific player's week," just sliced
 * differently.
 */
export async function computeWeeklyPlayerScores(
  weekId: string
): Promise<WeeklyPlayerScore[]> {
  const week = await prisma.week.findUniqueOrThrow({ where: { id: weekId } });
  const rosterSlots = await prisma.weeklyRosterSlot.findMany({
    where: { weekId },
    include: {
      player: {
        include: {
          statLines: { where: { weekId }, include: { category: true } },
          gameLogs: { where: { gameDate: { gte: week.startDate, lte: week.endDate } } },
        },
      },
      team: true,
    },
  });

  return rosterSlots.map((slot) => {
    const { values, gamesPlayed } = weeklyValuesAndGameCount(slot.player.gameLogs, slot.player.statLines);
    const { rawScore, rating } = ratingForValues(values, slot.slot, gamesPlayed);
    return {
      playerId: slot.playerId,
      playerName: slot.player.fullName,
      photoUrl: slot.player.photoUrl,
      teamId: slot.teamId,
      teamName: slot.team.name,
      position: slot.slot,
      started: slot.started,
      score: rawScore,
      values,
      rating,
      gamesPlayed,
    };
  });
}

export interface TeamOfWeekPick {
  position: Position;
  slotIndex: number;
  playerId: string;
  playerName: string;
  photoUrl: string | null;
  teamName: string;
  rawScore: number;
  values: Record<string, number>;
  /** 0-100, via the same fixed-weight valuation model used for individual
   * per-game ratings. */
  rating: number;
  gamesPlayed: number;
}

/**
 * Best player at each position this week, ranked by raw weighted score
 * within that position's pool of rostered players.
 */
export async function computeTeamOfWeek(weekId: string): Promise<TeamOfWeekPick[]> {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: { season: { include: { league: true } } },
  });
  const positionSlots = week.season.league.positionSlots as Record<string, number>;
  const allScores = await computeWeeklyPlayerScores(weekId);

  const byPosition = new Map<Position, WeeklyPlayerScore[]>();
  for (const s of allScores) {
    const list = byPosition.get(s.position) ?? [];
    list.push(s);
    byPosition.set(s.position, list);
  }

  const picks: TeamOfWeekPick[] = [];
  for (const [position, slotsNeeded] of Object.entries(positionSlots) as [
    Position,
    number,
  ][]) {
    const candidates = byPosition.get(position) ?? [];
    if (candidates.length === 0) continue;

    const ranked = [...candidates].sort((a, b) => b.score - a.score);

    ranked.slice(0, slotsNeeded).forEach((c, i) => {
      picks.push({
        position,
        slotIndex: i,
        playerId: c.playerId,
        playerName: c.playerName,
        photoUrl: c.photoUrl,
        teamName: c.teamName,
        rawScore: c.score,
        values: c.values,
        rating: c.rating,
        gamesPlayed: c.gamesPlayed,
      });
    });
  }

  return picks;
}

/** Computes and upserts the persisted TeamOfWeekSelection rows for a week. */
export async function computeAndSaveTeamOfWeek(
  weekId: string
): Promise<TeamOfWeekPick[]> {
  const picks = await computeTeamOfWeek(weekId);
  await prisma.$transaction([
    prisma.teamOfWeekSelection.deleteMany({ where: { weekId } }),
    ...picks.map((p) =>
      prisma.teamOfWeekSelection.create({
        data: {
          weekId,
          position: p.position,
          slotIndex: p.slotIndex,
          playerId: p.playerId,
          rawScore: p.rawScore,
          // No longer a meaningful concept under the fixed-weight model —
          // left null rather than dropping the (nullable) column.
          zScore: null,
          rating: p.rating,
        },
      })
    ),
  ]);
  return picks;
}
