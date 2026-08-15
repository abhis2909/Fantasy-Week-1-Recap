import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { renameLegacyFictionalPlayers } from "@/lib/playerCleanup";

/**
 * Plain-link version of the "Rename made-up players to real ones" button on
 * /admin/nhl-sync — same underlying renameLegacyFictionalPlayers() call,
 * just reached by GET instead of a server action form submit.
 *
 * Why this exists: Next.js server actions embed a hashed action ID in the
 * page's HTML, and that ID goes stale the moment the server redeploys — a
 * browser tab left open across a deploy submits an ID the (now-different)
 * server no longer recognizes, and the button errors out with something
 * that has nothing to do with the actual cleanup logic. A plain GET request
 * has no such ID and can't go stale that way, so this is the reliable
 * fallback when the button itself is misbehaving.
 *
 * Requires an active commissioner session — sign in at /login first, then
 * load this URL (bookmarkable, safe to reload/re-run any time).
 */
export async function GET() {
  const session = await auth();
  if (session?.user.role !== "COMMISSIONER") {
    return NextResponse.json(
      { error: "Sign in as the commissioner at /login first, then reload this link." },
      { status: 401 }
    );
  }

  const { renamed, failed } = await renameLegacyFictionalPlayers();
  return NextResponse.json({
    ok: true,
    renamed,
    failed,
    message:
      renamed === 0 && failed.length === 0
        ? "Nothing to clean up — no made-up player names found."
        : `Renamed ${renamed} made-up player${renamed === 1 ? "" : "s"} to real NHL players.` +
          (failed.length > 0
            ? ` Ran out of unique real names for: ${failed.join(", ")}.`
            : ""),
  });
}
