# Slapshot City Fantasy Hockey League

A commissioner-run website for a Yahoo fantasy hockey league: standings, a
category-by-category stats breakdown, a weekly "Team of the Week" picked by
a fixed-weight 0–100 valuation model, transaction tracking with 1–10 peer
ratings, and a "hostile yet friendly" AI-narrated weekly recap newsletter.

Built with Next.js (App Router, TypeScript), Prisma + Postgres, Auth.js
(email + password), and the Anthropic API for recap prose.

**Viewing the site is public** — standings, stats, Team of the Week,
transactions, and published recaps are open to anyone with the link. Signing
in is only required to submit a transaction rating (so it can be attributed
to someone) or to reach `/admin` as the commissioner.

## Feature map

| Feature | Where |
|---|---|
| League standings (H2H Categories W-L-T) | `/standings`, `lib/standings.ts` |
| Season-to-date category totals | `/categories`, `lib/standings.ts` |
| Team of the Week (per-position best score, player cards w/ rating + stats) | `/team-of-the-week`, `lib/team-of-week.ts` |
| Transactions + 1–10 peer ratings | `/transactions`, `lib/transactions.ts` |
| Weekly recap newsletter | `/recaps`, `lib/recap/*` |
| Commissioner data entry | `/admin/*` |
| NHL player photos + auto-stat sync | `/admin/nhl-sync`, `lib/nhl.ts` |
| "Ultimate Team"-style player cards: season overall + per-category scores, team-colored, season totals, last 10 games | `/players`, `components/players/SeasonCard.tsx`, `lib/playerRating.ts` |
| Yahoo Fantasy API integration (OAuth2 scaffolding only, not wired up) | `lib/yahoo.ts` |

