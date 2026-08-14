import { prisma } from "@/lib/prisma";
import { computeWeeklyFantasyScore } from "@/lib/scoring/weeklyScore";
import { computeWeeklyPlayerScores } from "@/lib/team-of-week";
import type { Position } from "@/lib/generated/prisma/client";

/**
 * Pure(ish) detector functions over one week's data. Each answers "who won
 * this recap beat," algorithmically and deterministically — the Claude call
 * in claude.ts is only ever asked to narrate these facts, never to decide
 * them, so the recap can't accidentally invent a winner. CLUTCH, CLOWN, and
 * QUOTE stay judgment calls with no detector here (see prompt.ts) — nothing
 * about "vibes" is algorithmically knowable from stat lines.
 */

export interface MatchupMarginResult {
  matchupId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeCategoryWins: number;
  awayCategoryWins: number;
  margin: number;
}

async function weekMatchupMargins(weekId: string): Promise<MatchupMarginResult[]> {
  const matchups = await prisma.matchup.findMany({
    where: { weekId },
    include: { homeTeam: true, awayTeam: true },
  });
  return matchups.map((m) => ({
    matchupId: m.id,
    homeTeamName: m.homeTeam.name,
    awayTeamName: m.awayTeam.name,
    homeCategoryWins: m.homeCategoryWins,
    awayCategoryWins: m.awayCategoryWins,
    margin: Math.abs(m.homeCategoryWins - m.awayCategoryWins),
  }));
}

export async function closestMatchup(weekId: string): Promise<MatchupMarginResult | null> {
  const margins = await weekMatchupMargins(weekId);
  if (margins.length === 0) return null;
  return margins.reduce((a, b) => (b.margin < a.margin ? b : a));
}

export async function hardestBeating(weekId: string): Promise<MatchupMarginResult | null> {
  const margins = await weekMatchupMargins(weekId);
  if (margins.length === 0) return null;
  return margins.reduce((a, b) => (b.margin > a.margin ? b : a));
}

export interface ManagerOfWeekResult {
  teamId: string;
  teamName: string;
  managerName: string;
  categoryWinRate: number;
  optimalLineupPct: number;
  transactionQualityNorm: number;
  compositeScore: number;
}

async function optimalLineupPct(
  teamId: string,
  weekId: string,
  positionSlots: Record<string, number>,
  playerScores: Map<string, number>
): Promise<number> {
  const slots = await prisma.weeklyRosterSlot.findMany({ where: { teamId, weekId } });

  let startedSum = 0;
  let bestSum = 0;
  for (const [position, count] of Object.entries(positionSlots)) {
    const atPosition = slots
      .filter((s) => s.slot === (position as Position))
      .map((s) => ({ ...s, score: playerScores.get(s.playerId) ?? 0 }));
    startedSum += atPosition.filter((s) => s.started).reduce((sum, s) => sum + s.score, 0);
    bestSum += [...atPosition]
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .reduce((sum, s) => sum + s.score, 0);
  }
  if (bestSum <= 0) return 1;
  return Math.min(1, Math.max(0, startedSum / bestSum));
}

async function transactionQualityNorm(teamId: string, weekId: string): Promise<number> {
  const txs = await prisma.transaction.findMany({
    where: { weekId, OR: [{ initiatingTeamId: teamId }, { counterpartyTeamId: teamId }] },
    include: { ratings: true },
  });
  const ratings = txs.flatMap((t) => t.ratings.map((r) => r.score));
  if (ratings.length === 0) return 0.5; // neutral: no moves to judge
  const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  return (avg - 1) / 9;
}

/**
 * ManagerScore = 0.50 * category win rate this week
 *              + 0.35 * optimal-lineup% (started vs best-possible-own-roster)
 *              + 0.15 * normalized average transaction rating this week
 * Highest composite wins. Requires the week to have matchups (H2H Categories).
 */
