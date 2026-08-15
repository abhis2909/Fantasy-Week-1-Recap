import type { Position } from "@/lib/generated/prisma/client";
import { formatStatValue } from "@/lib/formatStatValue";

/** A compact one-line stat summary for a player card, position-aware. */
export function shortStatSummary(position: Position, values: Record<string, number>): string {
  if (position === "G") {
    return `${values.W ?? 0}W · ${formatStatValue(values.GAA, "GAA")} GAA · ${formatStatValue(values["SV%"], "SV%")} SV%`;
  }
  return `${values.G ?? 0}G · ${values.A ?? 0}A · ${values.SOG ?? 0} SOG`;
}
