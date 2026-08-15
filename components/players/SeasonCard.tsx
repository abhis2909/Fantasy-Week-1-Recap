import Image from "next/image";
import Link from "next/link";
import type { Position } from "@/lib/generated/prisma/client";
import { avatarForPlayer } from "@/lib/positionAvatar";
import { colorsForTeam, shade } from "@/lib/nhlTeamColors";
import { categoryCodesForPosition } from "@/lib/playerRating";

const CATEGORY_NAMES: Record<string, string> = {
  G: "Goals",
  A: "Assists",
  PPP: "Power-play points",
  SHP: "Shorthanded points",
  SOG: "Shots on goal",
  HIT: "Hits",
  BLK: "Blocked shots",
  PIM: "Penalty minutes",
  W: "Wins",
  SV: "Saves",
  GA: "Goals against",
  SO: "Shutouts",
};

/** HUT/FUT-style flavor label from the overall score — purely cosmetic,
 * doesn't feed back into any rating math. */
function tierLabel(overall: number | null): string | null {
  if (overall === null) return null;
  if (overall >= 85) return "Elite";
  if (overall >= 70) return "Top Line";
  if (overall >= 55) return "Rotation";
  return "Depth";
}

/**
 * A player's season-long "Ultimate Team"-style trading card: one big overall
 * rating plus a per-category score grid (see lib/playerRating.ts's
 * blendedSeasonScores), themed to the player's real NHL team colors. This is
 * the persistent season card — distinct from components/totw/PlayerCard,
 * which shows a specific week's rating on Team of the Week / recaps and is
 * deliberately left alone (a week's standout performance is the whole point
 * of that card, so it keeps its own weekly number rather than this season
 * blend).
 */
export function SeasonCard({
  playerId,
  name,
  position,
  photoUrl,
  nhlTeamAbbrev,
  overall = null,
  categoryScores,
  teamName,
}: {
  playerId?: string;
  name: string;
  position: Position;
  photoUrl?: string | null;
  nhlTeamAbbrev?: string | null;
  /** 0-100 season card overall — null when "Update season card scores"
   * hasn't been run for this player yet. */
  overall?: number | null;
  categoryScores?: Record<string, number> | null;
  /** Fantasy team name (or "Free Agent") — distinct from nhlTeamAbbrev,
   * which is the player's real NHL team and drives the card's colors. */
  teamName?: string;
}) {
  const colors = colorsForTeam(nhlTeamAbbrev);
  const codes = categoryCodesForPosition(position);
  const tier = tierLabel(overall);

  const content = (
    <div
      className="relative flex w-full max-w-[240px] flex-col overflow-hidden rounded-2xl border-2 shadow-lg shadow-black/30 transition-transform duration-200 ease-out hover:-translate-y-1.5 hover:shadow-xl"
      style={{
        borderColor: colors.secondary,
        background: `linear-gradient(160deg, ${shade(colors.primary, 0.12)} 0%, ${colors.primary} 45%, ${shade(colors.primary, -0.35)} 100%)`,
      }}
    >
      {/* Overall + position badge, top-left */}
      <div className="absolute top-3 left-3 z-10 flex flex-col items-center">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full border-2 font-heading text-xl font-bold shadow-md"
          style={{ borderColor: colors.secondary, background: colors.primary, color: colors.textOnPrimary }}
        >
          {overall ?? "–"}
        </div>
        <div
          className="-mt-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase shadow"
          style={{ borderColor: colors.secondary, background: colors.primary, color: colors.textOnPrimary }}
        >
          {position}
        </div>
      </div>

      {/* Real NHL team, top-right */}
      {nhlTeamAbbrev && (
        <div
          className="absolute top-3 right-3 z-10 rounded px-2 py-0.5 text-[10px] font-bold tracking-widest text-white uppercase"
          style={{ background: "rgba(0,0,0,0.35)" }}
        >
          {nhlTeamAbbrev}
        </div>
      )}

      {/* Photo */}
      <div className="relative mx-auto mt-11 aspect-square w-[78%] overflow-hidden rounded-xl bg-white shadow-inner">
        <Image
          src={avatarForPlayer({ photoUrl, primaryPosition: position })}
          alt=""
          fill
          className="object-cover"
          sizes="240px"
        />
      </div>

      {/* Name + tier/fantasy team */}
      <div className="mt-3 px-3 text-center">
        <p
          className="truncate font-heading text-base font-semibold tracking-wide uppercase"
          style={{ color: colors.textOnPrimary }}
        >
          {name}
        </p>
        {tier && (
          <p
            className="truncate text-[10px] font-semibold tracking-widest uppercase opacity-80"
            style={{ color: colors.textOnPrimary }}
          >
            {tier}
            {teamName ? ` · ${teamName}` : ""}
          </p>
        )}
      </div>

      {/* Per-category score grid */}
      <div className="mx-3 my-3 grid grid-cols-4 gap-1.5 rounded-lg bg-black/25 p-2 backdrop-blur-sm">
        {codes.map((code) => (
          <div
            key={code}
            title={CATEGORY_NAMES[code] ?? code}
            className="flex flex-col items-center rounded-md bg-black/20 py-1.5"
          >
            <span className="font-heading text-sm font-bold text-white">{categoryScores?.[code] ?? "–"}</span>
            <span className="text-[9px] font-medium tracking-wide text-white/60 uppercase">{code}</span>
          </div>
        ))}
      </div>
    </div>
  );

  if (!playerId) return content;
  return (
    <Link href={`/players/${playerId}`} className="block">
      {content}
    </Link>
  );
}
