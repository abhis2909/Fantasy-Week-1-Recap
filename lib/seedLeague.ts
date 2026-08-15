/**
 * The actual Week 1 fixture-building logic, shared by two callers:
 *  - `prisma/seed.ts` (CLI: `npx prisma db seed`), which creates its own
 *    PrismaClient from DATABASE_URL and runs this against it.
 *  - `app/api/setup/bootstrap/route.ts`, a token-gated one-time HTTP
 *    endpoint that runs this against the app's own database when a local
 *    terminal isn't available (e.g. bootstrapping a Vercel deployment).
 *
 * See `prisma/seed.ts`'s header comment for what this actually creates.
 */
import type { PrismaClient, Position } from "@/lib/generated/prisma/client";
import { computeAndSaveMatchup } from "@/lib/matchups";
import { hashPassword } from "@/lib/password";
import { TransactionDirection } from "@/lib/generated/prisma/client";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Small seeded PRNG (mulberry32) so re-running the seed produces the same
// fixture every time — makes "did my change break anything" comparisons sane.
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260814);

function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}
function randFloat(min: number, max: number): number {
  return rng() * (max - min) + min;
}
function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}
function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Name pools
// ---------------------------------------------------------------------------
const STAR_NAMES: Record<Exclude<Position, "D">, string[]> & { D: string[] } = {
  C: [
    "Connor McDavid", "Nathan MacKinnon", "Auston Matthews", "Sidney Crosby",
    "Leon Draisaitl", "Jack Hughes", "Elias Pettersson", "Sebastian Aho",
    "Mark Scheifele", "Tage Thompson",
  ],
  LW: [
    "Artemi Panarin", "Kirill Kaprizov", "Matthew Tkachuk", "Brad Marchand",
    "Jason Robertson", "Filip Forsberg", "Alex Ovechkin", "Gabriel Landeskog",
    "Jake DeBrusk", "Chandler Stephenson",
  ],
  RW: [
    "Mitch Marner", "David Pastrnak", "William Nylander", "Nikita Kucherov",
    "Mikko Rantanen", "Jake Guentzel", "Kyle Connor", "Brady Tkachuk",
    "Cole Caufield", "Tim Stutzle",
  ],
  D: [
    "Cale Makar", "Adam Fox", "Roman Josi", "Victor Hedman", "Quinn Hughes",
    "Erik Karlsson", "Rasmus Dahlin", "Zach Werenski", "Miro Heiskanen",
    "Charlie McAvoy", "Devon Toews", "Jaccob Slavin", "Moritz Seider",
    "Evan Bouchard", "Thomas Chabot", "Josh Morrissey",
  ],
  G: [
    "Igor Shesterkin", "Connor Hellebuyck", "Linus Ullmark", "Jeremy Swayman",
    "Ilya Sorokin", "Juuse Saros", "Andrei Vasilevskiy", "Stuart Skinner",
  ],
};

const FILLER_FIRST = [
  "Tyler", "Brayden", "Cole", "Logan", "Mason", "Carter", "Hunter", "Owen",
  "Blake", "Riley", "Cameron", "Dawson",
];
const FILLER_LAST = [
  "Sorensen", "Whitmore", "Bexley", "Carrow", "Danforth", "Kessler",
  "Lindqvist", "Marsh", "Novak", "Osgood", "Pruitt", "Quaid",
];

const TEAM_NAMES = [
  "Puck Norris Approves",
  "Zamboni Drivers Union",
  "Bench Warmers Local 12",
  "Slapshot Savages",
  "Fourth Line Felons",
  "Power Play Problems",
  "Glove Save Or No Save",
  "Icing on the Cake",
];

const MANAGERS: { name: string; email: string; role: "COMMISSIONER" | "MEMBER" }[] = [
  { name: "Abhimanyu", email: "abhimanyusaini2909@gmail.com", role: "COMMISSIONER" },
  { name: "Jordan", email: "jordan@example.com", role: "MEMBER" },
  { name: "Sam", email: "sam@example.com", role: "MEMBER" },
  { name: "Casey", email: "casey@example.com", role: "MEMBER" },
  { name: "Riley", email: "riley@example.com", role: "MEMBER" },
  { name: "Morgan", email: "morgan@example.com", role: "MEMBER" },
  { name: "Taylor", email: "taylor@example.com", role: "MEMBER" },
  { name: "Drew", email: "drew@example.com", role: "MEMBER" },
];