export async function managerOfWeek(weekId: string): Promise<ManagerOfWeekResult | null> {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: { season: { include: { league: true } } },
  });
  const positionSlots = week.season.league.positionSlots as Record<string, number>;

  const matchups = await prisma.matchup.findMany({
    where: { weekId },
    include: { homeTeam: { include: { manager: true } }, awayTeam: { include: { manager: true } } },
  });
  if (matchups.length === 0) return null;

  const allScores = await computeWeeklyPlayerScores(weekId);
  const playerScoreMap = new Map(allScores.map((s) => [s.playerId, s.score]));

  const results: ManagerOfWeekResult[] = [];
  for (const m of matchups) {
    for (const [team, myWins, totalWins] of [
      [m.homeTeam, m.homeCategoryWins, m.homeCategoryWins + m.awayCategoryWins],
      [m.awayTeam, m.awayCategoryWins, m.homeCategoryWins + m.awayCategoryWins],
    ] as const) {
      const categoryWinRate = totalWins === 0 ? 0.5 : myWins / totalWins;
      const lineupPct = await optimalLineupPct(team.id, weekId, positionSlots, playerScoreMap);
      const txQuality = await transactionQualityNorm(team.id, weekId);
      const compositeScore = 0.5 * categoryWinRate + 0.35 * lineupPct + 0.15 * txQuality;
      results.push({
        teamId: team.id,
        teamName: team.name,
        managerName: team.manager.name,
        categoryWinRate: Math.round(categoryWinRate * 1000) / 1000,
        optimalLineupPct: Math.round(lineupPct * 1000) / 1000,
        transactionQualityNorm: Math.round(txQuality * 1000) / 1000,
        compositeScore: Math.round(compositeScore * 1000) / 1000,
      });
    }
  }

  return results.reduce((a, b) => (b.compositeScore > a.compositeScore ? b : a));
}

export interface ChokerResult {
  teamId: string;
  teamName: string;
  position: Position;
  benchedPlayerName: string;
  benchedScore: number;
  benchedZ: number;
  startedPlayerName: string;
  startedScore: number;
  startedZ: number;
  gap: number;
}

const CHOKER_Z_THRESHOLD = 1.0;

/**
 * A benched player who meaningfully outscored (z > 1.0 above the position
 * average) the worst started player at the same position, on the same
 * team. Reports the single largest such gap league-wide.
 */
export async function chokerOfWeek(weekId: string): Promise<ChokerResult | null> {
  const allScores = await computeWeeklyPlayerScores(weekId);

  const byTeamPosition = new Map<string, typeof allScores>();
  for (const s of allScores) {
    const key = `${s.teamId}::${s.position}`;
    const list = byTeamPosition.get(key) ?? [];
    list.push(s);
    byTeamPosition.set(key, list);
  }

  let best: ChokerResult | null = null;
  for (const [key, entries] of byTeamPosition) {
    const [teamId, position] = key.split("::");
    const benched = entries.filter((e) => !e.started);
    const started = entries.filter((e) => e.started);
    if (benched.length === 0 || started.length === 0) continue;

    const benchTop = benched.reduce((a, b) => (b.score > a.score ? b : a));
    const startBottom = started.reduce((a, b) => (b.score < a.score ? b : a));
    if (benchTop.score <= startBottom.score) continue;
    if ((benchTop.zScore ?? 0) <= CHOKER_Z_THRESHOLD) continue;

    const gap = (benchTop.zScore ?? 0) - (startBottom.zScore ?? 0);
    if (!best || gap > best.gap) {
      best = {
        teamId,
        teamName: benchTop.teamName,
        position: position as Position,
        benchedPlayerName: benchTop.playerName,
        benchedScore: Math.round(benchTop.score * 10) / 10,
        benchedZ: benchTop.zScore ?? 0,
        startedPlayerName: startBottom.playerName,
        startedScore: Math.round(startBottom.score * 10) / 10,
        startedZ: startBottom.zScore ?? 0,
        gap: Math.round(gap * 100) / 100,
      };
    }
  }
  return best;
}

export interface ComebackResult {
  teamId: string;
  teamName: string;
  opponentTeamName: string;
  teamPowerRating: number;
  opponentPowerRating: number;
  powerDiff: number;
}

