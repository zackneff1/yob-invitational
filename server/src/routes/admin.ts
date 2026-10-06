import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { BUILD_ID } from '../build';
import { AuthedRequest, requireAdmin } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { buildSnapshot } from '../services/basis';
import { SCORING_POLICY_VERSION, toPercent, toTenths } from '../services/handicapMath';
import { TIE_SETTING_PREFIX } from '../services/leaderboard';
import { syncMatchClosures } from '../services/matchClosures';
import { loadDb } from '../store/loadDb';
import { prisma } from '../store/prisma';
import { resetAndReseed } from '../store/seed';
import { ScoringSnapshot } from '../types';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

/** Zod refinements for the precision the handicap maths accepts. */
const oneDecimal = (what: string) => (v: number) => {
  try {
    toTenths(v, what);
    return true;
  } catch {
    return false;
  }
};
const wholePercent = (v: number) => {
  try {
    toPercent(v);
    return true;
  } catch {
    return false;
  }
};

/** Lineups and draws cannot change once a round is final. */
async function assertRoundEditable(roundId: string) {
  const round = await prisma.round.findUnique({ where: { id: roundId } });
  if (!round) throw new HttpError(404, 'Round not found');
  if (round.status === 'final') {
    throw new HttpError(409, 'This round is final. Reopen it from Admin → rounds before changing its lineups.');
  }
  return round;
}

// ── Players ────────────────────────────────────────────────────────────────

const PlayerUpdate = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  handicapIndex: z
    .number()
    .min(-10)
    .max(54)
    .refine(oneDecimal('handicap index'), 'Handicap index must have one decimal place, e.g. 11.3')
    .optional(),
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
  rating: z
    .number()
    .min(25)
    .max(80)
    .refine(oneDecimal('course rating'), 'Course rating must have one decimal place, e.g. 72.3')
    .optional(),
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
  allowance: z
    .number()
    .min(0.5)
    .max(1)
    .refine(wholePercent, 'Allowance must be a whole percentage, e.g. 0.85')
    .optional(),
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

const RoundStatusUpdate = z.object({ status: z.enum(['upcoming', 'live', 'final']) });

/**
 * Start / end / reopen a round. Only one round is live at a time: starting one
 * marks any other live round final, so the "live round" everyone scores is
 * never ambiguous. Timestamps record when it happened.
 */
adminRouter.put(
  '/rounds/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = RoundStatusUpdate.parse(req.body);
    const round = await prisma.round.findUnique({ where: { id: req.params.id } });
    if (!round) throw new HttpError(404, 'Round not found');
    const now = new Date();

    // Starting a round freezes its scoring basis — once. Reopening a finished
    // round (final → live) keeps the snapshot it was played under. Putting a
    // round back to "upcoming" always drops the snapshot: "upcoming" means not
    // started, so a practice run can never freeze test lineups or stale
    // handicaps into the real round. Scores are kept and simply re-scored
    // against the fresh snapshot when the round is started again.
    let snapshot: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
    let snapshotNote: string | undefined;
    if (status === 'live' && round.scoringSnapshot == null) {
      const db = await loadDb();
      const full = db.rounds.find((r) => r.id === round.id)!;
      snapshot = buildSnapshot(db, full, now.getTime()) as unknown as Prisma.InputJsonValue;
      snapshotNote = 'scoring basis frozen';
    } else if (status === 'live') {
      snapshotNote = 'existing scoring basis kept';
    } else if (status === 'upcoming' && round.scoringSnapshot != null) {
      const scoreCount = await prisma.score.count({ where: { roundId: round.id } });
      snapshot = Prisma.DbNull;
      snapshotNote =
        scoreCount === 0
          ? 'scoring basis cleared'
          : `scoring basis cleared; ${scoreCount} recorded scores kept and will be re-scored on the next start`;
    }

    await prisma.$transaction(async (tx) => {
      if (status === 'live') {
        await tx.round.updateMany({
          where: { status: 'live', NOT: { id: round.id } },
          data: { status: 'final', endedAt: now },
        });
      }
      await tx.round.update({
        where: { id: round.id },
        data: {
          status,
          ...(status === 'live' && { startedAt: round.startedAt ?? now, endedAt: null }),
          ...(status === 'final' && { startedAt: round.startedAt ?? now, endedAt: now }),
          ...(status === 'upcoming' && { startedAt: null, endedAt: null }),
          ...(snapshot !== undefined && { scoringSnapshot: snapshot }),
        },
      });
    });
    res.json({
      ok: true,
      snapshot: snapshotNote,
      rounds: (await prisma.round.findMany({ orderBy: { id: 'asc' } })).map(
        ({ scoringSnapshot, ...r }) => ({ ...r, frozen: scoringSnapshot != null }),
      ),
    });
  }),
);

