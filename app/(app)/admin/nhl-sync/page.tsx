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
  aggregateSkaterStats,
  aggregateGoalieStats,
  mapGameLogToPerGameValues,
  mapWithConcurrency,
  NHL_GAME_TYPE_REGULAR_SEASON,
} from "@/lib/nhl";

// Bulk-syncing a whole roster against an external API can run long —
// each player needs 1-2 outbound requests. Raise the ceiling above
// Vercel's default (this page's server actions inherit it too).
export const maxDuration = 60;

function qs(params: Record<string, string | number>) {
  return new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))).toString();
}

export default async function NhlSyncPage({
  searchParams,
}: PageProps<"/admin/nhl-sync">) {
  const sp = await searchParams;
  const season = await getCurrentSeason();
  const weeks = await prisma.week.findMany({ where: { seasonId: season.id }, orderBy: { number: "desc" } });
  const players = await prisma.player.findMany({ orderBy: { fullName: "asc" } });
  const matchedCount = players.filter((p) => p.externalId).length;

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

  const gameLogCount = await prisma.playerGameLog.count();

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
            data: { externalId: String(nhlId), externalSource: "NHL_SYNC" },
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

        const categories = await prisma.scoringCategory.findMany({ where: { leagueId: season.leagueId } });
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
            data: { externalId: String(nhlId), externalSource: "NHL_SYNC" },
          });
        }

        const gameLog = await getPlayerGameLog(nhlId, seasonId, NHL_GAME_TYPE_REGULAR_SEASON);
        const perGame = mapGameLogToPerGameValues(gameLog, player.primaryPosition === "G" ? "G" : "SKATER");
        if (perGame.length === 0) {
          skipped.push(`${player.fullName} (no games found)`);
          return;
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
          last 10 games, and a 0-100 rating for each game based on a z-score against other
          rostered players at the same position that week.
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
