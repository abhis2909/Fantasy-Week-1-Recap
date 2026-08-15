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
 * the same position. Safe to re-run: a player that's already been renamed
 * no longer matches isLegacyFictionalName, so it's simply skipped next
 * time.
 *
 * A real candidate name can already exist in the database as its own
 * Player row — most commonly because "Import full NHL player pool" (see
 * lib/nhl.ts's getTeamRoster) already created it as a free agent. Two
 * different cases:
 *   - That existing Player is a free agent (no active roster spot): the
 *     fictional row and that row are the same real person, so this MERGES
 *     them — every RosterEntry/StatLine/WeeklyRosterSlot/TransactionPlayer/
 *     TeamOfWeekSelection/PlayerGameLog pointing at the fictional player's
 *     id gets re-pointed at the real (already NHL-matched) player's id,
 *     then the now-empty fictional row is deleted. Net effect: the roster
 *     spot now points at a player that's already photo/ID-matched, no
 *     separate photo sync needed.
 *   - That existing Player is actively rostered (a real name collision,
 *     e.g. two same-named players): skip that candidate and try another
 *     from the pool, same as before.
 *
 * Shared by both the /admin/nhl-sync button (a server action) and
 * /api/admin/cleanup-fictional-names (a plain GET route) — the GET route
 * exists because server actions embed a hashed action ID that goes stale
 * across a deploy, and a plain link has no such failure mode.
 */
export async function renameLegacyFictionalPlayers(): Promise<CleanupResult> {
  const all = await prisma.player.findMany({
    include: { rosterEntries: { where: { droppedAt: null }, select: { id: true } } },
  });
  const targets = all.filter((p) => isLegacyFictionalName(p.fullName));

  // Only a name held by an actively-rostered player blocks reusing it —
  // a same-named free agent is a merge target, not a collision.
  const rosteredNames = new Set(all.filter((p) => p.rosterEntries.length > 0).map((p) => p.fullName));
  const byName = new Map(all.map((p) => [p.fullName, p]));

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
      if (!rosteredNames.has(candidate)) {
        newName = candidate;
        break;
      }
    }
    if (!newName) {
      failed.push(player.fullName);
      continue;
    }

    try {
      const mergeTarget = byName.get(newName);
      if (mergeTarget && mergeTarget.id !== player.id) {
        // Same real person already exists as its own row (almost always a
        // free agent from the full NHL pool import) — fold the fictional
        // row into it instead of creating a duplicate with the same name.
        await prisma.$transaction([
          prisma.rosterEntry.updateMany({ where: { playerId: player.id }, data: { playerId: mergeTarget.id } }),
          prisma.weeklyRosterSlot.updateMany({ where: { playerId: player.id }, data: { playerId: mergeTarget.id } }),
          prisma.statLine.updateMany({ where: { playerId: player.id }, data: { playerId: mergeTarget.id } }),
          prisma.transactionPlayer.updateMany({ where: { playerId: player.id }, data: { playerId: mergeTarget.id } }),
          prisma.teamOfWeekSelection.updateMany({ where: { playerId: player.id }, data: { playerId: mergeTarget.id } }),
          prisma.playerGameLog.updateMany({ where: { playerId: player.id }, data: { playerId: mergeTarget.id } }),
          prisma.player.delete({ where: { id: player.id } }),
        ]);
      } else {
        // No existing row for this name — a plain rename. Clear photoUrl/
        // externalId so the next photo sync fetches this (now-real)
        // person's actual headshot instead of leaving a stale placeholder.
        await prisma.player.update({
          where: { id: player.id },
          data: { fullName: newName, photoUrl: null, externalId: null, externalSource: "MANUAL" },
        });
        byName.set(newName, { ...player, fullName: newName });
      }
      rosteredNames.add(newName);
      renamed++;
    } catch {
      // Don't let one problematic row (e.g. an unexpected constraint
      // collision) abort every other player still waiting to be renamed.
      failed.push(`${player.fullName} (error merging into ${newName})`);
    }
  }

  return { renamed, failed };
}