// ---------------------------------------------------------------------------
// Category definitions
// ---------------------------------------------------------------------------
const SKATER_POSITIONS: Position[] = ["C", "LW", "RW", "D"];
const CATEGORY_DEFS = [
  { code: "G", label: "Goals", appliesTo: SKATER_POSITIONS, higherIsBetter: true, sortOrder: 1 },
  { code: "A", label: "Assists", appliesTo: SKATER_POSITIONS, higherIsBetter: true, sortOrder: 2 },
  { code: "+/-", label: "Plus/Minus", appliesTo: SKATER_POSITIONS, higherIsBetter: true, sortOrder: 3 },
  { code: "PIM", label: "Penalty Minutes", appliesTo: SKATER_POSITIONS, higherIsBetter: true, sortOrder: 4 },
  { code: "PPP", label: "Power Play Points", appliesTo: SKATER_POSITIONS, higherIsBetter: true, sortOrder: 5 },
  { code: "SOG", label: "Shots on Goal", appliesTo: SKATER_POSITIONS, higherIsBetter: true, sortOrder: 6 },
  { code: "HIT", label: "Hits", appliesTo: SKATER_POSITIONS, higherIsBetter: true, sortOrder: 7 },
  { code: "BLK", label: "Blocked Shots", appliesTo: SKATER_POSITIONS, higherIsBetter: true, sortOrder: 8 },
  { code: "W", label: "Wins", appliesTo: ["G"] as Position[], higherIsBetter: true, sortOrder: 9 },
  { code: "GAA", label: "Goals Against Average", appliesTo: ["G"] as Position[], higherIsBetter: false, sortOrder: 10 },
  { code: "SV%", label: "Save Percentage", appliesTo: ["G"] as Position[], higherIsBetter: true, sortOrder: 11 },
  { code: "SO", label: "Shutouts", appliesTo: ["G"] as Position[], higherIsBetter: true, sortOrder: 12 },
];

type Tier = "star" | "replacement";

function statsForSkater(tier: Tier): Record<string, number> {
  const mult = tier === "star" ? 1 : 0.45;
  return {
    G: randInt(0, Math.round(4 * mult) + 1),
    A: randInt(0, Math.round(5 * mult) + 1),
    "+/-": randInt(-2, Math.round(3 * mult) + 2),
    PIM: randInt(0, 6),
    PPP: randInt(0, Math.round(2 * mult) + 1),
    SOG: randInt(2, Math.round(10 * mult) + 4),
    HIT: randInt(0, 8),
    BLK: randInt(0, 6),
  };
}

function statsForGoalie(tier: Tier): Record<string, number> {
  const isStar = tier === "star";
  return {
    W: randInt(0, isStar ? 3 : 2),
    GAA: Math.round(randFloat(isStar ? 1.8 : 2.2, isStar ? 3.0 : 4.0) * 100) / 100,
    "SV%": Math.round(randFloat(isStar ? 0.905 : 0.87, isStar ? 0.945 : 0.92) * 1000) / 1000,
    SO: rng() < (isStar ? 0.18 : 0.06) ? 1 : 0,
  };
}

function statsFor(position: Position, tier: Tier): Record<string, number> {
  return position === "G" ? statsForGoalie(tier) : statsForSkater(tier);
}

export interface SeedResult {
  commissionerEmail: string;
  commissionerPassword: string;
  commissionerPasswordWasGenerated: boolean;
  demoManagerPassword: string;
  teamCount: number;
}