const TieResolutionBody = z.object({
  /** null clears a previous resolution */
  pairingId: z.string().nullable(),
  reason: z.string().max(500).optional().default(''),
});

/**
 * Record how a tie for first in the qualifier was resolved (and by whom, and
 * why). The app does not pick a tie-break itself — see audit — it only shows
 * the tie and lets an admin record the organizers' decision.
 */
adminRouter.put(
  '/rounds/:id/tie-resolution',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = TieResolutionBody.parse(req.body);
    const round = await prisma.round.findUnique({ where: { id: req.params.id } });
    if (!round) throw new HttpError(404, 'Round not found');
    const key = `${TIE_SETTING_PREFIX}${round.id}`;
    if (body.pairingId == null) {
      await prisma.setting.deleteMany({ where: { key } });
      res.json({ ok: true, resolution: null });
      return;
    }
    const pairing = await prisma.pairing.findFirst({ where: { id: body.pairingId, roundId: round.id } });
    if (!pairing) throw new HttpError(404, 'Pairing not found in this round');
    if (!body.reason.trim()) throw new HttpError(400, 'A reason is required so the decision is on record');
    const resolution = { pairingId: pairing.id, reason: body.reason.trim(), by: req.user!.id, at: Date.now() };
    const value = JSON.stringify(resolution);
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    res.json({ ok: true, resolution });
  }),
);

// ── Read-only export for verifying the live configuration ──────────────────

/**
 * Everything needed to compare the live configuration with the approved
 * source (seed or printed cards), field by field: courses with every hole,
 * rounds with status and frozen-basis info, player indexes, lineups and
 * score counts. No emails, no password state beyond "claimed", no settings
 * (which hold the lodging codes), no individual scores — this is a
 * configuration export, not a score backup.
 */
adminRouter.get(
  '/export',
  asyncHandler(async (_req, res) => {
    const db = await loadDb();
    const scoreCounts = new Map<string, { scores: number; pickups: number; lastUpdatedAt: number | null }>();
    for (const s of db.scores) {
      const c = scoreCounts.get(s.roundId) ?? { scores: 0, pickups: 0, lastUpdatedAt: null };
      c.scores += 1;
      if (s.pickup) c.pickups += 1;
      c.lastUpdatedAt = Math.max(c.lastUpdatedAt ?? 0, s.updatedAt);
      scoreCounts.set(s.roundId, c);
    }
    res.json({
      exportedAt: new Date().toISOString(),
      build: BUILD_ID,
      policyVersion: SCORING_POLICY_VERSION,
      kind: 'configuration export (not a score backup)',
      courses: db.courses,
      rounds: db.rounds.map((r) => {
        const snap: ScoringSnapshot | null = r.scoringSnapshot;
        return {
          id: r.id,
          name: r.name,
          courseId: r.courseId,
          date: r.date,
          teeTimes: r.teeTimes,
          format: r.format,
          allowance: r.allowance,
          matchCount: r.matchCount,
          status: r.status,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          scoring: scoreCounts.get(r.id) ?? { scores: 0, pickups: 0, lastUpdatedAt: null },
          frozen: snap != null,
          snapshot: snap
            ? {
                capturedAt: snap.capturedAt,
                policyVersion: snap.policyVersion,
                allowance: snap.allowance,
                course: snap.course,
                players: snap.players,
                matches: snap.matches,
                pairings: snap.pairings,
                lineupHistory: snap.lineupHistory ?? [],
              }
            : null,
        };
      }),
      players: db.users.map((p) => ({
        id: p.id,
        name: p.name,
        handicapIndex: p.handicapIndex,
        isAdmin: p.isAdmin,
        claimed: p.passwordHash != null,
      })),
      pairings: db.pairings,
      ryderTeams: db.ryderTeams,
      matches: db.matches.map((m) => ({
        id: m.id,
        roundId: m.roundId,
        teeTime: m.teeTime,
        sideA: m.sideA,
        sideB: m.sideB,
        result: m.result,
        closedAt: m.closedAt,
        resultKey: m.resultKey,
      })),
    });
  }),
);

