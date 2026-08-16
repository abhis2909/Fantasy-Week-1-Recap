import { NextResponse, after } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentSeason } from "@/lib/currentSeason";
import { runFullSeasonGameLogSync } from "@/lib/syncJobs";
import {
  startSyncProgress,
  finishSyncProgress,
  failSyncProgress,
  FULL_SEASON_SYNC_PROGRESS_KEY,
} from "@/lib/syncProgress";

// Same reasoning as /admin/nhl-sync's own maxDuration: a full-season sync
// across a real roster can mean hundreds of NHL requests. after() keeps
// this function alive past the response it already sent, up to this limit,
// to finish the sync in the background.
export const maxDuration = 300;

/**
 * Kicks off "Sync full season game logs" as a background job instead of
 * blocking the request until it finishes — a plain Server Action gives the
 * browser zero feedback for what can be minutes on a real roster, which
 * just looks like the page froze. Responds immediately once the sync is
 * recorded as "running" (see SyncProgress); the actual work continues via
 * after() and the client polls GET /api/admin/sync-progress for status.
 */
export async function POST() {
  const session = await auth();
  if (session?.user.role !== "COMMISSIONER") {
    return NextResponse.json({ error: "Commissioner sign-in required." }, { status: 401 });
  }

  const season = await getCurrentSeason();
  const nhlSeasonId = `${season.year}${season.year + 1}`;
  const rosterSize = await prisma.rosterEntry.count({
    where: { droppedAt: null, team: { seasonId: season.id } },
  });

  await startSyncProgress(FULL_SEASON_SYNC_PROGRESS_KEY, rosterSize);

  after(async () => {
    try {
      const { playersMatched, gamesUpserted, skipped, errored } = await runFullSeasonGameLogSync(
        season.id,
        nhlSeasonId,
        FULL_SEASON_SYNC_PROGRESS_KEY
      );
      const parts = [`${playersMatched} player${playersMatched === 1 ? "" : "s"} synced`, `${gamesUpserted} games upserted`];
      if (skipped.length > 0) parts.push(`${skipped.length} skipped (${skipped.join(", ")})`);
      if (errored.length > 0) parts.push(`${errored.length} errored (${errored.join(", ")})`);
      await finishSyncProgress(FULL_SEASON_SYNC_PROGRESS_KEY, parts.join(" — "));
      revalidatePath("/admin/nhl-sync");
      revalidatePath("/players");
    } catch (err) {
      await failSyncProgress(
        FULL_SEASON_SYNC_PROGRESS_KEY,
        err instanceof Error ? err.message : "Sync failed for an unknown reason."
      );
    }
  });

  return NextResponse.json({ started: true, total: rosterSize });
}
