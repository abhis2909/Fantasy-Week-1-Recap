import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentSeason } from "@/lib/currentSeason";
import { runFullSeasonGameLogSyncBatch } from "@/lib/syncJobs";
import { startSyncProgress, finishSyncProgress, FULL_SEASON_SYNC_PROGRESS_KEY } from "@/lib/syncProgress";

// A single batch only ever does BATCH_SIZE players' worth of NHL requests,
// so this only needs headroom for that, not a whole roster — see the doc
// comment below for why that matters.
export const maxDuration = 60;

/** How many roster players one request processes. Deliberately small: the
 * first version of this route ran the *entire* roster in one background
 * job (Next's after(), meant to keep a serverless function alive past its
 * response) and was found in production to just silently stop partway
 * through — most likely a platform duration cap lower than this route's
 * own maxDuration setting, which after()-scheduled work doesn't get to
 * override. A single player can already mean a couple dozen requests
 * (game log + one boxscore call per distinct game for HIT/BLK), so even a
 * small batch has real work to do; this keeps any one request's total
 * duration comfortably inside any platform's limit instead of gambling on
 * background execution surviving an unknown budget. */
const BATCH_SIZE = 5;

/**
 * One chunk of "Sync full season game logs" — call repeatedly with
 * increasing `offset` (the client component drives this loop, see
 * components/admin/SyncGameLogsProgress.tsx) until the response comes back
 * `done: true`. Each call is a plain, synchronous request/response — no
 * background job, nothing that depends on surviving past the response —
 * so progress is exactly as current as the last completed chunk, and nothing
 * can silently die partway with no trace.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (session?.user.role !== "COMMISSIONER") {
    return NextResponse.json({ error: "Commissioner sign-in required." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const offset = typeof body.offset === "number" && body.offset >= 0 ? body.offset : 0;

  const season = await getCurrentSeason();
  const nhlSeasonId = `${season.year}${season.year + 1}`;
  // Deterministic order so the same offset always means the same slice of
  // players across calls in one run — an unordered query can't guarantee
  // that.
  const activeRoster = await prisma.rosterEntry.findMany({
    where: { droppedAt: null, team: { seasonId: season.id } },
    include: { player: true },
    orderBy: { id: "asc" },
  });
  const total = activeRoster.length;

  if (offset === 0) {
    await startSyncProgress(FULL_SEASON_SYNC_PROGRESS_KEY, total);
  }

  const batch = activeRoster.slice(offset, offset + BATCH_SIZE);
  const { playersMatched, gamesUpserted, skipped, errored } =
    batch.length > 0
      ? await runFullSeasonGameLogSyncBatch(batch, nhlSeasonId, FULL_SEASON_SYNC_PROGRESS_KEY)
      : { playersMatched: 0, gamesUpserted: 0, skipped: [], errored: [] };

  const completed = Math.min(offset + batch.length, total);
  const done = completed >= total;

  if (done) {
    await finishSyncProgress(FULL_SEASON_SYNC_PROGRESS_KEY, "Sync complete.");
    revalidatePath("/admin/nhl-sync");
    revalidatePath("/players");
  }

  return NextResponse.json({
    done,
    total,
    completed,
    nextOffset: offset + BATCH_SIZE,
    matched: playersMatched,
    upserted: gamesUpserted,
    skipped,
    errored,
  });
}
