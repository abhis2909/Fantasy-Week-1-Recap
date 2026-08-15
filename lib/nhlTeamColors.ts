/**
 * NHL team brand colors, for theming a player's card to match their current
 * team (lib/nhl.ts's Player.nhlTeamAbbrev). Hand-maintained from general
 * knowledge of each team's identity, not pulled from a live API — there's
 * no NHL endpoint for this. Close enough for a themed card background, not
 * claimed to be pixel-exact official brand hex values. Utah's franchise in
 * particular is newly rebranded (2024) and its identity may still shift —
 * easiest single place to fix if it looks off.
 */
export interface NhlTeamColors {
  primary: string;
  secondary: string;
  /** Text color that reads well against `primary` — most teams are dark
   * enough for white/cream text; a few lighter/gold-heavy primaries read
   * better with dark text instead. */
  textOnPrimary: string;
}

export const NHL_TEAM_COLORS: Record<string, NhlTeamColors> = {
  ANA: { primary: "#F47A38", secondary: "#000000", textOnPrimary: "#000000" },
  BOS: { primary: "#000000", secondary: "#FFB81C", textOnPrimary: "#FFB81C" },
  BUF: { primary: "#002654", secondary: "#FCB514", textOnPrimary: "#FCB514" },
  CGY: { primary: "#C8102E", secondary: "#F1BE48", textOnPrimary: "#FFFFFF" },
  CAR: { primary: "#CC0000", secondary: "#000000", textOnPrimary: "#FFFFFF" },
  CHI: { primary: "#CF0A2C", secondary: "#000000", textOnPrimary: "#FFFFFF" },
  COL: { primary: "#6F263D", secondary: "#236192", textOnPrimary: "#FFFFFF" },
  CBJ: { primary: "#002654", secondary: "#CE1126", textOnPrimary: "#FFFFFF" },
  DAL: { primary: "#006847", secondary: "#000000", textOnPrimary: "#FFFFFF" },
  DET: { primary: "#CE1126", secondary: "#FFFFFF", textOnPrimary: "#FFFFFF" },
  EDM: { primary: "#FF4C00", secondary: "#041E42", textOnPrimary: "#041E42" },
  FLA: { primary: "#C8102E", secondary: "#041E42", textOnPrimary: "#FFFFFF" },
  LAK: { primary: "#111111", secondary: "#A2AAAD", textOnPrimary: "#FFFFFF" },
  MIN: { primary: "#154734", secondary: "#A6192E", textOnPrimary: "#FFFFFF" },
  MTL: { primary: "#AF1E2D", secondary: "#192168", textOnPrimary: "#FFFFFF" },
  NSH: { primary: "#FFB81C", secondary: "#041E42", textOnPrimary: "#041E42" },
  NJD: { primary: "#C8102E", secondary: "#000000", textOnPrimary: "#FFFFFF" },
  NYI: { primary: "#00539B", secondary: "#F47D30", textOnPrimary: "#FFFFFF" },
  NYR: { primary: "#0038A8", secondary: "#CE1126", textOnPrimary: "#FFFFFF" },
  OTT: { primary: "#C8102E", secondary: "#C2912C", textOnPrimary: "#FFFFFF" },
  PHI: { primary: "#F74902", secondary: "#000000", textOnPrimary: "#000000" },
  PIT: { primary: "#000000", secondary: "#FCB514", textOnPrimary: "#FCB514" },
  SJS: { primary: "#006D75", secondary: "#000000", textOnPrimary: "#FFFFFF" },
  SEA: { primary: "#001628", secondary: "#99D9D9", textOnPrimary: "#99D9D9" },
  STL: { primary: "#002F87", secondary: "#FCB514", textOnPrimary: "#FFFFFF" },
  TBL: { primary: "#002868", secondary: "#FFFFFF", textOnPrimary: "#FFFFFF" },
  TOR: { primary: "#00205B", secondary: "#FFFFFF", textOnPrimary: "#FFFFFF" },
  UTA: { primary: "#010101", secondary: "#69B3E7", textOnPrimary: "#69B3E7" },
  VAN: { primary: "#00205B", secondary: "#00843D", textOnPrimary: "#FFFFFF" },
  VGK: { primary: "#B4975A", secondary: "#333F42", textOnPrimary: "#000000" },
  WSH: { primary: "#C8102E", secondary: "#041E42", textOnPrimary: "#FFFFFF" },
  WPG: { primary: "#041E42", secondary: "#004C97", textOnPrimary: "#FFFFFF" },
};

/** Falls back to the site's own navy/gold brand when a player has no known
 * NHL team yet (not synced, or genuinely a free agent between teams) —
 * keeps the card looking intentional instead of blank/broken. */
const DEFAULT_COLORS: NhlTeamColors = {
  primary: "#0a1a2f",
  secondary: "#d4af37",
  textOnPrimary: "#f7f6f2",
};

export function colorsForTeam(abbrev: string | null | undefined): NhlTeamColors {
  if (!abbrev) return DEFAULT_COLORS;
  return NHL_TEAM_COLORS[abbrev.toUpperCase()] ?? DEFAULT_COLORS;
}

/**
 * Lightens (positive amount) or darkens (negative) a "#rrggbb" color by
 * roughly `amount` (-1 to 1), toward white or black respectively. Used to
 * build a two-stop gradient for the season card background out of a single
 * team color — mixing in the real secondary color instead often looks
 * washed out, since several teams' secondaries are near-white (TOR, DET,
 * TBL) or another near-black (BOS, PIT), which don't gradient well against
 * a similarly dark/light primary.
 */
export function shade(hex: string, amount: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const num = parseInt(hex.replace("#", ""), 16);
  const mix = (channel: number) => (amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount));
  const r = clamp(mix((num >> 16) & 0xff));
  const g = clamp(mix((num >> 8) & 0xff));
  const b = clamp(mix(num & 0xff));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
