import { z } from "zod";

/**
 * Yahoo Fantasy Sports API client — SCAFFOLDING ONLY. There's no Yahoo
 * Developer app registered yet (no YAHOO_CLIENT_ID/YAHOO_CLIENT_SECRET in
 * the environment), so nothing in this file has ever made a real request —
 * unlike lib/nhl.ts's endpoints, none of this is confirmed against a live
 * response. It exists so the OAuth2 plumbing is ready to go the moment real
 * credentials exist; see README's "Future: Yahoo Fantasy API integration"
 * section for setup steps and what's still missing.
 *
 * What's deliberately NOT here yet: an admin "Connect Yahoo" route
 * (authorize -> callback -> store tokens), anywhere to persist the token
 * pair (would need a new schema model), and any per-resource parser (roster
 * shape, stats shape). The OAuth2 exchange below is a standard,
 * well-documented protocol (RFC 6749) that's safe to write with confidence
 * even unverified. The actual fantasy-data shapes are not safe to guess at
 * blind — Yahoo's XML-to-JSON conversion has a well-known reputation for
 * awkward, deeply-nested, sometimes numeric-keyed arrays, and there's no
 * community reference or live debug loop backing a guess here the way there
 * was for the NHL client. Add real parsers using the same workflow
 * lib/nhl.ts and /admin/nhl-sync's debug tools established: call
 * yahooFantasyFetch for the raw JSON, paste a real response back, then write
 * the zod schema against what actually came back.
 */

const AUTHORIZE_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const FANTASY_API_BASE = "https://fantasysports.yahooapis.com/fantasy/v2";

/** Yahoo's fantasy "game key" for NHL — the sport code resolves to whatever
 * NHL fantasy game is current per Yahoo's docs, instead of a season-specific
 * numeric game_id. Fine for "just give me this season"; querying a past
 * Yahoo season would need that season's actual numeric key instead. */
export const YAHOO_NHL_GAME_KEY = "nhl";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — see .env.example / README's Yahoo integration section.`);
  }
  return value;
}

/** Whether the three required env vars are set. Check this before showing a
 * "Connect Yahoo" admin UI (not built yet) — none of the functions below
 * will work without them. */
export function isYahooConfigured(): boolean {
  return Boolean(
    process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET && process.env.YAHOO_REDIRECT_URI
  );
}

/**
 * Step 1 of the 3-legged OAuth2 flow: send the commissioner here to
 * authorize this app against their Yahoo account. `state` should be a
 * random per-attempt value that a future callback route verifies to guard
 * against CSRF — generate and stash it (e.g. a signed cookie) before
 * redirecting here.
 */
export function yahooAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("YAHOO_CLIENT_ID"),
    redirect_uri: requireEnv("YAHOO_REDIRECT_URI"),
    response_type: "code",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface YahooTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when accessToken stops working — Yahoo access tokens are
   * documented as short-lived (~1 hour). Check this before using a token
   * and refresh proactively rather than waiting for a 401. */
  expiresAt: number;
}

const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
});

function parseTokenResponse(json: unknown): YahooTokens {
  const parsed = TokenResponseSchema.safeParse(json);
  if (!parsed.success) throw new Error("Unexpected response shape from Yahoo token endpoint");
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresAt: Date.now() + parsed.data.expires_in * 1000,
  };
}

function basicAuthHeader(): string {
  const id = requireEnv("YAHOO_CLIENT_ID");
  const secret = requireEnv("YAHOO_CLIENT_SECRET");
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

/** Step 2: exchange the authorization code a future callback route receives
 * for a token pair. */
export async function exchangeYahooCode(code: string): Promise<YahooTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuthHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      redirect_uri: requireEnv("YAHOO_REDIRECT_URI"),
      code,
    }),
  });
  if (!res.ok) throw new Error(`Yahoo token exchange failed (${res.status})`);
  return parseTokenResponse(await res.json());
}

/** Refreshes an expired (or about-to-expire) access token. Yahoo may rotate
 * the refresh token on use — always persist whatever refresh_token comes
 * back here rather than assuming it's unchanged from what was passed in. */
export async function refreshYahooTokens(refreshToken: string): Promise<YahooTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuthHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      redirect_uri: requireEnv("YAHOO_REDIRECT_URI"),
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Yahoo token refresh failed (${res.status})`);
  return parseTokenResponse(await res.json());
}

/**
 * Raw authenticated GET against any Fantasy API resource path (e.g.
 * `/users;use_login=1/games;game_keys=nhl/leagues`), JSON body back
 * unparsed. Yahoo's fantasy endpoints return XML by default —
 * `format=json` switches that — but the JSON is a fairly literal conversion
 * of the XML tree (expect awkward nested/numeric-keyed arrays, not a clean
 * REST shape). Deliberately the only Yahoo data-fetching function in this
 * file today: see the file-level doc comment for why typed parsers on top
 * of this need a real response to write against first.
 */
export async function yahooFantasyFetch(resourcePath: string, accessToken: string): Promise<unknown> {
  const path = resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`;
  const separator = path.includes("?") ? "&" : "?";
  const res = await fetch(`${FANTASY_API_BASE}${path}${separator}format=json`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Yahoo Fantasy API request failed for ${resourcePath} (${res.status})`);
  return res.json();
}
