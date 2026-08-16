import { prisma } from "@/lib/prisma";
import {
  findBestNhlMatch,
  getPlayerGameLog,
  mapGameLogToPerGameValues,
  mapWithConcurrency,
  createBoxscoreCache,
  NHL_GAME_TYPE_REGULAR_SEASON,
} from "@/lib/nhl";
import { incrementSyncProgress } from "@/lib/syncProgress";

export interface FullSeasonSyncResult {
  playersMatched: number;
  gamesUpserted: number;
  skipped: string[];
  errored: string[];
}

/**
 * The actual work behind "Sync full season game logs" — extracted out of
 * the admin page so both the plain Server Action (app/(app)/admin/nhl-sync,
 * kept as a fallback / for when JS is disabled) and the progress-tracked
 * API route (app/api/admin/sync-game-logs) can share one implementation
 * instead of two copies drifting apart.
 *
 * `progressKey`, when given, gets one incrementSyncProgress call per player
 * processed (matched, skipped, or errored alike) — the caller is
 * responsible for calling startSyncProgress/finishSyncProgress/
 * failSyncProgress around this, since only the caller knows whether it's
 * running inside a trackable job or not.
 */
export async function runFullSeasonGameLogSync(
  seasonDbId: string,
  nhlSeasonId: string,
  progressKey?: string
): Promise<FullSeasonSyncResult> {
  const activeRoster = await prisma.rosterEntry.findMany({
    where: { droppedAt: null, team: { seasonId: seasonDbId } },
    include: { player: true },
  });
  const cachedBoxscore = createBoxscoreCache();

  let playersMatched = 0;
  let gamesUpserted = 0;
  const skipped: string[] = [];
  const errored: string[] = [];

  await mapWithConcurrency(activeRoster, 6, async (entry) => {
    const player = entry.player;
    try {
      let nhlId = player.externalId ? Number(player.externalId) : null;
      if (!nhlId) {
        const match = await findBestNhlMatch(player.fullName);
        if (!match) {
          skipped.push(player.fullName);
          return;
        }
        nhlId = match.nhlPlayerId;
        await prisma.player.update({
          where: { id: player.id },
          data: {
            externalId: String(nhlId),
            externalSource: "NHL_SYNC",
            nhlTeamAbbrev: match.teamAbbrev ?? player.nhlTeamAbbrev,
          },
        });
      }

      const gameLog = await getPlayerGameLog(nhlId, nhlSeasonId, NHL_GAME_TYPE_REGULAR_SEASON);
      const perGame = mapGameLogToPerGameValues(gameLog, player.primaryPosition === "G" ? "G" : "SKATER");
      if (perGame.length === 0) {
        skipped.push(`${player.fullName} (no games found)`);
        return;
      }

      // Hits/blocks aren't in the game-log response at all — pull them
      // from each game's boxscore instead, for skaters only. Bounded
      // concurrency within a player's own games on top of the outer
      // per-player concurrency, since a full season can be 70+ games.
      if (player.primaryPosition !== "G") {
        await mapWithConcurrency(perGame, 4, async (g) => {
          try {
            const box = await cachedBoxscore(g.gameId);
            const hb = box.get(nhlId);
            if (hb) {
              g.values.HIT = hb.hits;
              g.values.BLK = hb.blockedShots;
            }
          } catch {
            // Leave this game's HIT/BLK at 0 rather than failing the
            // whole player over one bad boxscore fetch.
          }
        });
      }

      for (const g of perGame) {
        await prisma.playerGameLog.upsert({
          where: { playerId_gameDate: { playerId: player.id, gameDate: new Date(`${g.gameDate}T00:00:00Z`) } },
          create: {
            playerId: player.id,
            gameDate: new Date(`${g.gameDate}T00:00:00Z`),
            values: g.values,
            source: "NHL_SYNC",
          },
          update: { values: g.values, source: "NHL_SYNC" },
        });
        gamesUpserted++;
      }
      playersMatched++;
    } catch (err) {
      errored.push(`${player.fullName} (${err instanceof Error ? err.message : "unknown error"})`);
    } finally {
      if (progressKey) await incrementSyncProgress(progressKey);
    }
  });

  return { playersMatched, gamesUpserted, skipped, errored };
}