// ── Settings (lodging door codes etc.) ─────────────────────────────────────

const SettingsUpdate = z.object({
  settings: z.record(z.string().min(1).max(64), z.string().max(2000)),
});

/** Upsert key/value settings; an empty value deletes the key. */
adminRouter.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const { settings } = SettingsUpdate.parse(req.body);
    await prisma.$transaction(
      Object.entries(settings).map(([key, value]) =>
        value.trim() === ''
          ? prisma.setting.deleteMany({ where: { key } })
          : prisma.setting.upsert({
              where: { key },
              update: { value: value.trim() },
              create: { key, value: value.trim() },
            }),
      ),
    );
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
    await assertRoundEditable(body.roundId);
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
    const round = await assertRoundEditable(roundId);
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
    const round = await assertRoundEditable(body.roundId);
    const existing = await prisma.match.findMany({ where: { roundId: body.roundId } });
    const created = await prisma.$transaction(async (tx) => {
      await tx.match.deleteMany({ where: { roundId: body.roundId } });
      const rows = body.matches.map((m) => ({
        id: m.id ?? randomUUID(),
        roundId: body.roundId,
        teeTime: m.teeTime ?? null,
        sideA: m.sideA,
        sideB: m.sideB,
        result: existing.find((e) => e.id === m.id)?.result ?? null,
        closedAt: existing.find((e) => e.id === m.id)?.closedAt ?? null,
        resultKey: existing.find((e) => e.id === m.id)?.resultKey ?? null,
      }));
      await tx.match.createMany({ data: rows });
      // A live round is frozen: lineup edits after the start are allowed (a
      // captain swaps a player) but go on the record inside the snapshot.
      if (round.status === 'live' && round.scoringSnapshot != null) {
        const snap = round.scoringSnapshot as unknown as ScoringSnapshot;
        const history = [
          ...(snap.lineupHistory ?? []),
          {
            at: Date.now(),
            by: (req as AuthedRequest).user!.id,
            matches: rows.map((m) => ({ id: m.id, sideA: m.sideA, sideB: m.sideB })),
          },
        ];
        await tx.round.update({
          where: { id: round.id },
          data: { scoringSnapshot: { ...snap, lineupHistory: history } as unknown as Prisma.InputJsonValue },
        });
      }
      return tx.match.findMany({ where: { roundId: body.roundId } });
    });
    res.json({ ok: true, matches: created });
  }),
);

// ── Danger zone ────────────────────────────────────────────────────────────

export const RESET_PHRASE = 'RESET AND RESEED';

const ResetSchema = z.object({
  confirm: z.string(),
  preserveLogins: z.boolean().optional().default(true),
});

/**
 * Wipe the whole database and reload the seed data (players, courses,
 * rounds, empty teams). Nuclear by design — requires typing the exact
 * confirmation phrase. preserveLogins (default) carries every claimed
 * email + password across so nobody has to re-register.
 */
adminRouter.post(
  '/reset-database',
  asyncHandler(async (req, res) => {
    const body = ResetSchema.parse(req.body ?? {});
    if (body.confirm !== RESET_PHRASE) {
      throw new HttpError(400, `Confirmation phrase must be exactly "${RESET_PHRASE}"`);
    }
    const { restoredLogins } = await resetAndReseed(body.preserveLogins);
    res.json({ ok: true, restoredLogins });
  }),
);

const ResultUpdate = z.object({ result: z.enum(['A', 'B', 'HALVED']).nullable() });

adminRouter.put(
  '/matches/:id/result',
  asyncHandler(async (req, res) => {
    const body = ResultUpdate.parse(req.body);
    let roundId: string;
    try {
      const updated = await prisma.match.update({
        where: { id: req.params.id },
        data: { result: body.result },
      });
      roundId = updated.roundId;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new HttpError(404, 'Match not found');
      }
      throw err;
    }
    // An override closes the match (or clearing one may re-open it).
    await syncMatchClosures([roundId]);
    res.json({ ok: true });
  }),
);
