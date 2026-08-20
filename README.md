# ⛳ Yob Invitational 2026

Trip app for the annual 12-man Ryder Cup–style golf trip. 2026 edition: **St. George, Utah, Oct 10–12**.

- **Sat 10/10 — Conestoga** (1:20/1:30/1:40): random-draw two-man best ball, net stroke play at 85% handicap. Winning team become the captains; live draft after the round.
- **Sun 10/11 AM — Coral Canyon** (7:50/8:00/8:10): four-ball match play, 3 matches.
- **Sun 10/11 PM — The Ledges** (2:00/2:10/2:20): two-man aggregate Stableford, 3 matches.
- **Mon 10/12 AM — Sand Hollow Links, 9 holes** (9:00/9:10/9:20): two-man scramble, 3 matches.
- **Mon 10/12 PM — Sand Hollow Championship** (12:46/12:56/1:06): singles, 6 matches.

15 points total, first to **8** wins the Cup.

## What the app does

- **Simple auth** — each player claims their pre-seeded profile once (name + invite code + email + password), then signs in normally. Neffy and Aaron are admins.
- **Live leaderboards** — Round 1 qualifier board (team net vs par, thru N), live match status for every Ryder Cup match ("Team Neffy 2 UP thru 7", "wins 3&2"), and the overall Cup board with final + projected points. Polls every 15s.
- **Hole-by-hole score entry** — anyone can enter scores for their group; gross strokes only, all handicap math is automatic.
- **Automatic scoring** — WHS course handicaps (index × slope/113 + rating − par, half index for the 9-hole course), per-round allowances (85% qualifier, 90% four-ball, 95% Stableford, full singles), strokes allocated by stroke index, play-off-the-low-man in match play formats, scramble team handicap = 35% low + 15% high.
- **Offline-first** — scores save to the phone instantly (localStorage queue) and sync whenever signal returns; last-write-wins by timestamp so a stale offline replay never clobbers a newer edit. Leaderboards render from a persisted cache, and a service worker keeps the app shell loadable with no signal.
- **Admin tools** — edit handicaps, run the Round 1 random draw (or hand-edit pairings), set the drafted teams + captains, set match lineups per round, override match results, reset a player's login, and fix course data.

> **Before the trip:** the seeded scorecards (par, stroke index, rating, slope, tees) are **placeholders**. Update them from the real scorecards in **Admin → Courses**, and refresh handicap indexes in **Admin → Players**.

## Stack

npm-workspaces monorepo, deployed to Render as a web service + managed Postgres:

```
/client   React 18 + TypeScript + Vite · React Router · TanStack Query (persisted)
/server   Express + TypeScript · helmet · compression · pino · zod config · JWT auth
          Prisma + PostgreSQL · serves /api/* and the built client (SPA fallback)
```

The schema lives in `server/prisma/schema.prisma` with versioned migrations in `server/prisma/migrations/`. On boot the server applies pending migrations (`prisma migrate deploy` in the start script) and seeds an empty database with the 2026 trip. Read-side scoring stays in pure functions over a full snapshot (`server/src/store/loadDb.ts`) — the whole event is a few thousand rows — while every write goes through Prisma transactions.

## Local development

You need a local Postgres. Either use one you already run, or:

```bash
docker compose up -d        # Postgres 16 on :5432 (user/pass/db from docker-compose.yml)
```

Then:

```bash
npm install                                   # also generates the Prisma client
cp server/.env.example server/.env            # set DATABASE_URL for your Postgres
npm run db:deploy -w server                   # create the tables (one time)
npm run dev                                   # server :3001, client :5173 (proxies /api)
```

Open http://localhost:5173, claim a profile (invite code defaults to `yob2026`), and go. The database seeds itself with the 12 players/courses/rounds on first boot.

Other scripts: `npm run build`, `npm start`, `npm run typecheck`, `npm run lint`, and in `server/`: `db:migrate` (create a new migration after schema changes), `db:studio` (browse the DB).

## Deploying to Render

The `render.yaml` blueprint defines both pieces: a **Postgres database** (`yob-db`, basic-256mb — daily backups included) and a **Node 20 web service** wired to it via `DATABASE_URL`, with health check at `/api/health` and a generated `JWT_SECRET`. Migrations run automatically on every deploy before the server starts.

1. Push to GitHub (already wired to this repo).
2. In the [Render dashboard](https://dashboard.render.com): **New → Blueprint**, pick the `yob-invitational` repo, and click **Apply**. Render creates the database and the service together.
3. Wait for the first deploy to go green (health check `/api/health`).
4. Open the service URL, claim the Neffy profile, and set things up in Admin.

Notes:

- `PORT` is injected by Render; the server reads it from the environment. Don't set it manually.
- Change `INVITE_CODE` in the service's environment settings if you want something other than `yob2026`.
- Redeploys are automatic on push to `main`. Data lives in Postgres, so deploys/restarts never touch it.
- If you ever change the schema: edit `schema.prisma`, run `npm run db:migrate -w server` locally (creates + applies a migration), commit the migration folder, push — Render applies it on deploy.

## API sketch

```
GET  /api/health                      liveness
POST /api/auth/claim|login            claim profile / sign in → JWT
GET  /api/auth/me                     current player
GET  /api/trip                        players, courses, rounds (+ per-round handicaps), pairings, teams, matches
GET  /api/scores?roundId=…            raw hole scores for a round
POST /api/scores/batch                idempotent upsert (offline queue replays through here)
GET  /api/leaderboard/round/:id       qualifier board or computed matches
GET  /api/leaderboard/ryder           Cup totals + all matches
PUT  /api/admin/…                     players, courses, rounds, pairings (+ randomize), teams, matches, results
```
