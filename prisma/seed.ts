/**
 * Deterministic Week 1 fixture for local dev / manual QA.
 *
 * Wipes and re-creates one league, one season, 12 scoring categories, 8
 * teams/managers/rosters, and a fully played-out Week 1 (stat lines, started
 * vs benched snapshots, matchup results derived from those stat lines, and a
 * handful of transactions with ratings) — enough to exercise every feature:
 * standings, category breakdowns, Team of the Week, transaction ratings, and
 * the recap detectors (closest matchup, manager of the week, choker of the
 * week, etc). Comeback of the Week has nothing to compare Week 1 against, so
 * it's expected to come up empty until Week 2 exists — that's correct
 * behavior, not a bug.
 *
 * The actual fixture-building logic lives in lib/seedLeague.ts, shared with
 * app/api/setup/bootstrap/route.ts (a token-gated HTTP alternative to this
 * CLI script, for seeding a deployment when there's no local terminal handy).
 *
 * Run with `npx prisma db seed` (or automatically after `prisma migrate dev`).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { seedLeague } from "@/lib/seedLeague";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env first.");
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

seedLeague(prisma)
  .then((result) => {
    console.log(`Teams: ${result.teamCount}`);
    console.log("");
    console.log("Sign in as commissioner:");
    console.log(`  email:    ${result.commissionerEmail}`);
    console.log(`  password: ${result.commissionerPassword}`);
    if (result.commissionerPasswordWasGenerated) {
      console.log(
        "  (randomly generated — set COMMISSIONER_PASSWORD in .env and reseed to choose your own)"
      );
    }
    console.log("");
    console.log(`All other seeded managers share the password: ${result.demoManagerPassword}`);
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
