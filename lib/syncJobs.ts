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
import type { Player } from "@/lib/generated/prisma/client";

export interface FullSeasonSyncResult {
  playersMatched: number;
  gamesUpserted: number;
  skipped: string[];
  errored: string[];
}

interface RosterEntryWithPlayer {
  player: Player;
}

/** One player's worth of the "Sync full season game logs" work — search
 * match if needed, fetch the game log, enrich HIT/BLK from boxscores,
 * upsert every game. Pushes its own outcome into `into` rather than
 * returning it, so the caller can accumulate across a whole batch with one
 * shared mutable object instead of merging return values. */
async function syncOnePlayerGameLog(
  entry: RosterEntryWithPlayer,
  nhlSeasonId: string,
  cachedBoxscore: ReturnType<typeof createBoxscoreCache>,
  into: { matched: number; upserted: number; skipped: string[]; errored: string[] }
): Promise<void> {
  const player = entry.player;
  try {
    let nhlId = player.externalId ? Number(player.externalId) : null;
    if (!nhlId) {
      const match = await findBestNhlMatch(player.fullName);
      if (!match) {
        into.skipped.push(player.fullName);
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
      into.skipped.push(`${player.fullName} (no games found)`);
      return;
    }

    // Hits/blocks aren't in the game-log response at all — pull them from
    // each game's boxscore instead, for skaters only. Bounded concurrency
    // within a player's own games on top of the outer per-player
    // concurrency, since a full season can be 70+ games.
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
          // Leave this game's HIT/BLK at 0 rather than failing the whole
          // player over one bad boxscore fetch.
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
      into.upserted++;
    }
    into.matched++;
  } catch (err) {
    into.errored.push(`${player.fullName} (${err instanceof Error ? err.message : "unknown error"})`);
  }
}

/**
 * Syncs game logs for exactly the given batch of roster entries — the unit
 * of work behind the chunked /api/admin/sync-game-logs route, which
 * processes one small batch per request specifically so no single request
 * can run long enough to hit a serverless duration limit (see that route's
 * doc comment for why: a whole-roster run in one request/background job
 * was found to just silently stop partway through in production).
 *
 * `progressKey`, when given, gets one incrementSyncProgress call per player
 * in this batch (matched, skipped, or errored alike).
 */
export async function runFullSeasonGameLogSyncBatch(
  batch: RosterEntryWithPlayer[],
  nhlSeasonId: string,
  progressKey?: string
): Promise<FullSeasonSyncResult> {
  const cachedBoxscore = createBoxscoreCache();
  const result = { matched: 0, upserted: 0, skipped: [] as string[], errored: [] as string[] };

  await mapWithConcurrency(batch, 6, async (entry) => {
    try {
      await syncOnePlayerGameLog(entry, nhlSeasonId, cachedBoxscore, result);
    } finally {
      if (progressKey) await incrementSyncProgress(progressKey);
    }
  });

  return { playersMatched: result.matched, gamesUpserted: result.upserted, skipped: result.skipped, errored: result.errored };
}

/**
 * The whole-roster version, for the plain server-action fallback only
 * (app/(app)/admin/nhl-sync) — blocks until every player is done, no
 * chunking, so it's exactly as vulnerable to a long-running-request timeout
 * as the original implementation was. That's an accepted tradeoff for the
 * fallback specifically (see its own doc comment): the primary path is the
 * chunked route, this is only reached deliberately when that isn't
 * working.
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
  return runFullSeasonGameLogSyncBatch(activeRoster, nhlSeasonId, progressKey);
}
