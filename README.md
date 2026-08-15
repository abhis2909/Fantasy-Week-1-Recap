# Slapshot City Fantasy Hockey League

A commissioner-run website for a Yahoo fantasy hockey league: standings, a
category-by-category stats breakdown, a weekly "Team of the Week" picked by
statistical z-score, transaction tracking with 1–10 peer ratings, and a
"hostile yet friendly" AI-narrated weekly recap newsletter.

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
| Team of the Week (per-position z-score, player cards w/ rating + stats) | `/team-of-the-week`, `lib/team-of-week.ts` |
| Transactions + 1–10 peer ratings | `/transactions`, `lib/transactions.ts` |
| Weekly recap newsletter | `/recaps`, `lib/recap/*` |
| Commissioner data entry | `/admin/*` |
| NHL player photos + auto-stat sync | `/admin/nhl-sync`, `lib/nhl.ts` |
| Player cards: season totals, last 10 games, 0–100 rating | `/players`, `lib/playerRating.ts` |

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

Goalie stats (Wins/GAA/SV%/Shutouts) are unaffected by any of this — those
come entirely from the game-log endpoint's own fields
(`mapGoalieGameEntry`), no boxscore needed.

**If a server action button gives an error right after a new deploy**: this
is almost always a stale page — Next.js embeds a hashed ID for each server
action, and a browser tab left open from before a deploy is holding IDs
that no longer exist on the (now-redeployed) server. Hard-refresh the page
and try again before assuming it's a real bug.

## Player pages & the 0–100 rating (`/players`)

The directory (`/players`) has a type-ahead search box
(`components/players/PlayerSearchBar.tsx`) — filters the roster client-side
as you type (name or team), shows a dropdown of up to 8 matches, and
jumps straight to a player's page on click or Enter. No API round trip;
the roster's small enough to filter in the browser.

Every rostered player has a card (`components/totw/PlayerCard.tsx`) and a
detail page (`/players/[playerId]`) showing:

- **Season totals** per scoring category, summed from synced
  `PlayerGameLog` rows (`lib/playerRating.ts`'s `seasonTotalsForPlayer` —
  rate stats like GAA/SV% are averaged across games, not summed).
- **Last 10 games**, each with a short stat line and a **0–100 rating**.

The rating is the same z-score method used for Team of the Week
(`lib/playerRating.ts`'s `ratingFromZ`: `z = 0` → 50, roughly ±1 standard
deviation → ±15 points, clamped to 0–100), just applied per game instead of
per fantasy week. For each of a player's games, `rateGamesForPlayer` builds
a peer pool of every other currently-rostered player at the same position
whose game fell in the same Monday-anchored calendar week, then scores that
game's composite value against that pool. Games with fewer than 3 peers to
compare against fall back to a coarse 40/50/60 (below/at/above a flat
threshold) rather than a fabricated precise z-score — shown as "low sample"
on the page. Team of the Week picks use the exact same `ratingFromZ` scale
(`TeamOfWeekSelection.rating`), so a "72/100" means the same thing whether
it's one game or a weekly pick.

Requires the "Sync full season game logs" admin action above to have run at
least once; until then, player pages show "no synced games yet."

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
- **Team of the Week** (`lib/team-of-week.ts`) ranks players by z-score
  *within their position's pool of rostered players that week*, falling
  back to raw score when the pool is too small (<3) or has zero variance.
- **Recap detectors** (`lib/recap/detectors.ts`) are pure functions that
  decide *who* wins each section (Manager of the Week is a weighted
  composite of category win rate, optimal-lineup%, and transaction quality;
  Choker of the Week finds the largest bench-vs-started z-score gap at the
  same position; Comeback of the Week compares this week's result to
  rolling season form, and is correctly empty in Week 1). Claude (or the
  template fallback) only narrates these pre-decided facts — it never picks
  the winner, so the recap can't accidentally invent one.

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
  YAHOO_SYNC`) and `externalId`.
- `StatLine` carries `source` the same way.
- A Yahoo sync job would authenticate via OAuth2 against Yahoo's Fantasy
  Sports API, map Yahoo's league/team/player IDs into `externalId`, and
  write `StatLine`/`Matchup`/roster rows exactly like the CSV importer does
  today — just with `YAHOO_SYNC` as the source instead of `CSV_IMPORT`, and
  no commissioner CSV step in between.
- The one thing to decide before building it: whether Yahoo becomes the
  *only* data source going forward or runs alongside manual entry — the
  schema supports either.
