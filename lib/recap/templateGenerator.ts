import type { WeeklyStatsPayload } from "@/lib/recap/payload";
import type { RecapOutput } from "@/lib/recap/claude";
import { SECTION_TITLES } from "@/lib/recap/sectionTypes";

/**
 * Deterministic, no-API-key recap generator. Covers only the algorithmic
 * sections (a detector decided the winner, this just fills in a sentence
 * template) — CLUTCH/CLOWN/QUOTE are skipped entirely since there's no
 * honest procedural way to guess those. Less funny than Claude, but the app
 * works end-to-end without any API key configured.
 */
export function generateTemplateRecap(payload: WeeklyStatsPayload): RecapOutput {
  const sections: RecapOutput["sections"] = [];
  const d = payload.detectors;

  if (d.closestMatchup) {
    const c = d.closestMatchup;
    sections.push({
      type: "TIGHTEST_MATCHUP",
      title: SECTION_TITLES.TIGHTEST_MATCHUP,
      body: `${c.homeTeamName} and ${c.awayTeamName} went right down to the wire, splitting categories ${c.homeCategoryWins}-${c.awayCategoryWins}. Margin of victory: ${c.margin} categor${c.margin === 1 ? "y" : "ies"}.`,
    });
  }

  if (d.hardestBeating) {
    const h = d.hardestBeating;
    const winner = h.homeCategoryWins > h.awayCategoryWins ? h.homeTeamName : h.awayTeamName;
    const loser = h.homeCategoryWins > h.awayCategoryWins ? h.awayTeamName : h.homeTeamName;
    sections.push({
      type: "HARDEST_BEATING",
      title: SECTION_TITLES.HARDEST_BEATING,
      body: `${winner} put a beating on ${loser} this week, ${Math.max(h.homeCategoryWins, h.awayCategoryWins)}-${Math.min(h.homeCategoryWins, h.awayCategoryWins)}. Not much else to say.`,
    });
  }

  if (d.managerOfWeek) {
    const m = d.managerOfWeek;
    sections.push({
      type: "MANAGER_OF_WEEK",
      title: SECTION_TITLES.MANAGER_OF_WEEK,
      body: `${m.managerName} (${m.teamName}) ran the best week in the league: ${(m.categoryWinRate * 100).toFixed(0)}% category win rate and a ${(m.optimalLineupPct * 100).toFixed(0)}% optimal lineup. Composite score: ${m.compositeScore}.`,
    });
  }

  if (d.chokerOfWeek) {
    const c = d.chokerOfWeek;
    sections.push({
      type: "CHOKER",
      title: SECTION_TITLES.CHOKER,
      body: `${c.teamName} benched ${c.benchedPlayerName} (${c.benchedScore} pts, rated ${c.benchedRating}/100) at ${c.position} in favor of ${c.startedPlayerName} (${c.startedScore} pts, rated ${c.startedRating}/100). That is a choice.`,
    });
  }

  if (d.comebackOfWeek) {
    const c = d.comebackOfWeek;
    sections.push({
      type: "COMEBACK",
      title: SECTION_TITLES.COMEBACK,
      body: `${c.teamName} beat ${c.opponentTeamName} despite going in as the underdog on recent form (${c.teamPowerRating} vs ${c.opponentPowerRating}). Somebody didn't get the memo.`,
    });
  }

  if (d.pickupOfWeek) {
    const p = d.pickupOfWeek;
    sections.push({
      type: "PICKUP",
      title: SECTION_TITLES.PICKUP,
      body: `${p.teamName} added ${p.playerName} off waivers and got ${p.score} points out of them this week. Nice hit.`,
    });
  }

  if (payload.teamOfTheWeek.length > 0) {
    const names = payload.teamOfTheWeek.map((p) => `${p.playerName} (${p.position}, ${p.teamName})`).join(", ");
    sections.push({
      type: "TOTW",
      title: SECTION_TITLES.TOTW,
      body: `This week's Team of the Week: ${names}.`,
    });
  }

  return {
    title: `${payload.leagueName} — Week ${payload.weekNumber} Recap`,
    sections,
  };
}
