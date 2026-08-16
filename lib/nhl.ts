import { z } from "zod";
import type { Position } from "@/lib/generated/prisma/client";

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

/**
 * fetch wrapper with retry-on-429/5xx for the NHL API specifically. It has
 * an undocumented rate limit — confirmed live: a full-roster admin action
 * (multiple requests per player, run at concurrency) can get every single
 * request 429'd once the burst is big enough, failing the whole run rather
 * than just slowing it down. 404 and other 4xx responses are NOT retried —
 * those are real answers (e.g. "no game log for this player this season"),
 * not a transient failure, and retrying them would just waste the retry
 * budget. Honors a Retry-After header if the API sends one; otherwise backs
 * off exponentially with a little jitter so a batch of concurrent requests
 * that all got rate-limited together don't all retry in lockstep and
 * immediately re-trigger the same limit.
 */
async function fetchNhl(url: string, init?: RequestInit, maxAttempts = 5): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    if (res.status !== 429 && res.status < 500) return res;
    lastRes = res;
    if (attempt === maxAttempts) break;
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
    const backoffMs = Number.isFinite(retryAfterMs)
      ? retryAfterMs
      : Math.min(8000, 400 * 2 ** (attempt - 1)) + Math.random() * 250;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
  return lastRes!;
}

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
  const res = await fetchNhl(searchUrl(query), { headers: { Accept: "application/json" } });
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
  const res = await fetchNhl(searchUrl(query), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`NHL search request failed (${res.status})`);
  return res.json();
}

const LandingSchema = z.object({ headshot: z.string().optional() }).passthrough();