export async function seedLeague(prisma: PrismaClient): Promise<SeedResult> {
  const usedFillerNames = new Set<string>();
  function nextFillerName(): string {
    let name: string;
    do {
      name = `${pick(FILLER_FIRST)} ${pick(FILLER_LAST)}`;
    } while (usedFillerNames.has(name));
    usedFillerNames.add(name);
    return name;
  }

  console.log("Wiping existing data...");
  // Order matters: children before parents. onDelete: Cascade handles most of
  // this already, but deleting League cascades everything below it, so this
  // is really just "delete every league" plus Users and Players, neither of
  // which are League-scoped in the schema (Player especially: it's a global
  // pool so a future Yahoo/NHL sync can share player identities across
  // seasons) and so aren't cascade-deleted by removing the League.
  await prisma.transactionRating.deleteMany();
  await prisma.league.deleteMany();
  await prisma.player.deleteMany();
  await prisma.user.deleteMany();

  console.log("Creating league, season, categories...");
  const league = await prisma.league.create({
    data: {
      name: "Slapshot City Fantasy Hockey League",
      scoringType: "H2H_CATEGORIES",
      positionSlots: { C: 1, LW: 1, RW: 1, D: 2, G: 1 },
      categories: {
        create: CATEGORY_DEFS,
      },
    },
    include: { categories: true },
  });
  const categoryByCode = new Map(league.categories.map((c) => [c.code, c]));

  const season = await prisma.season.create({
    data: { leagueId: league.id, year: 2025 },
  });

  const week1 = await prisma.week.create({
    data: {
      seasonId: season.id,
      number: 1,
      startDate: new Date("2025-10-06"),
      endDate: new Date("2025-10-12"),
    },
  });

  console.log("Creating managers and teams...");
  // The commissioner's password comes from an env var so it's yours, not a
  // shared default — set COMMISSIONER_PASSWORD before seeding, or a random
  // one-time password is generated and returned/printed. Every other
  // (placeholder) manager gets a shared demo password: fine for a fixture
  // league, not something to leave in place once real people replace them.
  const DEMO_MANAGER_PASSWORD = "GoTeamGo2025!";
  const commissionerPasswordWasGenerated = !process.env.COMMISSIONER_PASSWORD;
  const commissionerPassword =
    process.env.COMMISSIONER_PASSWORD || crypto.randomBytes(9).toString("base64url");

  const teams: { id: string; name: string }[] = [];
  for (let i = 0; i < MANAGERS.length; i++) {
    const m = MANAGERS[i];
    const plainPassword = m.role === "COMMISSIONER" ? commissionerPassword : DEMO_MANAGER_PASSWORD;
    const user = await prisma.user.create({
      data: {
        name: m.name,
        email: m.email,
        role: m.role,
        passwordHash: await hashPassword(plainPassword),
      },
    });
    const team = await prisma.team.create({
      data: { seasonId: season.id, managerId: user.id, name: TEAM_NAMES[i] },
    });
    teams.push(team);
  }

  console.log("Building rosters and Week 1 stat lines...");
  const starPools: Record<Position, string[]> = {
    C: shuffle(STAR_NAMES.C),
    LW: shuffle(STAR_NAMES.LW),
    RW: shuffle(STAR_NAMES.RW),
    D: shuffle(STAR_NAMES.D),
    G: shuffle(STAR_NAMES.G),
  };
  function nextStarName(position: Position): string {
    const pool = starPools[position];
    const name = pool.pop();
    if (!name) throw new Error(`Ran out of star names for ${position}`);
    return name;
  }

  const STARTER_SLOTS: Position[] = ["C", "LW", "RW", "D", "D", "G"];

  // Track a couple of players we deliberately want to reuse later for the
  // Choker of the Week story beat and the transaction log.
  let chokerBenchPlayerId: string | null = null;
  let chokerStartedPlayerId: string | null = null;
  let chokerTeamId: string | null = null;

  for (const team of teams) {
    const rosterPlayers: { id: string; position: Position; started: boolean; tier: Tier }[] = [];

    for (const slotPosition of STARTER_SLOTS) {
      const player = await prisma.player.create({
        data: { fullName: nextStarName(slotPosition), primaryPosition: slotPosition },
      });
      await prisma.rosterEntry.create({ data: { teamId: team.id, playerId: player.id } });
      rosterPlayers.push({ id: player.id, position: slotPosition, started: true, tier: "star" });
    }

    const benchPositions: Position[] = [pick(["C", "LW", "RW", "D"]), pick(["C", "LW", "RW", "D"])];
    for (const benchPosition of benchPositions) {
      const player = await prisma.player.create({
        data: { fullName: nextFillerName(), primaryPosition: benchPosition },
      });
      await prisma.rosterEntry.create({ data: { teamId: team.id, playerId: player.id } });
      rosterPlayers.push({ id: player.id, position: benchPosition, started: false, tier: "replacement" });
    }
    const backupGoalie = await prisma.player.create({
      data: { fullName: nextFillerName(), primaryPosition: "G" },
    });
    await prisma.rosterEntry.create({ data: { teamId: team.id, playerId: backupGoalie.id } });
    rosterPlayers.push({ id: backupGoalie.id, position: "G", started: false, tier: "replacement" });

    // Weekly roster slot snapshot + stat lines for everyone on this team.
    for (const rp of rosterPlayers) {
      await prisma.weeklyRosterSlot.create({
        data: {
          weekId: week1.id,
          teamId: team.id,
          playerId: rp.id,
          slot: rp.position,
          started: rp.started,
        },
      });
      const stats = statsFor(rp.position, rp.tier);
      for (const [code, value] of Object.entries(stats)) {
        const category = categoryByCode.get(code)!;
        await prisma.statLine.create({
          data: { weekId: week1.id, playerId: rp.id, categoryId: category.id, value },
        });
      }
    }

    // Pick one team to be this week's Choker of the Week: a benched skater
    // who badly outplayed the starter at the same position.
    if (chokerTeamId === null && team.name === "Bench Warmers Local 12") {
      const benchSkater = rosterPlayers.find((rp) => !rp.started && rp.position !== "G");
      const startedSamePosition = rosterPlayers.find(
        (rp) => rp.started && rp.position === benchSkater?.position
      );
      if (benchSkater && startedSamePosition) {
        chokerTeamId = team.id;
        chokerBenchPlayerId = benchSkater.id;
        chokerStartedPlayerId = startedSamePosition.id;
      }
    }
  }

  if (chokerBenchPlayerId && chokerStartedPlayerId) {
    console.log("Engineering a Choker of the Week scenario...");
    const heroStats: Record<string, number> = {
      G: 4, A: 3, "+/-": 3, PIM: 0, PPP: 2, SOG: 9, HIT: 3, BLK: 2,
    };
    const dudStats: Record<string, number> = {
      G: 0, A: 0, "+/-": -2, PIM: 2, PPP: 0, SOG: 1, HIT: 0, BLK: 0,
    };
    for (const [code, value] of Object.entries(heroStats)) {
      const category = categoryByCode.get(code)!;
      await prisma.statLine.update({
        where: { weekId_playerId_categoryId: { weekId: week1.id, playerId: chokerBenchPlayerId, categoryId: category.id } },
        data: { value },
      });
    }
    for (const [code, value] of Object.entries(dudStats)) {
      const category = categoryByCode.get(code)!;
      await prisma.statLine.update({
        where: { weekId_playerId_categoryId: { weekId: week1.id, playerId: chokerStartedPlayerId, categoryId: category.id } },
        data: { value },
      });
    }
  }

  console.log("Computing and creating Week 1 matchups from started-player totals...");
  // Simple round-robin pairing for an 8-team week: (0v1) (2v3) (4v5) (6v7)
  for (let i = 0; i < teams.length; i += 2) {
    const home = teams[i];
    const away = teams[i + 1];
    const matchup = await computeAndSaveMatchup(week1.id, home.id, away.id);
    console.log(
      `  ${home.name} ${matchup.homeCategoryWins}–${matchup.awayCategoryWins} ${away.name}`
    );
  }

  console.log("Logging a few Week 1 transactions...");
  // 1. A waiver add that everyone will have an opinion about.
  const addTeam = teams[0];
  const addedPlayer = await prisma.player.create({
    data: { fullName: nextFillerName(), primaryPosition: "RW", externalSource: "MANUAL" },
  });
  await prisma.rosterEntry.create({ data: { teamId: addTeam.id, playerId: addedPlayer.id } });
  // Give the pickup an actual stat line, otherwise Pickup of the Week has
  // nothing to brag about.
  for (const [code, value] of Object.entries(statsForSkater("star"))) {
    const category = categoryByCode.get(code)!;
    await prisma.statLine.create({
      data: { weekId: week1.id, playerId: addedPlayer.id, categoryId: category.id, value },
    });
  }
  const addTx = await prisma.transaction.create({
    data: {
      weekId: week1.id,
      type: "ADD",
      initiatingTeamId: addTeam.id,
      playersInvolved: { create: [{ playerId: addedPlayer.id, direction: TransactionDirection.ADDED }] },
    },
  });
  await prisma.transactionRating.createMany({
    data: [
      { transactionId: addTx.id, raterId: (await prisma.user.findUniqueOrThrow({ where: { email: MANAGERS[1].email } })).id, score: 7, comment: "Fine pickup, wouldn't have made it myself." },
      { transactionId: addTx.id, raterId: (await prisma.user.findUniqueOrThrow({ where: { email: MANAGERS[2].email } })).id, score: 5, comment: "Mid. But go off I guess." },
    ],
  });

  // 2. A drop the league will roast.
  const dropTeam = teams[3];
  const dropTeamRosterEntry = await prisma.rosterEntry.findFirst({
    where: { teamId: dropTeam.id, droppedAt: null },
    orderBy: { addedAt: "asc" },
  });
  if (dropTeamRosterEntry) {
    await prisma.rosterEntry.update({
      where: { id: dropTeamRosterEntry.id },
      data: { droppedAt: new Date() },
    });
    const dropTx = await prisma.transaction.create({
      data: {
        weekId: week1.id,
        type: "DROP",
        initiatingTeamId: dropTeam.id,
        playersInvolved: {
          create: [{ playerId: dropTeamRosterEntry.playerId, direction: TransactionDirection.DROPPED }],
        },
      },
    });
    await prisma.transactionRating.createMany({
      data: [
        { transactionId: dropTx.id, raterId: (await prisma.user.findUniqueOrThrow({ where: { email: MANAGERS[0].email } })).id, score: 2, comment: "A bold, stupid choice." },
        { transactionId: dropTx.id, raterId: (await prisma.user.findUniqueOrThrow({ where: { email: MANAGERS[4].email } })).id, score: 3, comment: "I've seen worse. Barely." },
      ],
    });
  }

  // 3. A trade between two teams.
  const tradeTeamA = teams[5];
  const tradeTeamB = teams[6];
  const tradeAEntry = await prisma.rosterEntry.findFirst({
    where: { teamId: tradeTeamA.id, droppedAt: null },
    orderBy: { addedAt: "desc" },
  });
  const tradeBEntry = await prisma.rosterEntry.findFirst({
    where: { teamId: tradeTeamB.id, droppedAt: null },
    orderBy: { addedAt: "desc" },
  });
  if (tradeAEntry && tradeBEntry && tradeAEntry.playerId !== tradeBEntry.playerId) {
    const now = new Date();
    await prisma.rosterEntry.update({ where: { id: tradeAEntry.id }, data: { droppedAt: now } });
    await prisma.rosterEntry.update({ where: { id: tradeBEntry.id }, data: { droppedAt: now } });
    await prisma.rosterEntry.create({ data: { teamId: tradeTeamB.id, playerId: tradeAEntry.playerId } });
    await prisma.rosterEntry.create({ data: { teamId: tradeTeamA.id, playerId: tradeBEntry.playerId } });

    const tradeTx = await prisma.transaction.create({
      data: {
        weekId: week1.id,
        type: "TRADE",
        initiatingTeamId: tradeTeamA.id,
        counterpartyTeamId: tradeTeamB.id,
        playersInvolved: {
          create: [
            { playerId: tradeAEntry.playerId, direction: TransactionDirection.TRADED_AWAY },
            { playerId: tradeBEntry.playerId, direction: TransactionDirection.TRADED_FOR },
          ],
        },
      },
    });
    await prisma.transactionRating.createMany({
      data: [
        { transactionId: tradeTx.id, raterId: (await prisma.user.findUniqueOrThrow({ where: { email: MANAGERS[2].email } })).id, score: 6, comment: "Lateral move. Nobody wins, nobody loses." },
        { transactionId: tradeTx.id, raterId: (await prisma.user.findUniqueOrThrow({ where: { email: MANAGERS[3].email } })).id, score: 8, comment: "Actually a sneaky good deal for the away side." },
        { transactionId: tradeTx.id, raterId: (await prisma.user.findUniqueOrThrow({ where: { email: MANAGERS[7].email } })).id, score: 4, comment: "Collusion. I said what I said." },
      ],
    });
  }

  console.log("Seed complete.");
  return {
    commissionerEmail: MANAGERS[0].email,
    commissionerPassword,
    commissionerPasswordWasGenerated,
    demoManagerPassword: DEMO_MANAGER_PASSWORD,
    teamCount: teams.length,
  };
}
