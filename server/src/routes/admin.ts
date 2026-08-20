import { randomUUID } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { getDb, saveDb } from '../store/db';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// ── Players ────────────────────────────────────────────────────────────────

const PlayerUpdate = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  handicapIndex: z.number().min(-10).max(54).optional(),
  isAdmin: z.boolean().optional(),
});

adminRouter.put('/players/:id', (req, res) => {
  const body = PlayerUpdate.parse(req.body);
  const db = getDb();
  const player = db.users.find((p) => p.id === req.params.id);
  if (!player) throw new HttpError(404, 'Player not found');
  if (body.name !== undefined) player.name = body.name;
  if (body.email !== undefined) player.email = body.email?.toLowerCase() ?? null;
  if (body.handicapIndex !== undefined) player.handicapIndex = body.handicapIndex;
  if (body.isAdmin !== undefined) player.isAdmin = body.isAdmin;
  saveDb();
  res.json({ ok: true });
});

/** Reset a player's login so they can re-claim (forgot password, typo'd email). */
adminRouter.post('/players/:id/reset-login', (req, res) => {
  const db = getDb();
  const player = db.users.find((p) => p.id === req.params.id);
  if (!player) throw new HttpError(404, 'Player not found');
  player.passwordHash = null;
  saveDb();
  res.json({ ok: true });
});

// ── Courses ────────────────────────────────────────────────────────────────

const CourseUpdate = z.object({
  tee: z.string().optional(),
  par: z.number().int().min(27).max(74).optional(),
  rating: z.number().min(25).max(80).optional(),
  slope: z.number().int().min(55).max(155).optional(),
  notes: z.string().optional(),
  holes: z
    .array(
      z.object({
        number: z.number().int().min(1).max(18),
        par: z.number().int().min(3).max(6),
        strokeIndex: z.number().int().min(1).max(18),
      }),
    )
    .optional(),
});

adminRouter.put('/courses/:id', (req, res) => {
  const body = CourseUpdate.parse(req.body);
  const db = getDb();
  const course = db.courses.find((c) => c.id === req.params.id);
  if (!course) throw new HttpError(404, 'Course not found');
  if (body.holes && body.holes.length !== course.holes.length) {
    throw new HttpError(400, `Course has ${course.holes.length} holes`);
  }
  Object.assign(course, body);
  saveDb();
  res.json({ ok: true });
});

// ── Rounds ─────────────────────────────────────────────────────────────────

const RoundUpdate = z.object({
  allowance: z.number().min(0.5).max(1).optional(),
  teeTimes: z.array(z.string()).optional(),
});

adminRouter.put('/rounds/:id', (req, res) => {
  const body = RoundUpdate.parse(req.body);
  const db = getDb();
  const round = db.rounds.find((r) => r.id === req.params.id);
  if (!round) throw new HttpError(404, 'Round not found');
  Object.assign(round, body);
  saveDb();
  res.json({ ok: true });
});

// ── Round 1 pairings ───────────────────────────────────────────────────────

const PairingsUpdate = z.object({
  roundId: z.string(),
  pairings: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().optional().default(''),
      playerIds: z.array(z.string()).max(2),
      teeTime: z.string().nullable().optional().default(null),
    }),
  ),
});

adminRouter.put('/pairings', (req, res) => {
  const body = PairingsUpdate.parse(req.body);
  const db = getDb();
  if (!db.rounds.some((r) => r.id === body.roundId)) throw new HttpError(404, 'Round not found');
  db.pairings = [
    ...db.pairings.filter((p) => p.roundId !== body.roundId),
    ...body.pairings.map((p) => ({
      id: p.id ?? randomUUID(),
      roundId: body.roundId,
      name: p.name ?? '',
      playerIds: p.playerIds,
      teeTime: p.teeTime ?? null,
    })),
  ];
  saveDb();
  res.json({ ok: true, pairings: db.pairings.filter((p) => p.roundId === body.roundId) });
});

/** Random draw: shuffle all 12 players into 6 teams, 2 teams per tee time. */
adminRouter.post('/pairings/randomize', (req, res) => {
  const roundId = z.object({ roundId: z.string() }).parse(req.body).roundId;
  const db = getDb();
  const round = db.rounds.find((r) => r.id === roundId);
  if (!round) throw new HttpError(404, 'Round not found');
  const shuffled = [...db.users].sort(() => Math.random() - 0.5);
  const pairings = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const pair = shuffled.slice(i, i + 2);
    pairings.push({
      id: randomUUID(),
      roundId,
      name: pair.map((p) => p.name).join(' / '),
      playerIds: pair.map((p) => p.id),
      teeTime: round.teeTimes[Math.floor(i / 4) % round.teeTimes.length] ?? null,
    });
  }
  db.pairings = [...db.pairings.filter((p) => p.roundId !== roundId), ...pairings];
  saveDb();
  res.json({ ok: true, pairings });
});

// ── Ryder Cup teams (post-draft) ───────────────────────────────────────────

const TeamsUpdate = z.object({
  teams: z.array(
    z.object({
      id: z.enum(['A', 'B']),
      name: z.string().min(1),
      color: z.string(),
      captainId: z.string().nullable(),
      playerIds: z.array(z.string()),
    }),
  ),
});

adminRouter.put('/teams', (req, res) => {
  const body = TeamsUpdate.parse(req.body);
  const db = getDb();
  for (const team of body.teams) {
    const existing = db.ryderTeams.find((t) => t.id === team.id);
    if (existing) Object.assign(existing, team);
  }
  saveDb();
  res.json({ ok: true, teams: db.ryderTeams });
});

// ── Matches ────────────────────────────────────────────────────────────────

const MatchesUpdate = z.object({
  roundId: z.string(),
  matches: z.array(
    z.object({
      id: z.string().optional(),
      sideA: z.array(z.string()),
      sideB: z.array(z.string()),
      teeTime: z.string().nullable().optional().default(null),
    }),
  ),
});

adminRouter.put('/matches', (req, res) => {
  const body = MatchesUpdate.parse(req.body);
  const db = getDb();
  if (!db.rounds.some((r) => r.id === body.roundId)) throw new HttpError(404, 'Round not found');
  const existing = db.matches.filter((m) => m.roundId === body.roundId);
  db.matches = [
    ...db.matches.filter((m) => m.roundId !== body.roundId),
    ...body.matches.map((m) => ({
      id: m.id ?? randomUUID(),
      roundId: body.roundId,
      teeTime: m.teeTime ?? null,
      sideA: m.sideA,
      sideB: m.sideB,
      result: existing.find((e) => e.id === m.id)?.result ?? null,
    })),
  ];
  saveDb();
  res.json({ ok: true, matches: db.matches.filter((m) => m.roundId === body.roundId) });
});

const ResultUpdate = z.object({ result: z.enum(['A', 'B', 'HALVED']).nullable() });

adminRouter.put('/matches/:id/result', (req, res) => {
  const body = ResultUpdate.parse(req.body);
  const db = getDb();
  const match = db.matches.find((m) => m.id === req.params.id);
  if (!match) throw new HttpError(404, 'Match not found');
  match.result = body.result;
  saveDb();
  res.json({ ok: true });
});
