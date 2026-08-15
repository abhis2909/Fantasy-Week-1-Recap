import type { Position } from "@/lib/generated/prisma/client";

/**
 * Real (non-superstar) active NHL players used to round out bench/depth
 * roster spots — kept distinct from lib/seedLeague.ts's STAR_NAMES pools so
 * fresh seeds never draw the same person twice. Every rostered player
 * should be a real, exact-name-matchable NHL player so NHL Sync can find
 * them; earlier versions of the seed used made-up filler names instead
 * (see LEGACY_FILLER_FIRST/LAST below), which this replaces.
 */
export const DEPTH_SKATER_NAMES: Record<Exclude<Position, "G">, string[]> = {
  C: [
    "Bo Horvat", "Vincent Trocheck", "Ryan O'Reilly", "Sean Monahan",
    "Elias Lindholm", "Nico Hischier", "Trevor Zegras", "Dylan Cozens",
    "Casey Mittelstadt", "Barrett Hayton", "J.T. Compher", "Adam Henrique",
    "Pius Suter", "Ryan Strome",
  ],
  LW: [
    "Brandon Saad", "Jamie Benn", "Max Pacioretty", "Taylor Hall",
    "Jonathan Huberdeau", "Andrei Svechnikov", "Anthony Beauvillier",
    "Alex Killorn", "Jakob Silfverberg", "Nick Foligno", "Blake Coleman",
    "Warren Foegele", "Michael Bunting", "Jason Zucker",
  ],
  RW: [
    "Mark Stone", "Rickard Rakell", "Alex DeBrincat", "Vladimir Tarasenko",
    "Conor Garland", "Josh Anderson", "Tyler Toffoli", "Reilly Smith",
    "Anders Lee", "Nino Niederreiter", "Andrew Mangiapane", "Jesper Bratt",
    "Nikolaj Ehlers", "Kailer Yamamoto",
  ],
  D: [
    "Brent Burns", "John Klingberg", "Vince Dunn", "Ivan Provorov",
    "Noah Hanifin", "Rasmus Ristolainen", "Jared Spurgeon",
    "MacKenzie Weegar", "Dmitry Orlov", "Colton Parayko", "Jake Walman",
    "Alex Pietrangelo", "Seth Jones", "Brett Pesce",
  ],
};

export const DEPTH_GOALIE_NAMES: string[] = [
  "Jacob Markstrom", "Thatcher Demko", "Joonas Korpisalo", "Frederik Andersen",
  "Jake Oettinger", "Alexandar Georgiev", "Adin Hill", "Karel Vejmelka",
  "Kevin Lankinen", "Logan Thompson",
];

export function depthNamesFor(position: Position): string[] {
  return position === "G" ? DEPTH_GOALIE_NAMES : DEPTH_SKATER_NAMES[position];
}

// ---------------------------------------------------------------------------
// Legacy detection — the original seed generated bench-depth players as
// "<random first> <random last>" from these two pools, which are made-up
// people, not real NHL players. A production database seeded before this
// file existed still has Player rows with those names; isLegacyFictionalName
// lets a one-time cleanup find and rename exactly those rows in place
// (same Player.id, so every RosterEntry/StatLine/Transaction/etc still
// points at the same player — nothing else about the league's history
// changes) without needing a full reseed.
// ---------------------------------------------------------------------------
const LEGACY_FILLER_FIRST = new Set([
  "Tyler", "Brayden", "Cole", "Logan", "Mason", "Carter", "Hunter", "Owen",
  "Blake", "Riley", "Cameron", "Dawson",
]);
const LEGACY_FILLER_LAST = new Set([
  "Sorensen", "Whitmore", "Bexley", "Carrow", "Danforth", "Kessler",
  "Lindqvist", "Marsh", "Novak", "Osgood", "Pruitt", "Quaid",
]);

export function isLegacyFictionalName(fullName: string): boolean {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length !== 2) return false;
  const [first, last] = parts;
  return LEGACY_FILLER_FIRST.has(first) && LEGACY_FILLER_LAST.has(last);
}
