# Yob Invitational — Working on this app with Aaron

**If you are Claude reading this:** you're helping **Aaron Klein** make changes to the Yob Invitational trip app. Aaron is not an engineer — he's a co-organizer of the golf trip and one of the app's two admins. That means:

- Explain everything in plain English. No jargon, no assuming he knows what a PR or a build is (explain in one short sentence when it comes up).
- Handle the full change end-to-end yourself: edit the code, verify it, and open a pull request. Never ask Aaron to run terminal commands.
- **Always work on a branch and open a pull request. Never push directly to `main`** — every merge to `main` deploys straight to the live site on Render.
- Before opening the PR, run `npm install --include=dev && npm run build` and make sure it passes. A CI check runs the same build on every PR; tell Aaron to merge only when the check is green.
- Keep PRs small and describe them in plain English so Zack (the other admin) can skim them.

## What this app is

A trip app for the 2026 Yob Invitational — a 12-man Ryder Cup–style golf weekend in St. George, Utah, Oct 10–12. Players log hole-by-hole scores from their phones (works offline), and the app computes handicapped scoring for every format: a Round 1 best-ball qualifier that decides the captains, then four-ball, Stableford, scramble, and singles matches worth 15 total points. Admins (Zack "Neffy" Neff and Aaron) manage pairings, the draft, match lineups, and can fix scores.

## The one thing to get right: code vs. data

**Most "changes" Aaron wants are probably data, not code.** Handicaps, pairings, teams, match lineups, course ratings/slopes/stroke indexes, and score corrections are all edited **inside the app** — sign in as an admin and use the **Admin** tab. The production database lives on Render; editing `server/src/store/seed.ts` will NOT change the live site (seed data only populates a brand-new empty database).

Code changes are for things like: wording/text, colors and styling, layout tweaks, new pages or features, changes to scoring rules or formats.

If Aaron asks for something that's really a data change, point him to the right Admin tab instead of editing code.

## How the code is organized

- **Monorepo**: `/client` (the web app people see) and `/server` (the API + database).
- Client, React + TypeScript: pages live in `client/src/pages/` — `Overview.tsx` (trip page), `Matches.tsx` (round leaderboards), `Ryder.tsx` (cup standings), `ScoreEntry.tsx`, `Admin.tsx`, `Login.tsx`. Styling is one file: `client/src/styles.css`. Layout/nav: `client/src/components/Layout.tsx`.
- Server, Express + TypeScript + Prisma/Postgres: routes in `server/src/routes/`, all scoring math in `server/src/services/scoring.ts` and `leaderboard.ts` (pure functions — the heart of the app, change carefully and only when Aaron explicitly wants a rules change).
- Trip content that IS in code: round names, format descriptions, and tee times shown on the Overview page come from the database (seeded from `server/src/store/seed.ts`); the page itself renders whatever the database has.

## Guardrails

1. **Never push to `main`** — branch + pull request, always. Merging deploys to production.
2. **Don't touch `server/prisma/migrations/`** (existing migration files are history — editing them breaks deploys). Database schema changes are a Zack-level task; if a feature needs a new table or column, open the PR with everything else done and flag clearly in the PR description that Zack needs to add the migration.
3. **Never commit secrets** — no `.env` files, passwords, or API keys.
4. **Don't change the score-sync API** (`POST /api/scores/batch` and its fields) without flagging it — phones with the old app version queue scores offline and replay them against the new server.
5. If a request is ambiguous or risky (changing scoring rules, deleting things), make the safest interpretation and say clearly in the PR what you assumed.

## After the PR is merged

Render redeploys automatically in a few minutes. Aaron can check the live site afterward. If something looks wrong on the live site, the fastest fix is telling Zack — he can roll back the deploy from the Render dashboard.
