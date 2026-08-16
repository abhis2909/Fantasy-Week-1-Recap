import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSyncProgress } from "@/lib/syncProgress";

/**
 * Polled by the client while a background sync (started via a POST to a
 * route like /api/admin/sync-game-logs) is running, to render a live
 * progress bar. `?key=` matches whatever SyncProgress row the trigger route
 * created — see lib/syncProgress.ts's exported key constants.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (session?.user.role !== "COMMISSIONER") {
    return NextResponse.json({ error: "Commissioner sign-in required." }, { status: 401 });
  }

  const key = new URL(request.url).searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing ?key=" }, { status: 400 });
  }

  const progress = await getSyncProgress(key);
  if (!progress) {
    return NextResponse.json({ status: "not_started" });
  }
  return NextResponse.json(progress);
}
