import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { syncMatchClosures } from '../services/matchClosures';
import { prisma } from '../store/prisma';

export const scoresRouter = Router();

scoresRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const roundId = String(req.query.roundId ?? '');
    if (!roundId) throw new HttpError(400, 'roundId is required');
    const scores = await prisma.score.findMany({ where: { roundId } });
    res.json(scores.map((s) => ({ ...s, updatedAt: s.updatedAt.getTime() })));
  }),
);

const ScoreEntry = z.object({
  roundId: z.string(),
  entityType: z.enum(['player', 'side']),
  entityId: z.string(),
  hole: z.number().int().min(1).max(18),
  /** null clears a previously entered score */
  strokes: z.number().int().min(1).max(20).nullable(),
  updatedAt: z.number(),
});

const BatchSchema = z.object({ scores: z.array(ScoreEntry).min(1).max(500) });

/**
 * Idempotent batch upsert — the offline queue on the client replays through
 * here. Last write wins by updatedAt, so a stale offline entry never
 * clobbers a newer edit made from another phone.
 */
scoresRouter.post(
  '/batch',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = BatchSchema.parse(req.body);
    const roundIds = new Set(
      (await prisma.round.findMany({ select: { id: true } })).map((r) => r.id),
    );
    let applied = 0;
    await prisma.$transaction(async (tx) => {
      for (const entry of body.scores) {
        if (!roundIds.has(entry.roundId)) continue;
        const key = {
          roundId: entry.roundId,
          entityType: entry.entityType,
          entityId: entry.entityId,
          hole: entry.hole,
        };
        const updatedAt = new Date(entry.updatedAt);
        if (entry.strokes == null) {
          const deleted = await tx.score.deleteMany({
            where: { ...key, updatedAt: { lte: updatedAt } },
          });
          applied += deleted.count;
          continue;
        }
        const existing = await tx.score.findUnique({
          where: { roundId_entityType_entityId_hole: key },
        });
        if (existing && existing.updatedAt > updatedAt) continue; // newer edit already stored
        await tx.score.upsert({
          where: { roundId_entityType_entityId_hole: key },
          update: { strokes: entry.strokes, updatedAt, updatedBy: req.user!.id },
          create: { ...key, strokes: entry.strokes, updatedAt, updatedBy: req.user!.id },
        });
        applied += 1;
      }
    });
    // Stamp any match these scores just finished (or re-opened). Done after the
    // write, and the response doesn't wait on it — a failure here must never
    // make a phone think its scores didn't land. The request/response shape
    // above is unchanged: old app versions replay their queues through it.
    const touched = body.scores.map((s) => s.roundId).filter((id) => roundIds.has(id));
    void syncMatchClosures(touched).catch((err) =>
      req.log.error({ err }, 'failed to sync match closures'),
    );
    res.json({ ok: true, applied });
  }),
);