/**
 * The team that won its matchup despite the biggest negative "form"
 * differential against its opponent, where form = rolling average category
 * win rate over prior weeks. Returns null when there are no prior weeks to
 * establish form from (correctly the case in Week 1).
 */
export async function comebackOfWeek(
  seasonId: string,
  weekId: string
): Promise<ComebackResult | null> {
  const week = await prisma.week.findUniqueOrThrow({ where: { id: weekId } });
  const priorWeeks = await prisma.week.findMany({
    where: { seasonId, number: { lt: week.number } },
  });
  if (priorWeeks.length === 0) return null;

  const priorMatchups = await prisma.matchup.findMany({
    where: { weekId: { in: priorWeeks.map((w) => w.id) } },
  });

  const form = new Map<string, { sum: number; count: number }>();
  function addForm(teamId: string, wins: number, total: number) {
    if (total === 0) return;
    const entry = form.get(teamId) ?? { sum: 0, count: 0 };
    entry.sum += wins / total;
    entry.count += 1;
    form.set(teamId, entry);
  }
  for (const m of priorMatchups) {
    const total = m.homeCategoryWins + m.awayCategoryWins;
    addForm(m.homeTeamId, m.homeCategoryWins, total);
    addForm(m.awayTeamId, m.awayCategoryWins, total);
  }
  const powerRating = (teamId: string) => {
    const f = form.get(teamId);
    return f && f.count > 0 ? f.sum / f.count : 0.5;
  };

  const thisWeekMatchups = await prisma.matchup.findMany({
    where: { weekId },
    include: { homeTeam: true, awayTeam: true },
  });

  let best: ComebackResult | null = null;
  for (const m of thisWeekMatchups) {
    const homePower = powerRating(m.homeTeamId);
    const awayPower = powerRating(m.awayTeamId);

    if (m.homeCategoryWins > m.awayCategoryWins) {
      const diff = homePower - awayPower;
      if (diff < 0 && (!best || diff < best.powerDiff)) {
        best = {
          teamId: m.homeTeamId,
          teamName: m.homeTeam.name,
          opponentTeamName: m.awayTeam.name,
          teamPowerRating: Math.round(homePower * 1000) / 1000,
          opponentPowerRating: Math.round(awayPower * 1000) / 1000,
          powerDiff: Math.round(diff * 1000) / 1000,
        };
      }
    } else if (m.awayCategoryWins > m.homeCategoryWins) {
      const diff = awayPower - homePower;
      if (diff < 0 && (!best || diff < best.powerDiff)) {
        best = {
          teamId: m.awayTeamId,
          teamName: m.awayTeam.name,
          opponentTeamName: m.homeTeam.name,
          teamPowerRating: Math.round(awayPower * 1000) / 1000,
          opponentPowerRating: Math.round(homePower * 1000) / 1000,
          powerDiff: Math.round(diff * 1000) / 1000,
        };
      }
    }
  }
  return best;
}

export interface PickupResult {
  transactionId: string;
  teamName: string;
  playerName: string;
  score: number;
}

/** The single best weekly score among players added this week. */
export async function pickupOfWeek(weekId: string): Promise<PickupResult | null> {
  const adds = await prisma.transaction.findMany({
    where: { weekId, type: "ADD" },
    include: {
      initiatingTeam: true,
      playersInvolved: {
        include: { player: { include: { statLines: { where: { weekId }, include: { category: true } } } } },
      },
    },
  });

  let best: PickupResult | null = null;
  for (const tx of adds) {
    for (const tp of tx.playersInvolved.filter((p) => p.direction === "ADDED")) {
      const score = computeWeeklyFantasyScore(
        tp.player.statLines.map((sl) => ({ value: sl.value, category: sl.category }))
      );
      if (!best || score > best.score) {
        best = {
          transactionId: tx.id,
          teamName: tx.initiatingTeam.name,
          playerName: tp.player.fullName,
          score: Math.round(score * 10) / 10,
        };
      }
    }
  }
  return best;
}
