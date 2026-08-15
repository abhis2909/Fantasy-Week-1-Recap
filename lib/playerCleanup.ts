import { prisma } from "@/lib/prisma";
import { depthNamesFor, isLegacyFictionalName } from "@/lib/depthPlayerNames";
import type { Position } from "@/lib/generated/prisma/client";

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface CleanupResult {
  renamed: number;
  failed: string[];
}

/**
 * Renames every Player still carrying an original-seed made-up bench-filler
 * name (e.g. "Blake Whitmore") to a real, currently-active NHL player at
 * the same position — same Player.id, so every RosterEntry/StatLine/
 * Transaction/etc keeps pointing at the same player and no other league
 * history moves. Safe to re-run: a player that's already been renamed no
 * longer matches isLegacyFictionalName, so it's simply skipped next time.
 *
 * Shared by both the /admin/nhl-sync button (a server action) and
 * /api/admin/cleanup-fictional-names (a plain GET route) — the GET route
 * exists because server actions embed a hashed action ID that goes stale
 * across a deploy, and a plain link has no such failure mode.
 */
export async function renameLegacyFictionalPlayers(): Promise<CleanupResult> {
  const all = await prisma.player.findMany();
  const usedNames = new Set(all.map((p) => p.fullName));
  const targets = all.filter((p) => isLegacyFictionalName(p.fullName));

  const pools: Record<Position, string[]> = {
    C: shuffle(depthNamesFor("C")),
    LW: shuffle(depthNamesFor("LW")),
    RW: shuffle(depthNamesFor("RW")),
    D: shuffle(depthNamesFor("D")),
    G: shuffle(depthNamesFor("G")),
  };

  let renamed = 0;
  const failed: string[] = [];
  for (const player of targets) {
    const pool = pools[player.primaryPosition];
    let newName: string | undefined;
    while (pool.length > 0) {
      const candidate = pool.pop()!;
      if (!usedNames.has(candidate)) {
        newName = candidate;
        break;
      }
    }
    if (!newName) {
      failed.push(player.fullName);
      continue;
    }
    usedNames.add(newName);
    await prisma.player.update({
      where: { id: player.id },
      data: { fullName: newName, photoUrl: null, externalId: null, externalSource: "MANUAL" },
    });
    renamed++;
  }

  return { renamed, failed };
}
