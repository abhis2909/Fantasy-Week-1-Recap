import { z } from "zod";

/**
 * NHL.com's own (unofficial, undocumented) player search + profile API —
 * the same one that powers the search bar on nhl.com. There's no official
 * public NHL developer program with a key/ToS; this is what most hobby
 * hockey tools rely on instead. Parsed defensively (zod + try/catch per
 * player in the caller) since there's no contract guaranteeing this shape
 * stays stable.
 */
const SEARCH_URL = "https://search.d3.nhle.com/api/v1/search/player";
const landingUrl = (id: number) => `https://api-web.nhle.com/v1/player/${id}/landing`;

const SearchMatchSchema = z
  .object({
    // Confirmed live: this endpoint returns playerId as a numeric *string*
    // (e.g. "8478402"), not a number — z.coerce handles either just in case
    // that ever changes.
    playerId: z.coerce.number(),
    name: z.string(),
    active: z.boolean().optional(),
    positionCode: z.string().optional(),
    teamAbbrev: z.string().nullable().optional(),
  })
  .passthrough();

export interface NhlSearchMatch {
  nhlPlayerId: number;
  name: string;
  active: boolean;
  teamAbbrev?: string;
}

function searchUrl(query: string): string {
  return `${SEARCH_URL}?culture=en-us&limit=10&q=${encodeURIComponent(query)}`;
}

export async function searchNhlPlayers(query: string): Promise<NhlSearchMatch[]> {
  const res = await fetch(searchUrl(query), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`NHL search request failed (${res.status})`);
  const json = await res.json();
  const parsed = z.array(SearchMatchSchema).safeParse(json);
  if (!parsed.success) throw new Error("Unexpected response shape from NHL search API");
  return parsed.data.map((r) => ({
    nhlPlayerId: r.playerId,
    name: r.name,
    active: r.active ?? true,
    teamAbbrev: r.teamAbbrev ?? undefined,
  }));
}

/** For live debugging: the untouched parsed JSON body from the search
 * endpoint, no schema validation — lets us see the real shape when
 * searchNhlPlayers's zod parse rejects it. */
export async function getRawSearchJson(query: string): Promise<unknown> {
  const res = await fetch(searchUrl(query), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`NHL search request failed (${res.status})`);
  return res.json();
}

const LandingSchema = z.object({ headshot: z.string().optional() }).passthrough();

