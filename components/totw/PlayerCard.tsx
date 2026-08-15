import Image from "next/image";
import Link from "next/link";
import { ScoreBubble } from "./ScoreBubble";
import { avatarForPlayer } from "@/lib/positionAvatar";
import type { Position } from "@/lib/generated/prisma/client";

export function PlayerCard({
  playerId,
  name,
  position,
  photoUrl,
  rating,
  statLine,
  teamName,
}: {
  playerId?: string;
  name: string;
  position: Position;
  photoUrl?: string | null;
  /** 0-100 rating, shown in the corner badge. */
  rating?: number | string;
  /** Short stat summary shown under the position/team line. */
  statLine?: string;
  teamName?: string;
}) {
  const content = (
    <div className="relative w-[210px] rounded-xl bg-navy-deep/40 px-4 pt-4 pb-5 text-center shadow-md transition-transform duration-200 ease-out hover:-translate-y-1 hover:shadow-lg">
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
      <p className="mt-2.5 font-semibold text-white">{name}</p>
      <p className="text-xs tracking-wide text-cream/70 uppercase">
        {position}
        {teamName ? ` · ${teamName}` : ""}
      </p>
      {statLine && <p className="mt-1 text-xs text-gold">{statLine}</p>}
    </div>
  );

  if (!playerId) return content;
  return (
    <Link href={`/players/${playerId}`} className="block">
      {content}
    </Link>
  );
}