## Getting started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment.** Copy `.env.example` to `.env` and fill in at
   least `DATABASE_URL` (a Postgres connection string), `AUTH_SECRET`
   (`npx auth secret`), and `COMMISSIONER_PASSWORD` (whatever you want your
   own password to be — the seed script hashes it in). `ANTHROPIC_API_KEY` is
   optional — see [Running without API keys](#running-without-api-keys).

3. **Set up the database**

   ```bash
   npx prisma migrate dev
   npx prisma db seed   # only needed if migrate dev doesn't run it automatically
   ```

   This creates a fixture league ("Slapshot City Fantasy Hockey League"),
   8 teams/managers, a full Week 1 (rosters, stats, matchups, a couple of
   transactions with ratings), engineered so every recap detector has
   something to say. The seed script prints the commissioner's email and
   password to sign in with — by default that account belongs to whoever's
   email is configured in `prisma/seed.ts` (`MANAGERS[0]`), which you should
   change to your own before reseeding for real use. Every other seeded
   manager shares one demo password, also printed by the script.

4. **Run it**

   ```bash
   npm run dev
   ```

   Visit `http://localhost:3000` — you'll land straight on the standings,
   no sign-in needed. Use the credentials the seed script printed to sign in
   as commissioner (top right → Sign in).

### Running without API keys

The app is fully functional with just `DATABASE_URL`, `AUTH_SECRET`, and
`COMMISSIONER_PASSWORD` set:

- **No `ANTHROPIC_API_KEY`**: the weekly recap falls back to a deterministic
  template generator (`lib/recap/templateGenerator.ts`) instead of calling
  Claude. It covers every algorithmic section (tightest matchup, manager of
  the week, choker of the week, etc.) but skips the creative ones (Clutch,
  Clown, Quote of the Week), since those aren't derivable from stats alone.

### A note on password login

There's no email provider, no magic links, and no forgot-password flow yet —
just email + password, checked with bcrypt against `User.passwordHash`. The
login form uses standard `autocomplete="username"`/`"current-password"`
attributes, so your browser will offer to save the password; on iPhone/Mac
Safari that means **Face ID or Touch ID unlocks it for you** on future
visits instead of typing it, without this app implementing any biometric
API itself. There's currently no self-service way for a manager to set or
change their own password — see the follow-ups below.

## Data model

`prisma/schema.prisma` is the source of truth; the short version:

- **League → Season → Week** is the season structure. `League.positionSlots`
  (e.g. `{"C":1,"LW":1,"RW":1,"D":2,"G":1}`) and `ScoringCategory` rows
  (code, label, which positions it applies to, whether higher is better) are
  both data, not hardcoded — the app doesn't assume any specific roster
  shape or category set beyond the five hockey positions. Live category
  set: **Goals, Assists, Power Play Points, Shorthanded Points, Shots on
  Goal, Penalty Minutes, Hits, Blocks** for skaters; **Wins, GAA, SV%,
  Shutouts** for goalies. `ScoringCategory.enabled` lets a category be
  retired without deleting it (and its history) — see "Update scoring
  categories" on `/admin/stats` for how the league's original Plus/Minus
  category was retired in favor of Shorthanded Points.
- **Team / Player / RosterEntry** track season-long roster ownership.
  **WeeklyRosterSlot** is a separate per-week snapshot of who started vs. was
  benched — that's what makes Choker of the Week and optimal-lineup%
  possible.
- **StatLine** is one player's value in one category for one week.
- **Matchup / MatchupCategoryResult** store a week's head-to-head result,
  computed (not hand-entered) from the two teams' started players' stat
  totals — see `lib/matchups.ts`.
- **Transaction / TransactionPlayer / TransactionRating** log adds, drops,
  and trades and the 1–10 ratings other managers leave on them.
- **RecapArticle / RecapSection** hold the generated newsletter — sections
  are structured (`type`, `title`, `body`), not one HTML blob, so a future
  PDF export or a redesign can render them without reverse-engineering
  markup.
- **PlayerGameLog** is one row per player per real NHL game (independent of
  the app's own Week bookkeeping) — powers "last 10 games" and per-game
  ratings. **PlayerSeasonRating** is the derived, recomputed-in-place
  "Ultimate Team" card score built from it — see "Player pages & ratings"
  below for both.
- Every row that could plausibly come from a Yahoo sync one day
  (`Team.externalSource`, `Player.externalSource`, `StatLine.source`, …)
  already carries a `DataSource` (`MANUAL | CSV_IMPORT | YAHOO_SYNC`) —
  see [Future: Yahoo integration](#future-yahoo-fantasy-api-integration).

## Weekly commissioner workflow

Everything below lives under `/admin` (commissioner-only — gated on
`User.role`).

1. **Start the week** — `/admin/matchups` → "Start next week" creates the
   next `Week` row.
2. **Log any transactions** that happened — `/admin/transactions/new`. Adds
   create a brand-new `Player`; drops and trades operate on existing active
   roster entries.
3. **Import stat lines** — either upload a CSV at `/admin/stats`, or pull
   real stats automatically at `/admin/nhl-sync` (see below). CSV columns:

   ```
   team, player, position, started, G, A, PPP, SHP, SOG, PIM, HIT, BLK, W, GAA, SV%, SO
   ```

   (Only enabled categories — the page itself always shows the current
   list, so treat this as illustrative rather than authoritative.)

   `team` and `player` must exactly match an existing team name and a player
   already on that team's active roster (that's why transactions are logged
   first). Category columns only need values for the categories relevant to
   that player's position — leave the rest blank. The whole file is
   validated before anything is written: a bad row rejects the entire
   upload with a list of what to fix, rather than partially importing.
4. **Compute matchup results** — `/admin/matchups`, pick who played whom,
   click compute. Results are derived from started players' stat totals, not
   typed in — so this step must come after stat import.
5. **Generate and publish the recap** — `/admin/recaps` → pick the week →
   "Generate draft" → review/edit each section inline → "Publish". Every
   regeneration replaces the draft and un-publishes the article, so a bad
   regen can never silently overwrite what's already live.

## NHL player sync (`/admin/nhl-sync`)

Uses NHL.com's own unofficial, undocumented API (the same one its search bar
and stats pages run on) — there's no official public NHL developer program
with a key/ToS.

- **Clean up made-up player names** (only shown if any exist): the original
  seed fixture padded out bench depth with invented names
  (`lib/seedLeague.ts`'s old filler generator — "Blake Whitmore" and the
  like), which can never match a real NHL player. This renames those rows
  in place to real (non-star) active NHL players at the same position —
  same `Player.id`, so all existing roster history/stats/transactions stay
  attached — so the whole roster becomes sync-able. Fresh seeds no longer
  generate fictional names in the first place (`lib/depthPlayerNames.ts`).
  The actual rename logic lives in `lib/playerCleanup.ts`, shared by this
  button and by `GET /api/admin/cleanup-fictional-names` — a plain link
  that does the same thing without going through a server action, for when
  the button itself errors out (see the stale-action-ID note below). Visit
  it directly while signed in as commissioner; safe to reload/re-run any
  time, it's a no-op once nothing's left to rename.

  A candidate real name can already exist as its own `Player` row — most
  often because "Import full NHL player pool" already created it as a
  free agent. `renameLegacyFictionalPlayers` handles that by merging: it
  re-points every `RosterEntry`/`StatLine`/`WeeklyRosterSlot`/
  `TransactionPlayer`/`TeamOfWeekSelection`/`PlayerGameLog` row from the
  fictional player's id onto the existing (already NHL-matched) real
  player's id, then deletes the now-empty fictional row — rather than
  reporting "ran out of names" for a name that was actually available,
  or (worse) creating two different `Player` rows with the same display
  name. Only an *actively rostered* same-name collision still causes a
  skip. Verified locally against the exact failure a live run hit — a
  DB seeded with legacy names plus a partially-populated free-agent pool
  (mirroring an `Import full NHL player pool` run having already added
  some of the same real players) — confirming zero data loss and no
  duplicate names either way (merge or plain rename).
- **Photos & matching**: for every `Player`, searches NHL.com by exact
  (case-insensitive) name among currently-active players only, and on a
  match, saves their real headshot and NHL player ID (`Player.photoUrl` /
  `externalId`). Players with no exact active-player match (typos, remaining
  fictional fixture names, retired players) are left on the generic
  per-position illustration and reported as skipped — nothing is guessed.
  Requires `next.config.ts`'s `images.remotePatterns` to allow
  `*.nhle.com` (already configured) — without it, `next/image` silently
  refuses to render the real headshot URLs.
- **Weekly stat sync**: for a chosen week, fetches each rostered player's
  real NHL game log, sums the games falling inside that week's date range
  into your league's scoring categories, and writes `StatLine` rows
  (`source: NHL_SYNC`). It also creates a `WeeklyRosterSlot` for anyone
  missing one, **defaulting everyone to started** — it has no way to know
  your lineup decisions, only real game results. Use the CSV upload
  afterward if you need to mark someone benched or correct a value; a later
  write to the same (week, player, category) always wins, from either path.
- **Sync full season game logs**: for every rostered player, fetches their
  entire season's NHL game log and upserts one `PlayerGameLog` row per game
  (`playerId` + `gameDate` unique) — independent of the app's own Week
  bookkeeping, so it works even for weeks the commissioner never explicitly
  synced. This is what powers the individual player pages below; re-run it
  periodically (it's a full upsert, safe to repeat) to pick up new games.
- **Update season card scores**: recomputes every rostered player's
  `PlayerSeasonRating` — the "Ultimate Team"-style overall + per-category
  score shown on player cards (see "Player pages & ratings" below for the
  full formula). Fetches each player's *last* season's game log fresh on
  every run (not persisted to `PlayerGameLog`, just used as this
  computation's baseline) on top of whatever "Sync full season game logs"
  already stored for this season, so it makes one extra NHL request per
  rostered player. Re-run roughly monthly to keep the season blend current;
  it's a plain recompute-and-overwrite, safe to run any time.
- **Full NHL player pool (free agents)**: pre-loads every player on all 32
  current NHL rosters (`lib/nhl.ts`'s `getTeamRoster`, one API call per
  team) as a `Player` row, ahead of actually needing them — so the full
  pool is searchable on `/players` before a real add/drop or a future
  Yahoo sync needs to find someone not already on a fantasy roster.
  De-dupes against known players two ways: by NHL ID (already matched) and
  by exact name (already on a fantasy roster but not yet NHL-matched) —
  either way the existing `Player` row is updated in place, never
  duplicated, so it's safe to re-run. **Unverified shape** (unlike
  search/game-log, this one hasn't been confirmed against a live response
  at all) — if every team errors out, use the **"Debug: preview a raw NHL
  roster response"** box to see the real JSON and fix `getTeamRoster`.

**Search and game-log endpoint shapes are now verified against live
responses.** Search returns `playerId` as a numeric *string* (e.g.
`"8478402"`), not a number — `lib/nhl.ts` coerces it. The skater game-log
endpoint's field names for Goals/Assists/PPP/SOG/PIM/SHP (`goals`,
`assists`, `powerPlayPoints`, `shots`, `pim`, `shorthandedPoints`) all
matched the first real guess. (This sandbox has no network access to
`nhle.com`, so both of these took a round-trip through the debug tools —
type a name into the box, paste back the JSON — worth remembering if the
API shape ever drifts again.)

**Confirmed gap: Hits and Blocked Shots are not in the game-log response at
all**, for any player — every other field is there, those two just aren't.
They come from a second, different endpoint instead: a per-*game* boxscore
(`lib/nhl.ts`'s `getGameHitsAndBlocks`, one call per distinct `gameId`,
cached and reused across every rostered player who shares that game — a
boxscore lists every skater on both teams, so there's no reason to fetch
the same game twice). Both **weekly stat sync** and **full-season game-log
sync** call it for skaters. This endpoint's shape is **unverified** like
the roster endpoint — if hits/blocks come back wrong or every game errors
out, use the **"Debug: preview a raw NHL boxscore response"** box (a
`gameId` — visible in any game-log debug preview's entries — not a player
name) to see the real JSON, and `getGameHitsAndBlocks`/
`extractBoxscoreSkaters` are the ones to fix.

One extra API call per distinct game (not per player) adds up on a full
season sync across a real roster — potentially hundreds of extra requests
— so `maxDuration` on this page is 300s and a fresh full-season sync can
take a few minutes. It's a safe upsert per game, so a partial timeout just
means fewer games got the hits/blocks enrichment on that run; re-running
picks up where it left off (already-cached boxscores just get re-fetched,
nothing is lost).

**The NHL API has an undocumented rate limit** — confirmed live: a
full-roster action run at concurrency 6 got every single request 429'd.
Every request in `lib/nhl.ts` goes through a shared `fetchNhl` wrapper that
retries a 429 (or a 5xx) with exponential backoff — honoring a Retry-After
header if the API sends one — before giving up; a real 404 or other 4xx is
never retried, since that's an actual answer (e.g. "no game log for this
player this season"), not a transient failure. "Update season card scores"
also runs at a lower concurrency (3, vs. 6 elsewhere on this page) since it
can fire up to two requests per player. If a run still comes back with a
wall of 429 errors despite this, the rate limit is probably tighter than
what's tuned here — dropping the concurrency argument further (or the
retry backoff's cap) in the relevant `mapWithConcurrency` call is the
place to start.

Goalie stats (Wins/GAA/SV%/Shutouts) are unaffected by any of this — those
come entirely from the game-log endpoint's own fields
(`mapGoalieGameEntry`), no boxscore needed.

**If a server action button gives an error right after a new deploy**: this
is almost always a stale page — Next.js embeds a hashed ID for each server
action, and a browser tab left open from before a deploy is holding IDs
that no longer exist on the (now-redeployed) server. Hard-refresh the page
and try again before assuming it's a real bug.

## Player pages & ratings (`/players`)

The directory (`/players`) has a type-ahead search box
(`components/players/PlayerSearchBar.tsx`) — filters the roster client-side
as you type (name or team), shows a dropdown of up to 8 matches, and
jumps straight to a player's page on click or Enter. No API round trip;
the roster's small enough to filter in the browser.

Every rostered player gets an "Ultimate Team"-style season card
(`components/players/SeasonCard.tsx`) — on the directory grid, and again as
the hero of their detail page (`/players/[playerId]`), which also keeps the
season totals and last-10-games history below it. Two rating systems feed
the app, deliberately kept separate — a stable season-long card score and a
volatile per-game one:

### Season card score

The card's big overall number and its per-category grid (0–100 for each of
G/A/PPP/SHP/SOG/HIT/BLK/PIM for skaters, W/SV/GA/SO for goalies) come from
`PlayerSeasonRating`, computed by **"Update season card scores"** on
`/admin/nhl-sync` (re-run roughly monthly — a plain recompute-and-overwrite,
safe any time). This is intentionally not a per-game number:

