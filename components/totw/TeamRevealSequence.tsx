"use client";

import { useState } from "react";
import { PlayerCard } from "./PlayerCard";
import { Crest } from "@/components/ui/Crest";
import { shortStatSummary } from "@/lib/statSummary";
import type { TeamOfWeekPick } from "@/lib/team-of-week";
import type { Position } from "@/lib/generated/prisma/client";

/** Milliseconds between each card's walkout — long enough to actually read
 * as a sequence (not a simultaneous pop), short enough that a full 5-player
 * lineup finishes revealing in a few seconds rather than dragging. */
const STAGGER_MS = 380;

const FORMATION_ROWS: Position[][] = [["LW", "C", "RW"], ["D"], ["G"]];

/** A face-down "mystery card" — same footprint as the real PlayerCard, so
 * the grid doesn't jump when it's replaced post-reveal. */
function HiddenSlot() {
  return (
    <div className="flex w-[210px] flex-col items-center gap-2 rounded-xl border-2 border-gold/25 bg-navy-deep/60 px-4 pt-4 pb-5">
      <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-white/5">
        <Crest className="h-14 w-14 opacity-40" />
      </div>
      <p className="mt-1 text-xs tracking-widest text-cream/30 uppercase">???</p>
    </div>
  );
}

/**
 * Team of the Week's reveal, FIFA-pack-style: starts as a lineup of
 * face-down mystery cards behind a "Reveal" button; clicking it walks the
 * real cards in one at a time (worst rating first, building suspense
 * toward the week's best performer) via a staggered CSS animation
 * (globals.css's card-walkout), each card landing in its actual formation
 * slot rather than a separate spotlight sequence — simpler to build well
 * and still delivers the "cards materializing in sequence" feel without a
 * full one-at-a-time camera carousel.
 */
export function TeamRevealSequence({ picks }: { picks: TeamOfWeekPick[] }) {
  const [revealed, setRevealed] = useState(false);

  const byPosition = new Map<Position, TeamOfWeekPick[]>();
  for (const p of picks) {
    const list = byPosition.get(p.position) ?? [];
    list.push(p);
    byPosition.set(p.position, list.sort((a, b) => a.slotIndex - b.slotIndex));
  }

  // Reveal order: weakest rating first, strongest last — the whole point of
  // a walkout is saving the best for last, independent of where each card
  // actually sits in the formation grid below.
  const revealOrder = [...picks].sort((a, b) => a.rating - b.rating);
  const delayFor = new Map(revealOrder.map((p, i) => [p.playerId, i * STAGGER_MS]));

  return (
    <div className="flex flex-col items-center gap-8 py-4">
      {!revealed && (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="rounded-full bg-gold px-8 py-3 font-heading text-lg tracking-wide text-navy-deep uppercase shadow-lg shadow-gold/30 transition hover:scale-105 hover:bg-gold-bright"
        >
          Reveal Team of the Week
        </button>
      )}
      <div className="flex flex-col items-center gap-10">
        {FORMATION_ROWS.map((row, rowIndex) => (
          <div key={rowIndex} className="flex flex-wrap justify-center gap-8">
            {row.flatMap((position) =>
              (byPosition.get(position) ?? []).map((pick) =>
                revealed ? (
                  <div
                    key={pick.playerId}
                    className="animate-card-walkout flex flex-col items-center gap-1.5"
                    style={{ animationDelay: `${delayFor.get(pick.playerId) ?? 0}ms` }}
                  >
                    <PlayerCard
                      playerId={pick.playerId}
                      name={pick.playerName}
                      position={pick.position}
                      photoUrl={pick.photoUrl}
                      nhlTeamAbbrev={pick.nhlTeamAbbrev}
                      rating={pick.rating}
                      statLine={shortStatSummary(pick.position, pick.values)}
                      teamName={pick.teamName}
                    />
                    <p className="text-xs text-cream/60">
                      raw score {pick.rawScore} over {pick.gamesPlayed} game
                      {pick.gamesPlayed === 1 ? "" : "s"}
                    </p>
                  </div>
                ) : (
                  <HiddenSlot key={pick.playerId} />
                )
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
