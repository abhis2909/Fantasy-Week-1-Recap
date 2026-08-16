import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { HighlightBox } from "@/components/ui/HighlightBox";
import { getCurrentSeason } from "@/lib/currentSeason";
import { prisma } from "@/lib/prisma";
import {
  findBestNhlMatch,
  getNhlHeadshotUrl,
  getPlayerGameLog,
  getRawGameLogJson,
  getRawSearchJson,
  getTeamRoster,
  getRawTeamRosterJson,
  getGameHitsAndBlocks,
  getRawBoxscoreJson,
  aggregateSkaterStats,
  aggregateGoalieStats,
  mapGameLogToPerGameValues,
  mapWithConcurrency,
  gameDateInRange,
  gameIdOf,
  NHL_GAME_TYPE_REGULAR_SEASON,
  NHL_TEAM_ABBREVS,
  type GameHitsBlocks,
} from "@/lib/nhl";
import { isLegacyFictionalName } from "@/lib/depthPlayerNames";
import { renameLegacyFictionalPlayers } from "@/lib/playerCleanup";
import {
  sumGameLogValues,
  blendedCategoryAverages,
  percentileCategoryScores,
  seasonBlendWeight,
  type PlayerCategoryInputs,
} from "@/lib/playerRating";

// Bulk-syncing a whole roster against an external API can run long — each
// skater now needs one game-log request plus one boxscore request per
// distinct game (hits/blocks aren't in the game-log response at all — see
// lib/nhl.ts). A full-season sync across a real roster can mean hundreds
// of boxscore calls, so this needs real headroom, not just "a bit above
// the default." (This page's server actions inherit it too.)
export const maxDuration = 300;

function qs(params: Record<string, string | number>) {
  return new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))).toString();
}

/** A gameId -> skater hits/blocks map, shared across every player processed
 * in one sync run — many rostered players share NHL games (same team, or
 * just an overlapping schedule), so this avoids re-fetching the same
 * boxscore once per player. Not perfectly race-free under concurrency (two
 * players hitting an uncached gameId at the same instant can both fetch
 * once before either caches), but that's just a little wasted work, not a
 * correctness problem — the shared prisma.playerGameLog upsert underneath
 * is what actually needs to be safe to repeat, and it already is.
 */
function createBoxscoreCache() {
  const cache = new Map<number, Map<number, GameHitsBlocks>>();
  return async function cachedBoxscore(gameId: number): Promise<Map<number, GameHitsBlocks>> {
    const existing = cache.get(gameId);
    if (existing) return existing;
    const fetched = await getGameHitsAndBlocks(gameId);
    cache.set(gameId, fetched);
    return fetched;
  };
}