- **Per-category 0–100 scores**: each category's blended per-game average
  (below) is standardized against a hand-calibrated baseline/stdDev for
  that specific category (`FORWARD_CATEGORY_CALIBRATION` /
  `DEFENSE_CATEGORY_CALIBRATION` / `GOALIE_CATEGORY_CALIBRATION` in
  `lib/playerRating.ts`) — separate constants from the per-game valuation
  model further down. Forwards and defensemen use different offensive
  baselines (a defenseman scoring/assisting at a good rate *for a
  defenseman* was landing below a baseline calibrated off forward
  production, unfairly dragging every D's card down) — goalies get their
  own table entirely. The 0–100 mapping itself (`categoryScore`) is also
  its own curve, not `standardizeRating` — anchored at 68 rather than 50,
  and asymmetric: performance above baseline climbs faster per standard
  deviation (11 pts) than performance below baseline falls (7 pts). A
  symmetric 50-centered curve read as too flat/low for a HUT/FUT-style
  card — "replacement level for a rostered player" should read like a
  generic silver card in the 60s, not a 50, and a genuine star should be
  able to break into the 90s.
- **Overall**: a weighted average of those category scores, weighted
  differently by position (`FORWARD_EMPHASIS` / `DEFENSE_EMPHASIS` /
  `GOALIE_EMPHASIS`) — defensemen weight HIT/BLK/PIM more heavily than
  forwards do; forwards weight G/A/PPP more heavily.
- **Blended, not replaced**: starts as last season's rating at the
  beginning of this season and shifts toward this season's actual
  performance as the year goes on. `seasonBlendWeight` derives that blend
  purely from today's date vs. October 1 of the season's start year
  (ramping 0→1 over ~7 months) rather than from how many times the button's
  been clicked, so re-running the update any time is always correct for
  wherever the calendar actually is.
- **HIT/BLK have no real last-season baseline**: getting those from a
  player's entire prior season would mean a boxscore call per game per
  rostered player — too expensive for an admin button — so the blend falls
  back to that category's own baseline (a neutral ~50) instead of a
  fabricated, punishing zero. Same fallback covers a true rookie with no
  last-season data at all (`blendedSeasonScores`'s doc comment in
  `lib/playerRating.ts` has the full reasoning).
- **Card colors** match the player's real NHL team
  (`Player.nhlTeamAbbrev`, hand-maintained in `lib/nhlTeamColors.ts`) —
  populated by the same NHL sync matching that finds photos, falling back
  to the site's own navy/gold when there's no team match yet.

Until "Update season card scores" has run for a player, their card shows
"–" in place of every score rather than a fabricated number.

### Per-game rating (Last 10 games, Team of the Week)

The detail page's **Last 10 games** list, and Team of the Week
(`components/totw/PlayerCard.tsx` — team-colored like the season card, but
deliberately keeping its own weekly rating rather than the season blend,
since the whole point of Team of the Week is a specific week's standout
performance), use a different, per-game/per-week rating: a fixed-weight
valuation model
(`lib/playerRating.ts`) — originally a peer-relative z-score (a player's
game judged against other rostered players at their position that week),
replaced with a commissioner-provided formula since the peer-comparison
approach degraded to a crude 40/50/60 guess whenever fewer than 3 peers had
games that week. This model needs no peer pool at all, so every game gets a
real computed rating regardless of sample size:

- **Skaters**: `3.0×G + 2.0×A + 1.0×PPP + 2.0×SHP + 0.4×SOG + 0.5×BLK + 0.3×HIT + 0.3×PIM`
- **Goalies**: `4.0×W + 0.2×SV + 3.0×SO − 1.5×GA` (SV/GA are raw saves/goals-against
  counts, stored per game in `PlayerGameLog` alongside the standings-facing
  rate stats GAA/SV% — see `lib/nhl.ts`'s `mapGoalieGameEntry` — since GAA/SV%
  are rates, not counts, and this formula needs counts)
- **Standardized to 0–100**: 50 = baseline (1.5 for skaters, 5.0 for
  goalies), each standard deviation (2.0 skaters, 3.5 goalies) is worth 10
  points, clamped to 0–100 (`standardizeRating`).

Team of the Week ranks a whole week's totals, not one game, so its rating
scales the baseline/stdDev by however many games that player actually
played that week (`ratingForValues`'s `gamesPlayed` parameter) —
`weeklyValuesAndGameCount` prefers summing real `PlayerGameLog` rows within
the week's date range (true game count, and the only source with real
SV/GA for goalies), falling back to the week's `StatLine` totals with an
assumed 3-game week when no per-game data exists yet (CSV-imported weeks,
or before "Sync full season game logs" has run). A "72/100" means the same
thing everywhere in this per-game system — one game, a week, Choker of the
Week's bench-vs-started comparison — because it's all the same
`ratingForValues` call underneath. It means something different from the
season card score above by design: one is "how was this game/week," the
other is "how good is this player this year."

Both need the "Sync full season game logs" admin action above to have run
at least once; until then, player pages show "no synced games yet."

### Team of the Week's reveal

`/team-of-the-week` loads with the lineup face-down — mystery cards in the
actual formation (LW/C/RW, D, G) behind a "Reveal Team of the Week"
button — rather than showing every pick immediately
(`components/totw/TeamRevealSequence.tsx`, a client component; the page
itself stays a server component and just passes it the already-computed
picks). Clicking it walks the real cards in one at a time via a staggered
CSS animation (`card-walkout` in `app/globals.css`), **weakest rating
first and the week's best performer last** — reveal order is independent
of each card's actual formation slot, so the suspense is deliberate, not
just "whatever order they load in." Respects `prefers-reduced-motion` the
same way `Reveal` elsewhere on the site does: the keyframe is only defined
inside a `no-preference` media query, so a reduced-motion visitor still
gets the click-to-reveal interaction, just with every card appearing at
once instead of staggered.

## Design system

"Royal Hockey": deep navy + gold, condensed bold uppercase display type
(Oswald), a crown/shield crest mark (`components/ui/Crest.tsx`, inline SVG),
and a single strong accent color rather than a multi-color palette —
rebuilt from a reference concept video the commissioner supplied (dark
cinematic hero, gold CTA buttons, clean white content cards). Theme tokens
live in `app/globals.css`; reusable components in `components/ui/` and
`components/totw/`. `--color-danger` is a separate, deliberately-not-gold
token reserved for genuine error states (failed imports, form errors) so
they never blend into the brand accent.

Every `SectionCard` (i.e. most major content blocks on every page) fades
and slides into view as it scrolls into the viewport, via
`components/ui/Reveal.tsx` (a small `IntersectionObserver` wrapper — no
animation library). Grids of player cards stagger in one-by-one. It
respects `prefers-reduced-motion`. The page header (`PageHeader`) instead
animates once on mount, since it's always already in view.

An earlier iteration used a cream/red/blue palette pulled from a static
mockup (`fantasywebsite/index.html`, preserved in git history at commit
`1f3a475`) — superseded by the above. The arena photo backdrop
(`public/images/arena-hero.jpg`) from that mockup is still reused on the
sign-in page.

`avatarForPlayer` (`lib/positionAvatar.ts`) falls back to one generic flat
black silhouette (`public/images/positions/generic-black.svg`) for any
player with no real synced `photoUrl` — deliberately plain, so an
unmatched player reads clearly as "no photo yet" rather than looking like
an actual (if cartoonish) headshot. It's an SVG, so `next.config.ts` sets
`images.dangerouslyAllowSVG` (with a locked-down `contentSecurityPolicy`,
per Next's own recommendation) — `next/image` otherwise refuses to render
SVGs at all.

## Algorithms worth knowing about

- **Standings** (`lib/standings.ts`) are H2H Categories: a season W-L-T
  record from each week's matchup result, not a points total.
- **Team of the Week** (`lib/team-of-week.ts`) ranks players by raw weighted
  score *within their position's pool of rostered players that week*, and
  reports each pick's 0–100 rating via the same fixed valuation model
  individual player pages use (see above) — no peer pool needed, so this
  no longer has a small-sample fallback case at all.
- **Recap detectors** (`lib/recap/detectors.ts`) are pure functions that
  decide *who* wins each section (Manager of the Week is a weighted
  composite of category win rate, optimal-lineup%, and transaction quality;
  Choker of the Week finds the largest bench-vs-started *rating* gap — a
  benched player rated over 60 (a full standard deviation above baseline)
  outscoring the worst-rated started player at the same position; Comeback
  of the Week compares this week's result to rolling season form, and is
  correctly empty in Week 1). Claude (or the template fallback) only
  narrates these pre-decided facts — it never picks the winner, so the
  recap can't accidentally invent one.

## Deploying

Built for Vercel + a hosted Postgres provider (Neon, Supabase, etc.):

1. Provision a Postgres database and set `DATABASE_URL` in Vercel's env vars.
2. Set `AUTH_SECRET`, `AUTH_TRUST_HOST=true`, and optionally
   `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`.
3. Migrations run automatically on every deploy — the `vercel-build` script
   runs `prisma migrate deploy` before `next build`, so there's no separate
   manual migration step against the production database.
4. Seed the production database once. Two ways to do this:
   - **From a local terminal**, with `DATABASE_URL` pointed at prod:
     `COMMISSIONER_PASSWORD=... npx prisma db seed`.
   - **From anywhere, no terminal needed**: set `SETUP_TOKEN` (any random
     string) and `COMMISSIONER_PASSWORD` in Vercel's env vars, redeploy, then
     send one request:
     ```bash
     curl -X POST https://your-app.vercel.app/api/setup/bootstrap \
       -H "x-setup-token: <your SETUP_TOKEN>"
     ```
     This is `app/api/setup/bootstrap/route.ts` — it refuses to run if the
     database already has any users, so it's safe to leave in place; it can
     only ever seed an empty database once.
5. If you want the recap draft to auto-generate weekly, wire a Vercel Cron
   job to call a small authenticated route that runs
   `generateRecapDraft(weekId)` — this repo doesn't include that route yet
   since publishing still requires a commissioner's review either way.

## Known simplifications / follow-ups

- **Yahoo Fantasy API integration** is intentionally not built yet — see
  below.
- **PDF export** isn't built. `RecapSection`'s structured shape was chosen
  so a future exporter (`@react-pdf/renderer`, or headless-Chromium
  print-to-PDF of `/recaps/[weekId]`) can render section-by-section later.
- **iMessage delivery** was explicitly ruled out in favor of the in-app
  article — no messaging integration exists or is planned.
- Re-adding a previously-dropped player currently creates a new `Player`
  row rather than reusing the old one (no free-agent pool is tracked). Fine
  for a season where re-adds are rare; worth revisiting if not.
- The stat-line CSV importer requires players to already be on a team's
  active roster (via a prior ADD transaction) — it won't silently create
  players, by design, but that means transaction logging has to happen
  before that week's CSV import.
- The per-category weights used for Team of the Week / Manager of the Week /
  Choker of the Week (`lib/scoring/weeklyScore.ts`) are a reasonable default
  "points league" conversion, not yet league-configurable.
- **No admin UI for managing users yet.** Adding a manager, or setting/
  changing anyone's password, currently means editing `prisma/seed.ts` and
  re-running the seed — which wipes and rebuilds the whole league. An
  "add manager" / "reset password" admin page is the natural next addition
  before onboarding a real league.
- **No forgot-password flow.** If someone forgets their password, the
  commissioner has to reset it manually (currently: via the database) until
  the admin page above exists.

### Future: Yahoo Fantasy API integration

The schema was deliberately built so this is an additive change, not a
rewrite:

- `Team` and `Player` already carry `externalSource` (`MANUAL | CSV_IMPORT |
  YAHOO_SYNC | NHL_SYNC`) and `externalId`.
- `StatLine` carries `source` the same way.
- A Yahoo sync job would authenticate via OAuth2 against Yahoo's Fantasy
  Sports API, map Yahoo's league/team/player IDs into `externalId`, and
  write `StatLine`/`Matchup`/roster rows exactly like the CSV importer does
  today — just with `YAHOO_SYNC` as the source instead of `CSV_IMPORT`, and
  no commissioner CSV step in between.
- The one thing to decide before building it: whether Yahoo becomes the
  *only* data source going forward or runs alongside manual entry (NHL
  sync, CSV, manual) — the schema supports either.

**The OAuth2 client-side plumbing is scaffolded** (`lib/yahoo.ts`) so this
is ready to wire up the moment there's a registered Yahoo app to point it
at — but nothing in that file has ever made a real request. It's
deliberately just the protocol-level pieces that don't need a live
round-trip to get right:

- `yahooAuthorizeUrl` / `exchangeYahooCode` / `refreshYahooTokens` — the
  standard 3-legged OAuth2 authorization-code flow (RFC 6749) against
  Yahoo's own `api.login.yahoo.com` endpoints.
- `yahooFantasyFetch` — an authenticated raw-JSON GET against any Fantasy
  API resource path, for once there's a token to call it with.
- `isYahooConfigured()` — checks whether the three env vars below are set,
  for a future admin page to gate a "Connect Yahoo" button on.

**Deliberately not built yet**, because none of it can be gotten right
(or tested) without real credentials:

- An admin route pair to actually run the OAuth dance (`/authorize`
  redirect → `/callback` exchanging the code) and something to persist the
  resulting token pair — this league is commissioner-run, not per-user, so
  that's a new small schema model once it's worth adding.
- Any typed parser for what Yahoo's Fantasy API actually returns (roster
  shape, player stats shape). Yahoo's endpoints return XML by default —
  `format=json` gets JSON instead — but that JSON is a fairly literal
  conversion of the XML tree with a well-known reputation for awkward,
  deeply-nested, sometimes numeric-keyed arrays. Guessing at that blind
  would likely just be wrong; the NHL client only has typed parsers because
  this session had a live debug loop (paste real JSON back, fix the zod
  schema) to confirm shapes against — `yahooFantasyFetch` is the same
  starting point for Yahoo once real credentials make that loop possible.

**To pick this up**: register an app at
[developer.yahoo.com/apps](https://developer.yahoo.com/apps/) (Fantasy
Sports read permission; set its callback URL to match
`YAHOO_REDIRECT_URI`), then set `YAHOO_CLIENT_ID` / `YAHOO_CLIENT_SECRET` /
`YAHOO_REDIRECT_URI` (see `.env.example`).