export async function getNhlHeadshotUrl(nhlPlayerId: number): Promise<string | null> {
  const res = await fetch(landingUrl(nhlPlayerId), { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const json = await res.json();
  const parsed = LandingSchema.safeParse(json);
  if (!parsed.success || !parsed.data.headshot) return null;
  return parsed.data.headshot;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Best-effort exact-name match against NHL search results, restricted to
 * currently-active players — this league only cares about players who
 * could actually be rostered this season, so a retired/minor-league player
 * who happens to share an exact name with a fixture placeholder (e.g. a
 * synthetic bench name) should never get matched over them just because
 * there was no active player with that name. Also handles the case of
 * multiple active players sharing a name (this does happen — e.g. more
 * than one active NHL player named "Sebastian Aho") by taking the first.
 * Returns null — never guesses — when there's no exact (case-insensitive,
 * active-only) name match.
 */
export async function findBestNhlMatch(playerName: string): Promise<NhlSearchMatch | null> {
  const results = await searchNhlPlayers(playerName);
  const exact = results.filter(
    (r) => r.active && normalizeName(r.name) === normalizeName(playerName)
  );
  return exact[0] ?? null;
}

// ---------------------------------------------------------------------------
// Game log / weekly stat aggregation
//
// IMPORTANT CAVEAT: unlike the search/landing endpoints above, this repo's
// author (Claude) could not reach api-web.nhle.com from its sandbox to
// verify the game-log response shape against a live call — the URL pattern
// is confirmed against a community API reference, but the per-game field
// names below (goals/assists/pim/etc.) are best-effort from prior knowledge,
// not verified against a real response. `num()` tries a few plausible
// spellings per stat to hedge, and getRawGameLogJson() below exists so the
// first live run can be sanity-checked directly. Expect to need one round
// of field-name fixes after the first real sync — see README.
// ---------------------------------------------------------------------------

const gameLogUrl = (nhlPlayerId: number, seasonId: string, gameType: number) =>
  `https://api-web.nhle.com/v1/player/${nhlPlayerId}/game-log/${seasonId}/${gameType}`;

export interface RawGameLogEntry {
  gameDate: string | null;
  raw: Record<string, unknown>;
}

/** Regular season = 2, playoffs = 3 (per the NHL API reference). */
export const NHL_GAME_TYPE_REGULAR_SEASON = 2;

/** `seasonId` is YYYYYYYY, e.g. "20252026" for the 2025-26 season. */
export async function getPlayerGameLog(
  nhlPlayerId: number,
  seasonId: string,
  gameType: number = NHL_GAME_TYPE_REGULAR_SEASON
): Promise<RawGameLogEntry[]> {
  const res = await fetch(gameLogUrl(nhlPlayerId, seasonId, gameType), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`NHL game log request failed (${res.status})`);
  const json = await res.json();
  // Response shape isn't officially documented — be liberal about where the
  // per-game array actually lives.
  const arr: unknown[] | null = Array.isArray(json)
    ? json
    : Array.isArray((json as { gameLog?: unknown[] })?.gameLog)
      ? (json as { gameLog: unknown[] }).gameLog
      : null;
  if (!arr) throw new Error("Unexpected response shape from NHL game log API (no game array found)");
  return arr.map((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const gameDate = typeof record.gameDate === "string" ? record.gameDate : null;
    return { gameDate, raw: record };
  });
}

/** For live debugging: the untouched parsed JSON body, first entry included. */
export async function getRawGameLogJson(
  nhlPlayerId: number,
  seasonId: string,
  gameType: number = NHL_GAME_TYPE_REGULAR_SEASON
): Promise<unknown> {
  const res = await fetch(gameLogUrl(nhlPlayerId, seasonId, gameType), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`NHL game log request failed (${res.status})`);
  return res.json();
}

function num(raw: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
  }
  return 0;
}

function gameDateInRange(gameDate: string | null, start: Date, end: Date): boolean {
  if (!gameDate) return false;
  const d = new Date(`${gameDate}T00:00:00Z`);
  return d >= start && d <= end;
}

export interface WeeklyNhlStatResult {
  /** Category code -> aggregated value for the date range. */
  values: Record<string, number>;
  gamesFound: number;
}

/** Per-category values for a single skater game-log entry. */
function mapSkaterGameEntry(raw: Record<string, unknown>): Record<string, number> {
  return {
    G: num(raw, "goals"),
    A: num(raw, "assists"),
    "+/-": num(raw, "plusMinus"),
    PIM: num(raw, "pim", "penaltyMinutes"),
    PPP: num(raw, "powerPlayPoints", "ppPoints"),
    SOG: num(raw, "shots", "shotsOnGoal", "sog"),
    HIT: num(raw, "hits"),
    BLK: num(raw, "blockedShots", "blocks"),
  };
}

/** Per-category values for a single goalie game-log entry. */
function mapGoalieGameEntry(raw: Record<string, unknown>): Record<string, number> {
  const decision = String(raw.decision ?? "").toUpperCase();
  const goalsAgainst = num(raw, "goalsAgainst");
  const shotsAgainst = num(raw, "shotsAgainst", "shots");
  return {
    W: decision.startsWith("W") ? 1 : 0,
    GAA: goalsAgainst,
    "SV%": shotsAgainst > 0 ? Math.round(((shotsAgainst - goalsAgainst) / shotsAgainst) * 1000) / 1000 : 0,
    SO: num(raw, "shutouts") > 0 ? 1 : 0,
  };
}

/** Maps each game-log entry to its own per-category values — one row per
 * game, for storing into PlayerGameLog. Games with no parseable date are
 * dropped (can't be stored without one). */
export function mapGameLogToPerGameValues(
  entries: RawGameLogEntry[],
  position: "G" | "SKATER"
): { gameDate: string; values: Record<string, number> }[] {
  const mapper = position === "G" ? mapGoalieGameEntry : mapSkaterGameEntry;
  return entries
    .filter((e): e is RawGameLogEntry & { gameDate: string } => e.gameDate !== null)
    .map((e) => ({ gameDate: e.gameDate, values: mapper(e.raw) }));
}

export function aggregateSkaterStats(
  entries: RawGameLogEntry[],
  start: Date,
  end: Date
): WeeklyNhlStatResult {
  const inRange = entries.filter((e) => gameDateInRange(e.gameDate, start, end));
  const values: Record<string, number> = { G: 0, A: 0, "+/-": 0, PIM: 0, PPP: 0, SOG: 0, HIT: 0, BLK: 0 };
  for (const e of inRange) {
    const g = mapSkaterGameEntry(e.raw);
    for (const key of Object.keys(values)) values[key] += g[key];
  }
  return { values, gamesFound: inRange.length };
}

export function aggregateGoalieStats(
  entries: RawGameLogEntry[],
  start: Date,
  end: Date
): WeeklyNhlStatResult {
  const inRange = entries.filter((e) => gameDateInRange(e.gameDate, start, end));
  let wins = 0;
  let shutouts = 0;
  let totalGoalsAgainst = 0;
  let totalShotsAgainst = 0;

  for (const e of inRange) {
    const g = mapGoalieGameEntry(e.raw);
    wins += g.W;
    shutouts += g.SO;
    // Re-derive raw totals rather than re-summing the per-game SV% (percentages
    // don't sum meaningfully) — pull straight from the entry again.
    totalGoalsAgainst += num(e.raw, "goalsAgainst");
    totalShotsAgainst += num(e.raw, "shotsAgainst", "shots");
  }

  // Simplification: GAA as goals-against per start rather than per 60
  // minutes of ice time (game-log entries don't reliably expose TOI for
  // goalies). Close enough for weekly fantasy purposes, not a broadcast
  // stat.
  const gaa = inRange.length > 0 ? Math.round((totalGoalsAgainst / inRange.length) * 100) / 100 : 0;
  const svPct =
    totalShotsAgainst > 0
      ? Math.round(((totalShotsAgainst - totalGoalsAgainst) / totalShotsAgainst) * 1000) / 1000
      : 0;

  return { values: { W: wins, GAA: gaa, "SV%": svPct, SO: shutouts }, gamesFound: inRange.length };
}

/** Runs `fn` over `items` with at most `concurrency` in flight at once. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
