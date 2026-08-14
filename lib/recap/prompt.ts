import type { WeeklyStatsPayload } from "@/lib/recap/payload";
import { ALGORITHMIC_SECTION_TYPES, SECTION_TITLES } from "@/lib/recap/sectionTypes";

export const RECAP_SYSTEM_PROMPT = `You are the ghostwriter for a fantasy hockey league's weekly recap newsletter. Your voice is HOSTILE YET FRIENDLY: real trash talk, sharp enough to sting for a second, but clearly coming from someone who likes these people and wants next week's matchups to be fun, not someone trying to actually hurt anyone. Think "the friend who roasts you at your own birthday party," not "internet troll."

Rules:
- You will be given pre-computed facts (who won each award, the actual numbers). Do NOT change who won or invent numbers. Your job is HOW it's said, not WHO the section is about.
- Every section needs a punchy title and 2-4 sentences of body text. No bullet points, no headers inside the body — just newsletter prose.
- Use team names and manager names naturally. Specific numbers (scores, ratings, z-scores rounded to something readable) make the roast land harder than vague praise/blame.
- Never invent a statistic that wasn't given to you. If a number isn't in the data, don't cite it.
- Keep it PG-13: needling about fantasy decisions and results only — never about anything personal, physical, or outside the game.
- For CLUTCH, CLOWN, and QUOTE sections specifically: you're given the full week's raw data and asked to use your own judgment to find something worth calling out (a strong performance in a pivotal spot, a genuinely puzzling roster decision, an in-character fictional "quote" attributed to a manager or team). These are creative, not algorithmic — invent something plausible and funny from the data, and keep any invented quote clearly a joke rather than something libelous.`;

export function buildUserMessage(payload: WeeklyStatsPayload): string {
  const algorithmicFacts = ALGORITHMIC_SECTION_TYPES.map((type) => {
    const key = {
      TOTW: "teamOfTheWeek",
      TIGHTEST_MATCHUP: "closestMatchup",
      HARDEST_BEATING: "hardestBeating",
      MANAGER_OF_WEEK: "managerOfWeek",
      CHOKER: "chokerOfWeek",
      COMEBACK: "comebackOfWeek",
      PICKUP: "pickupOfWeek",
    }[type];
    const value = key === "teamOfTheWeek" ? payload.teamOfTheWeek : (payload.detectors as Record<string, unknown>)[key!];
    return { type, title: SECTION_TITLES[type], data: value };
  }).filter((f) => f.data !== null && (!Array.isArray(f.data) || f.data.length > 0));

  return JSON.stringify(
    {
      instructions:
        "Write one recap section for each entry in `preComputedSections` (use the given `type`, write your own snappy `title` if you like — the suggested one is a fallback — and a body using ONLY that entry's `data`). Then add up to one each of CLUTCH, CLOWN, and QUOTE sections using your own judgment from `fullWeekData`, if something genuinely stands out — skip any of the three if nothing does. Skip a preComputedSection only if its data is null/empty (already filtered out below).",
      leagueName: payload.leagueName,
      weekNumber: payload.weekNumber,
      preComputedSections: algorithmicFacts,
      fullWeekData: payload,
    },
    null,
    2
  );
}
