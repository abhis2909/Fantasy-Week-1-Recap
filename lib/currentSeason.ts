import { prisma } from "@/lib/prisma";

/**
 * The MVP runs one league / one active season at a time — this is the one
 * place that assumption lives, so multi-season support later is a change
 * here, not a hunt through every page.
 */
export async function getCurrentSeason() {
  const season = await prisma.season.findFirst({
    orderBy: { year: "desc" },
    include: { league: true },
  });
  if (!season) {
    throw new Error(
      "No season found. Run `npx prisma db seed` to create the fixture league."
    );
  }
  return season;
}

export async function getCurrentWeek(seasonId: string) {
  const week = await prisma.week.findFirst({
    where: { seasonId },
    orderBy: { number: "desc" },
  });
  if (!week) {
    throw new Error("Season has no weeks yet.");
  }
  return week;
}
