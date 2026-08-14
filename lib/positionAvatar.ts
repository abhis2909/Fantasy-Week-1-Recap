import type { Position } from "@/lib/generated/prisma/client";

/**
 * Generic per-position illustrated avatars (pulled from the original
 * mockup's assets) used whenever a Player has no real `photoUrl` — which,
 * for the manual/CSV-entry MVP, is effectively always. These are decorative
 * placeholders, not likenesses of any specific real player.
 */
const POSITION_AVATARS: Record<Position, string> = {
  C: "/images/positions/c.png",
  LW: "/images/positions/lw.png",
  RW: "/images/positions/rw.png",
  D: "/images/positions/d.png",
  G: "/images/positions/g.webp",
};

export function avatarForPlayer(player: {
  photoUrl?: string | null;
  primaryPosition: Position;
}): string {
  return player.photoUrl || POSITION_AVATARS[player.primaryPosition];
}
