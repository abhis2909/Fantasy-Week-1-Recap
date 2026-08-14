import Image from "next/image";
import { ScoreBubble } from "./ScoreBubble";
import { avatarForPlayer } from "@/lib/positionAvatar";
import type { Position } from "@/lib/generated/prisma/client";

export function PlayerCard({
  name,
  position,
  photoUrl,
  score,
  teamName,
}: {
  name: string;
  position: Position;
  photoUrl?: string | null;
  score?: number | string;
  teamName?: string;
}) {
  return (
    <div className="relative w-[210px] rounded-xl bg-navy-deep/40 px-4 pt-4 pb-5 text-center shadow-md transition-transform duration-200 ease-out hover:-translate-y-1 hover:shadow-lg">
      {score !== undefined && <ScoreBubble value={score} />}
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
    </div>
  );
}
