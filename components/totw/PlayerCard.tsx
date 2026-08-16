import Image from "next/image";
import Link from "next/link";
import { ScoreBubble } from "./ScoreBubble";
import { avatarForPlayer } from "@/lib/positionAvatar";
import { colorsForTeam, shade } from "@/lib/nhlTeamColors";
import type { Position } from "@/lib/generated/prisma/client";

export function PlayerCard({
  playerId,
  name,
  position,
  photoUrl,
  nhlTeamAbbrev,
  rating,
  statLine,
  teamName,
}: {
  playerId?: string;
  name: string;
  position: Position;
  photoUrl?: string | null;
  /** Real NHL team abbreviation — themes the card to that team's colors,
   * falling back to the site's own navy/gold when there's no match yet.
   * Not the fantasy team (teamName below). */
  nhlTeamAbbrev?: string | null;
  /** 0-100 rating, shown in the corner badge. */
  rating?: number | string;
  /** Short stat summary shown under the position/team line. */
  statLine?: string;
  teamName?: string;
}) {
  const colors = colorsForTeam(nhlTeamAbbrev);

  const content = (
    <div
      className="relative w-[210px] rounded-xl border-2 px-4 pt-4 pb-5 text-center shadow-md transition-transform duration-200 ease-out hover:-translate-y-1 hover:shadow-lg"
      style={{
        borderColor: colors.secondary,
        background: `linear-gradient(160deg, ${shade(colors.primary, 0.12)} 0%, ${colors.primary} 55%, ${shade(colors.primary, -0.3)} 100%)`,
      }}
    >
      {rating !== undefined && <ScoreBubble value={rating} />}
      <div className="relative mx-auto aspect-square w-full overflow-hidden rounded-lg bg-white">
        <Image
          src={avatarForPlayer({ photoUrl, primaryPosition: position })}
          alt={`${position} avatar`}
          fill
          className="object-cover"
          sizes="210px"
        />
      </div>
      <p className="mt-2.5 font-semibold" style={{ color: colors.textOnPrimary }}>
        {name}
      </p>
      <p className="text-xs tracking-wide uppercase opacity-80" style={{ color: colors.textOnPrimary }}>
        {position}
        {teamName ? ` · ${teamName}` : ""}
      </p>
      {statLine && (
        <p className="mt-1 rounded-full bg-black/25 px-2 py-0.5 text-xs font-medium text-gold-bright">
          {statLine}
        </p>
      )}
    </div>
  );

  if (!playerId) return content;
  return (
    <Link href={`/players/${playerId}`} className="block">
      {content}
    </Link>
  );
}
