/**
 * Every RecapSection.type value in use. The first group is algorithmically
 * decided (a detector in detectors.ts picked the winner; Claude/the template
 * only narrates it). The second group is judgment calls with no detector —
 * Claude proposes them from the raw payload; the template generator skips
 * them entirely, since there's no honest procedural way to guess a "vibe."
 */
export const ALGORITHMIC_SECTION_TYPES = [
  "TOTW",
  "TIGHTEST_MATCHUP",
  "HARDEST_BEATING",
  "MANAGER_OF_WEEK",
  "CHOKER",
  "COMEBACK",
  "PICKUP",
] as const;

export const CREATIVE_SECTION_TYPES = ["CLUTCH", "CLOWN", "QUOTE"] as const;

export const ALL_SECTION_TYPES = [
  ...ALGORITHMIC_SECTION_TYPES,
  ...CREATIVE_SECTION_TYPES,
] as const;

export type SectionType = (typeof ALL_SECTION_TYPES)[number];

export const SECTION_TITLES: Record<SectionType, string> = {
  TOTW: "Team of the Week",
  TIGHTEST_MATCHUP: "Tightest Matchup",
  HARDEST_BEATING: "Hardest Beating",
  MANAGER_OF_WEEK: "Manager of the Week",
  CHOKER: "Choker of the Week",
  COMEBACK: "Comeback of the Week",
  PICKUP: "Pickup of the Week",
  CLUTCH: "Clutch Performance",
  CLOWN: "Clown of the Week",
  QUOTE: "Quote of the Week",
};
