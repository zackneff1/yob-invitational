# Yob Invitational — Working on this app with Aaron

**If you are Claude reading this:** you're helping **Aaron Klein** make changes to the Yob Invitational trip app. Aaron is not an engineer — he's a co-organizer of the golf trip and one of the app's two admins. That means:

- Explain everything in plain English. No jargon, no assuming he knows what a build or a commit is (explain in one short sentence when it comes up).
- Handle the full change end-to-end yourself: edit the code, verify it, commit, and push. Never ask Aaron to run terminal commands.
- **You may push directly to `main`** — Zack has okayed this. But `main` deploys straight to the live site on Render, so the deal is strict: **nothing gets pushed until every check below passes.**
- **Required before every push, no exceptions:**
  1. `npm install --include=dev` (fresh dependencies, generates the Prisma client)
  2. `npm run build` — must finish with zero errors. This type-checks and compiles both the client and the server; it is the same check CI runs.
  3. If tests exist by the time you're reading this (`npm test` or a `test` script in any package.json), run them too and they must pass.
  4. If anything fails, fix it and re-run. If you can't get it green, stop and tell Aaron to ask Zack — do not push a red build, ever.
- After pushing, the CI check on GitHub runs the same build. If it comes back red, treat it as an emergency: fix forward immediately or tell Aaron to ping Zack so he can roll back the deploy.
- Keep each push small and focused, with a plain-English commit message so Zack can skim the history.

## What this app is

A trip app for the 2026 Yob Invitational — a 12-man Ryder Cup–style golf weekend in St. George, Utah, Oct 10–12. Players log hole-by-hole scores from their phones (works offline), and the app computes handicapped scoring for every format: a Round 1 best-ball qualifier that decides the captains, then four-ball, Stableford, scramble, and singles matches worth 15 total points. Admins (Zack "Neffy" Neff and Aaron) manage pairings, the draft, match lineups, and can fix scores.

## The one thing to get right: code vs. data

**Most "changes" Aaron wants are probably data, not code.** Handicaps, pairings, teams, match lineups, course ratings/slopes/stroke indexes, and score corrections are all edited **inside the app** — sign in as an admin and use the **Admin** tab. The production database lives on Render; editing `server/src/store/seed.ts` will NOT change the live site (seed data only populates a brand-new empty database).

Code changes are for things like: wording/text, colors and styling, layout tweaks, new pages or features, changes to scoring rules or formats.

If Aaron asks for something that's really a data change, point him to the right Admin tab instead of editing code.

**The exception — mass resets:** if the *seeded* trip data itself changes (new scorecards in `server/src/store/courses2026.ts`, changed rounds or players in `seed.ts`) and Aaron wants the live site to match it wholesale, use **Admin → reset**: it wipes everything (including all scores and teams) and reloads the seed data, keeping everyone's logins by default. It's behind a typed confirmation phrase because it is destructive — make sure Aaron understands scores and teams are erased before he uses it.

## How the code is organized

- **Monorepo**: `/client` (the web app people see) and `/server` (the API + database).
- Client, React + TypeScript: pages live in `client/src/pages/` — `Overview.tsx` (trip page), `Matches.tsx` (round leaderboards), `Ryder.tsx` (cup standings), `ScoreEntry.tsx`, `Admin.tsx`, `Login.tsx`. Styling is one file: `client/src/styles.css`. Layout/nav: `client/src/components/Layout.tsx`.
- Server, Express + TypeScript + Prisma/Postgres: routes in `server/src/routes/`, all scoring math in `server/src/services/scoring.ts` and `leaderboard.ts` (pure functions — the heart of the app, change carefully and only when Aaron explicitly wants a rules change).
- Trip content that IS in code: round names, format descriptions, and tee times shown on the Overview page come from the database (seeded from `server/src/store/seed.ts`); the page itself renders whatever the database has.

## Guardrails

1. **Green build before every push** — see the required checklist at the top. Pushing to `main` deploys to production; a broken push takes the app down for the whole group.
2. **Don't touch `server/prisma/migrations/`** (existing migration files are history — editing them breaks deploys). Database schema changes are a Zack-level task; if a feature needs a new table or column, stop and have Aaron ask Zack rather than pushing a schema change.
3. **Never commit secrets** — no `.env` files, passwords, or API keys.
4. **Don't change the score-sync API** (`POST /api/scores/batch` and its fields) — phones with the old app version queue scores offline and replay them against the new server. If a feature seems to require it, check with Zack first.
5. **Never force-push, and never rewrite history on `main`.** If you hit a push conflict because Zack pushed something, pull his changes, merge cleanly, re-run the build, then push.
6. If a request is ambiguous or risky (changing scoring rules, deleting things), make the safest interpretation and tell Aaron clearly what you assumed before pushing.

## After a push

Render redeploys automatically in a few minutes. Have Aaron check the live site afterward to confirm his change looks right. If something looks wrong, the fastest fix is telling Zack — he can roll back the deploy from the Render dashboard.
