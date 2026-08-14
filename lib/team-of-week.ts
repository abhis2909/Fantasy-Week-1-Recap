import { prisma } from "@/lib/prisma";
import {
  computeWeeklyFantasyScore,
  meanAndStdDev,
  zScore,
} from "@/lib/scoring/weeklyScore";
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
  /** null when the position pool was too small/uniform to mean anything. */
  zScore: number | null;
  usedFallback: boolean;
}

const MIN_SAMPLE_FOR_ZSCORE = 3;

/**
 * Every rostered player's composite weekly score and their z-score against
 * the rest of the league's pool at the same position that week. This is the
 * shared building block behind both Team of the Week (top N per position)
 * and the Choker of the Week detector (started vs benched at the same
 * position) — both need "how good was this specific player's week, relative
 * to their position peers," just sliced differently.
 */
export async function computeWeeklyPlayerScores(
  weekId: string
): Promise<WeeklyPlayerScore[]> {
  const rosterSlots = await prisma.weeklyRosterSlot.findMany({
    where: { weekId },
    include: {
      player: {
        include: { statLines: { where: { weekId }, include: { category: true } } },
      },
      team: true,
    },
  });

  const byPosition = new Map<Position, WeeklyPlayerScore[]>();
  for (const slot of rosterSlots) {
    const score = computeWeeklyFantasyScore(
      slot.player.statLines.map((sl) => ({ value: sl.value, category: sl.category }))
    );
    const list = byPosition.get(slot.slot) ?? [];
    list.push({
      playerId: slot.playerId,
      playerName: slot.player.fullName,
      photoUrl: slot.player.photoUrl,
      teamId: slot.teamId,
      teamName: slot.team.name,
      position: slot.slot,
      started: slot.started,
      score,
      zScore: null,
      usedFallback: false,
    });
    byPosition.set(slot.slot, list);
  }

  const all: WeeklyPlayerScore[] = [];
  for (const list of byPosition.values()) {
    const { mean, stdDev } = meanAndStdDev(list.map((c) => c.score));
    const useFallback = stdDev === 0 || list.length < MIN_SAMPLE_FOR_ZSCORE;
    for (const entry of list) {
      entry.usedFallback = useFallback;
      entry.zScore = useFallback ? null : Math.round(zScore(entry.score, mean, stdDev) * 100) / 100;
      all.push(entry);
    }
  }
  return all;
}

export interface TeamOfWeekPick {
  position: Position;
  slotIndex: number;
  playerId: string;
  playerName: string;
  photoUrl: string | null;
  teamName: string;
  rawScore: number;
  zScore: number | null;
  usedFallback: boolean;
}

/**
 * Best player at each position this week, ranked by z-score within that
 * position's pool of rostered players (falls back to raw score when the
 * pool is too small or has zero variance for a z-score to mean anything).
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

    const useFallback = candidates[0]?.usedFallback ?? true;
    const ranked = [...candidates].sort((a, b) =>
      useFallback ? b.score - a.score : (b.zScore ?? 0) - (a.zScore ?? 0)
    );

    ranked.slice(0, slotsNeeded).forEach((c, i) => {
      picks.push({
        position,
        slotIndex: i,
        playerId: c.playerId,
        playerName: c.playerName,
        photoUrl: c.photoUrl,
        teamName: c.teamName,
        rawScore: Math.round(c.score * 10) / 10,
        zScore: c.zScore,
        usedFallback: c.usedFallback,
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
          zScore: p.zScore,
        },
      })
    ),
  ]);
  return picks;
}
