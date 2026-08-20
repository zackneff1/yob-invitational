import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../store/prisma';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// ── Players ────────────────────────────────────────────────────────────────

const PlayerUpdate = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  handicapIndex: z.number().min(-10).max(54).optional(),
  isAdmin: z.boolean().optional(),
});

adminRouter.put(
  '/players/:id',
  asyncHandler(async (req, res) => {
    const body = PlayerUpdate.parse(req.body);
    try {
      await prisma.player.update({
        where: { id: req.params.id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.email !== undefined && { email: body.email?.toLowerCase() ?? null }),
          ...(body.handicapIndex !== undefined && { handicapIndex: body.handicapIndex }),
          ...(body.isAdmin !== undefined && { isAdmin: body.isAdmin }),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new HttpError(404, 'Player not found');
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new HttpError(409, 'That email is already in use');
      }
      throw err;
    }
    res.json({ ok: true });
  }),
);

/** Reset a player's login so they can re-claim (forgot password, typo'd email). */
adminRouter.post(
  '/players/:id/reset-login',
  asyncHandler(async (req, res) => {
    try {
      await prisma.player.update({
        where: { id: req.params.id },
        data: { passwordHash: null },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new HttpError(404, 'Player not found');
      }
      throw err;
    }
    res.json({ ok: true });
  }),
);

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
        yards: z.number().int().min(30).max(800).optional(),
      }),
    )
    .optional(),
});

adminRouter.put(
  '/courses/:id',
  asyncHandler(async (req, res) => {
    const body = CourseUpdate.parse(req.body);
    const course = await prisma.course.findUnique({ where: { id: req.params.id } });
    if (!course) throw new HttpError(404, 'Course not found');
    const holeCount = (course.holes as unknown as unknown[]).length;
    if (body.holes && body.holes.length !== holeCount) {
      throw new HttpError(400, `Course has ${holeCount} holes`);
    }
    await prisma.course.update({
      where: { id: course.id },
      data: {
        ...(body.tee !== undefined && { tee: body.tee }),
        ...(body.par !== undefined && { par: body.par }),
        ...(body.rating !== undefined && { rating: body.rating }),
        ...(body.slope !== undefined && { slope: body.slope }),
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.holes !== undefined && {
          holes: body.holes as unknown as Prisma.InputJsonValue,
        }),
      },
    });
    res.json({ ok: true });
  }),
);

// ── Rounds ─────────────────────────────────────────────────────────────────

const RoundUpdate = z.object({
  allowance: z.number().min(0.5).max(1).optional(),
  teeTimes: z.array(z.string()).optional(),
});

adminRouter.put(
  '/rounds/:id',
  asyncHandler(async (req, res) => {
    const body = RoundUpdate.parse(req.body);
    try {
      await prisma.round.update({ where: { id: req.params.id }, data: body });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new HttpError(404, 'Round not found');
      }
      throw err;
    }
    res.json({ ok: true });
  }),
);

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

adminRouter.put(
  '/pairings',
  asyncHandler(async (req, res) => {
    const body = PairingsUpdate.parse(req.body);
    const round = await prisma.round.findUnique({ where: { id: body.roundId } });
    if (!round) throw new HttpError(404, 'Round not found');
    const created = await prisma.$transaction(async (tx) => {
      await tx.pairing.deleteMany({ where: { roundId: body.roundId } });
      await tx.pairing.createMany({
        data: body.pairings.map((p) => ({
          id: p.id ?? randomUUID(),
          roundId: body.roundId,
          name: p.name ?? '',
          playerIds: p.playerIds,
          teeTime: p.teeTime ?? null,
        })),
      });
      return tx.pairing.findMany({ where: { roundId: body.roundId } });
    });
    res.json({ ok: true, pairings: created });
  }),
);

/** Random draw: shuffle all 12 players into 6 teams, 2 teams per tee time. */
adminRouter.post(
  '/pairings/randomize',
  asyncHandler(async (req, res) => {
    const roundId = z.object({ roundId: z.string() }).parse(req.body).roundId;
    const round = await prisma.round.findUnique({ where: { id: roundId } });
    if (!round) throw new HttpError(404, 'Round not found');
    const players = await prisma.player.findMany();
    const shuffled = [...players].sort(() => Math.random() - 0.5);
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
    await prisma.$transaction([
      prisma.pairing.deleteMany({ where: { roundId } }),
      prisma.pairing.createMany({ data: pairings }),
    ]);
    res.json({ ok: true, pairings });
  }),
);

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

adminRouter.put(
  '/teams',
  asyncHandler(async (req, res) => {
    const body = TeamsUpdate.parse(req.body);
    await prisma.$transaction(
      body.teams.map((team) =>
        prisma.ryderTeam.update({
          where: { id: team.id },
          data: {
            name: team.name,
            color: team.color,
            captainId: team.captainId,
            playerIds: team.playerIds,
          },
        }),
      ),
    );
    res.json({ ok: true, teams: await prisma.ryderTeam.findMany({ orderBy: { id: 'asc' } }) });
  }),
);

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

adminRouter.put(
  '/matches',
  asyncHandler(async (req, res) => {
    const body = MatchesUpdate.parse(req.body);
    const round = await prisma.round.findUnique({ where: { id: body.roundId } });
    if (!round) throw new HttpError(404, 'Round not found');
    const existing = await prisma.match.findMany({ where: { roundId: body.roundId } });
    const created = await prisma.$transaction(async (tx) => {
      await tx.match.deleteMany({ where: { roundId: body.roundId } });
      await tx.match.createMany({
        data: body.matches.map((m) => ({
          id: m.id ?? randomUUID(),
          roundId: body.roundId,
          teeTime: m.teeTime ?? null,
          sideA: m.sideA,
          sideB: m.sideB,
          result: existing.find((e) => e.id === m.id)?.result ?? null,
        })),
      });
      return tx.match.findMany({ where: { roundId: body.roundId } });
    });
    res.json({ ok: true, matches: created });
  }),
);

const ResultUpdate = z.object({ result: z.enum(['A', 'B', 'HALVED']).nullable() });

adminRouter.put(
  '/matches/:id/result',
  asyncHandler(async (req, res) => {
    const body = ResultUpdate.parse(req.body);
    try {
      await prisma.match.update({ where: { id: req.params.id }, data: { result: body.result } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new HttpError(404, 'Match not found');
      }
      throw err;
    }
    res.json({ ok: true });
  }),
);
