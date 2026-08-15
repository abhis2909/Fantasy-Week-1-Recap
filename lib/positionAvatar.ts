import type { Position } from "@/lib/generated/prisma/client";

/**
 * Generic placeholder shown whenever a Player has no real synced
 * `photoUrl` (no NHL match found, or photos haven't been synced yet) — a
 * flat black silhouette, not a likeness of any specific real player.
 * Previously five different per-position illustrations; simplified to one
 * generic image so an unmatched player reads clearly as "no photo yet"
 * rather than looking like a real (if cartoonish) headshot.
 */
const GENERIC_AVATAR = "/images/positions/generic-black.svg";

export function avatarForPlayer(player: {
  photoUrl?: string | null;
  primaryPosition: Position;
}): string {
  return player.photoUrl || GENERIC_AVATAR;
}