export async function getNhlHeadshotUrl(nhlPlayerId: number): Promise<string | null> {
  const res = await fetchNhl(landingUrl(nhlPlayerId), { headers: { Accept: "application/json" } });
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
 * Thrown when a response comes back structurally empty in a way that's
 * never legitimate — e.g. a completed game's boxscore reporting zero
 * skaters, or an NHL team's roster reporting zero players — as opposed to
 * an ordinary fetch failure (network blip, one bad ID, a transient 5xx).
 * Both of this file's two unverified-shape endpoints (roster, boxscore)
 * degrade to an empty array rather than throwing when the parser can't
 * find the field it expects (e.g. `playerByGameStats` renamed or
 * restructured), so a genuine shape break would otherwise look exactly
 * like "this game had no hits" or "this team has no players" — silently
 * wrong data with zero visible error, the worst kind of bug. Callers that
 * treat a single failed game/team as skippable (reasonable for a real
 * transient blip — one bad boxscore shouldn't fail an entire roster sync)
 * must NOT swallow this specific error type the same way; it means every
 * subsequent call is about to fail identically, and that needs to surface,
 * not get quietly absorbed into a wall of zeros. See getGameHitsAndBlocks
 * and getTeamRoster below, and their callers in lib/syncJobs.ts and
 * app/(app)/admin/nhl-sync/page.tsx.
 */
export class NhlShapeError extends Error {}

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
// Field names below are now confirmed against a live response: goals,
// assists, powerPlayPoints, shots, pim, and shorthandedPoints all matched
// on the first real skater game log pulled through the debug tool. One
// confirmed gap: hits and blockedShots are simply not present anywhere in
// this endpoint's response, for any player — see the boxscore section
// further down, which exists specifically to fill that gap from a
// different (per-game, not per-player) endpoint.
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
  const res = await fetchNhl(gameLogUrl(nhlPlayerId, seasonId, gameType), {
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
  const res = await fetchNhl(gameLogUrl(nhlPlayerId, seasonId, gameType), {
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

export function gameDateInRange(gameDate: string | null, start: Date, end: Date): boolean {
  if (!gameDate) return false;
  const d = new Date(`${gameDate}T00:00:00Z`);
  return d >= start && d <= end;
}

/** The NHL game ID a raw game-log entry belongs to — needed to look up its
 * boxscore for hits/blocks, which the game-log endpoint doesn't report. */
export function gameIdOf(entry: RawGameLogEntry): number {
  return num(entry.raw, "gameId");
}

export interface WeeklyNhlStatResult {
  /** Category code -> aggregated value for the date range. */
  values: Record<string, number>;
  gamesFound: number;
}

/** Per-category values for a single skater game-log entry. HIT/BLK are
 * always 0 here — this endpoint doesn't report them at all (confirmed
 * live) — callers that care about those two enrich them separately from
 * getGameHitsAndBlocks below. */
function mapSkaterGameEntry(raw: Record<string, unknown>): Record<string, number> {
  return {
    G: num(raw, "goals"),
    A: num(raw, "assists"),
    PPP: num(raw, "powerPlayPoints", "ppPoints"),
    SHP: num(raw, "shorthandedPoints", "shPoints"),
    SOG: num(raw, "shots", "shotsOnGoal", "sog"),
    PIM: num(raw, "pim", "penaltyMinutes"),
    HIT: 0,
    BLK: 0,
  };
}

/** Per-category values for a single goalie game-log entry. Includes raw SV
 * (saves) and GA (goals against) counts alongside the standings-facing rate
 * stats (GAA/SV%) — SV/GA aren't their own ScoringCategory (nothing shows
 * them on Standings), they only exist so the rating model in
 * lib/playerRating.ts has real counts to work with instead of rates. */
function mapGoalieGameEntry(raw: Record<string, unknown>): Record<string, number> {
  const decision = String(raw.decision ?? "").toUpperCase();
  const goalsAgainst = num(raw, "goalsAgainst");
  const shotsAgainst = num(raw, "shotsAgainst", "shots");
  const saves = Math.max(0, shotsAgainst - goalsAgainst);
  return {
    W: decision.startsWith("W") ? 1 : 0,
    GAA: goalsAgainst,
    "SV%": shotsAgainst > 0 ? Math.round(((shotsAgainst - goalsAgainst) / shotsAgainst) * 1000) / 1000 : 0,
    SO: num(raw, "shutouts") > 0 ? 1 : 0,
    SV: saves,
    GA: goalsAgainst,
  };
}

/** Maps each game-log entry to its own per-category values — one row per
 * game, for storing into PlayerGameLog. Games with no parseable date are
 * dropped (can't be stored without one). gameId is included so callers can
 * enrich HIT/BLK from getGameHitsAndBlocks afterward (skaters only — the
 * mapper always returns 0 for those two, see mapSkaterGameEntry). */
export function mapGameLogToPerGameValues(
  entries: RawGameLogEntry[],
  position: "G" | "SKATER"
): { gameDate: string; gameId: number; values: Record<string, number> }[] {
  const mapper = position === "G" ? mapGoalieGameEntry : mapSkaterGameEntry;
  return entries
    .filter((e): e is RawGameLogEntry & { gameDate: string } => e.gameDate !== null)
    .map((e) => ({ gameDate: e.gameDate, gameId: gameIdOf(e), values: mapper(e.raw) }));
}

export function aggregateSkaterStats(
  entries: RawGameLogEntry[],
  start: Date,
  end: Date
): WeeklyNhlStatResult {
  const inRange = entries.filter((e) => gameDateInRange(e.gameDate, start, end));
  const values: Record<string, number> = { G: 0, A: 0, PPP: 0, SHP: 0, SOG: 0, PIM: 0, HIT: 0, BLK: 0 };
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

// ---------------------------------------------------------------------------
// Per-game boxscore — the only source for hits and blocked shots, since the
// game-log endpoint above doesn't report either (confirmed live). This is
// keyed by *game*, not by player: one boxscore lists every skater on both
// teams, so callers syncing multiple rostered players should fetch each
// distinct gameId once and reuse it, not call this once per player per
// game — see the shared cache in the admin page's sync actions.
//
// UNVERIFIED shape — same caveat as the roster endpoint: best-effort guess
// from the community API reference, not confirmed against a live response.
// Use getRawBoxscoreJson via the debug tool if hits/blocks come back wrong
// or every game errors out.
// ---------------------------------------------------------------------------

const boxscoreUrl = (gameId: number) => `https://api-web.nhle.com/v1/gamecenter/${gameId}/boxscore`;

export interface GameHitsBlocks {
  hits: number;
  blockedShots: number;
}

const BoxscoreSkaterStatSchema = z
  .object({
    playerId: z.coerce.number(),
    hits: z.number().optional(),
    blockedShots: z.number().optional(),
  })
  .passthrough();

/** playerByGameStats splits skaters into forwards/defense per team — pull
 * every skater group from both sides into one flat list. */
function extractBoxscoreSkaters(json: Record<string, unknown>): unknown[] {
  const stats = json.playerByGameStats as Record<string, unknown> | undefined;
  if (!stats) return [];
  const sides = ["homeTeam", "awayTeam"] as const;
  const groups = ["forwards", "defense"] as const;
  const all: unknown[] = [];
  for (const side of sides) {
    const team = stats[side] as Record<string, unknown> | undefined;
    if (!team) continue;
    for (const group of groups) {
      if (Array.isArray(team[group])) all.push(...(team[group] as unknown[]));
    }
  }
  return all;
}

/** Every skater's hits/blockedShots for one game, keyed by NHL player ID. */
export async function getGameHitsAndBlocks(gameId: number): Promise<Map<number, GameHitsBlocks>> {
  const res = await fetchNhl(boxscoreUrl(gameId), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`NHL boxscore request failed for game ${gameId} (${res.status})`);
  const json = (await res.json()) as Record<string, unknown>;
  const skaters = extractBoxscoreSkaters(json);
  // A completed NHL game always dresses ~36-40 skaters across both teams —
  // zero here is never a real "no hits recorded" answer, only a sign that
  // playerByGameStats (or its forwards/defense nesting) isn't where this
  // code expects it anymore. Thrown as NhlShapeError specifically so
  // per-game callers that otherwise skip a single bad boxscore and move on
  // don't do the same thing here and quietly zero out HIT/BLK for an
  // entire sync run.
  if (skaters.length === 0) {
    throw new NhlShapeError(
      `NHL boxscore for game ${gameId} had no skaters under playerByGameStats — the response shape may have changed. Use the "Debug: preview a raw NHL boxscore response" tool on /admin/nhl-sync with this game ID to inspect the real JSON.`
    );
  }
  const parsed = z.array(BoxscoreSkaterStatSchema).safeParse(skaters);
  if (!parsed.success) {
    throw new Error(`Unexpected response shape from NHL boxscore API for game ${gameId}`);
  }
  const map = new Map<number, GameHitsBlocks>();
  for (const p of parsed.data) {
    map.set(p.playerId, { hits: p.hits ?? 0, blockedShots: p.blockedShots ?? 0 });
  }
  return map;
}

/** For live debugging: the untouched parsed JSON body from a game's
 * boxscore endpoint, no schema validation. */
export async function getRawBoxscoreJson(gameId: number): Promise<unknown> {
  const res = await fetchNhl(boxscoreUrl(gameId), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`NHL boxscore request failed for game ${gameId} (${res.status})`);
  return res.json();
}

/** A gameId -> skater hits/blocks map, shared across every player processed
 * in one sync run — many rostered players share NHL games (same team, or
 * just an overlapping schedule), so this avoids re-fetching the same
 * boxscore once per player. Not perfectly race-free under concurrency (two
 * players hitting an uncached gameId at the same instant can both fetch
 * once before either caches), but that's just a little wasted work, not a
 * correctness problem — the caller's own upsert underneath is what
 * actually needs to be safe to repeat, and it already is. Shared by both
 * "Weekly stat sync" and "Sync full season game logs" (and its
 * progress-tracked variant), hence living here rather than in either
 * caller.
 */
export function createBoxscoreCache() {
  const cache = new Map<number, Map<number, GameHitsBlocks>>();
  return async function cachedBoxscore(gameId: number): Promise<Map<number, GameHitsBlocks>> {
    const existing = cache.get(gameId);
    if (existing) return existing;
    const fetched = await getGameHitsAndBlocks(gameId);
    cache.set(gameId, fetched);
    return fetched;
  };
}

// ---------------------------------------------------------------------------
// Full team rosters — for pre-loading the entire active NHL player pool as
// free agents, ahead of needing them (e.g. before a future Yahoo sync can
// tell us who's actually rostered). One call per team; there's no "list
// every active player" endpoint, only per-team rosters.
//
// UNVERIFIED like the game-log endpoint above: the shape below is a
// best-effort guess (nested {default: "..."} name objects are how several
// other NHL API responses represent localized strings, per the community
// reference), not confirmed against a live response. Use
// getRawTeamRosterJson via the debug tool before trusting an import.
// ---------------------------------------------------------------------------

/** Current 32 NHL teams' 3-letter abbreviations, as used in API URLs. */
export const NHL_TEAM_ABBREVS = [
  "ANA", "BOS", "BUF", "CGY", "CAR", "CHI", "COL", "CBJ",
  "DAL", "DET", "EDM", "FLA", "LAK", "MIN", "MTL", "NSH",
  "NJD", "NYI", "NYR", "OTT", "PHI", "PIT", "SJS", "SEA",
  "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WSH", "WPG",
] as const;

const rosterUrl = (teamAbbrev: string) => `https://api-web.nhle.com/v1/roster/${teamAbbrev}/current`;

const LocalizedNameSchema = z.union([z.string(), z.object({ default: z.string() }).passthrough()]);
function localizedName(v: z.infer<typeof LocalizedNameSchema>): string {
  return typeof v === "string" ? v : v.default;
}

const RosterPlayerSchema = z
  .object({
    id: z.coerce.number(),
    firstName: LocalizedNameSchema,
    lastName: LocalizedNameSchema,
    positionCode: z.string(),
    headshot: z.string().optional(),
  })
  .passthrough();

function mapNhlRosterPosition(code: string): Position {
  switch (code.toUpperCase()) {
    case "L":
      return "LW";
    case "R":
      return "RW";
    case "D":
      return "D";
    case "G":
      return "G";
    default:
      return "C";
  }
}

export interface NhlRosterPlayer {
  nhlPlayerId: number;
  name: string;
  position: Position;
  headshot: string | null;
}

export async function getTeamRoster(teamAbbrev: string): Promise<NhlRosterPlayer[]> {
  const res = await fetchNhl(rosterUrl(teamAbbrev), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`NHL roster request failed for ${teamAbbrev} (${res.status})`);
  const json = (await res.json()) as Record<string, unknown>;
  const groups = ["forwards", "defensemen", "goalies"] as const;
  const all = groups.flatMap((g) => (Array.isArray(json[g]) ? (json[g] as unknown[]) : []));
  // A real NHL team always carries 20+ players across these three groups —
  // zero is never a legitimate "this team has no roster," only a sign the
  // forwards/defensemen/goalies keys (or their nesting) aren't where this
  // code expects them anymore. NhlShapeError so this reads as a real,
  // actionable failure in the pool-import error list rather than silently
  // importing nothing for the team and looking like it just succeeded.
  if (all.length === 0) {
    throw new NhlShapeError(
      `NHL roster response for ${teamAbbrev} had no players under forwards/defensemen/goalies — the response shape may have changed. Use the "Debug: preview a raw NHL roster response" tool on /admin/nhl-sync to inspect the real JSON.`
    );
  }
  const parsed = z.array(RosterPlayerSchema).safeParse(all);
  if (!parsed.success) {
    throw new Error(`Unexpected response shape from NHL roster API for ${teamAbbrev}`);
  }
  return parsed.data.map((p) => ({
    nhlPlayerId: p.id,
    name: `${localizedName(p.firstName)} ${localizedName(p.lastName)}`,
    position: mapNhlRosterPosition(p.positionCode),
    headshot: p.headshot ?? null,
  }));
}

/** For live debugging: the untouched parsed JSON body from a team's roster
 * endpoint, no schema validation. */
export async function getRawTeamRosterJson(teamAbbrev: string): Promise<unknown> {
  const res = await fetchNhl(rosterUrl(teamAbbrev), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`NHL roster request failed for ${teamAbbrev} (${res.status})`);
  return res.json();
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