export default async function NhlSyncPage({
  searchParams,
}: PageProps<"/admin/nhl-sync">) {
  const sp = await searchParams;
  const season = await getCurrentSeason();
  const weeks = await prisma.week.findMany({ where: { seasonId: season.id }, orderBy: { number: "desc" } });
  const players = await prisma.player.findMany({ orderBy: { fullName: "asc" } });
  const matchedCount = players.filter((p) => p.externalId).length;
  const fictionalCount = players.filter((p) => isLegacyFictionalName(p.fullName)).length;

  const cleanupRenamed = Array.isArray(sp.cleanupRenamed) ? sp.cleanupRenamed[0] : sp.cleanupRenamed;
  const cleanupFailed = (Array.isArray(sp.cleanupFailed) ? sp.cleanupFailed : sp.cleanupFailed ? [sp.cleanupFailed] : []) as string[];

  const photoMatched = Array.isArray(sp.photoMatched) ? sp.photoMatched[0] : sp.photoMatched;
  const photoSkipped = (Array.isArray(sp.photoSkipped) ? sp.photoSkipped : sp.photoSkipped ? [sp.photoSkipped] : []) as string[];
  const photoErrored = (Array.isArray(sp.photoErrored) ? sp.photoErrored : sp.photoErrored ? [sp.photoErrored] : []) as string[];

  const statWeek = Array.isArray(sp.statWeek) ? sp.statWeek[0] : sp.statWeek;
  const statMatched = Array.isArray(sp.statMatched) ? sp.statMatched[0] : sp.statMatched;
  const statSkipped = (Array.isArray(sp.statSkipped) ? sp.statSkipped : sp.statSkipped ? [sp.statSkipped] : []) as string[];
  const statErrored = (Array.isArray(sp.statErrored) ? sp.statErrored : sp.statErrored ? [sp.statErrored] : []) as string[];

  const debugName = Array.isArray(sp.debugName) ? sp.debugName[0] : sp.debugName;
  const debugResult = Array.isArray(sp.debugResult) ? sp.debugResult[0] : sp.debugResult;
  const debugError = Array.isArray(sp.debugError) ? sp.debugError[0] : sp.debugError;

  const debugSearchName = Array.isArray(sp.debugSearchName) ? sp.debugSearchName[0] : sp.debugSearchName;
  const debugSearchResult = Array.isArray(sp.debugSearchResult) ? sp.debugSearchResult[0] : sp.debugSearchResult;
  const debugSearchError = Array.isArray(sp.debugSearchError) ? sp.debugSearchError[0] : sp.debugSearchError;

  const gamesMatched = Array.isArray(sp.gamesMatched) ? sp.gamesMatched[0] : sp.gamesMatched;
  const gamesSynced = Array.isArray(sp.gamesSynced) ? sp.gamesSynced[0] : sp.gamesSynced;
  const gamesSkipped = (Array.isArray(sp.gamesSkipped) ? sp.gamesSkipped : sp.gamesSkipped ? [sp.gamesSkipped] : []) as string[];
  const gamesErrored = (Array.isArray(sp.gamesErrored) ? sp.gamesErrored : sp.gamesErrored ? [sp.gamesErrored] : []) as string[];

  const poolCreated = Array.isArray(sp.poolCreated) ? sp.poolCreated[0] : sp.poolCreated;
  const poolMatched = Array.isArray(sp.poolMatched) ? sp.poolMatched[0] : sp.poolMatched;
  const poolErrored = (Array.isArray(sp.poolErrored) ? sp.poolErrored : sp.poolErrored ? [sp.poolErrored] : []) as string[];

  const debugRosterTeam = Array.isArray(sp.debugRosterTeam) ? sp.debugRosterTeam[0] : sp.debugRosterTeam;
  const debugRosterResult = Array.isArray(sp.debugRosterResult) ? sp.debugRosterResult[0] : sp.debugRosterResult;
  const debugRosterError = Array.isArray(sp.debugRosterError) ? sp.debugRosterError[0] : sp.debugRosterError;

  const debugBoxGameId = Array.isArray(sp.debugBoxGameId) ? sp.debugBoxGameId[0] : sp.debugBoxGameId;
  const debugBoxResult = Array.isArray(sp.debugBoxResult) ? sp.debugBoxResult[0] : sp.debugBoxResult;
  const debugBoxError = Array.isArray(sp.debugBoxError) ? sp.debugBoxError[0] : sp.debugBoxError;

  const seasonScoresUpdated = Array.isArray(sp.seasonScoresUpdated) ? sp.seasonScoresUpdated[0] : sp.seasonScoresUpdated;
  const seasonScoresBlendPct = Array.isArray(sp.seasonScoresBlendPct) ? sp.seasonScoresBlendPct[0] : sp.seasonScoresBlendPct;
  const seasonScoresSkipped = (Array.isArray(sp.seasonScoresSkipped) ? sp.seasonScoresSkipped : sp.seasonScoresSkipped ? [sp.seasonScoresSkipped] : []) as string[];
  const seasonScoresErrored = (Array.isArray(sp.seasonScoresErrored) ? sp.seasonScoresErrored : sp.seasonScoresErrored ? [sp.seasonScoresErrored] : []) as string[];

  const gameLogCount = await prisma.playerGameLog.count();
  const seasonRatingCount = await prisma.playerSeasonRating.count();

  async function cleanupFictionalNames() {
    "use server";
    const { renamed, failed } = await renameLegacyFictionalPlayers();
    revalidatePath("/admin/nhl-sync");
    redirect(
      `/admin/nhl-sync?${qs({ cleanupRenamed: renamed })}${failed.map((n) => `&cleanupFailed=${encodeURIComponent(n)}`).join("")}`
    );
  }

  async function syncPhotos() {
    "use server";
    const all = await prisma.player.findMany();
    let matched = 0;
    const skipped: string[] = [];
    const errored: string[] = [];

    await mapWithConcurrency(all, 6, async (player) => {
      try {
        const match = await findBestNhlMatch(player.fullName);
        if (!match) {
          skipped.push(player.fullName);
          return;
        }
        const headshot = await getNhlHeadshotUrl(match.nhlPlayerId);
        await prisma.player.update({
          where: { id: player.id },
          data: {
            photoUrl: headshot ?? player.photoUrl,
            externalId: String(match.nhlPlayerId),
            externalSource: "NHL_SYNC",
            nhlTeamAbbrev: match.teamAbbrev ?? player.nhlTeamAbbrev,
          },
        });
        matched++;
      } catch {
        errored.push(player.fullName);
      }
    });

    revalidatePath("/admin/nhl-sync");
    redirect(
      `/admin/nhl-sync?${qs({ photoMatched: matched })}${skipped.map((n) => `&photoSkipped=${encodeURIComponent(n)}`).join("")}${errored.map((n) => `&photoErrored=${encodeURIComponent(n)}`).join("")}`
    );
  }

  async function syncStats(formData: FormData) {
    "use server";
    const weekId = formData.get("weekId") as string;
    const week = await prisma.week.findUniqueOrThrow({ where: { id: weekId }, include: { season: true } });
    const seasonId = `${week.season.year}${week.season.year + 1}`;

    const activeRoster = await prisma.rosterEntry.findMany({
      where: { droppedAt: null, team: { seasonId: week.seasonId } },
      include: { player: true, team: true },
    });

    const cachedBoxscore = createBoxscoreCache();
    let matched = 0;
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

        const gameLog = await getPlayerGameLog(nhlId, seasonId, NHL_GAME_TYPE_REGULAR_SEASON);
        const result =
          player.primaryPosition === "G"
            ? aggregateGoalieStats(gameLog, week.startDate, week.endDate)
            : aggregateSkaterStats(gameLog, week.startDate, week.endDate);

        if (result.gamesFound === 0) {
          skipped.push(`${player.fullName} (no games this week)`);
          return;
        }

        // Hits/blocks aren't in the game-log response at all — pull them
        // from each in-range game's boxscore instead, for skaters only.
        if (player.primaryPosition !== "G") {
          const inRangeGameIds = gameLog
            .filter((e) => gameDateInRange(e.gameDate, week.startDate, week.endDate))
            .map((e) => gameIdOf(e));
          let hits = 0;
          let blockedShots = 0;
          for (const gameId of inRangeGameIds) {
            try {
              const box = await cachedBoxscore(gameId);
              const hb = box.get(nhlId);
              if (hb) {
                hits += hb.hits;
                blockedShots += hb.blockedShots;
              }
            } catch {
              // Leave this game's contribution at 0 rather than failing
              // the whole player over one bad boxscore fetch.
            }
          }
          result.values.HIT = hits;
          result.values.BLK = blockedShots;
        }

        const categories = await prisma.scoringCategory.findMany({
          where: { leagueId: season.leagueId, enabled: true },
        });
        const categoryByCode = new Map(categories.map((c) => [c.code, c]));

        await prisma.weeklyRosterSlot.upsert({
          where: { weekId_teamId_playerId: { weekId, teamId: entry.teamId, playerId: player.id } },
          create: { weekId, teamId: entry.teamId, playerId: player.id, slot: player.primaryPosition, started: true },
          update: {},
        });

        for (const [code, value] of Object.entries(result.values)) {
          const category = categoryByCode.get(code);
          if (!category) continue;
          await prisma.statLine.upsert({
            where: { weekId_playerId_categoryId: { weekId, playerId: player.id, categoryId: category.id } },
            create: { weekId, playerId: player.id, categoryId: category.id, value, source: "NHL_SYNC" },
            update: { value, source: "NHL_SYNC" },
          });
        }
        matched++;
      } catch (err) {
        errored.push(`${player.fullName} (${err instanceof Error ? err.message : "unknown error"})`);
      }
    });

    revalidatePath("/admin/nhl-sync");
    redirect(
      `/admin/nhl-sync?${qs({ statWeek: weekId, statMatched: matched })}${skipped.map((n) => `&statSkipped=${encodeURIComponent(n)}`).join("")}${errored.map((n) => `&statErrored=${encodeURIComponent(n)}`).join("")}`
    );
  }

  async function syncGameLogs() {
    "use server";
    const activeRoster = await prisma.rosterEntry.findMany({
      where: { droppedAt: null, team: { seasonId: season.id } },
      include: { player: true },
    });
    const seasonId = `${season.year}${season.year + 1}`;
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

        const gameLog = await getPlayerGameLog(nhlId, seasonId, NHL_GAME_TYPE_REGULAR_SEASON);
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
      }
    });

    revalidatePath("/admin/nhl-sync");
    redirect(
      `/admin/nhl-sync?${qs({ gamesMatched: playersMatched, gamesSynced: gamesUpserted })}${skipped.map((n) => `&gamesSkipped=${encodeURIComponent(n)}`).join("")}${errored.map((n) => `&gamesErrored=${encodeURIComponent(n)}`).join("")}`
    );
  }

  /**
   * Recomputes each rostered player's "Ultimate Team"-style season card
   * score — last season's rating blended toward this season's actual
   * performance as the calendar moves through the season (see
   * lib/playerRating.ts's seasonBlendWeight/blendedSeasonScores). Meant to
   * be re-run roughly monthly; it's a plain recompute-and-overwrite each
   * time (not incremental), so running it any time is safe and just
   * refreshes both the blend weight and the underlying data.
   */
  async function updateSeasonCardScores() {
    "use server";
    const activeRoster = await prisma.rosterEntry.findMany({
      where: { droppedAt: null, team: { seasonId: season.id } },
      include: { player: true },
    });
    const lastSeasonId = `${season.year - 1}${season.year}`;
    const currentWeight = seasonBlendWeight(new Date(), season.year);

    const skipped: string[] = [];
    const errored: string[] = [];

    // Phase 1: gather every player's blended per-game averages (real NHL
    // data only — no hand-guessed constants anywhere in this). Percentile
    // scoring below needs the *whole* roster's averages before it can rank
    // anyone, so nothing gets scored or written to the DB in this phase.
    //
    // Lower concurrency than the other sync actions on this page (3 vs 6)
    // — this one can fire up to two NHL requests per player (a search match
    // for anyone not yet NHL-linked, plus the last-season game log for
    // everyone), the most of any action here, and a full-roster run at
    // concurrency 6 was enough burst traffic to get every single request
    // 429'd. lib/nhl.ts's fetchNhl already retries 429s with backoff, but
    // that's a second line of defense — better to not lean on it this hard
    // in the first place.
    const playerInputs: PlayerCategoryInputs[] = [];
    await mapWithConcurrency(activeRoster, 3, async (entry) => {
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

        // Last season: fetched fresh each run, not persisted to
        // PlayerGameLog — this is a baseline for the blend, not part of
        // the "last 10 games" per-game history. HIT/BLK deliberately
        // dropped: getting real per-game hits/blocks needs a boxscore call
        // per game (see lib/nhl.ts), and doing that for a whole prior
        // season across a full roster is too expensive for an admin
        // button — blendedCategoryAverages falls back to null (no data)
        // for exactly this case rather than wrongly treating it as a real
        // zero.
        //
        // A rostered player having *no* last-season NHL record at all is
        // common, not exceptional — rookies, recent call-ups, anyone who
        // missed the whole prior season — and the NHL API 404s for that
        // case rather than returning an empty log. That's expected, not a
        // real failure, so it's caught here specifically (unlike the outer
        // try/catch, which should still fail this player loudly for a
        // genuine problem): treat it as "no last-season data," which
        // blendedCategoryAverages already knows how to fall back from,
        // instead of aborting this player's whole update over it.
        let lastSeasonTotals: Record<string, number> = {};
        let lastSeasonGameCount = 0;
        try {
          const lastSeasonGameLog = await getPlayerGameLog(nhlId, lastSeasonId, NHL_GAME_TYPE_REGULAR_SEASON);
          const lastSeasonPerGame = mapGameLogToPerGameValues(
            lastSeasonGameLog,
            player.primaryPosition === "G" ? "G" : "SKATER"
          );
          lastSeasonTotals = sumGameLogValues(lastSeasonPerGame);
          lastSeasonGameCount = lastSeasonPerGame.length;
        } catch {
          // No last-season data available — fine, blendedCategoryAverages
          // falls back to null (no data) for a player with 0 last-season
          // games.
        }
        if (player.primaryPosition !== "G") {
          delete lastSeasonTotals.HIT;
          delete lastSeasonTotals.BLK;
        }

        // This season: whatever's already in PlayerGameLog from "Sync full
        // season game logs" — which does include real boxscore-enriched
        // HIT/BLK, so those come back for real once this season's data
        // starts carrying weight in the blend.
        const thisSeasonGameLogs = await prisma.playerGameLog.findMany({ where: { playerId: player.id } });
        const thisSeasonTotals = sumGameLogValues(thisSeasonGameLogs);

        const averages = blendedCategoryAverages(
          lastSeasonTotals,
          lastSeasonGameCount,
          thisSeasonTotals,
          thisSeasonGameLogs.length,
          player.primaryPosition,
          currentWeight
        );
        playerInputs.push({ playerId: player.id, position: player.primaryPosition, averages });
      } catch (err) {
        errored.push(`${player.fullName} (${err instanceof Error ? err.message : "unknown error"})`);
      }
    });

    // Phase 2: rank every gathered player's averages against their position
    // group (forward/defense/goalie) into 0-100 percentile scores, then
    // write them all — this is the only place PlayerSeasonRating actually
    // gets upserted, so a player who errored in phase 1 above correctly
    // never gets a (possibly stale) row touched this run.
    const scoresByPlayer = percentileCategoryScores(playerInputs);
    let updated = 0;
    for (const { playerId } of playerInputs) {
      const { categoryScores, overall } = scoresByPlayer.get(playerId)!;
      await prisma.playerSeasonRating.upsert({
        where: { playerId },
        create: { playerId, overall, categoryScores, currentSeasonWeight: currentWeight },
        update: { overall, categoryScores, currentSeasonWeight: currentWeight },
      });
      updated++;
    }

    revalidatePath("/admin/nhl-sync");
    revalidatePath("/players");
    revalidatePath("/team-of-the-week");
    redirect(
      `/admin/nhl-sync?${qs({ seasonScoresUpdated: updated, seasonScoresBlendPct: Math.round(currentWeight * 100) })}${skipped.map((n) => `&seasonScoresSkipped=${encodeURIComponent(n)}`).join("")}${errored.map((n) => `&seasonScoresErrored=${encodeURIComponent(n)}`).join("")}`
    );
  }

  /**
   * Pre-loads every current NHL player as a free agent — ahead of actually
   * needing them, so the pool is ready once a real add/drop or a future
   * Yahoo sync needs to find someone who isn't already on a fantasy roster.
   * De-dupes against already-known players two ways: by externalId (a
   * player already NHL-matched) and by exact name (a player already on a
   * fantasy roster but not yet NHL-matched) — either way, that existing
   * Player row gets updated in place rather than a duplicate being created.
   */
  async function importFullNhlPool() {
    "use server";
    const existing = await prisma.player.findMany();
    const byExternalId = new Map(existing.filter((p) => p.externalId).map((p) => [p.externalId!, p]));
    const byName = new Map(existing.map((p) => [p.fullName.trim().toLowerCase(), p]));

    let created = 0;
    let matched = 0;
    const errored: string[] = [];

    await mapWithConcurrency([...NHL_TEAM_ABBREVS], 4, async (teamAbbrev) => {
      try {
        const roster = await getTeamRoster(teamAbbrev);
        for (const p of roster) {
          const externalId = String(p.nhlPlayerId);
          if (byExternalId.has(externalId)) continue;

          const existingByName = byName.get(p.name.trim().toLowerCase());
          if (existingByName) {
            await prisma.player.update({
              where: { id: existingByName.id },
              data: {
                externalId,
                photoUrl: p.headshot ?? existingByName.photoUrl,
                externalSource: "NHL_SYNC",
                nhlTeamAbbrev: teamAbbrev,
              },
            });
            byExternalId.set(externalId, existingByName);
            matched++;
            continue;
          }

          const created_ = await prisma.player.create({
            data: {
              fullName: p.name,
              primaryPosition: p.position,
              externalId,
              photoUrl: p.headshot,
              externalSource: "NHL_SYNC",
              nhlTeamAbbrev: teamAbbrev,
            },
          });
          byExternalId.set(externalId, created_);
          byName.set(p.name.trim().toLowerCase(), created_);
          created++;
        }
      } catch (err) {
        errored.push(`${teamAbbrev} (${err instanceof Error ? err.message : "unknown error"})`);
      }
    });

    revalidatePath("/admin/nhl-sync");
    revalidatePath("/players");
    redirect(
      `/admin/nhl-sync?${qs({ poolCreated: created, poolMatched: matched })}${errored.map((e) => `&poolErrored=${encodeURIComponent(e)}`).join("")}`
    );
  }

  async function debugRosterPreview(formData: FormData) {
    "use server";
    const team = (formData.get("debugRosterTeam") as string)?.trim().toUpperCase();
    if (!team) return;
    let result: string | null = null;
    let error: string | null = null;
    try {
      const raw = await getRawTeamRosterJson(team);
      result = JSON.stringify(raw, null, 2).slice(0, 4000);
    } catch (err) {
      error = err instanceof Error ? err.message : "Unknown error";
    }
    redirect(
      `/admin/nhl-sync?${qs(result !== null ? { debugRosterTeam: team, debugRosterResult: result } : { debugRosterTeam: team, debugRosterError: error! })}`
    );
  }

  async function debugBoxscorePreview(formData: FormData) {
    "use server";
    const gameIdRaw = (formData.get("debugBoxGameId") as string)?.trim();
    if (!gameIdRaw) return;
    let result: string | null = null;
    let error: string | null = null;
    try {
      const gameId = Number(gameIdRaw);
      if (!Number.isInteger(gameId)) throw new Error("Game ID must be a number.");
      const raw = await getRawBoxscoreJson(gameId);
      result = JSON.stringify(raw, null, 2).slice(0, 4000);
    } catch (err) {
      error = err instanceof Error ? err.message : "Unknown error";
    }
    redirect(
      `/admin/nhl-sync?${qs(result !== null ? { debugBoxGameId: gameIdRaw, debugBoxResult: result } : { debugBoxGameId: gameIdRaw, debugBoxError: error! })}`
    );
  }

  async function debugSearchPreview(formData: FormData) {
    "use server";
    const name = (formData.get("debugSearchName") as string)?.trim();
    if (!name) return;
    // NOTE: redirect() works by throwing internally — it must never be
    // called inside this try, or its own throw gets caught below and
    // reported as a fake "NEXT_REDIRECT" error. Compute the outcome first,
    // then redirect exactly once after the try/catch.
    let result: string | null = null;
    let error: string | null = null;
    try {
      const raw = await getRawSearchJson(name);
      result = JSON.stringify(raw, null, 2).slice(0, 4000);
    } catch (err) {
      error = err instanceof Error ? err.message : "Unknown error";
    }
    redirect(
      `/admin/nhl-sync?${qs(result !== null ? { debugSearchName: name, debugSearchResult: result } : { debugSearchName: name, debugSearchError: error! })}`
    );
  }

  async function debugPreview(formData: FormData) {
    "use server";
    const name = (formData.get("debugName") as string)?.trim();
    if (!name) return;
    let result: string | null = null;
    let error: string | null = null;
    try {
      const match = await findBestNhlMatch(name);
      if (!match) {
        error = "No exact NHL name match found.";
      } else {
        const seasonId = `${season.year}${season.year + 1}`;
        const raw = await getRawGameLogJson(match.nhlPlayerId, seasonId, NHL_GAME_TYPE_REGULAR_SEASON);
        result = JSON.stringify(raw, null, 2).slice(0, 4000);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Unknown error";
    }
    redirect(
      `/admin/nhl-sync?${qs(result !== null ? { debugName: name, debugResult: result } : { debugName: name, debugError: error! })}`
    );
  }

  return (
    <>
      <PageHeader
        title="NHL Sync"
        subtitle="Match rostered players to real NHL records for photos and auto-filled weekly stats."
      />

      <SectionCard title="How this works">
        <p className="text-cream/80">
          Uses NHL.com&apos;s own (unofficial, undocumented) API — the same one nhl.com&apos;s
          search bar and stats pages use. Not an officially supported developer API, so field
          names in its responses aren&apos;t guaranteed and could change. Only exact
          (case-insensitive) name matches are applied automatically.
        </p>
        <p className="mt-2 text-cream/80">
          Weekly stat sync assumes every synced player was <strong>started</strong> that week —
          it can&apos;t know your lineup decisions, only real game stats. Use the Stat Lines CSV
          page afterward if you need to mark anyone as benched, or to correct a value.
        </p>
      </SectionCard>

      {fictionalCount > 0 && (
        <SectionCard title="Clean up made-up player names">
          <p className="mb-4 text-cream/80">
            {fictionalCount} player{fictionalCount === 1 ? "" : "s"} on the roster still{" "}
            {fictionalCount === 1 ? "has" : "have"} a made-up bench-filler name from the original
            fixture data (not a real NHL player) — those can never match against the NHL API. This
            renames them in place to real (non-star) active NHL players at the same position, so
            they can be photo- and stat-synced like everyone else. It only changes the name — the
            same player record keeps all its existing roster history, stats, and transactions.
          </p>
          {cleanupRenamed && (
            <HighlightBox title="Cleanup complete">
              <p>Renamed {cleanupRenamed} player{cleanupRenamed === "1" ? "" : "s"}.</p>
              {cleanupFailed.length > 0 && (
                <p className="mt-2 text-danger">
                  Ran out of unique real names for: {cleanupFailed.join(", ")}
                </p>
              )}
            </HighlightBox>
          )}
          <form action={cleanupFictionalNames}>
            <button
              type="submit"
              className="mt-2 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy-deep transition hover:bg-gold-bright"
            >
              Rename made-up players to real ones
            </button>
          </form>
        </SectionCard>
      )}

      <SectionCard title="Player photos & NHL matching">
        <p className="mb-4 text-cream/80">
          {matchedCount} / {players.length} players currently matched to an NHL record.
        </p>
        {photoMatched && (
          <HighlightBox title="Sync complete">
            <p>Matched {photoMatched} player{photoMatched === "1" ? "" : "s"}.</p>
            {photoSkipped.length > 0 && <p className="mt-2">No exact match: {photoSkipped.join(", ")}</p>}
            {photoErrored.length > 0 && <p className="mt-2 text-danger">Errors: {photoErrored.join(", ")}</p>}
          </HighlightBox>
        )}
        <form action={syncPhotos}>
          <button
            type="submit"
            className="mt-2 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy-deep transition hover:bg-gold-bright"
          >
            Sync photos &amp; match all players
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Weekly stat sync">
        {statWeek && (
          <HighlightBox title="Sync complete">
            <p>Filled stats for {statMatched} player{statMatched === "1" ? "" : "s"}.</p>
            {statSkipped.length > 0 && <p className="mt-2">Skipped: {statSkipped.join(", ")}</p>}
            {statErrored.length > 0 && <p className="mt-2 text-danger">Errors: {statErrored.join(", ")}</p>}
          </HighlightBox>
        )}
        <form action={syncStats} className="mt-2 flex flex-wrap items-center gap-3">
          <select
            name="weekId"
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white [&>option]:text-ink"
          >
            {weeks.map((w) => (
              <option key={w.id} value={w.id}>
                Week {w.number}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy-deep transition hover:bg-gold-bright"
          >
            Pull stats from NHL for this week
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Individual player pages: full season game log">
        <p className="mb-4 text-cream/80">
          {gameLogCount} game{gameLogCount === 1 ? "" : "s"} stored across all players. Powers
          the per-player pages (<code className="text-gold">/players</code>) — season totals,
          last 10 games, and a 0-100 rating for each game via the fixed-weight valuation model
          (<code className="text-gold">lib/playerRating.ts</code>).
        </p>
        <p className="mb-4 text-cream/80">
          Hits and Blocked Shots come from a second, per-<em>game</em> boxscore request (the
          game-log endpoint above doesn&apos;t report either at all) — one extra request per
          distinct game a rostered skater played, cached and reused across players who share a
          game. For a full season across a real roster that can mean hundreds of extra requests,
          so this can take a few minutes on a fresh run.
        </p>
        {gamesMatched && (
          <HighlightBox title="Sync complete">
            <p>
              Synced {gamesSynced} game{gamesSynced === "1" ? "" : "s"} across {gamesMatched}{" "}
              player{gamesMatched === "1" ? "" : "s"}.
            </p>
            {gamesSkipped.length > 0 && <p className="mt-2">No exact match: {gamesSkipped.join(", ")}</p>}
            {gamesErrored.length > 0 && <p className="mt-2 text-danger">Errors: {gamesErrored.join(", ")}</p>}
          </HighlightBox>
        )}
        <form action={syncGameLogs}>
          <button
            type="submit"
            className="mt-2 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy-deep transition hover:bg-gold-bright"
          >
            Sync full season game logs
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Player card scores">
        <p className="mb-3 text-cream/80">
          {seasonRatingCount} of {players.length} players have a card score. This is the
          &quot;Ultimate Team&quot;-style overall + per-category rating shown on player cards —
          separate from the per-game ratings above. Each category score is a percentile: every
          rostered player&apos;s real per-game average in that category, blended from last season
          and this season (currently {Math.round(seasonBlendWeight(new Date(), season.year) * 100)}
          % this season, the rest last season), ranked against every other rostered player at the
          same position group. No hand-picked baseline involved — it&apos;s entirely a function of
          what the NHL API actually returned for this roster, so it re-calibrates itself to
          whatever this league&apos;s real talent spread looks like. Requires last season&apos;s
          game log, so it makes one extra NHL request per rostered player on top of whatever
          &quot;Sync full season game logs&quot; already did.
        </p>
        <p className="mb-4 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">
          <strong>This is a separate step from syncing stats above.</strong> Running &quot;Sync
          full season game logs&quot; does <em>not</em> refresh card scores — the numbers on
          player cards won&apos;t reflect newly-synced stats until this button is run again too.
          Re-run it after every stats sync, and roughly monthly regardless, to keep the season
          blend current.
        </p>
        {seasonScoresUpdated && (
          <HighlightBox title="Update complete">
            <p>
              Updated {seasonScoresUpdated} player{seasonScoresUpdated === "1" ? "" : "s"} —{" "}
              {seasonScoresBlendPct}% weighted toward this season.
            </p>
            {seasonScoresSkipped.length > 0 && (
              <p className="mt-2">No exact match: {seasonScoresSkipped.join(", ")}</p>
            )}
            {seasonScoresErrored.length > 0 && (
              <p className="mt-2 text-danger">Errors: {seasonScoresErrored.join(", ")}</p>
            )}
          </HighlightBox>
        )}
        <form action={updateSeasonCardScores}>
          <button
            type="submit"
            className="mt-2 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy-deep transition hover:bg-gold-bright"
          >
            Update season card scores
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Full NHL player pool (free agents)">
        <p className="mb-4 text-cream/80">
          {players.length} players currently in the database (rostered + free agents). Pre-loads
          every current player on all 32 NHL rosters as a searchable free agent — so the full
          pool is ready ahead of a real add/drop or a future Yahoo sync, not just the players
          already on a fantasy roster. Safe to re-run: players already known (by NHL ID or exact
          name) are matched up rather than duplicated. This calls the NHL API 32 times, so it can
          take up to a minute.
        </p>
        {poolCreated && (
          <HighlightBox title="Import complete">
            <p>
              Added {poolCreated} new free agent{poolCreated === "1" ? "" : "s"}, matched{" "}
              {poolMatched} existing player{poolMatched === "1" ? "" : "s"} to their NHL record.
            </p>
            {poolErrored.length > 0 && (
              <p className="mt-2 text-danger">Teams that failed: {poolErrored.join(", ")}</p>
            )}
          </HighlightBox>
        )}
        <form action={importFullNhlPool}>
          <button
            type="submit"
            className="mt-2 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy-deep transition hover:bg-gold-bright"
          >
            Import full NHL player pool
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Debug: preview a raw NHL roster response">
        <p className="mb-3 text-sm text-cream/70">
          The roster endpoint&apos;s shape (unlike search/game-log above) hasn&apos;t been
          verified against a live response at all — if the pool import above reports errors for
          every team, this shows the real JSON for one team so the parser in{" "}
          <code className="text-white">lib/nhl.ts</code>&apos;s <code className="text-white">getTeamRoster</code>{" "}
          can be fixed to match.
        </p>
        {debugRosterError && <HighlightBox title="Couldn't fetch">{debugRosterError}</HighlightBox>}
        <form action={debugRosterPreview} className="mb-3 flex flex-wrap gap-3">
          <input
            name="debugRosterTeam"
            defaultValue={debugRosterTeam}
            placeholder="e.g. EDM"
            className="w-32 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-cream/50 uppercase"
          />
          <button
            type="submit"
            className="rounded-lg border-2 border-gold px-4 py-2 text-sm font-semibold text-gold transition hover:bg-gold/10"
          >
            Preview raw roster response
          </button>
        </form>
        {debugRosterResult && (
          <pre className="max-h-96 overflow-auto rounded-lg bg-black/40 p-4 text-xs text-cream/90">
            {debugRosterResult}
          </pre>
        )}
      </SectionCard>

      <SectionCard title="Debug: preview a raw NHL boxscore response">
        <p className="mb-3 text-sm text-cream/70">
          Hits/Blocked Shots come from this endpoint — also unverified against a live response.
          If they&apos;re still showing 0 after a sync, type a real NHL game ID here (find one in
          the game-log debug box below — each game entry has a{" "}
          <code className="text-white">gameId</code>) to see the real JSON, and the field names in{" "}
          <code className="text-white">lib/nhl.ts</code>&apos;s <code className="text-white">getGameHitsAndBlocks</code>
          /<code className="text-white">extractBoxscoreSkaters</code> are the ones to fix if they differ.
        </p>
        {debugBoxError && <HighlightBox title="Couldn't fetch">{debugBoxError}</HighlightBox>}
        <form action={debugBoxscorePreview} className="mb-3 flex flex-wrap gap-3">
          <input
            name="debugBoxGameId"
            defaultValue={debugBoxGameId}
            placeholder="e.g. 2025021294"
            className="w-48 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-cream/50"
          />
          <button
            type="submit"
            className="rounded-lg border-2 border-gold px-4 py-2 text-sm font-semibold text-gold transition hover:bg-gold/10"
          >
            Preview raw boxscore response
          </button>
        </form>
        {debugBoxResult && (
          <pre className="max-h-96 overflow-auto rounded-lg bg-black/40 p-4 text-xs text-cream/90">
            {debugBoxResult}
          </pre>
        )}
      </SectionCard>

      <SectionCard title="Debug: preview a raw NHL search response">
        <p className="mb-3 text-sm text-cream/70">
          If matching is failing for everyone (even real players like &quot;Connor
          McDavid&quot;), the search request itself is likely fine but returning a shape
          the code doesn&apos;t expect. This shows the untouched JSON straight from NHL&apos;s
          search endpoint, no parsing applied — paste the result back to get the matcher
          fixed.
        </p>
        {debugSearchError && <HighlightBox title="Couldn't fetch">{debugSearchError}</HighlightBox>}
        <form action={debugSearchPreview} className="mb-3 flex flex-wrap gap-3">
          <input
            name="debugSearchName"
            defaultValue={debugSearchName}
            placeholder="e.g. Connor McDavid"
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-cream/50"
          />
          <button
            type="submit"
            className="rounded-lg border-2 border-gold px-4 py-2 text-sm font-semibold text-gold transition hover:bg-gold/10"
          >
            Preview raw search response
          </button>
        </form>
        {debugSearchResult && (
          <pre className="max-h-96 overflow-auto rounded-lg bg-black/40 p-4 text-xs text-cream/90">
            {debugSearchResult}
          </pre>
        )}
      </SectionCard>

      <SectionCard title="Debug: preview a raw NHL game-log response">
        <p className="mb-3 text-sm text-cream/70">
          Type a player&apos;s exact name to see their raw NHL game-log JSON — useful for
          checking the actual field names if stat sync results look wrong. Requires the
          search matcher above to be working first.
        </p>
        {debugError && <HighlightBox title="Couldn't fetch">{debugError}</HighlightBox>}
        <form action={debugPreview} className="mb-3 flex flex-wrap gap-3">
          <input
            name="debugName"
            defaultValue={debugName}
            placeholder="e.g. Connor McDavid"
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-cream/50"
          />
          <button
            type="submit"
            className="rounded-lg border-2 border-gold px-4 py-2 text-sm font-semibold text-gold transition hover:bg-gold/10"
          >
            Preview raw response
          </button>
        </form>
        {debugResult && (
          <pre className="max-h-96 overflow-auto rounded-lg bg-black/40 p-4 text-xs text-cream/90">
            {debugResult}
          </pre>
        )}
      </SectionCard>
    </>
  );
}
